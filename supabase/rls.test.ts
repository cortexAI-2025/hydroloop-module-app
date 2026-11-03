import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Tests des politiques RLS sur un vrai moteur PostgreSQL (PGlite) avec les rôles et la fonction `auth.jwt()` de Supabase émulés.
 * Ils exécutent le fichier de migration livré tel quel.
 */

let db: PGlite;

const row = (owner: string, id: string, extra = '') =>
  `insert into public.batches (owner_id, id, data, created_at, updated_at${extra ? ', ' + extra.split('=')[0] : ''}) values ('${owner}', '${id}', '{"SOUCHE":"X"}', now(), now()${extra ? ', ' + extra.split('=')[1] : ''})`;

/** Exécute `fn` en tant que `role`, avec un jeton dont le `sub` vaut `sub` (ou sans jeton). */
async function as<T>(role: 'anon' | 'authenticated', sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [sub ? JSON.stringify({ sub, role: 'authenticated' }) : '{}']);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

const rejects = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return (e as Error).message; }
  return null;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
  `);
  await db.exec(readFileSync(join(__dirname, 'migrations', '20261103000000_init_batches.sql'), 'utf8'));
});

afterAll(async () => { await db.close(); });

describe('RLS — table batches', () => {
  it('la migration est idempotente (deuxième exécution sans erreur)', async () => {
    await db.exec(readFileSync(join(__dirname, 'migrations', '20261103000000_init_batches.sql'), 'utf8'));
  });

  it('le rôle anon (clé publique) n\'a aucun droit', async () => {
    const sel = await as('anon', null, () => rejects(db.query('select * from public.batches')));
    expect(sel).toMatch(/permission denied/i);
    const ins = await as('anon', null, () => rejects(db.exec(row('alice', 'A1'))));
    expect(ins).toMatch(/permission denied/i);
  });

  it('un utilisateur insère et relit ses propres batches', async () => {
    await as('authenticated', 'alice', async () => { await db.exec(row('alice', 'A1')); await db.exec(row('alice', 'A2')); });
    const r = await as('authenticated', 'alice', () => db.query<{ id: string }>('select id from public.batches order by id'));
    expect(r.rows.map((x) => x.id)).toEqual(['A1', 'A2']);
  });

  it('un utilisateur ne voit pas les batches des autres', async () => {
    await as('authenticated', 'bob', async () => { await db.exec(row('bob', 'B1')); });
    const bob = await as('authenticated', 'bob', () => db.query<{ id: string }>('select id from public.batches'));
    expect(bob.rows.map((x) => x.id)).toEqual(['B1']);
    const alice = await as('authenticated', 'alice', () => db.query<{ id: string }>('select id from public.batches'));
    expect(alice.rows.map((x) => x.id)).toEqual(['A1', 'A2']);
  });

  it('on ne peut pas écrire un batch au nom d\'un autre utilisateur', async () => {
    const err = await as('authenticated', 'alice', () => rejects(db.exec(row('bob', 'B2'))));
    expect(err).toMatch(/row-level security/i);
  });

  it('on ne peut pas modifier le batch d\'un autre (0 ligne affectée)', async () => {
    const r = await as('authenticated', 'bob', () => db.query(`update public.batches set report = 'piraté', rev = rev + 1 where id = 'A1' returning id`));
    expect(r.rows).toHaveLength(0);
    const check = await db.query<{ report: string | null }>(`select report from public.batches where id = 'A1'`);
    expect(check.rows[0].report).toBeNull();
  });

  it('on ne peut pas transférer un batch à un autre utilisateur', async () => {
    const err = await as('authenticated', 'alice', () => rejects(db.exec(`update public.batches set owner_id = 'bob', rev = rev + 1 where id = 'A1'`)));
    expect(err).toMatch(/row-level security|immuables/i);
  });

  it('aucune suppression physique n\'est possible', async () => {
    const err = await as('authenticated', 'alice', () => rejects(db.exec(`delete from public.batches where id = 'A1'`)));
    expect(err).toMatch(/permission denied/i);
  });

  it('sans claim `sub`, aucune ligne n\'est visible ni écrivable', async () => {
    const r = await as('authenticated', null, () => db.query('select * from public.batches'));
    expect(r.rows).toHaveLength(0);
    const err = await as('authenticated', null, () => rejects(db.exec(row('alice', 'A9'))));
    expect(err).toMatch(/row-level security/i);
  });

  it('un doublon (même propriétaire, même id) est refusé : code 23505', async () => {
    const err = await as('authenticated', 'alice', () => rejects(db.exec(row('alice', 'A1'))));
    expect(err).toMatch(/duplicate key|unique/i);
  });

  it('deux utilisateurs peuvent avoir le même identifiant de batch sans conflit', async () => {
    await as('authenticated', 'bob', async () => { await db.exec(row('bob', 'A1')); });
    const r = await as('authenticated', 'bob', () => db.query<{ owner_id: string }>(`select owner_id from public.batches where id = 'A1'`));
    expect(r.rows).toEqual([{ owner_id: 'bob' }]);
  });

  it('la révision ne peut qu\'augmenter (écriture périmée refusée)', async () => {
    const err = await as('authenticated', 'alice', () => rejects(db.exec(`update public.batches set report = 'x', rev = 1 where id = 'A1' and owner_id = 'alice'`)));
    expect(err).toMatch(/révision/i);
    const ok = await as('authenticated', 'alice', () => db.query(`update public.batches set report = 'ok', rev = 2 where id = 'A1' and rev = 1 returning rev`));
    expect(ok.rows).toEqual([{ rev: 2 }]);
  });

  it('comparaison-échange : une mise à jour avec une révision périmée ne modifie rien', async () => {
    const r = await as('authenticated', 'alice', () => db.query(`update public.batches set report = 'conflit', rev = 2 where id = 'A1' and owner_id = 'alice' and rev = 1 returning rev`));
    expect(r.rows).toHaveLength(0);
  });

  it('l\'horodatage serveur est posé par la base, pas par le client', async () => {
    const forged = '2000-01-01T00:00:00Z';
    await as('authenticated', 'alice', async () => { await db.exec(`insert into public.batches (owner_id, id, data, created_at, updated_at, server_updated_at) values ('alice','T1','{"SOUCHE":"X"}', now(), now(), '${forged}')`); });
    const r = await db.query<{ ok: boolean }>(`select server_updated_at > '2020-01-01'::timestamptz as ok from public.batches where id = 'T1' and owner_id = 'alice'`);
    expect(r.rows[0].ok).toBe(true);
  });
});
