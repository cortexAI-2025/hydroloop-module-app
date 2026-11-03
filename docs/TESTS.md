# Tests — matrice et résultats

Toutes les données sont fictives. Résultats de la dernière exécution (Node 22, 2026-11-03) :

| Commande | Résultat |
|---|---|
| `npm run lint` | OK (0 erreur) |
| `npm run typecheck` | OK |
| `npm test` | **14 fichiers, 134 tests passés, 7 ignorés** (recettes Supabase ×5 et Anthropic ×2 : exigent un environnement de test autorisé, voir DOSSIER_VALIDATION.md) |
| `npm run build` | OK (Next.js 15.5, 15 routes + middleware) |
| `npm run e2e` | **10 tests passés** (Chromium desktop + émulation Pixel 7), dont conflit et suppression/restauration |
| `npm audit --omit=dev` | 0 vulnérabilité |
| `npm run check:bundle` | aucun secret serveur dans le code client (contrôle négatif vérifié) |
| `npm audit` (dev inclus) | 14 modérées, toutes dans l'outillage ESLint (minimatch) — hors production |

| Exigence | Fichiers |
|---|---|
| Calculs agronomiques | `analysis.test.ts`, `thresholds.test.ts`, `harvest.test.ts`, `tracking.test.ts` |
| Fusion / synchro / conflits / doublons / hors ligne | `merge.test.ts`, `sync/engine.test.ts`, `e2e/offline-sync.spec.ts` |
| IndexedDB, sauvegarde, migration v1→v2, isolation locale | `storage.test.ts` |
| RLS Supabase (PostgreSQL réel via PGlite) | `supabase/rls.test.ts` (19 tests) |
| Auth, JWT, limiteurs | `security.test.ts`, `session.test.ts`, `middleware.test.ts`, `api/sync/token/route.test.ts`, `e2e/auth-pwa.spec.ts` |
| API IA (SDK simulé) | `api/analyze/route.test.ts` |
| PWA (manifeste, icônes, SW, hors ligne) | `e2e/auth-pwa.spec.ts`, `e2e/offline-sync.spec.ts` |
| Accessibilité WCAG 2.1 A/AA (axe) | `e2e/a11y.spec.ts` |
| Android (pas de défilement horizontal, cibles tactiles) | `e2e/mobile.spec.ts` |
| Non-régression + build de production | suite complète + `next build` en CI |

CI GitHub Actions : verte sur `c417424` (runs #2, #3). Dossier complet : [DOSSIER_VALIDATION.md](DOSSIER_VALIDATION.md).

Non couvert : Supabase réel, API Anthropic réelle, appareil Android physique.
