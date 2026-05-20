// Saen PWA — Service Worker
// Cache strategy: cache-first for static assets, network-first for index.html.
// On new SW deployment, asks already-installed clients to update.

// Bump this string on every meaningful release.
// Old caches with different versions will be purged on activate.
const VERSION = 'saen-v4-2026-05-20';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// Assets to pre-cache for offline use.
// Note: index.html is intentionally NOT pre-cached — we want network-first for it,
// so customers always see the latest content when online.
const STATIC_ASSETS = [
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];

// ─── Install: cache static assets ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((e) => console.warn('SW: precache failed', e))
  );
  // Activate the new SW immediately, don't wait for old tabs to close
  self.skipWaiting();
});

// ─── Activate: clean up old caches ───
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => {
            console.log('SW: removing old cache', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: choose strategy by request type ───
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // Never cache the Telegram notification endpoint
  if (url.pathname.startsWith('/api/')) return;

  // index.html (and root): network-first with cache fallback.
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Google Fonts: stale-while-revalidate
  if (url.host.includes('fonts.googleapis.com') || url.host.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Everything else: cache-first
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const indexCached = await caches.match('index.html') || await caches.match('./');
    if (indexCached) return indexCached;
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((fresh) => {
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  }).catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
