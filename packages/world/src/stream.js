// Mirage original code. The load / unload by distance with a priority queue and an LRU of what was near follows the
// tile streaming of NASA-AMMOS 3DTilesRendererJS (Apache-2.0); no code from it.
import * as THREE from 'three';
import { rng } from '@miragekit/core';
import { createJobQueue, createLRU, createUploadBudget, objectBytes, texturesOf, disposeObject, nextFrame } from '@miragekit/core/stream';
import { definePlan } from './plan.js';
import { colliderFor } from './loader.js';

// ---------------------------------------------------------------------------
// createStreamer(world, { plan, modules, shared, camera }): modules that come into the scene when the viewer is near
// and leave when it is far, without a loading screen and without a hitch (opt-in; buildWorld is unchanged).
//
//   const streamer = createStreamer(world, { plan, modules: [{ name: 'hall', center: [x, z], radius: 30, build }],
//     onChange: (name, inScene, region) => bakeWalkGridAsync(world, { into: grid, region }) });
//   per frame: streamer.update(camera.position)     (before the draw)
//
// A streamed module is { name, center: [x, z], radius, build(ctx) } with the ctx a buildWorld module gets (its own
// root, seeded R, collider, onUpdate, log; no anchors: those are resolved once, at load). In range (distance <
// radius) it is queued, nearest first, at most `concurrency` at a time; out of range (beyond radius x `hysteresis`)
// it leaves the scene and stays cached in an LRU of `budget` bytes, so walking back is instant; the cache evicts
// (frees) the least recently near when it is over budget. Loading one is spread over frames:
//   build   the module's own code (one task: keep each module small)
//   compile renderer.compileAsync against the world's scene and the pipeline's target (KHR_parallel_shader_compile:
//           programs link off the main thread; three polls them)
//   upload  its textures through an upload budget (`uploadBytes` a frame, from update())
//   add     into world.scene in one step; onChange(name, true, region) (e.g. re-bake the walk grid there)
// { sync: true } loads in the frame it comes in range (build, add; three compiles and uploads in the next draw):
// the baseline the stream check compares against.
// ---------------------------------------------------------------------------

/** the world-space XZ rectangle [x0, z0, x1, z1] an object covers (for a walk-grid region re-bake) */
export function regionOf(root, pad = 0.25) {
  const b = new THREE.Box3().setFromObject(root);
  return b.isEmpty() ? null : [b.min.x - pad, b.min.z - pad, b.max.x + pad, b.max.z + pad];
}

export function createStreamer(world, { plan, modules = [], shared = {}, camera = world.camera, concurrency = 1, budget = 256 * 1024 * 1024,
  uploadBytes = 8 * 1024 * 1024, hysteresis = 1.25, sync = false, onChange = () => {}, log = console } = {}) {
  plan = definePlan(plan);
  const { renderer, scene } = world;
  const upload = createUploadBudget(renderer, { bytes: uploadBytes });
  // name -> { m, want, state: 'out' | 'loading' | 'in' | 'cached' | 'failed', root, updates, pinned, gen, dist, timing }
  const entries = new Map();
  // a module's own GPU objects, freed: geometry, materials, and the textures nothing else still samples (the scene, or
  // another streamed module kept in the cache: a shared texture library's sets stay)
  const free = (e, root) => {
    if (e.root === root) { e.root = null; e.updates = []; }
    const used = new Set(), mark = (r) => r.traverse((o) => { for (const t of texturesOf(o)) used.add(t); });
    mark(scene);
    for (const x of entries.values()) if (x.root && x.root !== root) mark(x.root);
    const own = new Set();
    root.traverse((o) => { for (const t of texturesOf(o)) if (!used.has(t)) own.add(t); });
    disposeObject(root, { keepTextures: true });
    for (const t of own) t.dispose();   // the upload budget forgets a disposed texture (a later add uploads it again)
  };
  const cache = createLRU({ budget, evict: (name, root) => {
    const e = entries.get(name);
    stats.evictions++;
    if (e.root === root) { e.pinned = false; if (e.state === 'cached') e.state = 'out'; }
    free(e, root);
  } });
  const pinOff = (e) => { if (e.pinned) { e.pinned = false; cache.unpin(e.m.name); } };   // may evict it (state 'out')
  const jobs = createJobQueue({ concurrency, priority: (job) => job.data.dist });
  const stats = { loads: 0, unloads: 0, evictions: 0, builds: [] };
  let pos = new THREE.Vector3(), stopped = null, stop = () => {};
  const stopping = () => (stopped ??= new Promise((r) => { stop = r; }));
  stopping();
  for (const m of modules) {
    if (!m || !m.name || typeof m.build !== 'function' || !Array.isArray(m.center)) throw new Error('a streamed module needs { name, center: [x, z], radius, build(ctx) }');
    if (entries.has(m.name)) throw new Error(`two streamed modules are called "${m.name}"`);
    entries.set(m.name, { m, want: false, state: 'out', root: null, updates: [], pinned: false, gen: 0, dist: Infinity, timing: null });
  }
  // one callback for every streamed module's onUpdate, unsubscribed in dispose(): a module's callbacks
  // live on its entry, run while it is in the scene and go with it when it is freed
  const offUpdate = world.ctx.onUpdate((t) => { for (const e of entries.values()) if (e.root && e.root.parent === scene) for (const fn of e.updates) fn(t); });
  const NOOP = () => {};   // an unsubscribed slot (the list may be mid-iteration)
  const distTo = (m) => Math.hypot(pos.x - m.center[0], pos.z - m.center[1]);

  async function build(e) {
    const { m } = e, t0 = performance.now(), root = new THREE.Group(), updates = [];
    root.name = m.name;
    const R = rng(`${plan.seed}/${m.name}`);
    const ctx = { ...world.ctx, world, plan, shared, name: m.name, root, scene: root, R, rng: (sub) => (sub === undefined || sub === '' ? R : rng(`${plan.seed}/${m.name}/${sub}`)),
      anchors: {}, modules: {}, onUpdate: (fn) => { updates.push(fn); return () => { const i = updates.indexOf(fn); if (i >= 0) updates[i] = NOOP; }; }, collider: colliderFor(root), log: (...a) => log.log(`[${m.name}]`, ...a) };
    await m.build(ctx);
    return { root, updates, buildMs: performance.now() - t0 };
  }
  // the programs this module needs, linked before it is drawn: against the pipeline's scene target and the world's
  // scene (its lights, fog, environment), as prepare() does
  async function compile(root) {
    const saved = renderer.getRenderTarget();
    renderer.setRenderTarget(world.pipeline?.sceneRT ?? saved);
    let p;
    try { p = renderer.compileAsync(root, camera, scene); } finally { renderer.setRenderTarget(saved); }
    await p;
  }
  function show(e) {
    scene.add(e.root); e.state = 'in'; cache.get(e.m.name);
    stats.loads++;
    onChange(e.m.name, true, regionOf(e.root));
  }
  function hide(e) {
    const region = regionOf(e.root);   // before the unpin, which may evict (free) it
    scene.remove(e.root); e.state = 'cached'; stats.unloads++;
    onChange(e.m.name, false, region);
    pinOff(e);
  }
  function load(e) {
    e.state = 'loading';
    const gen = ++e.gen, live = () => gen === e.gen;   // dispose() moves gen on: an old job stops at its next step
    const job = async () => {
      const T = { t0: performance.now() };
      if (!sync) await new Promise((r) => setTimeout(r, 0));   // build in a task of its own, not inside update()'s frame
      if (!live()) return;
      const b = await build(e);
      T.build = b.buildMs;
      const discard = () => { free(e, b.root); if (live()) e.state = 'out'; };
      if (!live() || !e.want) return discard();
      if (!sync) {
        await Promise.race([nextFrame(), stopped]);
        if (!live()) return discard();
        let t = performance.now(); await Promise.race([compile(b.root), stopped]); T.compile = performance.now() - t;
        if (!live()) return discard();
        t = performance.now();
        const tex = [];
        b.root.traverse((o) => { for (const x of texturesOf(o)) tex.push(x); });
        upload.add(tex); await Promise.race([upload.whenDone(tex), stopped]); T.upload = performance.now() - t;
        if (!live()) return discard();
      }
      // into the cache pinned (a full cache cannot evict it before it is shown), then shown or kept
      e.root = b.root; e.updates = b.updates; e.pinned = true;
      cache.set(e.m.name, b.root, objectBytes(b.root), { pin: true });
      if (e.want) show(e); else { e.state = 'cached'; pinOff(e); }
      T.total = performance.now() - T.t0; e.timing = T;
      stats.builds.push({ name: e.m.name, ...T });
    };
    if (sync) job().catch((err) => fail(e, err, gen));
    else jobs.add(e.m.name, job, { data: e }).catch((err) => fail(e, err, gen));
  }
  function fail(e, err, gen) {
    if (gen !== e.gen) return;
    if (err && err.cancelled) { e.state = 'out'; return; }
    e.state = 'failed';
    log.error(`[stream] module "${e.m.name}" failed and stays out: ${err && err.stack || err}`);
  }

  return {
    upload, cache, stats,
    /** where the viewer is (a Vector3 or [x, y, z]); call once per frame before the draw: queues, shows, hides, uploads */
    update(p) {
      pos = p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]);
      for (const e of entries.values()) {
        const d = distTo(e.m);
        e.dist = d;
        if (d < e.m.radius) e.want = true;
        else if (d > e.m.radius * hysteresis) e.want = false;
        if (e.want && e.state === 'out') load(e);
        else if (e.want && e.state === 'cached') {
          if (e.root && cache.has(e.m.name)) { e.pinned = true; cache.pin(e.m.name); show(e); } else e.state = 'out';
        } else if (!e.want && e.state === 'in') hide(e);
        else if (!e.want && e.state === 'loading' && !sync) jobs.cancel(e.m.name);
      }
      return upload.step();
    },
    /** the state of each module: 'out' | 'loading' | 'in' | 'cached' | 'failed' */
    state: () => Object.fromEntries([...entries].map(([n, e]) => [n, e.state])),
    idle: () => jobs.idle(),
    /** take every streamed module out of the scene and free it; a load in progress stops at its next step */
    dispose() {
      stop(); stopped = null; stopping(); if (typeof offUpdate === 'function') offUpdate();
      for (const e of entries.values()) {
        e.want = false; e.gen++; jobs.cancel(e.m.name);
        if (e.root) { const r = e.root; scene.remove(r); cache.delete(e.m.name); e.pinned = false; free(e, r); }
        e.state = 'out';
      }
    },
  };
}
