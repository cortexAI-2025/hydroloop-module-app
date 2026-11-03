import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRecord } from '@/test/fixtures';

const session = vi.hoisted(() => ({ user: { id: 'alice' } as { id: string } | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => (session.user ? { user: session.user } : null) }));

const sdk = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'rate' | 'auth' | 'boom', calls: 0 }));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status = 500; }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionError extends APIError {}
  class Anthropic {
    static APIError = APIError; static AuthenticationError = AuthenticationError; static RateLimitError = RateLimitError;
    static BadRequestError = BadRequestError; static APIConnectionError = APIConnectionError;
    beta = {
      messages: {
        stream: () => {
          sdk.calls++;
          if (sdk.mode === 'rate') throw new RateLimitError('429');
          if (sdk.mode === 'auth') throw new AuthenticationError('401');
          if (sdk.mode === 'boom') throw new Error('secret interne: clé sk-ant-xxx');
          const events = [{ type: 'content_block_delta', delta: { type: 'text_delta', text: '# Rapport ' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'IA' } }];
          return {
            [Symbol.asyncIterator]() { let i = 0; return { next: async () => (i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true }) }; },
            finalMessage: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }),
          };
        },
      },
    };
  }
  return { default: Anthropic };
});

const body = () => ({ ...makeRecord().data, tracking: { readingsCount: 3 } });
const req = (b: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof b === 'string' ? b : JSON.stringify(b) });

async function load() {
  vi.resetModules();
  return (await import('./route')).POST;
}

const env = process.env as Record<string, string | undefined>;
const saved = { ...process.env };
/** Restaure process.env en place (l'objet lui-même doit rester le même pour `env`). */
function restoreEnv() { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }

beforeEach(() => {
  session.user = { id: 'alice' };
  sdk.mode = 'ok'; sdk.calls = 0;
  env.AUTH_USERS = 'alice:pw';
  env.ANTHROPIC_API_KEY = 'sk-test';
  env.AI_RATE_LIMIT_PER_10MIN = '3';
  delete env.ALLOW_PUBLIC_AI;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { restoreEnv(); vi.restoreAllMocks(); });

describe('POST /api/analyze', () => {
  it('diffuse le rapport IA et l’identifie comme tel', async () => {
    const POST = await load();
    const res = await POST(req(body()));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-report-source')).toBe('ai');
    expect(await res.text()).toBe('# Rapport IA');
  });

  it('exige une session quand les comptes sont activés', async () => {
    session.user = null;
    const POST = await load();
    expect((await POST(req(body()))).status).toBe(401);
    expect(sdk.calls).toBe(0);
  });

  it('sans clé IA : 503 « ai_unavailable » (le client génère le rapport local)', async () => {
    delete env.ANTHROPIC_API_KEY;
    const POST = await load();
    const res = await POST(req(body()));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('ai_unavailable');
  });

  it('en production sans compte, l’IA payante reste fermée sauf ALLOW_PUBLIC_AI=true', async () => {
    delete env.AUTH_USERS;
    (env as Record<string, string>).NODE_ENV = 'production';
    const POST = await load();
    expect((await POST(req(body()))).status).toBe(403);
    env.ALLOW_PUBLIC_AI = 'true';
    const POST2 = await load();
    expect((await POST2(req(body()))).status).toBe(200);
  });

  it('rejette JSON invalide, champs invalides et corps trop volumineux', async () => {
    const POST = await load();
    expect((await POST(req('{pas du json'))).status).toBe(400);
    expect((await POST(req({ ...body(), PHASE_NUMBER: 9 }))).status).toBe(400);
    expect((await POST(req({ ...body(), DONNEES_ENVIRONNEMENTALES: { pH: 'abc' } }))).status).toBe(400);
    expect((await POST(req({ ...body(), notes: 'x'.repeat(5000) }))).status).toBe(400);
    expect((await POST(req('x'.repeat(70_000)))).status).toBe(413);
    expect(sdk.calls).toBe(0);
  });

  it('limite le nombre d’analyses par utilisateur (coût maîtrisé) avec Retry-After', async () => {
    const POST = await load();
    for (let i = 0; i < 3; i++) expect((await POST(req(body()))).status).toBe(200);
    const res = await POST(req(body()));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(sdk.calls).toBe(3);
  });

  it('les limites sont indépendantes entre utilisateurs', async () => {
    const POST = await load();
    for (let i = 0; i < 3; i++) await POST(req(body()));
    session.user = { id: 'bob' };
    expect((await POST(req(body()))).status).toBe(200);
  });

  it('erreur du fournisseur : réponse propre et sans fuite d’information interne', async () => {
    const POST = await load();
    sdk.mode = 'boom';
    const res = await POST(req(body()));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant|secret interne/);
    sdk.mode = 'rate';
    expect((await POST(req(body()))).status).toBe(429);
    sdk.mode = 'auth';
    const a = await POST(req(body()));
    expect(a.status).toBe(503);
    expect((await a.json()).code).toBe('ai_unavailable');
  });
});
