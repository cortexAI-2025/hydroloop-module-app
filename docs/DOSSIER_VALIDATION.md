# Dossier de validation technique — HydroLoop Farm V1.0 (recette finale)

PR #2 · branche `feature/hydroloop-v1-finalization` · aucune fusion, aucun déploiement, aucune ressource de production touchée.

## 1. Preuves vérifiées

| Contrôle | Résultat | Source |
|---|---|---|
| CI GitHub Actions sur `c417424` (push + pull_request) et sur `3101b0b` (push) | ✅ **success** (jobs qualité + e2e) | runs #2, #3, #4 |
| CI sur `78f4bb6` | ❌ échec **typecheck** (erreur de typage dans `e2e/a11y.spec.ts`), corrigé dans `c417424` ; e2e du même run : ✅ | run #1 |
| lint · typecheck | ✅ | exécution locale |
| Tests unitaires/intégration/API/RLS | ✅ **14 fichiers, 134 tests passés** (+5 « recette Supabase » volontairement ignorés, voir blocage) | `npm test` |
| Build production | ✅ | `next build` (CI + local) |
| E2E navigateur | ✅ **8/8** (hors ligne→en ligne, 2 appareils, isolation, PWA, auth, axe WCAG AA, Pixel 7 émulé) | `npm run e2e` |
| Audit production | ✅ 0 vulnérabilité (`--audit-level=high`) ; 14 modérées dev uniquement | `npm audit` |

## 2. Scénarios demandés

| Demande | Vérifié | Où |
|---|---|---|
| Synchronisation | ✅ envoi après coupure, 2ᵉ appareil, curseur, rien à renvoyer si à jour | `sync/engine.test.ts`, e2e |
| Conflits | ✅ modifications concurrentes réunies ; écriture concurrente pendant l'envoi (CAS) ; doublon d'id ; convergence A/B ; fusion commutative et idempotente | `engine.test.ts`, `merge.test.ts` |
| Suppression logique | ✅ propagée ; **n'écrase jamais une activité plus récente** ; données conservées dans le batch supprimé | `engine.test.ts` (nouveaux tests) |
| Restauration | ✅ restauration par activité postérieure propagée aux deux appareils ; corbeille ; copies de sécurité | `engine.test.ts`, `storage.test.ts` |
| Jeton expiré | ✅ file d'attente intacte | `engine.test.ts` |
| Authentification | ✅ hachage scrypt, temps constant, verrouillage 5 échecs/15 min par (IP, compte) sans effet sur les autres, redirection/401, 503 sans secret, durée de session configurable, jeton de synchro lié à la session, e2e connexion | `security.test.ts`, `session.test.ts`, `middleware.test.ts`, `token/route.test.ts`, e2e |
| Politiques RLS (PostgreSQL réel local) | ✅ **19 tests** : anon, isolation, usurpation, transfert, DELETE/TRUNCATE/DDL, contraintes, révision, horodatage serveur, suppression logique, RLS forcée, 3 politiques `authenticated` | `supabase/rls.test.ts` |

## 3. Éléments bloqués (intervention humaine) — procédures fournies

| Blocage | Pourquoi | Procédure |
|---|---|---|
| Projet Supabase de recette | Aucun accès réseau/identifiants ; la production ne doit pas servir | `docs/RECETTE_SUPABASE.md` + `supabase/recette/verify.sql` + `npm run recette:supabase` (garde-fou `RECETTE_CONFIRM`) |
| Android physique | Pas d'appareil | `docs/RECETTE_ANDROID.md` (17 scénarios, résultats attendus) |
| Validation agronomique | Expertise métier | `docs/VALIDATION_AGRONOMIQUE.md` (grille à signer) |
| API Anthropic réelle | Pas de clé | Test manuel : 5 rapports réels, vérifier les étiquettes (grille agronomique) |
| Branches / branche par défaut | Décision produit / droits | `docs/RISQUES_RESIDUELS.md` |

## 4. Verdicts distincts

| Domaine | Verdict | Justification |
|---|---|---|
| **Qualité logicielle** | ✅ **GO** | CI verte sur le dernier commit, 134 tests unitaires/intégration/RLS + 8 e2e, build OK, lint/types OK, 0 vulnérabilité de production, accessibilité vérifiée. Restent des tests sur services réels (ci-dessous). |
| **Sécurité des données** | 🟠 **GO conditionnel** | Isolation locale, RLS (19 tests sur PostgreSQL réel), authentification, fusion sans perte et sauvegardes vérifiées. **Condition** : succès de la recette Supabase isolée (acceptation du JWT, CORS, RLS sur le vrai service) ; limiteurs à renforcer en multi-instances ; données locales non chiffrées (accepté, documenté). |
| **Validation agronomique** | ⛔ **NO-GO (non réalisée)** | Les seuils/recommandations par défaut sont des propositions non validées par un responsable de culture. Grille fournie. L'application reste utilisable : tous les seuils sont réglables. |
| **Mise en production** | ⛔ **NO-GO** | Bloquée par : recette Supabase, recette Android physique, validation agronomique, décisions sur branches. Aucune de ces vérifications n'a été simulée. Ouverture possible à une **recette utilisateur sur environnement de test** dès maintenant. |

## 5. Ordre recommandé
1. Projet Supabase de recette → `verify.sql` → `npm run recette:supabase` → corriger si besoin.
2. Déploiement de **recette** → scénarios `RECETTE_ANDROID.md`.
3. Grille agronomique signée → ajuster `DEFAULT_THRESHOLDS`.
4. Décisions : branche `feat/varieties-modules-cycle`, branche par défaut.
5. `CHECKLIST_DEPLOIEMENT.md` → autorisation explicite de fusion/déploiement.
