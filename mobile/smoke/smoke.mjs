// Test de bout en bout sur émulateur Android : pilote la vraie WebView de l'APK via DevTools (CDP natif).
// Environnement de recette uniquement : faux Supabase local, comptes fictifs. Aucune production.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const BASE = 'http://localhost:3100';
const MOCK = 'http://127.0.0.1:3199';
const PKG = 'com.hydroloopfarm.manager';
const OUT = 'smoke-out';
mkdirSync(OUT, { recursive: true });


/** Client CDP minimal (WebSocket natif de Node 22) : la WebView n'accepte pas les commandes « Browser.* » de Playwright/Puppeteer. */
class CdpPage {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(`${m.error.message}`)) : resolve(m.result);
      } else if (m.method) this.listeners.forEach((l) => l(m));
    });
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('WebSocket DevTools refusé'))); });
    const p = new CdpPage(ws);
    await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Network.enable');
    return p;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  waitEvent(name, timeout = 60_000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`événement ${name} non reçu`)), timeout);
      const l = (m) => { if (m.method === name) { clearTimeout(t); this.listeners = this.listeners.filter((x) => x !== l); resolve(m.params); } };
      this.listeners.push(l);
    });
  }
  async evaluate(fn, ...args) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      } catch (e) {
        if (attempt < 6 && /context|destroyed|navigat/i.test(String(e.message))) { await sleep(700); continue; }
        throw e;
      }
    }
  }
  async goto(u) {
    const loaded = this.waitEvent('Page.domContentEventFired');
    await this.send('Page.navigate', { url: u });
    await loaded;
  }
  async reload() { const loaded = this.waitEvent('Page.domContentEventFired'); await this.send('Page.reload'); await loaded; }
  url() { return this.evaluate(() => location.href); }
  title() { return this.evaluate(() => document.title); }
  has(sel) { return this.evaluate((q) => !!document.querySelector(q), sel); }
  async setOfflineMode(offline) { await this.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
  async screenshot({ path }) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(r.data, 'base64')); }
  close() { try { this.ws.close(); } catch { /* ignoré */ } }
}

const sh = (...args) => execFileSync('adb', args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let page, current = 'init';

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
  const targets = await waitFor(async () => {
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    return list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }, 'page de la WebView', 45_000);
  console.log('cible DevTools :', targets[0].url);
  page = await CdpPage.connect(targets[0].webSocketDebuggerUrl);
}
async function closeConnection() { page?.close(); }
const rows = async () => (await fetch(`${MOCK}/__rows`)).json();
const text = () => page.evaluate(() => document.body.innerText);
const go = (path) => page.goto(`${BASE}${path}`);
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
  await sleep(1500);
  await fill(/utilisateur/i, user);
  await fill(/mot de passe/i, `pw-${user}-test`);
  await click(/se connecter/i);
  await waitFor(async () => !(await url()).includes('/login'), 'redirection après connexion');
}
async function createBatch(strain) {
  await go('/batch/new');
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll('label')].some((l) => /souche/i.test(l.textContent || ''))), 'formulaire de culture');
  await sleep(800);
  await fill(/souche/i, strain);
  await click(/créer|enregistrer|démarrer/i, { last: true });
  await waitFor(async () => /\/batch\/B/.test(await url()), 'page de la culture créée', 30_000);
  return decodeURIComponent(new URL(await url()).pathname.split('/')[2]);
}
async function addReading(ph, note) {
  await click(/nouveau relevé/i);
  await waitFor(() => page.has('[role=dialog]'), 'fenêtre de relevé');
  await fill(/ph solution/i, ph, '[role=dialog]');
  await fill(/observation/i, note, '[role=dialog]');
  await click(/enregistrer le relevé/i, { root: '[role=dialog]' });
  await waitFor(async () => !(await page.has('[role=dialog]')), 'fermeture de la fenêtre de relevé');
}
async function offlineReady() {
  const sw = () => page.evaluate(() => !!navigator.serviceWorker?.controller);
  if (!(await waitFor(sw, 'service worker actif dans la WebView', 45_000).catch(() => false))) {
    await page.reload();
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
    const here = await url();
    expect(new URL(here).hostname === 'localhost', `hôte inattendu ${here}`);
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
    await waitFor(() => page.evaluate(() => [...document.querySelectorAll('svg')].some((e) => [...e.querySelectorAll('path')].some((p) => (p.getAttribute('d') || '').length > 200) && e.getBoundingClientRect().width > 60)), 'SVG du QR code');
    await page.screenshot({ path: `${OUT}/04-qr.png` });
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
    await waitFor(async () => new URL(await url()).pathname === '/', 'retour à l’accueil via le bouton Retour');
  });

  await step('Déconnexion', async () => {
    await click(/déconnexion/i);
    await waitFor(async () => (await url()).includes('/login'), 'retour à la page de connexion');
    await go('/');
    await waitFor(async () => (await url()).includes('/login'), 'accès protégé après déconnexion');
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
