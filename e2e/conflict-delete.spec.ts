import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createBatch, login, mockRows, resetMock } from './helpers';

test.beforeAll(resetMock);

/** Saisit un relevé via l'interface (pH donné) ; fonctionne hors ligne. */
async function addReading(page: Page, ph: string, note: string) {
  await page.getByRole('button', { name: /nouveau relevé/i }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByLabel(/ph solution/i).fill(ph);
  await dlg.getByLabel(/observation/i).fill(note);
  await dlg.getByRole('button', { name: /enregistrer le relevé/i }).click();
  await expect(dlg).toBeHidden();
}

test('S3 — conflit : deux appareils hors ligne ajoutent chacun un relevé, rien n’est perdu des deux côtés', async ({ browser }) => {
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  await login(a, 'alice'); await login(b, 'alice');
  const id = await createBatch(a, 'Souche Conflit');
  await expect.poll(async () => (await mockRows()).map((r) => r.id), { timeout: 30_000 }).toContain(id);

  await b.goto('/'); await expect(b.getByText(id)).toBeVisible({ timeout: 30_000 });
  await b.goto(`/batch/${id}`);
  await a.goto(`/batch/${id}`);
  await a.waitForLoadState('networkidle'); await b.waitForLoadState('networkidle');

  await ctxA.setOffline(true); await ctxB.setOffline(true);
  await addReading(a, '5.9', 'note-appareil-A');
  await addReading(b, '6.1', 'note-appareil-B');
  await ctxA.setOffline(false); await ctxB.setOffline(false);
  await a.evaluate(() => window.dispatchEvent(new Event('online')));
  await b.evaluate(() => window.dispatchEvent(new Event('online')));

  // Après synchro, les deux observations existent dans le cloud et sur chaque appareil
  await expect.poll(async () => {
    const row = (await mockRows()).find((r) => r.id === id);
    const txt = JSON.stringify(row?.tracking ?? {});
    return txt.includes('note-appareil-A') && txt.includes('note-appareil-B');
  }, { timeout: 45_000 }).toBe(true);
  for (const p of [a, b]) {
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.goto(`/batch/${id}`);
    await expect(p.getByText('note-appareil-A').first()).toBeVisible({ timeout: 30_000 });
    await expect(p.getByText('note-appareil-B').first()).toBeVisible({ timeout: 30_000 });
  }
  await ctxA.close(); await ctxB.close();
});

test('S5 — suppression propagée puis restauration depuis la corbeille, propagée aussi', async ({ browser }) => {
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  await login(a, 'alice'); await login(b, 'alice');
  const id = await createBatch(a, 'Souche Corbeille');
  await expect.poll(async () => (await mockRows()).map((r) => r.id), { timeout: 30_000 }).toContain(id);
  await b.goto('/'); await expect(b.getByText(id)).toBeVisible({ timeout: 30_000 });

  // A supprime
  await a.goto('/');
  a.once('dialog', (d) => d.accept());
  await a.getByRole('button', { name: `Supprimer ${id}` }).click();
  await expect(a.getByText(id)).toHaveCount(0);
  await expect.poll(async () => (await mockRows()).find((r) => r.id === id) as unknown as { deleted_at: string | null } | undefined, { timeout: 30_000 }).toMatchObject({ deleted_at: expect.any(String) });
  // la ligne n'est pas physiquement supprimée côté cloud
  expect((await mockRows()).some((r) => r.id === id)).toBe(true);

  // B reçoit la suppression
  await b.evaluate(() => window.dispatchEvent(new Event('online')));
  await b.goto('/');
  await expect(b.getByText(id)).toHaveCount(0, { timeout: 30_000 });

  // B restaure depuis la corbeille
  await b.goto('/donnees');
  const row = b.getByRole('listitem').filter({ hasText: id });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /restaurer/i }).click();
  await expect.poll(async () => (await mockRows()).find((r) => r.id === id) as unknown as { deleted_at: string | null } | undefined, { timeout: 30_000 }).toMatchObject({ deleted_at: null });

  // A retrouve le batch
  await a.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.goto('/');
  await expect(a.getByText(id)).toBeVisible({ timeout: 30_000 });
  await ctxA.close(); await ctxB.close();
});
