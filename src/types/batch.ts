import { DEFAULT_THRESHOLDS, METRIC_META, describeRange, getActiveThresholds } from '@/lib/thresholds';
import type { MetricKey, Thresholds } from '@/lib/thresholds';

export type PhaseNumber = 1 | 2 | 3;
export type ModuleType = 12 | 24 | 36 | 48;

export const PHASE_LABELS: Record<PhaseNumber, string> = {
  1: 'Croissance',
  2: 'Stretch',
  3: 'Floraison',
};

export const PHASE_COLORS: Record<PhaseNumber, string> = {
  1: 'bg-blue-100 text-blue-800',
  2: 'bg-amber-100 text-amber-800',
  3: 'bg-purple-100 text-purple-800',
};

/** Valeurs par défaut des durées cibles par niveau (les valeurs effectives viennent des réglages). */
export const DEFAULT_LEVEL_TARGET_DAYS: Record<PhaseNumber, number> = { ...DEFAULT_THRESHOLDS.levelTargetDays };

export interface EnvironmentalData {
  temperature_air_jour: number;
  temperature_air_nuit: number;
  humidite_relative: number;
  pH: number;
  EC: number;
  temperature_solution: number;
  debit_NFT: number;
  oxygene_dissous: number;
  PPFD: number;
  photopériode: string;
}

export interface BatchFormData {
  BATCH_ID: string;
  SOUCHE: string;
  PHASE_NUMBER: PhaseNumber;
  PHASE_DAY: number;
  MODULE_TYPE: ModuleType;
  /** Identifiant physique du module A-Frame (ex : A-03). Optionnel. */
  MODULE_ID?: string;
  OPERATEUR?: string;
  DATE_SEMIS: string;
  DONNEES_ENVIRONNEMENTALES: EnvironmentalData;
  HISTORIQUE_TAILLES: string;
  DERNIERS_RELEVES_RACINAIRES: string;
  notes?: string;
}

export type BatchStatus = 'active' | 'harvested';

export interface Reading {
  id: string;
  at: string;
  phase: PhaseNumber;
  env: EnvironmentalData;
  operator?: string;
  note?: string;
}

export type BatchEventType =
  | 'created'
  | 'reading'
  | 'level_change'
  | 'pruning'
  | 'root_check'
  | 'treatment'
  | 'note'
  | 'edit'
  | 'report'
  | 'harvest'
  | 'merge';

export const EVENT_LABELS: Record<BatchEventType, string> = {
  created: 'Création du batch',
  reading: 'Relevé environnemental',
  level_change: 'Changement de niveau',
  pruning: 'Taille',
  root_check: 'Contrôle racinaire',
  treatment: 'Traitement',
  note: 'Note',
  edit: 'Modification',
  report: 'Rapport',
  harvest: 'Récolte',
  merge: 'Fusion de synchronisation',
};

export interface BatchEvent {
  id: string;
  at: string;
  type: BatchEventType;
  summary: string;
  operator?: string;
}

export interface HarvestData {
  date: string;
  plantsHarvested: number;
  freshWeightKg: number;
  operator: string;
  freezeTempC?: number;
  freezeDelayMin?: number;
  destination?: string;
  lotNumber?: string;
  notes?: string;
}

export type ReportSource = 'ai' | 'fallback';

/** État de synchronisation d'un enregistrement local (jamais envoyé tel quel au cloud). */
export interface SyncInfo {
  /** Modifications locales pas encore envoyées au cloud. */
  dirty: boolean;
  /** Révision cloud connue lors de la dernière synchro ; null = jamais envoyé. */
  baseRev: number | null;
  lastSyncedAt?: string;
}

export interface BatchRecord {
  id: string;
  data: BatchFormData;
  report?: string;
  reportSource?: ReportSource;
  reportAt?: string;
  /** Empreinte des données ayant servi au dernier rapport (évite de régénérer pour rien). */
  reportInputHash?: string;
  createdAt: string;
  updatedAt: string;
  // ── Suivi de culture (v2) — optionnels pour rester compatible avec les anciens enregistrements
  status?: BatchStatus;
  /** Date d'entrée dans le niveau actuel ; le jour de phase en est déduit. */
  phaseStartedAt?: string;
  levelTargetDays?: Record<PhaseNumber, number>;
  readings?: Reading[];
  events?: BatchEvent[];
  harvest?: HarvestData;
  /** Suppression logique, propagée par la synchronisation cloud. */
  deletedAt?: string;
  // ── Synchronisation (v3)
  /** Compteur de modifications locales. */
  rev?: number;
  sync?: SyncInfo;
}

/** Enregistrement normalisé : tous les champs de suivi sont présents. */
export type TrackedBatch = BatchRecord &
  Required<Pick<BatchRecord, 'status' | 'phaseStartedAt' | 'levelTargetDays' | 'readings' | 'events' | 'rev'>>;

export interface EnvAlert {
  field: MetricKey;
  label: string;
  value: number;
  message: string;
  severity: 'warning' | 'danger';
}

/**
 * Alertes sur un relevé, selon les seuils configurés.
 * Si `phase` est fourni et que l'EC respecte la plage générale, elle est comparée à la plage cible du niveau.
 */
export function detectAlerts(env: EnvironmentalData, t: Thresholds = getActiveThresholds(), phase?: PhaseNumber): EnvAlert[] {
  const alerts: EnvAlert[] = [];
  for (const key of Object.keys(t.metrics) as MetricKey[]) {
    const rule = t.metrics[key];
    if (!rule.enabled) continue;
    const value = Number(env[key]);
    if (!Number.isFinite(value)) continue;
    const meta = METRIC_META[key];
    const unit = meta.unit ? ` ${meta.unit}` : '';
    if (rule.min !== undefined && value < rule.min) {
      alerts.push({ field: key, label: meta.label, value, severity: rule.severity, message: `${meta.label} trop bas (< ${rule.min}${unit}) — plage configurée ${describeRange(key, t)}` });
    } else if (rule.max !== undefined && value > rule.max) {
      alerts.push({ field: key, label: meta.label, value, severity: rule.severity, message: `${meta.label} trop élevé (> ${rule.max}${unit}) — plage configurée ${describeRange(key, t)}` });
    }
  }
  if (phase && !alerts.some((a) => a.field === 'EC') && t.metrics.EC.enabled) {
    const [lo, hi] = t.ecByLevel[phase];
    const ec = Number(env.EC);
    if (Number.isFinite(ec) && (ec < lo || ec > hi)) {
      alerts.push({ field: 'EC', label: 'EC', value: ec, severity: 'warning', message: `EC hors plage cible du niveau ${phase} (${lo}–${hi} mS/cm)` });
    }
  }
  return alerts;
}
