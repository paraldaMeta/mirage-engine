// Node checks of the walker on a hand-made walk grid: a wall with a gate, stairs, a box to jump onto.
import { makeGrid, MAXL } from './src/walkgrid.js';
import { createWalker } from './src/walker.js';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('  ok', m); };
const cell = 0.125, x0 = -5, z0 = -5, nx = 80, nz = 80;
const floors = new Float32Array(nx * nz * MAXL * 2), count = new Uint8Array(nx * nz);
const set = (k, list) => { count[k] = list.length; list.forEach(([f, c], l) => { floors[(k * MAXL + l) * 2] = f; floors[(k * MAXL + l) * 2 + 1] = c; }); };
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell, k = j * nx + i;
  let L = [[0, Infinity]];
  if (Math.abs(z) < 0.3) L = Math.abs(x) < 1 ? [[0, 2.3], [3.5, Infinity]] : [[3.5, Infinity]];          // wall, gate
  if (x > 2 && x < 4 && z > 1) L = [[Math.min(0.17 * Math.ceil((z - 1) / 0.3), 1.19), Infinity]];       // stairs
  if (x > -4 && x < -3 && z > 2 && z < 3) L = [[0.6, Infinity]];                                         // a box
  if (x > -4.5 && x < -3.5 && z > -4.5 && z < -3.5) L = [[0, 0.4], [0.45, Infinity]];                      // a bench: seat over a void
  set(k, L);
}
const grid = makeGrid({ nx, nz, x0, z0, cell, floors, count });
const run = (w, secs, input) => { for (let t = 0; t < secs; t += 1 / 60) w.update(1 / 60, input); return w; };
let w = run(createWalker(grid, { pos: [0, 0, -2] }), 3, { z: 1 });
ok(w.pos[2] > 1 && w.pos[1] === 0, `gate passes (z ${w.pos[2].toFixed(2)})`);
w = run(createWalker(grid, { pos: [-3, 0, -2] }), 3, { z: 1 });
ok(Math.abs(w.pos[2] - (-0.3 - 0.28)) < 0.1, `wall blocks (z ${w.pos[2].toFixed(2)})`);
w = run(createWalker(grid, { pos: [-4.5, 0, -1] }), 1.5, { x: 0.6, z: 0.8 });
ok(w.pos[0] > -3.5 && w.pos[2] < -0.45, `slides along the wall (x ${w.pos[0].toFixed(2)})`);
w = run(createWalker(grid, { pos: [3, 0, 0.6] }), 4, { z: 1 });
ok(Math.abs(w.pos[1] - 1.19) < 1e-6, `stairs climb (y ${w.pos[1].toFixed(2)})`);
w = run(createWalker(grid, { pos: [3, 0, 0.6] }), 4, { z: 1 }); run(w, 4, { z: -1 });
ok(w.pos[1] === 0, 'stairs descend');
w = run(createWalker(grid, { pos: [-3.5, 0, 1.2] }), 2, { z: 1 });
ok(w.pos[1] === 0 && w.pos[2] < 1.8, `box 0.6 m blocks walking (z ${w.pos[2].toFixed(2)})`);
let top = 0; for (let t = 0; t < 0.9; t += 1 / 60) { w.update(1 / 60, { z: 1, jump: t < 0.1 }); top = Math.max(top, w.pos[1]); }
ok(Math.abs(w.pos[1] - 0.6) < 1e-6 && top > 0.8, `jump onto it (apex ${top.toFixed(2)})`);
w = run(createWalker(grid, { pos: [0, 0, 0] }), 1, {});
ok(w.pos[1] === 0, 'stands under the gate arch');
// jumping at a bench whose seat overhangs a void must never fall through the world (landing on the edge or beside it)
let low = 0;
for (let d = 0.3; d < 1.6; d += 0.05) {
  w = createWalker(grid, { pos: [-4, 0, -3.5 + d] });
  for (let t = 0; t < 1.5; t += 1 / 60) { w.update(1 / 60, { z: -1, jump: t < 0.05 }); low = Math.min(low, w.pos[1]); }
}
ok(low > -0.01, `jumps at an overhanging bench never fall through (lowest feet ${low.toFixed(2)})`);

// a 45° wall (x + z > 2): walking into it at an angle slides along it (B3: axis-separated sliding stalled here)
const f45 = new Float32Array(nx * nz * MAXL * 2), c45 = new Uint8Array(nx * nz).fill(1);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { f45[(j * nx + i) * MAXL * 2] = x0 + (i + 0.5) * cell + z0 + (j + 0.5) * cell > 2 ? 3.5 : 0; f45[(j * nx + i) * MAXL * 2 + 1] = Infinity; }
const g45 = makeGrid({ nx, nz, x0, z0, cell, floors: f45, count: c45 });
const n45 = [Math.SQRT1_2, Math.SQRT1_2], t45 = [Math.SQRT1_2, -Math.SQRT1_2];
for (const deg of [0, 30, 60]) {
  const a = (deg * Math.PI) / 180, d = [n45[0] * Math.cos(a) + t45[0] * Math.sin(a), n45[1] * Math.cos(a) + t45[1] * Math.sin(a)];
  w = run(createWalker(g45, { pos: [0.6, 0, 0.6] }), 2, { x: d[0], z: d[1] });
  const along = (w.pos[0] - 0.6) * t45[0] + (w.pos[2] - 0.6) * t45[1], ideal = 1.5 * 2 * Math.sin(a), into = w.pos[0] + w.pos[2];
  ok(into < 1.8 && (deg ? along > 0.9 * ideal : Math.abs(along) < 0.05),
    `45° wall, ${deg}° off its normal: ${deg ? 'slides' : 'stops'} (${along.toFixed(2)} m along of ${ideal.toFixed(2)}, x + z ${into.toFixed(2)})`);
}
console.log('play check: ok');
