# Grille de validation agronomique des seuils par défaut

**Statut : BLOQUÉ — validation par un responsable de culture requis.** Les valeurs ci-dessous sont des *propositions documentées*, non validées agronomiquement. Compléter, signer, puis reporter les ajustements dans `src/lib/thresholds.ts` (`DEFAULT_THRESHOLDS`) ou les régler dans *Réglages*.

Valideur : ____________ Date : ________ Variétés/installation concernées : ____________

| Paramètre | Valeur proposée | Source/justification | Valide ? | Valeur retenue | Sévérité retenue | Commentaire |
|---|---|---|---|---|---|---|
| pH min–max | 5,5 – 6,5 | Disponibilité des nutriments en NFT | ☐ O ☐ N | | ☐ Avert. ☐ Danger | |
| EC générale | 0,8 – 3,0 mS/cm | Plage large de sécurité | ☐ O ☐ N | | | |
| EC niveau 1 | 1,2 – 1,6 | Dossier technique HydroLoop | ☐ O ☐ N | | | |
| EC niveau 2 | 1,8 – 2,2 | idem | ☐ O ☐ N | | | |
| EC niveau 3 | 2,4 – 2,8 | idem | ☐ O ☐ N | | | |
| O₂ dissous | ≥ 6 mg/L | Prévention de l'asphyxie racinaire | ☐ O ☐ N | | | |
| T° solution | ≤ 22 °C | Oxygène et pathogènes racinaires | ☐ O ☐ N | | | |
| Débit NFT | ≥ 0,5 L/min | Pas de zones sèches (dépend de la gouttière 200/300/400 mm) | ☐ O ☐ N | | | |
| T° air jour / nuit | 18–30 / 12–24 °C | Plages larges de confort | ☐ O ☐ N | | | |
| Humidité | 35 – 75 % | Risque fongique / stress | ☐ O ☐ N | | | |
| PPFD | désactivé | Dépend du matériel et de la phase | ☐ Activer : ____ | | | |
| Relevé en retard | 24 h | Rythme de surveillance | ☐ O ☐ N | | | |
| Durée des niveaux | 21 / 21 / 27 j | Rotation 20–27 j | ☐ O ☐ N | | | |
| Fourchette niveau 3 (prévision) | 20 – 27 j | Idem | ☐ O ☐ N | | | |
| Dérive (pente/jour) | pH 0,3 · EC 0,3 · O₂ −0,5 · T° 1 | Heuristique | ☐ O ☐ N | | | |
| Saut entre relevés | pH 0,6 · EC 0,7 · O₂ 2,5 · T° 3 | Heuristique (détecte erreurs de saisie/capteur) | ☐ O ☐ N | | | |
| Problème persistant | 3 relevés consécutifs | Heuristique | ☐ O ☐ N | | | |

## Revue des textes
| Élément | À vérifier | OK |
|---|---|---|
| Recommandations de `analysis.ts` | Pertinence et prudence (pH+/pH−, dilution, oxygénation) | ☐ |
| Conseil trichomes (`harvest.ts`) | Pertinence pour vos variétés ; formulation | ☐ |
| Prévision de récolte | Fourchette réaliste après ≥ 3 récoltes réelles | ☐ |
| Prompt IA | Étiquettes [MESURÉ]/[CALCULÉ]/[ESTIMATION]/[RECOMMANDATION] respectées sur 5 rapports réels | ☐ |

## Test de cohérence sur cas fictifs (à rejouer)
Saisir : pH 7,2 → alerte danger + recommandation ; O₂ 8,5→6,5 sur 5 jours → dérive ; EC 2,0 au niveau 1 → information « hors cible du niveau » ; relevé vieux de 30 h → « en retard ». Ces cas sont couverts par `analysis.test.ts`.
