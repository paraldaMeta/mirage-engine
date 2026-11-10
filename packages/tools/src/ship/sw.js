// Mirage original code. Service worker written by `mirage-ship --target pwa` (template: the three constants are filled in).
// Versioned precache: every file of this build goes into one cache named after the build's content hash, all or
// nothing (a failed download leaves the previous version in charge). The page then starts with no network at all.
// Update: a new build installs next to the old one and WAITS; the page decides when to switch (SKIP_WAITING), or
// it switches by itself once every tab of the old version is closed. Old caches are deleted on activation.
const VERSION = '__VERSION__';
const PREFIX = '__CACHE_PREFIX__';
const FILES = __FILES__;
const CACHE = PREFIX + VERSION;

self.addEventListener('install', (e) => {
  // cache: 'reload' = past the HTTP cache: a stale copy there must not be frozen into this version
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();   // the very first visit: the open page is served from the cache from now on
  })());
});

self.addEventListener('message', (e) => {
  const type = e.data && e.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  else if (type === 'GET_VERSION' && e.ports[0]) e.ports[0].postMessage({ version: VERSION, files: FILES.length });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                // other origins: the browser's business
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // a navigation gets the page whatever its query string says (?quality=low must also start offline)
    const hit = await cache.match(req.mode === 'navigate' && url.pathname.endsWith('/') ? './index.html' : req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) {
      if (req.mode === 'navigate') { const page = await cache.match('./index.html'); if (page) return page; }
      throw err;
    }
  })());
});
