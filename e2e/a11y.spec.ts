import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createBatch, login, resetMock } from './helpers';

test.beforeAll(resetMock);

const found: string[] = [];

async function audit(page: import('@playwright/test').Page, name: string) {
  await page.waitForLoadState('networkidle');
  const res = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of res.violations) found.push(`${name} — ${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
}

test('accessibilité (WCAG 2.1 A/AA) des écrans principaux', async ({ page }) => {
  await page.goto('/login');
  await audit(page, '/login');
  await login(page, 'alice');
  const id = await createBatch(page, 'Souche A11y');
  await audit(page, `/batch/${id}`);
  for (const path of ['/', '/batch/new', '/donnees', '/reglages', '/analytics']) {
    await page.goto(path);
    await audit(page, path);
  }
  expect(found, 'Violations d’accessibilité').toEqual([]);
});
