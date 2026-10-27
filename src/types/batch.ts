export type PhaseNumber = 1 | 2 | 3;
/** Nombre total de plants du module (12, 24, 36, 48, 72, 96…). */
export type ModuleType = number;

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

/** Plage d'EC (mS/cm) par stade, selon le dossier technique du brevet. */
export const EC_RANGE_BY_PHASE: Record<PhaseNumber, { min: number; max: number }> = {
  1: { min: 1.2, max: 1.6 },
  2: { min: 1.8, max: 2.2 },
  3: { min: 2.4, max: 2.8 },
};

/** Relevé d'eau daté (journal d'eau de culture). */
export interface WaterReading {
  id: string;
  /** Date-heure ISO du relevé. */
  at: string;
  pH?: number;
  EC?: number;
  temperature_solution?: number;
  oxygene_dissous?: number;
  debit_NFT?: number;
  /** Niveau du réservoir en % (0–100). */
  niveau_reservoir_pct?: number;
  /** Action menée : correction pH, ajout nutriments, vidange, appoint… */
  action?: string;
  notes?: string;
}

/** Récolte enregistrée à la fin du cycle. */
export interface HarvestRecord {
  /** Date ISO de la récolte. */
  date: string;
  plants: number;
  /** Poids frais total, en grammes. */
  freshWeightG?: number;
  /** Poids sec total, en grammes. */
  dryWeightG?: number;
  notes?: string;
}

export interface BatchFormData {
  BATCH_ID: string;
  SOUCHE: string;
  /** Variété du catalogue (optionnel : les anciens lots n'en ont pas). */
  VARIETY_ID?: string;
  /** Module physique où la cohorte est installée (optionnel). */
  MODULE_ID?: string;
  /** Niveau actuel dans le module : 1 haut, 2 milieu, 3 bas. */
  LEVEL?: PhaseNumber;
  /** Copie du cycle de la variété à la création du lot (nurserie / total, jours). */
  CYCLE?: { nurseryDays: number; totalDays: number };
  /** Durée de la phase de floraison de la variété, en jours (63 par défaut pour les anciens lots). */
  FLOWERING_DAYS?: number;
  PHASE_NUMBER: PhaseNumber;
  PHASE_DAY: number;
  MODULE_TYPE: ModuleType;
  DATE_SEMIS: string;
  DONNEES_ENVIRONNEMENTALES: EnvironmentalData;
  HISTORIQUE_TAILLES: string;
  DERNIERS_RELEVES_RACINAIRES: string;
  notes?: string;
  /** Journal d'eau : relevés successifs, du plus ancien au plus récent. */
  readings?: WaterReading[];
  harvest?: HarvestRecord;
}

export interface BatchRecord {
  id: string;
  data: BatchFormData;
  report?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnvAlert {
  field: string;
  label: string;
  value: number;
  message: string;
  severity: 'warning' | 'danger';
}

export function detectAlerts(env: EnvironmentalData, phase?: PhaseNumber): EnvAlert[] {
  const alerts: EnvAlert[] = [];

  if (env.pH < 5.5)
    alerts.push({ field: 'pH', label: 'pH', value: env.pH, message: `pH trop bas (< 5.5) — blocage nutritif`, severity: 'danger' });
  if (env.pH > 6.5)
    alerts.push({ field: 'pH', label: 'pH', value: env.pH, message: `pH trop élevé (> 6.5) — blocage nutritif`, severity: 'danger' });

  if (env.oxygene_dissous < 6)
    alerts.push({ field: 'oxygene_dissous', label: 'O₂ dissous', value: env.oxygene_dissous, message: `O₂ dissous insuffisant (< 6 mg/L) — risque d'anoxie`, severity: 'danger' });

  if (env.temperature_solution > 22)
    alerts.push({ field: 'temperature_solution', label: 'Temp. solution', value: env.temperature_solution, message: `Température solution trop haute (> 22°C) — risque de pathogènes`, severity: 'warning' });

  const ecRange = phase ? EC_RANGE_BY_PHASE[phase] : undefined;
  if (ecRange) {
    if (env.EC < ecRange.min || env.EC > ecRange.max)
      alerts.push({
        field: 'EC', label: 'EC', value: env.EC, severity: 'warning',
        message: `EC hors plage du stade N${phase} (${ecRange.min}–${ecRange.max} mS/cm)`,
      });
  } else if (env.EC < 0.8 || env.EC > 3.0) {
    alerts.push({ field: 'EC', label: 'EC', value: env.EC, message: `EC hors plage optimale (0.8–3.0 mS/cm)`, severity: 'warning' });
  }

  if (env.debit_NFT < 0.5)
    alerts.push({ field: 'debit_NFT', label: 'Débit NFT', value: env.debit_NFT, message: `Débit NFT faible (< 0.5 L/min) — risque de zones sèches`, severity: 'warning' });

  return alerts;
}
