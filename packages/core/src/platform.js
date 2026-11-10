// Mirage original code.
// ---------------------------------------------------------------------------
// Platform layer, renderer side (opt-in: nothing in the engine imports this file; `@mirage/core/platform`).
// The page side (visibility, audio, wake lock, fullscreen, safe area, saves, PWA) is `@mirage/game/platform`.
//
//   import { probeDevice, createContextRecovery, createQualityGovernor } from '@mirage/core/platform';
//   const caps = await probeDevice();                       // { mobile, os, gpu, tier 0..3, maxTextureSize, floatTargets, ... , quality, settings }
//   const world = createWorldRenderer({ quality: caps.quality, dynamicRes: caps.settings.dynamicRes, ... });
//   const recovery = createContextRecovery(world, { play, onLost, onRestored });   // WebGL context lost -> the world comes back
//   const governor = createQualityGovernor({ world, play });                       // battery / CPU pressure / frame time -> steps
//   governor.frame(performance.now());                      // once per drawn frame (or governor.attach() to sample rAF itself)
//
// What the web does not expose is not guessed: there is no temperature reading in a browser. The governor uses the
// three signals that exist: the Battery Status API (Chrome), the Compute Pressure API (Chrome 125+, desktop), and
// the frame interval creeping up over seconds, which is what a throttling phone looks like from inside a page.
// GPU tiers come from the renderer string (WEBGL_debug_renderer_info); iOS hides the model ("Apple GPU"), so every
// iPhone is one tier here. The table was written from the vendors' public model lines, not measured on devices.
// ---------------------------------------------------------------------------
import { QUALITY_LEVELS, QUALITY_KEY } from './device.js';

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

/** GPU tier from a WebGL renderer string: 0 software, 1 low (old / entry phone, old integrated), 2 mid (most phones,
 *  integrated desktop), 3 high (flagship phone, Apple silicon, discrete desktop). -> { tier, family, model, why } */
export function gpuTier(renderer = '') {
  const s = String(renderer);
  const out = (tier, family, model = '', why = '') => ({ tier, family, model, why: why || `${family}${model ? ' ' + model : ''}` });
  if (!s) return out(1, 'unknown', '', 'no renderer string');
  if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render|WARP/i.test(s)) return out(0, 'software');
  let m;
  if ((m = /Adreno[^0-9]*(\d{3,4})/i.exec(s))) {
    const n = +m[1], series = Math.floor(n / 100);
    // 8xx (X Elite / 8 Elite), 730-750: flagship; 6x0 from 630 and the 7x0 mid-range: mid; 5xx, 61x and older: low
    return out(series >= 8 ? 3 : series === 7 ? (n >= 730 ? 3 : 2) : series === 6 ? (n >= 630 ? 2 : 1) : 1, 'adreno', String(n));
  }
  if (/Immortalis/i.test(s)) return out(3, 'mali', 'Immortalis');
  if ((m = /Mali-?\s*([GT])(\d{2,3})/i.exec(s))) {
    const n = +m[2], g = m[1].toUpperCase() === 'G';
    // G7xx / G6xx (3 digits: Valhall 2021+): 710 and up flagship, 6xx mid; G7x (2 digits): 76-78 mid, 71-72 low;
    // G5x / G3x and every Midgard T: low
    const tier = !g ? 1 : n >= 700 ? 3 : n >= 600 ? 2 : n >= 76 && n <= 79 ? 2 : 1;
    return out(tier, 'mali', m[1].toUpperCase() + n);
  }
  if ((m = /Xclipse\s*(\d+)/i.exec(s))) return out(+m[1] >= 920 ? 3 : 2, 'xclipse', m[1]);
  if (/PowerVR/i.test(s)) return out(1, 'powervr');
  if ((m = /Apple\s+(M\d+)(\s+(?:Pro|Max|Ultra))?/i.exec(s))) return out(3, 'apple', m[1] + (m[2] || ''));
  if ((m = /Apple\s+(A\d+)/i.exec(s))) return out(+m[1].slice(1) >= 15 ? 3 : 2, 'apple', m[1]);
  if (/Apple GPU/i.test(s)) return out(2, 'apple', '', 'Apple GPU (model hidden by the browser)');
  if (/NVIDIA|GeForce|Quadro|RTX|GTX/i.test(s)) return out(/\b(GT|MX)\s?\d|GeForce\s+\d{3}M?\b/i.test(s) ? 2 : 3, 'nvidia');
  if (/Radeon|AMD/i.test(s)) return out(/\bRX\b|Radeon Pro|FirePro/i.test(s) ? 3 : 2, 'amd');
  if (/Intel/i.test(s)) return out(/\bArc\b/i.test(s) ? 3 : /Iris/i.test(s) ? 2 : 1, 'intel');
  return out(2, 'unknown', '', 'renderer not in the table');
}

/** the operating system, from the user agent (an iPad's Safari says Macintosh: touch points tell them apart) */
export function osOf(nav = {}) {
  const ua = nav.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/CrOS/i.test(ua)) return 'chromeos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

/** The quality level and start-up settings for a set of capabilities (pure; probeDevice calls it).
 *  -> { quality, why, settings: { dynamicRes, maxFps, pixelRatio, shadowMapSize, msaa } }
 *  It never picks 'high': like pickQuality, that stays the player's choice. */
export function qualityFor(caps = {}) {
  const why = [];
  const { tier = 2, mobile = false, battery = null, saveData = false, memory = 0, cores = 0, maxTextureSize = 4096, floatTargets = true } = caps;
  if (tier <= 1) why.push(tier === 0 ? 'software gpu' : 'low gpu tier');
  if (mobile && tier < 3) why.push('mobile');
  if (battery && !battery.charging) why.push(battery.level <= 0.2 ? 'battery low' : 'battery');
  if (saveData) why.push('data saver');
  if (memory && memory <= 2) why.push('2 GB memory');
  if (cores && cores <= 2) why.push('2 cores');
  if (!floatTargets) why.push('no float targets');
  const quality = why.length ? 'low' : 'medium';
  const weak = tier <= 1 || (memory && memory <= 2);
  return {
    quality, why: why.join(', ') || 'default',
    settings: {
      // a phone always gets dynamic resolution: its frame budget is the first thing to go when it warms up
      dynamicRes: mobile || tier <= 1 ? { target: 60, min: weak ? 0.5 : 0.6 } : false,
      maxFps: battery && !battery.charging && battery.level <= 0.2 ? 30 : 60,
      // the canvas backing store: a phone's devicePixelRatio is 2.6-3.5; drawing that is 7-12x the pixels of 1x
      pixelRatio: Math.min(caps.dpr || 1, mobile ? (tier >= 3 ? 1.5 : 1) : 2),
      shadowMapSize: Math.min(maxTextureSize, weak ? 1024 : 2048),
      msaa: mobile ? 0 : 4,
    },
  };
}

/** Everything a page can learn about the device before it builds a world. Extends pickQuality (device.js): the saved
 *  choice still wins. gl: an existing context to read (else a temporary one is made and released).
 *  -> { mobile, os, touch, coarse, standalone, dpr, screen, cores, memory, saveData, reducedMotion, battery,
 *       gpu, tier, gpuFamily, webgl2, maxTextureSize, maxRenderbufferSize, maxSamples, floatTargets,
 *       halfFloatTargets, floatLinear, anisotropy, astc, etc2, bc, quality, why, saved, settings } */
export async function probeDevice({ nav = globalThis.navigator || {}, win = globalThis.window, storage = safeStorage(), gl = null, force = {} } = {}) {
  const ua = nav.userAgent || '', os = osOf(nav);
  const mq = (q) => { try { return !!win?.matchMedia?.(q).matches; } catch { return false; } };
  const mobile = MOBILE_UA.test(ua) || os === 'ios' || os === 'android';
  const caps = {
    mobile, os, touch: (nav.maxTouchPoints || 0) > 0, coarse: mq('(pointer: coarse)'),
    standalone: mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || nav.standalone === true,
    dpr: win?.devicePixelRatio || 1, screen: win?.screen ? [win.screen.width, win.screen.height] : null,
    cores: nav.hardwareConcurrency || 0, memory: nav.deviceMemory || 0, saveData: !!nav.connection?.saveData,
    reducedMotion: mq('(prefers-reduced-motion: reduce)'), battery: null,
    gpu: '', tier: 1, gpuFamily: 'unknown', webgl2: false, maxTextureSize: 0, maxRenderbufferSize: 0, maxSamples: 0,
    floatTargets: false, halfFloatTargets: false, floatLinear: false, anisotropy: 0, astc: false, etc2: false, bc: false,
  };
  try {
    const b = nav.getBattery && await Promise.race([nav.getBattery(), new Promise((r) => setTimeout(r, 300))]);
    // a desktop reports charging, level 1, chargingTime 0 (device.js): that is "no battery"
    if (b && !(b.charging && b.level === 1 && b.chargingTime === 0)) caps.battery = { level: b.level, charging: b.charging };
  } catch { /* no Battery API (Safari, Firefox) */ }
  let own = null;
  try {
    if (!gl && typeof document !== 'undefined') { own = document.createElement('canvas'); gl = own.getContext('webgl2', { powerPreference: 'high-performance' }); }
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      caps.webgl2 = true;
      caps.gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      caps.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
      caps.maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 0;
      caps.maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
      caps.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
      caps.halfFloatTargets = caps.floatTargets || !!gl.getExtension('EXT_color_buffer_half_float');
      caps.floatLinear = !!gl.getExtension('OES_texture_float_linear');
      const af = gl.getExtension('EXT_texture_filter_anisotropic');
      caps.anisotropy = af ? gl.getParameter(af.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 0 : 0;
      caps.astc = !!gl.getExtension('WEBGL_compressed_texture_astc');
      caps.etc2 = !!gl.getExtension('WEBGL_compressed_texture_etc');
      caps.bc = !!gl.getExtension('WEBGL_compressed_texture_s3tc');
      if (own) gl.getExtension('WEBGL_lose_context')?.loseContext();   // give the temporary context back at once
    }
  } catch { /* no WebGL here */ }
  Object.assign(caps, force);
  const t = gpuTier(caps.gpu);
  if (force.tier === undefined) caps.tier = t.tier;
  caps.gpuFamily = t.family;
  const q = qualityFor(caps);
  let saved = null;
  try { const s = storage && storage.getItem(QUALITY_KEY); if (QUALITY_LEVELS.includes(s)) saved = s; } catch { /* no storage */ }
  return { ...caps, quality: saved || q.quality, why: saved ? 'saved' : q.why, saved: !!saved, settings: q.settings };
}
function safeStorage() { try { return globalThis.localStorage || null; } catch { return null; } }

// ---------------------------------------------------------------------------
// WebGL context loss. A phone takes the context away when the app goes to the background for long, when the GPU
// process restarts, or when memory runs short; a desktop does it on a driver reset or a GPU switch. three already
// calls preventDefault() on `webglcontextlost` and re-makes its own state on `webglcontextrestored` (buffers,
// programs and textures with a CPU-side source upload again on first use). What it cannot bring back is what was
// only ever rendered: the sky's air lookup, the image-based light, probe lighting, the temporal histories.
// world.contextRestored() re-bakes those; this object runs it at the right moment, keeps play from drawing into a
// dead context, and tells the page.
//   const r = createContextRecovery(world, { play, onLost(), onRestored({ ms, count }), onGiveUp(), timeout: 8000 });
//   r.onRestore(fn)      your own render-target bakes (impostors, a minimap) go here; r.lost; r.count; r.dispose()
//   await r.simulate()   lose and restore through WEBGL_lose_context (the checks use it) -> { ms }
// ---------------------------------------------------------------------------
export function createContextRecovery(world, { play = null, canvas = world.renderer.domElement, onLost, onRestored, onGiveUp, timeout = 8000 } = {}) {
  const extra = [];
  let lost = false, count = 0, lostAt = 0, wasRunning = false, timer = null, waiters = [];
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function handleLost(e) {
    e.preventDefault?.();   // without it the browser never restores (three's own listener does the same)
    if (lost) return;
    lost = true; lostAt = now();
    // play's loop would call into a dead context every frame (harmless, but its temporal state would be garbage)
    wasRunning = !!play && play.running !== false;
    if (play) play.stop();
    if (onLost) onLost();
    if (timeout > 0) timer = setTimeout(() => { timer = null; if (lost && onGiveUp) onGiveUp(); }, timeout);
  }
  function handleRestored() {
    if (!lost) return;
    clearTimeout(timer); timer = null;
    lost = false; count++;
    // three's listener was added first (the renderer's constructor), so its state is new by now
    world.contextRestored();
    for (const fn of extra) { try { fn(world); } catch (err) { console.error('[mirage] a context-restore hook failed:', err); } }
    if (play && wasRunning) { play.start(); play.wake(); }
    const info = { ms: now() - lostAt, count };
    if (onRestored) onRestored(info);
    for (const w of waiters.splice(0)) w(info);
  }
  canvas.addEventListener('webglcontextlost', handleLost, false);
  canvas.addEventListener('webglcontextrestored', handleRestored, false);
  return {
    get lost() { return lost; }, get count() { return count; },
    /** fn(world) runs after the engine's own re-bake; returns a function that removes it */
    onRestore(fn) { extra.push(fn); return () => { const i = extra.indexOf(fn); if (i >= 0) extra.splice(i, 1); }; },
    /** lose the context and bring it back after `hold` ms (WEBGL_lose_context): for tests and a debug key */
    simulate({ hold = 200 } = {}) {
      const ext = world.renderer.getContext().getExtension('WEBGL_lose_context');
      if (!ext) return Promise.reject(new Error('WEBGL_lose_context is not available'));
      return new Promise((res) => { waiters.push(res); ext.loseContext(); setTimeout(() => ext.restoreContext(), hold); });
    },
    dispose() {
      clearTimeout(timer);
      canvas.removeEventListener('webglcontextlost', handleLost, false);
      canvas.removeEventListener('webglcontextrestored', handleRestored, false);
    },
  };
}

// ---------------------------------------------------------------------------
// Quality governor: a ladder of steps a running game can take without rebuilding the world.
//   step 0  as configured
//   step 1  render scale <= 0.85   (needs createWorldRenderer({ dynamicRes }); skipped without it)
//   step 2  render scale <= 0.7
//   step 3  30 frames per second   (play's power saver)
// It moves one step at a time, down fast and up slowly:
//   down  the frame interval's median over `window` ms is above 1.25 x the budget, or CPU pressure is 'serious'
//         (two steps for 'critical'), or the battery is discharging below `lowBattery` (straight to the last step)
//   up    the median has been within 1.08 x the budget for `calm` ms, pressure is nominal / fair, battery is fine
//         (a step up that has to be taken back doubles that wait, up to 8x: no see-saw on a device that is just slow)
// `governorStep` is the decision alone (pure, checked in Node); createQualityGovernor wires it to the page.
// ---------------------------------------------------------------------------
export const GOVERNOR_STEPS = [
  { name: 'full', scale: 1, maxFps: 0 },
  { name: 'scale-85', scale: 0.85, maxFps: 0 },
  { name: 'scale-70', scale: 0.7, maxFps: 0 },
  { name: 'saver-30', scale: 0.7, maxFps: 30 },
];
export const GOVERNOR_DEFAULTS = { budget: 1000 / 60, window: 4000, calm: 20000, hold: 5000, lowBattery: 0.2, over: 1.25, under: 1.08 };

/** One decision. state: { step, since (ms of the last change), calmFor }, sample: { now, median (ms, or 0 when
 *  unknown), pressure: 'nominal' | 'fair' | 'serious' | 'critical' | null, battery: { level, charging } | null },
 *  opts: GOVERNOR_DEFAULTS + { steps (count), dt (ms since the last decision) }. -> { step, why } (state is not changed) */
export function governorStep(state, sample, opts = {}) {
  const o = { ...GOVERNOR_DEFAULTS, ...opts }, last = (o.steps ?? GOVERNOR_STEPS.length) - 1;
  const { step, since = 0 } = state, { now, median = 0, pressure = null, battery = null } = sample;
  const lowBat = !!battery && !battery.charging && battery.level <= o.lowBattery;
  // an app capped at 30 fps runs at its cap: compare against the frame time the current step allows
  const budget = o.capMs && o.capMs > o.budget ? o.capMs : o.budget;
  if (lowBat && step < last) return { step: last, why: 'battery low' };
  if (pressure === 'critical' && step < last) return { step: Math.min(last, step + 2), why: 'cpu pressure critical' };
  if (now - since < o.hold) return { step, why: 'hold' };
  if (pressure === 'serious' && step < last) return { step: step + 1, why: 'cpu pressure serious' };
  if (median > budget * o.over && step < last) return { step: step + 1, why: `frame time ${median.toFixed(1)} ms` };
  const calm = median > 0 && median <= budget * o.under && (pressure === null || pressure === 'nominal' || pressure === 'fair') && !lowBat;
  if (calm && step > 0 && (state.calmFor || 0) >= o.calm) return { step: step - 1, why: 'calm' };
  return { step, why: calm ? 'calm, waiting' : 'steady' };
}

/** median of the last values without sorting the caller's array */
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

/** opts: { world, play, apply(step, info), onStep(step, info), nav, PressureObserver, ...GOVERNOR_DEFAULTS }.
 *  frame(now) once per drawn frame, or attach() to let it sample requestAnimationFrame itself.
 *  -> { step, name, why, frame, attach, set(step) (manual; null = automatic again), signals(), dispose } */
export function createQualityGovernor(opts = {}) {
  const { world = null, play = null, nav = globalThis.navigator || {}, onStep } = opts;
  const o = { ...GOVERNOR_DEFAULTS, ...opts };
  // without dynamic resolution the scale steps do nothing: the ladder is full -> 30 fps
  const steps = world?.dynamicRes ? GOVERNOR_STEPS : [GOVERNOR_STEPS[0], { ...GOVERNOR_STEPS[3], scale: 1 }];
  const state = { step: 0, since: -1e9, calmFor: 0 };
  const sig = { pressure: null, battery: null };
  const times = [];
  let lastFrame = 0, lastDecide = 0, span = 0, patience = 1, lastUp = false, manual = null, why = 'start', raf = 0, observer = null, bat = null, disposed = false;
  const baseFps = play ? play.maxFps : 0;
  function apply(step, reason) {
    const s = steps[step];
    if (opts.apply) opts.apply(step, { ...s, why: reason });
    else {
      if (world?.dynamicRes) world.dynamicRes.max = s.scale;
      if (play) { const saver = s.maxFps > 0 && s.maxFps <= 30; if (play.powerSaver !== saver) play.powerSaver = saver; }
    }
    state.step = step; why = reason;
    if (onStep) onStep(step, { ...s, why: reason });
  }
  // the signals that exist: both are optional and both fail quietly
  try { nav.getBattery?.().then((b) => {
    if (disposed || !b || (b.charging && b.level === 1 && b.chargingTime === 0)) return;
    bat = b; const read = () => { sig.battery = { level: b.level, charging: b.charging }; };
    read(); b.addEventListener?.('levelchange', read); b.addEventListener?.('chargingchange', read); bat.read = read;
  }, () => {}); } catch { /* no Battery API */ }
  try {
    const PO = opts.PressureObserver || globalThis.PressureObserver;
    if (PO) { observer = new PO((records) => { sig.pressure = records[records.length - 1]?.state ?? null; }); Promise.resolve(observer.observe('cpu', { sampleInterval: 1000 })).catch(() => { observer = null; }); }
  } catch { observer = null; }
  function frame(now) {
    if (disposed) return;
    const dt = lastFrame ? now - lastFrame : 0; lastFrame = now;
    // a gap is a hidden tab, a still view or a loading hitch, not a slow GPU
    if (dt > 0 && dt < 250) { times.push(dt); span += dt; while (span - times[0] >= o.window) span -= times.shift(); } else if (dt >= 250) { times.length = 0; span = 0; }
    if (now - lastDecide < 500) return;
    const since = lastDecide ? now - lastDecide : 0; lastDecide = now;
    if (manual !== null) return;
    // only a full window is evidence: the first seconds after a step, or after a pause, decide nothing
    const med = span >= o.window * 0.75 ? median(times) : 0;
    const capMs = steps[state.step].maxFps ? 1000 / steps[state.step].maxFps : baseFps ? 1000 / baseFps : 0;
    const calmNow = med > 0 && med <= Math.max(o.budget, capMs) * o.under;
    state.calmFor = calmNow ? state.calmFor + since : 0;
    const d = governorStep(state, { now, median: med, pressure: sig.pressure, battery: sig.battery }, { ...o, calm: o.calm * patience, steps: steps.length, capMs });
    if (d.step !== state.step) {
      // behind a 30 fps cap every frame looks calm, so going up is a trial: one that fails (down again right after)
      // doubles the wait before the next, up to 8x; two climbs in a row mean the device has recovered
      const up = d.step < state.step;
      patience = up ? (lastUp ? 1 : patience) : (lastUp ? Math.min(8, patience * 2) : patience);
      lastUp = up;
      state.since = now; state.calmFor = 0; times.length = 0; span = 0; apply(d.step, d.why);
    }
  }
  return {
    get step() { return state.step; }, get name() { return steps[state.step].name; }, get why() { return why; }, steps,
    frame,
    /** sample requestAnimationFrame (use when you do not own the frame loop); returns detach */
    attach() { const loop = (t) => { frame(t); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf); },
    /** pin a step (a settings menu); null hands it back to the governor */
    set(step) { manual = step === null ? null : Math.max(0, Math.min(steps.length - 1, step | 0)); if (manual !== null) apply(manual, 'manual'); },
    signals: () => ({ ...sig, median: median(times), samples: times.length }),
    dispose() {
      disposed = true; if (raf) cancelAnimationFrame(raf);
      try { observer?.disconnect(); } catch { /* gone */ }
      if (bat?.read) { bat.removeEventListener?.('levelchange', bat.read); bat.removeEventListener?.('chargingchange', bat.read); }
      if (world?.dynamicRes) delete world.dynamicRes.max;
    },
  };
}
