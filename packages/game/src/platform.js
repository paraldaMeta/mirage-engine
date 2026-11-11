// Mirage original code.
// ---------------------------------------------------------------------------
// Platform layer, page side (opt-in: nothing in the engine imports this file; `@miragekit/game/platform`). One object
// for what differs between a browser tab, an installed PWA, an Electron / Tauri window and a Capacitor app on a
// phone. The renderer side (device probe, WebGL context recovery, quality governor) is `@miragekit/core/platform`.
//
//   import { createPlatform, createSaveStorage, registerServiceWorker, createInstallPrompt } from '@miragekit/game/platform';
//   const saves = await createSaveStorage();                  // the wrapper's save folder, else localStorage
//   const g = await startGame(world, { built, storage: saves, ... });
//   const platform = createPlatform({ canvas, play: g.play, game: g.game, audio: g.audio, saves });
//   platform.on('pause', () => ...); platform.on('resume', ...); platform.on('insets', (i) => ...); platform.on('inputmode', (m) => ...)
//   await platform.fullscreen.enter(); await platform.orientation.lock('landscape'); await platform.wakeLock.request();
//   platform.safeArea.insets()                                // { top, right, bottom, left } in CSS px; also --mirage-safe-* on :root
//   await platform.storage.persist()                          // ask the browser not to evict saves -> { persisted, usage, quota }
//   const sw = await registerServiceWorker('./sw.js', { onUpdate: ({ apply }) => showButton(apply) });   // mirage-ship --target pwa
//   const install = createInstallPrompt(); install.on(() => showInstallButton()); await install.prompt();
//
// Native wrappers made by `mirage-ship` put one object on the page, `window.mirageNative`
// ({ platform, save: { keys, get, set, remove }, window: { setFullscreen, isFullscreen }, orientation: { lock, unlock },
// keepAwake(on), quit() }), and this file talks only to that; it never imports Electron, Tauri or Capacitor.
// Every call is safe where the feature is missing: it resolves to { ok: false, why } instead of throwing.
// Not here: pointer lock and gamepads (play.js and input.js own them and they work unchanged in every wrapper),
// in-app purchases, achievements, push messages, cloud saves: those are store SDKs (docs/platforms.md).
// ---------------------------------------------------------------------------

/** the wrapper's bridge (window.mirageNative) or null in a plain browser */
export const nativeBridge = (win = globalThis.window) => { try { return win?.mirageNative || null; } catch { return null; } };
const fail = (why) => ({ ok: false, why });
const attempt = async (fn, why) => { try { const r = await fn(); return r === false ? fail(why) : { ok: true }; } catch (e) { return fail(e?.message || why); } };

// ---------------------------------------------------------------------------
// Saves. createGame's storage is synchronous (getItem / setItem, like localStorage); a native save folder is not.
// So: read every save of this game once (await createSaveStorage), serve reads from memory, and write behind.
// flush() resolves when everything is on disk (the platform object calls it when the page is hidden or closed).
// A failed native write is kept and retried on the next flush; nothing is dropped silently (storage.errors).
// ---------------------------------------------------------------------------
export async function createSaveStorage({ native = nativeBridge(), prefix = 'mirage:', fallback = localOrNull(), onError } = {}) {
  const mem = new Map(), dirty = new Map(), errors = [];
  let writing = null;
  const backend = native?.save ? 'native' : fallback ? 'local' : 'memory';
  if (backend === 'native') {
    for (const k of await native.save.keys()) if (k.startsWith(prefix)) { const v = await native.save.get(k); if (v != null) mem.set(k, String(v)); }
    // a first run inside a wrapper that replaces a browser build: nothing to migrate; saves never leave their origin
  }
  async function drain() {
    while (dirty.size) {
      const [k, v] = dirty.entries().next().value;
      dirty.delete(k);
      try { if (v === null) await native.save.remove(k); else await native.save.set(k, v); }
      catch (e) { errors.push({ key: k, message: e?.message || String(e) }); if (!dirty.has(k)) dirty.set(k, v); if (onError) onError(e, k); break; }
    }
  }
  const flush = () => (backend !== 'native' ? Promise.resolve() : (writing = (writing || Promise.resolve()).then(drain)));
  const put = (k, v) => { if (backend === 'native') { dirty.set(k, v); flush(); } };
  return {
    backend, errors,
    getItem(k) { if (backend === 'local') return fallback.getItem(k); return mem.has(k) ? mem.get(k) : null; },
    setItem(k, v) { v = String(v); if (backend === 'local') return void fallback.setItem(k, v); mem.set(k, v); put(k, v); },
    removeItem(k) { if (backend === 'local') return void fallback.removeItem(k); mem.delete(k); put(k, null); },
    keys() {
      if (backend !== 'local') return [...mem.keys()];
      const out = []; for (let i = 0; i < fallback.length; i++) { const k = fallback.key(i); if (k && k.startsWith(prefix)) out.push(k); } return out;
    },
    /** writes not yet confirmed by the wrapper */
    get pending() { return dirty.size; },
    flush,
  };
}
function localOrNull() { try { return globalThis.localStorage || null; } catch { return null; } }

// ---------------------------------------------------------------------------
// Safe area: the insets of the notch, the home bar and rounded corners in CSS px. env(safe-area-inset-*) is read
// through a probe element (the only way to get the numbers into JS); a wrapper that knows better (an Android
// WebView under a cutout reports 0 before Chromium 136) can give its own through --safe-area-inset-* on :root.
// The UI toolkit (ui-kit.js `safeArea`) uses env() directly and needs no call; this is for a canvas HUD, a world
// UI, or game code that must keep something out from under the notch.
// ---------------------------------------------------------------------------
export function safeAreaInsets(doc = globalThis.document, win = globalThis.window) {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!doc?.createElement || !doc.documentElement) return zero;
  const el = doc.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;' +
    ['top', 'right', 'bottom', 'left'].map((s) => `padding-${s}:max(env(safe-area-inset-${s},0px),var(--safe-area-inset-${s},0px))`).join(';');
  doc.documentElement.appendChild(el);
  let out = zero;
  try { const cs = win.getComputedStyle(el); out = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 }; }
  catch { /* no layout here */ }
  el.remove();
  return out;
}

/** which controls to show: 'touch' on a touch-first device, 'pad' once a gamepad is connected, else 'keyboard' */
export function inputMode({ nav = globalThis.navigator || {}, win = globalThis.window } = {}) {
  const mq = (q) => { try { return !!win?.matchMedia?.(q).matches; } catch { return false; } };
  let pads = 0;
  try { pads = [...(nav.getGamepads?.() || [])].filter(Boolean).length; } catch { /* blocked by permissions policy */ }
  const touch = (nav.maxTouchPoints || 0) > 0, coarse = mq('(pointer: coarse)'), hover = mq('(hover: hover)');
  // a laptop with a touch screen has a fine pointer and hover: it keeps the keyboard until a finger actually lands
  return { touch, coarse, hover, points: nav.maxTouchPoints || 0, pads, mode: pads ? 'pad' : touch && (coarse || !hover) ? 'touch' : 'keyboard' };
}

// ---------------------------------------------------------------------------
// createPlatform. opts: { canvas, play, game, audio, saves, target (the element that goes fullscreen; the canvas'
// parent by default so DOM overlays stay visible), pauseOnHide = true, resumeOnShow = false (a game that was paused
// by a phone call stays paused, as store guidelines ask), pauseOnBlur = false (true: pause when the window loses focus
// while still on screen: Alt+Tab or Cmd+Tab away from a desktop window hides nothing; a function: called instead,
// e.g. to open the pause menu), wakeLock = false (true: held
// while visible), win, doc, nav }
// ---------------------------------------------------------------------------
export function createPlatform(opts = {}) {
  const { canvas = null, play = null, game = null, saves = null, pauseOnHide = true, resumeOnShow = false, pauseOnBlur = false } = opts;
  const win = opts.win || globalThis.window, doc = opts.doc || globalThis.document, nav = opts.nav || globalThis.navigator || {};
  const native = opts.native === undefined ? nativeBridge(win) : opts.native;
  let audio = opts.audio || null;
  const listeners = new Map(), offs = [];
  const emit = (type, data) => { for (const fn of listeners.get(type) || []) { try { fn(data); } catch (e) { console.error(`[mirage] platform '${type}' listener failed:`, e); } } };
  const listen = (t, type, fn, o) => { if (!t?.addEventListener) return; t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  const ctxOf = () => audio?.ctx || (audio && typeof audio.resume === 'function' && audio.state ? audio : null);   // an engine / mixer, or a bare AudioContext

  // ---- visibility: hidden = stop simulating, stop sound, let the screen sleep, put the saves on disk
  let hidden = !!doc?.hidden, autoPaused = false, disposed = false;
  function hide(reason) {
    if (hidden && reason === 'visibility') return;
    hidden = true;
    if (pauseOnHide && game && !game.paused) { game.pause(true); autoPaused = true; }
    const c = ctxOf(); if (c && c.state === 'running') c.suspend?.().catch?.(() => {});
    lock.release(true);
    saves?.flush?.();
    emit('pause', { reason });
  }
  function show(reason) {
    if (!hidden) return;
    hidden = false;
    const c = ctxOf(); if (c && c.state !== 'running' && unlocked) c.resume?.().catch?.(() => { armUnlock(); });
    if (autoPaused && resumeOnShow && game) game.pause(false);
    autoPaused = false;
    if (lock.wanted) lock.request();
    if (play) play.wake?.();
    measure();
    emit('resume', { reason });
  }
  listen(doc, 'visibilitychange', () => (doc.hidden ? hide('visibility') : show('visibility')));
  // a desktop window behind another one stays visible and keeps running; a game the player switched away from
  // should not. Paused only, never resumed by focus: the player comes back to the pause menu, not to a fight.
  if (pauseOnBlur) listen(win, 'blur', () => {
    if (hidden || !game || game.paused) return;
    if (typeof pauseOnBlur === 'function') pauseOnBlur(); else game.pause(true);
    emit('pause', { reason: 'blur' });
  });
  // pagehide: the last event a mobile browser guarantees before it may kill the page; freeze: Chrome's tab freezing
  listen(win, 'pagehide', () => { saves?.flush?.(); emit('exit', {}); });
  listen(doc, 'freeze', () => hide('freeze'));
  listen(doc, 'resume', () => { if (!doc.hidden) show('freeze'); });

  // ---- audio unlock: browsers and WebViews start an AudioContext suspended until a gesture; iOS also interrupts it
  // (a call, Siri, the silent switch) and needs another gesture afterwards. Armed again whenever it is not running.
  let unlocked = false, armed = false;
  const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'];
  function onGesture() {
    try { audio?.unlock?.(); } catch { /* no AudioContext in this browser */ }
    const c = ctxOf();
    const done = () => { unlocked = true; disarm(); emit('audio', { state: c?.state || 'none' }); };
    if (c && c.state !== 'running' && c.resume) c.resume().then(done, () => {}); else done();
  }
  function disarm() { if (!armed) return; armed = false; for (const g of GESTURES) doc?.removeEventListener?.(g, onGesture, true); }
  function armUnlock() { if (armed || disposed || !doc?.addEventListener) return; armed = true; for (const g of GESTURES) doc.addEventListener(g, onGesture, { capture: true, passive: true }); }
  if (audio) armUnlock();
  const watchState = () => { const c = ctxOf(); if (c && !c.__mirageWatched) { c.__mirageWatched = true; listen(c, 'statechange', () => { if (c.state !== 'running' && !hidden) armUnlock(); emit('audio', { state: c.state }); }); } };

  // ---- wake lock: the screen stays on while the game is in front. The lock is dropped by the browser whenever the
  // page is hidden, so it is asked for again on every return.
  const lock = {
    wanted: false, sentinel: null,
    async request() {
      lock.wanted = true;
      if (native?.keepAwake) return attempt(() => native.keepAwake(true), 'the wrapper refused');
      if (!nav.wakeLock?.request) return fail('no Screen Wake Lock API');
      if (doc?.hidden) return fail('hidden');
      try { lock.sentinel = await nav.wakeLock.request('screen'); lock.sentinel.addEventListener?.('release', () => { lock.sentinel = null; }); return { ok: true }; }
      catch (e) { return fail(e?.message || 'refused (low battery or power saver)'); }
    },
    /** keep: drop the lock but ask again on the next resume */
    async release(keep = false) {
      if (!keep) lock.wanted = false;
      if (native?.keepAwake) return attempt(() => native.keepAwake(false), 'the wrapper refused');
      const s = lock.sentinel; lock.sentinel = null;
      if (s) await s.release?.().catch?.(() => {});
      return { ok: true };
    },
    get held() { return !!lock.sentinel; },
  };
  if (opts.wakeLock) lock.request();

  // ---- fullscreen: the wrapper's window when there is one, else the Fullscreen API (prefixed on older Safari).
  // An iPhone has no element fullscreen at all: install the page (PWA) or wrap it (Capacitor) for a full screen.
  const fsTarget = () => opts.target || canvas?.parentElement || doc?.documentElement;
  const fsElement = () => doc?.fullscreenElement || doc?.webkitFullscreenElement || null;
  const fullscreen = {
    get supported() { return !!native?.window?.setFullscreen || !!(fsTarget()?.requestFullscreen || fsTarget()?.webkitRequestFullscreen); },
    get active() { return nativeFs || !!fsElement(); },
    async enter() {
      if (native?.window?.setFullscreen) { const r = await attempt(() => native.window.setFullscreen(true), 'the wrapper refused'); if (r.ok) { nativeFs = true; emit('fullscreen', { active: true }); } return r; }
      const el = fsTarget(), req = el?.requestFullscreen || el?.webkitRequestFullscreen;
      if (!req) return fail('no Fullscreen API (an iPhone: install the page or use the Capacitor build)');
      return attempt(() => req.call(el, { navigationUI: 'hide' }), 'refused (call it from a click or key press)');
    },
    async exit() {
      if (native?.window?.setFullscreen) { const r = await attempt(() => native.window.setFullscreen(false), 'the wrapper refused'); if (r.ok) { nativeFs = false; emit('fullscreen', { active: false }); } return r; }
      const ex = doc?.exitFullscreen || doc?.webkitExitFullscreen;
      if (!ex || !fsElement()) return { ok: true };
      return attempt(() => ex.call(doc), 'refused');
    },
    toggle() { return fullscreen.active ? fullscreen.exit() : fullscreen.enter(); },
  };
  let nativeFs = false;
  if (native?.window?.isFullscreen) Promise.resolve(native.window.isFullscreen()).then((v) => { nativeFs = !!v; }, () => {});
  for (const t of ['fullscreenchange', 'webkitfullscreenchange']) listen(doc, t, () => { measure(); emit('fullscreen', { active: !!fsElement() }); });

  // ---- orientation: 'landscape' | 'portrait' | 'any' (or an exact OrientationLockType). In a browser tab Chrome
  // for Android allows the lock only in fullscreen; an installed PWA takes it from its manifest; Safari has none.
  const orientation = {
    get type() { return win?.screen?.orientation?.type || (win && win.innerWidth > win.innerHeight ? 'landscape-primary' : 'portrait-primary'); },
    async lock(type = 'landscape') {
      if (native?.orientation?.lock) return attempt(() => native.orientation.lock(type), 'the wrapper refused');
      const o = win?.screen?.orientation;
      if (!o?.lock) return fail('no Screen Orientation lock (Safari: set it in the manifest or the native project)');
      return attempt(() => o.lock(type), 'refused (needs fullscreen or an installed app)');
    },
    async unlock() {
      if (native?.orientation?.unlock) return attempt(() => native.orientation.unlock(), 'the wrapper refused');
      try { win?.screen?.orientation?.unlock?.(); } catch { /* not locked */ }
      return { ok: true };
    },
  };

  // ---- safe area: measured now and on every change of size or orientation; written to :root for CSS
  let insets = { top: 0, right: 0, bottom: 0, left: 0 };
  function measure() {
    const next = safeAreaInsets(doc, win);
    const same = ['top', 'right', 'bottom', 'left'].every((k) => next[k] === insets[k]);
    insets = next;
    const st = doc?.documentElement?.style;
    if (st?.setProperty) for (const k of Object.keys(next)) st.setProperty(`--mirage-safe-${k}`, next[k] + 'px');
    if (!same) emit('insets', { ...insets });
  }
  measure();
  listen(win, 'resize', measure);
  listen(win?.screen?.orientation, 'change', () => { measure(); emit('orientation', { type: orientation.type }); });

  // ---- which controls: follows what the player actually uses (a finger on a laptop screen, a pad plugged in later)
  let mode = inputMode({ nav, win }).mode;
  const setMode = (m) => { if (m !== mode) { mode = m; emit('inputmode', m); } };
  listen(win, 'touchstart', () => setMode('touch'), { passive: true, capture: true });
  listen(win, 'gamepadconnected', () => setMode('pad'));
  listen(win, 'gamepaddisconnected', () => setMode(inputMode({ nav, win }).mode));
  listen(win, 'keydown', (e) => { if (!e.repeat && mode !== 'keyboard' && !e.isComposing) setMode('keyboard'); }, { capture: true });

  // ---- storage persistence: without it a browser may evict localStorage / IndexedDB / the service worker cache of
  // a site the user has not installed or bookmarked (Safari: after 7 days without a visit)
  const storage = {
    async persist() {
      const s = nav.storage;
      if (native) return { ok: true, persisted: true, why: 'native app storage' };
      if (!s?.persist) return { ...fail('no StorageManager.persist'), persisted: false };
      try {
        const persisted = (await s.persisted?.()) || await s.persist();
        const e = (await s.estimate?.()) || {};
        return { ok: true, persisted: !!persisted, usage: e.usage ?? null, quota: e.quota ?? null };
      } catch (e) { return { ...fail(e?.message || 'refused'), persisted: false }; }
    },
    async estimate() { try { const e = await nav.storage?.estimate?.(); return e ? { usage: e.usage ?? null, quota: e.quota ?? null } : null; } catch { return null; } },
  };

  const api = {
    native, kind: native?.platform || (isStandalone(win, nav) ? 'pwa' : 'web'),
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type)?.delete(fn); },
    get hidden() { return hidden; }, get inputMode() { return mode; }, get audioUnlocked() { return unlocked; },
    /** give (or replace) the audio object after the fact: an engine, a mixer or an AudioContext */
    setAudio(a) { audio = a; unlocked = false; watchState(); armUnlock(); },
    wakeLock: lock, fullscreen, orientation, storage,
    safeArea: { insets: () => ({ ...insets }), measure },
    /** close the app: only a wrapper can (a browser tab cannot close itself) */
    quit: () => (native?.quit ? attempt(() => native.quit(), 'the wrapper refused') : Promise.resolve(fail('a browser tab cannot close itself'))),
    dispose() {
      disposed = true; disarm();
      for (const off of offs.splice(0)) off();
      lock.release(); listeners.clear();
      const st = doc?.documentElement?.style;
      if (st?.removeProperty) for (const k of ['top', 'right', 'bottom', 'left']) st.removeProperty(`--mirage-safe-${k}`);
    },
  };
  watchState();
  return api;
}
const isStandalone = (win, nav) => { try { return !!win?.matchMedia?.('(display-mode: standalone)').matches || !!win?.matchMedia?.('(display-mode: fullscreen)').matches || nav?.standalone === true; } catch { return false; } };

// ---------------------------------------------------------------------------
// PWA: the service worker written by `mirage-ship --target pwa` (versioned precache, offline start).
// Update flow: a new version installs in the background and WAITS; onUpdate({ version, apply }) lets the game pick
// the moment (not in the middle of a fight); apply() activates it and the page reloads once on the new files.
// ---------------------------------------------------------------------------
export async function registerServiceWorker(url = './sw.js', { scope, onUpdate, onReady, checkEvery = 0, nav = globalThis.navigator || {}, win = globalThis.window } = {}) {
  const sw = nav.serviceWorker;
  if (!sw?.register) return { ok: false, why: 'no service worker here (file://, a wrapper, or an insecure origin)' };
  let reg;
  try { reg = await sw.register(url, scope ? { scope } : undefined); } catch (e) { return { ok: false, why: e?.message || 'registration failed' }; }
  let reloading = false;
  // reload once when a NEW version takes over; the first worker claiming a first visit changes nothing on screen
  let controlled = !!sw.controller;
  sw.addEventListener('controllerchange', () => { if (!controlled) { controlled = true; return; } if (reloading) return; reloading = true; win?.location?.reload(); });
  const apply = () => { const w = reg.waiting; if (w) w.postMessage({ type: 'SKIP_WAITING' }); return !!w; };
  const version = (worker) => new Promise((res) => {
    if (!worker || typeof MessageChannel === 'undefined') return res(null);
    const ch = new MessageChannel(), done = (v) => { ch.port1.close(); res(v); };   // an open port keeps a channel alive for good
    ch.port1.onmessage = (e) => done(e.data?.version ?? null);
    try { worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]); } catch { done(null); }
    setTimeout(() => done(null), 1000);
  });
  const announce = async () => { if (reg.waiting && sw.controller && onUpdate) onUpdate({ version: await version(reg.waiting), apply }); };
  const track = (w) => w?.addEventListener('statechange', () => { if (w.state === 'installed') announce(); });
  if (reg.waiting) announce();
  track(reg.installing);
  reg.addEventListener('updatefound', () => track(reg.installing));
  let timer = 0;
  if (checkEvery > 0) timer = setInterval(() => reg.update().catch(() => {}), checkEvery);
  sw.ready.then(async (r) => { if (onReady) onReady({ version: await version(r.active), offline: true }); }, () => {});
  return { ok: true, registration: reg, apply, check: () => reg.update().then(() => true, () => false), version: () => version(reg.active || sw.controller), dispose: () => clearInterval(timer) };
}

/** The install button. Chrome / Edge / Android fire `beforeinstallprompt`: keep it, show your own button, call
 *  prompt() from its click. Safari has no event: `ios` is true there and the page can only explain Share -> Add to
 *  Home Screen. -> { available, installed, ios, on(fn), prompt() -> { ok, outcome } , dispose } */
export function createInstallPrompt({ win = globalThis.window, nav = globalThis.navigator || {} } = {}) {
  let event = null, installed = isStandalone(win, nav);
  const fns = new Set();
  const tell = () => { for (const fn of fns) fn({ available: !!event, installed }); };
  const onBefore = (e) => { e.preventDefault(); event = e; tell(); };   // preventDefault: no browser mini-infobar
  const onInstalled = () => { installed = true; event = null; tell(); };
  win?.addEventListener?.('beforeinstallprompt', onBefore);
  win?.addEventListener?.('appinstalled', onInstalled);
  const ua = nav.userAgent || '';
  return {
    get available() { return !!event; }, get installed() { return installed; },
    ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1),
    on(fn) { fns.add(fn); if (event || installed) fn({ available: !!event, installed }); return () => fns.delete(fn); },
    async prompt() {
      if (!event) return { ok: false, why: installed ? 'already installed' : 'the browser has not offered an install (Safari: Share, then Add to Home Screen)' };
      const e = event; event = null;
      try { await e.prompt(); const c = await e.userChoice; tell(); return { ok: c?.outcome === 'accepted', outcome: c?.outcome || 'dismissed' }; }
      catch (err) { return { ok: false, why: err?.message || 'refused' }; }
    },
    dispose() { win?.removeEventListener?.('beforeinstallprompt', onBefore); win?.removeEventListener?.('appinstalled', onInstalled); fns.clear(); },
  };
}
