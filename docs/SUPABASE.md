# Mise en place de Supabase (synchronisation cloud)

La synchronisation est **facultative** : sans Supabase, tout fonctionne en local. Elle exige que les comptes (`AUTH_USERS`) soient activés, car chaque utilisateur n'accède qu'à ses propres données.

## Principe de sécurité

1. L'utilisateur se connecte à HydroLoop (NextAuth).
2. Le navigateur demande `GET /api/sync/token` : le serveur signe (HS256, 1 h) un jeton JWT `role=authenticated`, `sub=<identifiant utilisateur>` avec `SUPABASE_JWT_SECRET`.
3. Le navigateur appelle Supabase avec la clé publique `anon` **et** ce jeton. Les politiques RLS comparent `owner_id` à `sub` : un utilisateur ne peut lire/écrire que ses lignes.
4. Le rôle `anon` n'a **aucun droit** sur la table : la clé publique seule ne permet rien.

## Étapes

1. Créer un projet Supabase.
2. Exécuter `supabase/migrations/20261103000000_init_batches.sql` dans l'éditeur SQL (idempotent), ou `supabase db push`.
3. Récupérer : *Project Settings → API* → URL, clé `anon`, et **JWT Secret** (secret *legacy* HS256).
4. Renseigner sur l'hébergeur : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` (secret, jamais `NEXT_PUBLIC_`), `AUTH_USERS`, `NEXTAUTH_SECRET`. **Recompiler** (les `NEXT_PUBLIC_*` sont figées au build).
5. Se connecter : la pastille de la barre de navigation passe à « Synchronisé ».

> ⚠️ **À vérifier sur votre projet** : cette version suppose que Supabase accepte les jetons signés avec le *JWT Secret* HS256 du projet. Les projets récents peuvent n'utiliser que des clés de signature asymétriques : dans ce cas, conservez/rétablissez le secret HS256 hérité, ou adaptez `/api/sync/token`. Ce point n'a **pas pu être validé** contre un vrai projet Supabase dans l'environnement de développement (voir RELEASE_NOTES). Les politiques RLS, elles, sont testées sur un vrai moteur PostgreSQL.

## Migration depuis la V0 (table `batches` sans propriétaire)

La V0 stockait `batches(id, data, report, tracking, created_at, updated_at)` sans isolation. La V1.0 utilise une table `(owner_id, id)`. Si une table `batches` de la V0 existe déjà, **renommez-la avant** d'exécuter la migration, puis copiez les données vers le compte voulu :

```sql
alter table public.batches rename to batches_v0;
-- exécuter la migration V1.0, puis :
insert into public.batches (owner_id, id, rev, data, report, tracking, created_at, updated_at)
select 'alice', id, 1, data, report, tracking, created_at, updated_at from public.batches_v0
on conflict do nothing;
```
(remplacez `alice` par l'identifiant du compte propriétaire — son nom en minuscules). Conservez `batches_v0` jusqu'à vérification.

## Vérifications

- `select * from pg_policies where tablename = 'batches';` → 3 politiques (select/insert/update), aucune pour `anon`.
- Avec la clé `anon` seule (sans jeton), `GET /rest/v1/batches` doit répondre `401/permission denied`.
- Ne jamais utiliser la clé `service_role` dans l'application.
