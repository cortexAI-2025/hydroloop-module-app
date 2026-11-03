# Sécurité

## Authentification
- Comptes déclarés côté serveur : `AUTH_USERS` (mots de passe en clair ou hachés **scrypt** via `npm run auth:hash`). Comparaison en temps constant, calcul de hachage factice pour un compte inconnu (pas de fuite par le temps de réponse).
- Verrouillage après 5 échecs consécutifs par (IP, compte) pendant 15 min. Sessions JWT NextAuth, durée `SESSION_MAX_AGE_HOURS`.
- **Sécurisé par défaut** : en production, sans `AUTH_USERS`, le middleware répond 503 (sauf `ALLOW_ANONYMOUS=true`, réservé à un poste local de confiance). Sans `NEXTAUTH_SECRET` en production : 503 explicite.
- API : 401 JSON sans session. Seuls le login, les ressources PWA (manifeste, icônes, `sw.js`, `offline.html`) sont publics.

## Isolation des données
- Local : une base IndexedDB par compte (`hydroloop-db--<compte>`). Déconnexion : les pages mises en cache sont purgées.
- Cloud : RLS PostgreSQL `owner_id = auth.jwt()->>'sub'`, `anon` sans droit, pas de DELETE, déclencheur de garde (propriétaire immuable, révision croissante, horodatage serveur). **14 tests sur PostgreSQL réel (PGlite)** : `supabase/rls.test.ts`.
- Jeton de synchro : 1 h, émis uniquement pour la session connectée, `SUPABASE_JWT_SECRET` ne quitte jamais le serveur.

## IA et coûts
`/api/analyze` : session obligatoire (ou `ALLOW_PUBLIC_AI`), corps ≤ 64 Ko, validation stricte des champs, limites par utilisateur (10 min / jour) et globale, `maxRetries: 1`, délai 150 s, messages d'erreur sans détail interne, usage journalisé (jetons, modèle).

## En-têtes
CSP (`connect-src` limité à l'origine et à Supabase), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS en production.

## Secrets
Aucun secret dans le dépôt (`.env.example` factice, `.gitignore` renforcé). Les `NEXT_PUBLIC_*` sont publiques par nature. Ne jamais utiliser la clé `service_role` dans l'application.

## Dépendances
`npm audit --omit=dev` : 0 vulnérabilité (vérifié dans la CI, seuil « high »).

## Risques résiduels
- Limiteurs en mémoire, par instance : en serverless multi-instances les plafonds sont approximatifs (prévoir Redis/Upstash si nécessaire).
- Le CSP autorise `'unsafe-inline'` pour les scripts (amorçage Next.js) ; un CSP à nonces est une amélioration future.
- Données locales non chiffrées au repos (protection = verrouillage de l'appareil).
- Intégration réelle avec un projet Supabase non validée (voir RELEASE_NOTES).
