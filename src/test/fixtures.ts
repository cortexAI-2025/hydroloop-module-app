import type { BatchRecord, EnvironmentalData, TrackedBatch } from '@/types/batch';
import { normalizeRecord } from '@/lib/tracking';

/** Données fictives pour les tests — aucune donnée réelle. */
export const ENV: EnvironmentalData = {
  temperature_air_jour: 24, temperature_air_nuit: 18, humidite_relative: 55, pH: 6.0, EC: 1.4,
  temperature_solution: 20, debit_NFT: 0.8, oxygene_dissous: 7.5, PPFD: 600, photopériode: '18/6',
};

export function makeRecord(id = 'B2026-09-01-AAAA', over: Partial<BatchRecord['data']> = {}, at = '2026-09-01T08:00:00.000Z'): TrackedBatch {
  return normalizeRecord({
    id, createdAt: at, updatedAt: at,
    data: {
      BATCH_ID: id, SOUCHE: 'Souche Test', PHASE_NUMBER: 1, PHASE_DAY: 1, MODULE_TYPE: 48, MODULE_ID: 'M-01',
      DATE_SEMIS: '2026-08-22', DONNEES_ENVIRONNEMENTALES: ENV, HISTORIQUE_TAILLES: '', DERNIERS_RELEVES_RACINAIRES: '', ...over,
    },
  });
}

/** Ajoute un relevé fictif avec un identifiant déterministe. */
export function withReading<T extends BatchRecord>(r: T, rid: string, at: string, env: Partial<EnvironmentalData> = {}): T & { readings: NonNullable<BatchRecord['readings']> } {
  return {
    ...r,
    updatedAt: at,
    readings: [...(r.readings ?? []), { id: rid, at, phase: r.data.PHASE_NUMBER as 1 | 2 | 3, env: { ...ENV, ...env } }],
  };
}
