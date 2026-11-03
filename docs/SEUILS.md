# Seuils agronomiques et prévisions

Tous les seuils sont **configurables** (menu *Réglages*, par utilisateur, stockés localement) et documentés ci-dessous. Les valeurs par défaut sont **indicatives** : elles reprennent le dossier technique HydroLoop et les pratiques courantes en NFT, sans prétendre convenir à toutes les variétés. **À valider par votre responsable de culture.**

| Paramètre | Plage par défaut | Gravité | Justification |
|---|---|---|---|
| pH solution | 5,5 – 6,5 | Danger | Hors plage, blocage de l'absorption de plusieurs éléments. |
| EC (mS/cm) | 0,8 – 3,0 (général) | Avertissement | Plage large ; la cible précise dépend du niveau (ci-dessous). |
| O₂ dissous (mg/L) | ≥ 6 | Danger | Sous 6 mg/L, risque d'asphyxie racinaire. |
| T° solution (°C) | ≤ 22 | Avertissement | Solution chaude : moins d'oxygène, plus de pathogènes. |
| Débit NFT (L/min) | ≥ 0,5 | Avertissement | Risque de zones sèches. |
| T° air jour / nuit (°C) | 18–30 / 12–24 | Avertissement | Plages larges de confort. |
| Humidité (%) | 35 – 75 | Avertissement | Risque fongique au-delà, stress en dessous. |
| PPFD | désactivé | — | Dépend de la phase et du matériel d'éclairage. |

**EC cible par niveau** : N1 1,2–1,6 · N2 1,8–2,2 · N3 2,4–2,8 mS/cm (dossier technique). Hors cible mais dans la plage générale → information (pas d'alerte).

**Durées** : 21 / 21 / 27 jours par niveau par défaut (rotation 20–27 j) ; relevé « en retard » après 24 h ; fourchette de durée du niveau 3 : 20–27 j.

**Règles d'analyse** (`src/lib/analysis.ts`) : valeur hors plage ; problème *persistant* (3 relevés consécutifs) ; *dérive* (pente de régression linéaire par jour au-delà du seuil, minimum 4 relevés sur 24 h) ; *saut* entre deux relevés consécutifs ; relevé en retard ; durée de niveau dépassée. Chaque constat porte sa provenance : **mesure** (saisie), **calcul** (pente, durée…) ou **règle** (conclusion d'un seuil). Une règle n'est pas un diagnostic.

## Prévision de récolte

Toujours présentée avec : une **fourchette** (jours et dates), les **hypothèses**, un **niveau d'incertitude** et l'avertissement « seul le contrôle visuel décide ». Sans historique de récoltes de la souche (< 3), la fourchette vient de la configuration et l'incertitude est dite *élevée* ; à partir de 3 récoltes, elle vient des durées réellement observées. Elle n'est jamais une garantie.

## Rapports : mesuré / calculé / recommandé

- **Rapport local (sans IA)** : sections *Mesures observées*, *Calculs*, *Anomalies et recommandations (règles)*, *Prévision*. Aucune biomasse ni rendement n'est inventé.
- **Rapport IA** : le prompt impose les étiquettes `[MESURÉ]`, `[CALCULÉ]`, `[ESTIMATION]`, `[RECOMMANDATION]`. Les estimations de biomasse/rendement sont des ordres de grandeur ; seule la pesée fait foi.
- Hors ligne, IA non configurée, limite de coût atteinte ou erreur du service : bascule automatique sur le rapport local, avec la raison indiquée.
