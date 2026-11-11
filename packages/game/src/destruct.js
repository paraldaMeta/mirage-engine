// Mirage original code. Destructibles: props that crack, dent, shatter, spill, burn, fall and explode when shot.
// Opt-in: nothing is made until createDestructibles is called, and nothing is drawn or stepped until a prop breaks.
// Guide: docs/destructibles.md.
// ---------------------------------------------------------------------------
// const d = createDestructibles(g /* startGame's session, or setup's ctx */, { seed: 'level-1', vfx, lamps: world.lampPool });
// d.add({ id: 'pane-1', draw: mesh | { mesh: instanced, index } | { mesh: batched, id } | { mesh: merged, range: [first, count] },
//         material: 'glass', health, armour: { bullet: 1 }, value: 40, box | sphere | capsule (default: the drawn bounds),
//         solid, protected, group, tags, lamps: [poolIndex], lights: [PointLight], emissive, broken: 'pane' | 'crate' | 'dent' | 'tyre',
//         behave: { explosive, spillLiquid, ventSteam, sprayWater, dropLoot, alarm, fall, chain, burn }, mover: { shape },
//         onHit(e), onBreak(e) })
// const r = d.hit({ ray: { origin, dir, max }, kind: 'bullet', damage: 22, source })    r.item, r.point, r.normal, r.hits
// d.blast({ point, radius: 5, damage: 200, falloff: 'linear', occlusion: true })      every prop in reach, behind cover less
// d.actor({ id, draw: [{ mesh: batched, id }], pos, height })                        a bystander: collapses, 'casualty', 'panic'
// d.on('break' | 'hit' | 'casualty' | 'panic' | 'noise' | 'blast' | 'crush' | 'loot' | 'spill' | 'fire', fn)
// d.tally  { count, value, casualties, byClass, byTag }      d.snapshot() / d.restore(s) / d.reset()
// d.update(frameDt) (fixed steps + interpolation; startGame's session steps it for you)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { rng } from '@miragekit/core/rng';
import { DESTRUCT_MATERIALS, DESTRUCT_EFFECTS, DAMAGE_KINDS, addDestructSounds } from './destruct-data.js';
import { makeHandle, createDebris, createMarks, createBrokenPools, createMoverLayers, MARKS, BROKEN_STATES } from './destruct-draw.js';

export { DESTRUCT_MATERIALS, DESTRUCT_EFFECTS, DAMAGE_KINDS, DESTRUCT_SOUNDS, addDestructSounds, destructSoundFactories } from './destruct-data.js';
export { BROKEN_STATES, MARKS } from './destruct-draw.js';

const BEHAVIOURS = {
  explosive: { delay: 0.4, radius: 4, damage: 180, falloff: 'linear', occlusion: true, fx: 'blast', sound: 'dx_boom', scorch: true, noise: 40 },
  spillLiquid: { radius: 0.9, grow: 1.4, color: '#151a1d', slippery: true, conductive: false },
  ventSteam: { duration: 10, radius: 0.8, height: 2.6, density: 2.4, effect: 'steam', sound: 'dx_hiss' },
  sprayWater: { duration: 8, radius: 0.5, height: 1.6, density: 0.9, effect: 'water', sound: 'dx_hiss' },
  dropLoot: { chance: 1, table: [{ id: 'loot', weight: 1 }] },
  alarm: { radius: 30, duration: 8, on: 'hit', sound: 'dx_alarm' },
  fall: { damage: 60, radius: 0.9, bounce: 0.12 },
  chain: { delay: 0.09 },
  burn: { duration: 4, then: 'break', catch: ['blast', 'fire'], at: 0.5, fx: 'fire', sound: 'dx_fire' },
};
const PIERCING = { bullet: true, pellet: true };
const UP = [0, 1, 0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** target: startGame's session ({ game, physics, audio, root, world? }), setup's ctx, or {} for a bare registry.
 *  options: seed, hz (60), detail (1, quality 0..1), maxDebris (600), maxDecals (96), maxEmitters (8),
 *  maxSpawnPerStep (160), maxMovers (64), maxPierce (3), cell (4 m), root, world, vfx, audio (sounds: true adds them),
 *  physics, kit (createPhysicsKit: for `physics: true` pieces), lamps (world.lampPool or (index, k) => void),
 *  occluder ((from, dir, max) => { distance, point, normal } | null; default physics.ray without destructibles),
 *  floor (a number or (x, y, z) => y; default: a ray down), colliders ([{ min, max }] movers bounce off),
 *  materials / effects (overrides merged into the defaults), onBlast / onCrush / onNoise / onLoot (callbacks),
 *  attach (true: a game system steps it and its state is in the game's saves), id ('destructibles': the entity id) */
export function createDestructibles(target = {}, options = {}) {
  const game = target.game || (target.entities && target.tick ? target : null);
  const physics = options.physics ?? target.physics ?? null;
  const world = options.world ?? target.world ?? null;
  const audio = options.audio ?? target.audio ?? null;
  const vfx = options.vfx ?? null;
  const root = options.root ?? target.root ?? world?.scene ?? null;
  const hz = options.hz ?? 60, STEP = 1 / hz, seed = options.seed ?? 'destructibles';
  const cfg = { detail: options.detail ?? 1, maxDebris: options.maxDebris ?? 600, maxDecals: options.maxDecals ?? 96, maxEmitters: options.maxEmitters ?? 8,
    maxSpawnPerStep: options.maxSpawnPerStep ?? 160, maxMovers: options.maxMovers ?? 64, maxPierce: options.maxPierce ?? 3, maxSounds: options.maxSounds ?? 6, maxFx: options.maxFx ?? 12, gravity: options.gravity ?? 9.81 };
  const CS = options.cell ?? 4;
  const materials = {};
  for (const [k, v] of Object.entries(DESTRUCT_MATERIALS)) materials[k] = mergeClass(v, options.materials?.[k]);
  for (const [k, v] of Object.entries(options.materials || {})) if (!materials[k]) materials[k] = mergeClass(DESTRUCT_MATERIALS.plastic, v);
  const effects = { ...DESTRUCT_EFFECTS, ...(options.effects || {}) };
  let lampsAdapter = options.lamps ?? world?.lampPool ?? null;
  const lampScale = (i, k) => { if (!lampsAdapter) return; if (typeof lampsAdapter === 'function') lampsAdapter(i, k); else if (lampsAdapter.scale) lampsAdapter.scale(i, k); };
  if (options.sounds !== false && audio && audio.add) addDestructSounds(audio);

  // ---- state
  const items = [], byId = new Map(), listeners = new Map();
  let R = rng(seed + ':0'), fxR = rng(seed + ':fx'), time = 0, steps = 0, acc = 0, alpha = 1, disposed = false;
  const tally = { count: 0, value: 0, casualties: 0, byClass: {}, byTag: {} };
  const stats = { items: 0, broken: 0, debris: 0, marks: 0, emitters: 0, movers: 0, timers: 0, stepMs: 0, hits: 0, blasts: 0, spawnDropped: 0 };
  // per-step budgets (the step refills them; hits between steps draw on what the last step left)
  let spawnBudget = cfg.maxSpawnPerStep, soundBudget = cfg.maxSounds, fxBudget = cfg.maxFx;
  const debris = root ? createDebris(root, { max: cfg.maxDebris }) : createDebris(new THREE.Group(), { max: cfg.maxDebris });
  const marks = createMarks(root || new THREE.Group(), { max: cfg.maxDecals });
  const brokenPools = createBrokenPools(root || new THREE.Group());
  const layers = createMoverLayers(cfg.maxMovers);
  const scratchI = new Int32Array(Math.max(cfg.maxDecals, 64));

  // ---- events
  function on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type)?.delete(fn) ?? false; }
  function emit(type, e) { const L = listeners.get(type); if (L) for (const fn of L) fn(e, api); }

  // ---- the spatial grid (hash of cells; huge props in one list tested by every query)
  const grid = new Map(), big = [];
  let stamp = 1;
  const seen = [];
  const key = (x, y, z) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
  function cellsOf(it, fn) {
    const a = it.aabb, x0 = Math.floor(a[0] / CS), y0 = Math.floor(a[1] / CS), z0 = Math.floor(a[2] / CS), x1 = Math.floor(a[3] / CS), y1 = Math.floor(a[4] / CS), z1 = Math.floor(a[5] / CS);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64) return false;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) fn(key(x, y, z));
    return true;
  }
  function insert(it) {
    it.cellKey = [];
    const ok = cellsOf(it, (k) => { let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(it.index); it.cellKey.push(k); });
    if (!ok) { it.big = true; big.push(it.index); }
  }
  function unlink(it) {
    if (it.big) { swapOut(big, it.index); it.big = false; return; }
    for (const k of it.cellKey) { const b = grid.get(k); if (b) swapOut(b, it.index); }
    it.cellKey.length = 0;
  }
  function swapOut(arr, v) { const i = arr.indexOf(v); if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.length--; } }
  function regrid(it) {
    computeAabb(it);
    const a = it.aabb, k = key(Math.floor(a[0] / CS), Math.floor(a[1] / CS), Math.floor(a[2] / CS)) ^ key(Math.floor(a[3] / CS), Math.floor(a[4] / CS), Math.floor(a[5] / CS));
    if (k === it.gridSig) return;
    it.gridSig = k; unlink(it); insert(it);
  }

  // ---- volumes: 0 box (c, u, h), 1 sphere (c, r), 2 capsule (a, b, r)
  function computeAabb(it) {
    const v = it.vol, a = it.aabb;
    if (v.type === 0) for (let k = 0; k < 3; k++) { const e = Math.abs(v.u[k]) * v.h[0] + Math.abs(v.u[3 + k]) * v.h[1] + Math.abs(v.u[6 + k]) * v.h[2]; a[k] = v.c[k] - e; a[3 + k] = v.c[k] + e; }
    else if (v.type === 1) for (let k = 0; k < 3; k++) { a[k] = v.c[k] - v.r; a[3 + k] = v.c[k] + v.r; }
    else for (let k = 0; k < 3; k++) { a[k] = Math.min(v.a[k], v.b[k]) - v.r; a[3 + k] = Math.max(v.a[k], v.b[k]) + v.r; }
  }
  const _o = [0, 0, 0], _d = [0, 0, 0], _n = [0, 0, 0], _cp = [0, 0, 0];
  /** ray against a volume: t of entry (or -1), exit in hitExit, normal in out */
  let hitExit = 0;
  function rayVol(v, o, d, nOut) {
    if (v.type === 0) {
      let tmin = -Infinity, tmax = Infinity, ax = 0, sg = 1;
      for (let j = 0; j < 3; j++) {
        const u0 = v.u[j * 3], u1 = v.u[j * 3 + 1], u2 = v.u[j * 3 + 2];
        const lo = (o[0] - v.c[0]) * u0 + (o[1] - v.c[1]) * u1 + (o[2] - v.c[2]) * u2, ld = d[0] * u0 + d[1] * u1 + d[2] * u2, h = v.h[j];
        if (Math.abs(ld) < 1e-9) { if (lo < -h || lo > h) return -1; continue; }
        let t1 = (-h - lo) / ld, t2 = (h - lo) / ld, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; ax = j; sg = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax || tmax < 0) return -1;
      }
      hitExit = tmax;
      if (tmin < 0) { nOut[0] = -d[0]; nOut[1] = -d[1]; nOut[2] = -d[2]; return 0; }
      nOut[0] = v.u[ax * 3] * sg; nOut[1] = v.u[ax * 3 + 1] * sg; nOut[2] = v.u[ax * 3 + 2] * sg;
      return tmin;
    }
    if (v.type === 1) {
      const ox = o[0] - v.c[0], oy = o[1] - v.c[1], oz = o[2] - v.c[2], b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - v.r * v.r, h = b * b - c;
      if (h < 0) return -1;
      const s = Math.sqrt(h); let t = -b - s; hitExit = -b + s;
      if (hitExit < 0) return -1;
      if (t < 0) t = 0;
      for (let k = 0; k < 3; k++) nOut[k] = (o[k] + d[k] * t - v.c[k]) / v.r;
      return t;
    }
    // capsule (Inigo Quilez's capIntersect)
    const ba0 = v.b[0] - v.a[0], ba1 = v.b[1] - v.a[1], ba2 = v.b[2] - v.a[2], oa0 = o[0] - v.a[0], oa1 = o[1] - v.a[1], oa2 = o[2] - v.a[2];
    const baba = ba0 * ba0 + ba1 * ba1 + ba2 * ba2, bard = ba0 * d[0] + ba1 * d[1] + ba2 * d[2], baoa = ba0 * oa0 + ba1 * oa1 + ba2 * oa2;
    const rdoa = d[0] * oa0 + d[1] * oa1 + d[2] * oa2, oaoa = oa0 * oa0 + oa1 * oa1 + oa2 * oa2;
    const A = baba - bard * bard; let B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - v.r * v.r * baba, h = B * B - A * C, t = -1;
    if (h >= 0 && A > 1e-12) { const tt = (-B - Math.sqrt(h)) / A, y = baoa + tt * bard; if (y > 0 && y < baba) t = tt; }
    if (t < 0) {   // not through the side: the nearer of the two end spheres
      for (let s = 0; s < 2; s++) {
        const e = s ? v.b : v.a, ox = o[0] - e[0], oy = o[1] - e[1], oz = o[2] - e[2];
        B = ox * d[0] + oy * d[1] + oz * d[2]; C = ox * ox + oy * oy + oz * oz - v.r * v.r; h = B * B - C;
        if (h >= 0 && -B + Math.sqrt(h) >= 0) { const tt = Math.max(0, -B - Math.sqrt(h)); if (t < 0 || tt < t) t = tt; }
      }
      if (t < 0) return -1;
    }
    hitExit = t + v.r * 2;
    const p0 = o[0] + d[0] * t, p1 = o[1] + d[1] * t, p2 = o[2] + d[2] * t;
    closestOnSeg(v.a, v.b, p0, p1, p2, _cp);
    const nx = p0 - _cp[0], ny = p1 - _cp[1], nz = p2 - _cp[2], L = Math.hypot(nx, ny, nz) || 1;
    nOut[0] = nx / L; nOut[1] = ny / L; nOut[2] = nz / L;
    return t;
  }
  function closestOnSeg(a, b, x, y, z, out) {
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], L = bx * bx + by * by + bz * bz;
    const t = L > 1e-12 ? Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / L)) : 0;
    out[0] = a[0] + bx * t; out[1] = a[1] + by * t; out[2] = a[2] + bz * t;
    return out;
  }
  /** distance from p to a volume (0 inside); the closest point in out */
  function distVol(v, p, out) {
    if (v.type === 0) {
      for (let k = 0; k < 3; k++) out[k] = v.c[k];
      for (let j = 0; j < 3; j++) {
        const u0 = v.u[j * 3], u1 = v.u[j * 3 + 1], u2 = v.u[j * 3 + 2];
        const l = Math.max(-v.h[j], Math.min(v.h[j], (p[0] - v.c[0]) * u0 + (p[1] - v.c[1]) * u1 + (p[2] - v.c[2]) * u2));
        out[0] += u0 * l; out[1] += u1 * l; out[2] += u2 * l;
      }
      return Math.hypot(p[0] - out[0], p[1] - out[1], p[2] - out[2]);
    }
    const c = v.type === 1 ? v.c : closestOnSeg(v.a, v.b, p[0], p[1], p[2], out);
    const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2], L = Math.hypot(dx, dy, dz);
    if (L <= v.r) { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return 0; }
    out[0] = c[0] + dx / L * v.r; out[1] = c[1] + dy / L * v.r; out[2] = c[2] + dz / L * v.r;
    return L - v.r;
  }
  const centreOf = (it) => (it.vol.type === 2 ? [(it.vol.a[0] + it.vol.b[0]) / 2, (it.vol.a[1] + it.vol.b[1]) / 2, (it.vol.a[2] + it.vol.b[2]) / 2] : it.vol.c);

  // ---- ray queries: every unbroken prop along a ray, nearest first (into a reused buffer)
  const CAND = 64, candT = new Float64Array(CAND), candX = new Float64Array(CAND), candI = new Int32Array(CAND), candN = new Float64Array(CAND * 3);
  let candCount = 0;
  function testItem(i, o, d, max) {
    if (seen[i] === stamp) return; seen[i] = stamp;
    const it = items[i];
    if (it.broken && !it.mover?.active) return;
    if (it.broken && it.fallen) return;
    const t = rayVol(it.vol, o, d, _n);
    if (t < 0 || t > max) return;
    // insertion into the sorted buffer
    let j = Math.min(candCount, CAND - 1);
    if (candCount === CAND && t >= candT[CAND - 1]) return;
    while (j > 0 && candT[j - 1] > t) { candT[j] = candT[j - 1]; candX[j] = candX[j - 1]; candI[j] = candI[j - 1]; candN[j * 3] = candN[j * 3 - 3]; candN[j * 3 + 1] = candN[j * 3 - 2]; candN[j * 3 + 2] = candN[j * 3 - 1]; j--; }
    candT[j] = t; candX[j] = hitExit; candI[j] = i; candN[j * 3] = _n[0]; candN[j * 3 + 1] = _n[1]; candN[j * 3 + 2] = _n[2];
    if (candCount < CAND) candCount++;
  }
  function castAll(o, d, max) {
    candCount = 0; stamp++;
    for (let k = 0; k < big.length; k++) testItem(big[k], o, d, max);
    if (!grid.size) return candCount;
    // Amanatides-Woo through the cells
    let x = Math.floor(o[0] / CS), y = Math.floor(o[1] / CS), z = Math.floor(o[2] / CS);
    const sx = d[0] > 0 ? 1 : -1, sy = d[1] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    const dx = Math.abs(d[0]) > 1e-12 ? CS / Math.abs(d[0]) : Infinity, dy = Math.abs(d[1]) > 1e-12 ? CS / Math.abs(d[1]) : Infinity, dz = Math.abs(d[2]) > 1e-12 ? CS / Math.abs(d[2]) : Infinity;
    const nb = (p, c, s, dd) => (Math.abs(dd) < 1e-12 ? Infinity : ((s > 0 ? (c + 1) * CS : c * CS) - p) / dd);
    let tx = nb(o[0], x, sx, d[0]), ty = nb(o[1], y, sy, d[1]), tz = nb(o[2], z, sz, d[2]), t = 0;
    for (let guard = 0; guard < 4096 && t <= max; guard++) {
      const b = grid.get(key(x, y, z));
      if (b) for (let k = 0; k < b.length; k++) testItem(b[k], o, d, max);
      if (tx < ty && tx < tz) { t = tx; tx += dx; x += sx; } else if (ty < tz) { t = ty; ty += dy; y += sy; } else { t = tz; tz += dz; z += sz; }
      if (candCount && candT[0] < t - CS * 2) break;   // nothing nearer can come after the first hit's cells
    }
    return candCount;
  }
  /** the nearest unbroken prop on a ray (no damage): { item, t, point, normal } (a reused object) or null */
  const rayOut = { item: null, t: 0, point: [0, 0, 0], normal: [0, 0, 0] };
  function ray(origin, dir, max = 100) {
    norm3(dir, _d);
    if (!castAll(origin, _d, max)) return null;
    rayOut.item = items[candI[0]]; rayOut.t = candT[0];
    for (let k = 0; k < 3; k++) { rayOut.point[k] = origin[k] + _d[k] * candT[0]; rayOut.normal[k] = candN[k]; }
    return rayOut;
  }
  function norm3(v, out) { const L = Math.hypot(v[0], v[1], v[2]) || 1; out[0] = v[0] / L; out[1] = v[1] / L; out[2] = v[2] / L; return out; }

  // ---- the world in the way: the occluder (physics.ray that steps over the destructibles' own colliders)
  const occluder = options.occluder !== undefined ? options.occluder : physics ? (from, dir, max) => {
    let o = from, left = max, travelled = 0;
    for (let k = 0; k < 6; k++) {
      const h = physics.ray(o, dir, left);
      if (!h) return null;
      if (h.object?.userData?.destructible == null) { if (travelled) { h.distance += travelled; } return h; }
      const step = h.distance + 0.01; travelled += step; left -= step; if (left <= 0) return null;
      o = [o[0] + dir[0] * step, o[1] + dir[1] * step, o[2] + dir[2] * step];
    }
    return null;
  } : null;
  const floorAt = (x, y, z) => {
    if (typeof options.floor === 'number') return options.floor;
    if (typeof options.floor === 'function') return options.floor(x, y, z);
    if (occluder) { const h = occluder([x, y + 0.05, z], [0, -1, 0], 60); if (h) return h.point ? h.point[1] : y + 0.05 - h.distance; }
    return 0;
  };

  // ---- registration
  function mergeClass(base, over) {
    if (!over) return base;
    return { ...base, ...over, armour: { ...base.armour, ...(over.armour || {}) }, debris: over.debris === false ? false : { ...base.debris, ...(over.debris || {}) }, fx: { ...base.fx, ...(over.fx || {}) } };
  }
  function behaviours(spec, mat) {
    const out = {}, src = { ...(mat.behave || {}), ...(spec.behave || {}) };
    for (const [k, v] of Object.entries(src)) {
      if (!v) continue;
      if (!BEHAVIOURS[k]) throw new Error(`destructibles: no behaviour "${k}" (known: ${Object.keys(BEHAVIOURS).join(', ')})`);
      out[k] = { ...BEHAVIOURS[k], ...(v === true ? {} : v) };
    }
    return out;
  }
  const _obb = { c: [0, 0, 0], u: [1, 0, 0, 0, 1, 0, 0, 0, 1], h: [0.5, 0.5, 0.5] };
  function volumeOf(spec, handle) {
    if (spec.sphere) return { type: 1, c: spec.sphere.center.slice(), r: spec.sphere.radius };
    if (spec.capsule) return { type: 2, a: spec.capsule.a.slice(), b: spec.capsule.b.slice(), r: spec.capsule.radius };
    const v = { type: 0, c: [0, 0, 0], u: [1, 0, 0, 0, 1, 0, 0, 0, 1], h: [0.5, 0.5, 0.5] };
    if (spec.box) {
      const b = spec.box;
      if (b.min) { for (let k = 0; k < 3; k++) { v.c[k] = (b.min[k] + b.max[k]) / 2; v.h[k] = Math.max(1e-3, (b.max[k] - b.min[k]) / 2); } }
      else { v.c = b.center.slice(); v.h = b.half.slice(); }
      const q = b.quaternion ? new THREE.Quaternion(...b.quaternion) : b.yaw ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw) : null;
      if (q) { const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements; v.u = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; }
      return v;
    }
    if (handle.box(_obb)) { v.c = _obb.c.slice(); v.u = _obb.u.slice(); v.h = _obb.h.slice(); return v; }
    throw new Error(`destructibles: "${spec.id}" has no volume (give box, sphere or capsule, or a draw with geometry)`);
  }
  /** register a breakable; returns its record (also d.get(id)) */
  function add(spec) {
    if (disposed) throw new Error('destructibles: disposed');
    const cls = spec.material || 'plastic', mat0 = materials[cls];
    if (!mat0) throw new Error(`destructibles: no material class "${cls}" (known: ${Object.keys(materials).join(', ')})`);
    const mat = spec.armour || spec.pierce != null || spec.stages || spec.debris !== undefined || spec.fx || spec.sound ? mergeClass(mat0, { armour: spec.armour, pierce: spec.pierce ?? mat0.pierce, stages: spec.stages ?? mat0.stages, debris: spec.debris, fx: spec.fx, sound: spec.sound ?? mat0.sound }) : mat0;
    const index = items.length, id = spec.id != null ? String(spec.id) : 'd' + index;
    if (byId.has(id)) throw new Error(`destructibles: id "${id}" is taken`);
    const handle = makeHandle(spec.draw);
    const vol = volumeOf({ ...spec, id }, handle);
    const health = spec.health ?? mat.health;
    const it = { id, index, cls, mat, spec, handle, vol, aabb: new Float64Array(6), cellKey: [], gridSig: 0, big: false,
      health, max: health, stage: 0, broken: false, protected: !!spec.protected, value: spec.value ?? mat.value, group: spec.group ?? null, tags: spec.tags || [],
      behave: behaviours(spec, mat), lamps: spec.lamps || [], lights: (spec.lights || []).map((l) => ({ light: l, i: l.intensity })), emissive: emissiveOf(spec.emissive),
      brokenKind: spec.broken !== undefined ? spec.broken : defaultBroken(cls, vol), brokenTicket: null, stateTicket: null, solidHandle: -1,
      mover: null, actor: null, fallen: false, burning: null, alarmed: false, flicker: 0, flickerEnd: 0, flickerFinal: 1, lastHit: null,
      onHit: spec.onHit || null, onBreak: spec.onBreak || null, chainIndex: spec.behave?.chain?.index ?? null };
    if (spec.mover) it.mover = moverOf(it, spec.mover);
    items.push(it); byId.set(id, it); seen.push(0);
    computeAabb(it); insert(it);
    if (spec.solid) makeSolid(it);
    else if (options.sensors) makeSolid(it, true);
    stats.items = items.length;
    return it;
  }
  function defaultBroken(cls, v) {
    if (cls === 'glass' && v.type === 0) { const s = [...v.h].sort((a, b) => a - b); return s[0] < 0.08 * s[2] ? 'pane' : null; }
    if (cls === 'thinMetal' || cls === 'heavyMetal') return v.type === 0 ? 'dent' : null;
    return null;
  }
  function emissiveOf(e) {
    if (!e) return [];
    return [].concat(e).map((x) => {
      if (x.isMaterial) return x.emissive ? { mat: x, i: x.emissiveIntensity } : { mat: x, col: x.color.clone() };
      if (x.mesh) return { mesh: x.mesh, at: x.index ?? x.id, col: (() => { const c = new THREE.Color(1, 1, 1); if (x.mesh.instanceColor || x.mesh.isBatchedMesh) { try { x.mesh.getColorAt(x.index ?? x.id, c); } catch { /* no colours */ } } return c; })() };
      throw new Error('destructibles: emissive takes materials or { mesh, index | id }');
    });
  }
  function setEmissive(it, k) {
    for (const e of it.emissive) {
      if (e.mat) { if (e.col) e.mat.color.copy(e.col).multiplyScalar(k); else e.mat.emissiveIntensity = e.i * k; }
      else { e.mesh.setColorAt(e.at, _col.copy(e.col).multiplyScalar(k)); if (e.mesh.instanceColor) e.mesh.instanceColor.needsUpdate = true; }
    }
  }
  const _col = new THREE.Color();
  function setLamps(it, k) {
    for (const i of it.lamps) lampScale(i, k);
    for (const l of it.lights) l.light.intensity = l.i * k;
    setEmissive(it, k);
  }

  // ---- solid props: a fixed Rapier cuboid the character bumps into (gone when it breaks)
  const _q3 = new THREE.Quaternion(), _m3 = new THREE.Matrix4();
  function makeSolid(it, sensor = false) {
    if (!physics || !physics.R || it.vol.type !== 0) return;
    const R3 = physics.R, v = it.vol;
    _m3.set(v.u[0], v.u[3], v.u[6], 0, v.u[1], v.u[4], v.u[7], 0, v.u[2], v.u[5], v.u[8], 0, 0, 0, 0, 1); _q3.setFromRotationMatrix(_m3);
    let desc = R3.ColliderDesc.cuboid(v.h[0], v.h[1], v.h[2]).setTranslation(v.c[0], v.c[1], v.c[2]).setRotation({ x: _q3.x, y: _q3.y, z: _q3.z, w: _q3.w });
    if (sensor) desc = desc.setSensor(true);
    const c = physics.world.createCollider(desc);
    it.solidHandle = c.handle;
    const obj = it.handle.object || { name: 'destructible:' + it.id, userData: {}, material: it.handle.material };
    if (!obj.userData) obj.userData = {};
    obj.userData.destructible = it.id;
    physics.info.set(c.handle, { surface: it.spec.surface || it.cls, object: obj, destructible: it });
  }
  function dropSolid(it) {
    if (it.solidHandle < 0 || !physics) return;
    const c = physics.world.getCollider(it.solidHandle);
    if (c) physics.world.removeCollider(c, true);
    physics.info.delete(it.solidHandle); it.solidHandle = -1;
  }
  /** the prop a Rapier collider belongs to (a hit of physics.ray / kit.ray on a solid or sensor prop), or null */
  const fromCollider = (h) => physics?.info.get(typeof h === 'number' ? h : h?.handle)?.destructible ?? null;

  // ---- feedback: particles, sounds (rate-limited per step; the cosmetic draws come from their own stream)
  const burstO = { direction: [0, 1, 0], scale: 1 }, fxAt = [0, 0, 0];
  function fx(name, at, dir, scale = 1) {
    if (!vfx || !name || fxBudget <= 0 || cfg.detail <= 0.05) return;
    const e = effects[name]; if (!e) return;
    fxBudget--;
    fxAt[0] = at[0]; fxAt[1] = at[1]; fxAt[2] = at[2];
    burstO.direction = dir || UP; burstO.scale = scale;
    vfx.burst(e, fxAt, burstO);
  }
  function sound(name, at, gain = 1) {
    if (!audio || !audio.play || soundBudget <= 0) return;
    soundBudget--;
    audio.play(name, { at, gain, rate: 0.92 + 0.16 * fxR.float(), ref: 3 });
  }
  const emitters = [];
  function emitter(name, at, dir, until, it) {
    if (!vfx || !effects[name]) return null;
    if (emitters.length >= cfg.maxEmitters) { const o = emitters.shift(); o.h.stop(); o.loop?.src?.stop?.(); }
    const h = vfx.spawn(effects[name], { position: at, direction: dir });
    const e = { h, until, it, loop: null };
    emitters.push(e); stats.emitters = emitters.length;
    return e;
  }

  // ---- damage
  const hitEv = { item: null, damage: 0, kind: '', point: null, normal: null, dir: null, source: null, stage: 0, broke: false };
  function armourOf(it, kind) { const a = it.mat.armour[kind]; return a == null ? 1 : a; }
  /** deal damage to one prop; returns the damage taken (after armour) */
  function damage(it, amount, kind, point, normal, dir, source) {
    if (it.broken || amount <= 0) return 0;
    const dealt = amount * armourOf(it, kind);
    stats.hits++;
    const P = point || centreOf(it), N = normal || UP, D = dir || [-N[0], -N[1], -N[2]];
    // impact feedback even on what does not give (protected, armoured)
    if (kind !== 'emp' && kind !== 'fire') { fx(it.mat.fx?.hit, P, N, 0.8); if (it.mat.hitSound) sound('dx_hit_' + it.mat.hitSound, P, 0.6); }
    if (it.mover && (it.mover.spec.breakable === false || dealt < it.health) && kind !== 'emp' && kind !== 'fire') knock(it, D, P, amount);
    hitEv.item = it; hitEv.damage = it.protected ? 0 : dealt; hitEv.kind = kind; hitEv.point = P; hitEv.normal = N; hitEv.dir = D; hitEv.source = source; hitEv.broke = false;
    if (it.protected || dealt <= 0) { hitEv.stage = it.stage; it.onHit?.(hitEv, api); emit('hit', hitEv); return 0; }
    if (it.mover && it.mover.spec.breakable === false) { hitEv.stage = it.stage; it.onHit?.(hitEv, api); emit('hit', hitEv); return dealt; }
    it.health -= dealt;
    it.lastHit = { kind, point: P.slice ? P.slice() : [...P], dir: [D[0], D[1], D[2]], source };
    const ratio = Math.min(1, 1 - it.health / it.max), st = it.mat.stages || [];
    while (it.stage < st.length && st[it.stage].at <= ratio + 1e-9) stageUp(it, st[it.stage], P, N);
    // the current mark at the hit: a new hole per hit, or the growing crack
    const cur = currentMark(it);
    if (cur) markHit(it, cur, P, N, ratio);
    if (it.mat.stages?.some((s) => s.fx && s.at <= ratio)) fx(it.mat.stages.find((s) => s.fx && s.at <= ratio).fx, P, N, 0.7);
    hitEv.stage = it.stage;
    it.onHit?.(hitEv, api); emit('hit', hitEv);
    const b = it.behave;
    if (b.alarm && b.alarm.on === 'hit' && !it.alarmed) alarm(it, b.alarm, P);
    if (b.burn && !it.burning && (b.burn.catch.includes(kind) || ratio >= b.burn.at) && it.health > 0) ignite(it, b.burn);
    if (it.health <= 0) breakItem(it, kind, P, D, source);
    return dealt;
  }
  function currentMark(it) { const st = it.mat.stages || []; for (let k = it.stage - 1; k >= 0; k--) if (st[k].mark) return st[k]; return null; }
  function markHit(it, s, P, N, ratio) {
    if (cfg.detail <= 0) return;
    const M = MARKS[s.mark] || MARKS.hole, cap = Math.max(4, Math.round(cfg.maxDecals * Math.max(0.25, cfg.detail)));
    if (s.grow) {
      // one crack per hit place, every crack of the prop grows with the damage (never past the prop's face)
      const v = it.vol, face = v.type === 0 ? Math.min(...[...v.h].sort((a, b) => b - a).slice(0, 2)) * 2 : (v.r || 0.2) * 2;
      const sz = Math.min(face * 0.95, M.size * (0.35 + 1.4 * ratio) * Math.max(0.5, Math.min(2, face)));
      const n = marks.of(it.index, scratchI);
      for (let k = 0; k < n; k++) marks.resize(scratchI[k], sz, sz);
      if (n < 4) marks.add(s.mark, P, N, [sz, sz], it.index, fxR.float() * 6.283, s.color, s.opacity, cap);
      return;
    }
    const sz = M.size * (0.8 + 0.4 * fxR.float());
    marks.add(s.mark, P, N, [sz, sz * (s.mark === 'splinter' ? 0.5 : 1)], it.index, fxR.float() * 6.283, s.color, s.opacity, cap);
  }
  function stageUp(it, s, P, N) {
    it.stage++;
    if (s.flicker) flicker(it, 0.7, 1);
    if (s.state && BROKEN_STATES[s.state] && !it.stateTicket && !it.mover && !it.actor && !it.behave.fall) { it.stateTicket = showBroken(it, s.state); it.stateKind = s.state; if (it.stateTicket) it.handle.hide(); }
    emit('stage', { item: it, stage: it.stage });
  }
  function flicker(it, dur, final) {
    if (!it.lamps.length && !it.lights.length && !it.emissive.length) return;
    it.flicker = 1; it.flickerEnd = time + dur; it.flickerFinal = final;
    if (!flickering.includes(it)) flickering.push(it);
  }
  const flickering = [];

  // ---- breaking
  const _mb = new THREE.Matrix4(), _pv = new THREE.Vector3(), _sv = new THREE.Vector3(), _qv = new THREE.Quaternion();
  function obbMatrix(it, out, thinToZ) {
    const v = it.vol;
    if (v.type !== 0) { const c = centreOf(it), r = v.r; return out.compose(_pv.set(c[0], c[1], c[2]), _qv.identity(), _sv.set(r * 2, r * 2, r * 2)); }
    let ax = [0, 1, 2];
    if (thinToZ) { const t = v.h.indexOf(Math.min(...v.h)); ax = t === 0 ? [1, 2, 0] : t === 1 ? [2, 0, 1] : [0, 1, 2]; }
    const U = (j) => [v.u[ax[j] * 3], v.u[ax[j] * 3 + 1], v.u[ax[j] * 3 + 2]];
    const a = U(0), b = U(1), c = U(2), s = [v.h[ax[0]] * 2, v.h[ax[1]] * 2, v.h[ax[2]] * 2];
    out.set(a[0] * s[0], b[0] * s[1], c[0] * s[2], v.c[0], a[1] * s[0], b[1] * s[1], c[1] * s[2], v.c[1], a[2] * s[0], b[2] * s[1], c[2] * s[2], v.c[2], 0, 0, 0, 1);
    return out;
  }
  function showBroken(it, kind) {
    if (!root || !kind) return null;
    if (kind.isObject3D) { kind.visible = true; return { obj: kind }; }
    if (typeof kind === 'function') { const o = kind(it); if (o) { if (!o.parent) root.add(o); o.visible = true; return { obj: o }; } return null; }
    if (!BROKEN_STATES[kind]) return null;
    const material = it.spec.brokenMaterial ?? (kind === 'pane' ? (it.handle.material?.transparent ? it.handle.material : null) : it.handle.material);
    return brokenPools.show(kind, material, obbMatrix(it, _mb, kind === 'pane'));
  }
  function hideBroken(t) { if (!t) return; if (t.obj) t.obj.visible = false; else brokenPools.hide(t); }
  const breakEv = () => ({ item: null, id: '', class: '', value: 0, tags: null, point: null, dir: null, kind: '', source: null, time: 0 });
  function breakItem(it, kind = 'bullet', point = null, dir = null, source = null, quiet = false) {
    if (it.broken || it.protected) return false;
    it.broken = true; it.health = Math.min(it.health, 0);
    const P = point || centreOf(it), D = dir || [0, -1, 0];
    marks.removeOwner(it.index);
    const b = it.behave;
    if (b.fall && !it.actor) startFall(it, b.fall, quiet);
    else if (!it.actor) {
      it.handle.hide();
      if (it.mover?.active) parkMover(it);
      const k = it.brokenKind;
      if (k && it.stateTicket && it.stateKind === k) { it.brokenTicket = it.stateTicket; it.stateTicket = null; }   // the dent it had is how it stays
      else if (k) { const t = showBroken(it, k); if (t) { hideBroken(it.stateTicket); it.stateTicket = null; it.brokenTicket = t; } }
    }
    dropSolid(it);
    if (it.burning) { it.burning.h?.stop(); it.burning = null; }
    if (b.burn || it.lamps.length || it.lights.length || it.emissive.length) { if ((it.spec.lampMode || 'off') === 'flicker' && !quiet) flicker(it, 0.8, 0); else setLamps(it, 0); }
    if (it.actor) collapse(it, D, quiet);
    // tally
    tally.count++; tally.value += it.value;
    const bc = tally.byClass[it.cls] || (tally.byClass[it.cls] = { count: 0, value: 0 }); bc.count++; bc.value += it.value;
    for (const t of it.tags) { const bt = tally.byTag[t] || (tally.byTag[t] = { count: 0, value: 0 }); bt.count++; bt.value += it.value; }
    if (it.actor) tally.casualties++;
    stats.broken++;
    if (quiet) { persistentAfterBreak(it); return true; }
    // debris, particles, sound
    if (it.mat.debris && !it.actor && cfg.detail > 0) spawnDebris(it, P, D);
    fx(it.mat.fx?.break, centreOf(it), D, 1);
    sound('dx_break_' + (it.spec.sound ?? it.mat.sound), centreOf(it), 1);
    if (it.spec.physics && options.kit) bodies(it, D);
    const e = breakEv(); e.item = it; e.id = it.id; e.class = it.cls; e.value = it.value; e.tags = it.tags; e.point = P; e.dir = D; e.kind = kind; e.source = source; e.time = time;
    it.onBreak?.(e, api);
    emit('break', e);
    if (it.actor) { emit('casualty', e); panic(it, P, source); }
    const noise = it.spec.noise ?? (it.cls === 'glass' ? 18 : it.cls === 'heavyMetal' || it.cls === 'thinMetal' ? 14 : 8);
    if (noise > 0) noiseAt(P, noise, it, 'break');
    // behaviours
    if (b.explosive) timer(b.explosive.delay, 1, it);
    if (b.spillLiquid) spill(it, b.spillLiquid, false);
    if (b.ventSteam) vent(it, b.ventSteam, P, it.lastHit ? [-it.lastHit.dir[0], -it.lastHit.dir[1], -it.lastHit.dir[2]] : UP, false);
    if (b.sprayWater) vent(it, b.sprayWater, P, it.lastHit ? [-it.lastHit.dir[0], -it.lastHit.dir[1], -it.lastHit.dir[2]] : UP, false);
    if (b.dropLoot) loot(it, b.dropLoot);
    if (b.alarm && !it.alarmed) alarm(it, b.alarm, P);
    if (b.chain) chainNext(it, b.chain);
    return true;
  }
  function persistentAfterBreak(it) {
    const b = it.behave;
    if (b.spillLiquid) spill(it, b.spillLiquid, true);
    if (b.ventSteam && !b.ventSteam.duration) vent(it, b.ventSteam, centreOf(it), UP, true);
  }
  const _ext = [0, 0, 0], _at = [0, 0, 0];
  function spawnDebris(it, P, D) {
    const d = it.mat.debris, a = it.aabb;
    const size = Math.max(a[3] - a[0], a[4] - a[1], a[5] - a[2]), area = it.vol.type === 0 ? 4 * (Math.max(it.vol.h[0] * it.vol.h[1], it.vol.h[1] * it.vol.h[2], it.vol.h[0] * it.vol.h[2])) : size * size;
    let n = Math.round(d.count * cfg.detail * Math.max(0.3, Math.min(2.5, Math.sqrt(area / 0.5))));
    n = Math.max(cfg.detail > 0 ? 1 : 0, n);
    const cap = Math.max(8, Math.round(cfg.maxDebris * Math.max(0.25, cfg.detail)));
    const c = centreOf(it);
    for (let k = 0; k < 3; k++) { _ext[k] = (a[3 + k] - a[k]) * 0.4; _at[k] = c[k]; }
    const flo = it.floorY ?? (it.floorY = floorAt(c[0], a[1] + 0.02, c[2]));
    const scale = Math.max(0.5, Math.min(1.6, size / 0.6));
    for (let k = 0; k < n; k++) {
      if (spawnBudget <= 0) { stats.spawnDropped += n - k; break; }
      spawnBudget--;
      debris.spawn(d, _at, _ext, D, R.next, flo, scale, cap);
    }
  }
  const bodyList = [];
  function bodies(it, D) {
    const kit = options.kit, n = Math.min(2, (options.maxBodies ?? 8) - bodyList.length);
    if (n <= 0) return;
    const c = centreOf(it), h = it.vol.type === 0 ? it.vol.h : [it.vol.r, it.vol.r, it.vol.r];
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(h[0] * 0.9, h[1] * 0.5, h[2] * 0.9), it.handle.material || new THREE.MeshStandardMaterial({ color: 0x806040 }));
      m.position.set(c[0] + (k - 0.5) * h[0], c[1], c[2]); m.userData.collide = false; root?.add(m);
      const body = kit.rigid(m, { type: 'dynamic', shape: 'box', mass: 6 });
      body.impulse?.([D[0] * 8, 6, D[2] * 8]);
      bodyList.push({ m, body, until: time + 8 });
    }
  }

  // ---- behaviours
  const timers = [];
  let timerSeq = 0;
  function timer(delay, kind, it, a = null) {
    const t = { at: time + delay, seq: timerSeq++, kind, it, a };
    let i = timers.length; timers.push(t);
    while (i > 0 && (timers[i - 1].at > t.at)) { timers[i] = timers[i - 1]; i--; }
    timers[i] = t; stats.timers = timers.length;
  }
  function runTimer(t) {
    const it = t.it;
    if (t.kind === 1) {   // explode
      const e = it.behave.explosive, c = centreOf(it);
      fx(e.fx, c, UP, 1); sound(e.sound, c, 1.2);
      if (e.scorch) { const fl = it.floorY ?? floorAt(c[0], it.aabb[1] + 0.02, c[2]); marks.add('scorch', [c[0], fl + 0.01, c[2]], UP, [e.radius * 0.7, e.radius * 0.7], -1, fxR.float() * 6.283, null, 0.9); }
      blast({ point: c, radius: e.radius, damage: e.damage, falloff: e.falloff, occlusion: e.occlusion, source: it, kind: 'blast' });
      if (e.noise) noiseAt(c, e.noise, it, 'blast');
    } else if (t.kind === 2) {   // a chain neighbour goes
      if (!it.broken) { const c = centreOf(it); breakItem(it, 'bullet', c, UP, t.a); }
    } else if (t.kind === 3) {   // burnt out
      if (it.burning) { it.burning.h?.stop(); it.burning = null; }
      if (!it.broken) { if (it.behave.burn.then === 'explode' && !it.behave.explosive) it.behave.explosive = { ...BEHAVIOURS.explosive }; breakItem(it, 'fire', centreOf(it), UP, null); }
    } else if (t.kind === 4) {   // an alarm stops
      it.alarmed = false; if (it.alarmLoop) { try { it.alarmLoop.src?.stop(); } catch { /* ended */ } it.alarmLoop = null; }
    }
  }
  function alarm(it, a, P) {
    it.alarmed = true;
    noiseAt(P, a.radius, it, 'alarm');
    if (audio?.loop && a.sound) { try { it.alarmLoop = audio.loop(a.sound, { at: centreOf(it), bus: 'sfx', gain: 0.7 }); } catch { it.alarmLoop = null; } }
    if (a.duration > 0) timer(a.duration, 4, it);
    flicker(it, a.duration || 2, it.broken ? 0 : 1);
  }
  function noiseAt(point, radius, it, kind) { const e = { point, radius, item: it, kind }; options.onNoise?.(e); emit('noise', e); }
  function ignite(it, b) {
    const c = centreOf(it);
    it.burning = emitter(b.fx, [c[0], it.aabb[4], c[2]], UP, time + b.duration, it) || { h: null };
    emit('fire', { item: it, point: c, duration: b.duration });
    timer(b.duration, 3, it);
  }
  const puddles = [];
  function spill(it, s, full) {
    const c = centreOf(it), fl = it.floorY ?? (it.floorY = floorAt(c[0], it.aabb[1] + 0.02, c[2]));
    const pd = { item: it, c: [c[0], fl, c[2]], r: full ? s.radius : 0.05, rMax: s.radius, grow: s.grow, slippery: s.slippery, conductive: s.conductive, liquid: s.liquid || it.spec.liquid || 'water', mark: -1, seq: 0 };
    pd.mark = marks.add('puddle', [pd.c[0], fl + 0.005, pd.c[2]], UP, [pd.r * 2, pd.r * 2], -2 - puddles.length, fxR.float() * 6.283, s.color, null, cfg.maxDecals);
    puddles.push(pd);
    if (!full) { fx('splash', c, UP, 1); emit('spill', { item: it, point: pd.c, radius: s.radius, slippery: s.slippery, conductive: s.conductive }); }
  }
  const occluders = [];
  function vent(it, s, P, dir, quiet) {
    const L = Math.hypot(dir[0], dir[1], dir[2]) || 1, D = [dir[0] / L, dir[1] / L, dir[2] / L];
    const e = emitter(s.effect, P, D, s.duration > 0 ? time + s.duration : Infinity, it);
    const top = [P[0] + (D[0] * 0.4 + 0) * s.height, P[1] + (Math.max(D[1], 0.3) + 0.6) * s.height * 0.6, P[2] + D[2] * 0.4 * s.height];
    const oc = { a: P.slice ? P.slice() : [...P], b: top, r: s.radius, density: s.density, until: s.duration > 0 ? time + s.duration : Infinity, item: it, e };
    occluders.push(oc);
    if (!quiet && audio?.loop && s.sound) { try { oc.loop = audio.loop(s.sound, { at: P, bus: 'sfx', gain: 0.5 }); } catch { oc.loop = null; } }
    if (!quiet) emit(s.effect === 'water' ? 'water' : 'steam', { item: it, point: P, dir: D, duration: s.duration });
  }
  function loot(it, l) {
    if (R.float() > l.chance) return;
    const tot = l.table.reduce((s, x) => s + (x.weight ?? 1), 0);
    let r = R.float() * tot, pick = l.table[0];
    for (const x of l.table) { r -= x.weight ?? 1; if (r <= 0) { pick = x; break; } }
    const e = { item: it, point: centreOf(it).slice ? centreOf(it).slice() : [...centreOf(it)], loot: pick };
    options.onLoot?.(e); emit('loot', e);
  }
  function chainNext(it, c) {
    const g = it.group; if (g == null) return;
    const mine = it.chainIndex ?? it.index;
    // the nearest unbroken neighbour on each side in the group's order
    let lo = null, hi = null;
    for (const o of items) {
      if (o === it || o.group !== g || o.broken || !o.behave.chain) continue;
      const k = o.chainIndex ?? o.index;
      if (k < mine && (!lo || k > (lo.chainIndex ?? lo.index))) lo = o;
      if (k > mine && (!hi || k < (hi.chainIndex ?? hi.index))) hi = o;
    }
    for (const o of [lo, hi]) if (o && !timers.some((t) => t.kind === 2 && t.it === o)) timer(c.delay, 2, o, it);
  }

  // ---- blasts
  const blastRes = [];
  let blastDepth = 0;
  const _bp = [0, 0, 0], _dir = [0, 0, 0];
  function falloffK(f, x) {
    if (typeof f === 'function') return f(x);
    if (f === 'none') return 1;
    if (f === 'square') return (1 - x) * (1 - x);
    if (typeof f === 'number') return Math.max(0, 1 - Math.pow(x, f));
    return 1 - x;
  }
  /** what is left of a blast at `to` from `from` (0..1): solid world in between stops it (occludedK), a blocking
   *  prop (heavy metal) cuts it to a quarter. Games use it for their own entities so props and enemies agree. */
  function cover(from, to, ignore = null, occludedK = options.occludedBlast ?? 0) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], d = Math.hypot(dx, dy, dz);
    if (d < 0.05) return 1;
    _dir[0] = dx / d; _dir[1] = dy / d; _dir[2] = dz / d;
    if (occluder) { const h = occluder(from, _dir, d); if (h && h.distance < d - 0.12) return occludedK; }
    let k = 1;
    const n = castAll(from, _dir, d - 0.05);
    for (let j = 0; j < n; j++) { const o = items[candI[j]]; if (o !== ignore && o.mat.blocks && !o.broken) k *= 0.25; }
    return k;
  }
  /** a blast: { point, radius, damage, falloff ('linear' | 'square' | 'none' | exponent | fn(x 0..1)), occlusion (true),
   *  kind ('blast'), source, min (0: the least share at the rim) }. Returns [{ item, damage, distance, cover }] */
  function blast(o) {
    const P = o.point, r = o.radius ?? 4, dmg = o.damage ?? 100, kind = o.kind || 'blast', occl = o.occlusion !== false, mn = o.min ?? 0;
    stats.blasts++;
    const res = blastRes[blastDepth] || (blastRes[blastDepth] = []); res.length = 0;
    blastDepth++;
    try {
      stamp++;
      const list = [];
      const visit = (i) => { if (seen[i] === stamp) return; seen[i] = stamp; const it = items[i]; if (!it.broken || it.mover?.active) list.push(it); };
      for (const i of big) visit(i);
      const x0 = Math.floor((P[0] - r) / CS), x1 = Math.floor((P[0] + r) / CS), y0 = Math.floor((P[1] - r) / CS), y1 = Math.floor((P[1] + r) / CS), z0 = Math.floor((P[2] - r) / CS), z1 = Math.floor((P[2] + r) / CS);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const b = grid.get(key(x, y, z)); if (b) for (const i of b) visit(i); }
      list.sort((a, b) => a.index - b.index);
      for (const it of list) {
        if (it === o.source) continue;
        const d = distVol(it.vol, P, _bp);
        if (d > r) continue;
        const k = Math.max(mn, falloffK(o.falloff ?? 'linear', Math.min(1, d / r)));
        const cv = occl ? cover(P, _bp, it) : 1;
        const amount = dmg * k * cv;
        const dl = Math.max(d, 1e-3), dir = [(_bp[0] - P[0]) / dl, (_bp[1] - P[1]) / dl, (_bp[2] - P[2]) / dl];
        if (d < 1e-3) { dir[0] = 0; dir[1] = 1; dir[2] = 0; }
        if (it.mover && amount > 0) { const m = it.mover; wake(it); const j = amount * 0.05 / m.mass; m.v[0] += dir[0] * j; m.v[1] += (dir[1] + 0.6) * j; m.v[2] += dir[2] * j; m.w[0] += (fxR.float() - 0.5) * j * 4; m.w[2] += (fxR.float() - 0.5) * j * 4; }
        const took = amount > 0 ? damage(it, amount, kind, [_bp[0], _bp[1], _bp[2]], [-dir[0], -dir[1], -dir[2]], dir, o.source ?? null) : 0;
        res.push({ item: it, damage: took, distance: d, cover: cv });
      }
      const e = { point: P, radius: r, damage: dmg, falloff: o.falloff ?? 'linear', kind, source: o.source ?? null, hits: res.length, cover: (to) => cover(P, to, null) };
      options.onBlast?.(e, api); emit('blast', e);
    } finally { blastDepth--; }
    return res;
  }

  // ---- hits
  const hitRecs = Array.from({ length: 8 }, () => ({ item: null, id: '', t: 0, point: [0, 0, 0], normal: [0, 0, 0], damage: 0, broke: false, class: '' }));
  const ordI = new Int32Array(CAND), ordT = new Float64Array(CAND), ordN = new Float64Array(CAND * 3);
  let hitDepth = 0;
  const hitRes = { item: null, t: 0, point: [0, 0, 0], normal: [0, 0, 0], hits: [], count: 0, stopped: 'none', world: null, left: 0 };
  /** one hit: { ray: { origin, dir, max } } (the props along it, nearest first, thin ones let the bullet through with
   *  less damage; the world stops it unless `occlude: false`), { point, normal } (the prop there), or { item } (a prop
   *  or its id). kind (DAMAGE_KINDS), damage, source, pierce (true). Returns a reused result: item (the first prop
   *  hit or null), t, point, normal, hits [{ item, id, t, point, normal, damage, broke, class }], count, stopped
   *  ('world' | 'item' | 'none'), world (the occluder's hit), left (damage left at the end). */
  function hit(o) {
    const kind = o.kind || 'bullet';
    let dmg = o.damage ?? 20;
    hitRes.item = null; hitRes.count = 0; hitRes.hits.length = 0; hitRes.stopped = 'none'; hitRes.world = null;
    if (o.item != null) {
      const it = typeof o.item === 'string' ? byId.get(o.item) : o.item;
      if (it) record(it, 0, o.point || centreOf(it), o.normal || UP, damage(it, dmg, kind, o.point, o.normal, o.dir, o.source ?? null));
      hitRes.left = 0;
      return hitRes;
    }
    if (o.point && !o.ray) {
      let best = null, bd = o.radius ?? 0.05;
      stamp++;
      const P = o.point, x = Math.floor(P[0] / CS), y = Math.floor(P[1] / CS), z = Math.floor(P[2] / CS);
      const check = (i) => { if (seen[i] === stamp) return; seen[i] = stamp; const it = items[i]; if (it.broken) return; const d = distVol(it.vol, P, _bp); if (d <= bd) { bd = d; best = it; } };
      for (const i of big) check(i);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const bk = grid.get(key(x + a, y + b, z + c)); if (bk) for (const i of bk) check(i); }
      if (best) record(best, 0, P, o.normal || UP, damage(best, dmg, kind, P, o.normal, o.dir, o.source ?? null));
      hitRes.left = 0;
      return hitRes;
    }
    const rr = o.ray, origin = rr.origin || rr.from;
    norm3(rr.dir, _o);
    const D = [_o[0], _o[1], _o[2]];
    let max = rr.max ?? 100;
    if (o.occlude !== false && occluder) { const w = occluder(origin, D, max); if (w) { hitRes.world = w; max = w.distance + 0.02; } }
    const n = castAll(origin, D, max);
    // copy out: damage can break props, and a callback may hit again
    const oI = hitDepth ? new Int32Array(n) : ordI, oT = hitDepth ? new Float64Array(n) : ordT, oN = hitDepth ? new Float64Array(n * 3) : ordN;
    for (let j = 0; j < n; j++) { oI[j] = candI[j]; oT[j] = candT[j]; oN[j * 3] = candN[j * 3]; oN[j * 3 + 1] = candN[j * 3 + 1]; oN[j * 3 + 2] = candN[j * 3 + 2]; }
    let layers = 0;
    hitDepth++;
    try { for (let j = 0; j < n; j++) {
      const i = oI[j], t = oT[j], nx = oN[j * 3], ny = oN[j * 3 + 1], nz = oN[j * 3 + 2];
      const it = items[i];
      if (it.broken && !it.mover?.active) continue;
      const P = [origin[0] + D[0] * t, origin[1] + D[1] * t, origin[2] + D[2] * t], N = [nx, ny, nz];
      const took = damage(it, dmg, kind, P, N, D, o.source ?? null);
      record(it, t, P, N, took);
      layers++;
      const pierce = it.mat.pierce || 0;
      if (o.pierce === false || !PIERCING[kind] || pierce <= 0 || layers >= cfg.maxPierce) { hitRes.stopped = 'item'; dmg = 0; break; }
      dmg *= pierce;
    } } finally { hitDepth--; }
    if (hitRes.stopped !== 'item' && hitRes.world) hitRes.stopped = 'world';
    hitRes.left = dmg;
    return hitRes;
  }
  function record(it, t, P, N, took) {
    const k = hitRes.count;
    if (k < hitRecs.length) {
      const r = hitRecs[k]; r.item = it; r.id = it.id; r.t = t; r.point[0] = P[0]; r.point[1] = P[1]; r.point[2] = P[2]; r.normal[0] = N[0]; r.normal[1] = N[1]; r.normal[2] = N[2];
      r.damage = took; r.broke = it.broken; r.class = it.cls; hitRes.hits.push(r);
    }
    if (!k) { hitRes.item = it; hitRes.t = t; for (let c = 0; c < 3; c++) { hitRes.point[c] = P[c]; hitRes.normal[c] = N[c]; } }
    hitRes.count++;
  }

  // ---- movers: loose props knocked about by a cheap kinematic step (no rigid bodies), asleep when still
  function moverOf(it, m) {
    const v = it.vol, cyl = (m.shape || 'cylinder') === 'cylinder';
    const h = v.type === 0 ? v.h : [v.r, v.r, v.r];
    return { spec: { breakable: true, reinstance: true, ...m }, cyl, r: m.radius ?? Math.max(h[0], h[2]), hh: m.height != null ? m.height / 2 : h[1], mass: m.mass ?? 0.4, bounce: m.bounce ?? 0.3, friction: m.friction ?? 0.6,
      active: false, p: [0, 0, 0], v: [0, 0, 0], q: new THREE.Quaternion(), w: [0, 0, 0], po: [0, 0, 0], qo: new THREE.Quaternion(), still: 0, floor: 0, ticket: null,
      origin: null, offset: null, u0: v.type === 0 ? v.u.slice() : [1, 0, 0, 0, 1, 0, 0, 0, 1], c0: centreOf(it).slice ? centreOf(it).slice() : [...centreOf(it)], fall: null, landed: false };
  }
  const moving = [];
  const _bm = new THREE.Matrix4(), _dm = new THREE.Matrix4(), _wv = new THREE.Vector3(), _wq = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
  function drawMatrix(it, out) {
    const h = it.handle;
    if (h.kind === 'object') { h.object.updateWorldMatrix(true, false); return out.copy(h.object.matrixWorld); }
    if (h.kind === 'instance' || h.kind === 'batched') { h.mesh.updateWorldMatrix(true, false); h.matrix(out); return out.premultiply(h.mesh.matrixWorld); }
    return null;
  }
  function wake(it) {
    const m = it.mover;
    if (m.active) { m.still = 0; return true; }
    if (moving.length >= cfg.maxMovers) return false;
    const h = it.handle;
    if (!m.origin) {
      const M = drawMatrix(it, new THREE.Matrix4());
      if (!M) return false;   // a merged range cannot move: give it an Object3D or an instance
      m.origin = M;
      // the body frame: the volume's centre and axes; the drawn thing hangs off it by `offset`
      const v = it.vol, B = new THREE.Matrix4().set(v.u[0], v.u[3], v.u[6], v.c[0], v.u[1], v.u[4], v.u[7], v.c[1], v.u[2], v.u[5], v.u[8], v.c[2], 0, 0, 0, 1);
      m.offset = B.clone().invert().multiply(M);
      m.q.setFromRotationMatrix(B); m.p = v.c.slice();
    }
    if (h.kind === 'instance') { m.ticket = layers.take(h.mesh, h.index); if (!m.ticket) return false; h.hide(); }
    m.active = true; m.still = 0; m.landed = false; m.po = m.p.slice(); m.qo.copy(m.q);
    m.floor = floorAt(m.p[0], it.aabb[1] + 0.05, m.p[2]);
    moving.push(it); stats.movers = moving.length;
    return true;
  }
  function knock(it, D, P, amount) {
    if (!wake(it)) return;
    const m = it.mover, j = Math.min(8, amount * 0.06 / m.mass);
    m.v[0] += D[0] * j; m.v[1] += D[1] * j + j * 0.25; m.v[2] += D[2] * j;
    // spin from where it was hit: r x J
    const rx = P[0] - m.p[0], ry = P[1] - m.p[1], rz = P[2] - m.p[2], s = 3 / Math.max(0.05, m.r + m.hh);
    m.w[0] += (ry * D[2] - rz * D[1]) * j * s; m.w[1] += (rz * D[0] - rx * D[2]) * j * s; m.w[2] += (rx * D[1] - ry * D[0]) * j * s;
  }
  function startFall(it, f) {
    if (!it.mover) it.mover = moverOf(it, { shape: 'box', mass: 8, bounce: f.bounce, breakable: false, reinstance: false });
    it.mover.fall = f; it.fallen = true;
    if (!wake(it)) { it.handle.hide(); return; }
  }
  function parkMover(it) {
    const m = it.mover; m.active = false;
    swapOut(moving, it); stats.movers = moving.length;
    if (m.ticket) { layers.give(m.ticket); m.ticket = null; }
  }
  const up3 = new THREE.Vector3(0, 1, 0), _ax = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
  function stepMover(it, dt) {
    const m = it.mover, g = cfg.gravity;
    m.po[0] = m.p[0]; m.po[1] = m.p[1]; m.po[2] = m.p[2]; m.qo.copy(m.q);
    m.v[1] -= g * dt;
    for (let k = 0; k < 3; k++) m.p[k] += m.v[k] * dt;
    const wl = Math.hypot(m.w[0], m.w[1], m.w[2]);
    if (wl > 1e-5) { _qa.setFromAxisAngle(_ax.set(m.w[0] / wl, m.w[1] / wl, m.w[2] / wl), wl * dt); m.q.premultiply(_qa).normalize(); }
    // the lowest point over the floor
    const a = _ax.set(0, 1, 0).applyQuaternion(m.q), ay = Math.abs(a.y);
    const low = m.cyl ? ay * m.hh + Math.sqrt(Math.max(0, 1 - ay * ay)) * m.r : lowBox(m);
    // the floor under it again now and then (it may roll off a shelf)
    if ((occluder || typeof options.floor === 'function') && (steps + it.index) % 4 === 0) m.floor = floorAt(m.p[0], m.p[1] - low + 0.03, m.p[2]);
    const pen = m.floor - (m.p[1] - low);
    if (pen > 0) {
      m.p[1] += pen;
      const vy = m.v[1];
      if (vy < 0) m.v[1] = vy < -1 ? -vy * m.bounce : 0;
      if (m.fall && !m.landed && vy < -1.5) land(it, -vy);
      const f = Math.max(0, 1 - (m.cyl && ay < 0.35 ? 0.8 : 6 * m.friction) * dt);
      if (m.cyl && ay < 0.35) {
        // lying on its side: rolls about its axis, slides less along it, and settles flat
        const along = m.v[0] * a.x + m.v[2] * a.z;
        m.v[0] -= a.x * along * Math.min(1, 6 * dt); m.v[2] -= a.z * along * Math.min(1, 6 * dt);
        m.v[0] *= f; m.v[2] *= f;
        // rolling without slipping about its axis: w = a ((up x v) . a) / r
        const roll = (m.v[2] * a.x - m.v[0] * a.z) / Math.max(m.r, 0.01);
        m.w[0] = a.x * roll; m.w[1] = a.y * roll; m.w[2] = a.z * roll;
        _wv.set(a.x, 0, a.z).normalize(); _qb.setFromUnitVectors(_na.copy(a), _wv); m.q.premultiply(_qa.identity().slerp(_qb, Math.min(1, 10 * dt)));
      } else {
        m.v[0] *= f; m.v[2] *= f;
        for (let k = 0; k < 3; k++) m.w[k] *= Math.max(0, 1 - 5 * dt);
        if (m.cyl && ay < 0.97) {
          // tipping: past ~20 degrees it goes over, under it rights itself
          _wv.set(a.x, 0, a.z).normalize();
          const over = ay < 0.94 ? 1 : -1, tilt = _ax.crossVectors(up3, _wv).normalize();
          for (let k = 0; k < 3; k++) m.w[k] += tilt.getComponent(k) * over * 14 * dt;
        } else if (!m.cyl) { const nearest = nearestAxisUp(m.q); _qb.setFromUnitVectors(nearest, up3); m.q.premultiply(_qa.identity().slerp(_qb, Math.min(1, 8 * dt))); }
      }
    }
    collideMover(it);
    const sp = Math.abs(m.v[0]) + Math.abs(m.v[1]) + Math.abs(m.v[2]), sw = Math.abs(m.w[0]) + Math.abs(m.w[1]) + Math.abs(m.w[2]);
    m.still = pen > -0.01 && sp < 0.12 && sw < 0.8 ? m.still + dt : 0;
    if (m.p[1] < m.floor - 20) m.still = 1;
    // the volume follows (hits find it where it is)
    const e = _bm.makeRotationFromQuaternion(m.q).elements, v = it.vol;
    if (v.type === 0) { for (let k = 0; k < 3; k++) v.c[k] = m.p[k]; for (let j = 0; j < 3; j++) { v.u[j * 3] = e[j * 4]; v.u[j * 3 + 1] = e[j * 4 + 1]; v.u[j * 3 + 2] = e[j * 4 + 2]; } }
    regrid(it);
    if (m.still > 0.4) sleep(it);
  }
  function lowBox(m) { const e = _dm.makeRotationFromQuaternion(m.q).elements, h = [m.r, m.hh, m.r]; return Math.abs(e[1]) * h[0] + Math.abs(e[5]) * h[1] + Math.abs(e[9]) * h[2]; }
  const _na = new THREE.Vector3();
  function nearestAxisUp(q) {
    let best = 0, bv = -1; const e = _dm.makeRotationFromQuaternion(q).elements;
    for (let j = 0; j < 3; j++) { const y = Math.abs(e[j * 4 + 1]); if (y > bv) { bv = y; best = j; } }
    _na.set(e[best * 4], e[best * 4 + 1], e[best * 4 + 2]); if (_na.y < 0) _na.negate();
    return _na;
  }
  function collideMover(it) {
    const m = it.mover, list = Array.isArray(options.colliders) ? options.colliders : null;
    const push = (mn, mx) => {
      const r = Math.max(m.r, 0.02);
      if (m.p[0] + r < mn[0] || m.p[0] - r > mx[0] || m.p[1] + m.hh < mn[1] || m.p[1] - m.hh > mx[1] || m.p[2] + r < mn[2] || m.p[2] - r > mx[2]) return;
      const dx0 = m.p[0] + r - mn[0], dx1 = mx[0] - (m.p[0] - r), dz0 = m.p[2] + r - mn[2], dz1 = mx[2] - (m.p[2] - r), dy1 = mx[1] - (m.p[1] - m.hh);
      const best = Math.min(dx0, dx1, dz0, dz1, dy1);
      if (best === dy1 && m.v[1] <= 0) { m.p[1] += dy1; m.v[1] = 0; m.floor = Math.max(m.floor, mx[1]); }
      else if (best === dx0) { m.p[0] -= dx0; m.v[0] = -Math.abs(m.v[0]) * m.bounce; } else if (best === dx1) { m.p[0] += dx1; m.v[0] = Math.abs(m.v[0]) * m.bounce; }
      else if (best === dz0) { m.p[2] -= dz0; m.v[2] = -Math.abs(m.v[2]) * m.bounce; } else { m.p[2] += dz1; m.v[2] = Math.abs(m.v[2]) * m.bounce; }
    };
    if (list) for (const c of list) push(c.min, c.max);
    for (const o of items) if (o !== it && o.spec.solid && !o.broken) push([o.aabb[0], o.aabb[1], o.aabb[2]], [o.aabb[3], o.aabb[4], o.aabb[5]]);
  }
  function land(it, speed) {
    const m = it.mover, f = m.fall; m.landed = true;
    const P = [m.p[0], m.floor + 0.02, m.p[2]];
    fx('dust', P, UP, 1.4); sound('dx_break_' + (it.mat.sound === 'glass' ? 'metal' : it.mat.sound), P, 1);
    sound('dx_hit_thud', P, 1);
    const dmg = f.damage * Math.min(1.5, speed / 5);
    const res = blast({ point: P, radius: f.radius, damage: dmg, falloff: 'none', occlusion: false, kind: 'melee', source: it });
    const e = { item: it, point: P, radius: f.radius, damage: dmg, hits: res.length };
    options.onCrush?.(e, api); emit('crush', e);
    noiseAt(P, 16, it, 'crush');
  }
  function sleep(it) {
    const m = it.mover; m.v[0] = m.v[1] = m.v[2] = 0; m.w[0] = m.w[1] = m.w[2] = 0;
    m.po = m.p.slice(); m.qo.copy(m.q);
    placeDraw(it, 1);
    m.active = false; swapOut(moving, it); stats.movers = moving.length;
    const h = it.handle;
    if (h.kind === 'instance' && m.ticket) {
      if (m.spec.reinstance && !it.broken) { drawWorld(it, 1, _dm); h.setMatrix(_bm.copy(h.mesh.matrixWorld).invert().multiply(_dm)); h.show(); layers.give(m.ticket); m.ticket = null; }
    }
  }
  function drawWorld(it, a, out) {
    const m = it.mover;
    _wv.set(m.po[0] + (m.p[0] - m.po[0]) * a, m.po[1] + (m.p[1] - m.po[1]) * a, m.po[2] + (m.p[2] - m.po[2]) * a);
    _wq.copy(m.qo).slerp(m.q, a);
    return out.compose(_wv, _wq, _one).multiply(m.offset);
  }
  function placeDraw(it, a) {
    const m = it.mover, h = it.handle;
    drawWorld(it, a, _dm);
    if (h.kind === 'object') {
      const o = h.object; o.parent?.updateWorldMatrix(true, false);
      const L = o.parent ? _bm.copy(o.parent.matrixWorld).invert().multiply(_dm) : _dm;
      L.decompose(o.position, o.quaternion, o.scale);
    } else if (h.kind === 'instance' && m.ticket) layers.set(m.ticket, _dm);
    else if (h.kind === 'batched') h.setMatrix(_bm.copy(h.mesh.matrixWorld).invert().multiply(_dm));
  }
  function resetMover(it) {
    const m = it.mover; if (!m) return;
    if (m.active) parkMover(it);
    if (m.ticket) { layers.give(m.ticket); m.ticket = null; }
    if (m.origin) {
      const h = it.handle;
      if (h.kind === 'object') { const o = h.object; o.parent?.updateWorldMatrix(true, false); (o.parent ? _bm.copy(o.parent.matrixWorld).invert().multiply(m.origin) : _bm.copy(m.origin)).decompose(o.position, o.quaternion, o.scale); }
      else if (h.kind === 'instance') h.setMatrix(_bm.copy(h.mesh.matrixWorld).invert().multiply(m.origin));
      else if (h.kind === 'batched') h.setMatrix(_bm.copy(h.mesh.matrixWorld).invert().multiply(m.origin));
      // the body back to where it was registered
      const B = _dm.copy(m.origin).multiply(_bm.copy(m.offset).invert());
      B.decompose(_wv, m.q, _sv); m.p = [_wv.x, _wv.y, _wv.z];
    }
    for (let k = 0; k < 3; k++) { m.v[k] = 0; m.w[k] = 0; it.vol.c[k] = m.c0[k] ?? it.vol.c[k]; }
    if (it.vol.type === 0) for (let k = 0; k < 9; k++) it.vol.u[k] = m.u0[k];
    m.fall = null; m.landed = false; it.fallen = false;
    regrid(it);
  }

  // ---- actors: bystanders that collapse (a pose blend to a slump), with 'casualty' and 'panic'
  /** a simple non-combat actor: { id, draw (an Object3D, [{ mesh: BatchedMesh, id }], ...), parts ([{ draw, lag }]:
   *  the pieces of the slump, head last), pos, height (1.7), radius (0.35), health, material ('actor'), tags (['civilian']),
   *  panicRadius (12), collapse(item, k 0..1, dir) to pose it yourself, onPanic(item, from), value } */
  function actor(spec) {
    const pos = spec.pos || [0, 0, 0], H = spec.height ?? 1.7, r = spec.radius ?? 0.35;
    const it = add({ ...spec, material: spec.material || 'actor', tags: spec.tags || ['civilian'], value: spec.value ?? 0,
      capsule: { a: [pos[0], pos[1] + r, pos[2]], b: [pos[0], pos[1] + H - r, pos[2]], radius: r } });
    const parts = (spec.parts || [].concat(spec.draw || []).map((d, i, all) => ({ draw: d, lag: all.length > 1 ? i / all.length * 0.35 : 0 }))).map((p) => ({ handle: makeHandle(p.draw), lag: p.lag ?? 0, base: new THREE.Matrix4(), has: false }));
    it.actor = { pos: pos.slice(), H, r, parts, k: 0, active: false, dir: [0, 0, 1], panicRadius: spec.panicRadius ?? 12, collapse: spec.collapse || null, onPanic: spec.onPanic || null };
    return it;
  }
  /** move an actor (or any prop with a capsule / sphere) to pos; yaw is kept for your own drawing */
  function place(id, pos) {
    const it = typeof id === 'string' ? byId.get(id) : id; if (!it) return;
    const v = it.vol;
    if (it.actor) { it.actor.pos = pos.slice(); }
    if (v.type === 2) { const H = it.actor?.H ?? (v.b[1] - v.a[1] + 2 * v.r); v.a = [pos[0], pos[1] + v.r, pos[2]]; v.b = [pos[0], pos[1] + H - v.r, pos[2]]; }
    else { const c = v.c, dx = pos[0] - c[0], dy = pos[1] - c[1], dz = pos[2] - c[2]; c[0] += dx; c[1] += dy; c[2] += dz; }
    regrid(it);
  }
  const collapsing = [];
  function collapse(it, D, quiet) {
    const A = it.actor;
    const L = Math.hypot(D[0], D[2]); A.dir = L > 1e-6 ? [D[0] / L, 0, D[2] / L] : [0, 0, -1];   // straight down (a restore): it falls back
    for (const p of A.parts) { const h = p.handle; if (h.kind === 'object') { h.object.updateWorldMatrix(true, false); p.base.copy(h.object.matrixWorld); p.has = true; } else if (h.matrix) { h.mesh.updateWorldMatrix(true, false); h.matrix(p.base).premultiply(h.mesh.matrixWorld); p.has = true; } }
    A.k = quiet ? 1 : 0; A.active = true;
    if (!collapsing.includes(it)) collapsing.push(it);
    if (!quiet) fx('shorted', [A.pos[0], A.pos[1] + A.H * 0.75, A.pos[2]], UP, 0.8);
    poseActor(it);
  }
  const _pa = new THREE.Vector3(), _pq = new THREE.Quaternion(), _pt = new THREE.Matrix4(), _pm = new THREE.Matrix4();
  function poseActor(it) {
    const A = it.actor, k = A.k;
    if (A.collapse) { A.collapse(it, k, A.dir); return; }
    // fall away from the shot: a rotation about the feet across the shot's direction, the top parts later
    _pa.set(A.dir[2], 0, -A.dir[0]).normalize();
    for (const p of A.parts) {
      if (!p.has) continue;
      const e = smooth(Math.max(0, Math.min(1, (k - p.lag) / (1 - p.lag))));
      _pq.setFromAxisAngle(_pa, e * 1.38);
      _pt.makeTranslation(A.pos[0], A.pos[1] - 0.05 * e, A.pos[2]).multiply(_pm.makeRotationFromQuaternion(_pq)).multiply(_bm.makeTranslation(-A.pos[0], -A.pos[1], -A.pos[2]));
      _dm.multiplyMatrices(_pt, p.base);
      const h = p.handle;
      if (h.kind === 'object') { const o = h.object; o.parent?.updateWorldMatrix(true, false); (o.parent ? _bm.copy(o.parent.matrixWorld).invert().multiply(_dm) : _dm).decompose(o.position, o.quaternion, o.scale); }
      else if (h.setMatrix) h.setMatrix(_bm.copy(h.mesh.matrixWorld).invert().multiply(_dm));
    }
  }
  const smooth = (x) => x * x * (3 - 2 * x);
  function panic(it, from, source) {
    for (const o of items) {
      if (o === it || !o.actor || o.broken) continue;
      const p = o.actor.pos, d = Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]);
      if (d > it.actor.panicRadius) continue;
      const e = { item: o, id: o.id, from, distance: d, source, cause: it };
      o.actor.onPanic?.(o, from, e); emit('panic', e);
    }
  }
  function unpose(it) {
    const A = it.actor; if (!A) return;
    for (const p of A.parts) {
      if (!p.has) continue;
      const h = p.handle;
      if (h.kind === 'object') { const o = h.object; o.parent?.updateWorldMatrix(true, false); (o.parent ? _bm.copy(o.parent.matrixWorld).invert().multiply(p.base) : _bm.copy(p.base)).decompose(o.position, o.quaternion, o.scale); }
      else if (h.setMatrix) h.setMatrix(_bm.copy(h.mesh.matrixWorld).invert().multiply(p.base));
      p.has = false;
    }
    A.k = 0; A.active = false;
  }

  // ---- the fixed step
  function step() {
    const t0 = performance.now();
    time += STEP; steps++;
    spawnBudget = cfg.maxSpawnPerStep; soundBudget = cfg.maxSounds; fxBudget = Math.max(1, Math.round(cfg.maxFx * Math.max(0.25, cfg.detail)));
    while (timers.length && timers[0].at <= time + 1e-9) runTimer(timers.shift());
    stats.timers = timers.length;
    for (let i = flickering.length - 1; i >= 0; i--) {
      const it = flickering[i];
      if (time >= it.flickerEnd) { setLamps(it, it.broken ? 0 : it.flickerFinal); flickering[i] = flickering[flickering.length - 1]; flickering.length--; continue; }
      if (steps % 3 === 0) setLamps(it, R.float() < 0.45 ? 0.05 : 0.6 + 0.4 * R.float());
    }
    for (let i = moving.length - 1; i >= 0; i--) stepMover(moving[i], STEP);
    for (let i = collapsing.length - 1; i >= 0; i--) {
      const it = collapsing[i], A = it.actor;
      A.k = Math.min(1, A.k + STEP / 0.8); poseActor(it);
      if (A.k >= 1) { collapsing[i] = collapsing[collapsing.length - 1]; collapsing.length--; }
    }
    for (const pd of puddles) if (pd.r < pd.rMax) { pd.r = Math.min(pd.rMax, pd.r + pd.rMax / pd.grow * STEP); if (pd.mark >= 0) marks.resize(pd.mark, pd.r * 2, pd.r * 2); }
    for (let i = emitters.length - 1; i >= 0; i--) if (time >= emitters[i].until) { emitters[i].h.stop(); emitters.splice(i, 1); }
    for (let i = occluders.length - 1; i >= 0; i--) if (time >= occluders[i].until) { try { occluders[i].loop?.src?.stop(); } catch { /* ended */ } occluders.splice(i, 1); }
    for (let i = bodyList.length - 1; i >= 0; i--) if (time >= bodyList[i].until) { const b = bodyList[i]; b.body.remove?.(); b.m.removeFromParent(); b.m.geometry.dispose(); bodyList.splice(i, 1); }
    stats.emitters = emitters.length;
    debris.step(STEP, cfg.gravity);
    stats.debris = debris.live; stats.marks = marks.count;
    stats.stepMs = performance.now() - t0;
    if (game && (debris.live || moving.length || collapsing.length || flickering.length)) game.dirty = true;
  }
  /** advance by a frame's time: fixed steps, then draw blended between the last two */
  function update(frameDt) {
    if (disposed || !items.length) return 0;
    acc += Math.max(0, Math.min(frameDt, 0.1));
    let n = 0;
    while (acc + 1e-9 >= STEP) { acc -= STEP; step(); n++; }
    alpha = acc / STEP;
    sync(alpha);
    return n;
  }
  /** write what moved into the meshes (alpha: the blend between the last two steps) */
  function sync(a = 1) {
    debris.sync(a); marks.sync();
    for (const it of moving) placeDraw(it, a);
  }

  // ---- state
  /** the broken set and the hurt props, compact: { v, steps, broken: [id | [id, stage]], hurt: [[id, health, stage]],
   *  moved: [[id, x, y, z, qx, qy, qz, qw]] } */
  function snapshot() {
    const broken = [], hurt = [], moved = [];
    for (const it of items) {
      if (it.broken) broken.push(it.stage ? [it.id, it.stage] : it.id);
      else if (it.health < it.max) hurt.push([it.id, +it.health.toFixed(2), it.stage]);
      const m = it.mover;
      if (m && m.origin && (m.active || it.fallen || Math.hypot(m.p[0] - m.c0[0], m.p[1] - m.c0[1], m.p[2] - m.c0[2]) > 1e-3)) moved.push([it.id, ...m.p.map((x) => +x.toFixed(4)), +m.q.x.toFixed(5), +m.q.y.toFixed(5), +m.q.z.toFixed(5), +m.q.w.toFixed(5)]);
    }
    return { v: 1, steps, broken, hurt, moved };
  }
  /** back to a snapshot: everything intact first, then the broken set quietly (no debris, sound or events; lamps
   *  out, broken states shown, puddles full, endless vents back), the hurt props' health, the moved props where they lay */
  function restore(s) {
    if (!s || s.v !== 1 || !Array.isArray(s.broken)) throw new Error('destructibles: not a snapshot');
    reset();
    steps = s.steps || 0; R = rng(seed + ':' + steps);
    for (const b of s.broken) { const [id, stage] = Array.isArray(b) ? b : [b, 0]; const it = byId.get(id); if (!it) continue; it.stage = stage; breakItem(it, 'bullet', null, null, null, true); }
    for (const [id, health, stage] of s.hurt || []) { const it = byId.get(id); if (!it || it.broken) continue; it.health = health; it.stage = stage; const st = it.mat.stages?.[stage - 1]; if (st?.state && !it.stateTicket) { it.stateTicket = showBroken(it, st.state); it.stateKind = st.state; if (it.stateTicket) it.handle.hide(); } }
    for (const [id, x, y, z, qx, qy, qz, qw] of s.moved || []) {
      const it = byId.get(id); if (!it?.mover) continue;
      if (!wake(it)) continue;
      const m = it.mover; m.p = [x, y, z]; m.q.set(qx, qy, qz, qw); m.po = m.p.slice(); m.qo.copy(m.q);
      if (it.fallen) m.landed = true;
      const e = _bm.makeRotationFromQuaternion(m.q).elements, v = it.vol; if (v.type === 0) { v.c = [x, y, z]; for (let j = 0; j < 3; j++) { v.u[j * 3] = e[j * 4]; v.u[j * 3 + 1] = e[j * 4 + 1]; v.u[j * 3 + 2] = e[j * 4 + 2]; } }
      regrid(it); sleep(it);
    }
    sync(1);
    emit('restore', s);
    return s;
  }
  /** everything intact, as registered */
  function reset() {
    for (const t of timers) if (t.kind === 4) runTimer(t);
    timers.length = 0; flickering.length = 0;
    for (const e of emitters) e.h.stop(); emitters.length = 0;
    for (const o of occluders) { try { o.loop?.src?.stop(); } catch { /* ended */ } } occluders.length = 0;
    for (const b of bodyList) { b.body.remove?.(); b.m.removeFromParent(); } bodyList.length = 0;
    puddles.length = 0; collapsing.length = 0;
    for (const it of items) {
      if (it.mover) resetMover(it);
      if (it.actor) unpose(it);
      hideBroken(it.brokenTicket); hideBroken(it.stateTicket); it.brokenTicket = it.stateTicket = null;
      if (it.handle.hidden) it.handle.show();
      if (it.broken || it.flicker) setLamps(it, 1);
      if (it.burning) { it.burning.h?.stop(); it.burning = null; }
      if (it.alarmLoop) { try { it.alarmLoop.src?.stop(); } catch { /* ended */ } it.alarmLoop = null; }
      const wasBroken = it.broken;
      it.broken = false; it.health = it.max; it.stage = 0; it.alarmed = false; it.flicker = 0; it.lastHit = null; it.fallen = false;
      if (wasBroken && (it.spec.solid || options.sensors) && it.solidHandle < 0) makeSolid(it, !it.spec.solid);
    }
    debris.clear(); marks.clear(); brokenPools.clear(); layers.clear();
    tally.count = tally.value = tally.casualties = 0; tally.byClass = {}; tally.byTag = {};
    stats.broken = 0; time = 0; steps = 0; acc = 0; R = rng(seed + ':0'); fxR = rng(seed + ':fx');
    emit('reset', null);
  }

  // ---- queries for AI and gameplay
  /** how much of a line of sight survives the steam and spray in the way (0..1; 1: clear) */
  function visibility(from, to) {
    let T = 1;
    for (const o of occluders) {
      const d = segSegDist(from, to, o.a, o.b);
      if (d >= o.r) continue;
      T *= Math.exp(-o.density * 2 * Math.sqrt(o.r * o.r - d * d));
    }
    return T;
  }
  const blocksSight = (from, to, threshold = 0.35) => visibility(from, to) < threshold;
  /** what is underfoot at p: the spilled liquid there ({ slippery, conductive, liquid, item }) or null */
  function surfaceAt(p) {
    for (let i = puddles.length - 1; i >= 0; i--) { const pd = puddles[i]; if (Math.abs(p[1] - pd.c[1]) < 0.6 && Math.hypot(p[0] - pd.c[0], p[2] - pd.c[2]) <= pd.r) return pd; }
    return null;
  }
  function segSegDist(p1, q1, p2, q2) {
    const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]], r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
    let s, t;
    if (a <= 1e-9 && e <= 1e-9) return Math.hypot(...r);
    if (a <= 1e-9) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
    else {
      const c = dot(d1, r);
      if (e <= 1e-9) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else { const b = dot(d1, d2), den = a * e - b * b; s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0; t = (b * s + f) / e; if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); } }
    }
    return Math.hypot(p1[0] + d1[0] * s - p2[0] - d2[0] * t, p1[1] + d1[1] * s - p2[1] - d2[1] * t, p1[2] + d1[2] * s - p2[2] - d2[2] * t);
  }
  /** props within radius of p (unbroken), nearest first */
  function query(p, radius) {
    const out = [];
    for (const it of items) { if (it.broken) continue; const d = distVol(it.vol, p, _bp); if (d <= radius) out.push([d, it]); }
    return out.sort((a, b) => a[0] - b[0] || a[1].index - b[1].index).map((x) => x[1]);
  }

  /** build the debris and mark meshes and compile the effects now (no hitch at the first break) */
  function prewarm() {
    debris.prewarm(); marks.prewarm();
    if (vfx?.prewarm) for (const k of ['glitter', 'dust', 'sparks', 'shorted', 'splash', 'spray', 'blast', 'steam', 'fire', 'chips', 'splinters', 'scraps']) if (effects[k]) vfx.prewarm(effects[k]);
  }
  function dispose() {
    if (disposed) return;
    reset();
    for (const it of items) dropSolid(it);
    debris.dispose(); marks.dispose(); brokenPools.dispose(); layers.dispose();
    listeners.clear(); disposed = true; offGame?.();
  }

  const api = {
    add, actor, place, hit, blast, ray, cover, query, get: (id) => byId.get(String(id)) ?? null, items,
    break: (id, o = {}) => { const it = typeof id === 'string' ? byId.get(id) : id; return it ? breakItem(it, o.kind || 'bullet', o.point || null, o.dir || null, o.source || null) : false; },
    damage: (id, amount, kind = 'bullet', o = {}) => { const it = typeof id === 'string' ? byId.get(id) : id; return it ? damage(it, amount, kind, o.point, o.normal, o.dir, o.source ?? null) : 0; },
    on, emit, update, step, sync, snapshot, restore, reset, prewarm, dispose, fromCollider, visibility, blocksSight, surfaceAt,
    tally, stats, materials, effects, cfg, debris, marks,
    get time() { return time; }, get steps() { return steps; }, get alpha() { return alpha; },
    get occluders() { return occluders; }, get puddles() { return puddles; }, get moving() { return moving; },
    /** quality 0..1: debris counts, live caps, marks and particle bursts scale with it */
    setDetail(x) { cfg.detail = Math.max(0, Math.min(1, +x || 0)); return cfg.detail; },
    /** route lamp changes elsewhere: a lamp pool (scale(i, k)) or (index, k) => void */
    setLamps(a) { lampsAdapter = a; },
    /** a hash of the state (broken set, health, debris): two runs with one seed and one input agree */
    hash() { let h = 2166136261 >>> 0; for (const it of items) { h = Math.imul(h ^ (it.broken ? 1 : 0), 16777619) >>> 0; h = Math.imul(h ^ Math.round(it.health * 1000), 16777619) >>> 0; if (it.mover) for (const x of it.mover.p) h = Math.imul(h ^ Math.round(x * 1e4), 16777619) >>> 0; } return (h >>> 0).toString(16) + '/' + debris.hash(); },
  };
  // a game: stepped with its systems (its tick is the fixed step), saved with its entities
  let offGame = null;
  if (game && options.attach !== false) {
    const sys = game.system((dt) => { if (!items.length) return; acc += dt; while (acc + 1e-9 >= STEP) { acc -= STEP; step(); } sync(1); });
    const ent = game.add({ id: options.id || 'destructibles', save: () => snapshot(), load: (s) => restore(s) });
    offGame = () => { const i = game.systems.indexOf(sys); if (i >= 0) game.systems.splice(i, 1); game.entities.delete(ent.id); };
  }
  return api;
}
void DAMAGE_KINDS;
