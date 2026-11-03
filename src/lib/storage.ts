import type { BatchFormData, BatchRecord, ReportSource, SyncInfo, TrackedBatch } from '@/types/batch';
import { detectAlerts } from '@/types/batch';
import {
  dbGet, dbGetAll, dbPut, dbPutMany, legacyBatches, legacyBatchCount, metaGet, metaSet,
  snapshotAdd, snapshotGet, snapshotLatestAt, snapshotList,
} from './db';
import { notifyDataChanged, notifyLocalWrite } from './events';
import { mergeRecords, sameContent } from './merge';
import { addEvent, newBatchId, normalizeRecord, withLiveDay } from './tracking';
import { getActiveThresholds } from './thresholds';

const LS_LEGACY_KEY = 'hydroloop_batches';
const LS_MIGRATED_KEY = 'hydroloop_migrated_v2';

/** Migration de la toute première version (localStorage) vers IndexedDB. Sans perte : copie, ne supprime qu'après réussite. */
async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(LS_MIGRATED_KEY)) return;
    const raw = localStorage.getItem(LS_LEGACY_KEY);
    if (raw) {
      const old: BatchRecord[] = JSON.parse(raw);
      for (const b of old) {
        const local = await dbGet(b.id);
        await dbPut(local ? mergeRecords(local, b).record : b);
      }
      localStorage.removeItem(LS_LEGACY_KEY);
    }
    localStorage.setItem(LS_MIGRATED_KEY, '1');
  } catch {
    // La migration sera retentée au prochain démarrage : les données d'origine ne sont pas supprimées en cas d'échec.
  }
}

const live = (r: BatchRecord): TrackedBatch => withLiveDay(normalizeRecord(r));
const byNewest = (a: BatchRecord, b: BatchRecord) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/** Informations de synchro d'un enregistrement ; un enregistrement sans info est considéré comme jamais synchronisé. */
export const syncOf = (r: BatchRecord): SyncInfo => r.sync ?? { dirty: true, baseRev: null };

export async function getBatches(opts: { includeDeleted?: boolean } = {}): Promise<TrackedBatch[]> {
  await migrateFromLocalStorage();
  const all = await dbGetAll();
  return all.filter((b) => opts.includeDeleted || !b.deletedAt).map(live).sort(byNewest);
}

export async function getBatch(id: string): Promise<TrackedBatch | undefined> {
  await migrateFromLocalStorage();
  const r = await dbGet(id);
  return r && !r.deletedAt ? live(r) : undefined;
}

export async function getBatchesByStrain(strain: string): Promise<TrackedBatch[]> {
  return (await getBatches()).filter((b) => b.data.SOUCHE === strain);
}

/**
 * Écrit un enregistrement localement et le marque « à synchroniser ».
 * Toute écriture passe par ici : c'est ce qui garantit que la file d'attente hors ligne ne perd rien.
 */
async function persist(record: BatchRecord, opts: { silent?: boolean } = {}): Promise<BatchRecord> {
  const prev = syncOf(record);
  const next: BatchRecord = { ...record, rev: (record.rev ?? 0) + 1, sync: { ...prev, dirty: true } };
  await dbPut(next);
  if (!opts.silent) notifyLocalWrite();
  return next;
}

export async function saveBatch(data: BatchFormData): Promise<TrackedBatch> {
  if (await dbGet(data.BATCH_ID)) throw new Error(`Le batch ${data.BATCH_ID} existe déjà.`);
  const now = new Date().toISOString();
  const record = normalizeRecord({ id: data.BATCH_ID, data, createdAt: now, updatedAt: now });
  return live(await persist(record));
}

/** Enregistre une version modifiée du batch (relevé, changement de niveau, récolte…). */
export async function updateBatch(record: TrackedBatch): Promise<TrackedBatch> {
  const current = await dbGet(record.id);
  // Conserve les informations de synchro du stockage (le composant ne les modifie pas).
  const base: BatchRecord = { ...record, sync: current?.sync ?? record.sync, rev: current?.rev ?? record.rev, updatedAt: new Date().toISOString() };
  return live(await persist(base));
}

export async function updateReport(id: string, report: string, source: ReportSource, inputHash?: string): Promise<TrackedBatch | undefined> {
  const r = await getBatch(id);
  if (!r) return undefined;
  const at = new Date().toISOString();
  const next = addEvent(
    { ...r, report, reportSource: source, reportAt: at, reportInputHash: inputHash },
    'report',
    source === 'ai' ? 'Rapport IA généré' : 'Rapport local (sans IA) généré',
  );
  return updateBatch(next);
}

/** Suppression logique : récupérable depuis la corbeille, propagée aux autres appareils. */
export async function deleteBatch(id: string): Promise<void> {
  const r = await dbGet(id);
  if (!r || r.deletedAt) return;
  const now = new Date().toISOString();
  await persist({ ...r, deletedAt: now, updatedAt: now });
}

export async function restoreBatch(id: string): Promise<void> {
  const r = await dbGet(id);
  if (!r?.deletedAt) return;
  const { deletedAt: _d, ...rest } = r;
  void _d;
  const now = new Date().toISOString();
  const restored = addEvent(normalizeRecord({ ...rest, updatedAt: now }), 'edit', 'Batch restauré depuis la corbeille');
  await persist(restored);
}

export async function listTrash(): Promise<BatchRecord[]> {
  return (await dbGetAll()).filter((b) => b.deletedAt).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

/** Nouvel identifiant garanti inexistant localement. */
export async function generateBatchId(): Promise<string> {
  const ids = new Set((await dbGetAll()).map((b) => b.id));
  for (let i = 0; i < 20; i++) {
    const id = newBatchId();
    if (!ids.has(id)) return id;
  }
  throw new Error('Impossible de générer un identifiant de batch unique.');
}

/** Nombre d'enregistrements en attente d'envoi (inclut les suppressions). */
export async function pendingCount(): Promise<number> {
  return (await dbGetAll()).filter((r) => syncOf(r).dirty).length;
}

// ─── Sauvegarde / import ─────────────────────────────────────────────────────

export interface BackupFile {
  app: 'hydroloop-farm-manager';
  version: 3;
  exportedAt: string;
  count: number;
  batches: BatchRecord[];
}

export async function exportBackup(): Promise<BackupFile> {
  const all = (await dbGetAll()).map(({ sync: _s, ...r }) => { void _s; return r as BatchRecord; });
  return { app: 'hydroloop-farm-manager', version: 3, exportedAt: new Date().toISOString(), count: all.length, batches: all };
}

/** Contrôle minimal d'un enregistrement importé. Retourne un message d'erreur, ou null si valide. */
export function validateRecord(b: unknown): string | null {
  const r = b as Partial<BatchRecord> | null;
  if (!r || typeof r !== 'object') return 'enregistrement illisible';
  if (typeof r.id !== 'string' || !r.id || r.id.length > 80) return 'identifiant manquant ou invalide';
  if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) return 'date de création invalide';
  if (typeof r.updatedAt !== 'string' || Number.isNaN(Date.parse(r.updatedAt))) return 'date de modification invalide';
  const d = r.data;
  if (!d || typeof d !== 'object') return 'données du batch absentes';
  if (typeof d.SOUCHE !== 'string' || !d.SOUCHE) return 'souche absente';
  if (![1, 2, 3].includes(d.PHASE_NUMBER as number)) return 'niveau invalide';
  if (!d.DONNEES_ENVIRONNEMENTALES || typeof d.DONNEES_ENVIRONNEMENTALES !== 'object') return 'relevé environnemental absent';
  if (r.readings !== undefined && !Array.isArray(r.readings)) return 'relevés invalides';
  if (r.events !== undefined && !Array.isArray(r.events)) return 'événements invalides';
  return null;
}

export interface MergeSummary { added: number; merged: number; unchanged: number; invalid: { id: string; reason: string }[]; conflicts: { id: string; notes: string[] }[] }

/**
 * Fusionne des enregistrements externes (sauvegarde, autre compte, instantané) dans la base locale.
 * Jamais d'écrasement : si le batch existe, les deux versions sont fusionnées (union des journaux).
 * Un instantané automatique est pris avant toute modification.
 */
export async function mergeIntoLocal(incoming: unknown[], reason: string): Promise<MergeSummary> {
  const summary: MergeSummary = { added: 0, merged: 0, unchanged: 0, invalid: [], conflicts: [] };
  const toWrite: BatchRecord[] = [];
  const existing = new Map((await dbGetAll()).map((r) => [r.id, r]));
  if (existing.size > 0) await snapshotAdd(`avant ${reason}`, [...existing.values()]);

  for (const raw of incoming) {
    const err = validateRecord(raw);
    if (err) { summary.invalid.push({ id: (raw as { id?: string })?.id ?? '?', reason: err }); continue; }
    const { sync: _s, ...clean } = normalizeRecord(raw as BatchRecord);
    void _s;
    const idx = toWrite.findIndex((r) => r.id === clean.id);
    const current = idx >= 0 ? toWrite[idx] : existing.get(clean.id);
    if (!current) { toWrite.push({ ...clean, sync: { dirty: true, baseRev: null } }); summary.added++; continue; }
    const cur = normalizeRecord(current);
    const m = mergeRecords(cur, clean);
    if (sameContent(m.record, cur)) { summary.unchanged++; continue; }
    const out: BatchRecord = { ...m.record, rev: (current.rev ?? 1) + 1, sync: { ...syncOf(current), dirty: true } };
    if (idx >= 0) toWrite[idx] = out; else toWrite.push(out);
    summary.merged++;
    if (m.notes.length) summary.conflicts.push({ id: out.id, notes: m.notes });
  }
  await dbPutMany(toWrite);
  if (toWrite.length) notifyLocalWrite();
  return summary;
}

export async function importBackup(json: unknown): Promise<MergeSummary> {
  const batches = (json as Partial<BackupFile>)?.batches ?? (Array.isArray(json) ? json : null);
  if (!Array.isArray(batches)) throw new Error('Fichier invalide : aucun batch trouvé.');
  if ((json as Partial<BackupFile>)?.app && (json as Partial<BackupFile>).app !== 'hydroloop-farm-manager') throw new Error('Ce fichier n\'est pas une sauvegarde HydroLoop.');
  return mergeIntoLocal(batches, 'import de sauvegarde');
}

// ─── Instantanés automatiques ────────────────────────────────────────────────

/** Une sauvegarde locale par jour au plus (conservées 7 jours) : filet de sécurité contre une erreur de manipulation. */
export async function ensureDailySnapshot(now: Date = new Date()): Promise<boolean> {
  const all = await dbGetAll();
  if (all.length === 0) return false;
  const last = await snapshotLatestAt();
  if (last && now.getTime() - new Date(last).getTime() < 20 * 3600 * 1000) return false;
  await snapshotAdd('quotidien', all, now);
  return true;
}

export const listSnapshots = snapshotList;

export async function restoreSnapshot(id: number): Promise<MergeSummary> {
  const rows = await snapshotGet(id);
  if (!rows) throw new Error('Instantané introuvable.');
  return mergeIntoLocal(rows, 'restauration d\'un instantané');
}

// ─── Données d'un ancien mode sans compte ────────────────────────────────────

export { legacyBatchCount };

/** Rattache au compte courant les données saisies avant l'activation de l'authentification (action explicite). */
export async function adoptLegacyData(): Promise<MergeSummary> {
  const rows = await legacyBatches();
  const summary = await mergeIntoLocal(rows, 'rattachement des données locales');
  await metaSet('legacyAdoptedAt', new Date().toISOString());
  notifyDataChanged();
  return summary;
}

export const legacyAdoptedAt = () => metaGet<string>('legacyAdoptedAt');

// ─── Historique par souche (contexte IA) ─────────────────────────────────────

export interface StrainHistory {
  count: number;
  commonAlerts: string[];
  lastBatchDate: string | null;
  harvests: { batchId: string; freshWeightKg: number; plants: number; level3Days?: number }[];
}

export async function getStrainHistory(strain: string, excludeId?: string): Promise<StrainHistory> {
  const all = await getBatchesByStrain(strain);
  const batches = excludeId ? all.filter((b) => b.id !== excludeId) : all;
  if (batches.length === 0) return { count: 0, commonAlerts: [], lastBatchDate: null, harvests: [] };

  const t = getActiveThresholds();
  const alertCounts: Record<string, number> = {};
  for (const b of batches) {
    const seen = new Set<string>();
    for (const r of b.readings) for (const a of detectAlerts(r.env, t, r.phase)) seen.add(a.field);
    for (const m of seen) alertCounts[m] = (alertCounts[m] || 0) + 1;
  }
  const threshold = batches.length * 0.5;
  const commonAlerts = Object.entries(alertCounts).filter(([, n]) => n >= threshold).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f);

  const harvests = batches
    .filter((b) => b.harvest)
    .map((b) => {
      const enteredL3 = b.events.find((e) => e.type === 'level_change' && /niveau 3/i.test(e.summary));
      const level3Days = enteredL3 && b.harvest ? Math.max(1, Math.round((new Date(b.harvest.date).getTime() - new Date(enteredL3.at).getTime()) / 86400000)) : undefined;
      return { batchId: b.id, freshWeightKg: b.harvest!.freshWeightKg, plants: b.harvest!.plantsHarvested, level3Days };
    });

  return { count: batches.length, commonAlerts, lastBatchDate: batches[0]?.createdAt ?? null, harvests };
}
