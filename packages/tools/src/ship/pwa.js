// Mirage original code. Page side of the PWA build (written by `mirage-ship --target pwa`, loaded by index.html).
// Registers the service worker and keeps the two things a game wants to show at its own moment:
//   window.miragePWA.canInstall / .install()        the browser's install prompt, held until you call it
//   window.miragePWA.updateReady / .applyUpdate()   a new version is downloaded and waiting; apply = reload on it
//   window.addEventListener('mirage:pwa', (e) => e.detail)   { type: 'ready' | 'install' | 'installed' | 'update', ... }
// A game that wants its own flow can ignore this object and use @mirage/game/platform (registerServiceWorker,
// createInstallPrompt) instead: registering the same worker twice is harmless.
(() => {
  const tell = (detail) => window.dispatchEvent(new CustomEvent('mirage:pwa', { detail }));
  let prompt = null, reg = null, reloading = false;
  const api = window.miragePWA = {
    canInstall: false, updateReady: false, offlineReady: false,
    async install() {
      if (!prompt) return { ok: false, why: 'the browser has not offered an install' };
      const p = prompt; prompt = null; api.canInstall = false;
      await p.prompt();
      const c = await p.userChoice;
      return { ok: c.outcome === 'accepted', outcome: c.outcome };
    },
    applyUpdate() { if (reg && reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); return true; } return false; },
    check() { return reg ? reg.update().then(() => true, () => false) : Promise.resolve(false); },
  };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; api.canInstall = true; tell({ type: 'install' }); });
  window.addEventListener('appinstalled', () => { prompt = null; api.canInstall = false; tell({ type: 'installed' }); });
  const sw = navigator.serviceWorker;
  if (!sw) return;
  let controlled = !!sw.controller;
  // the page reloads once when a NEW version takes over; not on the first visit (the first worker claiming this
  // page changes nothing on screen), but also when the update arrives in the very session that installed the game
  sw.addEventListener('controllerchange', () => { if (!controlled) { controlled = true; return; } if (reloading) return; reloading = true; location.reload(); });
  const waiting = () => { if (reg.waiting && sw.controller) { api.updateReady = true; tell({ type: 'update' }); } };
  const track = (w) => { if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') waiting(); }); };
  window.addEventListener('load', () => {
    sw.register('./sw.js').then((r) => {
      reg = r; waiting(); track(r.installing);
      r.addEventListener('updatefound', () => track(r.installing));
      // a game left open for hours: look for a new build whenever the player comes back to it
      document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update().catch(() => {}); });
    }, (e) => console.warn('[mirage] service worker not registered:', e && e.message));
    sw.ready.then(() => { api.offlineReady = true; tell({ type: 'ready' }); });
  });
})();
