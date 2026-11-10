// Node checks of navgrid.js on hand-made walk grids: walkability equal to the walker's, corridors, a two-floor
// stair, a door closed and opened, unreachable goals, radius differences, agents, flow fields, a crowd, timing.
import { makeGrid, MAXL } from './src/walkgrid.js';
import { createWalker, BODY } from './src/walker.js';
import { createNavGrid, createNavAgent, createNavCrowd } from './src/navgrid.js';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('  ok', m); };
const cell = 0.125;
/** a grid of nx x nz cells from (x0, z0); layers(x, z) -> [[floor, ceil], ...] bottom to top at a cell centre */
function gridOf(nx, nz, x0, z0, layers) {
  const floors = new Float32Array(nx * nz * MAXL * 2), count = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, L = layers(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell, i, j);
    count[k] = L.length;
    L.forEach(([f, c], l) => { floors[(k * MAXL + l) * 2] = f; floors[(k * MAXL + l) * 2 + 1] = c; });
  }
  return makeGrid({ nx, nz, x0, z0, cell, floors, count });
}
const WALL = [[3.5, Infinity]];
/** every 2 cm along the waypoints a body of `radius` fits (the walker's own test) */
function pathFits(grid, path, radius) {
  const w = createWalker(grid, { body: { radius } });
  let bad = 0, y = path[0][1];
  for (let q = 1; q < path.length; q++) {
    const [ax, , az] = path[q - 1], [bx, , bz] = path[q], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.02);
    for (let s = 0; s <= n; s++) {
      const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n;
      const g = grid.support(x, z, y, BODY.step);   // the ground ahead, as the walker finds it
      if (!g || g[0] < y - BODY.step || !w.fits(x, z, g[0])) { bad++; if (process.env.NAV_DEBUG) console.log('    off at', x.toFixed(3), z.toFixed(3), y, g); } else y = g[0];
    }
  }
  return bad;
}
const plen = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[2] - p[i - 1][2]) : 0), 0);

// ---- 1. walkability: the fit bit is the walker's test, for three radii ----
{
  // the play check's grid: a wall with a gate, stairs, a box, a bench over a void
  const g = gridOf(80, 80, -5, -5, (x, z) => {
    let L = [[0, Infinity]];
    if (Math.abs(z) < 0.3) L = Math.abs(x) < 1 ? [[0, 2.3], [3.5, Infinity]] : [[3.5, Infinity]];
    if (x > 2 && x < 4 && z > 1) L = [[Math.min(0.17 * Math.ceil((z - 1) / 0.3), 1.19), Infinity]];
    if (x > -4 && x < -3 && z > 2 && z < 3) L = [[0.6, Infinity]];
    if (x > -4.5 && x < -3.5 && z > -4.5 && z < -3.5) L = [[0, 0.4], [0.45, Infinity]];
    if (x > 0.5 && x < 1.5 && z > 2 && z < 3) L = [[0, 1.0], [1.2, Infinity]];   // a low table: nobody fits under it
    return L;
  });
  const nav = createNavGrid(g);
  for (const r of [0.2, 0.28, 0.5]) {
    const w = createWalker(g, { body: { radius: r } });
    let same = 0, n = 0, settledOnly = 0, wrong = 0;
    for (let k = 0; k < g.nx * g.nz; k++) {
      const i = k % g.nx, j = (k - i) / g.nx, x = g.x0 + (i + 0.5) * cell, z = g.z0 + (j + 0.5) * cell;
      for (let l = 0; l < g.count[k]; l++) {
        const f = g.floors[(k * MAXL + l) * 2], bit = nav.profile(r).fit[nav.nodeAt(x, f, z)] === 1;
        // the walker's verdict standing on this floor: fits at f, and at the height its feet settle to
        const own = g.supportAt(k, f, BODY.step)?.[0] === f;
        let walk = own && w.fits(x, z, f);
        if (walk) { w.place([x, f, z]); w.update(1 / 60, {}); w.update(1 / 60, {}); walk = w.pos[0] === x && w.fits(x, z, w.pos[1]); if (w.pos[1] !== f) settledOnly++; }
        n++; if (bit === walk) same++; else wrong++;
        // anywhere inside the cell the walker gives the same answer (its disc offsets are whole cells)
        if (bit) for (const [u, v] of [[-0.06, -0.06], [0.06, 0.03], [0.02, 0.061]]) if (!w.fits(x + u, z + v, f)) wrong++;
      }
    }
    ok(wrong === 0, `radius ${r}: fit bit = the walker's fits() on ${same}/${n} floors (${settledOnly} on a stair riser), and anywhere in the cell`);
  }
}

// ---- 2. corridors: a zig-zag of walls with alternating gaps ----
{
  const g = gridOf(160, 160, -10, -10, (x, z) => {
    for (const [wz, gx] of [[-6, 7], [-2, -7], [2, 7], [6, -7]]) if (Math.abs(z - wz) < 0.25 && Math.abs(x - gx) > 1.2) return WALL;
    return [[0, Infinity]];
  });
  const nav = createNavGrid(g, { coarse: 4 });
  const p = nav.findPath([0, 0, -9], [0, 0, 9]);
  const L = plen(p);
  ok(p && Math.abs(p.at(-1)[2] - 9) < 1e-9 && L > 50 && L < 62, `zig-zag corridor: ${p.length} waypoints, ${L.toFixed(1)} m (straight 18 m; 5 legs ~55 m)`);
  ok(pathFits(g, p, BODY.radius) === 0, 'every 2 cm of it fits the walker');
  // string pulling: no waypoint is redundant (each corner is needed: the line skipping it is blocked)
  let redundant = 0;
  for (let q = 1; q < p.length - 1; q++) if (nav.visible(p[q - 1], p[q + 1])) redundant++;
  ok(redundant === 0, 'string pulled: no waypoint can be skipped');
  const c1 = createNavGrid(g, { coarse: 1 }).findPath([0, 0, -9], [0, 0, 9]);
  ok(Math.abs(plen(c1) - L) < 0.6, `coarse 4 vs plain cell A*: ${L.toFixed(2)} vs ${plen(c1).toFixed(2)} m`);
}

// ---- 3. two floors: a slab at 3.0 over the north half, a stair of 10 risers of 0.3 along the east wall ----
let twoFloor;
{
  twoFloor = gridOf(96, 96, -6, -6, (x, z) => {
    if (Math.abs(x) > 5.6 || Math.abs(z) > 5.6) return WALL;                          // outer walls
    const slab = z < 0 && !(x > 3 && x < 4.6);                                         // upper floor (a stairwell cut out)
    if (x > 3 && x < 4.6 && z < 0 && z > -3) {                                         // the stair, climbing north
      const r = Math.min(10, Math.max(0, Math.ceil((-z) / 0.3))) * 0.3;
      return [[r, Infinity]];
    }
    if (x > 3 && x < 4.6 && z <= -3) return [[0, 2.8], [3.0, Infinity]];             // stair landing up top
    return slab ? [[0, 2.8], [3.0, Infinity]] : [[0, Infinity]];
  });
  const nav = createNavGrid(twoFloor);
  const up = nav.findPath([-4, 0, 3], [-4, 3, -4]);
  ok(up && up.at(-1)[1] === 3 && up.some((q) => q[0] > 3 && q[0] < 4.6), `ground to upper floor goes by the stair (${up.length} waypoints, ${plen(up).toFixed(1)} m)`);
  ok(pathFits(twoFloor, up, BODY.radius) === 0, 'and every 2 cm of it fits');
  const under = nav.findPath([-4, 0, 3], [-4, 0, -4]);
  ok(under && under.every((q) => q[1] === 0) && under.length === 2, 'the same spot on the ground floor: straight under the slab');
  const across = nav.findPath([-4, 3, -4], [2, 3, -5]);
  ok(across && across.every((q) => q[1] === 3), 'along the upper floor stays upstairs');
}

// ---- 4. a door: two rooms, one doorway; closed, the way round through a far door; both shut: null ----
{
  const g = gridOf(160, 96, -10, -6, (x, z) => {
    if (Math.abs(z) > 5.6 || Math.abs(x) > 9.6) return WALL;
    if (Math.abs(z) < 0.2 && !(Math.abs(x) < 0.6) && !(x > 7.5 && x < 8.7)) return WALL;   // doorways at x 0 and x 8.1
    return [[0, Infinity]];
  });
  const nav = createNavGrid(g);
  const open = nav.findPath([0, 0, -3], [0, 0, 3]);
  ok(open && Math.abs(plen(open) - 6) < 0.01, `door open: straight through (${plen(open).toFixed(2)} m)`);
  const t = performance.now();
  const door = nav.block({ box: [-0.6, 0, -0.2, 0.6, 2.2, 0.2] });
  const editMs = performance.now() - t;
  const round = nav.findPath([0, 0, -3], [0, 0, 3]);
  ok(round && round.some((q) => q[0] > 7) && plen(round) > 16, `door shut: round by the far door (${plen(round).toFixed(1)} m; edit ${editMs.toFixed(2)} ms)`);
  const far = nav.block({ cylinder: [8.1, 0, 0.7, 0, 2] });
  ok(nav.findPath([0, 0, -3], [0, 0, 3]) === null, 'both shut: no path (null)');
  // a walker on nav.grid is stopped by the closed door; one on the raw grid is not
  const wv = createWalker(nav.grid, { pos: [0, 0, -2] }), wr = createWalker(g, { pos: [0, 0, -2] });
  for (let i = 0; i < 240; i++) { wv.update(1 / 60, { z: 1 }); wr.update(1 / 60, { z: 1 }); }
  ok(wv.pos[2] < -0.2 && wr.pos[2] > 1, `nav.grid walkers collide with it (z ${wv.pos[2].toFixed(2)}; raw grid ${wr.pos[2].toFixed(2)})`);
  nav.unblock(door); nav.unblock(far);
  const again = nav.findPath([0, 0, -3], [0, 0, 3]);
  ok(again && Math.abs(plen(again) - 6) < 0.01, 'unblocked: straight again');
  // a narrow profile cached before the edit is edited too
  nav.profile(0.2); nav.block({ box: [-0.6, 0, -0.2, 0.6, 2.2, 0.2] });
  const dog = nav.findPath([0, 0, -3], [0, 0, 3], { radius: 0.2 });
  ok(dog && dog.some((q) => q[0] > 7), 'every cached radius sees the door');
  // an obstacle up on another floor does not block the floor below it
  const n2 = createNavGrid(twoFloor);
  n2.block({ box: [-6, 3.0, -1.5, 3, 5, -0.5] });   // a barrier across the upper floor
  ok(n2.findPath([-4, 0, -4], [-4, 0, 3]).length === 2, 'a barrier upstairs leaves the ground floor open');
  ok(n2.findPath([-4, 3, -4], [0, 3, -0.2]) === null, 'and closes the upper floor it stands on');
}

// ---- 5. unreachable goals ----
{
  const g = gridOf(160, 160, -10, -10, (x, z) => {
    if (Math.abs(x - 5) < 2.2 && Math.abs(z - 5) < 2.2 && (Math.abs(x - 5) > 1.8 || Math.abs(z - 5) > 1.8)) return WALL;   // a closed room
    if (x > -8 && x < -6 && z > -8 && z < -6) return [[1.5, Infinity]];                                                      // a plinth: too high to step on
    return [[0, Infinity]];
  });
  const nav = createNavGrid(g);
  let t = performance.now();
  const inRoom = nav.findPath([-5, 0, -5], [5, 0, 5]);
  const ms1 = performance.now() - t;
  ok(inRoom === null, `goal inside a closed room: null (${ms1.toFixed(2)} ms, ${nav.stats.coarseExpanded} coarse nodes)`);
  ok(nav.findPath([-5, 0, -5], [-7, 1.5, -7]) === null, 'goal on a 1.5 m plinth: null');
  ok(nav.findPath([-5, 0, -5], [50, 0, 50]) === null, 'goal off the grid: null');
  ok(nav.findPath([-5, 0, -5], [5, 0, 7.2]) !== null, 'a goal in the wall itself snaps to the floor beside it');
}

// ---- 6. radius: gaps of 0.5 m and 0.75 m in one wall, and a bypass 1.5 m wide far away ----
{
  const g = gridOf(160, 96, -10, -6, (x, z) => {
    if (Math.abs(z) < 0.2 && !(x > -0.25 && x < 0.25) && !(x > 3 && x < 3.75) && !(x > 7.5 && x < 9)) return WALL;
    return [[0, Infinity]];
  });
  const nav = createNavGrid(g);
  const via = (p) => (p.length === 2 ? 'gap 0.5' : p.some((q) => q[0] > 2.9 && q[0] < 3.8) ? 'gap 0.75' : 'bypass 1.5');
  const res = {};
  for (const [name, r] of [['dog', 0.2], ['player', 0.28], ['cart', 0.5]]) {
    const p = nav.findPath([0, 0, -3], [0, 0, 3], { radius: r });
    res[name] = via(p);
    ok(pathFits(g, p, r) === 0, `${name} (r ${r}): through the ${res[name]} m opening, ${plen(p).toFixed(2)} m, all of it fits r ${r}; fit bake ${nav.profile(r).ms} ms`);
  }
  ok(res.dog === 'gap 0.5' && res.player === 'gap 0.75' && res.cart === 'bypass 1.5', 'each radius takes the narrowest opening it fits');
}

// ---- 7. agents: walk the two-floor building, never on a cell they do not fit ----
{
  const nav = createNavGrid(twoFloor);
  for (const [name, r, speed] of [['player-sized', 0.28, 1.5], ['dog', 0.2, 3]]) {
    const a = createNavAgent(nav, { radius: r, speed, pos: [-4, 0, 3] });
    a.setGoal([-4, 3, -4]);
    let bad = 0, t = 0;
    for (; t < 60 && !a.arrived; t += 1 / 60) { a.update(1 / 60); if (!nav.fits(a.pos[0], a.pos[1], a.pos[2], r)) bad++; }
    ok(a.arrived && Math.abs(a.pos[1] - 3) < 1e-6 && bad === 0, `${name} agent climbs to the upper floor in ${t.toFixed(1)} s, ${bad} frames off fit cells`);
  }
  // a 0.5 m cart's disc spans two 0.3 m risers of this 45° stair: the walker refuses it, and so does the nav
  const cart = createNavAgent(nav, { radius: 0.5, speed: 1, pos: [-4, 0, 3] }), wc = createWalker(twoFloor, { pos: [3.8, 0, 1], body: { radius: 0.5 } });
  for (let i = 0; i < 600; i++) wc.update(1 / 60, { z: -1 });
  ok(cart.setGoal([-4, 3, -4]) === false && wc.pos[1] < 0.5, `a cart (r 0.5) has no way up, and a walker of r 0.5 pushed up the stair stays at y ${wc.pos[1].toFixed(2)}`);
  // a door shut ahead of a walking agent: it re-plans round
  const g = gridOf(160, 96, -10, -6, (x, z) => {
    if (Math.abs(z) > 5.6 || Math.abs(x) > 9.6) return WALL;
    if (Math.abs(z) < 0.2 && !(Math.abs(x) < 0.6) && !(x > 7.5 && x < 8.7)) return WALL;
    return [[0, Infinity]];
  });
  const n2 = createNavGrid(g), a = createNavAgent(n2, { pos: [0, 0, -4] });
  a.setGoal([0, 0, 4]);
  let t = 0, bad = 0;
  for (; t < 30 && !a.arrived; t += 1 / 60) {
    if (Math.abs(t - 1) < 1e-9 || (t > 1 && t < 1 + 1 / 60)) n2.block({ box: [-0.6, 0, -0.2, 0.6, 2.2, 0.2] });
    a.update(1 / 60);
    if (!n2.fits(a.pos[0], a.pos[1], a.pos[2])) bad++;
  }
  ok(a.arrived && a.pos[2] > 3.8 && bad === 0, `the door shuts 1 s in: the agent goes round and arrives at ${t.toFixed(1)} s, never off fit cells`);
}

// ---- 8. flow field + crowd: 24 agents, one goal ----
{
  const g = gridOf(160, 160, -10, -10, (x, z) => {
    for (const [wz, gx] of [[-4, 6], [0, -6], [4, 6]]) if (Math.abs(z - wz) < 0.25 && Math.abs(x - gx) > 1.5) return WALL;
    return [[0, Infinity]];
  });
  const nav = createNavGrid(g), field = nav.flowField([0, 0, 8]);
  ok(field.reached > 20000 && Math.abs(field.distance(0, 0, -8) - 41) < 5, `flow field: ${field.reached} nodes in ${field.ms} ms; from (0, -8) ${field.distance(0, 0, -8).toFixed(1)} m`);
  const run = (separation) => {
    const crowd = createNavCrowd(nav, { separation });
    for (let q = 0; q < 24; q++) crowd.add(createNavAgent(nav, { radius: 0.25, speed: 2, pos: [-8 + (q % 8) * 2, 0, -9 + Math.floor(q / 8) * 1.2], arrive: 1.2 })).setGoal(field);
    let bad = 0, minGap = Infinity, t = 0, settle = 0;
    const t1 = performance.now();
    for (; t < 60 && settle < 2; t += 1 / 60) {   // until all arrived, then 2 s more to make room
      crowd.update(1 / 60);
      if (crowd.agents.every((a) => a.arrived)) settle += 1 / 60;
      for (const a of crowd.agents) if (!nav.fits(a.pos[0], a.pos[1], a.pos[2], 0.25)) bad++;
    }
    const perFrame = (performance.now() - t1) / Math.round(t * 60);
    for (const a of crowd.agents) for (const b of crowd.agents) if (a !== b) minGap = Math.min(minGap, Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]));
    return { arrived: crowd.agents.filter((a) => a.arrived).length, t: t - settle, bad, perFrame, minGap };
  };
  const on = run(2), off = run(0);
  ok(on.arrived === 24 && on.bad === 0, `24 agents on one field: ${on.arrived} arrive in ${on.t.toFixed(1)} s, ${on.bad} agent-frames off fit cells, ${on.perFrame.toFixed(3)} ms per crowd step`);
  ok(on.minGap > 0.4 && off.minGap < 0.2, `separation keeps them apart (closest pair ${on.minGap.toFixed(2)} m, radii 0.25; without it ${off.minGap.toFixed(2)} m)`);
}

// ---- 9. timing: 160 x 160 cells (20 x 20 m), 1 m pillars on 22% of a 1 m lattice, plus long walls; 400 queries ----
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blocked = new Uint8Array(20 * 20);
  for (let q = 0; q < 20 * 20; q++) blocked[q] = rnd() < 0.22 ? 1 : 0;
  const g = gridOf(160, 160, -10, -10, (x, z, i, j) => {
    if ((Math.abs(z + 3) < 0.2 && x < 6) || (Math.abs(z - 4) < 0.2 && x > -6)) return WALL;   // two long walls: detours
    return blocked[(j >> 3) * 20 + (i >> 3)] ? WALL : [[0, Infinity]];
  });
  const pairs = [];
  for (let q = 0; q < 400; q++) pairs.push([[-9.8 + rnd() * 19.6, 0, -9.8 + rnd() * 19.6], [-9.8 + rnd() * 19.6, 0, -9.8 + rnd() * 19.6]]);
  const rows = [];
  for (const coarse of [1, 2, 4]) {
    const t0 = performance.now(), nav = createNavGrid(g, { coarse }), bake = performance.now() - t0;
    for (const [a, b] of pairs.slice(0, 50)) nav.findPath(a, b);   // warm up
    const ms = [];
    let found = 0, exp = 0, srch = 0;
    for (const [a, b] of pairs) { const t = performance.now(); if (nav.findPath(a, b)) { found++; srch += nav.stats.searchMs; } ms.push(performance.now() - t); exp += nav.stats.cellExpanded; }
    ms.sort((x, y) => x - y);
    const mean = ms.reduce((s, x) => s + x, 0) / ms.length;
    rows.push({ coarse, bake, mean, p50: ms[200], p95: ms[380], max: ms[399], found, exp: exp / pairs.length, srch: srch / found });
  }
  for (const r of rows) console.log(`    coarse ${r.coarse}: create + fit bake ${r.bake.toFixed(1)} ms; per query mean ${r.mean.toFixed(3)} ms, p50 ${r.p50.toFixed(3)}, p95 ${r.p95.toFixed(3)}, max ${r.max.toFixed(2)}; ${r.found}/400 found; ${r.exp.toFixed(0)} cell nodes expanded; search ${r.srch.toFixed(3)} ms of it`);
  ok(rows.every((r) => r.found === rows[0].found) && rows[0].found > 300, `all three agree on reachability (${rows[0].found}/400 reachable)`);
  ok(rows[2].mean < 5, `160 x 160: ${rows[2].mean.toFixed(3)} ms per query (coarse 4)`);
  const nav = createNavGrid(g);
  const t = performance.now(), f = nav.flowField(nav.nearest([0, 0, 0], { snap: 3 }));
  console.log(`    flow field over the whole 160 x 160 grid: ${(performance.now() - t).toFixed(1)} ms (${f.reached} nodes)`);
}
console.log('nav check: ok');
