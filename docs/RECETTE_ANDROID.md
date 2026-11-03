# Recette sur appareil Android physique

**Statut : BLOQUÉ — nécessite un humain et un appareil.** Seule une émulation (Chromium, Pixel 7) a été exécutée (`e2e/mobile.spec.ts`).

## Version testable (instance de recette locale, sans production)
Sur un poste de développement (Node 22, `adb` installé, téléphone en USB avec débogage activé) :
```bash
npm ci
npm run recette:android          # build de production + faux Supabase local, comptes alice/bob
adb reverse tcp:3100 tcp:3100 && adb reverse tcp:3199 tcp:3199
# Chrome sur le téléphone → http://localhost:3100
```
`localhost` via `adb reverse` est un contexte sûr : PWA, service worker, installation et hors ligne fonctionnent sans certificat. L'état du faux cloud se consulte sur `http://localhost:3199/__rows`. Pour tester l'installation depuis une URL HTTPS réelle, il faut un **environnement de recette hébergé** (intervention humaine : voir DOSSIER_VALIDATION §5). Instance vérifiée au démarrage : `/login` répond 200 et le faux cloud 200 (aucun appareil n'a pu être branché ici).

## Preuves automatisées déjà obtenues (émulation Chromium, **ne remplacent pas** l'appareil physique)
| Scénario | Preuve émulée | Fichier |
|---|---|---|
| A2, A3, A5, A6 | création hors ligne, rechargement hors ligne, retour réseau → cloud | `e2e/offline-sync.spec.ts` |
| S1, S2, S4 | cloud, second appareil, isolation entre comptes | `e2e/offline-sync.spec.ts` |
| S3 | deux appareils hors ligne, un relevé chacun → les deux conservés partout | `e2e/conflict-delete.spec.ts` |
| S5 | suppression propagée, corbeille, restauration propagée | `e2e/conflict-delete.spec.ts` |
| U1 | pas de défilement horizontal, cibles ≥ 32 px (Pixel 7 émulé) | `e2e/mobile.spec.ts` |
| A1 (partiel) | manifeste, icônes maskable/any, service worker | `e2e/auth-pwa.spec.ts` |
Restent **uniquement testables sur appareil** : rendu réel de l'icône (A1), invite d'installation Chrome, mode avion réel, redémarrage de l'app (A5), B2 (persistance du stockage), U2, U3 (notifications), U4.

## Prérequis
Android 10+ avec Chrome à jour ; URL HTTPS de **recette** (pas la production) ; 2 comptes de test (`recette-a`, `recette-b`) ; si le cloud est testé, un projet Supabase de recette (docs/RECETTE_SUPABASE.md) ; second appareil ou navigateur pour S3–S5. Données fictives uniquement.

## Scénarios (cocher Réussi / Échec, noter version Android, modèle, Chrome, commit)

| # | Scénario | Pas à pas | Résultat attendu |
|---|---|---|---|
| A1 | Installation PWA | Ouvrir l'URL, se connecter, bandeau « Installer » ou menu ⋮ → *Installer l'application* | Icône HydroLoop (verte, non rognée) sur l'écran d'accueil ; ouverture plein écran sans barre d'URL |
| A2 | Préparation hors ligne | En ligne, parcourir Accueil, Données, Réglages, Nouveau batch, un batch ; attendre 10 s | Pas d'erreur ; tout se charge |
| A3 | Création hors ligne | Mode avion → Nouveau batch (souche fictive) → Créer | Bandeau « Mode hors ligne » ; batch créé ; pastille « Hors ligne (1 en attente) » |
| A4 | Relevé hors ligne | Saisir 3 relevés dont un pH 7,2 | Relevés enregistrés ; alerte pH « danger » ; rapport **local** généré (étiqueté sans IA, aucun rendement) |
| A5 | Persistance | Fermer l'app (balayer), rouvrir hors ligne | Batch et relevés intacts |
| A6 | Retour réseau | Désactiver le mode avion | Dans ≤ 1 min pastille « Synchronisé », 0 en attente |
| S1 | Sync vers cloud | Table editor Supabase | Batch présent, `owner_id` = compte, `rev` ≥ 2 |
| S2 | 2ᵉ appareil | Même compte, autre appareil | Batch et relevés présents |
| S3 | Conflit | Appareils A et B hors ligne : A ajoute relevé « r-A », B ajoute « r-B » ; reconnecter tous deux | Les deux relevés présents sur les deux appareils ; événement « Fusion » seulement si un champ a divergé ; *Données → conflits* à jour |
| S4 | Isolation | Se connecter avec l'autre compte | Aucun batch du premier compte |
| S5 | Suppression/restauration | Supprimer sur A ; sync ; vérifier B ; restaurer via *Données → Corbeille* | Suppression propagée ; restauration propagée, relevés conservés |
| B1 | Sauvegarde | *Données* → Exporter JSON ; vider les données du site (Paramètres Chrome) ; se reconnecter ; Importer | Données restaurées (ou re-synchronisées) |
| B2 | Protection stockage | *Données → Protéger le stockage* | « Stockage protégé » (ou refus documenté) |
| U1 | Ergonomie | Tous écrans en portrait + paysage | Pas de défilement horizontal ; boutons ≥ 40 px ; clavier numérique pour les valeurs |
| U2 | Mise à jour | Après un nouveau déploiement, rouvrir | Bandeau « Nouvelle version » → Mettre à jour |
| U3 | Rappels | *Réglages* activer rappels (autoriser notifications) ; laisser un batch > 24 h sans relevé, ouvrir l'app | Une notification « relevés en retard » (max 1 / 6 h) |
| U4 | Session | Déconnexion puis mode avion et rouvrir | Retour à la connexion en ligne ; pages en cache purgées |

Tout échec : joindre capture, heure, étapes ; bloquant si A3–A6, S3, S4 ou B1 échouent.
