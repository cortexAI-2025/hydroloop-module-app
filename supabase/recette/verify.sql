-- Vérifications de configuration à exécuter dans l'éditeur SQL du projet de RECETTE. Résultats attendus en commentaire.
-- 1. RLS activée et forcée → relrowsecurity = true, relforcerowsecurity = true
select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.batches'::regclass;
-- 2. Exactement 3 politiques (INSERT, SELECT, UPDATE), roles = {authenticated}
select cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'batches' order by cmd;
-- 3. Droits : anon → aucune ligne ; authenticated → INSERT, SELECT, UPDATE seulement
select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'batches' and grantee in ('anon','authenticated','public') order by 1,2;
-- 4. Déclencheur de garde présent (BEFORE INSERT OR UPDATE)
select tgname, tgenabled from pg_trigger where tgrelid = 'public.batches'::regclass and not tgisinternal;
-- 5. Index de curseur de synchro
select indexname from pg_indexes where tablename = 'batches';
-- 6. Aucune autre table publique exposée sans RLS → liste vide attendue
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
