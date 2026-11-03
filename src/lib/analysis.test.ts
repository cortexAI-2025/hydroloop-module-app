import { describe, expect, it } from 'vitest';
import { analyzeBatch, slopePerDay } from './analysis';
import { buildLocalReport, reportInputHash } from './report-local';
import { predictHarvest } from './harvest';
import { DEFAULT_THRESHOLDS } from './thresholds';
import { ENV, makeRecord, withReading } from '@/test/fixtures';
import type { TrackedBatch } from '@/types/batch';

const now = new Date('2026-09-10T12:00:00.000Z');
const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}T08:00:00.000Z`;

function series(values: number[], metric: 'pH' | 'EC' | 'oxygene_dissous', start = 2): TrackedBatch {
  let r: TrackedBatch = { ...makeRecord(), readings: [] }; // sans le relevé initial créé à la saisie du batch
  values.forEach((v, i) => { r = withReading(r, `r${i}`, day(start + i), { [metric]: v }); });
  return r;
}

describe('slopePerDay', () => {
  it('calcule la pente d’une série linéaire', () => {
    const d = 86_400_000;
    expect(slopePerDay([{ t: 0, v: 1 }, { t: d, v: 2 }, { t: 2 * d, v: 3 }])).toBeCloseTo(1, 6);
  });
  it('retourne null avec moins de 2 points ou sans durée', () => {
    expect(slopePerDay([{ t: 0, v: 1 }])).toBeNull();
    expect(slopePerDay([{ t: 5, v: 1 }, { t: 5, v: 2 }])).toBeNull();
  });
});

describe('analyzeBatch', () => {
  it('ne signale rien pour des relevés nominaux récents', () => {
    const r = series([6.0, 6.0, 6.0, 6.0], 'pH', 6);
    expect(analyzeBatch(r, DEFAULT_THRESHOLDS, new Date('2026-09-09T20:00:00.000Z')).findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('signale une valeur hors plage avec sa provenance et la plage configurée', () => {
    const r = series([6.0, 7.1], 'pH', 8);
    const f = analyzeBatch(r, DEFAULT_THRESHOLDS, now).findings.find((x) => x.id === 'threshold-pH')!;
    expect(f.provenance).toBe('rule');
    expect(f.severity).toBe('danger');
    expect(f.detail).toMatch(/7.1/);
    expect(f.recommendation).toBeTruthy();
  });

  it('détecte un problème persistant (3 relevés consécutifs hors plage)', () => {
    const r = series([7.0, 7.1, 7.2], 'pH', 6);
    expect(analyzeBatch(r, DEFAULT_THRESHOLDS, now).findings.map((f) => f.id)).toContain('persistent-pH');
  });

  it('détecte une dérive de l’oxygène dissous', () => {
    const r = series([8.5, 8.0, 7.5, 7.0, 6.5], 'oxygene_dissous', 4);
    const a = analyzeBatch(r, DEFAULT_THRESHOLDS, now);
    expect(a.findings.map((f) => f.id)).toContain('trend-oxygene_dissous');
    expect(a.trends.find((t) => t.metric === 'oxygene_dissous')!.slopePerDay).toBeCloseTo(-0.5, 5);
  });

  it('pas de tendance annoncée avec trop peu de relevés', () => {
    const r = series([6.0, 6.4], 'pH', 8);
    expect(analyzeBatch(r, DEFAULT_THRESHOLDS, now).trends).toEqual([]);
  });

  it('détecte un saut brutal entre deux relevés', () => {
    const r = series([6.0, 6.8], 'pH', 8);
    expect(analyzeBatch(r, DEFAULT_THRESHOLDS, now).findings.map((f) => f.id)).toContain('jump-pH');
  });

  it('signale un relevé en retard selon le délai configuré', () => {
    const r = series([6.0], 'pH', 2);
    expect(analyzeBatch(r, DEFAULT_THRESHOLDS, now).findings.map((f) => f.id)).toContain('reading-overdue');
    const lax = { ...DEFAULT_THRESHOLDS, readingDueHours: 24 * 30 };
    expect(analyzeBatch(r, lax, now).findings.map((f) => f.id)).not.toContain('reading-overdue');
  });

  it('respecte les seuils personnalisés', () => {
    const r = series([6.0, 6.0], 'pH', 8);
    const strict = structuredClone(DEFAULT_THRESHOLDS);
    strict.metrics.pH = { ...strict.metrics.pH, min: 6.2, max: 6.4 };
    expect(analyzeBatch(r, strict, now).findings.map((f) => f.id)).toContain('threshold-pH');
  });
});

describe('rapport local', () => {
  it('sépare mesures, calculs et règles, et n’invente aucun rendement', () => {
    const r = series([6.0, 7.1], 'pH', 8);
    const md = buildLocalReport(r, { now });
    expect(md).toMatch(/sans intelligence artificielle/i);
    expect(md).toMatch(/## 1\. Mesures observées/);
    expect(md).toMatch(/## 2\. Calculs/);
    expect(md).toMatch(/## 3\. Anomalies et recommandations \(règles\)/);
    expect(md).not.toMatch(/g\/plante|Grade A|Rendement frais/i);
  });

  it('l’empreinte change quand un relevé est ajouté, pas sinon', () => {
    const r = series([6.0], 'pH', 8);
    expect(reportInputHash(r)).toBe(reportInputHash({ ...r }));
    expect(reportInputHash(withReading(r, 'new', day(9)))).not.toBe(reportInputHash(r));
  });
});

describe('prévision de récolte', () => {
  it('fournit fourchette, hypothèses, incertitude et avertissement', () => {
    const p = predictHarvest(3, 15, 27, now, { window: { minDays: 20, maxDays: 27 } });
    expect(p.range).toMatchObject({ minDays: 5, maxDays: 12 });
    expect(p.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(p.uncertainty).toMatch(/élevée/);
    expect(p.disclaimer).toMatch(/indicative/);
    expect(p.basis).toBe('target');
  });

  it('utilise l’historique réel à partir de 3 récoltes', () => {
    const p = predictHarvest(3, 15, 27, now, { historyDays: [22, 24, 25] });
    expect(p.basis).toBe('history');
    expect(p.range).toMatchObject({ minDays: 7, maxDays: 10 });
    expect(p.uncertainty).toMatch(/moyenne/);
  });

  it('ignore un historique trop court', () => {
    expect(predictHarvest(3, 15, 27, now, { historyDays: [22, 24] }).basis).toBe('target');
  });
});

void ENV;
