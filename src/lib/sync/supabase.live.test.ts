import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { signJwtHS256 } from '../jwt';
import { SupabaseRemote } from './supabaseRemote';
import { MemoryLocal } from './memory';
import { runSync } from './engine';
import { makeRecord, withReading } from '@/test/fixtures';

/**
 * RECETTE SUR PROJET SUPABASE ISOLÉ — ignorée par défaut.
 * Activer (jamais avec la production) :
 *   RECETTE_SUPABASE_URL=https://<projet-de-recette>.supabase.co RECETTE_SUPABASE_ANON_KEY=... RECETTE_SUPABASE_JWT_SECRET=... \
 *   RECETTE_CONFIRM=projet-de-recette-isole npm run recette:supabase
 * Les données créées utilisent des propriétaires uniques `recette-<horodatage>-a|b` (nettoyage : supabase/recette/cleanup.sql).
 */
const { RECETTE_SUPABASE_URL: URL_, RECETTE_SUPABASE_ANON_KEY: ANON, RECETTE_SUPABASE_JWT_SECRET: SECRET, RECETTE_CONFIRM } = process.env;
const enabled = !!(URL_ && ANON && SECRET && RECETTE_CONFIRM === 'projet-de-recette-isole');

const run = Date.now();
const ownerA = `recette-${run}-a`;
const ownerB = `recette-${run}-b`;

const clientFor = (owner: string | null, ttl = 3600, secret = SECRET!) => {
  const now = Math.floor(Date.now() / 1000);
  const token = owner ? signJwtHS256({ aud: 'authenticated', role: 'authenticated', sub: owner, iat: now, exp: now + ttl }, secret) : null;
  return createClient(URL_!, ANON!, { accessToken: async () => token ?? ANON!, auth: { persistSession: false, autoRefreshToken: false } });
};

describe.skipIf(!enabled)('recette Supabase (projet isolé)', () => {
  it('anon (clé publique seule) n’a aucun accès à la table', async () => {
    const { data, error } = await clientFor(null).from('batches').select('*').limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    const ins = await clientFor(null).from('batches').insert({ owner_id: ownerA, id: 'X', data: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    expect(ins.error).not.toBeNull();
  });

  it('un jeton signé avec un mauvais secret est refusé', async () => {
    const { error } = await clientFor(ownerA, 3600, 'mauvais-secret').from('batches').select('*').limit(1);
    expect(error).not.toBeNull();
  });

  it('un jeton expiré est refusé', async () => {
    const { error } = await clientFor(ownerA, -60).from('batches').select('*').limit(1);
    expect(error).not.toBeNull();
  });

  it('synchro complète A→cloud→B, isolation, doublon et conflit', async () => {
    const remoteA = new SupabaseRemote(clientFor(ownerA), ownerA);
    const devA = new MemoryLocal(), devA2 = new MemoryLocal();
    const rec = makeRecord(`B-RECETTE-${run}`);
    await devA.put({ ...rec, rev: 1, sync: { dirty: true, baseRev: null } });
    expect((await runSync(devA, remoteA)).pushed).toBe(1);

    // 2e appareil du même compte
    expect((await runSync(devA2, new SupabaseRemote(clientFor(ownerA), ownerA))).pulled).toBe(1);

    // modifications concurrentes → fusion sans perte
    await devA.put({ ...withReading((await devA.get(rec.id))!, 'r-1', '2026-10-02T08:00:00.000Z'), rev: 2, sync: { dirty: true, baseRev: 1 } });
    await devA2.put({ ...withReading((await devA2.get(rec.id))!, 'r-2', '2026-10-02T09:00:00.000Z'), rev: 2, sync: { dirty: true, baseRev: 1 } });
    await runSync(devA, remoteA);
    await runSync(devA2, new SupabaseRemote(clientFor(ownerA), ownerA));
    await runSync(devA, remoteA);
    const ids = (await devA.get(rec.id))!.readings!.map((x) => x.id);
    expect(ids).toContain('r-1');
    expect(ids).toContain('r-2');

    // autre compte : ne voit rien, ne peut pas écrire chez A
    const bClient = clientFor(ownerB);
    expect(await new SupabaseRemote(bClient, ownerB).fetchSince(null)).toHaveLength(0);
    const spoof = await bClient.from('batches').insert({ owner_id: ownerA, id: 'SPOOF', data: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    expect(spoof.error).not.toBeNull();
    const peek = await bClient.from('batches').select('*').eq('owner_id', ownerA);
    expect(peek.data ?? []).toHaveLength(0);
  });

  it('pas de suppression physique pour authenticated', async () => {
    const c = clientFor(ownerA);
    const { data } = await c.from('batches').delete().eq('owner_id', ownerA).eq('id', `B-RECETTE-${run}`).select();
    const still = await c.from('batches').select('id').eq('owner_id', ownerA);
    expect((data ?? []).length === 0 && (still.data ?? []).length > 0).toBe(true);
  });
});
