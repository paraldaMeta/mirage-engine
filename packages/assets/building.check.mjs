// Mirage original code. Node check of the building kit (src/building.js): every part builds finite geometry into a
// batch, stands where its header says (on y = 0, inside its stated footprint), and house() gives the same house for
// the same seed, a different one for another, with its door on the front. The look is examples/demos/building.
import * as THREE from 'three';
import * as K from './src/building/index.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('  FAIL ' + m); } };
const M = Object.fromEntries(['wall', 'trim', 'stone', 'wood', 'roof', 'metal', 'glass', 'floor'].map((k) => [k, { name: k }]));
/** a stand-in batch: the geometries in world space, the materials they use */
function batch() {
  const parts = [];
  return { parts, add(g, mat, m) { const c = g.clone(); if (m) c.applyMatrix4(m); parts.push({ g: c, mat }); return this; },
    bounds() { const b = new THREE.Box3(); for (const p of parts) { p.g.computeBoundingBox(); b.union(p.g.boundingBox); } return b; },
    tris() { return parts.reduce((a, p) => a + (p.g.index ? p.g.index.count : p.g.attributes.position.count) / 3, 0); },
    finite() { return parts.every((p) => p.g.attributes.position.array.every(Number.isFinite)); } };
}
const I = new THREE.Matrix4();
const CASES = [
  ['wallPanel', {}, { x: [-1.5, 1.5], y: [0, 3] }], ['wallDoor', {}, { x: [-1.5, 1.5], y: [0, 3] }], ['wallWindow', { count: 2 }, { x: [-1.5, 1.5], y: [0, 3] }],
  ['wallOpenings', { width: 6, openings: [{ x: -1.5, width: 1, height: 2.2, kind: 'door', arch: 'round' }, { x: 1.5, width: 1.2, height: 1.2, sill: 1, kind: 'window' }] }, { x: [-3, 3], y: [0, 3] }],
  ['corner', {}, { y: [0, 3] }], ['doorLeaf', { style: 'plank' }, { y: [0, 2.2] }], ['doorLeaf', { style: 'glass' }, { y: [0, 2.2] }], ['windowFrame', {}, { y: [0, 1.4] }], ['shutters', {}, { y: [0, 1.4] }],
  ['floorSlab', {}, { y: [-0.25, 0] }], ['column', {}, { y: [0, 3] }], ['column', { style: 'square' }, { y: [0, 3] }], ['beam', {}, { x: [0, 3] }], ['archway', {}, { y: [0, 3.7] }],
  ['stairs', { rise: 3 }, { y: [-0.15, 4.1] }], ['stairs', { rise: 1, solid: true, rails: [false, false] }, { y: [0, 1] }], ['spiralStairs', {}, { y: [0, 4.1] }],
  ['railing', {}, { x: [-0.05, 3.05], y: [0, 1.03] }], ['railing', { style: 'glass' }, { y: [0, 1.03] }], ['railing', { style: 'solid' }, { y: [0, 1.07] }], ['railing', { style: 'cable' }, { y: [0, 1.03] }],
  ['ramp', {}, { y: [0, 0.63] }], ['stoop', {}, { y: [0, 0.5] }], ['ladder', { cage: true }, { y: [0, 4] }],
  ['roofGable', {}, { x: [-4.95, 4.95] }], ['roofHip', {}, { x: [-4.95, 4.95] }], ['roofFlat', {}, { y: [-0.2, 0.86] }], ['dormer', {}, {}], ['chimney', {}, { y: [0, 2.5] }],
  ['gutter', {}, { y: [-3, 0.1] }], ['balcony', {}, {}], ['awning', {}, {}], ['fence', {}, { y: [0, 1.2] }], ['fence', { style: 'wire' }, { y: [0, 1.2] }], ['fence', { style: 'panel' }, { y: [0, 1.2] }],
  ['gate', { open: 0.5 }, { y: [0, 2.3] }], ['moulding', { length: 3 }, { x: [-1.5, 1.5], z: [0, 0.14], y: [0, 0.14] }],
];
const seen = new Set();
for (const [name, opts, want] of CASES) {
  const b = batch(); K[name](b, M, I, opts); seen.add(name);
  const bb = b.bounds(), label = `${name}(${JSON.stringify(opts)})`;
  ok(b.parts.length > 0 && b.finite(), `${label} builds finite geometry (${b.parts.length} parts)`);
  ok(b.parts.every((p) => p.mat && M[p.mat.name] === p.mat), `${label} uses the material set's slots`);
  for (const [axis, [lo, hi]] of Object.entries(want)) ok(bb.min[axis] > lo - 0.06 && bb.max[axis] < hi + 0.06, `${label} spans ${axis} ${bb.min[axis].toFixed(2)}..${bb.max[axis].toFixed(2)} (expected ${lo}..${hi})`);
}
for (const n of ['wallPanel', 'wallOpenings', 'wallDoor', 'wallWindow', 'corner', 'doorLeaf', 'windowFrame', 'shutters', 'floorSlab', 'column', 'beam', 'archway', 'stairs', 'spiralStairs', 'railing', 'ramp', 'stoop', 'ladder', 'roofGable', 'roofHip', 'roofFlat', 'dormer', 'chimney', 'gutter', 'balcony', 'awning', 'fence', 'gate', 'moulding']) ok(seen.has(n), `${n} is checked`);
// a wall with a window has a hole: fewer triangles than... no: more faces, and its front face area is smaller than the plain panel's
{
  const area = (b) => { let a = 0; for (const p of b.parts) { if (p.mat.name !== 'wall') continue; const g = p.g.index ? p.g.toNonIndexed() : p.g, q = g.attributes.position, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(); for (let i = 0; i < q.count; i += 3) { A.fromBufferAttribute(q, i); B.fromBufferAttribute(q, i + 1); C.fromBufferAttribute(q, i + 2); const n = B.clone().sub(A).cross(C.clone().sub(A)); if (n.z > 1e-9) a += n.length() / 2; } } return a; };
  const p = batch(); K.wallPanel(p, M, I, { plinth: 0 }); const w = batch(); K.wallWindow(w, M, I, { window: [1, 1] });
  ok(Math.abs(area(p) - 9) < 0.01 && Math.abs(area(w) - 8) < 0.02, `a 1 x 1 m window takes 1 m² out of the 3 x 3 m wall's face (${area(p).toFixed(2)} -> ${area(w).toFixed(2)})`);
}
// stairs: the rise is what was asked, the run follows the going
{ const b = batch(), r = K.stairs(b, M, I, { rise: 3, steps: 17, going: 0.28, rails: [false, false], stringer: false }), bb = b.bounds(); ok(Math.abs(r.run - 4.76) < 1e-6 && Math.abs(bb.max.y - 3) < 0.06 && bb.min.z < -4.7 && bb.min.z > -4.85, `stairs: 17 steps rise 3 m over a 4.76 m run (top ${bb.max.y.toFixed(2)}, back ${bb.min.z.toFixed(2)})`); }
// roofs: the gable's ridge is where its pitch puts it
{ const b = batch(), r = K.roofGable(b, M, I, { width: 8, depth: 6, pitch: 45, overhang: 0 }); ok(Math.abs(r.rise - 3) < 1e-6 && Math.abs(b.bounds().max.y - 3) < 0.2, `roofGable: 45° over 6 m rises 3 m (top ${b.bounds().max.y.toFixed(2)})`); }
// houses
const H = (o) => { const b = batch(), info = K.house(b, M, I, o); return { b, info, sig: b.parts.length + ':' + b.tris() + ':' + b.bounds().max.y.toFixed(3) }; };
const h1 = H({ seed: 7 }), h1b = H({ seed: 7 }), h2 = H({ seed: 8 });
ok(h1.sig === h1b.sig, 'house: the same seed gives the same house');
ok(h1.sig !== h2.sig, 'house: another seed gives another house');
ok(h1.info.width === 9 && h1.info.depth === 6 && h1.info.doors.length === 1 && h1.info.doors[0][2] > 2.5, `house: 3 x 2 bays is 9 x 6 m with its door on the front (${JSON.stringify(h1.info.doors[0])})`);
for (const roof of ['gable', 'hip', 'flat']) for (const storeys of [1, 3]) { const h = H({ roof, storeys, bays: [4, 3], seed: 3 }); ok(h.b.finite() && h.info.height > storeys * 3, `house: ${storeys} storeys, ${roof} roof, ${h.b.tris()} triangles, ${h.info.height.toFixed(1)} m tall`); }
ok(Object.keys(K.BUILDING_STYLES).length === 5, 'five material styles');
let threw = 0; try { K.buildingMaterials({ mat: {} }, 'nope'); } catch { threw++; }
ok(threw === 1, 'buildingMaterials: an unknown style throws');
console.log(fails ? `building kit check: ${fails} failed` : `building kit check: ok (${CASES.length} part cases, house ${h1.b.tris()} triangles)`);
process.exit(fails ? 1 : 0);
