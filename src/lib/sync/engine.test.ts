import { beforeEach, describe, expect, it } from 'vitest';
import type { BatchRecord } from '@/types/batch';
import { MemoryLocal, MemoryRemote } from './memory';
import type { RemoteBatch } from './types';
import { runSync } from './engine';
import { makeRecord, withReading } from '@/test/fixtures';

/** Écriture locale « comme l'application » : rev+1 et enregistrement marqué en attente. */
async function localWrite(l: MemoryLocal, r: BatchRecord) {
  const prev = await l.get(r.id);
  await l.put({ ...r, rev: (prev?.rev ?? 0) + 1, sync: { dirty: true, baseRev: prev?.sync?.baseRev ?? null } });
}

let shared: Map<string, Map<string, RemoteBatch>>;
let remoteA: MemoryRemote, remoteB: MemoryRemote;
let devA: MemoryLocal, devB: MemoryLocal;

beforeEach(() => {
  shared = new Map();
  remoteA = new MemoryRemote('alice', shared);
  remoteB = new MemoryRemote('alice', shared); // même compte, autre appareil
  devA = new MemoryLocal();
  devB = new MemoryLocal();
});

describe('moteur de synchronisation', () => {
  it('envoie un batch créé hors ligne dès que le réseau revient', async () => {
    await localWrite(devA, makeRecord());
    remoteA.online = false;
    await expect(runSync(devA, remoteA)).rejects.toThrow(/hors ligne/);
    expect((await devA.get('B2026-09-01-AAAA'))!.sync!.dirty).toBe(true); // toujours en file d'attente
    remoteA.online = true;
    const rep = await runSync(devA, remoteA);
    expect(rep.pushed).toBe(1);
    expect((await devA.get('B2026-09-01-AAAA'))!.sync!.dirty).toBe(false);
    expect(remoteA.rows.size).toBe(1);
  });

  it('un second appareil récupère le batch', async () => {
    await localWrite(devA, makeRecord());
    await runSync(devA, remoteA);
    const rep = await runSync(devB, remoteB);
    expect(rep.pulled).toBe(1);
    expect(await devB.get('B2026-09-01-AAAA')).toBeTruthy();
  });

  it('modifications simultanées sur deux appareils : tout est conservé des deux côtés', async () => {
    await localWrite(devA, makeRecord());
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);

    await localWrite(devA, withReading((await devA.get('B2026-09-01-AAAA'))!, 'r-a', '2026-09-02T08:00:00.000Z'));
    await localWrite(devB, withReading((await devB.get('B2026-09-01-AAAA'))!, 'r-b', '2026-09-02T09:00:00.000Z'));

    await runSync(devA, remoteA);
    const repB = await runSync(devB, remoteB);
    expect(repB.merged).toBe(1);
    await runSync(devA, remoteA);

    const a = (await devA.get('B2026-09-01-AAAA'))!, b = (await devB.get('B2026-09-01-AAAA'))!;
    for (const rec of [a, b]) {
      const ids = rec.readings!.map((x) => x.id);
      expect(ids).toContain('r-a');
      expect(ids).toContain('r-b');
    }
    expect(a.readings!.map((x) => x.id).sort()).toEqual(b.readings!.map((x) => x.id).sort()); // convergence
    expect(a.sync!.dirty || b.sync!.dirty).toBe(false);
  });

  it('une version ancienne ne remplace jamais une version récente', async () => {
    const r = makeRecord();
    await localWrite(devA, withReading(r, 'r-new', '2026-09-10T08:00:00.000Z'));
    await runSync(devA, remoteA);
    // l'appareil B repart d'un état ancien (restauré d'une vieille sauvegarde) et se synchronise
    await localWrite(devB, r);
    await runSync(devB, remoteB);
    const remote = remoteA.rows.get(r.id)!;
    expect(remote.record.readings!.map((x) => x.id)).toContain('r-new');
    expect((await devB.get(r.id))!.readings!.map((x) => x.id)).toContain('r-new');
  });

  it('protège contre les doublons : un même id inséré par deux appareils est fusionné', async () => {
    await localWrite(devA, withReading(makeRecord(), 'r-a', '2026-09-02T08:00:00.000Z'));
    await localWrite(devB, withReading(makeRecord(), 'r-b', '2026-09-02T09:00:00.000Z'));
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);
    expect(remoteA.rows.size).toBe(1);
    const ids = remoteA.rows.get('B2026-09-01-AAAA')!.record.readings!.map((x) => x.id);
    expect(ids).toContain('r-a');
    expect(ids).toContain('r-b');
  });

  it('écriture concurrente pendant l’envoi (compare-and-swap) : réessaie sans rien perdre', async () => {
    await localWrite(devA, makeRecord());
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);
    await localWrite(devA, withReading((await devA.get('B2026-09-01-AAAA'))!, 'r-a', '2026-09-02T08:00:00.000Z'));

    // Pendant l'envoi de A, l'appareil B écrit directement sur le serveur
    let injected = false;
    remoteA.beforeWrite = () => {
      if (injected) return;
      injected = true;
      const cur = shared.get('alice')!.get('B2026-09-01-AAAA')!;
      shared.get('alice')!.set('B2026-09-01-AAAA', {
        rev: cur.rev + 1, serverUpdatedAt: '2030-01-01T00:00:00.000Z',
        record: withReading(cur.record, 'r-b', '2026-09-02T09:00:00.000Z'),
      });
    };
    const rep = await runSync(devA, remoteA);
    expect(rep.failed).toEqual([]);
    const ids = shared.get('alice')!.get('B2026-09-01-AAAA')!.record.readings!.map((x) => x.id);
    expect(ids).toContain('r-a');
    expect(ids).toContain('r-b');
  });

  it('isolation : un autre compte ne voit pas les données', async () => {
    await localWrite(devA, makeRecord());
    await runSync(devA, remoteA);
    const bobRemote = new MemoryRemote('bob', shared);
    const bobLocal = new MemoryLocal();
    const rep = await runSync(bobLocal, bobRemote);
    expect(rep.pulled).toBe(0);
    expect((await bobLocal.all()).length).toBe(0);
  });

  it('une deuxième synchro sans changement n’envoie rien', async () => {
    await localWrite(devA, makeRecord());
    await runSync(devA, remoteA);
    const rep = await runSync(devA, remoteA);
    expect(rep.pushed).toBe(0);
    expect(rep.pulled).toBe(0);
    expect(remoteA.calls.insert).toBe(1);
    expect(remoteA.calls.update).toBe(0);
  });

  it('suppression logique propagée vers l’autre appareil', async () => {
    await localWrite(devA, makeRecord());
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);
    const rec = (await devA.get('B2026-09-01-AAAA'))!;
    await localWrite(devA, { ...rec, updatedAt: '2030-01-01T00:00:00.000Z', deletedAt: '2030-01-01T00:00:00.000Z' });
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);
    expect((await devB.get('B2026-09-01-AAAA'))!.deletedAt).toBeTruthy();
  });
});

describe('suppression logique et restauration entre appareils', () => {
  const ID = 'B2026-09-01-AAAA';
  const setup = async () => {
    await localWrite(devA, makeRecord());
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);
  };
  const del = async (dev: MemoryLocal, at: string) => {
    const r = (await dev.get(ID))!;
    await localWrite(dev, { ...r, updatedAt: at, deletedAt: at });
  };

  it('suppression sur A puis restauration sur B (activité postérieure) : le batch revit partout, sans perte', async () => {
    await setup();
    await del(devA, '2026-10-01T00:00:00.000Z');
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);
    expect((await devB.get(ID))!.deletedAt).toBeTruthy();
    // B restaure en saisissant un relevé daté après la suppression
    const b = (await devB.get(ID))!;
    const { deletedAt: _d, ...rest } = b; void _d;
    await localWrite(devB, withReading(rest as BatchRecord, 'r-after', '2026-10-02T08:00:00.000Z'));
    await runSync(devB, remoteB);
    await runSync(devA, remoteA);
    for (const dev of [devA, devB]) {
      const r = (await dev.get(ID))!;
      expect(r.deletedAt).toBeUndefined();
      expect(r.readings!.map((x) => x.id)).toContain('r-after');
    }
  });

  it('suppression sur A pendant que B ajoute un relevé plus récent : le relevé n’est pas perdu, le batch reste actif', async () => {
    await setup();
    await del(devA, '2026-10-01T00:00:00.000Z');
    await localWrite(devB, withReading((await devB.get(ID))!, 'r-b', '2026-10-05T08:00:00.000Z'));
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);
    await runSync(devA, remoteA);
    const a = (await devA.get(ID))!;
    expect(a.deletedAt).toBeUndefined();
    expect(a.readings!.map((x) => x.id)).toContain('r-b');
  });

  it('suppression plus récente que toute activité : propagée, données conservées dans le batch supprimé', async () => {
    await setup();
    await localWrite(devB, withReading((await devB.get(ID))!, 'r-old', '2026-09-20T08:00:00.000Z'));
    await del(devA, '2026-10-01T00:00:00.000Z');
    await runSync(devA, remoteA);
    await runSync(devB, remoteB);
    await runSync(devA, remoteA);
    const b = (await devB.get(ID))!;
    expect(b.deletedAt).toBeTruthy();
    expect(b.readings!.map((x) => x.id)).toContain('r-old'); // rien n'est détruit
    expect(remoteA.rows.get(ID)!.record.readings!.map((x) => x.id)).toContain('r-old');
  });

  it('un jeton expiré (SyncAuthError) laisse la file d’attente intacte', async () => {
    await localWrite(devA, makeRecord());
    const { SyncAuthError } = await import('./types');
    remoteA.fetchSince = async () => { throw new SyncAuthError('jeton expiré'); };
    await expect(runSync(devA, remoteA)).rejects.toThrow(/expiré/);
    expect((await devA.get(ID))!.sync!.dirty).toBe(true);
  });
});
