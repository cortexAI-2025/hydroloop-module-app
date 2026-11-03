import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const MOCK = 'http://127.0.0.1:3199';

export async function resetMock() { await fetch(`${MOCK}/__reset`); }
export async function mockRows(): Promise<{ owner_id: string; id: string; rev: number; data: { SOUCHE: string }; tracking: { readings: unknown[] } }[]> {
  return (await fetch(`${MOCK}/__rows`)).json();
}

export async function login(page: Page, user = 'alice', password = `pw-${user}-test`) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle'); // attendre l'hydratation : sinon React réinitialise les champs déjà remplis
  const u = page.getByLabel(/utilisateur/i);
  await u.fill(user);
  await expect(u).toHaveValue(user);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole('button', { name: /se connecter/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Crée un batch via le formulaire (fonctionne en ligne et hors ligne). Retourne son identifiant. */
export async function createBatch(page: Page, strain: string): Promise<string> {
  await page.goto('/batch/new');
  await page.getByLabel('Souche *').fill(strain);
  await page.getByRole('button', { name: /créer|enregistrer|démarrer/i }).last().click();
  await page.waitForURL(/\/batch\/B/, { timeout: 30_000 });
  return decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
}

/** Attend que le service worker contrôle la page et que les pages principales soient en cache (mode hors ligne prêt). */
export async function waitOfflineReady(page: Page, context: BrowserContext) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 }).catch(async () => {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
  });
  await expect.poll(async () => page.evaluate(async () => (await caches.keys()).length), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(async () => {
    const names = await caches.keys();
    const pages = names.find((n) => n.startsWith('hydroloop-pages'));
    return pages ? (await (await caches.open(pages)).keys()).length : 0;
  }), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  void context;
}
