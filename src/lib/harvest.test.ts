import { describe, expect, it } from 'vitest';
import { predictHarvest } from './harvest';

describe('predictHarvest', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  it('ne prédit rien avant le niveau 3', () => {
    expect(predictHarvest(2, 10, 27, now).daysRemaining).toBeNull();
  });

  it('calcule les jours restants et la date à partir de la durée cible', () => {
    const p = predictHarvest(3, 20, 27, now);
    expect(p.daysRemaining).toBe(7);
    expect(p.estimatedDate!.toISOString().slice(0, 10)).toBe('2026-10-08');
    expect(p.progressPct).toBe(74);
    expect(p.confidence).toBe('medium');
  });

  it('adapte les seuils de confiance à la durée cible', () => {
    expect(predictHarvest(3, 10, 27, now).confidence).toBe('low');
    expect(predictHarvest(3, 10, 63, now).confidence).toBe('low');
    expect(predictHarvest(3, 40, 63, now).confidence).toBe('medium');
    expect(predictHarvest(3, 25, 27, now).windowLabel).toMatch(/imminente/);
    expect(predictHarvest(3, 30, 27, now).windowLabel).toMatch(/dépassée/);
  });
});
