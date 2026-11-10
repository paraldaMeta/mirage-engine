// Mirage original code.
// ---------------------------------------------------------------------------
// The movement both ends run. The client predicts with it, the server decides with it, and a correction replays it:
// it has to give the same numbers everywhere, so an input is quantised BEFORE either end uses it and a step is always
// 1/60 s (the engine's own fixed step, @mirage/game simulation.js). The walker is @mirage/play's, unchanged: pure
// JavaScript over the walk grid's arrays, the same in Node and in a page.
//
//   const inp = quantiseInput({ x, z, run, jump, yaw });   // x, z: wanted direction in the world, length <= 1
//   applyInput(walker, inp);                               // one 1/60 s step
//   const s = saveWalker(walker); restoreWalker(walker, s);
//
// Determinism: same grid bytes + same input sequence -> the same doubles (IEEE arithmetic and Math.hypot/ceil/floor
// only; no Math.random, no time). packages/net/check.mjs replays 4 000 inputs on two walkers and compares bits.
// ---------------------------------------------------------------------------

export const SIM_HZ = 60, SIM_DT = 1 / SIM_HZ;
const TAU = Math.PI * 2;

export function quantiseInput(i = {}) {
  let x = +i.x || 0, z = +i.z || 0;
  const l = Math.hypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  return { x: Math.round(x * 127), z: Math.round(z * 127), run: i.run ? 1 : 0, jump: i.jump ? 1 : 0, yaw: ((Math.round(((+i.yaw || 0) / TAU) * 1024) % 1024) + 1024) % 1024 };
}
export const sameInput = (a, b) => a.x === b.x && a.z === b.z && a.run === b.run && a.jump === b.jump && a.yaw === b.yaw;
export const writeInput = (w, i) => w.bits(i.x + 128, 8).bits(i.z + 128, 8).bits(i.run, 1).bits(i.jump, 1).bits(i.yaw, 10);
/** reads and clamps: whatever the bits, the result is a legal input */
export function readInput(r) {
  const x = Math.max(-127, r.bits(8) - 128), z = Math.max(-127, r.bits(8) - 128);
  return { x, z, run: r.bits(1), jump: r.bits(1), yaw: r.bits(10) };
}
export function applyInput(walker, i) {
  // a diagonal of two full axes is longer than 1: scaled back here, on both ends, so it cannot be a speed-up
  const l = Math.hypot(i.x, i.z), k = l > 127 ? 1 / l : 1 / 127;
  walker.update(SIM_DT, { x: i.x * k, z: i.z * k, run: !!i.run, jump: !!i.jump });
}
export const yawOf = (i) => (i.yaw / 1024) * TAU;
export const saveWalker = (w) => ({ x: w.pos[0], y: w.pos[1], z: w.pos[2], vy: w.vy, onGround: w.onGround });
export function restoreWalker(w, s) { w.pos[0] = s.x; w.pos[1] = s.y; w.pos[2] = s.z; w.vy = s.vy; w.onGround = !!s.onGround; w.blocked = false; }

/** distance along a ray (o, unit d) to an upright capsule standing at `c` (feet), or Infinity */
export function rayCapsule(o, d, c, r, h) {
  let best = Infinity;
  const ox = o[0] - c[0], oz = o[2] - c[2], lo = c[1] + r, hi = c[1] + h - r;
  const a = d[0] * d[0] + d[2] * d[2], b = ox * d[0] + oz * d[2], cc = ox * ox + oz * oz - r * r;
  if (a > 1e-9) {
    const disc = b * b - a * cc;
    if (disc >= 0) { const t = (-b - Math.sqrt(disc)) / a, y = o[1] + d[1] * t; if (t >= 0 && y >= lo && y <= hi) best = t; }
  }
  for (const sy of [lo, hi]) {
    const oy = o[1] - sy, B = ox * d[0] + oy * d[1] + oz * d[2], disc = B * B - (ox * ox + oy * oy + oz * oz - r * r);
    if (disc >= 0) { const t = -B - Math.sqrt(disc); if (t >= 0 && t < best) best = t; }
  }
  return best;
}
