import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyJwtHS256 } from '@/lib/jwt';

const tok = vi.hoisted(() => ({ value: null as { sub?: string } | null }));
vi.mock('next-auth/jwt', () => ({ getToken: async () => tok.value }));

const env = process.env as Record<string, string | undefined>;
const saved = { ...process.env };
/** Restaure process.env en place (l'objet lui-même doit rester le même pour `env`). */
function restoreEnv() { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
const call = async () => (await import('./route')).GET(new Request('http://localhost/api/sync/token') as never);

beforeEach(() => { tok.value = { sub: 'alice' }; env.AUTH_USERS = 'alice:pw'; env.SUPABASE_JWT_SECRET = 'jwt-secret-de-test'; env.NEXTAUTH_SECRET = 's'; });
afterEach(restoreEnv);

describe('GET /api/sync/token', () => {
  it('émet un jeton court dont le sub est l’utilisateur connecté (utilisé par les politiques RLS)', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = await res.json();
    const claims = verifyJwtHS256(j.token, 'jwt-secret-de-test')!;
    expect(claims.sub).toBe('alice');
    expect(claims.role).toBe('authenticated');
    expect(claims.aud).toBe('authenticated');
    expect((claims.exp as number) - (claims.iat as number)).toBe(3600);
  });
  it('401 sans session', async () => { tok.value = null; expect((await call()).status).toBe(401); });
  it('503 si l’authentification est désactivée (pas de synchro cloud anonyme)', async () => { delete env.AUTH_USERS; expect((await call()).status).toBe(503); });
  it('503 si le secret Supabase est absent', async () => { delete env.SUPABASE_JWT_SECRET; expect((await call()).status).toBe(503); });
});
