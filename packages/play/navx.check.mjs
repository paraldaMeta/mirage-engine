// Node checks of the navigation extensions: turned-box obstacles, areas with costs, off-mesh links, solids carved
// out as they move, the path queue, corner smoothing, the ORCA crowd, the behaviour tree with senses. Then timing:
// path queries on 160 x 160 and 512 x 512, re-bake after an obstacle moves, crowd step by size.
import { makeGrid, MAXL } from './src/walkgrid.js';
import { createNavGrid, createNavAgent } from './src/navgrid.js';
import { createSolids } from './src/solids.js';
import { carveSolids } from './src/nav-carve.js';
import { createPathQueue, smoothPath, pathLength } from './src/nav-path.js';
import { createCrowd } from './src/crowd.js';
import { bt, createBlackboard, createSenses, createBehaviorTree, agentActor, patrol, chase, flee, follow, guard, SUCCESS, FAILURE, RUNNING } from './src/ai.js';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('  ok', m); };
const cell = 0.125, WALL = [[3.5, Infinity]], OPEN = [[0, Infinity]];
function gridOf(nx, nz, x0, z0, layers) {
  const floors = new Float32Array(nx * nz * MAXL * 2), count = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, L = layers(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell, i, j);
    count[k] = L.length;
    L.forEach(([f, c], l) => { floors[(k * MAXL + l) * 2] = f; floors[(k * MAXL + l) * 2 + 1] = c; });
  }
  return makeGrid({ nx, nz, x0, z0, cell, floors, count });
}
const open = (n = 160, h = 10) => gridOf(n, n, -h, -h, () => OPEN);
/** every 5 cm of the path is a cell the radius fits (links excepted) */
function onFit(nav, path, radius) {
  let bad = 0;
  for (let q = 1; q < path.length; q++) {
    if (path[q].link) continue;
    const a = path[q - 1], b = path[q], n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.05);
    for (let s = 0; s <= n; s++) if (!nav.fits(a[0] + ((b[0] - a[0]) * s) / n, a[1], a[2] + ((b[2] - a[2]) * s) / n, radius)) bad++;
  }
  return bad;
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const spread = (a) => `${med(a).toFixed(3)} (${Math.min(...a).toFixed(3)}-${Math.max(...a).toFixed(3)})`;

// ---- 1. a turned box ----
{
  const nav = createNavGrid(open());
  const id = nav.block({ obb: [0, 0, 2, 0.1, Math.PI / 4, 0, 2] });   // a 4 m leaf at 45 degrees
  ok(!nav.fits(1, 0, -1) && !nav.fits(-1, 0, 1) && nav.fits(1, 0, 1) && nav.fits(-1, 0, -1), 'obb (yaw as three rotation.y): its diagonal is blocked, the other is free');
  const p = nav.findPath([-1, 0, -1], [1, 0, 1]);
  ok(p && pathLength(p) > 3.2 && onFit(nav, p, 0.28) === 0, `a path goes round the leaf's end (${pathLength(p).toFixed(2)} m for 2.83 straight)`);
  nav.unblock(id);
  ok(nav.fits(1, 0, -1) && pathLength(nav.findPath([-1, 0, -1], [1, 0, 1])) < 2.9, 'unblocked: straight again');
}

// ---- 2. areas and costs ----
{
  const nav = createNavGrid(open());
  // mud across the middle, 4 m deep, with a 2 m dry gap far to the east
  nav.setArea({ box: [-10, -1, -2, 6, 3, 2] }, 2);
  ok(nav.areaAt(0, 0, 0) === 2 && nav.areaAt(8, 0, 0) === 0, 'setArea marks the nodes under a shape');
  const A = [0, 0, -5], B = [0, 0, 5];
  const straight = nav.findPath(A, B);
  ok(pathLength(straight) < 10.05, `cost 1 everywhere: straight through (${pathLength(straight).toFixed(2)} m)`);
  nav.setAreaCost(2, 5);
  const round = nav.findPath(A, B), costThrough = 6 + 4 * 5;
  const inMud = (p) => p.some((w, q) => q && Math.abs((w[2] + p[q - 1][2]) / 2) < 1.9 && (w[0] + p[q - 1][0]) / 2 < 5.9);
  ok(round && !inMud(round) && nav.stats.cost < costThrough, `mud at 5 a metre: round by the gap, cost ${nav.stats.cost.toFixed(1)} < ${costThrough} through, ${pathLength(round).toFixed(1)} m`);
  nav.setAreaCost(2, 1.3);
  const wade = nav.findPath(A, B);
  ok(inMud(wade) && pathLength(wade) < 10.3, `mud at 1.3: through it (cost ${nav.stats.cost.toFixed(1)})`);
  const mine = nav.findPath(A, B, { costs: { 2: Infinity } });
  ok(mine && !inMud(mine), 'per query { costs: { 2: Infinity } }: this agent never enters, others still do');
  nav.setArea({ box: [6, -1, -2, 10, 3, 2] }, 3);
  ok(nav.findPath(A, B, { costs: { 2: Infinity, 3: Infinity } }) === null && nav.findPath(A, B), 'both areas closed for one query: no way; open for the next');
  // optimality against a brute Dijkstra is not run here; the detour is checked against the analytic one instead
  nav.setAreaCost(2, 5);
  const p2 = nav.findPath(A, B, { costs: { 3: 1 } }), ideal = 2 * Math.hypot(6.3, 3) + 4;
  ok(nav.stats.cost < ideal * 1.08, `detour cost ${nav.stats.cost.toFixed(2)} within 8% of the straight-line bound ${ideal.toFixed(2)} (${pathLength(p2).toFixed(2)} m)`);
}

// ---- 3. off-mesh links ----
{
  // two islands with a 1 m gap (x in [-0.5, 0.5] is void), a far bridge at z > 8
  const g = gridOf(160, 160, -10, -10, (x, z) => (Math.abs(x) < 0.5 && z < 8 ? [] : OPEN));
  const nav = createNavGrid(g);
  const A = [-3, 0, 0], B = [3, 0, 0];
  const far = nav.findPath(A, B);
  ok(far && pathLength(far) > 17, `no link: round by the bridge (${pathLength(far).toFixed(1)} m)`);
  const jump = nav.link({ from: [-0.9, 0, 0], to: [0.9, 0, 0], type: 'jump' });
  ok(jump && jump.id && nav.links().length === 1, 'nav.link returns the link');
  const p = nav.findPath(A, B), li = p.findIndex((w) => w.link);
  ok(li > 0 && p[li].link.link === jump && pathLength(p) < 6.2, `with the jump: ${pathLength(p).toFixed(2)} m, waypoint ${li} of ${p.length} carries .link`);
  ok(Math.hypot(p[li - 1][0] - jump.from[0], p[li - 1][2] - jump.from[2]) < 0.2 && Math.hypot(p[li][0] - jump.to[0], p[li][2] - jump.to[2]) < 0.2, 'the waypoint before it is the take-off, it is the landing');
  const back = nav.findPath(B, A);
  ok(pathLength(back) > 17, 'one way: the return goes round');
  ok(pathLength(nav.findPath(A, B, { canUse: (l) => l.type !== 'jump' })) > 17, 'canUse: an agent that cannot jump goes round');
  nav.unlink(jump);
  ok(pathLength(nav.findPath(A, B)) > 17 && nav.links().length === 0, 'unlink: gone');
  const two = nav.link({ from: [-0.9, 0, 0], to: [0.9, 0, 0], type: 'ladder', bidirectional: true, cost: 3 });
  const pb = nav.findPath(B, A), lb = pb.find((w) => w.link);
  ok(lb && lb.link.reverse === true && Math.abs(lb.link.to[0] + 0.9) < 0.2, 'bidirectional: used backwards, the view is turned round (from/to in travel order, reverse: true)');
  ok(Math.abs(nav.stats.cost - (pathLength(pb) - 1.8 + 3)) < 0.3, `link cost 3 counted (${nav.stats.cost.toFixed(2)})`);
  two.cost = 40; nav.unlink(two); nav.link({ ...two, id: undefined, cost: 40 });
  ok(!nav.findPath(B, A).some((w) => w.link), 'a link dearer than the detour is not taken');
  ok(nav.link({ from: [0, 0, 0], to: [3, 0, 0], snap: 0.2 }) === null, 'a link whose end is on no floor: null');

  // an agent crosses a jump; a door link holds it until it opens
  const nav2 = createNavGrid(g);
  let open2 = false;
  const events = [];
  const door = nav2.link({ from: [-0.9, 0, 0], to: [0.9, 0, 0], type: 'door', time: 0.5, canEnter: () => open2 });
  const a = createNavAgent(nav2, { pos: A, onLink: (ag, l, what) => events.push(what) });
  a.setGoal(B);
  for (let i = 0; i < 240; i++) a.update(1 / 60);
  ok(a.pos[0] < -0.7 && !a.arrived && events.length === 0, `shut door: the agent waits at it (x ${a.pos[0].toFixed(2)})`);
  open2 = true;
  let maxY = 0;
  for (let i = 0; i < 400 && !a.arrived; i++) { a.update(1 / 60); maxY = Math.max(maxY, a.pos[1]); }
  ok(a.arrived && events.join() === 'start,end' && Math.hypot(a.pos[0] - 3, a.pos[2]) < 0.2, 'open: crossed, onLink start then end, arrived');
  nav2.unlink(door);
  nav2.link({ from: [-0.9, 0, 0], to: [0.9, 0, 0], type: 'jump', height: 0.8 });
  a.place(A); a.setGoal(B); maxY = 0;
  for (let i = 0; i < 600 && !a.arrived; i++) { a.update(1 / 60); maxY = Math.max(maxY, a.pos[1]); }
  ok(a.arrived && maxY > 0.7 && maxY < 0.85, `jump link: an arc ${maxY.toFixed(2)} m high`);
}

// ---- 4. solids carved as they move ----
let rebake;
{
  const g = gridOf(160, 160, -10, -10, (x, z) => (Math.abs(x) < 0.2 && Math.abs(z) > 0.6 ? WALL : OPEN));   // a wall with a 1.2 m doorway
  const space = createSolids(g), nav = createNavGrid(g);
  const door = space.add({ box: [0.08, 1, 0.6], pos: [0, 1, 0], kind: 'kinematic' });
  space.add({ box: [1, 0.1, 1], pos: [6, 0.1, 6], kind: 'kinematic', data: { carve: false } });
  const carve = carveSolids(nav, space);
  ok(carve.stats.total === 0 || nav.obstacles().length === 1, 'the door is carved, the lift ({ carve: false }) is not');
  ok(!nav.fits(0, 0, 0) && nav.fits(6, 0, 6) && nav.findPath([-3, 0, 0], [3, 0, 0]) === null, 'door shut: no path');
  // swing it open: hinge at z = -0.6, leaf turns to lie along x
  const v0 = nav.version;
  door.set({ pos: [0.6, 1, -0.6], yaw: Math.PI / 2 });
  ok(nav.version === v0, 'moving the solid alone changes nothing (the game decides when to re-bake)');
  const n = carve.update();
  ok(n === 1 && nav.version > v0 && nav.fits(0, 0, 0.2), `carve.update(): 1 solid re-blocked in ${carve.stats.ms} ms`);
  const p = nav.findPath([-3, 0, 0], [3, 0, 0]);
  ok(p && onFit(nav, p, 0.28) === 0, 'door open: a path through the doorway');
  door.set({ pos: [0.6, 1.01, -0.6] });
  ok(carve.update() === 0, 'a move under the tolerance is not re-baked');
  const crate = space.add({ box: [0.4, 0.4, 0.4], pos: [0, 0.4, 0.1], kind: 'dynamic' });
  ok(nav.findPath([-3, 0, 0], [3, 0, 0]) === null, 'a crate added in the doorway is carved at once');
  crate.remove();
  ok(nav.findPath([-3, 0, 0], [3, 0, 0]) !== null && nav.obstacles().length === 1, 'removed: free again');
  // an agent re-plans when the door shuts in front of it
  const a = createNavAgent(nav, { pos: [-3, 0, 0] });
  a.setGoal([3, 0, 0]);
  for (let i = 0; i < 40; i++) a.update(1 / 60);
  door.set({ pos: [0, 1, 0], yaw: 0 }); carve.update();
  for (let i = 0; i < 120; i++) a.update(1 / 60);
  ok(a.pos[0] < -0.3 && !a.arrived, 'door shut again: the walking agent stops short of it');
  door.set({ pos: [0.6, 1, -0.6], yaw: Math.PI / 2 }); carve.update();
  for (let i = 0; i < 600 && !a.arrived; i++) a.update(1 / 60);
  ok(a.arrived, 'opened: it re-plans and arrives');
  // timing: the door swinging, a crate sliding one cell at a time
  const ms = [];
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    for (let q = 0; q < 40; q++) { const yaw = (q / 40) * Math.PI / 2; door.set({ pos: [Math.sin(yaw) * 0.6, 1, -0.6 + Math.cos(yaw) * 0.6], yaw }); carve.update(); }
    ms.push((performance.now() - t) / 40);
  }
  const c2 = space.add({ box: [0.4, 0.4, 0.4], pos: [-5, 0.4, -5], kind: 'dynamic' }), ms2 = [];
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    for (let q = 0; q < 40; q++) { c2.set({ pos: [-5 + q * 0.125, 0.4, -5] }); carve.update(); }
    ms2.push((performance.now() - t) / 40);
  }
  rebake = { door: spread(ms), crate: spread(ms2) };
  carve.dispose();
  ok(nav.obstacles().length === 0, 'dispose: every carve removed');
}

// ---- 5. path queue ----
{
  const nav = createNavGrid(open());
  const queue = createPathQueue(nav, { budgetMs: 0 });   // 0: exactly one query per update
  const order = [];
  for (let q = 0; q < 5; q++) queue.request([-5, 0, q - 2], [5, 0, q - 2], { priority: q === 3 ? 9 : 0, then: (p) => order.push(q) });
  const dead = queue.request([0, 0, 0], [1, 0, 1], { then: () => order.push('dead') });
  dead.cancel();
  ok(queue.pending === 5, 'five queued, one cancelled');
  ok(queue.update() === 1 && order.join() === '3', 'budget spent after one: the best priority ran first');
  let n = 1; while (queue.pending) { queue.update(); n++; }
  ok(n === 5 && order.join() === '3,0,1,2,4' && queue.stats.total === 5, 'then first come first served, one a frame; the cancelled one never ran');
  const all = createPathQueue(nav, { budgetMs: 50 });
  let got = null;
  const job = all.request([-5, 0, 0], [5, 0, 0]);
  job.then((p) => { got = p; });
  all.update();
  await job;
  ok(got && got.length >= 2 && (await dead) === null, 'the promise resolves with the waypoints (null for a cancelled one)');
}

// ---- 6. smoothing ----
{
  const g = gridOf(160, 160, -10, -10, (x, z) => (x > -1 && x < 1 && z < 3 ? WALL : OPEN));
  const nav = createNavGrid(g);
  const p = nav.findPath([-4, 0, -4], [4, 0, -4]), s = smoothPath(nav, p, { corner: 0.8 });
  let worst = 0, worstS = 0;
  const turn = (q, i) => { const a = Math.atan2(q[i][2] - q[i - 1][2], q[i][0] - q[i - 1][0]), b = Math.atan2(q[i + 1][2] - q[i][2], q[i + 1][0] - q[i][0]); let d = Math.abs(a - b); if (d > Math.PI) d = 2 * Math.PI - d; return Math.hypot(q[i + 1][0] - q[i][0], q[i + 1][2] - q[i][2]) < 0.2 ? 0 : d; };   // (the last 9 cm jog onto the goal is not a corner)
  for (let i = 1; i < p.length - 1; i++) worst = Math.max(worst, turn(p, i));
  for (let i = 1; i < s.length - 1; i++) worstS = Math.max(worstS, turn(s, i));
  ok(s.length > p.length && onFit(nav, s, 0.28) === 0, `smoothPath: ${p.length} -> ${s.length} waypoints, every one on cells the radius fits`);
  ok(worstS < worst * 0.6 && pathLength(s) <= pathLength(p) * 1.03, `sharpest turn ${(worst * 57.3).toFixed(0)} -> ${(worstS * 57.3).toFixed(0)} degrees, length ${pathLength(p).toFixed(2)} -> ${pathLength(s).toFixed(2)} m`);
}

// ---- 7. the crowd ----
const overlapOf = (crowd) => { let worst = 0; for (let i = 0; i < crowd.max; i++) if (crowd.state[i]) for (let j = i + 1; j < crowd.max; j++) if (crowd.state[j] && crowd.state[i] !== 5 && crowd.state[j] !== 5) { const o = crowd.radius[i] + crowd.radius[j] - Math.hypot(crowd.x[i] - crowd.x[j], crowd.z[i] - crowd.z[j]); if (o > worst) worst = o; } return worst; };
{
  const nav = createNavGrid(open());
  // two agents head on
  const c = createCrowd(nav, { max: 8 });
  const a = c.add({ pos: [-4, 0, 0] }), b = c.add({ pos: [4, 0, 0] });
  c.setGoal(a, [4, 0, 0]); c.setGoal(b, [-4, 0, 0]);
  let worst = 0, side = 0;
  for (let i = 0; i < 900 && !(c.arrived(a) && c.arrived(b)); i++) { c.update(1 / 60); worst = Math.max(worst, overlapOf(c)); side = Math.max(side, Math.abs(c.z[a])); }
  ok(c.arrived(a) && c.arrived(b) && worst < 0.01, `two agents head on pass each other and arrive (deepest overlap ${(worst * 1000).toFixed(1)} mm, ${side.toFixed(2)} m aside)`);

  // a circle of 40, different radii, each to the opposite point
  const run = () => {
    const cr = createCrowd(nav, { max: 64, queue: createPathQueue(nav, { budgetMs: Infinity, max: 8 }) });   // paths by count, not by the clock
    const upd = cr.update; cr.update = (dt) => { cr.queue.update(); upd(dt); };
    for (let q = 0; q < 40; q++) { const t = (q / 40) * Math.PI * 2, i = cr.add({ pos: [Math.cos(t) * 6, 0, Math.sin(t) * 6], radius: q % 4 === 0 ? 0.45 : 0.25, speed: 1.4 }); cr.setGoal(i, [-Math.cos(t) * 6, 0, -Math.sin(t) * 6]); }
    let w = 0, steps = 0, arrived = 0;
    for (; steps < 3600 && arrived < 40; steps++) { cr.update(1 / 60); w = Math.max(w, overlapOf(cr)); arrived = 0; for (let i = 0; i < 40; i++) if (cr.arrived(i)) arrived++; }
    return { cr, w, steps, arrived };
  };
  const r1 = run(), r2 = run();
  ok(r1.arrived === 40, `circle of 40 (radii 0.25 and 0.45) swap sides: all arrive in ${(r1.steps / 60).toFixed(1)} s`);
  ok(r1.w < 0.03, `deepest overlap on the way ${(r1.w * 1000).toFixed(1)} mm`);
  let same = r1.steps === r2.steps;
  for (let i = 0; i < 40; i++) if (r1.cr.x[i] !== r2.cr.x[i] || r1.cr.z[i] !== r2.cr.z[i]) same = false;
  ok(same, 'the same run twice (path queue counted, 8 a step, not timed): identical to the bit');

  // a fixed agent (the player) standing in the way is walked round
  const cf = createCrowd(nav, { max: 8 });
  const pl = cf.add({ pos: [0, 0, 0], radius: 0.4, fixed: true }), w = cf.add({ pos: [-3, 0, 0.02] });
  cf.setGoal(w, [3, 0, 0]);
  let near = 9;
  for (let i = 0; i < 600 && !cf.arrived(w); i++) { cf.move(pl, 0, 0, 0); cf.update(1 / 60); near = Math.min(near, Math.hypot(cf.x[w], cf.z[w])); }
  ok(cf.arrived(w) && near > 0.4 + 0.28 - 0.01 && cf.x[pl] === 0, `a fixed agent is avoided and never moved (nearest ${near.toFixed(2)} m, radii sum 0.68)`);
  ok(cf.setGoal(pl, [1, 0, 1]) === false, 'a fixed agent takes no goal');

  // walls: a crowd through a doorway never leaves fit cells
  const g = gridOf(160, 160, -10, -10, (x, z) => (Math.abs(x) < 0.2 && Math.abs(z) > 0.7 ? WALL : OPEN));
  const navd = createNavGrid(g), cd = createCrowd(navd, { max: 64 });
  for (let q = 0; q < 30; q++) { const i = cd.add({ pos: [-3 - (q % 5) * 0.7, 0, -1.5 + Math.floor(q / 5) * 0.7] }); cd.setGoal(i, [4 + (q % 5) * 0.7, 0, -1.5 + Math.floor(q / 5) * 0.7]); }
  let off = 0, through = 0, wd = 0;
  for (let s = 0; s < 2400; s++) { cd.update(1 / 60); wd = Math.max(wd, overlapOf(cd)); for (let i = 0; i < 30; i++) if (!navd.fits(cd.x[i], cd.y[i], cd.z[i], 0.28)) off++; }
  for (let i = 0; i < 30; i++) if (cd.x[i] > 0.5) through++;
  ok(off === 0 && through === 30, `30 agents through a 1.4 m doorway: all through, never on a cell they do not fit (deepest overlap ${(wd * 1000).toFixed(0)} mm)`);

  // links and no-path callbacks
  const gl = gridOf(160, 160, -10, -10, (x) => (Math.abs(x) < 0.5 ? [] : OPEN));
  const navl = createNavGrid(gl), cl = createCrowd(navl, { max: 8 }), ev = [];
  navl.link({ from: [-0.9, 0, 0], to: [0.9, 0, 0], type: 'jump', height: 0.6 });
  cl.onLink = (i, l, what) => ev.push(what); cl.onNoPath = (i) => ev.push('nopath');
  const j = cl.add({ pos: [-3, 0, 0] });
  cl.setGoal(j, [3, 0, 0]);
  let top = 0;
  for (let s = 0; s < 900 && !cl.arrived(j); s++) { cl.update(1 / 60); top = Math.max(top, cl.y[j]); }
  ok(cl.arrived(j) && ev.join() === 'start,end' && top > 0.5, `a crowd agent takes the jump link (apex ${top.toFixed(2)} m, onLink start, end)`);
  cl.setGoal(j, [-3, 0, 0]);
  for (let s = 0; s < 30; s++) cl.update(1 / 60);
  ok(ev.join() === 'start,end,nopath' && cl.actor(j).noPath, 'no way back (one-way link): onNoPath, actor.noPath');
  cl.remove(j);
  ok(cl.count === 0 && cl.add({ pos: [3, 0, 0] }) === 0, 'remove frees the slot');
}

// ---- 8. behaviour tree, blackboard, senses ----
{
  const log = [];
  const say = (s, r = SUCCESS) => bt.action(s, () => { log.push(s); return r; });
  const tree = (root) => createBehaviorTree(root);
  ok(tree(bt.sequence(say('a'), say('b', FAILURE), say('c'))).tick(0.1) === FAILURE && log.join() === 'a,b', 'sequence stops at the first failure');
  log.length = 0;
  ok(tree(bt.selector(say('a', FAILURE), say('b'), say('c'))).tick(0.1) === SUCCESS && log.join() === 'a,b', 'selector stops at the first success');
  let n = 0, aborted = 0, high = false;
  const seq = tree(bt.sequence(bt.action('once', () => { n++; return SUCCESS; }), bt.wait(0.25), say('done')));
  seq.tick(0.1); seq.tick(0.1);
  ok(seq.status === RUNNING && n === 1 && seq.active().join() === 'wait 0.25', 'a sequence remembers its running child (earlier ones are not asked again)');
  ok(seq.tick(0.1) === SUCCESS, 'and finishes');
  const sel = tree(bt.selector(bt.condition('alarm', () => high), bt.action('work', () => RUNNING, () => aborted++)));
  sel.tick(0.1); high = true; sel.tick(0.1);
  ok(aborted === 1 && sel.status === SUCCESS, 'a selector asks from the top each tick: the higher branch interrupts, the running action is aborted');
  ok(tree(bt.invert(say('x', FAILURE))).tick(0) === SUCCESS && tree(bt.parallel(1, say('p', FAILURE), say('q'))).tick(0) === SUCCESS && tree(bt.parallel(say('p', FAILURE), say('q'))).tick(0) === FAILURE, 'invert, parallel (need 1 of 2; need all)');
  const cd = tree(bt.cooldown(1, say('shot')));
  log.length = 0;
  for (let i = 0; i < 25; i++) cd.tick(0.1);
  ok(log.length === 3, `cooldown 1 s: ${log.length} shots in 2.5 s`);
  const to = tree(bt.timeout(0.3, bt.action('slow', () => RUNNING)));
  to.tick(0.2); ok(to.tick(0.2) === FAILURE, 'timeout fails a child that runs too long');
  ok(/> wait|\+ once|sequence/.test(seq.describe()) && seq.describe().split('\n').length === 4, 'describe(): one line a node with its last status');
  const bb = createBlackboard({ hp: 3 });
  const seen = [];
  bb.onChange((k, v) => seen.push(k));
  bb.time = 2; bb.set('target', 'x'); bb.time = 5;
  ok(bb.get('hp') === 3 && bb.age('target') === 3 && bb.age('nothing') === Infinity && seen.join() === 'target' && bb.delete('target') && !bb.has('target'), 'blackboard: get, set, age, onChange, delete');

  // senses: a wall between, a cone
  const g = gridOf(160, 160, -10, -10, (x, z) => (Math.abs(x) < 0.2 && z < 2 ? WALL : OPEN));
  const senses = createSenses(g);
  const me = { pos: [-3, 0, 0], heading: [1, 0] };
  ok(!senses.sees(me, [3, 0, 0]) && senses.sees(me, [-2, 0, 6]) === false && senses.sees(me, [3, 0, 6]), 'sight: a wall hides; out of the 110 degree cone is unseen; past the wall end is seen');
  ok(senses.sees(me, [-1, 0, 1]) && !senses.sees(me, [-6, 0, 0]) && senses.sees(me, [-3.8, 0, 0]) && !senses.sees(me, [-1, 0, 1], { range: 1.5 }), 'in the cone: seen; behind: not; within `near`: felt; beyond range: not');
  me.heading = [0, 1];
  ok(senses.sees(me, [-2, 0, 6]) && !senses.sees(me, [-1, 0, -1]), 'turned: what was outside the cone is seen, what was inside is not');
  senses.noise([-3, 0, 5], { radius: 6, tag: 'step' });
  senses.noise([3, 0, 0], { radius: 7, tag: 'bang' });
  ok(senses.hears(me).tag === 'step' && senses.hears(me, { tag: 'bang' }) === null && senses.hears(me, { tag: 'bang', muffle: 1 }).tag === 'bang', 'hearing: by distance over reach; a wall halves the reach');
  senses.update(1);
  ok(senses.hears(me) === null, 'noises fade (ttl)');
}

// ---- 9. behaviours on crowd actors and on a walker agent ----
{
  const g = gridOf(160, 160, -10, -10, (x, z) => (Math.abs(x) < 0.2 && z < 2 ? WALL : OPEN));
  const nav = createNavGrid(g), senses = createSenses(g), crowd = createCrowd(nav, { max: 16 });
  const step = (brains, n, each) => { for (let s = 0; s < n; s++) { senses.update(1 / 60); for (const b of brains) b.tick(1 / 60); crowd.update(1 / 60); if (each && each(s) === false) return s; } return n; };
  // patrol
  const gi = crowd.add({ pos: [-6, 0, -6], speed: 2 }), pts = [[-6, 0, -3], [-3, 0, -6]];
  const visited = new Set();
  const pb = createBehaviorTree(patrol(pts, { wait: 0.2 }), { actor: crowd.actor(gi), nav, senses });
  step([pb], 1200, () => { pts.forEach((p, q) => { if (Math.hypot(crowd.x[gi] - p[0], crowd.z[gi] - p[2]) < 0.5) visited.add(q); }); });
  ok(visited.size === 2 && pb.status === RUNNING, 'patrol: both points visited, still going round');
  crowd.remove(gi);

  // guard: patrols, sees the player, chases and catches; loses sight, investigates the last known place, returns
  const gd = crowd.add({ pos: [-6, 0, -6], speed: 2.2 }), player = { pos: [-6, 0, 5] }, pi = crowd.add({ pos: player.pos, fixed: true });
  let caught = 0;
  const seenStates = new Set();
  const brain = createBehaviorTree(guard({ points: [[-6, 0, -6], [-3, 0, -6]], onCatch: () => caught++ }), { actor: crowd.actor(gd), nav, senses, perception: { targets: () => [player], range: 9, fov: 120, memory: 0.5 } });
  step([brain], 300, () => { seenStates.add(brain.active()[0]); });
  ok(!brain.blackboard.has('target') && caught === 0 && seenStates.has('patrol'), 'guard: player 11 m away, out of range: patrolling');
  player.pos[0] = -9; player.pos[2] = -4; crowd.move(pi, ...player.pos);   // ahead of its walk back to the first point
  const t1 = step([brain], 900, () => { seenStates.add(brain.active()[0]); crowd.move(pi, ...player.pos); return caught === 0; });
  ok(caught > 0 && seenStates.has('chase') && Math.hypot(crowd.x[gd] - player.pos[0], crowd.z[gd] - player.pos[2]) < 1.4, `player steps into view: chased and caught in ${(t1 / 60).toFixed(1)} s`);
  // the player goes behind the wall (teleports: out of sight at once)
  player.pos[0] = 6; player.pos[2] = -6; crowd.move(pi, ...player.pos);
  seenStates.clear();
  step([brain], 60, () => { seenStates.add(brain.active()[0]); });
  const lk = brain.blackboard.get('lastKnown');
  ok(!brain.blackboard.has('target') && lk && lk[0] === 6 && seenStates.has('chase') && brain.active()[0] === 'investigate', 'out of sight: chased for `memory` 0.5 s more, then the target is dropped and its last place investigated');
  brain.blackboard.set('lastKnown', [-4, 0, 3]);   // (a nearer place, to keep the check short)
  const t2 = step([brain], 900, () => { seenStates.add(brain.active()[0]); return brain.blackboard.has('lastKnown'); });
  ok(!brain.blackboard.has('lastKnown') && Math.hypot(crowd.x[gd] + 4, crowd.z[gd] - 3) < 0.9, `walked to the last known place, looked for 2 s, forgot (${(t2 / 60).toFixed(1)} s)`);
  step([brain], 60, () => { seenStates.add(brain.active()[0]); });
  if (process.env.DBG) console.log([...seenStates], brain.describe(), brain.blackboard.toJSON());
  ok(seenStates.has('patrol'), 'back to the patrol');
  // a noise behind the wall draws it
  senses.noise([-2, 0, 6], { radius: 30, source: player });
  step([brain], 8, null);   // perception runs every 0.1 s; a noise lives 0.6 s
  ok(brain.blackboard.has('heard'), 'a noise within reach is written to the blackboard');
  step([brain], 1200, () => brain.blackboard.has('heard'));
  ok(!brain.blackboard.has('heard') && Math.hypot(crowd.x[gd] + 2, crowd.z[gd] - 6) < 1.5, `went to the noise (${Math.hypot(crowd.x[gd] + 2, crowd.z[gd] - 6).toFixed(2)} m from it) and forgot it`);
  ok(brain.describe().split('\n').length > 10, 'the guard tree describes itself');

  // flee and follow on crowd actors
  const fl = crowd.add({ pos: [5, 0, 5] }), fb = createBehaviorTree(flee({ distance: 6 }), { actor: crowd.actor(fl), nav, senses });
  fb.blackboard.set('threat', { pos: [4, 0, 5] });
  let st;
  step([fb], 900, () => (st = fb.status) === RUNNING);
  ok(st === SUCCESS && Math.hypot(crowd.x[fl] - 4, crowd.z[fl] - 5) >= 6, `flee: ${Math.hypot(crowd.x[fl] - 4, crowd.z[fl] - 5).toFixed(1)} m from the threat`);
  const leader = { pos: [6, 0, -6] }, fo = crowd.add({ pos: [2, 0, -2] }), ob = createBehaviorTree(follow({ distance: 1.5 }), { actor: crowd.actor(fo), nav, senses });
  ob.blackboard.set('leader', leader);
  step([ob], 400, null);
  const d1 = Math.hypot(crowd.x[fo] - 6, crowd.z[fo] + 6);
  leader.pos = [8, 0, 2];
  step([ob], 600, null);
  const d2 = Math.hypot(crowd.x[fo] - 8, crowd.z[fo] - 2);
  ok(d1 < 2.2 && d1 > 0.8 && d2 < 2.2, `follow: keeps ${d1.toFixed(2)} m, then ${d2.toFixed(2)} m after the leader moves`);

  // the same chase on a walker agent (createNavAgent through agentActor)
  const ag = createNavAgent(nav, { pos: [-6, 0, 6], speed: 2 }), act = agentActor(ag), target = { pos: [5, 0, 6] };
  const cb = createBehaviorTree(bt.sequence(chase({ reach: 1 })), { actor: act, nav, senses });
  cb.blackboard.set('target', target);
  let s2 = RUNNING;
  for (let s = 0; s < 1200 && s2 === RUNNING; s++) { s2 = cb.tick(1 / 60); ag.update(1 / 60); }
  ok(s2 === SUCCESS && Math.hypot(ag.pos[0] - 5, ag.pos[2] - 6) < 1.05, 'chase drives a createNavAgent walker through agentActor (round the wall end)');
  cb.blackboard.set('target', { pos: [30, 0, 0] });   // off the grid
  ok(cb.tick(1 / 60) === FAILURE, 'a target with no way to it fails the chase');
}

// ---- 10. timing ----
{
  const world = (n, density = 0.22) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const m = n >> 3, blocked = new Uint8Array(m * m), half = (n * cell) / 2;
    for (let q = 0; q < m * m; q++) blocked[q] = rnd() < density ? 1 : 0;
    const g = gridOf(n, n, -half, -half, (x, z, i, j) => (blocked[(j >> 3) * m + (i >> 3)] ? WALL : OPEN));
    const pairs = [];
    for (let q = 0; q < 300; q++) pairs.push([[(rnd() - 0.5) * (2 * half - 0.4), 0, (rnd() - 0.5) * (2 * half - 0.4)], [(rnd() - 0.5) * (2 * half - 0.4), 0, (rnd() - 0.5) * (2 * half - 0.4)]]);
    return { g, pairs, half };
  };
  for (const n of [160, 512]) {
    const { g, pairs } = world(n), t0 = performance.now(), nav = createNavGrid(g), bake = performance.now() - t0;
    for (const [a, b] of pairs.slice(0, 40)) nav.findPath(a, b);
    const runs = [], p95s = [], maxs = [];
    let found = 0, len = 0;
    for (let r = 0; r < 5; r++) {
      const ms = [];
      found = 0; len = 0;
      for (const [a, b] of pairs) { const t = performance.now(), p = nav.findPath(a, b); ms.push(performance.now() - t); if (p) { found++; len += pathLength(p); } }
      ms.sort((x, y) => x - y);
      runs.push(ms.reduce((s, x) => s + x, 0) / ms.length); p95s.push(ms[285]); maxs.push(ms[299]);
    }
    console.log(`    ${n} x ${n} (${(n * cell).toFixed(0)} m, 22% pillars): bake ${bake.toFixed(0)} ms; findPath mean ${spread(runs)} ms, p95 ${spread(p95s)}, max ${spread(maxs)} (median of 5 runs of 300, min-max); ${found}/300 found, mean length ${(len / found).toFixed(1)} m`);
    if (n === 512) {
      // with area costs the coarse corridor is skipped: the price of costs
      nav.setArea({ box: [-5, -1, -5, 5, 3, 5] }, 2); nav.setAreaCost(2, 3);
      const ms = [];
      for (let r = 0; r < 3; r++) { const t = performance.now(); for (const [a, b] of pairs) nav.findPath(a, b); ms.push((performance.now() - t) / pairs.length); }
      console.log(`    512 x 512 with an area cost set (plain cell A*, no corridor): mean ${spread(ms)} ms`);
      const ob = [];
      for (let r = 0; r < 5; r++) { const t = performance.now(); for (let q = 0; q < 50; q++) { const id = nav.block({ obb: [q * 0.3 - 8, 3.3, 0.6, 0.08, q * 0.1, 0, 2] }); nav.unblock(id); } ob.push((performance.now() - t) / 100); }
      console.log(`    512 x 512: block or unblock of a door leaf ${spread(ob)} ms each`);
    }
  }
  console.log(`    re-bake after a solid moves (160 x 160, carveSolids: unblock + block + fit bits + coarse pieces): door leaf 1.2 m ${rebake.door} ms, crate 0.8 m ${rebake.crate} ms (median of 5 x 40 moves, min-max)`);

  // crowd step by size: agents (radii 0.25 to 0.35) spread over a 64 m world with 1 m pillars on 8% of it, each
  // walking to a far goal through the others
  const { g, half } = world(512, 0.08), nav = createNavGrid(g);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = [];
  for (const N of [200, 500, 1000, 2000]) {
    const queue = createPathQueue(nav, { budgetMs: 1e9 }), crowd = createCrowd(nav, { max: N, queue });
    const spot = () => nav.nearest([(rnd() - 0.5) * 2 * (half - 1), 0, (rnd() - 0.5) * 2 * (half - 1)], { snap: 3 });
    for (let q = 0; q < N; q++) { let p; while (!(p = spot())); crowd.add({ pos: p, radius: 0.25 + 0.05 * (q % 3) }); }
    const goals = () => { for (let q = 0; q < N; q++) { let p; while (!(p = spot())); crowd.setGoal(q, p); } queue.update(); };
    goals();
    for (let s = 0; s < 120; s++) crowd.update(1 / 60);   // warm, and into each other
    const ms = [];
    let moving = 0;
    for (let r = 0; r < 5; r++) {
      const t = performance.now();
      for (let s = 0; s < 120; s++) crowd.update(1 / 60);
      ms.push((performance.now() - t) / 120);
    }
    let arrived = 0, nopath = 0, slow = 0;
    for (let q = 0; q < N; q++) { if (crowd.arrived(q)) arrived++; else if (!crowd.pathOf(q)) nopath++; else if (Math.hypot(crowd.vx[q], crowd.vz[q]) > 0.3) moving++; else slow++; }
    rows.push({ N, ms: med(ms), text: `${N}: ${spread(ms)} ms (at the end ${moving} walking, ${slow} held up, ${arrived} arrived, ${nopath} without a path)` });
  }
  console.log(`    crowd.update (ORCA, 8 neighbours, nav clamp; paths already planned), median of 5 x 120 steps (min-max): ${rows.map((r) => r.text).join('; ')}`);
  ok(rows[0].ms < 4, `200 agents: ${rows[0].ms.toFixed(3)} ms a step`);
  // a dense crowd: 300 in a 12 m square all crossing it
  const navo = createNavGrid(open()), dense = createCrowd(navo, { max: 300 });
  for (let q = 0; q < 300; q++) { const i = dense.add({ pos: [-9 + (q % 20) * 0.9, 0, -9 + Math.floor(q / 20) * 1.2] }); dense.setGoal(i, [9 - (q % 20) * 0.9, 0, 9 - Math.floor(q / 20) * 1.2]); }
  const dm = [];
  let w = 0;
  for (let r = 0; r < 5; r++) { const t = performance.now(); for (let s = 0; s < 120; s++) dense.update(1 / 60); dm.push((performance.now() - t) / 120); w = Math.max(w, overlapOf(dense)); }
  let arrived = 0;
  for (let s = 0; s < 3600; s++) dense.update(1 / 60);
  for (let q = 0; q < 300; q++) if (dense.arrived(q)) arrived++;
  console.log(`    dense: 300 agents crossing a 20 m square through each other: ${spread(dm)} ms a step, deepest overlap ${(w * 1000).toFixed(0)} mm, ${arrived}/300 arrived after 70 s`);
}
console.log('navx check: ok');
