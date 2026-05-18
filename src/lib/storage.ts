import type { BatchRecord, BatchFormData } from '@/types/batch';
import { detectAlerts } from '@/types/batch';
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByStrain } from './db';
import { pushBatch } from './sync';

const LS_LEGACY_KEY = 'hydroloop_batches';
const LS_MIGRATED_KEY = 'hydroloop_migrated_v2';

async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(LS_MIGRATED_KEY)) return;
  try {
    const raw = localStorage.getItem(LS_LEGACY_KEY);
    if (raw) {
      const old: BatchRecord[] = JSON.parse(raw);
      for (const b of old) await dbPut(b);
      localStorage.removeItem(LS_LEGACY_KEY);
    }
    localStorage.setItem(LS_MIGRATED_KEY, '1');
  } catch {
    // migration is best-effort
  }
}

export async function getBatches(): Promise<BatchRecord[]> {
  await migrateFromLocalStorage();
  const all = await dbGetAll();
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getBatch(id: string): Promise<BatchRecord | undefined> {
  await migrateFromLocalStorage();
  return dbGet(id);
}

export async function getBatchesByStrain(strain: string): Promise<BatchRecord[]> {
  await migrateFromLocalStorage();
  const all = await dbGetByStrain(strain);
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function saveBatch(data: BatchFormData): Promise<BatchRecord> {
  const now = new Date().toISOString();
  const record: BatchRecord = { id: data.BATCH_ID, data, createdAt: now, updatedAt: now };
  await dbPut(record);
  void pushBatch(record); // fire-and-forget cloud sync
  return record;
}

export async function updateReport(id: string, report: string): Promise<void> {
  const record = await dbGet(id);
  if (record) {
    const updated = { ...record, report, updatedAt: new Date().toISOString() };
    await dbPut(updated);
    void pushBatch(updated);
  }
}

export async function deleteBatch(id: string): Promise<void> {
  await dbDelete(id);
}

export async function generateBatchId(): Promise<string> {
  const datePart = new Date().toISOString().slice(0, 10);
  const all = await dbGetAll();
  const sameDay = all.filter((b) => b.id.startsWith(`B${datePart}`));
  return `B${datePart}-${String(sameDay.length + 1).padStart(2, '0')}`;
}

export interface StrainHistory {
  count: number;
  commonAlerts: string[];
  lastBatchDate: string | null;
}

export async function getStrainHistory(
  strain: string,
  excludeId?: string,
): Promise<StrainHistory> {
  const all = await dbGetByStrain(strain);
  const batches = excludeId ? all.filter((b) => b.id !== excludeId) : all;

  if (batches.length === 0) return { count: 0, commonAlerts: [], lastBatchDate: null };

  const alertCounts: Record<string, number> = {};
  for (const b of batches) {
    const alerts = detectAlerts(b.data.DONNEES_ENVIRONNEMENTALES);
    for (const a of alerts) {
      alertCounts[a.message] = (alertCounts[a.message] || 0) + 1;
    }
  }

  const threshold = batches.length * 0.5;
  const commonAlerts = Object.entries(alertCounts)
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([msg]) => msg);

  const sorted = [...batches].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return { count: batches.length, commonAlerts, lastBatchDate: sorted[0]?.createdAt ?? null };
}
