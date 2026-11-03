import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const jwt = vi.hoisted(() => ({ token: null as unknown }));
vi.mock('next-auth/jwt', () => ({ getToken: async () => jwt.token }));

const env = process.env as Record<string, string | undefined>;
const saved = { ...process.env };
/** Restaure process.env en place (l'objet lui-même doit rester le même pour `env`). */
function restoreEnv() { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
const run = async (path: string) => (await import('./middleware')).middleware(new NextRequest(`http://localhost${path}`));

beforeEach(() => { jwt.token = null; delete env.AUTH_USERS; delete env.AUTH_USERNAME; delete env.AUTH_PASSWORD; delete env.ALLOW_ANONYMOUS; env.NEXTAUTH_SECRET = 's'; });
afterEach(restoreEnv);

describe('middleware', () => {
  it('production sans comptes : refuse de servir (sécurisé par défaut)', async () => {
    (env as Record<string, string>).NODE_ENV = 'production';
    expect((await run('/')).status).toBe(503);
    expect((await run('/api/analyze')).status).toBe(503);
  });
  it('production sans comptes mais ALLOW_ANONYMOUS=true : accès libre', async () => {
    (env as Record<string, string>).NODE_ENV = 'production';
    env.ALLOW_ANONYMOUS = 'true';
    expect((await run('/')).status).toBe(200);
  });
  it('ressources PWA publiques même sans configuration', async () => {
    (env as Record<string, string>).NODE_ENV = 'production';
    for (const p of ['/manifest.webmanifest', '/sw.js', '/offline.html', '/icons/icon-192.png']) expect((await run(p)).status).toBe(200);
  });
  it('avec comptes : redirige vers /login (pages) et 401 JSON (API) sans session', async () => {
    env.AUTH_USERS = 'alice:pw';
    const page = await run('/batch/B1');
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toContain('/login?callbackUrl=%2Fbatch%2FB1');
    expect((await run('/api/analyze')).status).toBe(401);
    expect((await run('/api/sync/token')).status).toBe(401);
  });
  it('avec comptes et session valide : laisse passer', async () => {
    env.AUTH_USERS = 'alice:pw';
    jwt.token = { sub: 'alice' };
    expect((await run('/')).status).toBe(200);
  });
  it('avec comptes mais sans NEXTAUTH_SECRET en production : 503 explicite', async () => {
    (env as Record<string, string>).NODE_ENV = 'production';
    env.AUTH_USERS = 'alice:pw';
    delete env.NEXTAUTH_SECRET;
    expect((await run('/')).status).toBe(503);
  });
});
