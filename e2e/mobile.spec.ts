import { expect, test } from '@playwright/test';
import { createBatch, login, resetMock } from './helpers';

test.beforeAll(resetMock);

test('Android (Pixel 7) : pas de défilement horizontal, navigation et saisie utilisables', async ({ page }) => {
  await login(page, 'alice');
  const id = await createBatch(page, 'Souche Mobile');
  for (const path of ['/', `/batch/${id}`, '/batch/new', '/donnees', '/reglages', '/analytics']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `défilement horizontal sur ${path}`).toBeLessThanOrEqual(1);
  }
  // Cibles tactiles de la barre de navigation : au moins 32 px de haut
  await page.goto('/');
  const heights = await page.locator('nav a').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(32);
  // Saisie d'un relevé depuis la fiche du batch
  await page.goto(`/batch/${id}`);
  await page.getByRole('button', { name: /saisir un relevé|nouveau relevé|relevé/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
