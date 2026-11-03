import { expect, test } from '@playwright/test';
import { createBatch, login, mockRows, resetMock, waitOfflineReady } from './helpers';

test.beforeAll(resetMock);

test('hors ligne → en ligne : rien n’est perdu, la synchro rattrape, l’autre appareil récupère', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await login(a, 'alice');
  await expect(a.getByRole('link', { name: /état de la synchronisation/i })).toBeVisible();
  await waitOfflineReady(a, ctxA);

  // ── Hors ligne : la création fonctionne, la file d'attente se remplit
  await ctxA.setOffline(true);
  const id = await createBatch(a, 'Souche Hors Ligne');
  await expect(a.getByRole('status').filter({ hasText: /hors ligne/i }).first()).toBeVisible();
  await expect(a.getByRole('link', { name: /en attente/i })).toBeVisible();
  expect(await mockRows()).toHaveLength(0); // rien n'a atteint le serveur

  // Rechargement hors ligne : les données locales sont toujours là
  await a.goto('/');
  await expect(a.getByText(id)).toBeVisible();

  // ── Retour du réseau : synchro automatique
  await ctxA.setOffline(false);
  await a.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await mockRows()).map((r) => r.id), { timeout: 30_000 }).toContain(id);
  const rows = await mockRows();
  expect(rows[0].owner_id).toBe('alice');
  expect(rows[0].data.SOUCHE).toBe('Souche Hors Ligne');

  // ── Un second appareil du même compte récupère le batch
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await login(b, 'alice');
  await b.goto('/');
  await expect(b.getByText(id)).toBeVisible({ timeout: 30_000 });

  // ── Un autre compte ne voit rien (isolation locale + serveur)
  const ctxC = await browser.newContext();
  const c = await ctxC.newPage();
  await login(c, 'bob');
  await c.goto('/');
  await expect(c.getByText(id)).toHaveCount(0);
  await c.waitForTimeout(2500);
  await expect(c.getByText(id)).toHaveCount(0);

  await ctxA.close(); await ctxB.close(); await ctxC.close();
});
