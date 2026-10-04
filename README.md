# HydroLoop™ Farm Manager

Application de suivi de culture pour les modules **HydroLoop Farm** (A-Frame NFT, 3 niveaux à boucles nutritives indépendantes, rotation des cohortes tous les 20 à 27 jours). Elle s'installe sur téléphone (PWA), fonctionne hors ligne et synchronise les données dans le cloud quand le réseau revient.

## Fonctionnalités

| Domaine | Ce que fait l'application |
|---|---|
| **Batches** | Création d'une cohorte (souche, module A-Frame, nombre de plants, responsable, date de semis, niveau de départ, premier relevé). |
| **Relevés** | Saisie rapide pré-remplie (pH, EC, O₂ dissous, T° solution, débit NFT, T° air, humidité, PPFD, photopériode), horodatée, avec opérateur et observation. Alertes immédiates. |
| **Rotation** | Jour dans le niveau calculé automatiquement, durée cible par niveau (21/21/27 j par défaut, modifiable), bouton « Monter au niveau suivant », vue « Rotation par module ». |
| **Journal** | Tailles, contrôles racinaires, traitements, notes ; chaque action est horodatée et signée. |
| **Récolte** | Masse fraîche, plants, rendement g/plante, température et délai de congélation, n° de lot, destination. Clôt le batch. |
| **Tendances** | Courbes par paramètre avec plage cible (EC jugée selon le niveau de chaque relevé) et tableau complet des relevés. |
| **Rapport IA** | Analyse racines / feuilles / trims / fleurs par Claude, nourrie des tendances, du journal et de l'historique de la souche. Rapport de secours local si l'IA est indisponible. |
| **Traçabilité** | Passeport de lot **Taqnin ID Batch** imprimable avec QR code, étiquette QR à coller sur le module. |
| **Tableau de bord** | Actions à faire (relevé en retard > 24 h, niveau prêt à monter, récolte, alerte critique), filtres et recherche. |
| **Analytiques** | Alertes sur l'ensemble des relevés, rendements par souche, moyennes, activité. |
| **Données** | État de la configuration, synchronisation manuelle, sauvegarde JSON, import/fusion, export CSV des relevés. |

## Démarrage

```bash
npm install
cp .env.local.example .env.local   # puis renseigner les variables utiles
npm run dev                        # http://localhost:3000
```

Toutes les variables sont optionnelles : sans elles, l'application fonctionne en local (IndexedDB) avec des rapports de secours.

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | Active les rapports IA. |
| `ANTHROPIC_MODEL` | Modèle utilisé (défaut `claude-opus-5-5`). |
| `AUTH_USERNAME`, `AUTH_PASSWORD` | Activent la connexion par mot de passe. |
| `NEXTAUTH_SECRET` | **Obligatoire en production** si la connexion est activée (`openssl rand -base64 32`). |
| `NEXTAUTH_URL` | URL publique de l'application. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Activent la synchronisation cloud. |

### Supabase

Dans l'éditeur SQL du projet :

```sql
CREATE TABLE IF NOT EXISTS batches (
  id         TEXT PRIMARY KEY,
  data       JSONB       NOT NULL,
  report     TEXT,
  tracking   JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
-- Base créée avec la v1 de l'application :
ALTER TABLE batches ADD COLUMN IF NOT EXISTS tracking JSONB;
```

> ⚠️ La clé `anon` est publique (elle est envoyée au navigateur). Sans politique RLS, toute personne qui la récupère peut lire et modifier la table. Réservez le projet Supabase à cette application et activez des politiques RLS adaptées avant d'y stocker des données sensibles.

La synchronisation a lieu au démarrage, au retour du réseau, au retour sur l'onglet et toutes les 5 minutes. Les modifications faites hors ligne sont mises en file d'attente. En cas de conflit, la version la plus récente de chaque batch l'emporte ; les suppressions sont propagées (suppression logique).

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` / `npm start` | Build et serveur de production |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Tests unitaires (Vitest) |

## Déploiement

Application Next.js 15 standard : Vercel (recommandé) ou tout hébergeur Node 18+. Renseigner les variables d'environnement ci-dessus, en particulier `NEXTAUTH_SECRET` si la connexion est activée. La route `/api/analyze` diffuse le rapport en streaming (durée max. 300 s).

## Structure

```
src/
  app/                 pages (tableau de bord, batch, passeport, analytiques, données) et routes API
  components/          formulaires de suivi, graphiques, QR, synchronisation
  lib/tracking.ts      logique de suivi (jours de niveau, relevés, rotation, récolte, export CSV)
  lib/storage.ts       persistance IndexedDB, sauvegarde / import
  lib/sync.ts          synchronisation Supabase avec file d'attente hors ligne
  lib/system-prompt.ts prompt de l'analyse IA
  types/batch.ts       modèle de données
```

Concept, conception et brevet : **Ahmed Akafou**. Application : **AIWorkPay** — contact@aiworkpay.fr.
