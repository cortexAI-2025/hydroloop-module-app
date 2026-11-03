import type { EnvironmentalData, PhaseNumber } from '@/types/batch';

/**
 * Seuils agronomiques de HydroLoop Farm.
 *
 * Tous les seuils sont configurables (page « Réglages ») et stockés par utilisateur.
 * Les valeurs par défaut ci-dessous sont des **repères d'exploitation** — ils ne remplacent
 * ni le protocole de culture de l'exploitant, ni les recommandations du fournisseur de génétique.
 * Documentation complète : docs/SEUILS.md
 */

export type MetricKey =
  | 'pH'
  | 'EC'
  | 'oxygene_dissous'
  | 'temperature_solution'
  | 'debit_NFT'
  | 'temperature_air_jour'
  | 'temperature_air_nuit'
  | 'humidite_relative'
  | 'PPFD';

export const METRIC_KEYS: MetricKey[] = [
  'pH', 'EC', 'oxygene_dissous', 'temperature_solution', 'debit_NFT',
  'temperature_air_jour', 'temperature_air_nuit', 'humidite_relative', 'PPFD',
];

export type Severity = 'warning' | 'danger';

export interface MetricRule {
  /** Borne basse ; absente = pas de limite basse. */
  min?: number;
  /** Borne haute ; absente = pas de limite haute. */
  max?: number;
  /** Gravité de l'alerte en cas de dépassement. */
  severity: Severity;
  /** Une alerte est émise si la valeur sort de [min ; max]. Désactivée si false. */
  enabled: boolean;
}

export interface Thresholds {
  version: 1;
  metrics: Record<MetricKey, MetricRule>;
  /** Plage d'EC cible par niveau du module (mS/cm) — indicative. */
  ecByLevel: Record<PhaseNumber, [number, number]>;
  /** Un relevé est « en retard » au-delà de ce délai (heures). */
  readingDueHours: number;
  /** Durée cible par niveau (jours) appliquée aux nouveaux batches. */
  levelTargetDays: Record<PhaseNumber, number>;
  /** Plage de durée du niveau 3 utilisée pour la fourchette de récolte (jours). */
  harvestWindow: { minDays: number; maxDays: number };
  /** Règles de détection de dérive (analyse de l'historique). */
  trend: {
    /** Nombre minimal de relevés pour parler de tendance. */
    minReadings: number;
    /** Durée minimale couverte par les relevés (heures). */
    minSpanHours: number;
    /** Dérive journalière au-delà de laquelle une tendance est signalée. */
    slopePerDay: Partial<Record<MetricKey, number>>;
    /** Écart entre deux relevés consécutifs au-delà duquel un saut est signalé. */
    jump: Partial<Record<MetricKey, number>>;
    /** Nombre de relevés consécutifs hors plage pour parler de problème persistant. */
    persistentCount: number;
  };
}

export const METRIC_META: Record<MetricKey, { label: string; unit: string; decimals: number; rationale: string }> = {
  pH: { label: 'pH solution', unit: '', decimals: 1, rationale: 'Hors de 5,5–6,5 l\'absorption de plusieurs nutriments chute (blocage nutritif). Plage courante en NFT.' },
  EC: { label: 'EC', unit: 'mS/cm', decimals: 1, rationale: 'Plage générale de sécurité. La plage cible par niveau (HydroLoop) est plus étroite — voir ci-dessous.' },
  oxygene_dissous: { label: 'O₂ dissous', unit: 'mg/L', decimals: 1, rationale: 'Sous ~6 mg/L le risque d\'asphyxie racinaire et de pathogènes augmente.' },
  temperature_solution: { label: 'T° solution', unit: '°C', decimals: 1, rationale: 'Au-delà de ~22 °C l\'oxygène se dissout moins et les pathogènes racinaires (Pythium) progressent.' },
  debit_NFT: { label: 'Débit NFT', unit: 'L/min', decimals: 1, rationale: 'Un débit trop faible laisse des zones sèches dans la gouttière.' },
  temperature_air_jour: { label: 'T° air jour', unit: '°C', decimals: 1, rationale: 'Plage large d\'avertissement ; l\'optimum dépend de la génétique.' },
  temperature_air_nuit: { label: 'T° air nuit', unit: '°C', decimals: 1, rationale: 'Plage large d\'avertissement ; l\'optimum dépend de la génétique.' },
  humidite_relative: { label: 'Humidité relative', unit: '%', decimals: 0, rationale: 'Trop haute : risque fongique ; trop basse : stress hydrique foliaire.' },
  PPFD: { label: 'PPFD', unit: 'µmol/m²/s', decimals: 0, rationale: 'Aucune alerte par défaut : dépend du niveau, de la génétique et de la lumière naturelle.' },
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  version: 1,
  metrics: {
    pH: { min: 5.5, max: 6.5, severity: 'danger', enabled: true },
    EC: { min: 0.8, max: 3.0, severity: 'warning', enabled: true },
    oxygene_dissous: { min: 6, severity: 'danger', enabled: true },
    temperature_solution: { max: 22, severity: 'warning', enabled: true },
    debit_NFT: { min: 0.5, severity: 'warning', enabled: true },
    temperature_air_jour: { min: 18, max: 30, severity: 'warning', enabled: true },
    temperature_air_nuit: { min: 12, max: 24, severity: 'warning', enabled: true },
    humidite_relative: { min: 35, max: 75, severity: 'warning', enabled: true },
    PPFD: { severity: 'warning', enabled: false },
  },
  // Dossier technique HydroLoop : EC 1,2–1,6 (N1), 1,8–2,2 (N2), 2,4–2,8 (N3).
  ecByLevel: { 1: [1.2, 1.6], 2: [1.8, 2.2], 3: [2.4, 2.8] },
  readingDueHours: 24,
  // Rotation HydroLoop : 20 à 27 jours par niveau.
  levelTargetDays: { 1: 21, 2: 21, 3: 27 },
  harvestWindow: { minDays: 20, maxDays: 27 },
  trend: {
    minReadings: 4,
    minSpanHours: 24,
    slopePerDay: { pH: 0.3, EC: 0.3, oxygene_dissous: -0.5, temperature_solution: 1 },
    jump: { pH: 0.6, EC: 0.7, oxygene_dissous: 2.5, temperature_solution: 3 },
    persistentCount: 3,
  },
};

let active: Thresholds = DEFAULT_THRESHOLDS;

export const getActiveThresholds = (): Thresholds => active;
export const setActiveThresholds = (t: Thresholds): void => { active = t; };
export const resetActiveThresholds = (): void => { active = DEFAULT_THRESHOLDS; };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Fusionne une saisie partielle avec les valeurs par défaut et la valide.
 * Retourne les erreurs en clair (français) ; `value` est toujours utilisable.
 */
export function normalizeThresholds(input: unknown): { value: Thresholds; errors: string[] } {
  const errors: string[] = [];
  const src = (input && typeof input === 'object' ? input : {}) as Partial<Thresholds>;
  const base = DEFAULT_THRESHOLDS;
  const out: Thresholds = JSON.parse(JSON.stringify(base));

  for (const k of METRIC_KEYS) {
    const r = src.metrics?.[k];
    if (!r || typeof r !== 'object') continue;
    const d = base.metrics[k];
    const rule: MetricRule = { severity: r.severity === 'danger' || r.severity === 'warning' ? r.severity : d.severity, enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled };
    if (r.min !== undefined && r.min !== null) { if (isNum(r.min)) rule.min = r.min; else errors.push(`${METRIC_META[k].label} : minimum invalide.`); }
    if (r.max !== undefined && r.max !== null) { if (isNum(r.max)) rule.max = r.max; else errors.push(`${METRIC_META[k].label} : maximum invalide.`); }
    if (rule.min !== undefined && rule.max !== undefined && rule.min >= rule.max) {
      errors.push(`${METRIC_META[k].label} : le minimum doit être inférieur au maximum.`);
      rule.min = d.min; rule.max = d.max;
    }
    out.metrics[k] = rule;
  }

  for (const lvl of [1, 2, 3] as PhaseNumber[]) {
    const ec = src.ecByLevel?.[lvl];
    if (ec) {
      if (Array.isArray(ec) && isNum(ec[0]) && isNum(ec[1]) && ec[0] < ec[1] && ec[0] >= 0) out.ecByLevel[lvl] = [ec[0], ec[1]];
      else errors.push(`EC cible du niveau ${lvl} invalide.`);
    }
    const days = src.levelTargetDays?.[lvl];
    if (days !== undefined) {
      if (isNum(days) && days >= 5 && days <= 90) out.levelTargetDays[lvl] = Math.round(days);
      else errors.push(`Durée cible du niveau ${lvl} : entre 5 et 90 jours.`);
    }
  }

  if (src.readingDueHours !== undefined) {
    if (isNum(src.readingDueHours) && src.readingDueHours >= 1 && src.readingDueHours <= 168) out.readingDueHours = src.readingDueHours;
    else errors.push('Délai de relevé : entre 1 et 168 heures.');
  }

  const hw = src.harvestWindow;
  if (hw) {
    if (isNum(hw.minDays) && isNum(hw.maxDays) && hw.minDays >= 5 && hw.minDays < hw.maxDays && hw.maxDays <= 120) out.harvestWindow = { minDays: Math.round(hw.minDays), maxDays: Math.round(hw.maxDays) };
    else errors.push('Fenêtre de récolte : minimum ≥ 5 j, inférieur au maximum (≤ 120 j).');
  }

  const tr = src.trend;
  if (tr) {
    if (tr.minReadings !== undefined) { if (isNum(tr.minReadings) && tr.minReadings >= 3 && tr.minReadings <= 50) out.trend.minReadings = Math.round(tr.minReadings); else errors.push('Tendance : au moins 3 relevés.'); }
    if (tr.minSpanHours !== undefined) { if (isNum(tr.minSpanHours) && tr.minSpanHours >= 1) out.trend.minSpanHours = tr.minSpanHours; else errors.push('Tendance : durée minimale invalide.'); }
    if (tr.persistentCount !== undefined) { if (isNum(tr.persistentCount) && tr.persistentCount >= 2) out.trend.persistentCount = Math.round(tr.persistentCount); else errors.push('Problème persistant : au moins 2 relevés.'); }
    for (const [group, key] of [['slopePerDay', 'slopePerDay'], ['jump', 'jump']] as const) {
      const g = tr[group];
      if (!g) continue;
      for (const m of METRIC_KEYS) {
        const v = g[m];
        if (v === undefined) continue;
        if (isNum(v)) out.trend[key][m] = v; else errors.push(`Tendance (${group}) ${METRIC_META[m].label} invalide.`);
      }
    }
  }

  return { value: out, errors };
}

/** La valeur sort-elle de la plage configurée ? (false si la règle est désactivée ou la valeur invalide) */
export function isOutOfRange(metric: MetricKey, value: number, t: Thresholds = active): boolean {
  const r = t.metrics[metric];
  if (!r.enabled || !Number.isFinite(value)) return false;
  return (r.min !== undefined && value < r.min) || (r.max !== undefined && value > r.max);
}

/** Plage [min ; max] de la règle, ou null si désactivée / sans borne. */
export function rangeOf(metric: MetricKey, t: Thresholds = active): [number, number] | null {
  const r = t.metrics[metric];
  if (!r.enabled || (r.min === undefined && r.max === undefined)) return null;
  return [r.min ?? -Infinity, r.max ?? Infinity];
}

/** Texte lisible de la plage : « 5.5–6.5 », « ≥ 6 », « ≤ 22 ». */
export function describeRange(metric: MetricKey, t: Thresholds = active): string {
  const r = t.metrics[metric];
  const d = METRIC_META[metric].decimals;
  const f = (n: number) => n.toFixed(d).replace(/\.0+$/, '');
  if (r.min !== undefined && r.max !== undefined) return `${f(r.min)}–${f(r.max)}`;
  if (r.min !== undefined) return `≥ ${f(r.min)}`;
  if (r.max !== undefined) return `≤ ${f(r.max)}`;
  return '—';
}

export function metricValue(env: EnvironmentalData, m: MetricKey): number {
  return Number(env[m]);
}
