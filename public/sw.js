/* HydroLoop service worker v3 — hors ligne d'abord pour l'interface, jamais pour les données (stockées dans IndexedDB). */
const VERSION = 'v3';
const STATIC = `hydroloop-static-${VERSION}`;
const PAGES = `hydroloop-pages-${VERSION}`;
const CORE = ['/offline.html', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest'];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(CORE)));
  // Pas de skipWaiting automatique : l'interface propose la mise à jour (message SKIP_WAITING).
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  // Préchauffage : l'application demande de mettre en cache les pages à consulter hors ligne.
  if (msg.type === 'WARM' && Array.isArray(msg.urls)) {
    e.waitUntil(caches.open(PAGES).then((c) => Promise.all(msg.urls.map((u) =>
      fetch(u, { credentials: 'same-origin' }).then((r) => { if (r.ok && !r.redirected) return c.put(u, r); }).catch(() => undefined)))));
  }
  // Déconnexion : on retire les pages mises en cache sur cet appareil.
  if (msg.type === 'CLEAR_PAGES') e.waitUntil(caches.delete(PAGES));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

async function navigate(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await withTimeout(fetch(request), NAV_TIMEOUT_MS);
    // Ne jamais mettre en cache une redirection (ex. vers /login) ni une erreur.
    if (res.ok && !res.redirected) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (await cache.match('/'));
    return hit || (await caches.match('/offline.html')) || Response.error();
  }
}

async function staticAsset(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; });
  if (cached) { refresh.catch(() => undefined); return cached; }
  return refresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase & co : jamais interceptés
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/webpack')) return;
  if (req.headers.get('RSC') || url.searchParams.has('_rsc')) return; // navigation douce Next : le navigateur retombe sur une navigation complète

  if (req.mode === 'navigate') { e.respondWith(navigate(req)); return; }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(staticAsset(req));
  }
});
