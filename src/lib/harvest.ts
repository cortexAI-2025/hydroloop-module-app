export interface HarvestPrediction {
  daysRemaining: number | null;
  estimatedDate: Date | null;
  progressPct: number;
  confidence: 'high' | 'medium' | 'low';
  windowLabel: string;
  trichomeAdvice: string;
}

/**
 * @param floweringDays durée de la phase 3 de la variété ((T − nurserie) / 3) ; 63 par défaut
 *                      pour les lots historiques sans variété.
 */
export function predictHarvest(
  phaseNumber: number,
  phaseDay: number,
  floweringDays = 63,
): HarvestPrediction {
  if (phaseNumber !== 3) {
    return {
      daysRemaining: null,
      estimatedDate: null,
      progressPct: 0,
      confidence: 'low',
      windowLabel: 'Phase de floraison non atteinte',
      trichomeAdvice: 'Continuer la phase végétative / stretch.',
    };
  }

  const remaining = Math.max(0, floweringDays - phaseDay);
  const pct = Math.min(Math.round((phaseDay / floweringDays) * 100), 100);
  const date = new Date();
  date.setDate(date.getDate() + remaining);

  let confidence: HarvestPrediction['confidence'];
  let windowLabel: string;
  let trichomeAdvice: string;

  // Seuils proportionnels à la durée de floraison de la variété (63 j → 35 / 50 / 7 j).
  const earlyUntil = floweringDays * 0.55;
  const midUntil = floweringDays * 0.8;
  const imminentDays = Math.max(2, Math.round(floweringDays * 0.11));

  if (phaseDay < earlyUntil) {
    confidence = 'low';
    windowLabel = `~${remaining} jours restants`;
    trichomeAdvice =
      'Trichomes en formation. Pistils encore majoritairement blancs — récolte prématurée.';
  } else if (phaseDay < midUntil) {
    confidence = 'medium';
    windowLabel = `~${remaining} jours restants`;
    trichomeAdvice =
      'Observer à la loupe ×60. Viser 20–30 % ambrés pour récolte précoce (effet énergisant).';
  } else if (remaining > imminentDays) {
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

  return { daysRemaining: remaining, estimatedDate: date, progressPct: pct, confidence, windowLabel, trichomeAdvice };
}

export function fmtHarvestDate(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
