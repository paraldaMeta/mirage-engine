// Mirage original code. Brought in from a game built on Mirage (click to move on any map).
// ---------------------------------------------------------------------------
// Click to move on the walk grid: the screen ray's first walkable floor, found by marching the walk grid along the
// ray instead of raycasting meshes. It works on any world without a list of ground meshes, it ignores what does not
// collide (foliage, props marked `collide = false`: the walker's own rule), it passes through the bodies of walls
// (only a floor's top counts), through spots a body does not fit (hard against a wall, under a low beam: when a nav
// grid is given) and through what `skip` says (what a cutaway hides), and it returns a point the nav grid can path to. reachableGoal() then turns a clicked point that cannot be reached (the top of a
// crate, a bench, a roof) into one that can.
//
//   ray.setFromCamera(ndc, camera);                                   // a THREE.Raycaster
//   const p = pickWalkGrid(grid, ray.ray, { nav, radius: 0.3 });      // [x, y, z] | null
//   const goal = p && reachableGoal(nav, p, { radius: 0.3, from: agent.pos, tryGoal: (q) => agent.setGoal(q) });
// No three import: a ray is { origin, direction } of [x, y, z] arrays or anything with x, y, z (THREE.Ray).
// ponytail: a march (0.25 m steps, then bisection): a floor thinner than a step along the ray, seen edge-on, can be
// stepped over; picking costs ~600 grid lookups for a 160 m ray (well under a millisecond).
// ---------------------------------------------------------------------------

const xyz = (v) => (Array.isArray(v) || ArrayBuffer.isView(v) ? [v[0], v[1], v[2]] : [v.x, v.y, v.z]);

/**
 * The first walkable floor along a ray, [x, y, z] (y: the floor's height), or null. A sample counts as on a floor
 * when it is at most `reach` (0.6 m) below the top of that column's highest floor within `reach` above it, so the
 * march meets floors from above and passes through the bodies of walls. Options: nav and radius (the floor must fit
 * a body of `radius`: nav.fits), maxDist (160 m), start (0.5 m), step (0.25 m), skip(x, y, z) (true: a hit there does
 * not count, e.g. what a cutaway hides).
 */
export function pickWalkGrid(grid, ray, { nav = null, radius = 0.3, maxDist = 160, start = 0.5, step = 0.25, reach = 0.6, skip = null } = {}) {
  const o = xyz(ray.origin), d = xyz(ray.direction);
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  d[0] /= len; d[1] /= len; d[2] /= len;
  const P = [0, 0, 0];
  const at = (t) => { P[0] = o[0] + d[0] * t; P[1] = o[1] + d[1] * t; P[2] = o[2] + d[2] * t; return P; };
  const floorAt = (t) => { at(t); return grid.groundAt(P[0], P[2], P[1] + reach); };
  const under = (t) => { const g = floorAt(t); return Number.isFinite(g) && P[1] <= g; };
  const standable = (t) => { const g = floorAt(t); return Number.isFinite(g) && (!nav || nav.fits(P[0], g, P[2], radius)); };
  let wasUnder = under(Math.max(0, start - step));
  for (let t = start, prev = Math.max(0, start - step); t < maxDist; prev = t, t += step) {
    const u = under(t), crossed = u && !wasUnder;
    wasUnder = u;
    if (!u) continue;
    if (skip && skip(P[0], P[1], P[2])) continue;
    if (!standable(t)) continue;
    // bisect the crossing; a sample that is under a floor already (the march went on below a spot that did not count)
    // is taken as it is: bisecting back would land on that spot
    let b = t;
    if (crossed) { let a = prev; for (let i = 0; i < 10; i++) { const m = (a + b) / 2; if (under(m)) b = m; else a = m; } }
    const y = floorAt(b);
    return [P[0], Number.isFinite(y) ? y : P[1], P[2]];
  }
  return null;
}

/**
 * A goal near `p` that can be reached, or null: `p` itself; else the lower floors of its column, top down (under a
 * bridge, a balcony); else rings round its foot at the walker's height (`from[1]`, else p's), 8 points each at
 * `rings` metres (0.6 .. 3.6), snapped with nav.nearest, at most `climb` (1.5 m) above or below (beside the crate,
 * the bench, the house that was clicked). `tryGoal(q)` says whether q is reachable (and may start
 * walking there: agent.setGoal returns exactly that); without it, nav.findPath(from, q) is asked (needs `from`), or
 * only nav.fits without `from`.
 */
export function reachableGoal(nav, p, { radius = 0.3, from = null, tryGoal = null, rings = [0.6, 1.2, 1.8, 2.6, 3.6], snap = 0.6, climb = 1.5 } = {}) {
  const ok = tryGoal || (from ? (q) => !!nav.findPath(from, q, { radius }) : (q) => nav.fits(q[0], q[1], q[2], radius));
  const P = xyz(p);
  if (ok(P)) return P;
  const floors = (nav.grid.layers(P[0], P[2]) || []).map(([f]) => f).filter((f) => f < P[1] - 0.05).sort((a, b) => b - a);
  for (const f of floors) { const q = [P[0], f, P[2]]; if (ok(q)) return q; }
  const y = from ? xyz(from)[1] : P[1];
  for (const r of rings) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const q = nav.nearest([P[0] + Math.cos(a) * r, y, P[2] + Math.sin(a) * r], { radius, snap });
      if (q && Math.abs(q[1] - y) < climb && ok(q)) return q;
    }
  }
  return null;
}
