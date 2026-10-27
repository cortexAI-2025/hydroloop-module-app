export type VarietyStatus = 'exemple' | 'a_verifier' | 'verifie';

export const VARIETY_STATUS_LABELS: Record<VarietyStatus, string> = {
  exemple: 'Exemple',
  a_verifier: 'À vérifier',
  verifie: 'Vérifié',
};

/** Variété autofloraison. Chaque variété porte ses propres durées. */
export interface Variety {
  id: string;
  name: string;
  breeder: string;
  /** Nurserie (germination → plantule), jours. */
  nurseryDays: number;
  /** Durée totale seed-to-yield, jours. */
  totalDays: number;
  /** Hauteur adulte, cm (40 à 120 cm max dans les modules). */
  heightMinCm?: number;
  heightMaxCm?: number;
  /** Taux indicatifs en %, non bloquants (légal CBD ou récréatif selon le client). */
  thcPct?: number;
  cbdPct?: number;
  status: VarietyStatus;
  /** Origine de la donnée (URL, COA, fiche breeder…). */
  source?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type VarietyDraft = Omit<Variety, 'id' | 'createdAt' | 'updatedAt'>;
