#!/usr/bin/env node
// Mirage original code. NPC navigation (packages/play/src/navgrid.js) on a real baked walk grid, in headless Chrome:
// walled-garden with ?npc=4. Fit bits against the walker on 20 000 random floors of the real grid; a path from the
// gate up both terrace stairs into the pavilion (and its cost per query); an agent walked along it with fixed steps
// (it must arrive and never stand on a cell it does not fit); the pavilion door blocked and unblocked; the demo's
// travellers stepping. Needs Chrome with a GPU and a build, so it is not in npm test:
//   npm run build -w examples/walled-garden && node packages/tools/nav-check.mjs [examples/walled-garden/dist]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from './src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../../examples/walled-garden/dist'));
const srv = await serve(dist);
const browser = await launch({ w: 320, h: 240 });
let failed = 0;
const check = (name, ok, v) => { if (!ok) failed++; console.log(ok ? 'ok  ' : 'FAIL', name, v === undefined ? '' : JSON.stringify(v)); };
try {
  const { page, errors } = await open(browser, srv.url + '?npc=4&ui=0&w=320&h=240&spp=1');
  const R = await page.evaluate(() => {
    const { play, npc, built } = window.__mirage;
    play.stop();
    const { nav, createNavAgent } = npc, grid = play.grid, plan = built.plan, P = nav.profile();
    const r3 = (v) => +v.toFixed(3);
    const out = { cells: grid.nx * grid.nz, nodes: nav.nodes, createMs: nav.ms, fitMs: P.ms, bakeGridMs: grid.stats?.ms };
    // 1. the fit bit against the walker on random floors of the real grid
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const w = createNavAgent(nav, { pos: [0, 0, 45] }).walker;
    let n = 0, same = 0, fitN = 0;
    const misses = [];
    while (n < 20000) {
      const k = Math.floor(rnd() * grid.nx * grid.nz);
      if (!grid.count[k]) continue;
      const l = Math.floor(rnd() * grid.count[k]), i = k % grid.nx, j = (k - i) / grid.nx;
      const x = grid.x0 + (i + 0.5) * grid.cell, z = grid.z0 + (j + 0.5) * grid.cell, f = grid.floors[(k * 4 + l) * 2];
      const bit = P.fit[nav.nodeAt(x, f, z)] === 1;
      let walk = grid.supportAt(k, f, 0.4)?.[0] === f && w.fits(x, z, f);
      if (walk) { w.place([x, f, z]); w.update(1 / 60, {}); w.update(1 / 60, {}); walk = w.pos[0] === x && w.pos[2] === z && w.fits(x, z, w.pos[1]); }
      n++; if (bit === walk) same++; else if (misses.length < 5) misses.push([r3(x), r3(f), r3(z), bit]);
      if (bit) fitN++;
    }
    out.fitCompare = { n, same, fitN, misses };
    // 2. a path from the gate up both stairs and into the pavilion
    const feet = (name) => { const v = plan.viewpoints.find((q) => q.name === name); return [v.eye[0], v.eye[1] - 1.62, v.eye[2]]; };
    const from = feet('gate'), to = feet('interior');
    const path = nav.findPath(from, to);
    out.path = path && { points: path.length, length: nav.stats.length, end: path.at(-1).map(r3), goalFloor: r3(nav.floorOf(nav.nodeAt(...to))) };
    out.coarseExpanded = nav.stats.coarseExpanded; out.cellExpanded = nav.stats.cellExpanded;
    const ms = [];
    for (let q = 0; q < 25; q++) { const t = performance.now(); nav.findPath(from, to); ms.push(performance.now() - t); }
    ms.sort((a, b) => a - b);
    out.queryMs = { median: r3(ms[12]), min: r3(ms[0]), max: r3(ms[24]) };
    const ms2 = [];
    for (let q = 0; q < 25; q++) { const t = performance.now(); nav.findPath(feet('lawn corner'), feet('pools')); ms2.push(performance.now() - t); }
    ms2.sort((a, b) => a - b);
    out.query2Ms = { median: r3(ms2[12]), length: nav.stats.length };
    // 3. an agent walks it with fixed steps
    const a = createNavAgent(nav, { pos: from });
    a.setGoal(to);
    let t = 0, off = 0;
    const levels = new Set();
    for (; t < 240 && !a.arrived; t += 1 / 60) {
      a.update(1 / 60);
      if (!nav.fits(a.pos[0], a.pos[1], a.pos[2])) off++;
      levels.add(Math.round(a.pos[1] * 10) / 10);
    }
    out.walk = { arrived: a.arrived, seconds: r3(t), off, end: a.pos.map(r3), toGoal: r3(Math.hypot(a.pos[0] - to[0], a.pos[2] - to[2])), dy: r3(a.pos[1] - nav.floorOf(nav.nodeAt(...to))), levels: [...levels].filter((y) => [0, 1.6, 3.2].includes(y)) };
    // a flow field over the whole garden toward the gate
    const field = nav.flowField(from);
    out.field = { ms: field.ms, reached: field.reached, fromInterior: r3(field.distance(...to)) };
    // 4. the pavilion door shut, then open again
    const pv = plan.pavilion, dz = pv.center[2] + pv.size / 2;
    const door = nav.block({ box: [-pv.door / 2 - 0.2, pv.center[1], dz - 0.6, pv.door / 2 + 0.2, pv.center[1] + 3, dz + 0.6] });
    out.editMs = nav.stats.editMs;
    out.doorShut = nav.findPath(from, to);
    out.doorShut = out.doorShut ? out.doorShut.length : null;
    nav.unblock(door);
    out.doorOpen = !!nav.findPath(from, to);
    // 5. the demo's travellers: 10 s of steps
    const starts = npc.npcs.map((c) => c.agent.pos.slice());
    let offN = 0, stepMs = 0;
    for (let q = 0; q < 600; q++) {
      const t1 = performance.now(); npc.step(1 / 60); stepMs += performance.now() - t1;
      for (const c of npc.npcs) if (!nav.fits(c.agent.pos[0], c.agent.pos[1], c.agent.pos[2])) offN++;
    }
    out.npcs = { n: npc.npcs.length, moved: npc.npcs.map((c, q) => r3(Math.hypot(c.agent.pos[0] - starts[q][0], c.agent.pos[2] - starts[q][2]))), off: offN, stepMs: r3(stepMs / 600) };
    return out;
  });
  console.log(JSON.stringify(R, null, 1));
  const fc = R.fitCompare;
  check(`fit bit = the walker on ${fc.same}/${fc.n} random floors of the real grid (${fc.fitN} fit)`, fc.same / fc.n > 0.999, fc.misses);
  check('a path from the gate up both terrace stairs into the pavilion interior', R.path && R.path.end[1] === R.path.goalFloor && R.path.goalFloor > 3.5, R.path);
  check('the agent walks it over all three levels, arrives, and never stands on a cell it does not fit', R.walk.arrived && R.walk.off === 0 && R.walk.toGoal < 0.2 && R.walk.levels.length === 3, R.walk);
  check('the pavilion door shut: no way in; open: the way is back', R.doorShut === null && R.doorOpen, { shut: R.doorShut, open: R.doorOpen, editMs: R.editMs });
  check('the demo travellers walk and stay on fit cells', R.npcs.n === 4 && R.npcs.moved.every((d) => d > 1) && R.npcs.off === 0, R.npcs);
  check('no console errors', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `nav check: ${failed} failing` : 'nav check: ok');
process.exit(failed ? 1 : 0);
