// Test de bout en bout sur émulateur Android : pilote la vraie WebView de l'APK via DevTools (CDP).
// Environnement de recette uniquement : faux Supabase local, comptes fictifs. Aucune production.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const BASE = 'http://localhost:3100';
const MOCK = 'http://127.0.0.1:3199';
const PKG = 'com.hydroloopfarm.manager';
const OUT = 'smoke-out';
mkdirSync(OUT, { recursive: true });

const sh = (...args) => execFileSync('adb', args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let browser, page, ctx, current = 'init';

async function step(name, fn) {
  current = name;
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, error: String(e?.message ?? e).split('\n')[0] });
    console.log(`✗ ${name} : ${String(e?.message ?? e).split('\n').slice(0, 3).join(' | ')}`);
    try { await page?.screenshot({ path: `${OUT}/echec-${results.length}.png` }); } catch { /* ignoré */ }
    throw e;
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function waitFor(fn, msg, timeout = 30_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(500); }
  throw new Error(`Délai dépassé : ${msg}`);
}

async function launchAndConnect() {
  sh('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
  const pid = await waitFor(() => sh('shell', 'pidof', PKG).trim().split(/\s+/)[0], 'processus de l’application');
  await waitFor(() => sh('shell', 'cat', '/proc/net/unix').includes(`webview_devtools_remote_${pid}`), 'socket DevTools de la WebView');
  try { sh('forward', '--remove', 'tcp:9222'); } catch { /* aucun forward */ }
  sh('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  ctx = browser.contexts()[0];
  page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
  await page.waitForLoadState('domcontentloaded');
}
async function closeConnection() { try { await browser?.close(); } catch { /* ignoré */ } }
const rows = async () => (await fetch(`${MOCK}/__rows`)).json();

async function login(user = 'alice') {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  const u = page.getByLabel(/utilisateur/i);
  await u.fill(user);
  await page.getByLabel(/mot de passe/i).fill(`pw-${user}-test`);
  await page.getByRole('button', { name: /se connecter/i }).click();
  await waitFor(() => !page.url().includes('/login'), 'redirection après connexion');
}
async function createBatch(strain) {
  await page.goto(`${BASE}/batch/new`);
  await page.getByLabel('Souche *').fill(strain);
  await page.getByRole('button', { name: /créer|enregistrer|démarrer/i }).last().click();
  await page.waitForURL(/\/batch\/B/, { timeout: 30_000 });
  return decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
}
async function addReading(ph, note) {
  await page.getByRole('button', { name: /nouveau relevé/i }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByLabel(/ph solution/i).fill(ph);
  await dlg.getByLabel(/observation/i).fill(note);
  await dlg.getByRole('button', { name: /enregistrer le relevé/i }).click();
  await dlg.waitFor({ state: 'hidden' });
}
async function offlineReady() {
  await waitFor(() => page.evaluate(() => !!navigator.serviceWorker?.controller), 'service worker actif dans la WebView', 45_000)
    .catch(async () => { await page.reload(); await waitFor(() => page.evaluate(() => !!navigator.serviceWorker?.controller), 'service worker actif (après rechargement)', 45_000); });
  await waitFor(() => page.evaluate(async () => {
    const n = (await caches.keys()).find((k) => k.startsWith('hydroloop-pages'));
    return n ? (await (await caches.open(n)).keys()).length >= 4 : false;
  }), 'pages mises en cache pour le mode hors ligne', 45_000);
}

let strainA, idA, idB;
try {
  await fetch(`${MOCK}/__reset`);

  await step('Démarrage de l’application (WebView, pas de page d’erreur)', async () => {
    await launchAndConnect();
    await page.goto(`${BASE}/login`);
    expect(await page.title() !== '', 'titre vide');
    const body = await page.locator('body').innerText();
    expect(!/ERR_|webpage is not available|page web est inaccessible/i.test(body), `page d’erreur : ${body.slice(0, 120)}`);
    expect(new URL(page.url()).hostname === 'localhost', `hôte inattendu ${page.url()}`);
    await page.screenshot({ path: `${OUT}/01-login.png` });
  });

  await step('Connexion', async () => {
    await login('alice');
    await page.getByRole('link', { name: /état de la synchronisation/i }).waitFor();
    await page.screenshot({ path: `${OUT}/02-tableau-de-bord.png` });
  });

  await step('Création d’une culture', async () => {
    strainA = 'Souche Android 1';
    idA = await createBatch(strainA);
    expect(/^B/.test(idA), `identifiant ${idA}`);
  });

  await step('Ajout de plusieurs relevés + alerte pH', async () => {
    await addReading('6.1', 'releve-1');
    await addReading('6.3', 'releve-2');
    await addReading('7.2', 'releve-3-ph-haut');
    await waitFor(async () => /7[.,]2/.test(await page.locator('body').innerText()), 'relevé pH 7,2 affiché');
    await page.screenshot({ path: `${OUT}/03-releves.png` });
  });

  await step('Affichage du QR code', async () => {
    await page.getByRole('button', { name: /qr code/i }).click();
    await waitFor(() => page.locator('svg').evaluateAll((els) => els.some((e) => e.querySelectorAll('path,rect').length > 20)), 'SVG du QR code');
    await page.screenshot({ path: `${OUT}/04-qr.png` });
    await page.keyboard.press('Escape');
  });

  await step('Persistance : fermeture complète puis réouverture', async () => {
    await closeConnection();
    sh('shell', 'am', 'force-stop', PKG);
    await sleep(1500);
    await launchAndConnect();
    await page.goto(`${BASE}/`);
    await waitFor(async () => (await page.locator('body').innerText()).includes(idA), `culture ${idA} présente après redémarrage`);
    await page.goto(`${BASE}/batch/${idA}`);
    await waitFor(async () => /7[.,]2/.test(await page.locator('body').innerText()), 'relevés conservés après redémarrage');
  });

  await step('Mode hors ligne : création d’un relevé et d’une culture sans réseau', async () => {
    await offlineReady();
    await ctx.setOffline(true);
    idB = await createBatch('Souche Android Hors Ligne');
    await addReading('6.0', 'releve-hors-ligne');
    await page.goto(`${BASE}/`);
    await waitFor(async () => (await page.locator('body').innerText()).includes(idB), 'culture créée hors ligne visible');
    const serverIds = (await rows()).map((r) => r.id);
    expect(!serverIds.includes(idB), 'la culture hors ligne ne doit pas encore être sur le serveur');
    await page.screenshot({ path: `${OUT}/05-hors-ligne.png` });
  });

  await step('Reconnexion : synchronisation sans duplication', async () => {
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitFor(async () => (await rows()).some((r) => r.id === idB), `culture ${idB} synchronisée`, 60_000);
    await waitFor(async () => (await rows()).some((r) => r.id === idA), `culture ${idA} synchronisée`, 60_000);
    const ids = (await rows()).map((r) => r.id);
    expect(new Set(ids).size === ids.length, `doublons côté serveur : ${ids.join(',')}`);
    expect(ids.filter((i) => i === idB).length === 1, 'doublon de la culture hors ligne');
    const row = (await rows()).find((r) => r.id === idB);
    expect(row.owner_id === 'alice', `propriétaire ${row.owner_id}`);
  });

  await step('Export des données (JSON) enregistré dans Téléchargements', async () => {
    await page.goto(`${BASE}/donnees`);
    await page.getByRole('button', { name: /exporter \(\.json\)/i }).click();
    const name = await waitFor(() => (sh('shell', 'ls', '/sdcard/Download').split(/\s+/).find((f) => /^hydroloop-sauvegarde-.*\.json$/.test(f))), 'fichier JSON dans /sdcard/Download');
    sh('pull', `/sdcard/Download/${name}`, `${OUT}/${name}`);
    const backup = JSON.parse(readFileSync(`${OUT}/${name}`, 'utf8'));
    expect(Array.isArray(backup.batches) && backup.batches.length >= 2, `sauvegarde incomplète : ${backup.batches?.length}`);
    expect(!/sk-ant|SUPABASE_JWT|NEXTAUTH_SECRET/.test(JSON.stringify(backup)), 'secret dans la sauvegarde');
    writeFileSync(`${OUT}/backup-name.txt`, name);
    await page.getByRole('button', { name: /exporter \(\.csv\)/i }).click();
    await waitFor(() => sh('shell', 'ls', '/sdcard/Download').includes('hydroloop-releves-'), 'fichier CSV dans /sdcard/Download');
  });

  await step('Restauration : réimport de la sauvegarde sans doublon', async () => {
    const name = readFileSync(`${OUT}/backup-name.txt`, 'utf8');
    await page.locator('input[type=file]').setInputFiles(`${OUT}/${name}`);
    await sleep(3000);
    await page.goto(`${BASE}/`);
    const text = await page.locator('body').innerText();
    expect(text.includes(idA) && text.includes(idB), 'cultures absentes après restauration');
    expect((text.match(new RegExp(idA, 'g')) || []).length <= 2, 'duplication apparente de la culture après restauration');
    const ids = (await rows()).map((r) => r.id);
    expect(new Set(ids).size === ids.length, 'doublons serveur après restauration');
  });

  await step('Bouton Retour Android', async () => {
    await page.goto(`${BASE}/`);
    await page.goto(`${BASE}/donnees`);
    sh('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await waitFor(() => new URL(page.url()).pathname === '/', 'retour à l’accueil via le bouton Retour');
  });

  await step('Déconnexion', async () => {
    await page.getByRole('button', { name: /déconnexion/i }).click();
    await waitFor(() => page.url().includes('/login'), 'retour à la page de connexion');
    await page.goto(`${BASE}/`);
    await waitFor(() => page.url().includes('/login'), 'accès protégé après déconnexion');
  });

  await step('Absence de plantage (logcat)', async () => {
    const log = sh('logcat', '-d');
    expect(!/FATAL EXCEPTION/.test(log) || !new RegExp(`FATAL EXCEPTION[\\s\\S]{0,300}${PKG}`).test(log), 'plantage détecté dans logcat');
    expect(sh('shell', 'pidof', PKG).trim() !== '', 'processus arrêté');
  });
} catch (e) {
  console.error(`Échec à l’étape « ${current} »`);
}
writeFileSync(`${OUT}/rapport.json`, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} étapes réussies`);
await closeConnection();
process.exit(failed || results.length < 13 ? 1 : 0);
