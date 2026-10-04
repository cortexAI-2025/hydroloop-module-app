import { describe, expect, it } from 'vitest';
import { fromRow, toRow } from './sync';
import { normalizeRecord, recordHarvest } from './tracking';
import type { BatchRecord } from '@/types/batch';

const base: BatchRecord = {
  id: 'B1', createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-02T08:00:00.000Z',
  data: {
    BATCH_ID: 'B1', SOUCHE: 'S', PHASE_NUMBER: 3, PHASE_DAY: 3, MODULE_TYPE: 48, DATE_SEMIS: '2026-08-01',
    DONNEES_ENVIRONNEMENTALES: { temperature_air_jour: 24, temperature_air_nuit: 18, humidite_relative: 55, pH: 6, EC: 2.5,
      temperature_solution: 20, debit_NFT: 0.8, oxygene_dissous: 7, PPFD: 800, photopériode: '12/12' },
    HISTORIQUE_TAILLES: '', DERNIERS_RELEVES_RACINAIRES: '',
  },
};

describe('conversion ligne Supabase', () => {
  it('fait l’aller-retour sans perte du suivi', () => {
    const r = recordHarvest(normalizeRecord(base), { date: '2026-09-02T00:00:00.000Z', plantsHarvested: 48, freshWeightKg: 12, operator: 'A' });
    const back = fromRow(JSON.parse(JSON.stringify(toRow(r))));
    expect(back).toEqual(JSON.parse(JSON.stringify(r)));
  });

  it('lit une ligne v1 sans colonne tracking', () => {
    const row = { ...toRow(base), tracking: null };
    expect(fromRow(row)).toEqual({ ...base, report: undefined });
  });
});
