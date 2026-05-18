import { getSupabase } from './supabase';
import { dbGetAll, dbPut } from './db';
import type { BatchRecord } from '@/types/batch';

interface CloudRow {
  id: string;
  data: BatchRecord['data'];
  report: string | null;
  created_at: string;
  updated_at: string;
}

function toRow(r: BatchRecord): CloudRow {
  return {
    id: r.id,
    data: r.data,
    report: r.report ?? null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function fromRow(row: CloudRow): BatchRecord {
  return {
    id: row.id,
    data: row.data,
    report: row.report ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function pushBatch(record: BatchRecord): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from('batches').upsert(toRow(record));
  } catch {
    // Cloud sync is best-effort
  }
}

export async function pullAll(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data } = await sb.from('batches').select('*');
    if (!data) return;
    for (const row of data as CloudRow[]) await dbPut(fromRow(row));
  } catch {
    // Silent — keeps working offline
  }
}

export async function pushAll(): Promise<{ pushed: number; error: string | null }> {
  const sb = getSupabase();
  if (!sb) return { pushed: 0, error: 'Supabase non configuré.' };
  try {
    const all = await dbGetAll();
    const { error } = await sb.from('batches').upsert(all.map(toRow));
    return { pushed: all.length, error: error?.message ?? null };
  } catch (e) {
    return { pushed: 0, error: String(e) };
  }
}
