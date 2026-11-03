export interface HarvestPrediction {
  daysRemaining: number | null;
  estimatedDate: Date | null;
  progressPct: number;
  confidence: 'high' | 'medium' | 'low';
  windowLabel: string;
  trichomeAdvice: string;
  /** Fourchette plausible (jours restants / dates) — l'estimation centrale n'est jamais présentée seule. */
  range: { minDays: number; maxDays: number; earliest: Date; latest: Date } | null;
  /** Hypothèses sur lesquelles repose l'estimation. */
  assumptions: string[];
  /** Niveau d'incertitude exprimé en clair. */
  uncertainty: string;
  /** Rappel : une prévision n'est pas une garantie. */
  disclaimer: string;
  /** `target` = durée cible configurée ; `history` = durées réellement observées sur vos récoltes précédentes. */
  basis: 'target' | 'history' | null;
}

export interface PredictOptions {
  /** Fourchette de durée du niveau 3 (jours) — réglage de l'utilisateur. */
  window?: { minDays: number; maxDays: number };
  /** Durées réelles (jours passés au niveau 3) de batches précédents de la même souche. */
  historyDays?: number[];
}

export const HARVEST_DISCLAIMER =
  'Estimation indicative fondée sur une durée de cycle, pas sur une observation de la plante : seul le contrôle visuel (trichomes, pistils) décide de la récolte.';

/**
 * Prédit la fenêtre de récolte pour un batch au niveau 3.
 * `floweringDays` est la durée cible du niveau 3 (rotation HydroLoop : 20–27 j, 27 par défaut) ;
 * les seuils d'observation sont proportionnels à cette durée.
 */
export function predictHarvest(
  phaseNumber: number,
  phaseDay: number,
  floweringDays = 27,
  now: Date = new Date(),
  opts: PredictOptions = {},
): HarvestPrediction {
  if (phaseNumber !== 3) {
    return {
      daysRemaining: null,
      estimatedDate: null,
      progressPct: 0,
      confidence: 'low',
      windowLabel: 'Phase de floraison non atteinte',
      trichomeAdvice: 'Continuer la phase végétative / stretch.',
      range: null,
      assumptions: [],
      uncertainty: 'Aucune prévision avant le niveau 3.',
      disclaimer: HARVEST_DISCLAIMER,
      basis: null,
    };
  }

  const remaining = Math.max(0, floweringDays - phaseDay);
  const pct = Math.min(Math.round((phaseDay / floweringDays) * 100), 100);
  const date = new Date(now);
  date.setDate(date.getDate() + remaining);
  const early = Math.round(floweringDays * 0.55);
  const mid = Math.round(floweringDays * 0.8);

  let confidence: HarvestPrediction['confidence'];
  let windowLabel: string;
  let trichomeAdvice: string;

  if (phaseDay < early) {
    confidence = 'low';
    windowLabel = `~${remaining} jours restants`;
    trichomeAdvice =
      'Trichomes en formation. Pistils encore majoritairement blancs — récolte prématurée.';
  } else if (phaseDay < mid) {
    confidence = 'medium';
    windowLabel = `~${remaining} jours restants`;
    trichomeAdvice =
      'Observer à la loupe ×60. Viser 20–30 % ambrés pour récolte précoce (effet énergisant).';
  } else if (remaining > 7) {
    confidence = 'high';
    windowLabel = `~${remaining} jours restants`;
    trichomeAdvice =
      'Surveiller quotidiennement. Cible : 50–70 % laiteux + 10–20 % ambrés. Pistils rougeoyants.';
  } else if (remaining > 0) {
    confidence = 'high';
    windowLabel = `Récolte imminente (${remaining}j)`;
    trichomeAdvice =
      '🎯 Fenêtre optimale atteinte. Récolter dans les 5–7 jours pour effet équilibré, ou attendre pour plus de CBD / effet sédatif.';
  } else {
    confidence = 'high';
    windowLabel = 'Fenêtre de récolte dépassée';
    trichomeAdvice =
      '⚠️ Dépasse la durée cible. Vérifier les trichomes — risque de dégradation des cannabinoïdes (CBN).';
  }

  // Fourchette : durées observées sur les récoltes précédentes si on en a assez, sinon plage configurée.
  const hist = (opts.historyDays ?? []).filter((d) => Number.isFinite(d) && d > 0);
  const useHistory = hist.length >= 3;
  const lo = useHistory ? Math.min(...hist) : (opts.window?.minDays ?? Math.min(20, floweringDays));
  const hi = useHistory ? Math.max(...hist) : (opts.window?.maxDays ?? Math.max(27, floweringDays));
  const minDays = Math.max(0, Math.min(lo, hi) - phaseDay);
  const maxDays = Math.max(0, Math.max(lo, hi) - phaseDay);
  const at = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  const assumptions = [
    `Le jour ${phaseDay} du niveau 3 est exact (date d'entrée dans le niveau saisie correctement).`,
    useHistory
      ? `Durée du niveau 3 comprise entre ${lo} et ${hi} jours, d'après ${hist.length} récoltes précédentes de cette souche.`
      : `Durée du niveau 3 comprise entre ${lo} et ${hi} jours (plage configurée, non vérifiée sur vos données).`,
    `Estimation centrale : durée cible de ${floweringDays} jours.`,
    'Les conditions de culture restent conformes aux plages configurées jusqu’à la récolte.',
  ];
  const uncertainty = useHistory
    ? `Incertitude moyenne : fourchette de ${maxDays - minDays} jour(s) tirée de votre historique.`
    : `Incertitude élevée : aucune donnée de récolte précédente suffisante (${hist.length}/3) — fourchette de ${maxDays - minDays} jour(s) issue de la configuration.`;

  return {
    daysRemaining: remaining, estimatedDate: date, progressPct: pct, confidence, windowLabel, trichomeAdvice,
    range: { minDays, maxDays, earliest: at(minDays), latest: at(maxDays) },
    assumptions, uncertainty, disclaimer: HARVEST_DISCLAIMER, basis: useHistory ? 'history' : 'target',
  };
}

export function fmtHarvestDate(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
