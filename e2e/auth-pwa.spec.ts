import { expect, test } from '@playwright/test';
import { login, resetMock } from './helpers';

test.beforeAll(resetMock);

test.describe('authentification', () => {
  test('redirige vers /login sans session et protège l’API', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    expect((await request.post('/api/analyze', { data: {} })).status()).toBe(401);
    expect((await request.get('/api/sync/token')).status()).toBe(401);
    expect((await request.get('/api/status')).status()).toBe(401);
  });

  test('refuse un mauvais mot de passe puis accepte le bon', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle'); // hydratation terminée avant de remplir
    await page.getByLabel(/utilisateur/i).fill('alice');
    await page.getByLabel(/mot de passe/i).fill('faux');
    await page.getByRole('button', { name: /se connecter/i }).click();
    await expect(page.getByText(/incorrects/i)).toBeVisible();
    await login(page, 'alice');
    await expect(page).toHaveURL(/localhost:3100\/$/);
  });

  test('en-têtes de sécurité présents', async ({ request }) => {
    const res = await request.get('/login');
    const h = res.headers();
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain('http://127.0.0.1:3199');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
  });

  test('le jeton de synchro est émis pour l’utilisateur connecté uniquement', async ({ page }) => {
    await login(page, 'alice');
    const j = await page.evaluate(async () => (await fetch('/api/sync/token')).json());
    expect(j.owner).toBe('alice');
    expect(typeof j.token).toBe('string');
  });
});

test.describe('PWA', () => {
  test('manifeste, icônes et page hors ligne servis sans connexion', async ({ request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m.display).toBe('standalone');
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect((await request.get(i.src)).status()).toBe(200);
    expect((await request.get('/offline.html')).status()).toBe(200);
    const sw = await request.get('/sw.js');
    expect(sw.status()).toBe(200);
    expect(await sw.text()).toContain('hydroloop-pages');
  });
});
