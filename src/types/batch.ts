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

/** Durée cible par niveau A-Frame (jours) — rotation HydroLoop de 20 à 27 jours. */
export const DEFAULT_LEVEL_TARGET_DAYS: Record<PhaseNumber, number> = { 1: 21, 2: 21, 3: 27 };

/** Plage EC recommandée par niveau (mS/cm), selon le dossier technique HydroLoop. */
export const LEVEL_EC_RANGE: Record<PhaseNumber, [number, number]> = {
  1: [1.2, 1.6],
  2: [1.8, 2.2],
  3: [2.4, 2.8],
};

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
  | 'harvest';

export const EVENT_LABELS: Record<BatchEventType, string> = {
  created: 'Création du batch',
  reading: 'Relevé environnemental',
  level_change: 'Changement de niveau',
  pruning: 'Taille',
  root_check: 'Contrôle racinaire',
  treatment: 'Traitement',
  note: 'Note',
  edit: 'Modification',
  report: 'Rapport IA',
  harvest: 'Récolte',
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

export interface BatchRecord {
  id: string;
  data: BatchFormData;
  report?: string;
  reportSource?: ReportSource;
  reportAt?: string;
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
}

/** Enregistrement normalisé : tous les champs de suivi sont présents. */
export type TrackedBatch = BatchRecord &
  Required<Pick<BatchRecord, 'status' | 'phaseStartedAt' | 'levelTargetDays' | 'readings' | 'events'>>;

export interface EnvAlert {
  field: string;
  label: string;
  value: number;
  message: string;
  severity: 'warning' | 'danger';
}

export function detectAlerts(env: EnvironmentalData): EnvAlert[] {
  const alerts: EnvAlert[] = [];

  if (env.pH < 5.5)
    alerts.push({ field: 'pH', label: 'pH', value: env.pH, message: `pH trop bas (< 5.5) — blocage nutritif`, severity: 'danger' });
  if (env.pH > 6.5)
    alerts.push({ field: 'pH', label: 'pH', value: env.pH, message: `pH trop élevé (> 6.5) — blocage nutritif`, severity: 'danger' });

  if (env.oxygene_dissous < 6)
    alerts.push({ field: 'oxygene_dissous', label: 'O₂ dissous', value: env.oxygene_dissous, message: `O₂ dissous insuffisant (< 6 mg/L) — risque d'anoxie`, severity: 'danger' });

  if (env.temperature_solution > 22)
    alerts.push({ field: 'temperature_solution', label: 'Temp. solution', value: env.temperature_solution, message: `Température solution trop haute (> 22°C) — risque de pathogènes`, severity: 'warning' });

  if (env.EC < 0.8 || env.EC > 3.0)
    alerts.push({ field: 'EC', label: 'EC', value: env.EC, message: `EC hors plage optimale (0.8–3.0 mS/cm)`, severity: 'warning' });

  if (env.debit_NFT < 0.5)
    alerts.push({ field: 'debit_NFT', label: 'Débit NFT', value: env.debit_NFT, message: `Débit NFT faible (< 0.5 L/min) — risque de zones sèches`, severity: 'warning' });

  return alerts;
}
