# HydroLoop™ Farm Manager — V1.0

Application de suivi de culture pour les modules **HydroLoop Farm** (A-Frame NFT, 3 niveaux à boucles nutritives indépendantes, rotation des cohortes tous les 20 à 27 jours). Installable sur Android (PWA), **entièrement utilisable hors ligne**, avec synchronisation cloud (Supabase) qui ne perd ni n'écrase aucune donnée.

> Concept, conception et brevet : **Ahmed Akafou**. Application : **AIWorkPay** — contact@aiworkpay.fr.

## Garanties de fiabilité (V1.0)

- **Enregistrement local d'abord** : toute saisie est écrite dans IndexedDB avant tout appel réseau ; le réseau n'est jamais nécessaire pour saisir.
- **Aucune perte silencieuse** : modifications simultanées sur deux appareils → les relevés et événements sont *réunis* ; les valeurs écartées sont consignées dans le journal du batch. Une version ancienne ne remplace jamais une version récente. → [docs/SYNCHRONISATION.md](docs/SYNCHRONISATION.md)
- **Isolation par utilisateur** : une base locale par compte, et côté cloud des politiques RLS PostgreSQL (testées). → [docs/SECURITE.md](docs/SECURITE.md)
- **Sauvegarde/restauration** : export JSON/CSV, import par fusion, copies de sécurité automatiques, corbeille. → [docs/SAUVEGARDE_RESTAURATION.md](docs/SAUVEGARDE_RESTAURATION.md)
- **Agronomie transparente** : seuils configurables et documentés, prévisions avec hypothèses, fourchette et incertitude ; le rapport distingue mesures, calculs et recommandations. → [docs/SEUILS.md](docs/SEUILS.md)

## Installation (développement)

Prérequis : Node.js 22, npm.

```bash
npm ci
cp .env.example .env.local     # puis renseigner (voir ci-dessous)
npm run dev                    # http://localhost:3000
```

Sans aucune variable, l'application fonctionne en local, sans compte, avec rapports locaux (sans IA).
**En production**, l'application refuse de servir sans comptes (`AUTH_USERS`) — c'est voulu.

### Variables d'environnement

Voir [.env.example](.env.example) (aucun secret réel). Principales :

| Variable | Rôle |
|---|---|
| `AUTH_USERS` | Comptes `nom:secret,…` (secret en clair ou haché : `npm run auth:hash -- "mot de passe"`). |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Sessions (obligatoire en production). |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Rapports IA (facultatif ; sans clé : rapport local). |
| `AI_*` | Plafonds de coût de l'IA. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` | Synchronisation cloud → [docs/SUPABASE.md](docs/SUPABASE.md). |

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Développement / build / production |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript strict |
| `npm test` | Tests unitaires, intégration, API, RLS (Vitest) |
| `npm run e2e` | Tests de bout en bout (Playwright : hors ligne, PWA, auth, accessibilité, Android) |
| `npm run auth:hash -- "mdp"` | Haché scrypt pour `AUTH_USERS` |

Tests et résultats : [docs/TESTS.md](docs/TESTS.md).

## Documentation

| Document | Contenu |
|---|---|
| [docs/GUIDE_UTILISATEUR.md](docs/GUIDE_UTILISATEUR.md) | Utilisation quotidienne, hors ligne, installation Android |
| [docs/SUPABASE.md](docs/SUPABASE.md) | Mise en place du cloud, RLS, migration depuis la V0 |
| [docs/SYNCHRONISATION.md](docs/SYNCHRONISATION.md) | Modèle de synchro, règles de fusion, cas limites |
| [docs/SEUILS.md](docs/SEUILS.md) | Seuils par défaut, justification, configuration, prévisions |
| [docs/SECURITE.md](docs/SECURITE.md) | Authentification, isolation, en-têtes, limites, risques résiduels |
| [docs/SAUVEGARDE_RESTAURATION.md](docs/SAUVEGARDE_RESTAURATION.md) | Procédures de sauvegarde et de restauration |
| [docs/CHECKLIST_DEPLOIEMENT.md](docs/CHECKLIST_DEPLOIEMENT.md) | Liste de contrôle avant mise en production |
| [docs/DOSSIER_VALIDATION.md](docs/DOSSIER_VALIDATION.md) | **Dossier de recette** : preuves, verdicts, blocages |
| [docs/RECETTE_SUPABASE.md](docs/RECETTE_SUPABASE.md) · [docs/RECETTE_ANDROID.md](docs/RECETTE_ANDROID.md) · [docs/VALIDATION_AGRONOMIQUE.md](docs/VALIDATION_AGRONOMIQUE.md) · [docs/RISQUES_RESIDUELS.md](docs/RISQUES_RESIDUELS.md) | Procédures de recette humaines |
| [docs/RELEASE_NOTES_V1.0.md](docs/RELEASE_NOTES_V1.0.md) | Nouveautés, changements incompatibles, limites connues |

## Structure

```
src/app/            pages (tableau de bord, batch, passeport, analytiques, données, réglages) et routes API
src/components/     OwnerGate (identité + synchro), PwaRegister (hors ligne/installation), formulaires, graphiques
src/lib/db.ts       IndexedDB v2 (une base par compte), instantanés, persistance
src/lib/storage.ts  opérations sur les batches, sauvegarde/import par fusion, corbeille
src/lib/merge.ts    fusion déterministe de deux versions d'un batch
src/lib/sync/       moteur de synchro (indépendant du réseau), client Supabase, jeton
src/lib/analysis.ts, harvest.ts, report-local.ts, thresholds.ts   agronomie
supabase/migrations schéma + RLS ; supabase/rls.test.ts les teste sur PostgreSQL (PGlite)
e2e/                Playwright + faux serveur Supabase
```
