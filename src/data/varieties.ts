import type { VarietyDraft } from '../types/variety';

/**
 * Variétés fournies avec l'application.
 *
 * Aucune variété commerciale n'est préchargée : les durées, tailles et taux doivent venir
 * des fiches breeder / COA. Importer le catalogue (GTR Seeds, etc.) depuis la page /varieties
 * (CSV) ; chaque ligne importée est marquée « À vérifier » tant qu'elle n'est pas confirmée.
 *
 * Seul l'exemple de référence (12 j de nurserie + 3 × 22 j = 78 j) est fourni, pour tester le calcul.
 */
export const SEED_VARIETIES: VarietyDraft[] = [
  {
    name: 'Exemple 78 jours',
    breeder: '—',
    nurseryDays: 12,
    totalDays: 78,
    status: 'exemple',
    notes: 'Exemple de cycle 12 + 3 × 22 jours. À remplacer par de vraies variétés.',
  },
];
