// Mirage original code.
// Visual effects: GPU particles described as plain data. Nothing here runs until createVfx is called, and a world
// without it renders exactly as before.
//
//   import { createVfx, VFX_LIBRARY } from '@miragekit/core';
//   const vfx = createVfx(world);                          // hooks the world's clock; or { renderer, scene, camera }
//   const fire = vfx.spawn(VFX_LIBRARY.fire, { position: [0, 0, 0] });      // a looping effect: a handle
//   vfx.burst(VFX_LIBRARY.explosion, [4, 1, 0]);                            // a one-shot: allocates nothing
//   fire.move({ position: [1, 0, 0] });  fire.stop();      // stop emitting; what is in the air lives out its life
//   vfx.spawn({ name: 'mine', emitters: [{ rate: 40, life: [1, 2], shape: { type: 'cone', angle: 20 },
//     velocity: { speed: [2, 3] }, gravity: -4, color: ['#ffd27a', '#ff5a1e', '#200'], alpha: [1, 0] }] });
//
// An effect is JSON (vfx-data.js documents every field); each emitter becomes one ParticlePool (particles.js: the
// state lives in float textures and one fragment pass advances it by a fixed step) drawn by one instanced mesh
// (particle-draw.js). All instances of an effect share its pools, so a hundred footsteps cost one draw call.
// The simulation is a pure function of the step count, the effect and its instances' transforms: with the same
// update times, a still or a playtest reproduces bit for bit on the same GPU (depth collision excepted: it reads
// the rendered frame).
import * as THREE from 'three';
import { defineEffect, bakeCurves, VFX_LUT_W } from './vfx-data.js';
import { ParticlePool, setSourceTransform } from './particles.js';
import { createParticleMesh } from './particle-draw.js';
import { sampleMesh, heightTexture, createSorter, makeSheet, createDepthCopy } from './vfx-gpu.js';
import { createTrailMesh, createBeams, createDecals } from './vfx-extras.js';
import { createEnv } from './env.js';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _f = new THREE.Frustum(), _s = new THREE.Sphere();
const half = (f32) => { const h = new Uint16Array(f32.length); for (let i = 0; i < h.length; i++) h[i] = THREE.DataUtils.toHalfFloat(f32[i]); return h; };
const vec = (p, into) => (p ? (p.isVector3 ? into.copy(p) : into.set(p[0], p[1], p[2])) : into);

/** target: a Mirage world (createWorldRenderer), or { renderer, scene, camera, G? } for a plain three.js scene (then
 *  call vfx.update(seconds) yourself each frame). opts: hz (60, the fixed simulation rate), maxParticles (200000,
 *  the global cap: above it every emitter's rate is scaled down), instances (4: each effect's pools hold this many
 *  instances at once; vfx.prewarm(effect, { instances }) sets it per effect), windSpeed (2 m/s per unit of the world's wind),
 *  gain (the brightness of unlit and emissive colours; default: follows the world's exposure, 1 outside a world). */
export function createVfx(target, opts = {}) {
  const { renderer, scene, camera } = target, isWorld = !!(target.ctx && target.ctx.onUpdate);
  const G = target.G || createEnv().G, hz = opts.hz || 60, maxParticles = opts.maxParticles || 200000, windSpeed = opts.windSpeed ?? 2, defaultInstances = opts.instances || 4;
  const root = new THREE.Group(); root.name = 'vfx'; root.userData.collide = false; scene.add(root);
  const depth = createDepthCopy(); root.add(depth.mesh);
  const sorter = createSorter(renderer);
  const effects = new Map(), kits = new Map(), byDesc = new WeakMap(), meshes = new Map(), fields = new Map(), sheets = new Map();
  const env = { wind: new THREE.Vector3(), ground: null, depth };
  // unlit and emissive colours are display-referred: 1 is about white on screen whatever the hour. In a world the gain
  // follows its exposure (the same -0.9 power the world's lamps use); opts.gain fixes it.
  const gain = { value: opts.gain ?? 1 };
  const stats = { pools: 0, particles: 0, capacity: 0, spawned: 0, dropped: 0, steps: 0, instances: 0, budget: 1, simMs: 0, sortPasses: 0 };
  let lastN = -1, budget = 1, over = 1, disposed = false;

  // --- registries --------------------------------------------------------------------------------------------------
  /** a mesh to emit from (shape 'mesh') and to draw (render 'mesh'). samples: surface points baked for emission */
  function registerMesh(name, geometry, { samples = 2048, seed = 7 } = {}) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    meshes.set(name, { geometry, ...sampleMesh(geometry, samples, seed) });
  }
  /** a vector field (emitter.field): { size: [nx, ny, nz], data (Float32Array, xyz per cell, x fastest) } or
   *  { size, fn(u, v, w) → [x, y, z] } with u, v, w in 0..1 across the box the emitter places with field.min / size */
  function registerField(name, f) {
    const [nx, ny, nz] = f.size, d = new Float32Array(nx * ny * nz * 4);
    for (let k = 0, i = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let x = 0; x < nx; x++, i++) {
      const p = f.fn ? f.fn((x + 0.5) / nx, (j + 0.5) / ny, (k + 0.5) / nz) : [f.data[i * 3], f.data[i * 3 + 1], f.data[i * 3 + 2]];
      d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2];
    }
    const t = new THREE.Data3DTexture(half(d), nx, ny, nz);     // half floats: linear filtering without an extension
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
    fields.set(name, t);
  }
  /** a flipbook sheet: { texture, cols, rows }. 'smoke' and 'flame' are built in (drawn from noise on first use) */
  function registerSheet(name, sheet) { sheets.set(name, sheet); }
  const lazySheets = { get: (name) => { if (!sheets.has(name) && (name === 'smoke' || name === 'flame')) sheets.set(name, makeSheet(renderer, name)); return sheets.get(name); } };
  const shard = new THREE.TetrahedronGeometry(1).scale(1, 0.35, 0.7);
  registerMesh('shard', shard, { samples: 256 });
  registerMesh('cube', new THREE.BoxGeometry(1, 1, 1), { samples: 512 });
  registerMesh('sphere', new THREE.SphereGeometry(1, 16, 10), { samples: 1024 });

  /** register an effect description under its name; returns the checked, normalised effect */
  function define(desc) {
    const fx = desc && desc.__vfx ? desc : defineEffect(desc);
    effects.set(fx.name, fx);
    return fx;
  }
  function resolve(what) {
    if (typeof what === 'string') { const fx = effects.get(what); if (!fx) throw new Error(`vfx: no effect named "${what}" (vfx.define it first; known: ${[...effects.keys()].join(', ') || 'none'})`); return fx; }
    if (what && what.__vfx) return what;
    let fx = byDesc.get(what); if (!fx) { fx = defineEffect(what); byDesc.set(what, fx); }
    return fx;
  }

  // --- pools -------------------------------------------------------------------------------------------------------
  function lutFor(e) {
    const t = new THREE.DataTexture(half(bakeCurves(e)), VFX_LUT_W, 2, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }
  function unit(e, parent, sub, instances) {
    const pool = new ParticlePool(renderer, e, { hz, instances, parent: parent ? parent.pool : null, sub, meshes, fields });
    const lut = lutFor(e), o = { G, lut, depth, sheets: lazySheets, meshes, gain };
    const u = { e, pool, lut, mesh: createParticleMesh(pool, o), trail: e.trail ? createTrailMesh(pool, o) : null, subs: [], parent, sphere: new THREE.Sphere(), sorted: e.render.sort === 'distance' };
    root.add(u.mesh); if (u.trail) root.add(u.trail);
    if (!parent) for (const s of e.sub) u.subs.push(unit(s.emitter, u, s, 1));
    return u;
  }
  function kitFor(fx, instances = defaultInstances) {
    let k = kits.get(fx);
    if (!k) {
      k = { fx, units: fx.emitters.map((e) => unit(e, null, null, instances)) };
      for (const u of k.units) u.pool.lag = Math.max(0, lastN);       // born now: no catching up on time before it existed
      kits.set(fx, k);
    }
    return k;
  }
  /** build an effect's pools and compile its shaders now, not at its first spawn (a hitch in the middle of play).
   *  opts.instances: how many instances of the effect its pools must hold at once (default: createVfx's `instances`);
   *  opts.compile: false builds the pools only (a page that calls world.prepare() afterwards) */
  function prewarm(what, o = {}) {
    const k = kitFor(resolve(what), o.instances);
    for (const u of k.units) for (const x of [u, ...u.subs]) { x.mesh.visible = true; x.mesh.geometry.instanceCount = Math.max(1, x.mesh.geometry.instanceCount); }
    if (renderer.compile && o.compile !== false) renderer.compile(root, camera, scene);   // compile: false: world.prepare() compiles them (in parallel, for the frame's target)
    for (const u of k.units) for (const x of [u, ...u.subs]) x.mesh.geometry.instanceCount = 0;
    return k;
  }

  // --- instances ---------------------------------------------------------------------------------------------------
  const srcOpts = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1, velocity: new THREE.Vector3(), rate: 1, onDone: null };
  function fill(o) {
    vec(o.position, srcOpts.position.set(0, 0, 0));
    if (o.quaternion) srcOpts.quaternion.copy(o.quaternion); else if (o.direction) srcOpts.quaternion.setFromUnitVectors(_v.set(0, 1, 0), vec(o.direction, xd).normalize()); else srcOpts.quaternion.identity();
    srcOpts.scale = o.scale ?? 1; vec(o.velocity, srcOpts.velocity.set(0, 0, 0)); srcOpts.rate = o.rate ?? 1;
    return srcOpts;
  }
  // move() input with arrays turned into the vectors setSourceTransform wants (one reused record: no garbage per call)
  const xfo = { matrix: undefined, position: undefined, quaternion: undefined, scale: undefined }, xp = new THREE.Vector3(), xq = new THREE.Quaternion(), xd = new THREE.Vector3();
  function xf(m) {
    xfo.matrix = m.matrix; xfo.position = m.position ? vec(m.position, xp) : undefined; xfo.scale = m.scale;
    xfo.quaternion = m.quaternion || (m.direction ? xq.setFromUnitVectors(_v.set(0, 1, 0), vec(m.direction, xd).normalize()) : undefined);
    return xfo;
  }
  /** start an instance of an effect (a name, a defined effect or a description). opts: position, quaternion or
   *  direction (the effect's +Y turned to it), scale, velocity, rate, follow (an Object3D to ride on).
   *  Returns a handle: move(opts), stop(), done, sources. */
  function spawn(what, o = {}) {
    const k = kitFor(resolve(what)), f = fill(o);
    const h = { effect: k.fx, sources: k.units.map((u) => u.pool.addSource(f)), follow: o.follow || null, stopped: false,
      move(m) { const t = xf(m); for (const x of h.sources) if (x.live) { setSourceTransform(x, t); if (m.velocity) vec(m.velocity, x.velocity); if (m.rate !== undefined) x.rate = m.rate; } return h; },
      /** stop emitting; particles already born live out their lives, then the instance retires */
      stop() { if (!h.stopped) { h.stopped = true; h.sources.forEach((s, i) => { if (s.live) s.stopAt = k.units[i].pool.step; }); const j = followers.indexOf(h); if (j >= 0) followers.splice(j, 1); } return h; },
      get done() { return h.sources.every((s) => !s.live); } };
    if (h.follow) followers.push(h);
    return h;
  }
  const followers = [], one = { position: null };
  /** a one-shot at a position ([x, y, z] or Vector3): no handle, no allocation once the effect's pools exist */
  function burst(what, position, o = one) {
    const k = kitFor(resolve(what)), f = fill(o); vec(position, f.position);
    for (const u of k.units) u.pool.addSource(f);
  }
  /** ground for `collision.ground`: a walk grid (bakeWalkGrid) or { min, size, res, heightAt(x, z) }; null clears */
  function setGround(grid) { if (env.ground) env.ground.texture.dispose(); env.ground = grid ? heightTexture(renderer, grid) : null; }

  // --- the frame ---------------------------------------------------------------------------------------------------
  const prev = new THREE.Vector3();
  function bounds(u) {
    // one sphere round every live instance of the emitter, grown by how far its particles can travel
    const src = u.pool.sources, sp = u.sphere;
    if (!src.length) { sp.radius = -1; return sp; }
    sp.center.set(0, 0, 0); for (const s of src) sp.center.add(s.position); sp.center.multiplyScalar(1 / src.length);
    let r = 0; for (const s of src) r = Math.max(r, sp.center.distanceTo(s.position) + u.pool.radius * s.scale);
    sp.radius = r;
    return sp;
  }
  function show(u, sp, extra) {
    const w = u.pool.window(), g = u.mesh.geometry, U = u.mesh.userData.U;
    g.instanceCount = w.count; U.uVWin.value.x = w.base; U.uVWin.value.y = w.count;
    u.mesh.visible = w.count > 0 && sp.radius >= 0;
    if (u.mesh.visible) { g.boundingSphere.center.copy(sp.center); g.boundingSphere.radius = sp.radius + extra; }
    if (u.sorted && u.mesh.visible && onScreen(g.boundingSphere)) { const o = sorter.sort(u.pool, camera); U.tVSort.value = o.texture; U.uVSortW.value = o.width; }
    if (u.trail) u.trail.userData.sync(w, g.boundingSphere, u.mesh.visible);
    stats.particles += w.count; stats.capacity += u.pool.cap; stats.pools++;
    return w.count;
  }
  let frustumOk = false;
  const onScreen = (sp) => !frustumOk || _f.intersectsSphere(sp);
  /** advance every effect to time T (seconds). A world calls this from its own clock; call it yourself otherwise. */
  function update(T) {
    if (disposed) return;
    const t0 = performance.now(), n = Math.floor(T * hz + 1e-6);
    if (!isWorld) G.uTime.value = T;
    if (opts.gain === undefined && isWorld) gain.value = 1.5 * Math.pow(Math.max(target.exposure, 1e-4), -0.9);
    const w = G.uWind.value; env.wind.set(w.x, 0, w.y).multiplyScalar(w.z * windSpeed);
    camera.updateMatrixWorld(); _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse.copy(camera.matrixWorld).invert()); _f.setFromProjectionMatrix(_m); frustumOk = true;
    const eye = _v.setFromMatrixPosition(camera.matrixWorld), dtFrame = lastN >= 0 ? (n - lastN) / hz : 0;
    for (const h of followers) {
      // ride the object: its world matrix, and its motion since the last step as the inherited velocity
      h.follow.updateWorldMatrix(true, false);
      for (const s of h.sources) if (s.live) { prev.copy(s.position); setSourceTransform(s, { matrix: h.follow.matrixWorld }); if (dtFrame > 0) s.velocity.subVectors(s.position, prev).multiplyScalar(1 / dtFrame); }
    }
    // the clock went back (play.place() sets it to 0): every pool restarts on the scene clock, frozen ones included
    // (a pool's lag, kept while it was idle or off screen, would hold it behind the rewound clock, resetting each frame)
    if (lastN >= 0 && n < lastN - 4) for (const k of kits.values()) for (const u of k.units) u.pool.lag = 0;
    stats.pools = stats.particles = stats.capacity = stats.instances = 0;
    let spawned = 0, dropped = 0, steps = 0, demand = 0;
    for (const k of kits.values()) for (const u of k.units) {
      const pool = u.pool, e = u.e, sp = bounds(u), L = e.lod;
      const idle = !pool.sources.length, away = e.pauseOffscreen && sp.radius >= 0 && !_f.intersectsSphere(sp);
      if (idle || away) pool.lag = n - pool.step;                       // frozen: its clock stops, and resumes where it was
      else {
        for (const s of pool.sources) {
          const d = eye.distanceTo(s.position), f = d <= L.near ? 1 : d >= L.far ? L.min : 1 + (L.min - 1) * (d - L.near) / (L.far - L.near);
          const q = L.cull > 0 && d > L.cull ? 0 : f;
          s.lod = q * budget; demand += q * s.rate * (s.stopAt < 0 ? e.rate * e.life[1] : 0);
        }
        steps += pool.advanceTo(n - pool.lag, env);
      }
      stats.instances += pool.sources.length; spawned += pool.spawned; dropped += pool.dropped;
      show(u, sp, 0);
      for (const c of u.subs) { show(c, sp, c.pool.radius); spawned += c.pool.spawned; }
    }
    // the global cap. Looping emitters say what they will hold (rate × life), so their share is known before a single
    // particle is over; bursts cannot be foreseen, so a second, slow factor comes down while the slots in use are over
    // the cap and recovers when they are not. Every emitter's rate and burst counts are scaled by the product.
    over = stats.particles > maxParticles ? Math.max(0.02, over * Math.pow(maxParticles / stats.particles, 0.05)) : Math.min(1, over * 1.01);
    budget = Math.min(1, maxParticles / Math.max(demand, 1)) * over;
    beams.update(T); decals.update(T);
    Object.assign(stats, { spawned, dropped, budget, sortPasses: sorter.passes }); stats.steps += steps;
    stats.simMs = performance.now() - t0;
    lastN = n;
  }
  /** exact live particle count (slow: reads every pool's state back from the GPU; for tools and tests) */
  function countAlive() { let c = 0; for (const k of kits.values()) for (const u of k.units) { c += u.pool.countAlive(); for (const s of u.subs) c += s.pool.countAlive(); } return c; }
  /** stop everything and empty every pool */
  function clear() {
    for (const k of kits.values()) for (const u of k.units) { for (const s of u.pool.sources.splice(0)) { s.live = false; s.done = true; u.pool.free.push(s); } u.pool.reset(u.pool.step); }
    followers.length = 0; beams.clear(); decals.clear();
  }
  /** drop one effect's pools (its GPU memory); the next spawn builds them again */
  function release(what) {
    const fx = resolve(what), k = kits.get(fx); if (!k) return;
    for (const u of k.units) { for (const x of [u, ...u.subs]) { root.remove(x.mesh); x.mesh.geometry.dispose(); x.mesh.material.dispose(); x.lut.dispose(); sorter.forget(x.pool); if (x.trail) { root.remove(x.trail); x.trail.userData.dispose(); } } u.pool.dispose(); }
    kits.delete(fx);
  }
  const ctx = { renderer, scene, camera, G, root, depth, hz, gain };
  const beams = createBeams(ctx), decals = createDecals(ctx);
  function dispose() {
    for (const fx of [...kits.keys()]) release(fx);
    beams.dispose(); decals.dispose(); sorter.dispose(); depth.dispose(); setGround(null);
    for (const m of meshes.values()) { m.texture.dispose(); m.geometry.dispose(); } for (const f of fields.values()) f.dispose(); for (const s of sheets.values()) (s.target || s.texture).dispose();
    scene.remove(root); disposed = true; if (typeof offUpdate === 'function') offUpdate();
  }
  const offUpdate = isWorld ? target.ctx.onUpdate((tk) => update(tk)) : null;   // undone in dispose()
  return { root, stats, depth, hz, sorter, define, spawn, burst, prewarm, update, clear, release, dispose, countAlive, setGround, registerMesh, registerField, registerSheet,
    /** a beam or a lightning bolt between two points (vfx-extras.js) */
    beam: (o) => beams.add(o),
    /** a decal projected onto whatever the scene shows there (vfx-extras.js) */
    decal: (o) => decals.add(o),
    effects, pools: () => [...kits.values()].flatMap((k) => k.units.flatMap((u) => [u.pool, ...u.subs.map((s) => s.pool)])) };
}
