// Mirage original code. Node checks of the platform layer's page side (src/platform.js) with a fake window,
// document, navigator and wrapper bridge. (The real browser: packages/tools/src/ship-browser-check.mjs.)
import assert from 'node:assert/strict';
import { nativeBridge, createSaveStorage, safeAreaInsets, inputMode, createPlatform, registerServiceWorker, createInstallPrompt } from './src/platform.js';
import { createGame } from './src/game.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
// an event target small enough to read
const target = (extra = {}) => { const L = new Map(); return Object.assign({ L,
  addEventListener(t, f) { if (!L.has(t)) L.set(t, new Set()); L.get(t).add(f); }, removeEventListener(t, f) { L.get(t)?.delete(f); },
  fire(t, e = {}) { for (const f of [...(L.get(t) || [])]) f(e); }, count() { let n = 0; for (const s of L.values()) n += s.size; return n; } }, extra); };
const localLike = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, m }; };
// the wrapper's save folder: asynchronous, can be made to fail
const nativeSave = (seed = {}) => { const disk = new Map(Object.entries(seed)); const s = { disk, failing: false, writes: 0,
  keys: async () => [...disk.keys()], get: async (k) => (disk.has(k) ? disk.get(k) : null),
  set: async (k, v) => { await tick(1); if (s.failing) throw new Error('disk full'); s.writes++; disk.set(k, v); },
  remove: async (k) => { await tick(1); if (s.failing) throw new Error('disk full'); disk.delete(k); } }; return s; };

{ // nativeBridge
  assert.equal(nativeBridge({}), null); assert.equal(nativeBridge(undefined), null);
  const b = { platform: 'electron' }; assert.equal(nativeBridge({ mirageNative: b }), b);
  assert.equal(nativeBridge(new Proxy({}, { get() { throw new Error('blocked'); } })), null);
}
{ // saves in a browser: straight through to localStorage, only this game's keys listed
  const ls = localLike(); ls.setItem('other', '1'); ls.setItem('mirage:a:save', 'x');
  const s = await createSaveStorage({ native: null, fallback: ls });
  assert.equal(s.backend, 'local'); assert.equal(s.getItem('mirage:a:save'), 'x'); assert.deepEqual(s.keys(), ['mirage:a:save']);
  s.setItem('mirage:b', 5); assert.equal(ls.getItem('mirage:b'), '5'); s.removeItem('mirage:b'); assert.equal(ls.getItem('mirage:b'), null);
  await s.flush(); assert.equal(s.pending, 0);
  const m = await createSaveStorage({ native: null, fallback: null });
  assert.equal(m.backend, 'memory'); m.setItem('k', 'v'); assert.equal(m.getItem('k'), 'v'); assert.deepEqual(m.keys(), ['k']);
}
{ // saves in a wrapper: read once, synchronous reads, written behind, in order, the last value wins
  const save = nativeSave({ 'mirage:g:save': '{"n":1}', 'unrelated': 'zz' });
  const s = await createSaveStorage({ native: { platform: 'tauri', save } });
  assert.equal(s.backend, 'native'); assert.equal(s.getItem('mirage:g:save'), '{"n":1}'); assert.equal(s.getItem('unrelated'), null); assert.deepEqual(s.keys(), ['mirage:g:save']);
  s.setItem('mirage:g:save', '{"n":2}'); s.setItem('mirage:g:save', '{"n":3}'); s.setItem('mirage:g:opt', 'a'); s.removeItem('mirage:g:opt');
  assert.equal(s.getItem('mirage:g:save'), '{"n":3}', 'reads see the write at once'); assert.equal(s.getItem('mirage:g:opt'), null);
  await s.flush();
  assert.equal(s.pending, 0); assert.equal(save.disk.get('mirage:g:save'), '{"n":3}'); assert.equal(save.disk.has('mirage:g:opt'), false); assert.equal(save.disk.get('unrelated'), 'zz');
  // a failed write is kept, reported and written by a later flush
  const seen = []; const s2 = await createSaveStorage({ native: { save }, onError: (e, k) => seen.push(k) });
  save.failing = true; s2.setItem('mirage:g:save', 'new'); await s2.flush();
  assert.equal(s2.pending, 1); assert.equal(s2.errors.length, 2, 'the try at setItem and the one in flush'); assert.equal(s2.errors[0].message, 'disk full'); assert.deepEqual(seen, ['mirage:g:save', 'mirage:g:save']); assert.equal(save.disk.get('mirage:g:save'), '{"n":3}');
  save.failing = false; await s2.flush();
  assert.equal(s2.pending, 0); assert.equal(save.disk.get('mirage:g:save'), 'new');
  // the engine's own save system on top of it: a save made in one session is there in the next
  const st = await createSaveStorage({ native: { save } });
  const g = createGame({ id: 'plat', version: 1, storage: st });
  g.set('coins', 7); assert.ok(g.save());
  await st.flush();
  const g2 = createGame({ id: 'plat', version: 1, storage: await createSaveStorage({ native: { save } }) });
  assert.ok(g2.load()); assert.equal(g2.flags.coins, 7);
}
{ // safe area and input mode
  assert.deepEqual(safeAreaInsets(null, null), { top: 0, right: 0, bottom: 0, left: 0 });
  let removed = false; const el = { style: {}, remove() { removed = true; } };
  const doc = { createElement: () => el, documentElement: { appendChild() {} } };
  const win = { getComputedStyle: () => ({ paddingTop: '47px', paddingRight: '0px', paddingBottom: '34px', paddingLeft: '' }) };
  assert.deepEqual(safeAreaInsets(doc, win), { top: 47, right: 0, bottom: 34, left: 0 });
  assert.ok(removed); assert.match(el.style.cssText, /env\(safe-area-inset-top,0px\)/); assert.match(el.style.cssText, /var\(--safe-area-inset-left,0px\)/);
  const mm = (on) => ({ matchMedia: (q) => ({ matches: on.includes(q) }) });
  assert.equal(inputMode({ nav: { maxTouchPoints: 5 }, win: mm(['(pointer: coarse)']) }).mode, 'touch');
  assert.equal(inputMode({ nav: { maxTouchPoints: 10 }, win: mm(['(hover: hover)']) }).mode, 'keyboard');   // a laptop with a touch screen
  assert.equal(inputMode({ nav: { maxTouchPoints: 0 }, win: mm(['(hover: hover)']) }).mode, 'keyboard');
  assert.equal(inputMode({ nav: { maxTouchPoints: 5, getGamepads: () => [null, { id: 'pad' }] }, win: mm(['(pointer: coarse)']) }).mode, 'pad');
  assert.equal(inputMode({ nav: { getGamepads() { throw new Error('policy'); } }, win: {} }).mode, 'keyboard');
}
// a page for createPlatform
function page({ native = null, hidden = false } = {}) {
  const root = { style: { p: {}, setProperty(k, v) { this.p[k] = v; }, removeProperty(k) { delete this.p[k]; } }, appendChild() {}, requestFullscreen: async () => { doc.fullscreenElement = root; doc.fire('fullscreenchange'); } };
  const pad = { paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' };
  const doc = target({ hidden, documentElement: root, fullscreenElement: null, createElement: () => ({ style: {}, remove() {} }), exitFullscreen: async () => { doc.fullscreenElement = null; doc.fire('fullscreenchange'); } });
  const orient = target({ type: 'portrait-primary', locked: null, lock: async (t) => { orient.locked = t; }, unlock() { orient.locked = null; } });
  const win = target({ pad, screen: { orientation: orient }, innerWidth: 390, innerHeight: 844, getComputedStyle: () => win.pad, matchMedia: () => ({ matches: false }), mirageNative: native });
  const sentinels = []; const nav = { maxTouchPoints: 0, wakeLock: { request: async () => { const s = target({ released: false, release: async () => { s.released = true; s.fire('release'); } }); sentinels.push(s); return s; } },
    storage: { persisted: async () => false, persist: async () => true, estimate: async () => ({ usage: 10, quota: 1000 }) } };
  return { doc, win, nav, root, orient, sentinels };
}
{ // createPlatform in a browser tab: hidden pauses the game, suspends sound, drops the wake lock, flushes saves
  const { doc, win, nav, root, orient, sentinels } = page();
  const log = [], game = { paused: false, pause(on) { this.paused = on; log.push('pause ' + on); } };
  const ctx = target({ state: 'suspended', resume: async () => { ctx.state = 'running'; ctx.fire('statechange'); }, suspend: async () => { ctx.state = 'suspended'; ctx.fire('statechange'); } });
  const audio = { ctx, unlock() { log.push('unlock'); } }, saves = { flush: async () => { log.push('flush'); } }, play = { wake() { log.push('wake'); } };
  const p = createPlatform({ win, doc, nav, game, audio, saves, play, wakeLock: true });
  for (const t of ['pause', 'resume', 'exit', 'audio', 'fullscreen', 'orientation', 'insets', 'inputmode']) p.on(t, (d) => log.push(`${t}:${typeof d === 'string' ? d : JSON.stringify(d)}`));
  assert.equal(p.kind, 'web'); assert.equal(p.native, null); assert.equal(p.hidden, false); assert.equal(p.inputMode, 'keyboard');
  await tick(); assert.equal(sentinels.length, 1); assert.equal(p.wakeLock.held, true);
  // audio: locked until a gesture
  assert.equal(p.audioUnlocked, false); assert.ok(doc.L.get('pointerdown').size === 1);
  doc.fire('pointerdown'); await tick();
  assert.equal(p.audioUnlocked, true); assert.equal(ctx.state, 'running'); assert.ok(log.includes('unlock')); assert.equal(doc.L.get('pointerdown').size, 0, 'the gesture listeners are gone once it runs');
  // hidden
  log.length = 0; doc.hidden = true; doc.fire('visibilitychange'); await tick(5);
  assert.equal(p.hidden, true); assert.equal(game.paused, true); assert.equal(ctx.state, 'suspended'); assert.equal(sentinels[0].released, true); assert.equal(p.wakeLock.wanted, true);
  assert.ok(log.includes('flush') && log.includes('pause:{"reason":"visibility"}'));
  // back: sound and the wake lock return, the game stays paused (the player resumes it), play is woken
  log.length = 0; doc.hidden = false; doc.fire('visibilitychange'); await tick(5);
  assert.equal(p.hidden, false); assert.equal(game.paused, true); assert.equal(ctx.state, 'running'); assert.equal(sentinels.length, 2); assert.ok(log.includes('wake') && log.includes('resume:{"reason":"visibility"}'));
  // an interruption (a phone call) suspends the context while visible: the next gesture brings it back
  ctx.state = 'interrupted'; ctx.fire('statechange'); assert.equal(doc.L.get('pointerdown').size, 1);
  doc.fire('keydown'); await tick(); assert.equal(ctx.state, 'running');
  // a game the player paused is not marked as ours; freeze / pagehide
  game.paused = true; doc.fire('freeze'); assert.equal(p.hidden, true); doc.fire('resume'); assert.equal(p.hidden, false);
  log.length = 0; win.fire('pagehide'); assert.ok(log.includes('flush') && log.includes('exit:{}'));
  // fullscreen and orientation through the web APIs
  assert.equal(p.fullscreen.supported, true); assert.deepEqual(await p.fullscreen.enter(), { ok: true }); assert.equal(p.fullscreen.active, true);
  assert.deepEqual(await p.fullscreen.toggle(), { ok: true }); assert.equal(p.fullscreen.active, false);
  assert.deepEqual(await p.orientation.lock(), { ok: true }); assert.equal(orient.locked, 'landscape'); await p.orientation.unlock(); assert.equal(orient.locked, null);
  orient.lock = async () => { throw new Error('NotSupportedError'); };
  assert.deepEqual(await p.orientation.lock('portrait'), { ok: false, why: 'NotSupportedError' });
  // safe area: written to :root, an event only when it changes
  assert.equal(root.style.p['--mirage-safe-top'], '0px');
  log.length = 0; win.pad = { paddingTop: '59px', paddingRight: '0px', paddingBottom: '34px', paddingLeft: '0px' }; win.fire('resize'); win.fire('resize');
  assert.deepEqual(p.safeArea.insets(), { top: 59, right: 0, bottom: 34, left: 0 }); assert.equal(root.style.p['--mirage-safe-bottom'], '34px'); assert.equal(log.filter((l) => l.startsWith('insets')).length, 1);
  orient.type = 'landscape-primary'; orient.fire('change'); assert.ok(log.includes('orientation:{"type":"landscape-primary"}'));
  // input mode follows use
  log.length = 0; win.fire('touchstart'); win.fire('touchstart'); win.fire('gamepadconnected'); win.fire('keydown', { repeat: false });
  assert.deepEqual(log, ['inputmode:touch', 'inputmode:pad', 'inputmode:keyboard']); assert.equal(p.inputMode, 'keyboard');
  // storage, quit
  assert.deepEqual(await p.storage.persist(), { ok: true, persisted: true, usage: 10, quota: 1000 }); assert.deepEqual(await p.storage.estimate(), { usage: 10, quota: 1000 });
  assert.equal((await p.quit()).ok, false);
  // a listener that throws does not stop the others
  const err = console.error; console.error = () => {}; let after = 0; p.on('exit', () => { throw new Error('x'); }); p.on('exit', () => after++); win.fire('pagehide'); console.error = err; assert.equal(after, 1);
  p.dispose();
  assert.equal(doc.count() + win.count() + orient.count() + ctx.count(), 0, 'dispose removes every listener'); assert.equal('--mirage-safe-top' in root.style.p, false);
}
{ // resumeOnShow, pauseOnHide: false, a page with nothing: every call answers instead of throwing
  const a = page(), game = { paused: false, pause(on) { this.paused = on; } };
  const p = createPlatform({ win: a.win, doc: a.doc, nav: a.nav, game, resumeOnShow: true });
  a.doc.hidden = true; a.doc.fire('visibilitychange'); assert.equal(game.paused, true); a.doc.hidden = false; a.doc.fire('visibilitychange'); assert.equal(game.paused, false);
  p.dispose();
  const b = page(), g2 = { paused: false, pause(on) { this.paused = on; } };
  const p2 = createPlatform({ win: b.win, doc: b.doc, nav: b.nav, game: g2, pauseOnHide: false });
  b.doc.hidden = true; b.doc.fire('visibilitychange'); assert.equal(g2.paused, false); p2.dispose();
  const bare = createPlatform({ win: {}, doc: {}, nav: {} });
  assert.equal(bare.fullscreen.supported, false);
  assert.equal((await bare.fullscreen.enter()).ok, false); assert.equal((await bare.fullscreen.exit()).ok, true); assert.equal((await bare.orientation.lock()).ok, false);
  assert.equal((await bare.wakeLock.request()).ok, false); assert.equal((await bare.storage.persist()).persisted, false); assert.equal(await bare.storage.estimate(), null);
  assert.deepEqual(bare.safeArea.insets(), { top: 0, right: 0, bottom: 0, left: 0 });
  bare.dispose();
}
{ // inside a wrapper: everything goes through window.mirageNative
  const calls = [], native = { platform: 'electron', window: { setFullscreen: async (on) => { calls.push('fs ' + on); }, isFullscreen: async () => false },
    orientation: { lock: async (t) => { calls.push('lock ' + t); }, unlock: async () => { calls.push('unlock'); } }, keepAwake: async (on) => { calls.push('awake ' + on); }, quit: async () => { calls.push('quit'); } };
  const { doc, win, nav } = page({ native });
  const p = createPlatform({ win, doc, nav }), seen = [];
  p.on('fullscreen', (d) => seen.push(d.active));
  assert.equal(p.kind, 'electron'); assert.equal(p.native, native);
  assert.deepEqual(await p.fullscreen.enter(), { ok: true }); assert.equal(p.fullscreen.active, true); await p.fullscreen.exit(); assert.deepEqual(seen, [true, false]);
  await p.orientation.lock('portrait'); await p.orientation.unlock(); await p.wakeLock.request(); await p.wakeLock.release(); assert.deepEqual(await p.quit(), { ok: true });
  assert.deepEqual(calls, ['fs true', 'fs false', 'lock portrait', 'unlock', 'awake true', 'awake false', 'quit']);
  assert.deepEqual(await p.storage.persist(), { ok: true, persisted: true, why: 'native app storage' });
  native.window.setFullscreen = async () => { throw new Error('no window'); };
  assert.deepEqual(await p.fullscreen.enter(), { ok: false, why: 'no window' });
  p.dispose();
  const s = page(); s.win.matchMedia = (q) => ({ matches: q === '(display-mode: standalone)' });
  const pw = createPlatform({ win: s.win, doc: s.doc, nav: s.nav }); assert.equal(pw.kind, 'pwa'); pw.dispose();
}
{ // registerServiceWorker: a new version waits; apply() activates it; one reload, and not on the first visit
  assert.equal((await registerServiceWorker('./sw.js', { nav: {} })).ok, false);
  assert.equal((await registerServiceWorker('./sw.js', { nav: { serviceWorker: { register: async () => { throw new Error('insecure'); } } } })).why, 'insecure');
  const posted = [], worker = (state) => target({ state, postMessage: (m) => posted.push(m.type) });
  const reg = target({ waiting: null, installing: null, active: worker('activated'), update: async () => {} });
  const sw = target({ controller: null, register: async (url, o) => { sw.args = [url, o]; return reg; }, ready: Promise.resolve(reg) });
  let reloads = 0; const updates = [], win = { location: { reload: () => reloads++ } };
  const h = await registerServiceWorker('./sw.js', { scope: './', nav: { serviceWorker: sw }, win, onUpdate: (u) => updates.push(u) });
  assert.equal(h.ok, true); assert.deepEqual(sw.args, ['./sw.js', { scope: './' }]); assert.equal(h.apply(), false);
  sw.controller = reg.active; sw.fire('controllerchange'); assert.equal(reloads, 0, 'the first worker claiming the page is not an update');
  const next = worker('installing'); reg.installing = next; reg.fire('updatefound');
  next.state = 'installed'; reg.waiting = next; next.fire('statechange'); await tick(1100);
  assert.equal(updates.length, 1); assert.equal(typeof updates[0].apply, 'function'); assert.equal(reloads, 0, 'nothing reloads until the game says so');
  assert.equal(updates[0].apply(), true); assert.ok(posted.includes('SKIP_WAITING'));
  sw.fire('controllerchange'); sw.fire('controllerchange'); assert.equal(reloads, 1);
  assert.equal(await h.check(), true); h.dispose();
}
{ // the install prompt
  const win = target({ matchMedia: () => ({ matches: false }) }), seen = [];
  const ip = createInstallPrompt({ win, nav: { userAgent: 'Chrome' } });
  ip.on((s) => seen.push(s.available));
  assert.equal(ip.available, false); assert.equal(ip.ios, false); assert.equal((await ip.prompt()).ok, false);
  let prevented = false, shown = 0; win.fire('beforeinstallprompt', { preventDefault: () => { prevented = true; }, prompt: async () => { shown++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  assert.ok(prevented); assert.equal(ip.available, true);
  assert.deepEqual(await ip.prompt(), { ok: true, outcome: 'accepted' }); assert.equal(shown, 1); assert.equal(ip.available, false, 'the event can be used once');
  win.fire('appinstalled'); assert.equal(ip.installed, true); assert.match((await ip.prompt()).why, /already installed/);
  assert.deepEqual(seen, [true, false, false]);
  ip.dispose(); assert.equal(win.count(), 0);
  assert.equal(createInstallPrompt({ win: target(), nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } }).ios, true);
}
console.log('platform.check: bridge, saves (browser, wrapper, engine round trip), safe area, input mode, lifecycle, wrapper calls, service worker, install prompt passed');
