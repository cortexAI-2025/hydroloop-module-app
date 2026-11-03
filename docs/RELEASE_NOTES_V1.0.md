# HydroLoop Farm Manager V1.0 — notes de version

## Nouveautés
Fiabilité des données (IndexedDB v2, file d'attente persistante, synchro bidirectionnelle avec fusion sans perte, doublons, corbeille, copies automatiques, import par fusion) · isolation par compte (local + RLS) · multi-utilisateurs · seuils configurables et documentés · analyse d'historique (dérives, persistance, sauts) · prévisions avec fourchette/hypothèses/incertitude · rapport local sans IA et rapport IA étiqueté · IA durcie (validation, plafonds, erreurs propres) · PWA complète (icônes PNG, hors ligne, installation, mise à jour) · accessibilité WCAG 2.1 AA vérifiée · sécurisé par défaut, en-têtes CSP/HSTS · CI GitHub Actions.

## Changements incompatibles
- Production sans `AUTH_USERS` → refus de servir (ou `ALLOW_ANONYMOUS=true`).
- Table Supabase `batches` : nouveau schéma `(owner_id, id)` avec RLS ; migration V0 documentée. La synchro exige l'authentification.
- Les rapports de secours ne contiennent plus d'estimations de rendement inventées.
- `.env.local.example` renommé `.env.example` ; nouvelles variables.

## Limites connues / non validé
- **Supabase réel non testé** (pas d'accès réseau/clés) : RLS validées sur PostgreSQL local (PGlite), synchro validée contre un faux serveur PostgREST ; accepter le JWT HS256 maison dépend de la configuration du projet.
- **IA réelle non testée** (pas de clé) : routes testées avec SDK simulé.
- Test sur appareil Android réel non réalisé (émulation Chromium Pixel 7).
- Valeurs de seuils par défaut à valider agronomiquement.
- Branche `origin/feat/varieties-modules-cycle` non fusionnée ; branche par défaut du dépôt inchangée.
- Quelques alertes `npm audit` modérées côté outils de développement uniquement.
