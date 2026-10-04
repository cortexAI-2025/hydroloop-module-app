import { getSupabase } from './supabase';
import { dbGet, dbGetAll, dbPut } from './db';
import { pickNewer } from './tracking';
import { notifyDataChanged } from './events';
import type { BatchRecord } from '@/types/batch';

/*
  Table Supabase attendue (voir README) :
    batches(id TEXT PK, data JSONB, report TEXT, tracking JSONB,
            created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
  `tracking` porte le suivi de culture : relevés, événements, récolte, suppression logique.
*/

interface CloudRow {
  id: string;
  data: BatchRecord['data'];
  report: string | null;
  tracking: Tracking | null;
  created_at: string;
  updated_at: string;
}

type Tracking = Pick<
  BatchRecord,
  'status' | 'phaseStartedAt' | 'levelTargetDays' | 'readings' | 'events' | 'harvest' | 'deletedAt' | 'reportSource' | 'reportAt'
>;

const PENDING_KEY = 'hydroloop_pending_sync';
export const SYNC_EVENT = 'hydroloop:sync';

export type SyncState =
  | { state: 'idle' | 'disabled' }
  | { state: 'syncing' }
  | { state: 'ok'; at: string; pulled: number; pushed: number }
  | { state: 'error'; message: string; pending: number };

function emit(detail: SyncState) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<SyncState>(SYNC_EVENT, { detail }));
}

export function toRow(r: BatchRecord): CloudRow {
  return {
    id: r.id,
    data: r.data,
    report: r.report ?? null,
    tracking: {
      status: r.status,
      phaseStartedAt: r.phaseStartedAt,
      levelTargetDays: r.levelTargetDays,
      readings: r.readings,
      events: r.events,
      harvest: r.harvest,
      deletedAt: r.deletedAt,
      reportSource: r.reportSource,
      reportAt: r.reportAt,
    },
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export function fromRow(row: CloudRow): BatchRecord {
  const t = row.tracking ?? {};
  const out: BatchRecord = {
    id: row.id,
    data: row.data,
    report: row.report ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const [k, v] of Object.entries(t)) if (v !== undefined && v !== null) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

// ─── File d'attente hors ligne ───────────────────────────────────────────────

function readPending(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function writePending(ids: Set<string>) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify([...ids]));
  } catch {
    // stockage indisponible : la prochaine synchro complète rattrapera
  }
}

export function pendingCount(): number {
  return typeof window === 'undefined' ? 0 : readPending().size;
}

function friendlyError(message: string): string {
  if (/tracking/.test(message) && /column/i.test(message))
    return 'Colonne « tracking » absente : exécutez la migration SQL du README dans Supabase.';
  return message;
}

/** Envoie un batch ; en cas d'échec il reste en file d'attente. */
export async function pushBatch(record: BatchRecord): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const pending = readPending();
  pending.add(record.id);
  writePending(pending);
  try {
    const { error } = await sb.from('batches').upsert(toRow(record));
    if (error) throw new Error(error.message);
    const after = readPending();
    after.delete(record.id);
    writePending(after);
  } catch {
    // reste en attente ; rejoué par syncNow()
  }
}

/** Récupère le cloud et fusionne : la version la plus récente de chaque batch l'emporte. */
export async function pullAll(): Promise<{ pulled: number; error: string | null }> {
  const sb = getSupabase();
  if (!sb) return { pulled: 0, error: 'Supabase non configuré.' };
  try {
    const { data, error } = await sb.from('batches').select('*');
    if (error) return { pulled: 0, error: friendlyError(error.message) };
    let pulled = 0;
    for (const row of (data ?? []) as CloudRow[]) {
      const remote = fromRow(row);
      const local = await dbGet(remote.id);
      if (pickNewer(local, remote) === remote) {
        await dbPut(remote);
        pulled++;
      }
    }
    return { pulled, error: null };
  } catch (e) {
    return { pulled: 0, error: String(e) };
  }
}

/** Envoie tous les batches locaux (suppressions logiques comprises). */
export async function pushAll(): Promise<{ pushed: number; error: string | null }> {
  const sb = getSupabase();
  if (!sb) return { pushed: 0, error: 'Supabase non configuré.' };
  try {
    const all = await dbGetAll();
    if (all.length === 0) return { pushed: 0, error: null };
    const { error } = await sb.from('batches').upsert(all.map(toRow));
    if (error) return { pushed: 0, error: friendlyError(error.message) };
    writePending(new Set());
    return { pushed: all.length, error: null };
  } catch (e) {
    return { pushed: 0, error: String(e) };
  }
}

async function pushPending(): Promise<{ pushed: number; error: string | null }> {
  const sb = getSupabase();
  if (!sb) return { pushed: 0, error: null };
  const ids = [...readPending()];
  if (ids.length === 0) return { pushed: 0, error: null };
  const records = (await Promise.all(ids.map((id) => dbGet(id)))).filter((r): r is BatchRecord => !!r);
  if (records.length === 0) { writePending(new Set()); return { pushed: 0, error: null }; }
  const { error } = await sb.from('batches').upsert(records.map(toRow));
  if (error) return { pushed: 0, error: friendlyError(error.message) };
  writePending(new Set());
  return { pushed: records.length, error: null };
}

let running: Promise<SyncState> | null = null;

/** Synchronisation complète : envoi de la file d'attente puis récupération du cloud. */
export function syncNow(): Promise<SyncState> {
  if (!getSupabase()) {
    const s: SyncState = { state: 'disabled' };
    emit(s);
    return Promise.resolve(s);
  }
  if (running) return running;
  emit({ state: 'syncing' });
  running = (async () => {
    try {
      const push = await pushPending();
      const pull = await pullAll();
      const error = push.error || pull.error;
      const s: SyncState = error
        ? { state: 'error', message: error, pending: pendingCount() }
        : { state: 'ok', at: new Date().toISOString(), pulled: pull.pulled, pushed: push.pushed };
      emit(s);
      if (pull.pulled > 0) notifyDataChanged();
      return s;
    } finally {
      running = null;
    }
  })();
  return running;
}
