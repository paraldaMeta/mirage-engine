// Mirage original code. The module/anchor conventions follow the author's own earlier project (docs/NOTES.md there).
import * as THREE from 'three';
import { rng } from '@mirage/core';
import { definePlan } from './plan.js';

// ---------------------------------------------------------------------------
// buildWorld(world, { plan, modules, shared }) builds the modules in order into `world.scene`.
//
// A module is a plain object:
//   { name, build(ctx), finalize?(ctx), anchors?, ambientVolumes? }
//   build(ctx)        make geometry; add it to ctx.root (ctx.scene is the same group). May return anything:
//                     it is kept as world.modules[name] for later modules and for the module's own hooks.
//   anchors           object, or (ctx, built) => object: { key: [{ pos: [x, y, z], rotY, ...extra }] } this
//                     module offers others (lamps, seats, doors). Entries get `from: name`.
//   finalize(ctx)     runs after every build; ctx.anchors holds every module's anchors (consume them here).
//   ambientVolumes    array, or (ctx, built) => array: [{ min, max, factor, soft }] interiors (core dims the
//                     image-based light inside).
//
// Isolation: a module that throws (build, anchors or finalize) is logged and skipped; whatever it added to its
// own ctx.root is dropped with it, and its onUpdate callbacks never run. The others build on.
// Randomness: ctx.R is this module's own seeded stream (plan.seed/name), ctx.rng(sub) forks more; one module's
// draws never shift another's.
// Layers: geometry on layer 0 is solid for the walk grid unless `userData.collide === false`; ctx.collider(mesh)
// adds an invisible collision-only proxy (layer LAYER.COLLIDE) for open meshes (vertical tubes, water).
// ---------------------------------------------------------------------------

export const LAYER = { VIEW: 0, COLLIDE: 2 };

const now = () => (globalThis.performance ? performance.now() : Date.now());
const tris = (o) => { let n = 0; o.traverse((m) => { const g = m.geometry; if (m.isMesh && g) n += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (m.isInstancedMesh ? m.count : 1); }); return Math.round(n); };
const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const colliderFor = (root) => (mesh) => {
  mesh.material = proxyMat; mesh.layers.set(LAYER.COLLIDE); mesh.castShadow = mesh.receiveShadow = false;
  mesh.userData.collider = true; root.add(mesh); return mesh;
};

export async function buildWorld(world, { plan, modules, shared = {}, log = console } = {}) {
  plan = definePlan(plan);
  const report = { plan: plan.name, modules: [], failed: [], anchors: {}, ambientVolumes: [], ms: 0 };
  const built = {}, anchors = {}, live = [];
  const t0 = now();

  const makeCtx = (m, root, updates) => {
    const R = rng(`${plan.seed}/${m.name}`);
    return {
      ...world.ctx, world, plan, shared, name: m.name, root, scene: root,
      R, rng: (sub = '') => (sub ? rng(`${plan.seed}/${m.name}/${sub}`) : R),
      anchors, modules: built,
      onUpdate: (fn) => updates.push(fn),
      collider: colliderFor(root),
      log: (...a) => log.log(`[${m.name}]`, ...a),
    };
  };
  const fail = (m, phase, e) => {
    report.failed.push({ name: m.name, phase, error: String(e && e.message || e) });
    log.error(`[world] module "${m.name}" failed in ${phase} and was skipped: ${e && e.stack || e}`);
  };
  const commit = (root, updates) => { world.scene.add(root); for (const fn of updates) world.ctx.onUpdate(fn); };

  // ---- build, in order
  for (const m of modules) {
    const ts = now(), root = new THREE.Group(), updates = [];
    root.name = m.name;
    const ctx = makeCtx(m, root, updates);
    const row = { name: m.name, ok: false, ms: 0, tris: 0, anchors: {} };
    report.modules.push(row);
    try {
      if (!m.name || typeof m.build !== 'function') throw new Error('a module needs a name and build(ctx)');
      const out = (await m.build(ctx)) ?? {};
      const a = typeof m.anchors === 'function' ? m.anchors(ctx, out) : m.anchors;
      const v = typeof m.ambientVolumes === 'function' ? m.ambientVolumes(ctx, out) : m.ambientVolumes;
      for (const [k, list] of Object.entries(a || {})) {
        anchors[k] = (anchors[k] || []).concat(list.map((e) => ({ ...e, from: m.name })));
        row.anchors[k] = list.length;
      }
      if (v) report.ambientVolumes.push(...v.map((e) => ({ ...e, from: m.name })));
      built[m.name] = out;
      commit(root, updates);
      live.push({ m, ctx });
      row.ok = true;
    } catch (e) { fail(m, 'build', e); }
    row.ms = +(now() - ts).toFixed(1);
  }
  // ---- finalize: every anchor is known now
  for (const { m, ctx } of live) {
    if (typeof m.finalize !== 'function') continue;
    const ts = now(), root = new THREE.Group(), updates = [];
    root.name = m.name + ':finalize';
    const row = report.modules.find((r) => r.name === m.name);
    try {
      await m.finalize({ ...ctx, root, scene: root, onUpdate: (fn) => updates.push(fn), collider: colliderFor(root) });
      commit(root, updates);
    } catch (e) { fail(m, 'finalize', e); row.ok = false; }
    row.ms = +(row.ms + now() - ts).toFixed(1);
  }
  for (const row of report.modules) {
    const objs = world.scene.children.filter((c) => c.name === row.name || c.name === row.name + ':finalize');
    row.tris = objs.reduce((s, o) => s + tris(o), 0);
  }
  if (report.ambientVolumes.length && world.setAmbientVolumes) world.setAmbientVolumes(report.ambientVolumes);
  report.anchors = Object.fromEntries(Object.entries(anchors).map(([k, l]) => [k, l.length]));
  report.ms = +(now() - t0).toFixed(1);
  log.log(`[world] ${plan.name}: ${report.modules.filter((r) => r.ok).length}/${modules.length} modules in ${report.ms} ms` +
    (report.failed.length ? `; failed: ${report.failed.map((f) => `${f.name} (${f.phase})`).join(', ')}` : ''));
  return { plan, modules: built, anchors, report };
}
