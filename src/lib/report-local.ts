import { analyzeBatch } from './analysis';
import type { Analysis } from './analysis';
import { predictHarvest } from './harvest';
import { levelProgress, currentPhaseDay, daysSinceSowing, readingStats } from './tracking';
import { METRIC_META, describeRange, getActiveThresholds } from './thresholds';
import type { MetricKey, Thresholds } from './thresholds';
import { shortHash, stableStringify } from './merge';
import type { TrackedBatch } from '@/types/batch';
import { PHASE_LABELS } from '@/types/batch';
import type { StrainHistory } from './storage';

/**
 * Rapport local (sans IA), généré dans le navigateur à partir des relevés enregistrés.
 * Fonctionne hors ligne. Ne contient AUCUNE estimation de biomasse ou de rendement inventée :
 * seuls figurent des mesures saisies, des calculs sur ces mesures et des conclusions de règles configurables.
 */

const SEV_ICON = { danger: '🚨', warning: '⚠️', info: 'ℹ️' } as const;
const PROV_LABEL = { observed: 'mesure', calculated: 'calcul', rule: 'règle' } as const;

const f = (n: number, d = 2) => Number(n.toFixed(d)).toString();

export function reportInputHash(r: TrackedBatch, t: Thresholds = getActiveThresholds()): string {
  return shortHash(stableStringify({
    data: r.data, phaseStartedAt: r.phaseStartedAt, status: r.status, harvest: r.harvest,
    readings: r.readings.map((x) => x.id), thresholds: t,
  }));
}

export function buildLocalReport(
  r: TrackedBatch,
  opts: { now?: Date; thresholds?: Thresholds; history?: StrainHistory; analysis?: Analysis } = {},
): string {
  const now = opts.now ?? new Date();
  const t = opts.thresholds ?? getActiveThresholds();
  const a = opts.analysis ?? analyzeBatch(r, t, now);
  const phase = r.data.PHASE_NUMBER as 1 | 2 | 3;
  const prog = levelProgress(r, now);
  const stats = readingStats(r.readings);
  const last = [...r.readings].sort((x, y) => x.at.localeCompare(y.at)).at(-1);
  const L: string[] = [];

  L.push(`# Rapport local — batch ${r.id} · ${r.data.SOUCHE}`);
  L.push(`**${PHASE_LABELS[phase]}** · jour ${currentPhaseDay(r, now)} · ${r.data.MODULE_TYPE} plants${r.data.MODULE_ID ? ` · module ${r.data.MODULE_ID}` : ''}`);
  L.push('');
  L.push('> **Rapport généré localement, sans intelligence artificielle.** Il ne contient que vos mesures, des calculs sur ces mesures et le résultat de règles configurables (page Réglages). Aucune biomasse ni rendement n’est estimé ici : regénérez avec l’IA, quand elle est disponible, pour une analyse plus complète.');
  L.push('');

  L.push('## 1. Mesures observées (saisies par l’opérateur)');
  if (last) {
    L.push(`Dernier relevé : ${new Date(last.at).toLocaleString('fr-FR')}${last.operator ? ` · ${last.operator}` : ''}`);
    L.push('', '| Paramètre | Valeur | Plage configurée |', '|---|---|---|');
    for (const m of Object.keys(METRIC_META) as MetricKey[]) {
      const v = last.env[m as keyof typeof last.env];
      L.push(`| ${METRIC_META[m].label} | ${v} ${METRIC_META[m].unit} | ${t.metrics[m]?.enabled ? describeRange(m, t) : 'non surveillé'} |`);
    }
    L.push(`| Photopériode | ${last.env.photopériode} | — |`);
  } else L.push('Aucun relevé enregistré.');
  L.push('');

  L.push('## 2. Calculs sur l’historique');
  L.push(`- Relevés enregistrés : **${a.readingsCount}** (dont **${a.alertRatePct} %** avec au moins une valeur hors plage)`);
  L.push(`- Jours depuis le semis : **${daysSinceSowing(r, now)}** · progression du niveau : **jour ${prog.day} / ${prog.target}** (${Math.round(prog.pct)} %)`);
  const rows = Object.entries(stats).filter(([k]) => k in METRIC_META);
  if (rows.length > 1 && a.readingsCount > 1) {
    L.push('', '| Paramètre | Premier → dernier | Min | Max | Moyenne |', '|---|---|---|---|---|');
    for (const [k, s] of rows) L.push(`| ${METRIC_META[k as MetricKey].label} | ${s!.first} → ${s!.last} | ${s!.min} | ${s!.max} | ${s!.avg} |`);
  }
  if (a.trends.length) {
    L.push('', 'Pentes (régression linéaire) :');
    for (const tr of a.trends) L.push(`- ${METRIC_META[tr.metric].label} : ${tr.slopePerDay > 0 ? '+' : ''}${f(tr.slopePerDay)} ${METRIC_META[tr.metric].unit}/jour (${tr.count} relevés sur ${Math.round(tr.spanHours / 24)} j)`);
  }
  L.push('');

  L.push('## 3. Anomalies et recommandations (règles)');
  if (a.findings.length === 0) L.push('✅ Aucune anomalie détectée avec les règles actuelles.');
  for (const x of a.findings) {
    L.push(`- ${SEV_ICON[x.severity]} **${x.title}** _(${PROV_LABEL[x.provenance]})_ — ${x.detail}${x.recommendation ? `\n  - Recommandation (règle, à valider) : ${x.recommendation}` : ''}`);
  }
  L.push('');

  if (phase === 3 && r.status === 'active') {
    const hist = opts.history?.harvests.map((h) => h.level3Days).filter((d): d is number => typeof d === 'number');
    const p = predictHarvest(3, prog.day, r.levelTargetDays[3], now, { window: t.harvestWindow, historyDays: hist });
    L.push('## 4. Prévision de récolte (indicative)');
    if (p.range) {
      L.push(`- Fourchette : entre **${p.range.minDays}** et **${p.range.maxDays}** jours (du ${p.range.earliest.toLocaleDateString('fr-FR')} au ${p.range.latest.toLocaleDateString('fr-FR')}) ; estimation centrale : ${p.windowLabel}`);
      L.push(`- ${p.uncertainty}`);
      L.push('- Hypothèses :', ...p.assumptions.map((s) => `  - ${s}`));
      L.push(`- _${p.disclaimer}_`);
    }
    L.push('');
  }

  L.push('---', `_Généré le ${now.toLocaleString('fr-FR')} par HydroLoop (mode local, sans IA)._`);
  return L.join('\n');
}
