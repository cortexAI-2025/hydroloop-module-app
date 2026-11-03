import type { BatchRecord } from '@/types/batch';
import { mergeRecords, sameContent } from '../merge';
import type { LocalStore, RemoteBatch, RemoteStore, SyncReport } from './types';
import { SyncNetworkError } from './types';

/**
 * Moteur de synchronisation bidirectionnelle.
 *
 * Règles (voir docs/SYNCHRONISATION.md) :
 *  1. Chaque enregistrement local porte `sync.dirty` (modifié depuis la dernière synchro) et `sync.baseRev`
 *     (révision cloud connue). Ce drapeau est dans IndexedDB : la file d'attente survit à un redémarrage.
 *  2. Récupération : une version distante plus récente remplace la locale **seulement si** la locale n'a pas de
 *     modification en attente. Sinon → fusion (union des journaux), jamais d'écrasement.
 *  3. Envoi : compare-and-swap sur la révision. Si quelqu'un a écrit entre-temps → on récupère, on fusionne, on réessaie.
 *  4. Un batch jamais envoyé s'insère ; si l'id existe déjà côté cloud (doublon) → fusion plutôt que remplacement.
 */

const OVERLAP_MS = 60_000; // chevauchement du curseur : tolère l'ordre de validation des transactions côté serveur
const MAX_ATTEMPTS = 4;
export const CURSOR_KEY = 'pullCursor';

const syncOf = (r: BatchRecord) => r.sync ?? { dirty: true, baseRev: null };
const stripSync = (r: BatchRecord): BatchRecord => { const { sync: _s, ...rest } = r; void _s; return rest; };

function cursorWithOverlap(cursor: string | null): string | null {
  if (!cursor) return null;
  const t = Date.parse(cursor);
  return Number.isNaN(t) ? null : new Date(t - OVERLAP_MS).toISOString();
}

export interface RunSyncOptions {
  now?: () => Date;
  /** Appelé après chaque enregistrement écrit localement (pour rafraîchir l'interface). */
  onLocalChange?: () => void;
}

export async function runSync(local: LocalStore, remote: RemoteStore, opts: RunSyncOptions = {}): Promise<SyncReport> {
  const now = opts.now ?? (() => new Date());
  const report: SyncReport = { pulled: 0, pushed: 0, merged: 0, conflicts: [], failed: [], cursor: null };
  const stamp = () => now().toISOString();

  // ── 1. Récupération ────────────────────────────────────────────────────────
  const cursor = ((await local.getMeta(CURSOR_KEY)) as string | null | undefined) ?? null;
  const rows = await remote.fetchSince(cursorWithOverlap(cursor));
  let newCursor = cursor;

  for (const row of rows) {
    if (!newCursor || row.serverUpdatedAt > newCursor) newCursor = row.serverUpdatedAt;
    const cur = await local.get(row.record.id);
    if (!cur) {
      await local.put({ ...stripSync(row.record), rev: row.rev, sync: { dirty: false, baseRev: row.rev, lastSyncedAt: stamp() } });
      report.pulled++;
      opts.onLocalChange?.();
      continue;
    }
    const s = syncOf(cur);
    if (s.baseRev !== null && row.rev <= s.baseRev) continue; // déjà à jour
    if (!s.dirty) {
      await local.put({ ...stripSync(row.record), rev: row.rev, sync: { dirty: false, baseRev: row.rev, lastSyncedAt: stamp() } });
      report.pulled++;
      opts.onLocalChange?.();
    } else {
      // Modifications locales en attente ET version distante plus récente → fusion, pas d'écrasement.
      const m = mergeRecords(cur, row.record);
      if (!m.notes.length && sameContent(m.record, row.record)) {
        // La version distante contient déjà tout ce que l'appareil avait en attente : rien à renvoyer.
        await local.put({ ...m.record, rev: row.rev, sync: { dirty: false, baseRev: row.rev, lastSyncedAt: stamp() } });
        report.pulled++;
      } else {
        await local.put({ ...m.record, rev: (cur.rev ?? 1) + 1, sync: { dirty: true, baseRev: row.rev } });
        report.merged++;
        if (m.notes.length) report.conflicts.push({ id: cur.id, notes: m.notes });
      }
      opts.onLocalChange?.();
    }
  }

  // ── 2. Envoi ───────────────────────────────────────────────────────────────
  const dirty = (await local.all()).filter((r) => syncOf(r).dirty);
  for (const rec of dirty) {
    try {
      await pushOne(rec, local, remote, report, stamp, opts);
    } catch (e) {
      if (e instanceof SyncNetworkError) throw e; // coupure réseau : on s'arrête, tout reste en file d'attente
      report.failed.push({ id: rec.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (newCursor !== cursor) await local.setMeta(CURSOR_KEY, newCursor);
  report.cursor = newCursor;
  return report;
}

async function pushOne(
  start: BatchRecord,
  local: LocalStore,
  remote: RemoteStore,
  report: SyncReport,
  stamp: () => string,
  opts: RunSyncOptions,
): Promise<void> {
  let rec = start;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const s = syncOf(rec);
    const res = s.baseRev === null ? await remote.insert(stripSync(rec)) : await remote.update(stripSync(rec), s.baseRev);
    if (res.status === 'ok') {
      await local.put({ ...rec, rev: res.remote.rev, sync: { dirty: false, baseRev: res.remote.rev, lastSyncedAt: stamp() } });
      report.pushed++;
      opts.onLocalChange?.();
      return;
    }
    // Conflit (révision périmée) ou doublon : on lit la version distante, on fusionne, on réessaie.
    const theirs: RemoteBatch | null = await remote.fetchOne(rec.id);
    if (!theirs) throw new Error('Conflit de synchronisation : version distante illisible.');
    const m = mergeRecords(rec, theirs.record);
    if (!m.notes.length && sameContent(m.record, theirs.record)) {
      await local.put({ ...m.record, rev: theirs.rev, sync: { dirty: false, baseRev: theirs.rev, lastSyncedAt: stamp() } });
      opts.onLocalChange?.();
      return; // le cloud contenait déjà tout
    }
    report.merged++;
    if (m.notes.length) report.conflicts.push({ id: rec.id, notes: m.notes });
    rec = { ...m.record, rev: (rec.rev ?? 1) + 1, sync: { dirty: true, baseRev: theirs.rev } };
    await local.put(rec);
    opts.onLocalChange?.();
  }
  throw new Error('Synchronisation interrompue : trop de modifications concurrentes, réessayez.');
}
