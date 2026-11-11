// Mirage original code.
// ---------------------------------------------------------------------------
// The full character mover: the walker's cylinder on the walk grid, plus what a game character needs. Same shape as
// the walker ({ pos, vy, onGround, blocked, body, update, place, fits }), so createPlay({ walker: mover }) and
// @miragekit/net's applyInput take it as they are. Pure JS, no three, deterministic at a fixed step.
//
//   const space = createSolids(grid);                        // optional: moving platforms, doors, crates, volumes
//   const m = createMover(space, { pos: [x, y, z], body: { sprint: 6.5 } });
//   m.update(dt, { x, z, run, sprint, crouch, jump });       // x / z: wanted direction in the world, length <= 1
//   m.mode   'idle' | 'walk' | 'run' | 'sprint' | 'crouch' | 'jump' | 'fall' | 'slide' | 'climb' | 'swim' | 'mantle'
//   m.speed (m/s over the ground), m.crouched, m.eye (eased eye height), m.carry [dx, dy, dz, dyaw] from a platform
//   m.intent = { crouch, sprint }                            // merged into every input: for hosts that pass x/z/run/jump only
//   const s = m.save(); m.restore(s);                        // everything a replay needs (prediction, rollback)
//   driveAnimator(m, animator)                               // sets speed / grounded / crouch / mode numbers, fires 'jump' / 'land'
//
// What it adds to the walker, each one off when its input or its data is absent:
//   jump     coyote time (still jumps `coyote` s after walking off an edge), buffering (a press `buffer` s before
//            landing still jumps), variable height (releasing early cuts the rise by `jumpCut`). A HELD jump does not
//            repeat: the edge is taken from the held state, so the net input's one jump bit is enough.
//   crouch   a lower head; standing up again needs the room (ceiling check), else it stays crouched.
//   slopes   steeper than `slope` degrees: slides down, cannot walk up. The gradient is read from the cells either
//            side and only counts when both sides agree, so a stair riser is a step, not a slope.
//   solids   stands on, is carried by (translation and turn), is pushed out of and blocked by createSolids' shapes;
//            pushes dynamic ones (space.push: an impulse of `push` newtons x dt while walking into them).
//   ladders  space.addVolume({ type: 'ladder', box, facing: [dx, dz] }): into the wall climbs, away climbs down,
//            jump lets go.     water: { type: 'water', box }: deeper than `swimDepth` swims (jump up, crouch down).
//   mantle   holding jump against a ledge between `step` and `mantleMax` above the feet, in the air or in water,
//            pulls the body up onto it when it fits there.
// ponytail: movement is still the walker's (no acceleration curve: speed is the input's); a ladder is a box with a
// facing, not a spline; the slope test is two cell differences, so a slope must be at least three cells wide.
// ---------------------------------------------------------------------------
import { BODY } from './walker.js';
import { volumeAt } from './solids.js';

export const MOVER = {
  ...BODY, sprint: 6.2, crouchSpeed: 1.1, crouchHead: 1.1, crouchEye: 0.95,
  coyote: 0.1, buffer: 0.12, jumpCut: 0.45,
  slope: 42, slideAccel: 7, slideMax: 7,
  climb: 1.6, climbSide: 1, swim: 2.2, swimUp: 1.6, swimDepth: 1.2, swimFloat: 1.35,
  mantleMax: 1.9, mantleReach: 0.3, mantleTime: 0.5, push: 260,
};
export const MODES = ['idle', 'walk', 'run', 'sprint', 'crouch', 'jump', 'fall', 'slide', 'climb', 'swim', 'mantle'];
const SUB = 0.05;
const RIM = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);

export function createMover(grid, opts = {}) {
  const B = { ...MOVER, ...opts.body };
  const volumes = opts.volumes || grid.volumes || [];
  const pos = (opts.pos || [0, 0, 0]).slice();
  const disc = [], feet = [];
  const n = Math.ceil(B.radius / grid.cell) + 1, cell = grid.cell;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const d = Math.hypot(i, j) * cell;
    if (d <= B.radius) disc.push([i * cell, j * cell]);
    if (d <= B.radius * 0.55) feet.push([i * cell, j * cell]);
  }
  const slopeTan = B.slope >= 90 ? Infinity : Math.tan((B.slope * Math.PI) / 180);
  const w = { pos, vy: 0, onGround: false, blocked: false, body: B, mode: 'fall', speed: 0, crouched: false, eye: B.eye, carry: [0, 0, 0, 0], intent: {}, squeezed: false, ground: null, events: [] };
  const _s = [0, 0];
  let head = B.head;
  // state beyond the walker's (all of it in save()): timers, the jump in progress, air momentum, slide, mantle, ride
  let tCoyote = 0, tBuffer = 0, prevJump = false, jumping = false, ax = 0, az = 0, svx = 0, svz = 0, noClimb = 0, climbing = false;
  let mt = -1, m0 = [0, 0, 0], m1 = [0, 0, 0];
  let ride = null, pvx = 0, pvy = 0, pvz = 0;   // ride: { id, x, y, z, yaw } of the solid stood on, as it was last step

  function fits(x, z, y, step, h = head) {
    let g = -Infinity;
    for (let i = 0; i < disc.length; i++) {
      const s = grid.support(x + disc[i][0], z + disc[i][1], y, step, _s);
      if (!s || s[1] < Math.max(y, s[0]) + h) return null;
    }
    for (let i = 0; i < feet.length; i++) { const s = grid.support(x + feet[i][0], z + feet[i][1], y, step, _s); if (s[0] > g) g = s[0]; }
    return g;
  }
  w.fits = (x, z, y = pos[1]) => fits(x, z, y, B.step) !== null;
  function slide(sx, sz, step) {
    let nx = 0, nz = 0;
    const r = B.radius + 2 * cell, y = pos[1];
    for (const [dx, dz] of RIM) {
      const s = grid.support(pos[0] + dx * r, pos[2] + dz * r, y, step);
      if (!s || s[1] < Math.max(y, s[0]) + head) { nx -= dx; nz -= dz; }
    }
    const l = Math.hypot(nx, nz), k = l ? (sx * nx + sz * nz) / l / l : 0;
    if (k >= 0) return null;
    for (const out of [0, 0.25, 0.5, 1]) {
      const tx = sx - k * nx + (out * Math.hypot(sx, sz) * nx) / l, tz = sz - k * nz + (out * Math.hypot(sx, sz) * nz) / l;
      if (fits(pos[0] + tx, pos[2] + tz, y, step) !== null) return [tx, tz];
    }
    return null;
  }
  /** the walker's horizontal move: sub-steps, each the full move, else a slide, else one axis */
  function travel(mx, mz, step) {
    const subs = Math.max(1, Math.ceil(Math.hypot(mx, mz) / SUB));
    for (let s = 0; s < subs; s++) {
      const sx = mx / subs, sz = mz / subs;
      if (fits(pos[0] + sx, pos[2] + sz, pos[1], step) !== null) { pos[0] += sx; pos[2] += sz; continue; }
      w.blocked = true;
      const t = slide(sx, sz, step);
      if (t) { pos[0] += t[0]; pos[2] += t[1]; }
      else if (sx && fits(pos[0] + sx, pos[2], pos[1], step) !== null) pos[0] += sx;
      else if (sz && fits(pos[0], pos[2] + sz, pos[1], step) !== null) pos[2] += sz;
    }
  }
  /** the walker's vertical step: stand, step up / down, or fall and land */
  function vertical(dt, step, wantJump) {
    const g = fits(pos[0], pos[2], pos[1], step) ?? pos[1];
    if (wantJump) {
      // off a platform the body keeps the platform's velocity (a lift going up throws it a little higher)
      w.vy = B.jump + Math.max(0, pvy); w.onGround = false; jumping = true; tBuffer = 0; tCoyote = 0; ax += pvx; az += pvz;
      w.events.push('jump');
    }
    if (w.onGround && g >= pos[1] - B.step && (g >= pos[1] || fits(pos[0], pos[2], g, B.step) !== null)) { pos[1] = g; w.vy = 0; return; }
    w.vy -= B.gravity * dt;
    const y = pos[1] + w.vy * dt;
    if (fits(pos[0], pos[2], y, B.airStep) === null && (w.vy > 0 || grid.support(pos[0], pos[2], y, B.airStep))) { if (w.vy <= 0) w.onGround = true; w.vy = 0; return; }
    pos[1] = y;
    const g2 = fits(pos[0], pos[2], pos[1], B.airStep);
    if (g2 !== null && pos[1] <= g2) { pos[1] = g2; w.vy = 0; w.onGround = true; } else w.onGround = false;
  }
  /** the ground's gradient under the feet: [gx, gz] (rise per metre), 0 on an axis whose two sides disagree */
  function gradient(out) {
    const y = pos[1], c = grid.support(pos[0], pos[2], y, B.step, _s), h0 = c ? c[0] : y;   // the centre column's own floor (the feet stand on the highest of several)
    for (let a = 0; a < 2; a++) {
      const p = grid.support(pos[0] + (a ? 0 : cell), pos[2] + (a ? cell : 0), y, B.step, _s), hp = p ? p[0] - h0 : 0;
      const q = grid.support(pos[0] - (a ? 0 : cell), pos[2] - (a ? cell : 0), y, B.step, _s), hq = q ? h0 - q[0] : 0;
      out[a] = hp * hq > 0 ? (Math.abs(hp) < Math.abs(hq) ? hp : hq) / cell : 0;
    }
    return out;
  }
  const _g = [0, 0];
  /** a ledge to pull up onto in direction (dx, dz): its height, or NaN */
  function ledge(dx, dz) {
    const px = pos[0] + dx * (B.radius + B.mantleReach), pz = pos[2] + dz * (B.radius + B.mantleReach);
    const gl = grid.groundAt(px, pz, pos[1] + B.mantleMax, 0), h = gl - pos[1];
    if (!(h > B.step && h <= B.mantleMax)) return NaN;
    if (fits(px, pz, gl, 0.05, B.crouchHead) === null || fits(pos[0], pos[2], gl, 0, B.crouchHead) === null) return NaN;
    m1[0] = px; m1[1] = gl; m1[2] = pz;
    return gl;
  }
  /** moved out of whatever now overlaps the body (a door swung into it, a platform slid under a roof) */
  function depenetrate() {
    for (let r = 1; r <= 8; r++) for (let up = 0; up < 2; up++) for (const [dx, dz] of RIM) {
      const x = pos[0] + dx * r * cell * 0.5, z = pos[2] + dz * r * cell * 0.5, y = pos[1] + (up ? B.step : 0);
      const g = fits(x, z, y, B.step);
      if (g !== null) { pos[0] = x; pos[2] = z; if (g > pos[1] || up) pos[1] = Math.max(g, pos[1]); return true; }
    }
    return false;
  }

  /** remembers the solid under the feet and its pose: next step's carry is measured from here */
  function stand() {
    ride = null; w.ground = null;
    if (w.onGround && grid.groundSolid) {
      const s = grid.groundSolid(pos[0], pos[2], pos[1], 0.05);
      if (s) { ride = { id: s.id, x: s.pos[0], y: s.pos[1], z: s.pos[2], yaw: s.yaw }; w.ground = s; }
    }
  }

  w.update = (dt, input = {}) => {
    dt = Math.min(dt, 0.1);
    if (w.intent.crouch || w.intent.sprint) input = { ...input, crouch: input.crouch || w.intent.crouch, sprint: input.sprint || w.intent.sprint };
    const was = w.onGround, c = w.carry;
    w.blocked = false; w.events.length = 0;
    c[0] = c[1] = c[2] = c[3] = 0; pvx = pvy = pvz = 0;
    // 1. carried by the solid stood on: the point under the feet moves and turns with it
    if (ride) {
      const s = grid.solids.get(ride.id);
      if (s && (s.pos[0] !== ride.x || s.pos[1] !== ride.y || s.pos[2] !== ride.z || s.yaw !== ride.yaw)) {
        const da = s.yaw - ride.yaw, co = Math.cos(da), si = Math.sin(da), rx = pos[0] - ride.x, rz = pos[2] - ride.z;
        const nx = s.pos[0] + rx * co + rz * si, nz = s.pos[2] - rx * si + rz * co, dy = s.pos[1] - ride.y;
        c[1] = dy; pos[1] += dy;
        if (fits(nx, nz, pos[1], B.step) !== null) { c[0] = nx - pos[0]; c[2] = nz - pos[2]; c[3] = da; pos[0] = nx; pos[2] = nz; }
        if (dt > 0) { pvx = c[0] / dt; pvy = dy / dt; pvz = c[2] / dt; }
      }
    }
    // 2. something moved into the body: step out of it (only solids move, so a static grid never pays for this)
    w.squeezed = false;
    if (grid.solids && grid.solids.size && fits(pos[0], pos[2], pos[1], B.step) === null) w.squeezed = !depenetrate();

    const held = !!input.jump, pressed = (held && !prevJump) || !!input.jumpPressed;   // the edge comes from the held state: one bit on the wire is enough
    prevJump = held;
    if (pressed) tBuffer = B.buffer; else if (tBuffer > 0) tBuffer = Math.max(0, tBuffer - dt);
    const wantJump = pressed || tBuffer > 0;
    if (noClimb > 0) noClimb = Math.max(0, noClimb - dt);

    const x0 = pos[0], z0 = pos[2];
    if (mt >= 0) {
      // 3a. mantling: up the face, then over the edge; input waits
      mt += dt / B.mantleTime;
      const t = Math.min(1, mt), up = Math.min(1, t / 0.6), over = Math.max(0, (t - 0.6) / 0.4);
      pos[1] = m0[1] + (m1[1] - m0[1]) * up; pos[0] = m0[0] + (m1[0] - m0[0]) * over; pos[2] = m0[2] + (m1[2] - m0[2]) * over;
      w.vy = 0;
      if (t >= 1) { mt = -1; w.onGround = true; if (fits(pos[0], pos[2], pos[1], B.step, B.head) === null) w.crouched = true; }
    } else {
      // crouch: down at once, up only where there is room
      if (input.crouch) w.crouched = true;
      else if (w.crouched && fits(pos[0], pos[2], pos[1], w.onGround ? B.step : B.airStep, B.head) !== null) w.crouched = false;
      head = w.crouched ? B.crouchHead : B.head;
      let ix = input.x || 0, iz = input.z || 0;
      const water = volumes.length ? volumeAt(volumes, 'water', pos[0], pos[1] + 0.01, pos[2]) : null;
      const swimming = !!water && water.box[4] - pos[1] > B.swimDepth;
      const ladder = volumes.length && !noClimb ? volumeAt(volumes, 'ladder', pos[0], pos[1] + 0.5, pos[2]) : null;
      let fx = 0, fz = 0, into = 0;
      if (ladder) { const f = ladder.facing || [0, -1], l = Math.hypot(f[0], f[1]) || 1; fx = f[0] / l; fz = f[1] / l; into = ix * fx + iz * fz; }
      climbing = !!ladder && !swimming && (climbing ? !(w.onGround && into <= 0) : !w.onGround || into > 0.3);

      if (climbing) {
        // 3b. on a ladder: into the wall is up, away is down, sideways shuffles; jump lets go
        if (wantJump) { climbing = false; noClimb = 0.4; w.vy = B.jump * 0.7; ax = -fx * 2.5; az = -fz * 2.5; w.onGround = false; tBuffer = 0; jumping = true; w.events.push('jump'); }
        else {
          if (into < 0 && !w.onGround) { ix -= into * fx; iz -= into * fz; }
          travel(ix * B.climbSide * dt, iz * B.climbSide * dt, B.step);
          const g = fits(pos[0], pos[2], pos[1], B.step);
          if (g !== null && g > pos[1]) { pos[1] = g; w.onGround = true; climbing = false; }   // stepped onto the ledge at the top
          else {
            const y = pos[1] + into * B.climb * dt;
            if (fits(pos[0], pos[2], y, 0) !== null) pos[1] = y;
            else if (into < 0) travel(into * fx * B.climb * dt, into * fz * B.climb * dt, B.step);   // the ledge is under part of the body: out from the wall first
            const g2 = fits(pos[0], pos[2], pos[1], 0);
            w.onGround = g2 !== null && pos[1] <= g2 + 1e-9;
            if (w.onGround) pos[1] = g2;
          }
          w.vy = 0; ax = az = 0;
        }
      } else if (swimming) {
        // 3c. swimming: floats with the head out, jump rises, crouch dives; a rising bed walks it out
        travel(ix * B.swim * dt, iz * B.swim * dt, B.step);
        const g = fits(pos[0], pos[2], pos[1], B.step);
        if (g !== null && g > pos[1]) pos[1] = g;
        const float = water.box[4] - B.swimFloat, want = held ? B.swimUp : input.crouch ? -B.swimUp : Math.max(-1, Math.min(1, (float - pos[1]) * 5));
        w.vy += (want - w.vy) * Math.min(1, dt * 6);
        let y = pos[1] + w.vy * dt;
        if (w.vy > 0 && y > float) { y = Math.max(float, pos[1]); w.vy = 0; }   // the surface: no higher (a mantle takes it out)
        if (fits(pos[0], pos[2], y, 0) !== null) pos[1] = y; else w.vy = 0;
        const g2 = fits(pos[0], pos[2], pos[1], 0);
        if (g2 !== null && pos[1] < g2) pos[1] = g2;
        w.onGround = false; ax = az = 0; jumping = false; w.crouched = false;
      } else {
        // 3d. on foot or in the air: the walker's move with the speed, slope and jump rules on top
        let speed = w.crouched ? B.crouchSpeed : input.sprint ? B.sprint : input.run ? B.run : B.walk;
        if (water) speed *= 0.6;   // wading
        let sliding = false;
        if (w.onGround && slopeTan !== Infinity) {
          gradient(_g);
          const steep = Math.hypot(_g[0], _g[1]);
          if (steep > slopeTan) {
            sliding = true;
            const dx = -_g[0] / steep, dz = -_g[1] / steep, up = ix * dx + iz * dz;
            if (up < 0) { ix -= up * dx; iz -= up * dz; }   // no walking up it
            svx += dx * B.slideAccel * dt; svz += dz * B.slideAccel * dt;
            const sv = Math.hypot(svx, svz);
            if (sv > B.slideMax) { svx *= B.slideMax / sv; svz *= B.slideMax / sv; }
          }
        }
        if (!sliding) svx = svz = 0;
        const step = w.onGround ? B.step : B.airStep;
        travel((ix * speed + ax + svx) * dt, (iz * speed + az + svz) * dt, step);
        if (w.blocked && (ax || az)) { ax *= 0.5; az *= 0.5; }
        const jumpNow = wantJump && !sliding && (w.onGround || tCoyote > 0);
        vertical(dt, step, jumpNow);
        // variable height: letting go of jump on the way up cuts the rise once
        if (jumping && (w.vy <= 0 || w.onGround)) jumping = false;
        else if (jumping && !held) { w.vy *= B.jumpCut; jumping = false; }
        if (w.onGround) { ax = az = 0; tCoyote = 0; }
        else if (was && !jumpNow) tCoyote = B.coyote;
        else if (tCoyote > 0) tCoyote = Math.max(0, tCoyote - dt);
        w.sliding = sliding;
        // pushing a dynamic solid it walks into
        if (w.blocked && grid.push && (ix || iz)) {
          const l = Math.hypot(ix, iz), dx = ix / l, dz = iz / l, px = pos[0] + dx * (B.radius + cell), pz = pos[2] + dz * (B.radius + cell);
          const s = grid.solidAt(px, pos[1] + 0.25, pz) || grid.solidAt(px, pos[1] + 0.9, pz);
          if (s && s.kind === 'dynamic') grid.push(s, dx * B.push * dt, 0, dz * B.push * dt, px, pos[1] + 0.6, pz);
        }
      }
      // mantle: holding jump against a ledge, off the ground (or in water)
      if (held && !w.onGround && (ix || iz) && B.mantleMax > B.step && (swimming || (w.blocked && w.vy < B.jump * 0.6))) {
        const l = Math.hypot(ix, iz);
        m0[0] = pos[0]; m0[1] = pos[1]; m0[2] = pos[2];
        if (!Number.isNaN(ledge(ix / l, iz / l))) { mt = 0; w.vy = 0; ax = az = 0; jumping = false; climbing = false; tBuffer = 0; }
      }
      w.swimming = swimming && mt < 0;
    }

    // 4. what it stands on now, and what the animator wants to know
    stand();
    if (w.onGround && !was) w.events.push('land');
    w.speed = dt > 0 ? Math.hypot(pos[0] - x0, pos[2] - z0) / dt : 0;
    w.mode = mt >= 0 ? 'mantle' : climbing ? 'climb' : w.swimming ? 'swim' : w.sliding && w.onGround ? 'slide' : !w.onGround ? (w.vy > 0 ? 'jump' : 'fall')
      : w.crouched ? 'crouch' : w.speed < 0.05 ? 'idle' : w.speed > (B.run + B.sprint) / 2 ? 'sprint' : w.speed > (B.walk + B.run) / 2 ? 'run' : 'walk';
    w.eye += ((w.crouched ? B.crouchEye : B.eye) - w.eye) * Math.min(1, dt * 10);
    return w;
  };
  w.sliding = false; w.swimming = false;
  w.place = (p) => {
    pos[0] = p[0]; pos[2] = p[2];
    const g = grid.groundAt(p[0], p[2], p[1] ?? 1e4, 0.5);
    pos[1] = Number.isNaN(g) ? p[1] ?? 0 : g; w.vy = 0; w.onGround = !Number.isNaN(g);
    tCoyote = tBuffer = ax = az = svx = svz = noClimb = 0; jumping = climbing = false; mt = -1; stand();
    return w;
  };
  /** everything update() reads besides the input and the world: restore(save()) then the same inputs gives the same path */
  w.save = () => ({
    x: pos[0], y: pos[1], z: pos[2], vy: w.vy, onGround: w.onGround, crouched: w.crouched, eye: w.eye, mode: w.mode,
    t: [tCoyote, tBuffer, noClimb, mt, ax, az, svx, svz], f: (prevJump ? 1 : 0) | (jumping ? 2 : 0) | (climbing ? 4 : 0) | (w.sliding ? 8 : 0) | (w.swimming ? 16 : 0),
    m: mt >= 0 ? [...m0, ...m1] : null, ride: ride && { ...ride },
  });
  w.restore = (s) => {
    pos[0] = s.x; pos[1] = s.y; pos[2] = s.z; w.vy = s.vy; w.onGround = !!s.onGround; w.blocked = false;
    if (!s.t) { w.place([s.x, s.y, s.z]); pos[1] = s.y; w.vy = s.vy; w.onGround = !!s.onGround; return w; }   // a walker's save: the rest starts clean
    w.crouched = !!s.crouched; w.eye = s.eye; w.mode = s.mode; head = w.crouched ? B.crouchHead : B.head;
    [tCoyote, tBuffer, noClimb, mt, ax, az, svx, svz] = s.t;
    prevJump = !!(s.f & 1); jumping = !!(s.f & 2); climbing = !!(s.f & 4); w.sliding = !!(s.f & 8); w.swimming = !!(s.f & 16);
    if (s.m) { m0 = s.m.slice(0, 3); m1 = s.m.slice(3); }
    ride = s.ride ? { ...s.ride } : null;
    return w;
  };
  if (opts.pos) w.place(opts.pos);
  return w;
}

/** feed an animator (createAnimator) from a mover: parameters speed, vy, grounded, crouch, mode (index into MODES) and
 *  one per mode name (1 while in it); triggers 'jump' and 'land' on the step they happen. Call after mover.update. */
export function driveAnimator(m, anim) {
  anim.set('speed', m.speed).set('vy', m.vy).set('grounded', m.onGround ? 1 : 0).set('crouch', m.crouched ? 1 : 0).set('mode', MODES.indexOf(m.mode));
  for (const k of MODES) anim.set(k, m.mode === k ? 1 : 0);
  for (const e of m.events) anim.trigger(e);
  return anim;
}
