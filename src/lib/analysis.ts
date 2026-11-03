import type { MetricKey, Thresholds } from './thresholds';
import { METRIC_META, describeRange, getActiveThresholds, isOutOfRange, metricValue } from './thresholds';
import type { Reading, TrackedBatch } from '@/types/batch';
import { PHASE_LABELS } from '@/types/batch';
import { hoursSinceLastReading, levelProgress } from './tracking';

/**
 * Analyse d'historique, entièrement locale et déterministe (aucune IA).
 *
 * Chaque information porte sa provenance :
 *  - `observed`   : valeur saisie par l'opérateur (mesure),
 *  - `calculated` : résultat d'un calcul sur les mesures (pente, moyenne, durée…),
 *  - `rule`       : conclusion d'une règle configurable (seuil dépassé, dérive…) — une règle n'est pas un diagnostic.
 */

export type Provenance = 'observed' | 'calculated' | 'rule';
export type FindingSeverity = 'info' | 'warning' | 'danger';

export interface Finding {
  id: string;
  provenance: Provenance;
  severity: FindingSeverity;
  metric?: MetricKey;
  title: string;
  detail: string;
  recommendation?: string;
}

export interface MetricTrend {
  metric: MetricKey;
  /** Pente par jour (régression linéaire des moindres carrés). */
  slopePerDay: number;
  count: number;
  spanHours: number;
}

export interface Analysis {
  generatedAt: string;
  readingsCount: number;
  alertRatePct: number;
  trends: MetricTrend[];
  findings: Finding[];
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { danger: 0, warning: 1, info: 2 };

/** Pente (unités/jour) d'une régression linéaire ; null si les points ne couvrent pas assez de temps. */
export function slopePerDay(points: { t: number; v: number }[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 86_400_000);
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (points[i].v - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? null : num / den;
}

const RECOMMENDATIONS: Partial<Record<MetricKey, { low?: string; high?: string }>> = {
  pH: { low: 'Remonter progressivement le pH (correcteur pH+), puis recontrôler dans quelques heures.', high: 'Abaisser progressivement le pH (correcteur pH−), puis recontrôler dans quelques heures.' },
  EC: { low: 'Solution trop diluée : vérifier le dosage des nutriments et le niveau du réservoir.', high: 'Solution trop concentrée : diluer avec de l’eau et recontrôler.' },
  oxygene_dissous: { low: 'Renforcer l’oxygénation (pompe à air, diffuseur) et vérifier la température de la solution.' },
  temperature_solution: { high: 'Refroidir ou ombrager le réservoir : une solution chaude retient moins d’oxygène.' },
  debit_NFT: { low: 'Vérifier la pompe, les filtres et l’absence d’obstruction dans les gouttières.' },
  temperature_air_jour: { low: 'Vérifier le chauffage / la ventilation en période d’éclairage.', high: 'Renforcer la ventilation ou la climatisation en période d’éclairage.' },
  temperature_air_nuit: { low: 'Vérifier le chauffage nocturne.', high: 'Renforcer la ventilation nocturne.' },
  humidite_relative: { low: 'Humidifier légèrement l’air ambiant.', high: 'Renforcer la déshumidification / ventilation (risque fongique).' },
};

const fmt = (n: number, d = 2) => Number(n.toFixed(d)).toString();

export function analyzeBatch(r: TrackedBatch, t: Thresholds = getActiveThresholds(), now: Date = new Date()): Analysis {
  const findings: Finding[] = [];
  const readings = [...r.readings].sort((a, b) => a.at.localeCompare(b.at));
  const last = readings.at(-1);
  const phase = r.data.PHASE_NUMBER as 1 | 2 | 3;

  const add = (f: Finding) => findings.push(f);

  if (last) {
    // 1. Seuils (valeurs observées vs plage configurée)
    for (const m of Object.keys(METRIC_META) as MetricKey[]) {
      const rule = t.metrics[m];
      const v = metricValue(last.env, m);
      if (!rule?.enabled || !Number.isFinite(v) || !isOutOfRange(m, v, t)) continue;
      const low = rule.min !== undefined && v < rule.min;
      add({
        id: `threshold-${m}`, provenance: 'rule', severity: rule.severity === 'danger' ? 'danger' : 'warning', metric: m,
        title: `${METRIC_META[m].label} hors plage`,
        detail: `Valeur observée ${fmt(v, METRIC_META[m].decimals)} ${METRIC_META[m].unit} ; plage configurée ${describeRange(m, t)}.`,
        recommendation: RECOMMENDATIONS[m]?.[low ? 'low' : 'high'],
      });
    }

    // 2. EC par rapport au niveau courant
    const [ecLo, ecHi] = t.ecByLevel[phase];
    const ec = last.env.EC;
    if (Number.isFinite(ec) && !isOutOfRange('EC', ec, t) && (ec < ecLo || ec > ecHi)) {
      add({
        id: 'ec-level', provenance: 'rule', severity: 'info', metric: 'EC',
        title: `EC en dehors de la cible du ${PHASE_LABELS[phase]}`,
        detail: `EC observée ${fmt(ec)} mS/cm ; cible indicative du niveau ${phase} : ${ecLo}–${ecHi} mS/cm.`,
        recommendation: ec < ecLo ? 'Augmenter légèrement la concentration en nutriments.' : 'Diluer légèrement la solution.',
      });
    }

    // 3. Problèmes persistants
    for (const m of Object.keys(METRIC_META) as MetricKey[]) {
      if (!t.metrics[m]?.enabled) continue;
      const recent = readings.slice(-t.trend.persistentCount);
      if (recent.length >= t.trend.persistentCount && recent.every((x) => isOutOfRange(m, metricValue(x.env, m), t))) {
        add({
          id: `persistent-${m}`, provenance: 'rule', severity: 'danger', metric: m,
          title: `${METRIC_META[m].label} : problème persistant`,
          detail: `Hors plage lors des ${recent.length} derniers relevés consécutifs (depuis le ${new Date(recent[0].at).toLocaleDateString('fr-FR')}).`,
          recommendation: 'Un réglage ponctuel n’a pas suffi : rechercher la cause (équipement, dosage, capteur à recalibrer).',
        });
      }
    }
  }

  // 4. Dérives (tendances)
  const trends: MetricTrend[] = [];
  const spanHours = readings.length > 1 ? (Date.parse(readings.at(-1)!.at) - Date.parse(readings[0].at)) / 3_600_000 : 0;
  if (readings.length >= t.trend.minReadings && spanHours >= t.trend.minSpanHours) {
    for (const [mk, limit] of Object.entries(t.trend.slopePerDay) as [MetricKey, number][]) {
      const s = slopePerDay(readings.map((x) => ({ t: Date.parse(x.at), v: metricValue(x.env, mk) })).filter((p) => Number.isFinite(p.v)));
      if (s === null) continue;
      trends.push({ metric: mk, slopePerDay: s, count: readings.length, spanHours });
      const EPS = 1e-9; // tolérance d'arrondi pour une pente exactement égale au seuil
      const drifting = limit < 0 ? s <= limit + EPS : Math.abs(s) >= limit - EPS;
      if (drifting) {
        add({
          id: `trend-${mk}`, provenance: 'rule', severity: 'warning', metric: mk,
          title: `${METRIC_META[mk].label} : dérive`,
          detail: `Pente calculée ${s > 0 ? '+' : ''}${fmt(s)} ${METRIC_META[mk].unit}/jour sur ${readings.length} relevés (${Math.round(spanHours / 24)} j) ; seuil de dérive configuré ${limit < 0 ? '≤ ' : '± '}${limit}/jour.`,
          recommendation: 'Surveiller de près : la valeur peut sortir de la plage si la tendance se poursuit (extrapolation indicative, non garantie).',
        });
      }
    }
  }

  // 5. Sauts entre deux relevés consécutifs
  if (readings.length >= 2) {
    const [a, b] = readings.slice(-2);
    for (const [mk, limit] of Object.entries(t.trend.jump) as [MetricKey, number][]) {
      const d = metricValue(b.env, mk) - metricValue(a.env, mk);
      if (Number.isFinite(d) && Math.abs(d) >= limit) {
        add({
          id: `jump-${mk}`, provenance: 'rule', severity: 'warning', metric: mk,
          title: `${METRIC_META[mk].label} : variation brutale`,
          detail: `Écart de ${d > 0 ? '+' : ''}${fmt(d)} ${METRIC_META[mk].unit} entre les deux derniers relevés (seuil configuré ${limit}).`,
          recommendation: 'Vérifier la saisie ou la calibration du capteur, puis refaire une mesure de contrôle.',
        });
      }
    }
  }

  // 6. Retard de relevé et durée du niveau
  if (r.status === 'active') {
    const h = hoursSinceLastReading(r, now);
    if (h > t.readingDueHours) {
      add({
        id: 'reading-overdue', provenance: 'calculated', severity: 'warning',
        title: 'Relevé en retard',
        detail: `Dernier relevé il y a ${Math.round(h)} h (délai configuré : ${t.readingDueHours} h).`,
        recommendation: 'Enregistrer un nouveau relevé.',
      });
    }
    const p = levelProgress(r, now);
    if (p.day > p.target) {
      add({
        id: 'level-overdue', provenance: 'calculated', severity: 'info',
        title: 'Durée cible du niveau dépassée',
        detail: `Jour ${p.day} pour une durée cible de ${p.target} jours.`,
      });
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const withAlert = readings.filter((x: Reading) => (Object.keys(METRIC_META) as MetricKey[]).some((m) => t.metrics[m]?.enabled && isOutOfRange(m, metricValue(x.env, m), t))).length;
  return {
    generatedAt: now.toISOString(),
    readingsCount: readings.length,
    alertRatePct: readings.length ? Math.round((withAlert / readings.length) * 100) : 0,
    trends,
    findings,
  };
}
