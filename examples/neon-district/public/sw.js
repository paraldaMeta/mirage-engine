// NEON DISTRICT's service worker: the whole built game cached on install, so it starts again with no network.
// The build (vite.config.js) fills VERSION and FILES in dist/sw.js; this copy in public/ is the source.
//   index.html (a navigation)   network first, the cached page when offline
//   everything else             cache first (the hashed assets never change under one name), the network otherwise
// A new build is a new VERSION: it installs in the background, takes over at once and drops the old cache, so the
// next load runs the new build.
const VERSION = 'dev';
const FILES = [];
const CACHE = 'neon-district-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('neon-district-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); }
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(r, { ignoreSearch: true }).then((hit) => hit || fetch(r)));
});
