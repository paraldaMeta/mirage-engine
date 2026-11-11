// Mirage original code.
// World partition: a world too large to hold at once, cut into square cells that stream in around the viewer and
// out behind it, with a simplified stand-in (HLOD proxy) for every cell that is not loaded and a floating origin so
// coordinates near the camera stay small. The idea is the one of Unreal's World Partition and Unity's streaming
// scenes; it sits on createStreamer (stream.js): a cell is a streamed module, so builds, shader compiles and
// uploads are spread over frames and cells that just left stay cached.
//
//   import { createPartition } from '@miragekit/world/partition';
//   const part = createPartition(world, {
//     bounds: [x0, z0, x1, z1], size: 256,          // the grid: cells of `size` metres
//     build(cell, ctx) { ctx.root.add(...) },       // a cell's content, in the cell's own space: its centre is (0, 0, 0)
//     load: 600, hysteresis: 1.25,                  // in within 600 m of the cell's centre, out beyond 750 m
//     proxy: { ratio: 0.04, material, workers: 2 }, // HLOD: each cell's content merged and simplified, shown while it is out
//     origin: { threshold: 1024 },                  // floating origin: rebase when the camera is that far from it
//     onCell(cell, inScene, root) {}, onProxy(cell, mesh) {}, onRebase(shift) {} });
//   per frame, before the draw: part.update(world.camera)      (it may move the camera: a rebase)
//   part.offset                    // Vector3: absolute position of the scene's origin (absolute = scene + offset)
//   part.stats                     // { cells, in, proxies, proxyQueue, proxyMs, proxyTriangles, rebases }
//   await part.ready()             // every proxy baked (they bake nearest first, in workers, a few ms of main thread each)
//
// A cell is { name, ix, iz, x, z (absolute centre), size, root (while loaded), proxy }. Its root and its proxy are
// placed at (x - offset.x, -offset.y, z - offset.z); a rebase moves the camera, every root and proxy by the same
// multiple of `snap` metres (default: the cell size) in one step, between two frames, and calls onRebase(shift) for
// what the partition does not own (instances: object.position.sub(shift); occlusion: occ.shift(...); a walker).
// Limits: proxies are baked at run time by building each cell once (a shipped game would bake them offline and
// load them); a material that derives its look from world position (procedural noise) shifts with a rebase unless
// its period divides `snap`; world.sun / shadow fitting follow the camera through renderFrame's `shadow` option
// as before; physics colliders are the game's to rebase.
import * as THREE from 'three';
import { buildProxyAsync, createSimplifyWorkers } from '@miragekit/core/autolod';
import { disposeObject } from '@miragekit/core/stream';
import { createStreamer } from './stream.js';

export function createPartition(world, opts) {
  const { bounds, size = 256, build, load = 2.5 * size, hysteresis = 1.25, proxy = null, origin = null, onCell = () => {}, onRebase = () => {}, onProxy = () => {},
    concurrency = 1, budget = 512 * 1024 * 1024, shared = {}, log = console } = opts;
  const { scene } = world;
  const [x0, z0, x1, z1] = bounds, nx = Math.max(1, Math.ceil((x1 - x0) / size - 1e-9)), nz = Math.max(1, Math.ceil((z1 - z0) / size - 1e-9));
  const offset = new THREE.Vector3(), cells = [], byName = new Map();
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const c = { name: `cell_${ix}_${iz}`, ix, iz, x: x0 + (ix + 0.5) * size, z: z0 + (iz + 0.5) * size, size, root: null, inScene: false, proxy: null, proxyState: proxy ? 'none' : 'off', dist: Infinity };
    cells.push(c); byName.set(c.name, c);
  }
  const stats = { cells: cells.length, in: 0, proxies: 0, proxyQueue: 0, proxyMs: 0, proxyTriangles: 0, proxySourceTriangles: 0, rebases: 0 };
  const place = (o, c) => { o.position.set(c.x - offset.x, -offset.y, c.z - offset.z); o.updateMatrixWorld(true); };

  // ---- the cells as streamed modules (absolute coordinates: update() hands the streamer the absolute position)
  const plan = { name: opts.name || 'partition', bounds: [x0, z0, x1, z1], seed: opts.seed ?? 'partition' };
  const streamer = createStreamer(world, { plan, shared, concurrency, budget, hysteresis, log,
    modules: cells.map((c) => ({ name: c.name, center: [c.x, c.z], radius: load, build: async (ctx) => { c.root = ctx.root; place(ctx.root, c); await build(c, ctx); ctx.root.updateMatrixWorld(true); } })),
    onChange: (name, inScene) => {
      const c = byName.get(name);
      c.inScene = inScene; stats.in += inScene ? 1 : -1;
      if (inScene) place(c.root, c);                       // a rebase may have happened while it was cached
      if (c.proxy) c.proxy.visible = !inScene;
      onCell(c, inScene, c.root);
    } });

  // ---- proxies: nearest first, one at a time: build the cell into a side group, merge + simplify (worker), free it
  const workers = proxy ? createSimplifyWorkers(proxy.workers ?? 1) : null;
  let baking = 0, readyResolve = [], disposed = false;
  stats.proxyQueue = proxy ? cells.length : 0;
  async function bake(c) {
    baking++; c.proxyState = 'baking';
    const t0 = performance.now();
    try {
      // the loaded cell itself when there is one, else a throw-away build
      let src = c.inScene ? c.root : null, own = null;
      if (!src) {
        own = src = new THREE.Group();
        const ctx = { ...world.ctx, world, plan, shared, name: c.name, root: own, scene: own, onUpdate() { return () => {}; }, log() {}, proxy: true };
        await build(c, ctx);
      }
      src.updateMatrixWorld(true);
      const mesh = await buildProxyAsync(src, { ratio: proxy.ratio ?? 0.04, triangles: proxy.triangles, material: proxy.material, lockBorder: proxy.lockBorder ?? false, colorOf: proxy.colorOf, origin: src.matrixWorld }, workers);
      if (own) disposeObject(own);
      if (disposed) { mesh?.geometry.dispose(); return; }
      if (mesh) {
        mesh.name = c.name + ':hlod'; c.proxy = mesh; place(mesh, c); mesh.visible = !c.inScene; scene.add(mesh);
        onProxy(c, mesh);
        stats.proxies++; stats.proxyTriangles += mesh.userData.proxy.triangles; stats.proxySourceTriangles += mesh.userData.proxy.sourceTriangles;
      }
      c.proxyState = 'done';
    } catch (err) { c.proxyState = 'failed'; log.error(`[partition] proxy of ${c.name} failed: ${err && err.stack || err}`); }
    stats.proxyMs += performance.now() - t0; stats.proxyQueue--; baking--;
    if (!stats.proxyQueue) { for (const r of readyResolve) r(stats); readyResolve = []; }
  }

  const _abs = new THREE.Vector3(), _shift = new THREE.Vector3();
  function update(camera = world.camera) {
    const p = camera.position;
    // floating origin: the camera too far from the origin -> everything moves back by a multiple of snap
    if (origin) {
      const th = origin.threshold ?? 1024, snap = origin.snap ?? size;
      if (Math.abs(p.x) > th || Math.abs(p.z) > th || Math.abs(p.y) > th) {
        _shift.set(Math.round(p.x / snap) * snap, origin.vertical ? Math.round(p.y / snap) * snap : 0, Math.round(p.z / snap) * snap);
        offset.add(_shift); p.sub(_shift); camera.updateMatrixWorld(true);
        for (const c of cells) { if (c.root) place(c.root, c); if (c.proxy) place(c.proxy, c); }
        stats.rebases++;
        onRebase(_shift);
      }
    }
    _abs.copy(p).add(offset);
    const up = streamer.update(_abs);
    if (proxy && baking < Math.max(1, workers.workers) && stats.proxyQueue) {
      let best = null;
      for (const c of cells) { c.dist = Math.hypot(c.x - _abs.x, c.z - _abs.z); if (c.proxyState === 'none' && (!best || c.dist < best.dist)) best = c; }
      if (best) bake(best);
    }
    return up;
  }
  return {
    cells, stats, offset, streamer, update,
    cellAt: (x, z) => byName.get(`cell_${Math.floor((x - x0) / size)}_${Math.floor((z - z0) / size)}`) || null,
    ready: () => (stats.proxyQueue ? new Promise((r) => readyResolve.push(r)) : Promise.resolve(stats)),
    dispose() {
      disposed = true; streamer.dispose(); workers?.dispose();
      for (const c of cells) if (c.proxy) { c.proxy.removeFromParent(); c.proxy.geometry.dispose(); c.proxy = null; }
    },
  };
}

// The floating origin alone, for worlds without cells: keeps the camera within `threshold` of the origin by moving
// `roots` (and the camera) by multiples of `snap`. -> { offset, update(camera) -> shift | null }
export function createFloatingOrigin({ roots = [], threshold = 1024, snap = 256, onRebase = () => {} } = {}) {
  const offset = new THREE.Vector3(), shift = new THREE.Vector3();
  return { offset,
    update(camera) {
      const p = camera.position;
      if (Math.abs(p.x) <= threshold && Math.abs(p.z) <= threshold) return null;
      shift.set(Math.round(p.x / snap) * snap, 0, Math.round(p.z / snap) * snap);
      offset.add(shift); p.sub(shift); camera.updateMatrixWorld(true);
      for (const r of roots) { r.position.sub(shift); r.updateMatrixWorld(true); }
      onRebase(shift);
      return shift;
    } };
}
