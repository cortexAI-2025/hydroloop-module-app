import { describe, expect, it } from 'vitest';
import { formatTrackingContext } from './system-prompt';

describe('formatTrackingContext', () => {
  it('ne renvoie rien sans contexte', () => {
    expect(formatTrackingContext()).toBe('');
    expect(formatTrackingContext({})).toBe('');
  });

  it('résume le suivi, les tendances et l’historique de souche', () => {
    const out = formatTrackingContext({
      daysSinceSowing: 40,
      levelTargetDays: 21,
      readingsCount: 6,
      alertRatePct: 17,
      trend: { pH: { min: 5.6, max: 6.4, avg: 6, first: 5.8, last: 6.4, count: 6 } },
      recentEvents: ['2026-09-01 · Taille : effeuillage'],
      strainHistory: { count: 2, commonAlerts: ['pH trop élevé'], lastBatchDate: '2026-08-01T00:00:00.000Z', harvests: [{ batchId: 'B0', freshWeightKg: 13, plants: 48 }] },
    });
    expect(out).toContain('Jours depuis le semis : 40');
    expect(out).toContain('pH : 5.8 → 6.4');
    expect(out).toContain('Taille : effeuillage');
    expect(out).toContain('B0 13 kg / 48 plants');
  });
});
