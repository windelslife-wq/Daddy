/* Film Club Lens service worker.
 * Caches the app shell for offline navigation only. API responses, media and
 * authenticated pages are NEVER cached — credits, jobs and videos must always
 * reflect the server's real state.
 */
const CACHE = 'film-club-lens-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept API, auth, media or admin traffic.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth') || url.pathname.startsWith('/sandbox')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/') || caches.match(request)),
    );
    return;
  }
  // Static build assets: stale-while-revalidate.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const fresh = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone()).catch(() => {});
          return response;
        }).catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});
