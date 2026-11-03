-- HydroLoop Farm Manager — schéma V1.0
-- À exécuter dans l'éditeur SQL Supabase (ou `supabase db push`). Idempotent.
--
-- Sécurité : chaque ligne appartient à un utilisateur (`owner_id` = claim `sub` du jeton émis par /api/sync/token).
-- Le rôle `anon` (clé publique) n'a AUCUN droit sur la table. Le rôle `authenticated` ne voit et ne modifie que ses lignes.
-- Pas de suppression physique : les batches supprimés sont marqués (`deleted_at`) et restent récupérables.

create table if not exists public.batches (
  owner_id           text        not null check (length(owner_id) between 1 and 64),
  id                 text        not null check (length(id) between 1 and 80),
  rev                integer     not null default 1 check (rev >= 1),
  data               jsonb       not null,
  report             text,
  tracking           jsonb,
  created_at         timestamptz not null,
  updated_at         timestamptz not null,
  deleted_at         timestamptz,
  server_updated_at  timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Base créée avec la V1 de l'application (sans propriétaire) : voir docs/SUPABASE.md pour la migration des données.
create index if not exists batches_owner_sync_idx on public.batches (owner_id, server_updated_at);

alter table public.batches enable row level security;
alter table public.batches force row level security;

-- Le jeton d'un utilisateur porte son identifiant dans `sub`.
drop policy if exists batches_select_own on public.batches;
create policy batches_select_own on public.batches
  for select to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

drop policy if exists batches_insert_own on public.batches;
create policy batches_insert_own on public.batches
  for insert to authenticated
  with check (owner_id = (auth.jwt() ->> 'sub'));

drop policy if exists batches_update_own on public.batches;
create policy batches_update_own on public.batches
  for update to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'))
  with check (owner_id = (auth.jwt() ->> 'sub'));

-- Aucune politique DELETE : suppression logique uniquement.
revoke all on public.batches from anon;
revoke all on public.batches from authenticated;
grant select, insert, update on public.batches to authenticated;

-- Garde-fous côté serveur :
--  * horodatage serveur (curseur de synchronisation fiable, indépendant de l'horloge des appareils)
--  * propriétaire et identifiant immuables
--  * la révision ne peut qu'augmenter (une écriture périmée est refusée même si un client est défaillant)
create or replace function public.batches_guard() returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id or new.id <> old.id then
      raise exception 'owner_id et id sont immuables' using errcode = '42501';
    end if;
    if new.rev <= old.rev then
      raise exception 'la révision doit augmenter (% -> %)', old.rev, new.rev using errcode = '40001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists batches_guard on public.batches;
create trigger batches_guard
  before insert or update on public.batches
  for each row execute function public.batches_guard();
