# Checklist de déploiement (à valider par un humain — aucun déploiement n'a été effectué)

- [ ] PR relue ; CI verte (lint, types, tests, build, audit, e2e).
- [ ] `AUTH_USERS` (mots de passe hachés), `NEXTAUTH_SECRET` (≥ 32 octets), `NEXTAUTH_URL` = URL publique HTTPS.
- [ ] Domaine en HTTPS (obligatoire pour PWA/service worker).
- [ ] Supabase : migration exécutée, `pg_policies` vérifié, accès `anon` refusé, `SUPABASE_JWT_SECRET` renseigné (secret), variables `NEXT_PUBLIC_*` présentes **avant** le build.
- [ ] Migration des données V0 si nécessaire (docs/SUPABASE.md).
- [ ] IA : `ANTHROPIC_API_KEY` + plafonds `AI_*` ; sinon rapport local.
- [ ] Seuils : validés par le responsable de culture (docs/SEUILS.md).
- [ ] Test sur un vrai Android : installation, hors ligne → en ligne, deux appareils, deux comptes.
- [ ] Sauvegarde JSON exportée avant la bascule ; plan de retour arrière (ancienne version + export).
- [ ] Décision sur la branche `origin/feat/varieties-modules-cycle` (non fusionnée) et sur la branche par défaut du dépôt.
