/**
 * Modèle de cycle HydroLoop (fonctions pures, sans dépendance).
 *
 * Règles (Ahmed) :
 *  - chaque variété a sa propre durée totale seed-to-yield (T) et sa nurserie (n, 12 j par défaut) ;
 *  - après la nurserie, le temps restant (T − n) est partagé en 3 phases égales :
 *    N1 croissance, N2 stretch, N3 floraison ;
 *  - la nurserie tourne en parallèle de la cohorte précédente ;
 *  - intégration au module au jour n + 1 du cycle (n = 12 → « J+13 ») ;
 *  - en régime établi, une récolte tous les P = (T − n) / 3 jours.
 *
 * Convention : le jour du semis est le jour 1 du cycle.
 */

export type CycleStage = 'nursery' | 1 | 2 | 3 | 'done';

export interface CycleSpec {
  /** Durée de la nurserie, en jours (germination → plantule). */
  nurseryDays: number;
  /** Durée totale seed-to-yield, en jours. */
  totalDays: number;
}

export const DEFAULT_NURSERY_DAYS = 12;

export interface CyclePlan {
  nurseryDays: number;
  totalDays: number;
  /** Durée d'une phase (N1, N2, N3), éventuellement non entière. */
  phaseDays: number;
  /** Jour du cycle où la plante entre dans le module (1-indexé). */
  integrationDay: number;
  /** Premier jour de chaque phase (1-indexé), clés 1..3. */
  phaseStartDay: { 1: number; 2: number; 3: number };
  /** Intervalle entre deux récoltes en régime établi (= phaseDays). */
  harvestIntervalDays: number;
  harvestsPerYear: number;
}

export function validateCycle(spec: CycleSpec): string | null {
  if (!Number.isFinite(spec.nurseryDays) || spec.nurseryDays < 0) return 'Nurserie invalide';
  if (!Number.isFinite(spec.totalDays) || spec.totalDays <= 0) return 'Durée totale invalide';
  if (spec.totalDays <= spec.nurseryDays) return 'La durée totale doit dépasser la nurserie';
  return null;
}

export function computeCycle(spec: CycleSpec): CyclePlan {
  const err = validateCycle(spec);
  if (err) throw new Error(err);
  const phaseDays = (spec.totalDays - spec.nurseryDays) / 3;
  const integrationDay = spec.nurseryDays + 1;
  return {
    nurseryDays: spec.nurseryDays,
    totalDays: spec.totalDays,
    phaseDays,
    integrationDay,
    phaseStartDay: {
      1: integrationDay,
      2: integrationDay + phaseDays,
      3: integrationDay + 2 * phaseDays,
    },
    harvestIntervalDays: phaseDays,
    harvestsPerYear: 365 / phaseDays,
  };
}

/** Plants récoltés par an et par module (un niveau est récolté à chaque intervalle). */
export function plantsPerYear(spec: CycleSpec, plantsPerLevel: number): number {
  return plantsPerLevel * computeCycle(spec).harvestsPerYear;
}

export interface StagePosition {
  stage: CycleStage;
  /** Jour dans la phase courante (1-indexé) ; pour la nurserie, jour de nurserie. */
  phaseDay: number;
  /** Durée de la phase courante en jours. */
  phaseLength: number;
  /** Jour du cycle (1-indexé). */
  cycleDay: number;
  /** Jours restants avant récolte (0 si terminé). */
  daysToHarvest: number;
  /** Avancement global du cycle, 0..100. */
  progressPct: number;
}

/** Position dans le cycle pour un nombre de jours écoulés depuis le semis (0 = jour du semis). */
export function stageAt(spec: CycleSpec, elapsedDays: number): StagePosition {
  const plan = computeCycle(spec);
  const cycleDay = Math.max(1, Math.floor(elapsedDays) + 1);
  const progressPct = Math.min(100, Math.round((cycleDay / plan.totalDays) * 100));
  const daysToHarvest = Math.max(0, plan.totalDays - cycleDay);

  if (cycleDay <= plan.nurseryDays) {
    return { stage: 'nursery', phaseDay: cycleDay, phaseLength: plan.nurseryDays, cycleDay, daysToHarvest, progressPct };
  }
  if (cycleDay > plan.totalDays) {
    return { stage: 'done', phaseDay: cycleDay - plan.totalDays, phaseLength: 0, cycleDay, daysToHarvest: 0, progressPct: 100 };
  }
  const sinceIntegration = cycleDay - plan.integrationDay; // 0-indexé
  const idx = Math.min(2, Math.floor(sinceIntegration / plan.phaseDays));
  const stage = (idx + 1) as 1 | 2 | 3;
  const phaseDay = Math.floor(sinceIntegration - idx * plan.phaseDays) + 1;
  return { stage, phaseDay, phaseLength: plan.phaseDays, cycleDay, daysToHarvest, progressPct };
}

const DAY_MS = 86_400_000;

/** Jours entiers écoulés entre une date de semis (YYYY-MM-DD) et `now` (calendrier UTC, sans heure). */
export function elapsedDaysSince(sowingDate: string, now: Date = new Date()): number {
  const s = Date.parse(sowingDate.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(s)) return NaN;
  const n = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((n - s) / DAY_MS);
}

/** Date de récolte prévue (YYYY-MM-DD) : semis + T jours. */
export function harvestDate(sowingDate: string, spec: CycleSpec): string {
  const s = Date.parse(sowingDate.slice(0, 10) + 'T00:00:00Z');
  return new Date(s + spec.totalDays * DAY_MS).toISOString().slice(0, 10);
}

/** Date d'intégration au module (YYYY-MM-DD) : semis + nurserie. */
export function integrationDate(sowingDate: string, spec: CycleSpec): string {
  const s = Date.parse(sowingDate.slice(0, 10) + 'T00:00:00Z');
  return new Date(s + spec.nurseryDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Calendrier de rotation d'un module à 3 niveaux : à chaque intervalle P,
 * le niveau 3 est récolté, N2→N3, N1→N2, une nouvelle cohorte entre en N1.
 * Retourne les `count` prochaines dates de récolte à partir de la première récolte.
 */
export function rotationSchedule(sowingDate: string, spec: CycleSpec, count: number): string[] {
  const plan = computeCycle(spec);
  const first = Date.parse(harvestDate(sowingDate, spec) + 'T00:00:00Z');
  return Array.from({ length: count }, (_, i) =>
    new Date(first + Math.round(i * plan.harvestIntervalDays) * DAY_MS).toISOString().slice(0, 10),
  );
}
