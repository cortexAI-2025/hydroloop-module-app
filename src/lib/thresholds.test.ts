import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, describeRange, getActiveThresholds, isOutOfRange, normalizeThresholds, resetActiveThresholds, setActiveThresholds } from './thresholds';
import { detectAlerts } from '@/types/batch';
import { ENV } from '@/test/fixtures';

afterEach(resetActiveThresholds);

describe('seuils configurables', () => {
  it('les valeurs par défaut ne déclenchent aucune alerte sur un relevé nominal', () => {
    expect(detectAlerts(ENV, DEFAULT_THRESHOLDS, 1)).toEqual([]);
  });

  it('détecte pH, EC hors plage et pH critique en « danger »', () => {
    const a = detectAlerts({ ...ENV, pH: 7.2 }, DEFAULT_THRESHOLDS, 1);
    expect(a.map((x) => x.field)).toContain('pH');
    expect(a.find((x) => x.field === 'pH')!.severity).toBe('danger');
  });

  it('une plage personnalisée change les alertes', () => {
    const t = structuredClone(DEFAULT_THRESHOLDS);
    t.metrics.pH = { ...t.metrics.pH, min: 5.8, max: 6.2 };
    expect(isOutOfRange('pH', 6.4, t)).toBe(true);
    expect(isOutOfRange('pH', 6.4, DEFAULT_THRESHOLDS)).toBe(false);
  });

  it('une métrique désactivée ne génère pas d’alerte', () => {
    const t = structuredClone(DEFAULT_THRESHOLDS);
    t.metrics.pH = { ...t.metrics.pH, enabled: false };
    expect(isOutOfRange('pH', 9, t)).toBe(false);
  });

  it('la plage active est globale et modifiable', () => {
    const t = structuredClone(DEFAULT_THRESHOLDS);
    t.metrics.EC = { ...t.metrics.EC, max: 2 };
    setActiveThresholds(t);
    expect(getActiveThresholds().metrics.EC.max).toBe(2);
    expect(describeRange('EC')).toMatch(/2/);
  });

  it('la normalisation refuse les plages incohérentes avec un message', () => {
    const bad = structuredClone(DEFAULT_THRESHOLDS);
    bad.metrics.pH = { ...bad.metrics.pH, min: 7, max: 5 };
    const { errors, value } = normalizeThresholds(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(value.metrics.pH.min).toBe(DEFAULT_THRESHOLDS.metrics.pH.min); // valeur invalide remplacée par la valeur par défaut
  });

  it('une entrée absente ou illisible retombe sur les valeurs par défaut', () => {
    expect(normalizeThresholds(undefined).value).toEqual(DEFAULT_THRESHOLDS);
    expect(normalizeThresholds('n’importe quoi').value).toEqual(DEFAULT_THRESHOLDS);
  });

  it('EC hors plage du niveau : alerte spécifique', () => {
    const a = detectAlerts({ ...ENV, EC: 2.6 }, DEFAULT_THRESHOLDS, 1);
    expect(a.some((x) => x.field === 'EC')).toBe(true);
  });
});
