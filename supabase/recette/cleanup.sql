-- À exécuter UNIQUEMENT dans le projet Supabase de RECETTE (rôle postgres, éditeur SQL).
-- Supprime les données créées par `npm run recette:supabase`.
delete from public.batches where owner_id like 'recette-%';
