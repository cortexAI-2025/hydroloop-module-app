// Test de bout en bout sur émulateur Android : pilote la vraie WebView de l'APK via DevTools (CDP, puppeteer-core).
// Environnement de recette uniquement : faux Supabase local, comptes fictifs. Aucune production.
import puppeteer from 'puppeteer-core';
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
let browser, page, current = 'init';

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
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* nouvelle tentative */ } await sleep(500); }
  throw new Error(`Délai dépassé : ${msg}`);
}

async function launchAndConnect() {
  sh('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
  const pid = await waitFor(() => sh('shell', 'pidof', PKG).trim().split(/\s+/)[0], 'processus de l’application');
  await waitFor(() => sh('shell', 'cat', '/proc/net/unix').includes(`webview_devtools_remote_${pid}`), 'socket DevTools de la WebView');
  try { sh('forward', '--remove', 'tcp:9222'); } catch { /* aucun forward */ }
  sh('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);
  browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  page = await waitFor(async () => (await browser.pages())[0], 'page de la WebView');
}
async function closeConnection() { try { await browser?.disconnect(); } catch { /* ignoré */ } }
const rows = async () => (await fetch(`${MOCK}/__rows`)).json();
const text = () => page.evaluate(() => document.body.innerText);
const go = (path) => page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
const url = () => page.url();

/** Renseigne un champ repéré par son libellé (compatible champs contrôlés par React). */
async function fill(labelRe, value, root = 'body') {
  const ok = await page.evaluate((src, flags, v, rootSel) => {
    const re = new RegExp(src, flags);
    const scope = document.querySelector(rootSel) || document.body;
    const labels = [...scope.querySelectorAll('label')].filter((l) => re.test(l.textContent || ''));
    let el = null;
    for (const l of labels) { el = l.control || (l.htmlFor && document.getElementById(l.htmlFor)) || l.querySelector('input,textarea,select'); if (el) break; }
    if (!el) el = [...scope.querySelectorAll('input,textarea')].find((x) => re.test(x.getAttribute('aria-label') || ''));
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, labelRe.source, labelRe.flags, value, root);
  expect(ok, `champ introuvable : ${labelRe}`);
}
/** Clique un bouton/lien repéré par son texte ou son aria-label (le dernier correspondant si `last`). */
async function click(nameRe, { root = 'body', last = false } = {}) {
  const ok = await page.evaluate((src, flags, rootSel, useLast) => {
    const re = new RegExp(src, flags);
    const scope = document.querySelector(rootSel) || document.body;
    const els = [...scope.querySelectorAll('button,a,[role=button]')].filter((e) => !e.disabled && re.test(`${e.getAttribute('aria-label') || ''} ${e.textContent || ''}`));
    const el = useLast ? els[els.length - 1] : els[0];
    if (!el) return false;
    el.click();
    return true;
  }, nameRe.source, nameRe.flags, root, last);
  expect(ok, `bouton introuvable : ${nameRe}`);
}

async function login(user = 'alice') {
  await go('/login');
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 30_000 }).catch(() => {});
  await fill(/utilisateur/i, user);
  await fill(/mot de passe/i, `pw-${user}-test`);
  await click(/se connecter/i);
  await waitFor(() => !url().includes('/login'), 'redirection après connexion');
}
async function createBatch(strain) {
  await go('/batch/new');
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll('label')].some((l) => /souche/i.test(l.textContent || ''))), 'formulaire de culture');
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 }).catch(() => {});
  await fill(/souche/i, strain);
  await click(/créer|enregistrer|démarrer/i, { last: true });
  await waitFor(() => /\/batch\/B/.test(url()), 'page de la culture créée', 30_000);
  return decodeURIComponent(new URL(url()).pathname.split('/')[2]);
}
async function addReading(ph, note) {
  await click(/nouveau relevé/i);
  await waitFor(() => page.$('[role=dialog]'), 'fenêtre de relevé');
  await fill(/ph solution/i, ph, '[role=dialog]');
  await fill(/observation/i, note, '[role=dialog]');
  await click(/enregistrer le relevé/i, { root: '[role=dialog]' });
  await waitFor(async () => !(await page.$('[role=dialog]')), 'fermeture de la fenêtre de relevé');
}
async function offlineReady() {
  const sw = () => page.evaluate(() => !!navigator.serviceWorker?.controller);
  if (!(await waitFor(sw, 'service worker actif dans la WebView', 45_000).catch(() => false))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(sw, 'service worker actif (après rechargement)', 45_000);
  }
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
    await go('/login');
    expect((await page.title()) !== '', 'titre vide');
    const body = await text();
    expect(!/ERR_|webpage is not available|page web est inaccessible/i.test(body), `page d’erreur : ${body.slice(0, 120)}`);
    expect(new URL(url()).hostname === 'localhost', `hôte inattendu ${url()}`);
    await page.screenshot({ path: `${OUT}/01-login.png` });
  });

  await step('Connexion', async () => {
    await login('alice');
    await waitFor(() => page.evaluate(() => [...document.querySelectorAll('a')].some((a) => /état de la synchronisation/i.test(a.getAttribute('aria-label') || a.textContent || ''))), 'tableau de bord affiché');
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
    await waitFor(async () => /7[.,]2/.test(await text()), 'relevé pH 7,2 affiché');
    await page.screenshot({ path: `${OUT}/03-releves.png` });
  });

  await step('Affichage du QR code', async () => {
    await click(/qr code/i);
    await waitFor(() => page.evaluate(() => [...document.querySelectorAll('svg')].some((e) => e.querySelectorAll('path,rect').length > 20)), 'SVG du QR code');
    await page.screenshot({ path: `${OUT}/04-qr.png` });
    await page.keyboard.press('Escape').catch(() => {});
  });

  await step('Persistance : fermeture complète puis réouverture', async () => {
    await closeConnection();
    sh('shell', 'am', 'force-stop', PKG);
    await sleep(1500);
    await launchAndConnect();
    await go('/');
    await waitFor(async () => (await text()).includes(idA), `culture ${idA} présente après redémarrage`);
    await go(`/batch/${idA}`);
    await waitFor(async () => /7[.,]2/.test(await text()), 'relevés conservés après redémarrage');
  });

  await step('Mode hors ligne : création d’un relevé et d’une culture sans réseau', async () => {
    await offlineReady();
    await page.setOfflineMode(true);
    idB = await createBatch('Souche Android Hors Ligne');
    await addReading('6.0', 'releve-hors-ligne');
    await go('/');
    await waitFor(async () => (await text()).includes(idB), 'culture créée hors ligne visible');
    const serverIds = (await rows()).map((r) => r.id);
    expect(!serverIds.includes(idB), 'la culture hors ligne ne doit pas encore être sur le serveur');
    await page.screenshot({ path: `${OUT}/05-hors-ligne.png` });
  });

  await step('Reconnexion : synchronisation sans duplication', async () => {
    await page.setOfflineMode(false);
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
    await go('/donnees');
    await waitFor(() => page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /exporter \(\.json\)/i.test(b.textContent || ''))), 'page Données');
    await click(/exporter \(\.json\)/i);
    const name = await waitFor(() => (sh('shell', 'ls', '/sdcard/Download').split(/\s+/).find((f) => /^hydroloop-sauvegarde-.*\.json$/.test(f))), 'fichier JSON dans /sdcard/Download');
    sh('pull', `/sdcard/Download/${name}`, `${OUT}/${name}`);
    const backup = JSON.parse(readFileSync(`${OUT}/${name}`, 'utf8'));
    expect(Array.isArray(backup.batches) && backup.batches.length >= 2, `sauvegarde incomplète : ${backup.batches?.length}`);
    expect(!/sk-ant|SUPABASE_JWT|NEXTAUTH_SECRET/.test(JSON.stringify(backup)), 'secret dans la sauvegarde');
    writeFileSync(`${OUT}/backup-name.txt`, name);
    await click(/exporter \(\.csv\)/i);
    await waitFor(() => sh('shell', 'ls', '/sdcard/Download').includes('hydroloop-releves-'), 'fichier CSV dans /sdcard/Download');
  });

  await step('Restauration : réimport de la sauvegarde sans doublon', async () => {
    const name = readFileSync(`${OUT}/backup-name.txt`, 'utf8');
    const content = readFileSync(`${OUT}/${name}`, 'utf8');
    await page.evaluate((json) => {
      const input = document.querySelector('input[type=file]');
      const dt = new DataTransfer();
      dt.items.add(new File([json], 'sauvegarde.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, content);
    await sleep(4000);
    await go('/');
    const body = await text();
    expect(body.includes(idA) && body.includes(idB), 'cultures absentes après restauration');
    expect((body.match(new RegExp(idA, 'g')) || []).length <= 2, 'duplication apparente de la culture après restauration');
    const ids = (await rows()).map((r) => r.id);
    expect(new Set(ids).size === ids.length, 'doublons serveur après restauration');
  });

  await step('Bouton Retour Android', async () => {
    await go('/');
    await go('/donnees');
    sh('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await waitFor(() => new URL(url()).pathname === '/', 'retour à l’accueil via le bouton Retour');
  });

  await step('Déconnexion', async () => {
    await click(/déconnexion/i);
    await waitFor(() => url().includes('/login'), 'retour à la page de connexion');
    await go('/');
    await waitFor(() => url().includes('/login'), 'accès protégé après déconnexion');
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
