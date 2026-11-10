// Mirage original code. The module/anchor conventions follow the author's own earlier project (docs/NOTES.md there).
import * as THREE from 'three';
import { rng } from '@mirage/core';
import { nextFrame, watchLongTasks } from '@mirage/core/stream';
import { definePlan } from './plan.js';

// ---------------------------------------------------------------------------
// buildWorld(world, { plan, modules, shared }) builds the modules in order into `world.scene`.
//
// A module is a plain object:
//   { name, build(ctx), finalize?(ctx), anchors?, consumes?, ambientVolumes? }
//   build(ctx)        make geometry; add it to ctx.root (ctx.scene is the same group). May return anything:
//                     it is kept as world.modules[name] for later modules and for the module's own hooks.
//   anchors           object, or (ctx, built) => object: { key: [{ pos: [x, y, z], rotY, ...extra }] } this
//                     module offers others (lamps, seats, doors). Entries get `from: name`.
//   finalize(ctx)     runs after every build; ctx.anchors holds every module's anchors (consume them here).
//   consumes          optional { required: ['lamps'], optional: ['seats'] }. Resolved after all builds.
//   ambientVolumes    array, or (ctx, built) => array: [{ min, max, factor, soft }] interiors (core dims the
//                     image-based light inside).
//
// Isolation: a module that throws (build, anchors, ambientVolumes or finalize) is logged and skipped; whatever it
// added to its own ctx.root is dropped with it, its onUpdate callbacks stop, and anchors it offered in a failed
// build reach nobody. (Anchors of a module whose finalize fails were already offered to the others' finalize.)
// Two modules with one name: the second is skipped. The others build on.
// Randomness: ctx.R is this module's own seeded stream (plan.seed/name), ctx.rng(sub) forks more; one module's
// draws never shift another's.
// Time slicing (opt-in, for worlds built while one is already running): { slice: true | { budgetMs = 8, yield } }
// gives the frame back between modules (and between finalizes) once `budgetMs` of building has passed since the
// last yield, so the page keeps drawing; a single module's build is never split (keep modules small). The report then
// has `slices`: { yields, longestMs (the longest stretch without a yield), longModules (builds over 50 ms), longTasks
// (PerformanceObserver: count / totalMs / maxMs over the build) }. Without it the build runs straight through.
// Layers: geometry on layer 0 is solid for the walk grid unless `userData.collide === false`; ctx.collider(mesh)
// adds an invisible collision-only proxy (layer LAYER.COLLIDE) for open meshes (vertical tubes, water) and for
// solids thinner than a walk-grid cell (railings: a proxy at least 0.2 m thick).
// ---------------------------------------------------------------------------

export const LAYER = { VIEW: 0, COLLIDE: 2 };

const now = () => (globalThis.performance ? performance.now() : Date.now());
// drawn triangles: collision-only proxies are not drawn, and a placeholder mesh without positions has none
const tris = (o) => { let n = 0; o.traverse((m) => { const g = m.geometry, p = g?.attributes?.position; if (m.isMesh && p && !m.userData.collider) n += ((g.index ? g.index.count : p.count) / 3) * (m.isInstancedMesh ? m.count : 1); }); return Math.round(n); };
// what world.setAmbientVolumes reads: { min: [x, y, z], max: [x, y, z], factor?, soft? }
const xyz = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
function checkVolume(v, i) {
  if (!v || typeof v !== 'object' || !xyz(v.min) || !xyz(v.max)) throw new Error(`ambientVolumes[${i}] needs min and max as [x, y, z]`);
  for (const k of ['factor', 'soft']) if (v[k] !== undefined && !Number.isFinite(v[k])) throw new Error(`ambientVolumes[${i}].${k} must be a number`);
}
// a dropped module's GPU objects (the shared proxy material stays)
const release = (root) => root.traverse((o) => {
  o.geometry?.dispose?.();
  for (const m of [].concat(o.material || [])) if (m !== proxyMat) m.dispose?.();
});
const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
export const colliderFor = (root) => (mesh) => {
  mesh.material = proxyMat; mesh.layers.set(LAYER.COLLIDE); mesh.castShadow = mesh.receiveShadow = false;
  mesh.userData.collider = true; root.add(mesh); return mesh;
};

function readConsumption(declaration) {
  if (declaration === undefined) return;
  if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration) ||
      Object.keys(declaration).some(key => key !== 'required' && key !== 'optional')) {
    throw new Error('consumes must be an object with required and/or optional lists');
  }
  const seen = new Set(), requests = [];
  for (const group of ['required', 'optional']) {
    if (!Object.hasOwn(declaration, group)) continue;
    const list = declaration[group];
    if (!Array.isArray(list)) throw new Error('consumes.' + group + ' must be an array');
    for (const key of list) {
      if (typeof key !== 'string' || !key.trim()) throw new Error('consumes.' + group + ' needs nonempty anchor names');
      if (seen.has(key)) throw new Error('duplicate anchor in consumes: ' + key);
      seen.add(key);
      requests.push({ key, required: group === 'required' });
    }
  }
  return requests;
}

export async function buildWorld(world, { plan, modules, shared = {}, log = console, slice = false } = {}) {
  plan = definePlan(plan);
  const report = { plan: plan.name, modules: [], failed: [], anchors: {}, ambientVolumes: [], ms: 0 };
  const built = {}, anchors = {}, live = [];
  const t0 = now();
  // time slicing (opt-in): yield to the frame once budgetMs of work has run since the last yield
  const sl = slice ? { budget: Math.max(0, slice.budgetMs ?? 8), wait: slice.yield || nextFrame, last: t0, yields: 0, longest: 0, lt: watchLongTasks() } : null;
  const breathe = async () => {
    if (!sl) return;
    const t = now(), ran = t - sl.last;
    if (ran < sl.budget) return;
    sl.longest = Math.max(sl.longest, ran);
    await sl.wait(); sl.yields++; sl.last = now();
  };

  const makeCtx = (m, root, updates) => {
    const R = rng(`${plan.seed}/${m.name}`);
    return {
      ...world.ctx, world, plan, shared, name: m.name, root, scene: root,
      R, rng: (sub) => (sub === undefined || sub === '' ? R : rng(`${plan.seed}/${m.name}/${sub}`)),
      anchors, modules: built,
      onUpdate: subscriber(updates),
      collider: colliderFor(root),
      log: (...a) => log.log(`[${m.name}]`, ...a),
    };
  };
  const fail = (m, phase, e) => {
    report.failed.push({ name: m.name, phase, error: String(e && e.message || e) });
    log.error(`[world] module "${m.name}" failed in ${phase} and was skipped: ${e && e.stack || e}`);
  };
  // a module's callbacks run only while it is alive: a finalize that throws stops the ones its build added
  // ctx.onUpdate returns an unsubscribe function that works before the module is committed (the callback is
  // withdrawn from the staged list) and after (the world's own unsubscribe)
  const subscriber = (updates) => (fn) => {
    const rec = { fn, off: null, dead: false };
    updates.push(rec);
    return () => { if (rec.dead) return; rec.dead = true; if (rec.off) rec.off(); else { const i = updates.indexOf(rec); if (i >= 0) updates.splice(i, 1); } };
  };
  const commit = (root, updates, alive) => { world.scene.add(root); for (const rec of updates) {
    const off = world.ctx.onUpdate((t) => alive.on && !rec.dead && rec.fn(t));
    rec.off = typeof off === 'function' ? off : () => {};   // a host world of its own may still return a count
    (alive.offs ||= []).push(rec.off);
  } };
  const seen = new Set();

  // ---- build, in order
  for (const entry of modules) {
    // a null or non-object entry (a conditional list) is skipped alone, like any other broken module
    const m = entry && typeof entry === 'object' ? entry : { name: String(entry) };
    const ts = now(), root = new THREE.Group(), updates = [];
    root.name = m.name;
    const row = { name: m.name, ok: false, ms: 0, tris: 0, anchors: {} };
    report.modules.push(row);
    try {
      if (!m.name || typeof m.build !== 'function') throw new Error('a module needs a name and build(ctx)');
      const ctx = makeCtx(m, root, updates);
      if (seen.has(m.name)) throw new Error(`another module is already called "${m.name}"`);
      seen.add(m.name);
      const requests = readConsumption(m.consumes);
      const out = (await m.build(ctx)) ?? {};
      const a = typeof m.anchors === 'function' ? m.anchors(ctx, out) : m.anchors;
      const v = typeof m.ambientVolumes === 'function' ? m.ambientVolumes(ctx, out) : m.ambientVolumes;
      // Stage the whole offer. A malformed later list or volume must not satisfy another module's contract.
      const offers = Object.entries(a || {}).map(([key, list]) => {
        if (!Array.isArray(list)) throw new Error('anchors.' + key + ' must be an array');
        return [key, list.map(entry => ({ ...entry, from: m.name }))];
      });
      if (v != null && !Array.isArray(v)) throw new Error('ambientVolumes must be an array');
      (v || []).forEach(checkVolume);
      const volumes = v ? v.map(entry => ({ ...entry, from: m.name })) : [];
      const alive = { on: true };
      commit(root, updates, alive);
      for (const [key, entries] of offers) {
        const prior = Object.hasOwn(anchors, key) ? anchors[key] : [];
        Object.defineProperty(anchors, key, { value: prior.concat(entries), enumerable: true, configurable: true, writable: true });
      }
      row.anchors = Object.fromEntries(offers.map(([key, entries]) => [key, entries.length]));
      report.ambientVolumes.push(...volumes);
      built[m.name] = out;
      live.push({ m, ctx, row, requests, root, alive, roots: [root] });
      row.ok = true;
    } catch (e) { fail(m, 'build', e); release(root); }
    row.ms = +(now() - ts).toFixed(1);
    await breathe();
  }
  // ---- finalize: every anchor is known now
  // a module whose finalize throws leaves the scene and its callbacks stop; anchors it offered were already visible
  // to the others. (Missing required anchors only skip the finalize: the build stays.)
  const drop = ({ m, roots, alive }) => {
    alive.on = false; delete built[m.name];
    for (const off of alive.offs || []) off();   // out of the world's list, not only silenced
    for (const r of roots) { world.scene.remove(r); release(r); }
    report.ambientVolumes = report.ambientVolumes.filter((v) => v.from !== m.name);   // nothing left to darken
  };
  for (const entry of live) {
    const { m, ctx, row, requests, alive } = entry;
    if (requests) {
      row.consumes = requests.map(request => ({
        ...request, count: Object.hasOwn(anchors, request.key) ? anchors[request.key].length : 0,
      }));
      const missing = row.consumes.filter(request => request.required && !request.count);
      if (missing.length) {
        fail(m, 'consumes', new Error('missing required anchors: ' + missing.map(request => request.key).join(', ')));
        row.ok = false;
        continue;
      }
    }
    if (typeof m.finalize !== 'function') continue;
    const ts = now(), root = new THREE.Group(), updates = [];
    root.name = m.name + ':finalize';
    try {
      await m.finalize({ ...ctx, root, scene: root, onUpdate: subscriber(updates), collider: colliderFor(root) });
      commit(root, updates, alive);
      entry.roots.push(root);
    } catch (e) { fail(m, 'finalize', e); row.ok = false; drop(entry); release(root); }
    row.ms = +(row.ms + now() - ts).toFixed(1);
    await breathe();
  }
  for (const { row, roots } of live) if (roots.every((r) => r.parent === world.scene)) row.tris = roots.reduce((s, o) => s + tris(o), 0);
  if (report.ambientVolumes.length && world.setAmbientVolumes) world.setAmbientVolumes(report.ambientVolumes);
  report.anchors = Object.fromEntries(Object.entries(anchors).map(([k, l]) => [k, l.length]));
  report.ms = +(now() - t0).toFixed(1);
  if (sl) {
    const lt = sl.lt.stop();
    report.slices = { yields: sl.yields, longestMs: +Math.max(sl.longest, now() - sl.last).toFixed(1),
      longModules: report.modules.filter((r) => r.ms > 50).map((r) => r.name), longTasks: { count: lt.count, totalMs: lt.totalMs, maxMs: lt.maxMs, source: lt.source } };
  }
  log.log(`[world] ${plan.name}: ${report.modules.filter((r) => r.ok).length}/${modules.length} modules in ${report.ms} ms` +
    (report.failed.length ? `; failed: ${report.failed.map((f) => `${f.name} (${f.phase})`).join(', ')}` : ''));
  return { plan, modules: built, anchors, report };
}
