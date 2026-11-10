// Mirage original code. Ideas (a priority queue of loads re-sorted every pump, an LRU byte budget with pinned
// entries) from the tile streaming of NASA-AMMOS 3DTilesRendererJS (Apache-2.0); no code from it.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Streaming helpers, all opt-in: nothing in the engine uses them unless a world asks.
//
//   const jobs = createJobQueue({ concurrency: 1, priority: (job) => distanceTo(job.data) });   // lower runs first
//   jobs.add('hall', async () => build(), { data: hallCentre });
//   const cache = createLRU({ budget: 64 << 20, evict: (key, root) => disposeObject(root) });
//   const up = createUploadBudget(renderer, { bytes: 8 << 20 });  up.add(texture);  ...per frame: up.step();
//   const lt = watchLongTasks();  ...  lt.stop() -> { count, totalMs, maxMs }
//
// Why: three uploads a texture the first time a draw samples it, and links a program the first time a draw uses
// it, both inside that frame. A module added to the live scene in one go pays all of it in one frame (a hitch). The
// queue spreads loads by priority, the upload budget spreads texture uploads over frames, and the LRU keeps what
// was recently near so walking back costs nothing, within a byte budget.
// ---------------------------------------------------------------------------

const now = () => (globalThis.performance ? performance.now() : Date.now());

/** A priority job queue: at most `concurrency` jobs run at once; when a slot frees, the waiting job with the
 *  LOWEST priority(job) runs next (re-evaluated at every pick, so a distance-based priority follows the player).
 *  add() with a key already waiting or running returns that job's promise (and updates its data). */
export function createJobQueue({ concurrency = 1, priority = (job) => job.priority ?? 0 } = {}) {
  const waiting = new Map(), running = new Map();
  let idle = [];
  function pump() {
    while (running.size < concurrency && waiting.size) {
      let best = null, bp = Infinity;
      for (const job of waiting.values()) { const p = +priority(job); if (best === null || p < bp) { best = job; bp = p; } }
      waiting.delete(best.key); running.set(best.key, best);
      Promise.resolve().then(() => best.fn(best)).then(best.resolve, best.reject).finally(() => { running.delete(best.key); pump(); });
    }
    if (!waiting.size && !running.size && idle.length) { const l = idle; idle = []; for (const r of l) r(); }
  }
  return {
    /** queue fn(job) under key; options { priority, data } are kept on the job for the priority callback */
    add(key, fn, { priority: p = 0, data } = {}) {
      const had = waiting.get(key) || running.get(key);
      if (had) { had.priority = p; if (data !== undefined) had.data = data; return had.promise; }
      const job = { key, fn, priority: p, data, cancelled: false };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      waiting.set(key, job); pump();
      return job.promise;
    },
    /** drop a waiting job (its promise rejects with { cancelled: true }); a running job only gets job.cancelled = true */
    cancel(key) {
      const w = waiting.get(key);
      if (w) { waiting.delete(key); w.cancelled = true; w.reject(Object.assign(new Error(`job "${key}" cancelled`), { cancelled: true })); pump(); return true; }
      const r = running.get(key); if (r) r.cancelled = true;
      return false;
    },
    has: (key) => waiting.has(key) || running.has(key),
    get waiting() { return waiting.size; }, get running() { return running.size; },
    /** resolves when nothing waits and nothing runs */
    idle: () => (waiting.size || running.size ? new Promise((r) => idle.push(r)) : Promise.resolve()),
  };
}

/** An LRU cache with a byte budget: set(key, value, bytes) / get(key) (marks it used). When the total passes `budget`
 *  the least recently used unpinned entries are evicted (evict(key, value) frees them) until it fits again.
 *  pin(key) keeps an entry (e.g. while it is in the scene); unpin(key) makes it evictable again. */
export function createLRU({ budget = 256 * 1024 * 1024, evict = () => {} } = {}) {
  const map = new Map();   // insertion order = use order (oldest first)
  let bytes = 0;
  const lru = {
    get bytes() { return bytes; }, get size() { return map.size; }, budget,
    has: (key) => map.has(key),
    get(key) { const e = map.get(key); if (!e) return undefined; map.delete(key); map.set(key, e); return e.value; },
    set(key, value, size = 0) {
      const old = map.get(key);
      if (old) { bytes -= old.bytes; map.delete(key); }
      map.set(key, { value, bytes: size, pins: old ? old.pins : 0 }); bytes += size;
      lru.trim();
      return value;
    },
    pin(key) { const e = map.get(key); if (e) e.pins++; return !!e; },
    unpin(key) { const e = map.get(key); if (e && e.pins > 0) e.pins--; lru.trim(); },
    /** remove without evict() (the caller frees it, or keeps it) */
    delete(key) { const e = map.get(key); if (!e) return false; bytes -= e.bytes; map.delete(key); return true; },
    /** evict unpinned entries, oldest first, until bytes <= budget (or `to`); returns the keys evicted */
    trim(to = lru.budget) {
      const out = [];
      if (bytes <= to) return out;
      for (const [key, e] of map) {
        if (bytes <= to) break;
        if (e.pins) continue;
        map.delete(key); bytes -= e.bytes; out.push(key);
        evict(key, e.value);
      }
      return out;
    },
    keys: () => [...map.keys()],
  };
  return lru;
}

/** GPU bytes of a texture once uploaded (estimate: RGBA8 / float formats; x 4/3 with mipmaps; 0 before it has an image) */
export function textureBytes(t) {
  const img = t?.image, w = img?.width || img?.videoWidth || 0, h = img?.height || img?.videoHeight || 0;
  if (!w || !h) return 0;
  if (t.isCompressedTexture && t.mipmaps?.length) return t.mipmaps.reduce((s, m) => s + (m.data?.byteLength || 0), 0);
  const per = t.type === THREE.FloatType ? 16 : t.type === THREE.HalfFloatType ? 8 : 4;
  const depth = img.depth || 1;
  return Math.round(w * h * depth * per * (t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1));
}

/** GPU bytes held by an object tree: its geometries' attributes and index, and the textures its materials sample
 *  (each counted once). Shared resources are counted in every tree that uses them. */
export function objectBytes(root) {
  const seen = new Set();
  let n = 0;
  root.traverse((o) => {
    const g = o.geometry;
    if (g && !seen.has(g)) {
      seen.add(g);
      for (const a of Object.values(g.attributes)) if (!seen.has(a)) { seen.add(a); n += a.array?.byteLength || 0; }
      if (g.index && !seen.has(g.index)) { seen.add(g.index); n += g.index.array.byteLength; }
    }
    if (o.isInstancedMesh && !seen.has(o.instanceMatrix)) { seen.add(o.instanceMatrix); n += o.instanceMatrix.array.byteLength; }
    for (const t of texturesOf(o)) if (!seen.has(t)) { seen.add(t); n += textureBytes(t); }
  });
  return n;
}

/** the textures an object's materials sample: material maps and sampler uniforms (patch() hooks, ShaderMaterial) */
export function texturesOf(o) {
  const out = new Set();
  for (const m of [].concat(o.material || [])) {
    if (!m) continue;
    for (const v of Object.values(m)) if (v && v.isTexture) out.add(v);
    for (const u of [m.uniforms, m.userData?.hooks?.uniforms]) for (const v of Object.values(u || {})) if (v?.value?.isTexture) out.add(v.value);
  }
  return out;
}

/** free an object tree's geometries, materials and (unless keepTextures) the textures they sample */
export function disposeObject(root, { keepTextures = false } = {}) {
  const tex = new Set();
  root.traverse((o) => {
    o.geometry?.dispose?.();
    if (!keepTextures) for (const t of texturesOf(o)) tex.add(t);
    for (const m of [].concat(o.material || [])) m?.dispose?.();
  });
  for (const t of tex) t.dispose();
}

/** Spread texture uploads over frames: add(texture) queues it; step() (once per frame, before the draw) uploads with
 *  renderer.initTexture until `bytes` (or `count` textures) were spent this frame; at least one per step, so a
 *  texture larger than the budget still goes. A texture whose image has not arrived yet waits in the queue.
 *  whenDone(textures?) resolves when those (default: all queued) are on the GPU. */
export function createUploadBudget(renderer, { bytes = 8 * 1024 * 1024, count = Infinity } = {}) {
  const queue = [], done = new WeakSet();
  let waiters = [];
  const ready = (t) => t.version > 0 && !!(t.image && (t.image.width || t.image.data || t.mipmaps?.length));   // its image arrived
  const settle = () => { waiters = waiters.filter((w) => { if (w.list.every((t) => done.has(t))) { w.resolve(); return false; } return true; }); };
  const up = {
    add(...textures) { for (const t of textures.flat()) if (t && !done.has(t) && !queue.includes(t)) queue.push(t); return up; },
    get pending() { return queue.length; },
    uploaded: (t) => done.has(t),
    /** upload this frame's share; returns { textures, bytes, ms } spent */
    step() {
      const t0 = now();
      let n = 0, b = 0;
      for (let i = 0; i < queue.length && n < count; ) {
        const t = queue[i];
        if (!ready(t)) { i++; continue; }
        const tb = textureBytes(t);
        if (n > 0 && b + tb > bytes) break;
        renderer.initTexture(t); done.add(t); queue.splice(i, 1);
        n++; b += tb;
      }
      if (n) settle();
      return { textures: n, bytes: b, ms: +(now() - t0).toFixed(2) };
    },
    whenDone(list = queue.slice()) {
      list = [].concat(list);
      return list.every((t) => done.has(t)) ? Promise.resolve() : new Promise((resolve) => waiters.push({ list, resolve }));
    },
  };
  return up;
}

/** Count long tasks (> 50 ms on the main thread) from now: PerformanceObserver('longtask') where the browser has it
 *  (Chromium), else a frame-gap estimate (requestAnimationFrame intervals over 50 ms) so the numbers still mean
 *  "the page could not draw for this long". stop() -> { count, totalMs, maxMs, source, tasks: [{ start, ms }] } */
export function watchLongTasks() {
  const tasks = [];
  let obs = null, raf = 0, last = 0, source = 'longtask';
  const P = globalThis.PerformanceObserver;
  if (P && (P.supportedEntryTypes || []).includes('longtask')) {
    obs = new P((list) => { for (const e of list.getEntries()) tasks.push({ start: +e.startTime.toFixed(1), ms: +e.duration.toFixed(1) }); });
    obs.observe({ type: 'longtask' });
  } else if (globalThis.requestAnimationFrame) {
    source = 'frame-gap';
    const tick = (t) => { if (last && t - last > 50) tasks.push({ start: +last.toFixed(1), ms: +(t - last).toFixed(1) }); last = t; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  } else source = 'none';
  const stats = () => ({ count: tasks.length, totalMs: +tasks.reduce((s, t) => s + t.ms, 0).toFixed(1), maxMs: tasks.reduce((m, t) => Math.max(m, t.ms), 0), source, tasks: tasks.slice() });
  return {
    stats,
    stop() { if (obs) { for (const e of obs.takeRecords?.() || []) tasks.push({ start: +e.startTime.toFixed(1), ms: +e.duration.toFixed(1) }); obs.disconnect(); } if (raf) cancelAnimationFrame(raf); return stats(); },
  };
}

/** Wait for the next frame to be drawn (requestAnimationFrame, then a macrotask so the frame's own work ran), or a
 *  plain macrotask where there is no rAF; a hidden tab (no rAF) moves on after `timeout` ms. */
export function nextFrame(timeout = 100) {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { setTimeout(resolve, 0); return; }
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    const t = setTimeout(go, timeout);
    requestAnimationFrame(() => { clearTimeout(t); setTimeout(go, 0); });
  });
}
