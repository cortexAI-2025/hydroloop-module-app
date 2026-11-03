#!/usr/bin/env node
// Génère les icônes PNG de l'application (PWA Android / iOS) à partir de public/icon.svg, avec Chromium (Playwright).
// Usage : node scripts/generate-icons.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icon.svg', 'utf8');
mkdirSync('public/icons', { recursive: true });

const jobs = [
  { file: 'icon-192.png', size: 192, pad: 0, bg: 'transparent' },
  { file: 'icon-512.png', size: 512, pad: 0, bg: 'transparent' },
  // « maskable » : le motif doit tenir dans la zone sûre (80 %) car Android peut rogner les bords
  { file: 'icon-maskable-512.png', size: 512, pad: 0.16, bg: '#166534' },
  { file: 'apple-touch-icon.png', size: 180, pad: 0.1, bg: '#166534' },
];

const browser = await chromium.launch();
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size } });
  const inner = Math.round(j.size * (1 - 2 * j.pad));
  const off = Math.round(j.size * j.pad);
  await page.setContent(`<body style="margin:0;background:${j.bg}"><div style="position:absolute;left:${off}px;top:${off}px;width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await page.screenshot({ path: `public/icons/${j.file}`, omitBackground: j.bg === 'transparent' });
  await page.close();
}
await browser.close();
console.log('Icônes générées dans public/icons/');
