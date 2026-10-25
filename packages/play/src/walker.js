// Mirage code; constants and the feel (walk/run speeds, jump, eased eye) adapted from the author's own earlier walk.js.
// ---------------------------------------------------------------------------
// A walker on the walk grid: a vertical cylinder (radius, head height) that steps up at most `step`, falls
// under gravity, jumps, and slides along whatever blocks it. Pure JS over the grid arrays (no GPU, no three),
// so it runs in node tests too.
//
//   const w = createWalker(grid, { pos: [x, y, z] });
//   w.update(dt, { x, z, run, jump })   x/z: wanted direction (world, length <= 1)
//   w.pos [x, y(feet), z], w.onGround, w.vy, w.blocked (true when this frame's move was cut short)
// ---------------------------------------------------------------------------

export const BODY = { radius: 0.28, head: 1.8, eye: 1.62, step: 0.4, airStep: 0.12, walk: 1.5, run: 4.2, gravity: 9.81, jump: 4.2 };
const SUB = 0.05;   // metres per sub-step: nothing thinner than ~2 sub-steps can be skipped
const RIM = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);
// ponytail: sliding takes the move minus its part into the wall, the wall's normal guessed from which of 16 cells on
// a ring two cells outside the disc are blocked, else falls back to axis-separated moves (x, else z); no swept disc.

export function createWalker(grid, opts = {}) {
  const B = { ...BODY, ...opts.body };
  const pos = (opts.pos || [0, 0, 0]).slice();
  // the cells under the body's disc (relative offsets), and the inner ones that carry the feet
  const disc = [], feet = [];
  const n = Math.ceil(B.radius / grid.cell) + 1;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const d = Math.hypot(i, j) * grid.cell;
    if (d <= B.radius) disc.push([i * grid.cell, j * grid.cell]);
    if (d <= B.radius * 0.55) feet.push([i * grid.cell, j * grid.cell]);
  }
  const w = { pos, vy: 0, onGround: false, blocked: false, body: B };

  /** ground under a body at (x, z) with feet at y, or null when it does not fit there */
  function fits(x, z, y, step) {
    let g = -Infinity;
    for (const [dx, dz] of disc) {
      const s = grid.support(x + dx, z + dz, y, step);
      if (!s || s[1] < Math.max(y, s[0]) + B.head) return null;   // inside a solid / under a low ceiling
    }
    for (const [dx, dz] of feet) { const s = grid.support(x + dx, z + dz, y, step); if (s[0] > g) g = s[0]; }
    return g;
  }
  w.fits = (x, z, y = pos[1]) => fits(x, z, y, B.step) !== null;
  /** the move (sx, sz) slid along whatever blocks it, or null */
  function slide(sx, sz, step) {
    let nx = 0, nz = 0;
    const r = B.radius + 2 * grid.cell, y = pos[1];
    for (const [dx, dz] of RIM) {
      const s = grid.support(pos[0] + dx * r, pos[2] + dz * r, y, step);
      if (!s || s[1] < Math.max(y, s[0]) + B.head) { nx -= dx; nz -= dz; }
    }
    const l = Math.hypot(nx, nz), k = l ? (sx * nx + sz * nz) / l / l : 0;
    if (k >= 0) return null;
    // along the wall, else a little away from it too (the grid makes a diagonal wall a staircase of cells)
    for (const out of [0, 0.25, 0.5, 1]) {
      const tx = sx - k * nx + (out * Math.hypot(sx, sz) * nx) / l, tz = sz - k * nz + (out * Math.hypot(sx, sz) * nz) / l;
      if (fits(pos[0] + tx, pos[2] + tz, y, step) !== null) return [tx, tz];
    }
    return null;
  }

  w.update = (dt, input = {}) => {
    dt = Math.min(dt, 0.1);
    const speed = input.run ? B.run : B.walk;
    let mx = (input.x || 0) * speed * dt, mz = (input.z || 0) * speed * dt;
    const step = w.onGround ? B.step : B.airStep;
    const subs = Math.max(1, Math.ceil(Math.hypot(mx, mz) / SUB));
    w.blocked = false;
    for (let s = 0; s < subs; s++) {
      const sx = mx / subs, sz = mz / subs;
      // full move, else slide along the wall, else along x, else along z
      if (fits(pos[0] + sx, pos[2] + sz, pos[1], step) !== null) { pos[0] += sx; pos[2] += sz; continue; }
      w.blocked = true;
      const t = slide(sx, sz, step);
      if (t) { pos[0] += t[0]; pos[2] += t[1]; }
      else if (sx && fits(pos[0] + sx, pos[2], pos[1], step) !== null) pos[0] += sx;
      else if (sz && fits(pos[0], pos[2] + sz, pos[1], step) !== null) pos[2] += sz;
    }
    // vertical
    const g = fits(pos[0], pos[2], pos[1], step) ?? pos[1];
    if (w.onGround && input.jump) { w.vy = B.jump; w.onGround = false; }
    // on the ground: steps up and down (down only where the body fits, else it stands on the edge it is on)
    if (w.onGround && g >= pos[1] - B.step && (g >= pos[1] || fits(pos[0], pos[2], g, B.step) !== null)) { pos[1] = g; w.vy = 0; }
    else {
      w.vy -= B.gravity * dt;
      const y = pos[1] + w.vy * dt;
      // never move into a place the body does not fit: going up that is a ceiling; coming down it is the edge of
      // an overhang (a bench seat, a coping lip) the disc is partly over: it lands there instead of falling through
      // (with no floor at all under its centre it keeps falling: off the edge of the world)
      if (fits(pos[0], pos[2], y, B.airStep) === null && (w.vy > 0 || grid.support(pos[0], pos[2], y, B.airStep))) { if (w.vy <= 0) w.onGround = true; w.vy = 0; return w; }
      pos[1] = y;
      const g2 = fits(pos[0], pos[2], pos[1], B.airStep);
      if (g2 !== null && pos[1] <= g2) { pos[1] = g2; w.vy = 0; w.onGround = true; } else w.onGround = false;
    }
    return w;
  };
  w.place = (p) => { pos[0] = p[0]; pos[2] = p[2]; const g = grid.groundAt(p[0], p[2], p[1] ?? 1e4, 0.5); pos[1] = Number.isNaN(g) ? p[1] ?? 0 : g; w.vy = 0; w.onGround = true; return w; };
  if (opts.pos) w.place(opts.pos);
  return w;
}
