// Node checks of mover.js, solids.js, follow-camera.js and physics-link.js on a hand-made walk grid: the mover with
// its extras off IS the walker (bit for bit), then each extra, the moving solids, the two-worlds rule against a real
// Rapier world, the cameras, determinism and save / restore, and the step cost.
import { makeGrid, MAXL } from './src/walkgrid.js';
import { createWalker, BODY } from './src/walker.js';
import { createMover, MOVER, MODES, driveAnimator } from './src/mover.js';
import { createSolids, gridRay, airAt } from './src/solids.js';
import { createFollowCamera } from './src/follow-camera.js';
import { linkSolids } from './src/physics-link.js';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('  ok', m); };
const cell = 0.125, DT = 1 / 60, T30 = Math.tan(Math.PI / 6), T60 = 1;
function gridOf(nx, nz, x0, z0, layers) {
  const floors = new Float32Array(nx * nz * MAXL * 2), count = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, L = layers(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);
    count[k] = L.length;
    L.forEach(([f, c], l) => { floors[(k * MAXL + l) * 2] = f; floors[(k * MAXL + l) * 2 + 1] = c; });
  }
  return makeGrid({ nx, nz, x0, z0, cell, floors, count });
}
const inb = (x, z, x0, x1, z0, z1) => x > x0 && x < x1 && z > z0 && z < z1;
// 30 x 20 m: a low tunnel, a 30 and a 45 degree ramp (T60: the steep one), stairs, two boxes, a 1.5 m ledge, a pool with a beach, a void
const grid = gridOf(240, 160, -15, -10, (x, z) => {
  if (inb(x, z, -14, -12, -2, 2)) return [[0, 1.3], [1.5, Infinity]];
  if (inb(x, z, -10, -8, 0, 4)) return [[z * T30, Infinity]];
  if (inb(x, z, -10, -8, 4, 6)) return [[4 * T30, Infinity]];
  if (inb(x, z, -7, -5, 0, 2)) return [[z * T60, Infinity]];
  if (inb(x, z, -7, -5, 2, 4)) return [[2 * T60, Infinity]];
  if (inb(x, z, -4, -2, 0, 3)) return [[0.17 * Math.ceil(z / 0.3), Infinity]];
  if (inb(x, z, 0, 1, 0, 1)) return [[0.375, Infinity]];
  if (inb(x, z, 0, 1, 2, 3)) return [[0.5, Infinity]];
  if (inb(x, z, 3, 6, 2, 5)) return [[1.5, Infinity]];
  if (inb(x, z, 8, 10, -8, -3)) return [[-2.5, Infinity]];
  if (inb(x, z, 10, 13, -8, -3)) return [[-2.5 + ((x - 10) / 3) * 2.5, Infinity]];
  if (inb(x, z, 8, 13, 2, 6)) return [];
  return [[0, Infinity]];
});
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const step = (m, n, input, each) => { for (let i = 0; i < n; i++) { m.update(DT, typeof input === 'function' ? input(i) : input); if (each) each(i); } return m; };
const same = (a, b) => a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.pos[2] === b.pos[2] && a.vy === b.vy && a.onGround === b.onGround && a.blocked === b.blocked;

// ---- 1. extras off: the walker, bit for bit (on the bare grid and through an empty createSolids) ----
{
  const plain = { coyote: 0, buffer: 0, jumpCut: 1, slope: 90, mantleMax: 0 };
  const w = createWalker(grid, { pos: [-1, 0, -3] }), m = createMover(grid, { pos: [-1, 0, -3], body: plain }), s = createMover(createSolids(grid), { pos: [-1, 0, -3], body: plain });
  let diff = 0, jumps = 0, dir = 0, run = false, prev = false;
  for (let i = 0; i < 6000; i++) {
    if (i % 40 === 0) { dir = rnd() * Math.PI * 2; run = rnd() < 0.6; }
    const jump = !prev && rnd() < 0.03; prev = jump; if (jump) jumps++;
    const inp = { x: Math.cos(dir), z: Math.sin(dir), run, jump };
    w.update(DT, inp); m.update(DT, inp); s.update(DT, inp);
    if (!same(w, m) || !same(w, s)) diff++;
  }
  ok(diff === 0, `extras off: 6000 steps, ${jumps} jumps, identical to createWalker (mover and mover over empty solids)`);
}

// ---- 2. jump: coyote, buffer, variable height, no repeat while held ----
{
  const off = (late) => {   // walk off the 1.5 m ledge to the south (z < 2), press jump `late` steps after leaving the ground
    const m = createMover(grid, { pos: [4.5, 1.5, 2.6] });
    let left = -1, rose = false;
    for (let i = 0; i < 200 && m.pos[1] > 0.05; i++) {
      if (left < 0 && !m.onGround && i > 0) left = i;
      m.update(DT, { x: 0, z: -1, run: true, jump: left >= 0 && i - left >= late && i - left < late + 2 });
      if (m.vy > 1) rose = true;
    }
    return rose;
  };
  ok(off(3) && !off(12), `coyote: a jump ${(3 * DT * 1000).toFixed(0)} ms after the edge still jumps, ${(12 * DT * 1000).toFixed(0)} ms after does not (window ${MOVER.coyote * 1000} ms)`);
  const fall = (early) => {   // dropped from 1 m, jump pressed `early` steps before landing
    const m = createMover(grid, { pos: [-1, 0, -5] }); m.pos[1] = 1; m.onGround = false;
    const land = (() => { const p = createMover(grid, { pos: [-1, 0, -5] }); p.pos[1] = 1; p.onGround = false; let i = 0; while (!p.onGround) { p.update(DT, {}); i++; } return i; })();
    let jumped = false;
    for (let i = 0; i < land + 10; i++) { m.update(DT, { jump: i === land - early }); if (m.vy > 1) jumped = true; }
    return jumped;
  };
  ok(fall(5) && !fall(14), `buffer: a press 83 ms before landing jumps on landing, 233 ms before does not (window ${MOVER.buffer * 1000} ms)`);
  const apex = (hold) => { const m = createMover(grid, { pos: [-1, 0, -5] }); let top = 0; step(m, 90, (i) => ({ jump: i < hold }), () => { top = Math.max(top, m.pos[1]); }); return top; };
  const hi = apex(60), lo = apex(4);
  ok(hi > 0.85 && lo < hi * 0.6, `variable height: held ${hi.toFixed(2)} m, tapped ${lo.toFixed(2)} m`);
  const m = createMover(grid, { pos: [-1, 0, -5] }); let n = 0;
  step(m, 240, { jump: true }, () => { if (m.events.includes('jump')) n++; });
  ok(n === 1, 'a held jump jumps once');
}

// ---- 3. crouch with a ceiling check, sprint ----
{
  const a = createMover(grid, { pos: [-13, 0, -4] });
  step(a, 300, { x: 0, z: 1, run: true });
  ok(a.pos[2] < -2, `standing: stopped at the 1.3 m tunnel (z ${a.pos[2].toFixed(2)})`);
  const b = createMover(grid, { pos: [-13, 0, -4] });
  step(b, 240, { x: 0, z: 1, crouch: true });
  ok(b.pos[2] > -1.5 && b.pos[2] < 1.5 && b.mode === 'crouch', `crouched: inside the tunnel (z ${b.pos[2].toFixed(2)}), mode ${b.mode}`);
  step(b, 30, {});
  ok(b.crouched && b.eye < 1, `crouch released under the ceiling: still crouched, eye ${b.eye.toFixed(2)} m`);
  step(b, 400, { x: 0, z: 1 });
  ok(!b.crouched && b.pos[2] > 2 && Math.abs(b.eye - BODY.eye) < 0.02, `out of the tunnel it stands up (z ${b.pos[2].toFixed(2)}, eye ${b.eye.toFixed(2)})`);
  const c = createMover(grid, { pos: [-1, 0, -8] });
  step(c, 60, { x: 1, z: 0, sprint: true });
  ok(Math.abs(c.speed - MOVER.sprint) < 0.01 && c.mode === 'sprint', `sprint: ${c.speed.toFixed(2)} m/s, mode ${c.mode}`);
  step(c, 2, { x: 1, z: 0, run: true }); ok(c.mode === 'run', 'run mode'); step(c, 2, { x: 1, z: 0 }); ok(c.mode === 'walk', 'walk mode'); step(c, 2, {}); ok(c.mode === 'idle', 'idle mode');
}

// ---- 4. slopes, stairs, steps ----
{
  const a = createMover(grid, { pos: [-9, 0, -1] });
  let slid = false, ya = 0;
  step(a, 420, { x: 0, z: 1, run: true }, () => { if (a.mode === 'slide') slid = true; ya = Math.max(ya, a.pos[1]); });
  ok(ya > 2.3 && !slid, `30 degree ramp: walked up to the top (y ${ya.toFixed(2)})`);
  const b = createMover(grid, { pos: [-6, 0, -1] });
  let top = 0, sl = false;
  step(b, 600, { x: 0, z: 1, run: true }, () => { top = Math.max(top, b.pos[1]); if (b.mode === 'slide') sl = true; });
  ok(top < 0.8 && sl, `45 degree ramp (limit ${MOVER.slope}): never above ${top.toFixed(2)} m of 2.00, slid back`);
  const w = createWalker(grid, { pos: [-6, 0, -1] });
  step(w, 600, { x: 0, z: 1, run: true });
  let yw = 0; step(w, 0, {}); { const w2 = createWalker(grid, { pos: [-6, 0, -1] }); step(w2, 120, { x: 0, z: 1, run: true }, () => { yw = Math.max(yw, w2.pos[1]); }); }
  ok(yw > 1.9, `(the plain walker walks straight up it: y ${yw.toFixed(2)})`);
  const c = createMover(grid, { pos: [-6, 3, 1.5] });
  ok(c.pos[1] > 1.3, 'placed half way up the steep ramp');
  step(c, 240, {});
  ok(c.pos[1] < 0.3 && c.pos[2] < 0.3, `left alone on it: slid to the bottom (z ${c.pos[2].toFixed(2)})`);
  const d = createMover(grid, { pos: [-3, 0, -1] });
  let s2 = false, yd = 0;
  step(d, 300, { x: 0, z: 1, run: true }, () => { if (d.mode === 'slide') s2 = true; yd = Math.max(yd, d.pos[1]); });
  ok(yd > 1.6 && !s2, `stairs (0.17 m risers, 30 degree pitch): climbed, never a slide (y ${yd.toFixed(2)})`);
  const e = createMover(grid, { pos: [0.5, 0, -1] }); step(e, 50, { x: 0, z: 1 });
  const f = createMover(grid, { pos: [0.5, 0, 1.5] }); step(f, 120, { x: 0, z: 1 });
  ok(Math.abs(e.pos[1] - 0.375) < 1e-6 && f.pos[1] === 0 && f.pos[2] < 2, `step up: 0.375 m taken (y ${e.pos[1].toFixed(2)}), 0.5 m refused (y ${f.pos[1].toFixed(2)})`);
}

// ---- 5. moving solids: lift, turntable, a platform over a void, a door ----
{
  const space = createSolids(grid);
  const lift = space.add({ box: [1, 0.1, 1], pos: [-1, -0.1 + 0.2, -7], name: 'lift' });   // top at 0.2: stepped onto
  const m = createMover(space, { pos: [-1, 0, -5] });
  step(m, 80, { x: 0, z: -1 });
  step(m, 30, {});
  ok(m.ground === lift && Math.abs(m.pos[1] - 0.2) < 1e-9, 'stepped onto the lift (a solid top is a floor)');
  let off = 0;
  for (let i = 1; i <= 180; i++) { lift.set({ pos: [-1, 0.1 + i / 60, -7] }); m.update(DT, {}); if (!m.onGround || m.ground !== lift) off++; }
  ok(off === 0 && Math.abs(m.pos[1] - 3.2) < 1e-6, `lift 1 m/s up for 3 s: on it every step, feet at ${m.pos[1].toFixed(3)} m`);
  for (let i = 1; i <= 90; i++) { lift.set({ pos: [-1, 3.1 - i / 30, -7] }); m.update(DT, {}); if (!m.onGround) off++; }
  ok(off === 0 && Math.abs(m.pos[1] - 0.2) < 1e-6, `and 2 m/s down: never left the floor (feet ${m.pos[1].toFixed(3)} m)`);
  lift.set({ pos: [-1, 0.1 + 1 / 60, -7] });
  m.update(DT, { jump: true });
  ok(m.vy > MOVER.jump, `a jump off a rising lift keeps its speed (vy ${m.vy.toFixed(2)} > ${MOVER.jump})`);

  const table = space.add({ cylinder: [2, 0.1], pos: [-8, 0.1, -6], name: 'turntable' });
  const t = createMover(space, { pos: [-7, 1, -6] });
  ok(t.pos[1] === 0.2, 'placed on the turntable');
  const cam = createFollowCamera(space, { mode: 'first' });
  let turned = 0;
  for (let i = 1; i <= 240; i++) { table.set({ yaw: (i / 240) * Math.PI }); t.update(DT, {}); turned += t.carry[3]; cam.update(DT, t); }
  ok(Math.abs(t.pos[0] - -9) < 0.01 && Math.abs(t.pos[2] - -6) < 0.01, `half a turn carried it to the far side (${t.pos[0].toFixed(3)}, ${t.pos[2].toFixed(3)})`);
  ok(Math.abs(turned - Math.PI) < 1e-9 && Math.abs(cam.yaw - Math.PI) < 1e-9, 'and turned it (and its camera) half a turn');

  const raft = space.add({ box: [1, 0.1, 1], pos: [7, -0.1, 4], name: 'raft' });   // top at 0, flush with the ground, sliding over the void
  const r = createMover(space, { pos: [7, 0, 4] });
  for (let i = 1; i <= 300; i++) { raft.set({ pos: [7 + (i / 300) * 7, -0.1, 4] }); r.update(DT, {}); }
  ok(r.onGround && Math.abs(r.pos[0] - 14) < 1e-6 && r.pos[1] === 0, `a raft carried it 7 m across a void (x ${r.pos[0].toFixed(3)})`);
  const v = createMover(space, { pos: [7.5, 0, 3] }); v.place([9, 0, 3]);
  step(v, 60, {});
  ok(v.pos[1] < -3, 'with no raft under it the void is a fall');

  // a door: a kinematic leaf across a 1 m gap between two wall solids
  space.add({ box: [2, 1.2, 0.1], pos: [-3.5, 1.2, -4], kind: 'static' }); space.add({ box: [2, 1.2, 0.1], pos: [1.5, 1.2, -4], kind: 'static' });
  const door = space.add({ box: [0.5, 1.1, 0.05], pos: [-1, 1.1, -4], name: 'door' });
  const p = createMover(space, { pos: [-1, 0, -2.5] });
  step(p, 180, { x: 0, z: -1, run: true });
  ok(p.pos[2] > -3.8 && p.blocked, `door closed: stopped at z ${p.pos[2].toFixed(2)}`);
  door.set({ pos: [-1.45, 1.1, -4.5], yaw: Math.PI / 2 });   // swung open about its hinge
  step(p, 120, { x: 0, z: -1, run: true });
  ok(p.pos[2] < -4.5, `door open: through (z ${p.pos[2].toFixed(2)})`);
  // a leaf swung INTO the body moves it out
  const q = createMover(space, { pos: [-1, 0, -3.6] });
  door.set({ pos: [-1, 1.1, -3.6], yaw: 0 });
  q.update(DT, {});
  ok(!q.squeezed && q.fits(q.pos[0], q.pos[2]) && Math.hypot(q.pos[0] - -1, q.pos[2] - -3.6) < 0.6, `a door closed onto the body pushed it out by ${Math.hypot(q.pos[0] + 1, q.pos[2] + 3.6).toFixed(2)} m`);
  ok(space.layers(-1, -3.6).length === 1 && Math.abs(space.layers(-1, -3.6)[0][0] - 2.2) < 1e-9 && grid.layers(-1, -3.6)[0][0] === 0, 'space.layers shows the leaf cut out of the column');
  ok(gridRay(space, [-1, 1, -3], [-1, 1, -4.2]) < 0.7 && gridRay(grid, [-1, 1, -3], [-1, 1, -4.2]) === 1 && airAt(space, 5, 1, -9), 'gridRay stops at the leaf, not on the bare grid');
  door.remove();
  ok(space.solidAt(-1, 1, -3.6) === null, 'removed solids are gone');
}

// ---- 6. ladder, water, mantle ----
{
  const space = createSolids(grid);
  space.addVolume({ type: 'ladder', box: [4, 0, 1.6, 5, 2.2, 2], facing: [0, 1] });
  const m = createMover(space, { pos: [4.5, 0, 0.5] });
  let climbed = false, topped = false;
  step(m, 400, { x: 0, z: 1 }, () => { if (m.mode === 'climb') climbed = true; if (m.onGround && Math.abs(m.pos[1] - 1.5) < 1e-6 && m.pos[2] > 2.2) topped = true; });
  ok(climbed && topped, 'ladder: climbed the 1.5 m face and stepped off the top onto the ledge');
  m.place([4.5, 1.5, 2.4]);
  let down = false;
  step(m, 400, { x: 0, z: -1 }, () => { if (m.mode === 'climb' && m.vy === 0 && m.pos[1] < 1.4 && m.pos[1] > 0.1) down = true; });
  ok(down && m.pos[1] === 0, 'and back down it, backing off the edge');
  m.place([4.5, 0, 1.2]); step(m, 60, { x: 0, z: 1 });
  const y = m.pos[1]; m.update(DT, { x: 0, z: 1, jump: true }); step(m, 20, {});
  ok(y > 0.5 && m.mode !== 'climb' && m.pos[2] < 1.7, 'jump lets go of the ladder, away from the wall');

  space.addVolume({ type: 'water', box: [8, -2.5, -8, 13, -0.1, -3] });
  const s = createMover(space, { pos: [7, 0, -5.5] });
  let swam = false;
  step(s, 40, { x: 1, z: 0, run: true }); step(s, 150, {}, () => { if (s.mode === 'swim') swam = true; });
  ok(swam && Math.abs(s.pos[1] - (-0.1 - MOVER.swimFloat)) < 0.05 && s.pos[0] > 8.5, `water: walked off the edge, floats with the head out (feet ${s.pos[1].toFixed(2)} m, mode ${s.mode})`);
  step(s, 60, { crouch: true }); const deep = s.pos[1];
  step(s, 120, { jump: true });
  ok(deep < -2.2 && Math.abs(s.pos[1] - (-0.1 - MOVER.swimFloat)) < 0.05, `crouch dives (${deep.toFixed(2)} m), jump surfaces`);
  step(s, 500, { x: 1, z: 0 });
  ok(s.mode !== 'swim' && s.onGround && s.pos[0] > 12.5, `swam to the beach and walked out (x ${s.pos[0].toFixed(2)}, y ${s.pos[1].toFixed(2)})`);
  const e = createMover(space, { pos: [7, 0, -5.5] });
  step(e, 120, { x: 1, z: 0, run: true }); step(e, 60, { x: -1, z: 0 });
  let man = false;
  step(e, 170, { x: -1, z: 0, jump: true }, (i) => { if (e.mode === 'mantle') man = true; if (process.env.DBG) console.log(i, e.pos.map((v) => v.toFixed(3)).join(' '), e.mode, e.blocked); });
  ok(man && e.onGround && e.pos[1] === 0 && e.pos[0] < 8, `out of the pool over its edge: a mantle from the water (x ${e.pos[0].toFixed(2)})`);

  const a = createMover(grid, { pos: [4.5, 0, 6.2] });
  let mant = false, up = false;
  step(a, 150, { x: 0, z: -1, run: true, jump: true }, () => { if (a.mode === 'mantle') mant = true; if (mant && a.onGround && a.pos[1] === 1.5 && a.pos[2] < 5) up = true; });
  ok(mant && up, 'mantle: jump held at a 1.5 m ledge pulls up onto it');
  const b = createMover(grid, { pos: [4.5, 0, 6.2], body: { mantleMax: 0.5 } });
  let yb = 0; step(b, 150, { x: 0, z: -1, run: true, jump: true }, () => { yb = Math.max(yb, b.pos[1]); });
  ok(yb < 1.4 && b.pos[2] > 5, 'a ledge more than mantleMax above the feet (0.5 m here, at the top of the jump) is not climbed');
}

// ---- 7. the animator's view ----
{
  const params = {}, fired = [];
  const anim = { set(k, v) { params[k] = v; return anim; }, trigger(k) { fired.push(k); return anim; } };
  const m = createMover(grid, { pos: [-1, 0, -8] });
  step(m, 100, (i) => ({ x: 1, z: 0, run: true, jump: i === 10 }), () => driveAnimator(m, anim));
  ok(fired.join() === 'jump,land' && params.run === 1 && params.mode === MODES.indexOf('run') && params.grounded === 1 && Math.abs(params.speed - BODY.run) < 0.01, `driveAnimator: jump, land fired; speed ${params.speed.toFixed(2)}, mode ${MODES[params.mode]}`);
}

// ---- 8. cameras ----
{
  const space = createSolids(grid);
  const m = createMover(space, { pos: [-1, 0, -8] });
  const cam = createFollowCamera(space, { distance: 4, shoulder: 0 });
  step(m, 2, {}); for (let i = 0; i < 120; i++) cam.update(DT, m);
  ok(Math.abs(cam.arm - 4) < 1e-6 && Math.abs(cam.position[2] - -4) < 1e-6, `third person in the open: the arm is its full ${cam.arm.toFixed(2)} m`);
  const wall = space.add({ box: [3, 2, 0.1], pos: [-1, 2, -6.5] });
  cam.update(DT, m);
  ok(cam.arm < 1.4 && cam.position[2] < -6.6 && airAt(space, ...cam.position), `a wall 1.5 m behind: the arm snaps to ${cam.arm.toFixed(2)} m in one step, the camera in front of it`);
  wall.remove(); cam.update(DT, m);
  const a1 = cam.arm; for (let i = 0; i < 180; i++) cam.update(DT, m);
  ok(a1 < 1.8 && Math.abs(cam.arm - 4) < 0.01, `wall gone: eases back out (${a1.toFixed(2)} m after one step, ${cam.arm.toFixed(2)} m after 3 s)`);
  cam.mode = 'first'; cam.update(DT, m);
  const e0 = cam.position[1]; step(m, 40, { crouch: true }); cam.update(DT, m);
  ok(Math.abs(e0 - BODY.eye) < 1e-9 && Math.abs(cam.position[1] - MOVER.crouchEye) < 0.02, `first person: eye ${e0.toFixed(2)} m, crouched ${cam.position[1].toFixed(2)} m`);
}

// ---- 9. determinism and save / restore with everything on ----
{
  const build = () => {
    const space = createSolids(grid);
    space.addVolume({ type: 'ladder', box: [4, 0, 1.6, 5, 2.2, 2], facing: [0, 1] }); space.addVolume({ type: 'water', box: [8, -2.5, -8, 13, -0.1, -3] });
    const lift = space.add({ box: [1, 0.1, 1], pos: [-1, 0.1, -7] }), table = space.add({ cylinder: [2, 0.1], pos: [-8, 0.1, -6] });
    const pose = (i) => { lift.set({ pos: [-1, 0.1 + 1.5 * (1 - Math.cos(i / 90)), -7] }); table.set({ yaw: i / 120 }); };
    return { m: createMover(space, { pos: [-1, 0, -5] }), pose };
  };
  seed = 777;
  const inputs = []; let dir = 0, run = false, sprint = false, crouch = false, jump = false;
  for (let i = 0; i < 5000; i++) {
    if (i % 30 === 0) { dir = rnd() * Math.PI * 2; run = rnd() < 0.5; sprint = rnd() < 0.3; crouch = rnd() < 0.15; }
    if (i % 7 === 0) jump = rnd() < 0.25;
    inputs.push({ x: Math.cos(dir), z: Math.sin(dir), run, sprint, crouch, jump });
  }
  const A = build(), B = build(), modes = new Set();
  let diff = 0, snap = null, at = [];
  for (let i = 0; i < 5000; i++) {
    A.pose(i); B.pose(i); A.m.update(DT, inputs[i]); B.m.update(DT, inputs[i]);
    if (!same(A.m, B.m) || A.m.mode !== B.m.mode) diff++;
    modes.add(A.m.mode);
    if (i === 2499) snap = JSON.parse(JSON.stringify(A.m.save()));
    if (i >= 2500) at.push([...A.m.pos, A.m.vy, A.m.mode]);
  }
  ok(diff === 0, `two movers, 5000 steps of random input over moving solids: identical (modes seen: ${[...modes].join(' ')})`);
  A.m.restore(snap);
  let bad = 0;
  for (let i = 2500; i < 5000; i++) { A.pose(i); A.m.update(DT, inputs[i]); const r = at[i - 2500]; if (r[0] !== A.m.pos[0] || r[1] !== A.m.pos[1] || r[2] !== A.m.pos[2] || r[3] !== A.m.vy || r[4] !== A.m.mode) bad++; }
  ok(bad === 0, 'restore(save()) at step 2500 (through JSON) and replay: the same 2500 steps, bit for bit');
}

// ---- 10. the rule against a real Rapier world: one description, the same answer in both ----
{
  let R = null;
  try { R = (await import('../game/node_modules/@dimforge/rapier3d-compat/rapier.mjs')).default; await R.init(); } catch { console.log('  skip: Rapier not installed (packages/game/node_modules): the two-worlds checks did not run'); }
  if (R) {
    const world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    world.createCollider(R.ColliderDesc.cuboid(15, 0.5, 10).setTranslation(0, -0.5, 0));   // the ground slab under the test area
    const space = createSolids(grid), link = linkSolids(space, { R, world });
    const crate = space.add({ box: [0.4, 0.4, 0.4], pos: [-1, 0.4, -8], kind: 'dynamic', mass: 20, name: 'crate' });
    const door = space.add({ box: [0.5, 1.1, 0.05], pos: [3, 1.1, -8], name: 'door' });
    const barrel = space.add({ cylinder: [0.35, 0.5], pos: [1, 0.5, -6], kind: 'dynamic', mass: 15 });
    const m = createMover(space, { pos: [-3, 0, -8] });
    link.addMover(m);
    const tick = (input) => { link.pre(); world.step(); link.post(); m.update(DT, input); };
    for (let i = 0; i < 30; i++) tick({});
    // (a) the same point is inside the same solid in both worlds: 4000 random points round the three solids
    let agree = 0, total = 0;
    const inRapier = (p) => { let hit = false; world.intersectionsWithPoint({ x: p[0], y: p[1], z: p[2] }, (c) => { if (c.parent() && [crate, door, barrel].some((s) => link.body(s).handle === c.parent().handle)) hit = true; return !hit; }); return hit; };
    door.set({ yaw: 0.7 }); tick({});
    for (let i = 0; i < 4000; i++) {
      const s = [crate, door, barrel][i % 3], p = [s.pos[0] + (rnd() - 0.5) * 1.6, s.pos[1] + (rnd() - 0.5) * 2.6, s.pos[2] + (rnd() - 0.5) * 1.6];
      total++; if (!!space.solidAt(p[0], p[1], p[2]) === inRapier(p)) agree++; else if (process.env.DBG) { const b = link.body(s).translation(), r = link.body(s).rotation(); console.log('disagree', s.name, p, 'solid', s.pos, s.quat, 'rapier', b, r, !!space.solidAt(p[0], p[1], p[2])); }
    }
    // a point within float32 rounding of a surface (the pose crosses Rapier's f32) may fall either side: 1 in 1000 allowed, the count printed
    ok(agree >= total * 0.999, `inside / outside: ${agree} of ${total} random points agree between the grid's solids and Rapier's colliders (box, turned box, cylinder)`);
    // (b) the mover pushes the crate: it moves in Rapier, comes back to the grid, and they never overlap
    const x0 = crate.pos[0];
    let overlap = 0, worst = 0;
    const cap = R.ColliderDesc.capsule(MOVER.head / 2 - MOVER.radius, MOVER.radius);
    for (let i = 0; i < 360; i++) {
      tick({ x: 1, z: 0 });
      const b = link.body(crate).translation();
      worst = Math.max(worst, Math.hypot(b.x - crate.pos[0], b.y - crate.pos[1], b.z - crate.pos[2]));
      if (!m.fits(m.pos[0], m.pos[2])) overlap++;
    }
    ok(crate.pos[0] - x0 > 1 && overlap === 0, `walking into a 20 kg crate pushed it ${(crate.pos[0] - x0).toFixed(2)} m; the mover never stood inside it`);
    ok(worst < 1e-6, `the crate's pose in the grid is Rapier's after every step (worst gap ${worst.toExponential(1)} m)`);
    void cap;
    // (c) a kinematic door: set in the game, the same pose in Rapier after one step, and it shoves the barrel
    door.set({ pos: [1, 1.1, -6.6], yaw: 0 }); tick({});
    const t = link.body(door).translation(), z0 = barrel.pos[2];
    for (let i = 1; i <= 60; i++) { door.set({ pos: [1, 1.1, -6.6 + i * 0.01] }); tick({}); }
    ok(Math.abs(t.z - -6.6) < 1e-6 && barrel.pos[2] - z0 > 0.2, `a kinematic door reaches Rapier in the same step and pushed the barrel ${(barrel.pos[2] - z0).toFixed(2)} m; the grid saw it move`);
    // (d) the mover is blocked by the crate exactly where Rapier says the capsule touches it (within the grid's cell)
    for (let i = 0; i < 120; i++) tick({});
    const p = createMover(space, { pos: [crate.pos[0] - 2, 0, crate.pos[2]], body: { push: 0 } });
    step(p, 240, { x: 1, z: 0 });
    const gap = crate.pos[0] - 0.4 - (p.pos[0] + MOVER.radius);
    ok(gap > -1e-9 && gap < cell * 1.5, `blocked ${gap.toFixed(3)} m short of the crate's face: the disagreement between the worlds is under 1.5 cells (${(cell * 1.5).toFixed(3)} m)`);
    link.dispose();
  }
}

// ---- 11. @mirage/net's step takes a mover as it takes a walker ----
{
  const { applyInput, quantiseInput, saveWalker, restoreWalker } = await import('../net/src/sim.js');
  const a = createMover(grid, { pos: [-1, 0, -5] }), b = createMover(grid, { pos: [-1, 0, -5] });
  seed = 99; let d = 0, diff = 0;
  for (let i = 0; i < 2000; i++) {
    if (i % 25 === 0) d = rnd() * 6.283;
    const inp = quantiseInput({ x: Math.cos(d), z: Math.sin(d), run: i % 50 < 30, jump: i % 90 < 4, yaw: d });
    applyInput(a, inp); applyInput(b, inp);
    if (!same(a, b)) diff++;
  }
  const s = saveWalker(a); restoreWalker(b, s);
  ok(diff === 0 && same(a, b), 'net applyInput: 2000 quantised inputs, two movers identical; saveWalker / restoreWalker apply');
}

// ---- 12. cost of a step (interleaved, 5 rounds) ----
{
  const space = createSolids(grid);
  for (let i = 0; i < 20; i++) space.add({ box: [0.4, 0.4, 0.4], pos: [-12 + i * 1.2, 0.4, 8] });
  const bench = (make) => {
    const m = make(); let d = 0;
    const t = performance.now();
    for (let i = 0; i < 20000; i++) { if (i % 40 === 0) d += 1.3; m.update(DT, { x: Math.cos(d), z: Math.sin(d), run: true, jump: i % 97 === 0 }); }
    return ((performance.now() - t) / 20000) * 1000;
  };
  const makers = { walker: () => createWalker(grid, { pos: [-1, 0, -8] }), mover: () => createMover(grid, { pos: [-1, 0, -8] }), 'mover+solids': () => createMover(space, { pos: [-1, 0, -8] }) };
  const res = { walker: [], mover: [], 'mover+solids': [] };
  for (const k in makers) bench(makers[k]);   // warm
  for (let r = 0; r < 5; r++) for (const k in makers) res[k].push(bench(makers[k]));
  const fmt = (a) => { const s = [...a].sort((x, y) => x - y); return `${s[2].toFixed(2)} us (${s[0].toFixed(2)}-${s[4].toFixed(2)})`; };
  console.log(`  step cost, median of 5 (min-max): walker ${fmt(res.walker)}, mover ${fmt(res.mover)}, mover over 20 solids ${fmt(res['mover+solids'])}`);
  ok(res.mover.sort((a, b) => a - b)[2] < 200, 'a mover step is under 0.2 ms');
}
console.log('mover: all checks passed');
