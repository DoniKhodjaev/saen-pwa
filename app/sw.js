// A release is cached as one unit: shell + catalog + queue. No mixed old/new scripts.
const VERSION = 'saen-v9-2026-10-19-orders';
const STATIC_CACHE = `${VERSION}-static`;
const STATIC_ASSETS = ['/app/', '/app/catalog.js', '/app/order-schema.js', '/app/order-client.js',
  '/app/manifest.json', '/app/icon-192.png', '/app/icon-512.png'];
self.addEventListener('install', event => {
  // Failed installation must not evict the last working offline release.
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('saen-') && key !== STATIC_CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const shell = req.mode === 'navigate' && ['/app','/app/','/app/index.html'].includes(url.pathname);
  if (!shell && !STATIC_ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(shell ? '/app/' : url.pathname);
    return cached || fetch(req);
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
