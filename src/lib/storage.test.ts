import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { IDBFactory } from 'fake-indexeddb';
import { closeDb, dbGet, setDbOwner } from './db';
import {
  adoptLegacyData, deleteBatch, ensureDailySnapshot, exportBackup, generateBatchId, getBatch, getBatches, importBackup, legacyBatchCount,
  listSnapshots, listTrash, pendingCount, restoreBatch, restoreSnapshot, saveBatch, updateBatch, updateReport, validateRecord,
} from './storage';
import { addReading } from './tracking';
import { ENV, makeRecord } from '@/test/fixtures';
import type { BatchFormData } from '@/types/batch';

const form = (id: string): BatchFormData => makeRecord(id).data;

beforeEach(async () => {
  await closeDb();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); // base vierge pour chaque test
  setDbOwner('local');
});

describe('stockage local (IndexedDB)', () => {
  it('enregistre, relit et marque l’enregistrement en attente de synchro', async () => {
    const b = await saveBatch(form('B2026-09-01-AAAA'));
    expect(b.rev).toBe(2);
    const raw = await dbGet('B2026-09-01-AAAA');
    expect(raw!.sync!.dirty).toBe(true);
    expect(await pendingCount()).toBe(1);
  });

  it('refuse d’écraser un batch existant', async () => {
    await saveBatch(form('B2026-09-01-AAAA'));
    await expect(saveBatch(form('B2026-09-01-AAAA'))).rejects.toThrow(/existe déjà/);
  });

  it('chaque modification incrémente la révision', async () => {
    const b = await saveBatch(form('B2026-09-01-AAAA'));
    const b2 = await updateBatch(addReading(b, ENV, { operator: 'T' }));
    expect(b2.rev).toBeGreaterThan(b.rev);
    expect(b2.readings.length).toBe(b.readings.length + 1);
  });

  it('suppression logique : visible dans la corbeille, restaurable, jamais perdue', async () => {
    await saveBatch(form('B2026-09-01-AAAA'));
    await deleteBatch('B2026-09-01-AAAA');
    expect((await getBatches()).length).toBe(0);
    expect((await listTrash()).length).toBe(1);
    expect(await getBatch('B2026-09-01-AAAA')).toBeUndefined();
    await restoreBatch('B2026-09-01-AAAA');
    expect((await getBatches()).length).toBe(1);
  });

  it('génère des identifiants uniques', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) { const id = await generateBatchId(); ids.add(id); await saveBatch(form(id)); }
    expect(ids.size).toBe(50);
  });

  it('le rapport est enregistré avec sa source', async () => {
    await saveBatch(form('B2026-09-01-AAAA'));
    const b = await updateReport('B2026-09-01-AAAA', 'Rapport', 'fallback', 'hash1');
    expect(b!.reportSource).toBe('fallback');
    expect(b!.reportInputHash).toBe('hash1');
  });
});

describe('sauvegarde / restauration', () => {
  it('export puis import sur une base vide restitue toutes les données', async () => {
    const b = await saveBatch(form('B2026-09-01-AAAA'));
    await updateBatch(addReading(b, ENV));
    const backup = await exportBackup();
    expect(backup.count).toBe(1);
    await closeDb();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    const summary = await importBackup(JSON.parse(JSON.stringify(backup)));
    expect(summary.added).toBe(1);
    expect((await getBatch('B2026-09-01-AAAA'))!.readings.length).toBe(2);
  });

  it('un import ne remplace pas silencieusement des données plus récentes', async () => {
    const b = await saveBatch(form('B2026-09-01-AAAA'));
    const old = await exportBackup();
    await updateBatch(addReading(b, { ...ENV, pH: 6.3 }));
    const s = await importBackup(old); // ancienne sauvegarde
    expect(s.added).toBe(0);
    expect((await getBatch('B2026-09-01-AAAA'))!.readings.length).toBe(2); // le relevé récent est conservé
  });

  it('un import prend d’abord un instantané de sécurité', async () => {
    await saveBatch(form('B2026-09-01-AAAA'));
    await importBackup(await exportBackup());
    const snaps = await listSnapshots();
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0].reason).toMatch(/avant/);
  });

  it('rejette les fichiers invalides sans rien modifier, signale les enregistrements invalides', async () => {
    await expect(importBackup({ foo: 1 })).rejects.toThrow(/invalide/);
    await expect(importBackup({ app: 'autre', batches: [] })).rejects.toThrow(/sauvegarde HydroLoop/);
    const s = await importBackup({ batches: [{ id: 'x' }, makeRecord('B2026-09-01-CCCC')] });
    expect(s.invalid).toHaveLength(1);
    expect(s.added).toBe(1);
  });

  it('un instantané quotidien est pris une seule fois par jour et restaurable', async () => {
    await saveBatch(form('B2026-09-01-AAAA'));
    const day = new Date('2026-10-01T10:00:00Z');
    expect(await ensureDailySnapshot(day)).toBe(true);
    expect(await ensureDailySnapshot(new Date(day.getTime() + 3600_000))).toBe(false);
    await deleteBatch('B2026-09-01-AAAA');
    const [snap] = await listSnapshots();
    // La restauration fusionne : une suppression postérieure à l'instantané est conservée (le batch reste dans la corbeille, récupérable).
    const s = await restoreSnapshot(snap.id!);
    expect(s.invalid).toEqual([]);
    expect((await listTrash()).map((b) => b.id)).toContain('B2026-09-01-AAAA');
    await restoreBatch('B2026-09-01-AAAA');
    expect(await getBatch('B2026-09-01-AAAA')).toBeTruthy();
  });

  it('validateRecord refuse les données incohérentes', () => {
    expect(validateRecord(null)).toBeTruthy();
    expect(validateRecord({ ...makeRecord(), id: '' })).toBeTruthy();
    expect(validateRecord({ ...makeRecord(), data: { ...makeRecord().data, PHASE_NUMBER: 9 } })).toBeTruthy();
    expect(validateRecord(makeRecord())).toBeNull();
  });
});

describe('isolation par utilisateur', () => {
  it('deux comptes sur le même appareil ont des bases séparées', async () => {
    setDbOwner('alice');
    await saveBatch(form('B2026-09-01-AAAA'));
    setDbOwner('bob');
    expect((await getBatches()).length).toBe(0);
    await saveBatch(form('B2026-09-01-BBBB'));
    setDbOwner('alice');
    expect((await getBatches()).map((b) => b.id)).toEqual(['B2026-09-01-AAAA']);
  });

  it('rattachement explicite des données anciennes (mode sans compte) au compte courant', async () => {
    setDbOwner('local');
    await saveBatch(form('B2026-09-01-LEGA'));
    setDbOwner('alice');
    expect((await getBatches()).length).toBe(0);
    expect(await legacyBatchCount()).toBe(1);
    const s = await adoptLegacyData();
    expect(s.added).toBe(1);
    expect((await getBatches()).length).toBe(1);
    expect((await closeAndCount('local'))).toBe(1); // la base d'origine n'est pas détruite
  });
});

async function closeAndCount(owner: string): Promise<number> {
  const prev = owner;
  await closeDb();
  setDbOwner(prev);
  return (await getBatches()).length;
}

describe('migration IndexedDB v1 → v2', () => {
  it('conserve les données de la version 1 et crée les nouveaux magasins', async () => {
    await closeDb();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    // Base telle que créée par la v1 (version 1, magasin « batches » seul, enregistrements sans rev/sync)
    const v1 = await openDB('hydroloop-db', 1, {
      upgrade(db) {
        const s = db.createObjectStore('batches', { keyPath: 'id' });
        s.createIndex('by-strain', 'data.SOUCHE');
        s.createIndex('by-date', 'createdAt');
      },
    });
    const legacy = makeRecord('B2026-08-01-01');
    const { rev: _r, sync: _s, ...old } = legacy; void _r; void _s;
    await v1.put('batches', old);
    v1.close();

    setDbOwner('local');
    const all = await getBatches();
    expect(all.map((b) => b.id)).toEqual(['B2026-08-01-01']);
    expect(all[0].rev).toBeGreaterThanOrEqual(1);
    expect(await pendingCount()).toBe(1); // sera envoyé à la première synchro
    await saveBatch(form('B2026-09-01-NEW1')); // les nouveaux magasins fonctionnent
    expect(await ensureDailySnapshot()).toBe(true);
  });
});
