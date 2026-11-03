import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeRecord } from '@/test/fixtures';

/**
 * RECETTE ANTHROPIC — ignorée par défaut. Appelle l'API réelle avec une clé DE TEST (budget limité à ~1 500 jetons de sortie).
 *   RECETTE_ANTHROPIC_API_KEY=<clé de test> RECETTE_CONFIRM_ANTHROPIC=cle-de-test npm run recette:anthropic
 * Ne jamais utiliser la clé de production.
 */
const KEY = process.env.RECETTE_ANTHROPIC_API_KEY;
const enabled = !!KEY && process.env.RECETTE_CONFIRM_ANTHROPIC === 'cle-de-test';

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'alice' } }) }));

describe.skipIf(!enabled)('recette Anthropic (API réelle, clé de test)', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = KEY;
    process.env.AUTH_USERS = 'alice:pw';
    process.env.AI_MAX_OUTPUT_TOKENS = '1500';
  });
  afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });

  it('génère un rapport en flux, étiqueté, sans fuite de clé', async () => {
    const { POST } = await import('./route');
    const r = makeRecord();
    const res = await POST(new Request('http://localhost/api/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...r.data, tracking: { readingsCount: 1, alertRatePct: 0 } }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-report-source')).toBe('ai');
    const text = await res.text();
    expect(text.length).toBeGreaterThan(200);
    expect(text).not.toContain(KEY!);
    const tags = ['[MESURÉ]', '[CALCULÉ]', '[ESTIMATION]', '[RECOMMANDATION]'].filter((t) => text.includes(t));
    console.info(`Étiquettes de provenance présentes : ${tags.join(' ') || 'aucune'} — ${text.length} caractères`);
    expect(tags.length).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it('une clé invalide donne une réponse propre 503 « ai_unavailable » (repli local côté client)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-invalide-recette';
    vi.resetModules();
    const { POST } = await import('./route');
    const res = await POST(new Request('http://localhost/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...makeRecord().data }) }));
    expect([401, 429, 502, 503]).toContain(res.status);
    const j = await res.json();
    expect(j.code).toBe('ai_unavailable');
    expect(JSON.stringify(j)).not.toMatch(/sk-ant/);
    process.env.ANTHROPIC_API_KEY = KEY;
  }, 60_000);
});
