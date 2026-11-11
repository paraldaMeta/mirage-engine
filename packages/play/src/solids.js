// Mirage original code.
// ---------------------------------------------------------------------------
// Moving solids on the walk grid: doors, lifts, turntables, crates. The baked grid is static; this is a walk grid
// with a short list of moving shapes composed in at query time, so everything that already reads a grid (the
// walker, the mover, cameras, sight rays) collides with them and can stand on them, with no re-bake.
//
//   const space = createSolids(grid);                       // grid: bakeWalkGrid / makeGrid / play.grid
//   const lift = space.add({ box: [1, 0.1, 1], pos: [4, 0.1, 0], kind: 'kinematic' });   // half extents, centre
//   lift.set({ pos: [4, 2.1, 0], yaw: 0.3 });               // every time it moves (quat: [x, y, z, w] for a tumbling crate)
//   space.add({ cylinder: [0.4, 0.5], pos }) / { sphere: 0.3, pos }                      // [radius, half height]
//   createWalker(space) / createMover(space)                // `space` IS a walk grid: support, groundAt, layers ...
//   space.groundSolid(x, z, y) -> the solid a body there stands on (the mover rides it)   space.solidAt(x, y, z)
//   space.addVolume({ type: 'ladder' | 'water', box: [x0, y0, z0, x1, y1, z1], facing: [dx, dz] })
//   gridRay(space, from, to) -> 0..1, the fraction of the segment that is clear (cameras, sight)
//
// How: a column (x, z) crosses a convex shape in one interval [lo, hi] (exact for a box in any orientation: the
// slab test on a vertical line). The static column's air is then cut by those intervals: a top within `step` of the
// feet is a floor to stand on, anything above the floor lowers the ceiling to its underside. That is the whole
// rule, and it is the same rule the bake applies to static geometry, so a walker treats a crate like a kerb and a
// closed door like a wall.
// THE ONE RULE for two collision worlds (the grid here, Rapier in @miragekit/game): a moving solid is described once,
// as a shape and a pose in this list. The walker and the navigation read it from here; Rapier gets a collider built
// from the same numbers (linkSolids, physics-link.js). Kinematic solids are moved by the game and copied to Rapier
// before its step; dynamic solids are moved by Rapier and copied back after it. Nothing else moves a solid.
// ponytail: solids are found through 2 m buckets over their bounding boxes, fine for tens to hundreds; shapes are
// convex primitives only (no moving trimesh); for standing and blocking a solid is half a cell fatter sideways (see
// `pad`), so the walker stops up to a cell and a half short of its true face.
// ---------------------------------------------------------------------------
import { MAXL } from './walkgrid.js';

const EPS = 1e-9;

export function createSolids(grid, { bucket = 2 } = {}) {
  const { floors, count, cell } = grid;
  const solids = new Map(), volumes = [], buckets = new Map(), listeners = [];
  let nextId = 1, lo = new Float64Array(16), hi = new Float64Array(16);
  // a column test is a point test, and the walker samples points a cell apart: a leaf thinner than a cell would slip
  // between them. So for standing and blocking a solid is half a cell fatter sideways (what the bake does to static
  // geometry by marking every cell a surface touches); solidAt stays exact.
  const pad = cell / 2;
  const key = (i, j) => (i + 32768) * 65536 + (j + 32768);
  const space = Object.create(grid);

  function unindex(s) { for (const k of s.keys) { const b = buckets.get(k), i = b.indexOf(s); if (i >= 0) b.splice(i, 1); if (!b.length) buckets.delete(k); } s.keys.length = 0; }
  function index(s) {
    // rotation matrix columns = the box's axes in the world; the bounding radius in x / z from them
    const [x, y, z, w] = s.quat, a = s.axes;
    a[0] = 1 - 2 * (y * y + z * z); a[1] = 2 * (x * y + z * w); a[2] = 2 * (x * z - y * w);
    a[3] = 2 * (x * y - z * w); a[4] = 1 - 2 * (x * x + z * z); a[5] = 2 * (y * z + x * w);
    a[6] = 2 * (x * z + y * w); a[7] = 2 * (y * z - x * w); a[8] = 1 - 2 * (x * x + y * y);
    let ex, ey, ez;
    if (s.box) { const h = s.box; ex = Math.abs(a[0]) * h[0] + Math.abs(a[3]) * h[1] + Math.abs(a[6]) * h[2]; ey = Math.abs(a[1]) * h[0] + Math.abs(a[4]) * h[1] + Math.abs(a[7]) * h[2]; ez = Math.abs(a[2]) * h[0] + Math.abs(a[5]) * h[1] + Math.abs(a[8]) * h[2]; }
    else if (s.cylinder) { ex = ez = s.cylinder[0]; ey = s.cylinder[1]; }
    else { ex = ey = ez = s.sphere; }
    ex += pad; ez += pad;
    s.aabb[0] = s.pos[0] - ex; s.aabb[1] = s.pos[1] - ey; s.aabb[2] = s.pos[2] - ez; s.aabb[3] = s.pos[0] + ex; s.aabb[4] = s.pos[1] + ey; s.aabb[5] = s.pos[2] + ez;
    const i0 = Math.floor(s.aabb[0] / bucket), i1 = Math.floor(s.aabb[3] / bucket), j0 = Math.floor(s.aabb[2] / bucket), j1 = Math.floor(s.aabb[5] / bucket);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = key(i, j); let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(s); s.keys.push(k); }
  }
  /** the interval [lo, hi] in which the vertical line at (x, z) is inside solid s: written to o[q], p[q]; false: misses */
  function span(s, x, z, o, p, q, fat) {
    if (x < s.aabb[0] || x > s.aabb[3] || z < s.aabb[2] || z > s.aabb[5]) return false;
    const dx = x - s.pos[0], dz = z - s.pos[2];
    if (s.box) {
      const a = s.axes, h = s.box;
      let t0 = -Infinity, t1 = Infinity;
      for (let i = 0; i < 3; i++) {
        const l = a[i * 3] * dx + a[i * 3 + 2] * dz, v = a[i * 3 + 1];   // the line's origin and direction along axis i
        const e = h[i] + fat * Math.sqrt(Math.max(0, 1 - v * v));   // fatter along the axis as far as it lies flat
        if (Math.abs(v) < EPS) { if (Math.abs(l) > e) return false; continue; }
        let u0 = (-e - l) / v, u1 = (e - l) / v;
        if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
        if (u0 > t0) t0 = u0;
        if (u1 < t1) t1 = u1;
        if (t0 > t1) return false;
      }
      o[q] = s.pos[1] + t0; p[q] = s.pos[1] + t1;
      return true;
    }
    const r = (s.cylinder ? s.cylinder[0] : s.sphere) + fat, d2 = dx * dx + dz * dz;
    if (d2 > r * r) return false;
    const hh = s.cylinder ? s.cylinder[1] : Math.sqrt(r * r - d2);
    o[q] = s.pos[1] - hh; p[q] = s.pos[1] + hh;
    return true;
  }
  const near = (x, z) => (buckets.size ? buckets.get(key(Math.floor(x / bucket), Math.floor(z / bucket))) : undefined);

  // the support search with the solids in. `who`: set to the solid whose top is the floor found (null: static)
  let who = null;
  function support(x, z, y, step = 0.4, out) {
    const k = grid.idx(x, z), list = near(x, z);
    who = null;
    if (!list) return grid.supportAt(k, y, step, out);
    if (k < 0) return null;
    if (list.length > lo.length) { lo = new Float64Array(list.length * 2); hi = new Float64Array(list.length * 2); }
    const top = y + step;
    let F = -Infinity, C = Infinity, n = 0;
    for (let l = count[k] - 1; l >= 0; l--) { const f = floors[(k * MAXL + l) * 2]; if (f <= top) { F = f; C = floors[(k * MAXL + l) * 2 + 1]; break; } }
    const fs = F;
    for (let i = 0; i < list.length; i++) {
      if (!span(list[i], x, z, lo, hi, n, pad)) continue;
      if (hi[n] <= top && hi[n] >= F) { F = hi[n]; who = list[i]; }   // >=: flush with the ground, the solid is the one ridden
      n++;
    }
    if (F === -Infinity) return null;
    // a floor that is a solid's top keeps the ceiling of the static air it lies in (none: it is inside the static
    // world, or under its lowest floor: no room). Over a column with no floors at all (a void) there is open air.
    if (who && F > C) C = F;
    else if (who && fs === -Infinity) C = count[k] ? F : Infinity;
    for (let i = 0; i < n; i++) if (hi[i] > F && lo[i] < C) C = lo[i];
    if (!out) return [F, C];
    out[0] = F; out[1] = C;
    return out;
  }
  space.support = support;
  space.supportAt = (k, y, step, out) => (k < 0 ? null : support(grid.x0 + ((k % grid.nx) + 0.5) * cell, grid.z0 + (((k / grid.nx) | 0) + 0.5) * cell, y, step, out));
  /** [[floor, ceil], ...] of the column at (x, z) with the solids in, bottom to top */
  space.layers = (x, z) => {
    let L = grid.layers(x, z);
    const list = near(x, z);
    if (!list) return L;
    const a = [0], b = [0];
    for (const s of list) {
      if (!span(s, x, z, a, b, 0, pad)) continue;
      const next = [];
      for (const [f, c] of L) {
        if (b[0] <= f || a[0] >= c) { next.push([f, c]); continue; }
        if (a[0] > f) next.push([f, a[0]]);
        if (b[0] < c) next.push([b[0], c]);
      }
      L = next;
    }
    return L;
  };

  const _s = [0, 0];
  Object.assign(space, {
    base: grid, solids, volumes, version: 0, pushes: [],
    /** add a moving solid: { box: [hx, hy, hz] | cylinder: [r, halfHeight] | sphere: r, pos (centre), yaw | quat,
     *  kind: 'kinematic' (default) | 'dynamic' | 'static', mass, name } */
    add(def) {
      if (!def.box && !def.cylinder && def.sphere === undefined) throw new Error('solids.add: give box [hx, hy, hz], cylinder [r, halfHeight] or sphere r');
      const s = {
        id: nextId++, name: def.name || '', kind: def.kind || 'kinematic', mass: def.mass ?? 20, data: def.data,
        box: def.box ? [...def.box] : null, cylinder: def.cylinder ? [...def.cylinder] : null, sphere: def.sphere,
        pos: [0, 0, 0], quat: [0, 0, 0, 1], yaw: 0, rev: 0, axes: new Float64Array(9), aabb: new Float64Array(6), keys: [],
        /** move it: { pos, yaw } (upright) or { pos, quat }; counts as a change only if something differs */
        set(p) {
          const np = p.pos || s.pos;
          let q = s.quat, yaw = s.yaw;
          if (p.quat) { q = p.quat; yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0])); }
          else if (p.yaw !== undefined) { yaw = p.yaw; q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]; }
          if (np[0] === s.pos[0] && np[1] === s.pos[1] && np[2] === s.pos[2] && q[0] === s.quat[0] && q[1] === s.quat[1] && q[2] === s.quat[2] && q[3] === s.quat[3]) return s;
          s.pos[0] = np[0]; s.pos[1] = np[1]; s.pos[2] = np[2]; s.quat[0] = q[0]; s.quat[1] = q[1]; s.quat[2] = q[2]; s.quat[3] = q[3]; s.yaw = yaw;
          unindex(s); index(s); s.rev++; space.version++;
          for (const fn of listeners) fn(s, 'move');
          return s;
        },
        remove() { if (!solids.delete(s.id)) return; unindex(s); space.version++; for (const fn of listeners) fn(s, 'remove'); },
      };
      solids.set(s.id, s);
      s.pos = (def.pos || [0, 0, 0]).slice();
      if (def.quat) s.set({ quat: def.quat }); else if (def.yaw) s.set({ yaw: def.yaw });
      unindex(s); index(s); space.version++;
      for (const fn of listeners) fn(s, 'add');
      return s;
    },
    /** fn(solid, 'add' | 'move' | 'remove') on every change (the nav carver listens here); returns an unsubscribe */
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    /** the solid whose top a body with feet at (x, y, z) stands on, or null (static ground, or none) */
    groundSolid(x, z, y, step = 0.05) { return support(x, z, y, step, _s) ? who : null; },
    /** the solid containing the point, or null */
    solidAt(x, y, z) {
      const list = near(x, z);
      if (list) for (const s of list) if (span(s, x, z, lo, hi, 0, 0) && y > lo[0] && y < hi[0]) return s;
      return null;
    },
    /** a trigger / movement volume: { type, box: [x0, y0, z0, x1, y1, z1], ... }; returns it (remove: removeVolume) */
    addVolume(v) { const b = v.box, o = { ...v, box: [Math.min(b[0], b[3]), Math.min(b[1], b[4]), Math.min(b[2], b[5]), Math.max(b[0], b[3]), Math.max(b[1], b[4]), Math.max(b[2], b[5])] }; volumes.push(o); return o; },
    removeVolume(v) { const i = volumes.indexOf(v); if (i >= 0) volumes.splice(i, 1); },
    /** the first volume of `type` containing the point, or null */
    volumeAt(type, x, y, z) { return volumeAt(volumes, type, x, y, z); },
    /** a push on a dynamic solid (N s, world space) at a point: applied by the physics link, or by `onPush` */
    push(s, ix, iy, iz, px, py, pz) { if (space.onPush) space.onPush(s, ix, iy, iz, px, py, pz); else space.pushes.push({ solid: s, impulse: [ix, iy, iz], point: [px, py, pz] }); },
    onPush: null,
  });
  return space;
}

/** the first volume of `type` in `volumes` containing (x, y, z), or null */
export function volumeAt(volumes, type, x, y, z) {
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i], b = v.box;
    if (v.type === type && x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5]) return v;
  }
  return null;
}

const _a = [0, 0];
/** whether the point is in air on this grid (a floor at or below it, its ceiling above it) */
export function airAt(grid, x, y, z) { const s = grid.support(x, z, y, 0, _a); return !!s && y < s[1]; }

/** how much of the segment a -> b is clear, 0..1 (1: nothing in the way). Sampled every `step` metres (half a cell):
 *  the grid has no surface thinner than a cell sideways, and floors are at least 0.3 m apart. Works on any walk
 *  grid, with or without solids. `floorSkin`: how far under a floor the ray may dip without counting as blocked. */
export function gridRay(grid, a, b, step = grid.cell / 2) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return 1;
  const n = Math.ceil(len / step);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!airAt(grid, a[0] + dx * t, a[1] + dy * t, a[2] + dz * t)) return (i - 1) / n;
  }
  return 1;
}
