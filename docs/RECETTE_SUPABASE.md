# Recette Supabase — projet isolé (⛔ jamais la production)

**Statut : BLOQUÉ — nécessite un humain** (création d'un projet Supabase et de ses clés). Tout est prêt côté code ; ce qui reste est la procédure ci-dessous.

## 0. Audit de configuration réalisé (sans accès réseau)
| Contrôle | Résultat | Preuve |
|---|---|---|
| RLS activée **et forcée** | ✅ | `supabase/rls.test.ts` (interroge `pg_class`) |
| 3 politiques seulement (INSERT/SELECT/UPDATE), réservées à `authenticated`, filtre `owner_id = auth.jwt()->>'sub'` | ✅ | idem (`pg_policies`) |
| `anon` sans aucun droit (SELECT/INSERT refusés) | ✅ | tests `anon` |
| Aucun DELETE / TRUNCATE / DDL pour `authenticated` | ✅ | tests |
| Usurpation d'`owner_id` (INSERT, UPDATE, transfert) refusée | ✅ | tests |
| Révision strictement croissante, horodatage serveur, propriétaire immuable (trigger) | ✅ | tests |
| Comparaison-échange (0 ligne si révision périmée) | ✅ | tests |
| Contraintes (`rev ≥ 1`, id non vide) | ✅ | tests |
| Migration idempotente | ✅ | test |
| Même moteur que Supabase en production (PostgreSQL), mais **rôles/`auth.jwt()` émulés** | ⚠️ limite | PGlite |
| Fonctionnement avec un vrai projet (JWT HS256 accepté, PostgREST, CORS) | ⛔ non vérifié | à faire ci-dessous |

Points d'attention : (a) la clé `service_role` ne doit jamais être dans l'app ; (b) le trigger n'est pas `SECURITY DEFINER` (pas d'élévation) ; (c) `server_updated_at` est fiable seulement parce que le trigger l'écrase.

## 1. Préparer le projet de recette (humain, ~15 min)
1. supabase.com → *New project* nommé `hydroloop-recette` (organisation/projet **distincts** de la production, aucune donnée réelle).
2. *SQL editor* → coller `supabase/migrations/20261103000000_init_batches.sql` → Run. Puis `supabase/recette/verify.sql` : comparer aux résultats attendus (commentaires dans le fichier).
3. *Project Settings → API* : noter URL, clé `anon`, et **JWT Secret** (onglet *JWT Keys* → secret HS256 hérité). Si seul un système de clés asymétriques est proposé, **c'est le résultat n°1 de la recette** : noter « HS256 indisponible » (voir §4).

## 2. Tests automatisés contre le projet (poste de développeur, pas de production)
```bash
RECETTE_SUPABASE_URL=https://<recette>.supabase.co \
RECETTE_SUPABASE_ANON_KEY=<anon> \
RECETTE_SUPABASE_JWT_SECRET=<jwt secret> \
RECETTE_CONFIRM=projet-de-recette-isole \
npm run recette:supabase
```
Attendu : **5 tests verts** — anon sans accès ; mauvais secret refusé ; jeton expiré refusé ; synchro A→cloud→2ᵉ appareil + conflit fusionné sans perte + isolation + usurpation refusée ; suppression physique impossible. Sans les variables, ces tests sont *ignorés* (5 skipped dans `npm test`). Nettoyage : `supabase/recette/cleanup.sql`.

## 3. Test applicatif de bout en bout (recette)
Déployer l'application sur un environnement de **recette** (pas la production) avec : `AUTH_USERS` (2 comptes de test), `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, les 3 variables Supabase de recette, build après avoir posé les `NEXT_PUBLIC_*`. Exécuter les scénarios S1–S4 de `docs/RECETTE_ANDROID.md` (cloud). Attendu : pastille « Synchronisé », lignes visibles dans *Table editor* avec le bon `owner_id`, rien chez l'autre compte.

## 4. Si le projet n'accepte pas le JWT HS256 maison
Symptôme : erreur « JWT … invalid » / pastille « Erreur synchro ». Solutions : activer le secret HS256 hérité dans *JWT Keys*, ou adapter `/api/sync/token` pour utiliser **Supabase Auth** (utilisateurs Supabase mappés sur `AUTH_USERS`) — travail à planifier, les politiques RLS restent valables si `sub` = identifiant utilisateur.

## 5. Critères de sortie
Les 5 tests verts **et** S1–S4 réussis **et** `verify.sql` conforme → « isolation cloud validée ». Consigner la date, le projet (ref), le commit testé.
