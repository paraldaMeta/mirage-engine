// Mirage original code. The load / unload by distance with a priority queue and an LRU of what was near follows the
// tile streaming of NASA-AMMOS 3DTilesRendererJS (Apache-2.0); no code from it.
import * as THREE from 'three';
import { rng } from '@mirage/core';
import { createJobQueue, createLRU, createUploadBudget, objectBytes, texturesOf, disposeObject, nextFrame } from '@mirage/core/stream';
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
  const entries = new Map();   // name -> { m, want, state: 'out' | 'loading' | 'in' | 'cached', root, alive, ms }
  // evicted: free its geometry and materials, and the textures nothing in the scene still samples (a shared texture
  // library's sets stay)
  const free = (root) => {
    const used = new Set();
    scene.traverse((o) => { for (const t of texturesOf(o)) used.add(t); });
    const own = new Set();
    root.traverse((o) => { for (const t of texturesOf(o)) if (!used.has(t)) own.add(t); });
    disposeObject(root, { keepTextures: true });
    for (const t of own) t.dispose();
  };
  const cache = createLRU({ budget, evict: (name, root) => {
    const e = entries.get(name);
    stats.evictions++; free(root);
    if (e.root === root) { e.alive.on = false; e.root = null; e.state = 'out'; }
  } });
  const jobs = createJobQueue({ concurrency, priority: (job) => job.data.dist });
  const stats = { loads: 0, unloads: 0, evictions: 0, builds: [] };
  let pos = new THREE.Vector3();
  for (const m of modules) {
    if (!m || !m.name || typeof m.build !== 'function' || !Array.isArray(m.center)) throw new Error('a streamed module needs { name, center: [x, z], radius, build(ctx) }');
    if (entries.has(m.name)) throw new Error(`two streamed modules are called "${m.name}"`);
    entries.set(m.name, { m, want: false, state: 'out', root: null, alive: { on: false }, dist: Infinity, timing: null });
  }
  const distTo = (m) => Math.hypot(pos.x - m.center[0], pos.z - m.center[1]);

  async function build(e) {
    const { m } = e, t0 = performance.now(), root = new THREE.Group(), updates = [];
    root.name = m.name;
    const R = rng(`${plan.seed}/${m.name}`);
    const ctx = { ...world.ctx, world, plan, shared, name: m.name, root, scene: root, R, rng: (sub) => (sub === undefined || sub === '' ? R : rng(`${plan.seed}/${m.name}/${sub}`)),
      anchors: {}, modules: {}, onUpdate: (fn) => updates.push(fn), collider: colliderFor(root), log: (...a) => log.log(`[${m.name}]`, ...a) };
    await m.build(ctx);
    const alive = { on: true };
    for (const fn of updates) world.ctx.onUpdate((t) => alive.on && root.parent === scene && fn(t));
    return { root, alive, buildMs: performance.now() - t0 };
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
    scene.add(e.root); e.state = 'in'; cache.pin(e.m.name); cache.get(e.m.name);
    stats.loads++;
    onChange(e.m.name, true, regionOf(e.root));
  }
  function load(e) {
    e.state = 'loading';
    const job = async () => {
      const T = { t0: performance.now() };
      if (!sync) await new Promise((r) => setTimeout(r, 0));   // build in a task of its own, not inside update()'s frame
      const b = await build(e);
      T.build = b.buildMs;
      if (!e.want) { b.alive.on = false; free(b.root); e.state = 'out'; return; }
      e.root = b.root; e.alive = b.alive;
      if (sync) { show(e); cache.set(e.m.name, e.root, objectBytes(e.root)); cache.pin(e.m.name); T.total = performance.now() - T.t0; e.timing = T; stats.builds.push({ name: e.m.name, ...T }); return; }
      await nextFrame();
      let t = performance.now(); await compile(e.root); T.compile = performance.now() - t;
      t = performance.now();
      const tex = [];
      e.root.traverse((o) => { for (const x of texturesOf(o)) tex.push(x); });
      upload.add(tex); await upload.whenDone(tex); T.upload = performance.now() - t;
      cache.set(e.m.name, e.root, objectBytes(e.root));
      if (e.want) show(e); else { e.state = 'cached'; }
      T.total = performance.now() - T.t0; e.timing = T;
      stats.builds.push({ name: e.m.name, ...T });
    };
    if (sync) job().catch((err) => fail(e, err));
    else jobs.add(e.m.name, job, { data: e }).catch((err) => fail(e, err));
  }
  function fail(e, err) {
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
        else if (e.want && e.state === 'cached') { if (cache.has(e.m.name)) show(e); else e.state = 'out'; }
        else if (!e.want && e.state === 'in') {
          scene.remove(e.root); e.state = 'cached'; stats.unloads++;
          cache.unpin(e.m.name);
          onChange(e.m.name, false, regionOf(e.root));
        } else if (!e.want && e.state === 'loading' && !sync) jobs.cancel(e.m.name);
      }
      return upload.step();
    },
    /** the state of each module: 'out' | 'loading' | 'in' | 'cached' | 'failed' */
    state: () => Object.fromEntries([...entries].map(([n, e]) => [n, e.state])),
    idle: () => jobs.idle(),
    /** take every streamed module out of the scene and free it */
    dispose() {
      for (const e of entries.values()) {
        e.want = false; jobs.cancel(e.m.name);
        if (e.root) { scene.remove(e.root); e.alive.on = false; cache.delete(e.m.name); free(e.root); e.root = null; }
        e.state = 'out';
      }
    },
  };
}
