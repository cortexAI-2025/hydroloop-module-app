import type { BatchFormData, BatchRecord } from '@/types/batch';
import type { RemoteBatch } from './types';

/** Ligne de la table `public.batches` (voir supabase/migrations). */
export interface BatchRow {
  owner_id: string;
  id: string;
  rev: number;
  data: BatchFormData;
  report: string | null;
  tracking: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  server_updated_at?: string;
}

const TRACKING_KEYS = [
  'status', 'phaseStartedAt', 'levelTargetDays', 'readings', 'events', 'harvest', 'reportSource', 'reportAt', 'reportInputHash',
] as const;

export function toRow(record: BatchRecord, owner: string, rev: number): Omit<BatchRow, 'server_updated_at'> {
  const tracking: Record<string, unknown> = {};
  for (const k of TRACKING_KEYS) if (record[k] !== undefined) tracking[k] = record[k];
  return {
    owner_id: owner,
    id: record.id,
    rev,
    data: record.data,
    report: record.report ?? null,
    tracking,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt ?? null,
  };
}

export function fromRow(row: BatchRow): RemoteBatch {
  const record: BatchRecord = {
    id: row.id,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.tracking ?? {}),
  } as BatchRecord;
  if (row.report !== null && row.report !== undefined) record.report = row.report;
  if (row.deleted_at) record.deletedAt = row.deleted_at;
  record.rev = row.rev;
  return { record, rev: row.rev, serverUpdatedAt: row.server_updated_at ?? row.updated_at };
}
