const CACHE = 'hydroloop-v2';
const PRECACHE = ['/', '/analytics', '/batch/new', '/donnees'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never intercept: API routes, auth, hot-reload
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/webpack') ||
    e.request.method !== 'GET'
  ) {
    return;
  }

  // Network-first for HTML navigation (fresh content when online)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // Ne pas mettre en cache les redirections (ex. vers /login) ni les erreurs
          if (res.ok && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Cache-first for static assets (_next/static, images, fonts)
  e.respondWith(
    caches.match(e.request).then(
      (cached) =>
        cached ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        }),
    ),
  );
});
