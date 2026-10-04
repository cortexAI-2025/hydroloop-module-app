import type {
  BatchEvent,
  BatchEventType,
  BatchRecord,
  EnvironmentalData,
  HarvestData,
  PhaseNumber,
  Reading,
  TrackedBatch,
} from '@/types/batch';
import { DEFAULT_LEVEL_TARGET_DAYS, PHASE_LABELS, detectAlerts } from '@/types/batch';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Relevé considéré « en retard » au-delà de ce délai. */
export const READING_DUE_HOURS = 24;

export function uid(prefix = ''): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rnd}`;
}

/**
 * Complète un enregistrement (ancien ou partiel) avec les champs de suivi.
 * Pure et idempotente : un enregistrement déjà normalisé ressort identique.
 */
export function normalizeRecord(r: BatchRecord): TrackedBatch {
  const phaseStartedAt =
    r.phaseStartedAt ??
    new Date(new Date(r.createdAt).getTime() - Math.max(0, (r.data.PHASE_DAY || 1) - 1) * DAY_MS).toISOString();

  const readings: Reading[] =
    r.readings && r.readings.length > 0
      ? r.readings
      : [
          {
            id: `r-${r.id}-0`,
            at: r.createdAt,
            phase: r.data.PHASE_NUMBER,
            env: r.data.DONNEES_ENVIRONNEMENTALES,
            operator: r.data.OPERATEUR,
          },
        ];

  const events: BatchEvent[] =
    r.events && r.events.length > 0
      ? r.events
      : [
          {
            id: `e-${r.id}-0`,
            at: r.createdAt,
            type: 'created',
            summary: `Batch créé — ${PHASE_LABELS[r.data.PHASE_NUMBER]}, ${r.data.MODULE_TYPE} plants`,
            operator: r.data.OPERATEUR,
          },
        ];

  return {
    ...r,
    status: r.status ?? (r.harvest ? 'harvested' : 'active'),
    phaseStartedAt,
    levelTargetDays: { ...DEFAULT_LEVEL_TARGET_DAYS, ...r.levelTargetDays },
    readings,
    events,
  };
}

/** Jour courant dans le niveau (1 = jour d'entrée). Figé à la date de récolte. */
export function currentPhaseDay(r: TrackedBatch, now: Date = new Date()): number {
  const end = r.status === 'harvested' && r.harvest ? new Date(r.harvest.date) : now;
  const start = startOfDay(new Date(r.phaseStartedAt));
  return Math.max(1, Math.floor((startOfDay(end).getTime() - start.getTime()) / DAY_MS) + 1);
}

/** Jours depuis le semis. */
export function daysSinceSowing(r: BatchRecord, now: Date = new Date()): number {
  const sow = startOfDay(new Date(r.data.DATE_SEMIS));
  return Math.max(0, Math.floor((startOfDay(now).getTime() - sow.getTime()) / DAY_MS));
}

/** Données du formulaire avec le jour de phase recalculé à aujourd'hui. */
export function withLiveDay(r: TrackedBatch, now: Date = new Date()): TrackedBatch {
  const day = currentPhaseDay(r, now);
  if (day === r.data.PHASE_DAY) return r;
  return { ...r, data: { ...r.data, PHASE_DAY: day } };
}

export function latestReading(r: TrackedBatch): Reading {
  return [...r.readings].sort((a, b) => b.at.localeCompare(a.at))[0];
}

export function hoursSinceLastReading(r: TrackedBatch, now: Date = new Date()): number {
  return (now.getTime() - new Date(latestReading(r).at).getTime()) / (60 * 60 * 1000);
}

export function isReadingDue(r: TrackedBatch, now: Date = new Date()): boolean {
  return r.status === 'active' && hoursSinceLastReading(r, now) >= READING_DUE_HOURS;
}

export interface LevelProgress {
  day: number;
  target: number;
  pct: number;
  /** Le batch a atteint la durée cible du niveau. */
  ready: boolean;
  nextAction: string;
}

export function levelProgress(r: TrackedBatch, now: Date = new Date()): LevelProgress {
  const phase = r.data.PHASE_NUMBER;
  const day = currentPhaseDay(r, now);
  const target = r.levelTargetDays[phase];
  const ready = day >= target;
  let nextAction: string;
  if (r.status === 'harvested') nextAction = 'Récolté';
  else if (phase < 3) {
    const next = (phase + 1) as PhaseNumber;
    nextAction = ready
      ? `Prêt à monter au niveau ${next} (${PHASE_LABELS[next]})`
      : `Niveau ${next} dans ${target - day} j`;
  } else {
    nextAction = ready ? 'Fenêtre de récolte atteinte' : `Récolte estimée dans ${target - day} j`;
  }
  return { day, target, pct: Math.min(100, Math.round((day / target) * 100)), ready, nextAction };
}

function event(type: BatchEventType, summary: string, at: string, operator?: string): BatchEvent {
  return { id: uid('e-'), at, type, summary, operator };
}

export function addEvent(
  r: TrackedBatch,
  type: BatchEventType,
  summary: string,
  operator?: string,
  at: string = new Date().toISOString(),
): TrackedBatch {
  return { ...r, events: [...r.events, event(type, summary, at, operator)], updatedAt: at };
}

/** Ajoute un relevé ; le dernier relevé devient la valeur courante du batch. */
export function addReading(
  r: TrackedBatch,
  env: EnvironmentalData,
  opts: { operator?: string; note?: string; at?: string } = {},
): TrackedBatch {
  const at = opts.at ?? new Date().toISOString();
  const reading: Reading = { id: uid('r-'), at, phase: r.data.PHASE_NUMBER, env, operator: opts.operator, note: opts.note };
  const readings = [...r.readings, reading].sort((a, b) => a.at.localeCompare(b.at));
  const isLatest = readings[readings.length - 1].id === reading.id;
  const alerts = detectAlerts(env);
  const summary = `pH ${env.pH} · EC ${env.EC} · O₂ ${env.oxygene_dissous} mg/L · T° sol. ${env.temperature_solution}°C${
    alerts.length ? ` — ${alerts.length} alerte${alerts.length > 1 ? 's' : ''}` : ''
  }${opts.note ? ` — ${opts.note}` : ''}`;
  const next: TrackedBatch = {
    ...r,
    readings,
    data: isLatest ? { ...r.data, DONNEES_ENVIRONNEMENTALES: env } : r.data,
  };
  return addEvent(next, 'reading', summary, opts.operator, at);
}

/** Fait monter la cohorte au niveau suivant (1 → 2 → 3). */
export function advanceLevel(r: TrackedBatch, operator?: string, at: string = new Date().toISOString()): TrackedBatch {
  if (r.status !== 'active') throw new Error('Batch déjà récolté.');
  if (r.data.PHASE_NUMBER >= 3) throw new Error('Le niveau 3 est le dernier : enregistrez la récolte.');
  const from = r.data.PHASE_NUMBER;
  const to = (from + 1) as PhaseNumber;
  const dayLeft = currentPhaseDay(r, new Date(at));
  const next: TrackedBatch = {
    ...r,
    phaseStartedAt: at,
    data: {
      ...r.data,
      PHASE_NUMBER: to,
      PHASE_DAY: 1,
      DONNEES_ENVIRONNEMENTALES: {
        ...r.data.DONNEES_ENVIRONNEMENTALES,
        photopériode: to === 3 ? '12/12' : r.data.DONNEES_ENVIRONNEMENTALES.photopériode,
      },
    },
  };
  return addEvent(
    next,
    'level_change',
    `Niveau ${from} (${PHASE_LABELS[from]}) → niveau ${to} (${PHASE_LABELS[to]}) après ${dayLeft} j`,
    operator,
    at,
  );
}

export function recordHarvest(r: TrackedBatch, h: HarvestData): TrackedBatch {
  if (r.status === 'harvested') throw new Error('Récolte déjà enregistrée.');
  const at = new Date().toISOString();
  const summary = `${h.plantsHarvested} plants · ${h.freshWeightKg} kg frais${
    h.freezeTempC !== undefined ? ` · congelé à ${h.freezeTempC}°C` : ''
  }${h.lotNumber ? ` · lot ${h.lotNumber}` : ''}${h.destination ? ` → ${h.destination}` : ''}`;
  return addEvent({ ...r, status: 'harvested', harvest: h }, 'harvest', summary, h.operator, at);
}

// ─── Statistiques des relevés ────────────────────────────────────────────────

export const NUMERIC_ENV_KEYS = [
  'pH',
  'EC',
  'oxygene_dissous',
  'temperature_solution',
  'temperature_air_jour',
  'temperature_air_nuit',
  'humidite_relative',
  'debit_NFT',
  'PPFD',
] as const;
export type NumericEnvKey = (typeof NUMERIC_ENV_KEYS)[number];

export interface MetricStats {
  min: number;
  max: number;
  avg: number;
  first: number;
  last: number;
  count: number;
}

export function readingStats(readings: Reading[]): Partial<Record<NumericEnvKey, MetricStats>> {
  const sorted = [...readings].sort((a, b) => a.at.localeCompare(b.at));
  const out: Partial<Record<NumericEnvKey, MetricStats>> = {};
  for (const k of NUMERIC_ENV_KEYS) {
    const vals = sorted.map((r) => Number(r.env[k])).filter((v) => Number.isFinite(v));
    if (vals.length === 0) continue;
    const sum = vals.reduce((s, v) => s + v, 0);
    out[k] = {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: Math.round((sum / vals.length) * 100) / 100,
      first: vals[0],
      last: vals[vals.length - 1],
      count: vals.length,
    };
  }
  return out;
}

/** Pourcentage des relevés comportant au moins une alerte. */
export function alertRate(readings: Reading[]): number {
  if (readings.length === 0) return 0;
  const n = readings.filter((r) => detectAlerts(r.env).length > 0).length;
  return Math.round((n / readings.length) * 100);
}

// ─── Fusion (synchronisation / import) ───────────────────────────────────────

/** Garde la version la plus récente ; à égalité, la version locale. */
export function pickNewer(local: BatchRecord | undefined, remote: BatchRecord): BatchRecord {
  if (!local) return remote;
  return new Date(remote.updatedAt).getTime() > new Date(local.updatedAt).getTime() ? remote : local;
}

// ─── Export CSV ──────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function readingsToCsv(batches: TrackedBatch[]): string {
  const header = [
    'batch_id', 'souche', 'module_id', 'niveau', 'date_releve', 'operateur',
    ...NUMERIC_ENV_KEYS, 'photoperiode', 'alertes', 'note',
  ];
  const rows = [header.join(',')];
  for (const b of batches) {
    for (const r of [...b.readings].sort((a, c) => a.at.localeCompare(c.at))) {
      rows.push(
        [
          b.data.BATCH_ID, b.data.SOUCHE, b.data.MODULE_ID ?? '', r.phase, r.at, r.operator ?? '',
          ...NUMERIC_ENV_KEYS.map((k) => r.env[k]),
          r.env.photopériode,
          detectAlerts(r.env).map((a) => a.label).join(' | '),
          r.note ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return rows.join('\n');
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
