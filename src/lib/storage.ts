import type { BatchRecord, BatchFormData, ReportSource, TrackedBatch } from '@/types/batch';
import { detectAlerts } from '@/types/batch';
import { dbGetAll, dbGet, dbPut } from './db';
import { pushBatch } from './sync';
import { notifyDataChanged } from './events';
import { addEvent, normalizeRecord, pickNewer, withLiveDay } from './tracking';

const LS_LEGACY_KEY = 'hydroloop_batches';
const LS_MIGRATED_KEY = 'hydroloop_migrated_v2';


async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(LS_MIGRATED_KEY)) return;
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

function live(r: BatchRecord): TrackedBatch {
  return withLiveDay(normalizeRecord(r));
}

function byNewest(a: BatchRecord, b: BatchRecord) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export async function getBatches(): Promise<TrackedBatch[]> {
  await migrateFromLocalStorage();
  const all = await dbGetAll();
  return all.filter((b) => !b.deletedAt).map(live).sort(byNewest);
}

export async function getBatch(id: string): Promise<TrackedBatch | undefined> {
  await migrateFromLocalStorage();
  const r = await dbGet(id);
  return r && !r.deletedAt ? live(r) : undefined;
}

export async function getBatchesByStrain(strain: string): Promise<TrackedBatch[]> {
  return (await getBatches()).filter((b) => b.data.SOUCHE === strain);
}

export async function saveBatch(data: BatchFormData): Promise<TrackedBatch> {
  const now = new Date().toISOString();
  const record = normalizeRecord({ id: data.BATCH_ID, data, createdAt: now, updatedAt: now });
  await persist(record);
  return record;
}

/** Enregistre une version modifiée du batch (relevé, changement de niveau, récolte…). */
export async function updateBatch(record: TrackedBatch): Promise<TrackedBatch> {
  const updated = { ...record, updatedAt: new Date().toISOString() };
  await persist(updated);
  return live(updated);
}

export async function updateReport(id: string, report: string, source: ReportSource): Promise<TrackedBatch | undefined> {
  const r = await getBatch(id);
  if (!r) return undefined;
  const at = new Date().toISOString();
  const next = addEvent(
    { ...r, report, reportSource: source, reportAt: at },
    'report',
    source === 'ai' ? 'Rapport IA généré' : 'Rapport de secours (analyse locale) généré',
  );
  return updateBatch(next);
}

/** Suppression logique : le batch disparaît partout, y compris après synchronisation. */
export async function deleteBatch(id: string): Promise<void> {
  const r = await dbGet(id);
  if (!r) return;
  const now = new Date().toISOString();
  await persist({ ...r, deletedAt: now, updatedAt: now });
}

async function persist(record: BatchRecord) {
  await dbPut(record);
  notifyDataChanged();
  void pushBatch(record); // fire-and-forget ; rejoué à la prochaine synchro si hors ligne
}

export async function generateBatchId(): Promise<string> {
  const datePart = new Date().toISOString().slice(0, 10);
  const all = await dbGetAll();
  const sameDay = all.filter((b) => b.id.startsWith(`B${datePart}`));
  let n = sameDay.length + 1;
  const ids = new Set(all.map((b) => b.id));
  while (ids.has(`B${datePart}-${String(n).padStart(2, '0')}`)) n++;
  return `B${datePart}-${String(n).padStart(2, '0')}`;
}

// ─── Sauvegarde / import ─────────────────────────────────────────────────────

export interface BackupFile {
  app: 'hydroloop-farm-manager';
  version: 2;
  exportedAt: string;
  batches: BatchRecord[];
}

export async function exportBackup(): Promise<BackupFile> {
  const all = await dbGetAll();
  return { app: 'hydroloop-farm-manager', version: 2, exportedAt: new Date().toISOString(), batches: all };
}

/** Fusionne une sauvegarde : pour chaque batch, la version la plus récente l'emporte. */
export async function importBackup(json: unknown): Promise<{ imported: number; skipped: number }> {
  const batches = (json as Partial<BackupFile>)?.batches ?? (Array.isArray(json) ? json : null);
  if (!Array.isArray(batches)) throw new Error('Fichier invalide : aucun batch trouvé.');
  let imported = 0;
  let skipped = 0;
  for (const b of batches as BatchRecord[]) {
    if (!b?.id || !b.data || !b.createdAt || !b.updatedAt) { skipped++; continue; }
    const local = await dbGet(b.id);
    const winner = pickNewer(local, b);
    if (winner === b) { await dbPut(b); void pushBatch(b); imported++; } else skipped++;
  }
  notifyDataChanged();
  return { imported, skipped };
}

// ─── Historique par souche (contexte IA) ─────────────────────────────────────

export interface StrainHistory {
  count: number;
  commonAlerts: string[];
  lastBatchDate: string | null;
  harvests: { batchId: string; freshWeightKg: number; plants: number }[];
}

export async function getStrainHistory(strain: string, excludeId?: string): Promise<StrainHistory> {
  const all = await getBatchesByStrain(strain);
  const batches = excludeId ? all.filter((b) => b.id !== excludeId) : all;

  if (batches.length === 0) return { count: 0, commonAlerts: [], lastBatchDate: null, harvests: [] };

  const alertCounts: Record<string, number> = {};
  for (const b of batches) {
    const seen = new Set<string>();
    for (const r of b.readings) for (const a of detectAlerts(r.env)) seen.add(a.message);
    for (const m of seen) alertCounts[m] = (alertCounts[m] || 0) + 1;
  }

  const threshold = batches.length * 0.5;
  const commonAlerts = Object.entries(alertCounts)
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([msg]) => msg);

  const harvests = batches
    .filter((b) => b.harvest)
    .map((b) => ({ batchId: b.id, freshWeightKg: b.harvest!.freshWeightKg, plants: b.harvest!.plantsHarvested }));

  return { count: batches.length, commonAlerts, lastBatchDate: batches[0]?.createdAt ?? null, harvests };
}
