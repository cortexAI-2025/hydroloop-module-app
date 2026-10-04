import { describe, expect, it } from 'vitest';
import type { BatchRecord, EnvironmentalData } from '@/types/batch';
import { detectAlerts } from '@/types/batch';
import {
  addReading, advanceLevel, alertRate, currentPhaseDay, isReadingDue, levelProgress,
  normalizeRecord, pickNewer, readingStats, readingsToCsv, recordHarvest, withLiveDay,
} from './tracking';

const env: EnvironmentalData = {
  temperature_air_jour: 24, temperature_air_nuit: 18, humidite_relative: 55, pH: 6.0, EC: 1.4,
  temperature_solution: 20, debit_NFT: 0.8, oxygene_dissous: 7.5, PPFD: 600, photopériode: '18/6',
};

function legacy(overrides: Partial<BatchRecord['data']> = {}, createdAt = '2026-09-01T08:00:00.000Z'): BatchRecord {
  return {
    id: 'B2026-09-01-01',
    createdAt,
    updatedAt: createdAt,
    data: {
      BATCH_ID: 'B2026-09-01-01', SOUCHE: 'Beldiya Auto', PHASE_NUMBER: 1, PHASE_DAY: 1, MODULE_TYPE: 48,
      DATE_SEMIS: '2026-08-22', DONNEES_ENVIRONNEMENTALES: env, HISTORIQUE_TAILLES: '', DERNIERS_RELEVES_RACINAIRES: '',
      ...overrides,
    },
  };
}

describe('normalizeRecord', () => {
  it('migre un enregistrement v1 : statut, relevé initial, événement de création, durées par défaut', () => {
    const r = normalizeRecord(legacy());
    expect(r.status).toBe('active');
    expect(r.readings).toHaveLength(1);
    expect(r.readings[0].env).toEqual(env);
    expect(r.events[0].type).toBe('created');
    expect(r.levelTargetDays).toEqual({ 1: 21, 2: 21, 3: 27 });
  });

  it('déduit la date d’entrée dans le niveau du jour de phase saisi', () => {
    const r = normalizeRecord(legacy({ PHASE_DAY: 5 }));
    expect(currentPhaseDay(r, new Date('2026-09-01T12:00:00.000Z'))).toBe(5);
  });

  it('est idempotente', () => {
    const once = normalizeRecord(legacy());
    expect(normalizeRecord(once)).toEqual(once);
  });
});

describe('jour de phase', () => {
  it('avance avec le calendrier et est reflété dans les données', () => {
    const r = normalizeRecord(legacy());
    const now = new Date('2026-09-11T09:00:00.000Z');
    expect(currentPhaseDay(r, now)).toBe(11);
    expect(withLiveDay(r, now).data.PHASE_DAY).toBe(11);
  });

  it('signale le passage au niveau suivant à la durée cible', () => {
    const r = normalizeRecord(legacy());
    expect(levelProgress(r, new Date('2026-09-10T09:00:00.000Z')).ready).toBe(false);
    const p = levelProgress(r, new Date('2026-09-21T09:00:00.000Z'));
    expect(p.ready).toBe(true);
    expect(p.nextAction).toMatch(/niveau 2/);
  });
});

describe('relevés', () => {
  it('ajoute un relevé, met à jour la valeur courante et journalise les alertes', () => {
    const r = normalizeRecord(legacy());
    const bad = { ...env, pH: 7.1, oxygene_dissous: 5 };
    const next = addReading(r, bad, { operator: 'Samira', at: '2026-09-02T08:00:00.000Z' });
    expect(next.readings).toHaveLength(2);
    expect(next.data.DONNEES_ENVIRONNEMENTALES.pH).toBe(7.1);
    const ev = next.events[next.events.length - 1];
    expect(ev.type).toBe('reading');
    expect(ev.operator).toBe('Samira');
    expect(ev.summary).toMatch(/2 alertes/);
  });

  it('un relevé antidaté ne remplace pas la valeur courante', () => {
    const r = addReading(normalizeRecord(legacy()), { ...env, pH: 5.8 }, { at: '2026-09-05T08:00:00.000Z' });
    const back = addReading(r, { ...env, pH: 6.4 }, { at: '2026-09-03T08:00:00.000Z' });
    expect(back.data.DONNEES_ENVIRONNEMENTALES.pH).toBe(5.8);
    expect(back.readings.map((x) => x.env.pH)).toEqual([6.0, 6.4, 5.8]);
  });

  it('calcule les statistiques et le taux d’alerte', () => {
    let r = normalizeRecord(legacy());
    r = addReading(r, { ...env, pH: 5.0 }, { at: '2026-09-02T08:00:00.000Z' });
    r = addReading(r, { ...env, pH: 6.2 }, { at: '2026-09-03T08:00:00.000Z' });
    const s = readingStats(r.readings).pH!;
    expect(s).toMatchObject({ min: 5.0, max: 6.2, first: 6.0, last: 6.2, count: 3 });
    expect(alertRate(r.readings)).toBe(33);
  });

  it('détecte un relevé en retard après 24 h', () => {
    const r = normalizeRecord(legacy());
    expect(isReadingDue(r, new Date('2026-09-01T20:00:00.000Z'))).toBe(false);
    expect(isReadingDue(r, new Date('2026-09-02T09:00:00.000Z'))).toBe(true);
  });
});

describe('rotation et récolte', () => {
  it('fait monter la cohorte et remet le compteur à 1', () => {
    const r = normalizeRecord(legacy());
    const at = '2026-09-22T08:00:00.000Z';
    const n2 = advanceLevel(r, 'Ahmed', at);
    expect(n2.data.PHASE_NUMBER).toBe(2);
    expect(currentPhaseDay(n2, new Date(at))).toBe(1);
    expect(n2.events.at(-1)!.summary).toMatch(/Niveau 1.*→ niveau 2.*après 22 j/);
    const n3 = advanceLevel(n2, undefined, '2026-10-13T08:00:00.000Z');
    expect(n3.data.DONNEES_ENVIRONNEMENTALES.photopériode).toBe('12/12');
    expect(() => advanceLevel(n3)).toThrow(/récolte/);
  });

  it('clôt le batch à la récolte et fige le jour de phase', () => {
    const r = normalizeRecord(legacy({ PHASE_NUMBER: 3 }));
    const h = recordHarvest(r, { date: '2026-09-20T00:00:00.000Z', plantsHarvested: 48, freshWeightKg: 14.4, operator: 'Ahmed', freezeTempC: -40 });
    expect(h.status).toBe('harvested');
    expect(currentPhaseDay(h, new Date('2026-12-01'))).toBe(currentPhaseDay(h, new Date('2026-09-20T12:00:00.000Z')));
    expect(h.events.at(-1)!.summary).toMatch(/14.4 kg.*-40°C/);
    expect(() => recordHarvest(h, h.harvest!)).toThrow();
    expect(() => advanceLevel(h)).toThrow();
  });
});

describe('fusion', () => {
  it('garde la version la plus récente, la locale à égalité', () => {
    const a = legacy();
    const newer = { ...a, updatedAt: '2026-09-05T00:00:00.000Z' };
    expect(pickNewer(a, newer)).toBe(newer);
    expect(pickNewer(newer, a)).toBe(newer);
    expect(pickNewer(a, { ...a })).toBe(a);
    expect(pickNewer(undefined, a)).toBe(a);
  });
});

describe('export CSV', () => {
  it('produit une ligne par relevé et échappe les champs', () => {
    const r = addReading(normalizeRecord(legacy()), env, { note: 'racines "brunes", à surveiller', at: '2026-09-02T08:00:00.000Z' });
    const lines = readingsToCsv([r]).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^batch_id,souche,module_id,niveau/);
    expect(lines[2]).toContain('"racines ""brunes"", à surveiller"');
  });
});

describe('detectAlerts', () => {
  it('reste silencieux sur des valeurs nominales', () => {
    expect(detectAlerts(env)).toEqual([]);
  });
  it('signale chaque dérive avec sa sévérité', () => {
    const a = detectAlerts({ ...env, pH: 5.2, oxygene_dissous: 4, temperature_solution: 24, EC: 3.4, debit_NFT: 0.2 });
    expect(a.map((x) => x.field).sort()).toEqual(['EC', 'debit_NFT', 'oxygene_dissous', 'pH', 'temperature_solution']);
    expect(a.find((x) => x.field === 'pH')!.severity).toBe('danger');
  });
});
