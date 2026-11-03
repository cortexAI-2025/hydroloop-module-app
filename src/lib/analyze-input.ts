import type { BatchFormData } from '@/types/batch';
import type { TrackingContext } from './system-prompt';

export const MAX_BODY_BYTES = 64 * 1024;

const ENV_KEYS = [
  'temperature_air_jour', 'temperature_air_nuit', 'humidite_relative', 'pH', 'EC', 'temperature_solution', 'debit_NFT', 'oxygene_dissous', 'PPFD',
] as const;

export type AnalyzeBody = BatchFormData & { tracking?: TrackingContext };

const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

/** Valide et assainit le corps de la requête d'analyse. Retourne le corps nettoyé ou un message d'erreur. */
export function parseAnalyzeBody(raw: unknown): { ok: true; body: AnalyzeBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Corps de requête invalide.' };
  const b = raw as Record<string, unknown>;
  if (!str(b.BATCH_ID, 80) || !b.BATCH_ID) return { ok: false, error: 'BATCH_ID manquant ou trop long.' };
  if (!str(b.SOUCHE, 120) || !b.SOUCHE) return { ok: false, error: 'SOUCHE manquante ou trop longue.' };
  if (![1, 2, 3].includes(b.PHASE_NUMBER as number)) return { ok: false, error: 'PHASE_NUMBER doit valoir 1, 2 ou 3.' };
  if (!Number.isFinite(b.PHASE_DAY) || (b.PHASE_DAY as number) < 0 || (b.PHASE_DAY as number) > 400) return { ok: false, error: 'PHASE_DAY invalide.' };
  if (!Number.isFinite(b.MODULE_TYPE) || (b.MODULE_TYPE as number) < 1 || (b.MODULE_TYPE as number) > 10_000) return { ok: false, error: 'MODULE_TYPE invalide.' };
  for (const k of ['MODULE_ID', 'OPERATEUR', 'DATE_SEMIS'] as const) if (b[k] !== undefined && !str(b[k], 120)) return { ok: false, error: `${k} invalide.` };
  for (const k of ['HISTORIQUE_TAILLES', 'DERNIERS_RELEVES_RACINAIRES', 'notes'] as const) if (b[k] !== undefined && !str(b[k], 4000)) return { ok: false, error: `${k} trop long (4000 caractères max).` };
  const env = b.DONNEES_ENVIRONNEMENTALES as Record<string, unknown> | undefined;
  if (!env || typeof env !== 'object') return { ok: false, error: 'DONNEES_ENVIRONNEMENTALES manquantes.' };
  for (const k of ENV_KEYS) if (typeof env[k] !== 'number' || !Number.isFinite(env[k] as number) || Math.abs(env[k] as number) > 1e5) return { ok: false, error: `Valeur invalide pour ${k}.` };
  if (!str(env.photopériode, 20)) return { ok: false, error: 'photopériode invalide.' };

  const tracking = b.tracking;
  if (tracking !== undefined && (typeof tracking !== 'object' || tracking === null || JSON.stringify(tracking).length > 20_000)) return { ok: false, error: 'Contexte de suivi invalide ou trop volumineux.' };
  return { ok: true, body: b as unknown as AnalyzeBody };
}
