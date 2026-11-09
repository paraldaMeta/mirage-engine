// Mirage original code.
// ---------------------------------------------------------------------------
// The site plan: one plain object (JSON-able) that every module reads its positions from. Nothing in a module
// hard-codes a coordinate that another module also needs; it goes in the plan.
//
//   units 'm'; axes: +X east, +Y up, +Z south (north is -Z), the core's frame
//   bounds      [x0, z0, x1, z1]          the playable area (the walk grid covers it)
//   walk        { yMin, yMax }            height range of anything walkable (+ head room); default [-1, 12]
//   regions     { name: shape }           areas: terraces, lawns, courts
//   footprints  { name: shape }           what a building occupies (other modules keep out)
//   paths       { name: { points: [[x, z], ...], width } }
//   points      { name: [x, y, z] }       named spots (gate, spawn, a fountain's centre)
//   viewpoints  [{ name, eye: [x, y, z], look: [x, y, z], mode? }]   keys 1-9 in play
//   spawn       { eye, look, mode? }
// shape: { rect: [x0, z0, x1, z1], y? } | { circle: [x, z, r], y? } | { poly: [[x, z], ...], y? }   (y: its level)
// ---------------------------------------------------------------------------

import { planProblems } from './plan-validation.js';

/** Check a plan and fill defaults. Throws with every problem listed (agents read the message). */
export function definePlan(plan) {
  const problems = planProblems(plan);
  if (problems.length) throw new Error('[plan ' + (typeof plan?.name === 'string' ? plan.name : '?') + ']\n' + problems.join('\n'));
  return {
    units: 'm', regions: {}, footprints: {}, paths: {}, points: {}, viewpoints: [], ...plan,
    axes: { x: 'east', y: 'up', z: 'south', ...plan.axes }, walk: { yMin: -1, yMax: 12, ...plan.walk },
    seed: plan.seed ?? plan.name,
  };
}

/** Is (x, z) inside the shape? */
export function contains(s, x, z) {
  if (s.rect) { const [x0, z0, x1, z1] = s.rect; return x >= x0 && x <= x1 && z >= z0 && z <= z1; }
  if (s.circle) { const [cx, cz, r] = s.circle; return (x - cx) ** 2 + (z - cz) ** 2 <= r * r; }
  let inside = false;   // even-odd rule
  const P = s.poly;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Bounding rectangle [x0, z0, x1, z1] of a shape. */
export function bbox(s) {
  if (s.rect) return s.rect.slice();
  if (s.circle) { const [x, z, r] = s.circle; return [x - r, z - r, x + r, z + r]; }
  const xs = s.poly.map((p) => p[0]), zs = s.poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

/** Length of a path (metres). */
export function pathLength(path) {
  let L = 0;
  for (let i = 1; i < path.points.length; i++) L += Math.hypot(path.points[i][0] - path.points[i - 1][0], path.points[i][1] - path.points[i - 1][1]);
  return L;
}

/** Point and unit direction at distance s along a path: { x, z, dx, dz }. */
export function along(path, s) {
  const P = path.points;
  for (let i = 1; i < P.length; i++) {
    const [ax, az] = P[i - 1], [bx, bz] = P[i], l = Math.hypot(bx - ax, bz - az);
    if (s <= l || i === P.length - 1) { const t = l ? Math.min(Math.max(s / l, 0), 1) : 0; return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / (l || 1), dz: (bz - az) / (l || 1) }; }
    s -= l;
  }
}
