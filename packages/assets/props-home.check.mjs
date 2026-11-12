// Mirage original code. Node check of the home and office props (src/props-home/index.js): every prop builds finite,
// tinted geometry into a batch with the material set's slots, stands on y = 0, and is the size of the real thing
// (heights and footprints against common furniture sizes); room() furnishes each kind the same way for a seed. The
// look is examples/demos/home.
import * as THREE from 'three';
import * as K from './src/props-home/index.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('  FAIL ' + m); } };
const SLOTS = ['wood', 'fabric', 'leather', 'metal', 'chrome', 'plastic', 'ceramic', 'glass', 'paper', 'leaf', 'screen'];
const M = Object.fromEntries(SLOTS.map((k) => [k, { name: k }]));
const MB = Object.fromEntries(['wall', 'trim', 'stone', 'wood', 'roof', 'metal', 'glass', 'floor'].map((k) => [k, { name: 'b-' + k }]));
function batch() {
  const parts = [];
  return { parts, add(g, mat, m) { const c = g.clone(); if (m) c.applyMatrix4(m); parts.push({ g: c, mat }); return this; },
    bounds() { const b = new THREE.Box3(); for (const p of parts) { p.g.computeBoundingBox(); b.union(p.g.boundingBox); } return b; },
    tris() { return parts.reduce((a, p) => a + (p.g.index ? p.g.index.count : p.g.attributes.position.count) / 3, 0); } };
}
const I = new THREE.Matrix4();
// [prop, options, { h: [min, max] height, w: [min, max] width (x), d: [min, max] depth (z) }]
const SIZE = [
  ['sofa', {}, { h: [0.75, 0.95], w: [2.3, 2.6], d: [0.85, 1.0] }], ['armchair', {}, { h: [0.75, 0.95], w: [0.95, 1.2] }], ['cushion', {}, { h: [0.1, 0.16], w: [0.4, 0.5] }],
  ['coffeeTable', {}, { h: [0.4, 0.45], w: [1.05, 1.15] }], ['coffeeTable', { glass: true }, { h: [0.4, 0.45] }], ['sideTable', {}, { h: [0.5, 0.6] }],
  ['tvStand', {}, { h: [1.2, 1.4], w: [1.55, 1.65] }], ['television', {}, { h: [0.75, 0.8], w: [1.2, 1.25] }], ['bookshelf', {}, { h: [1.95, 2.05], w: [0.88, 0.92], d: [0.3, 0.34] }],
  ['rug', {}, { h: [0, 0.01], w: [2.35, 2.45] }], ['floorLamp', {}, { h: [1.55, 1.7] }], ['tableLamp', {}, { h: [0.45, 0.6] }],
  ['plant', {}, { h: [0.3, 0.9] }], ['plant', { kind: 'tall' }, { h: [1.3, 1.8] }], ['plant', { kind: 'grass' }, { h: [0.4, 1.0] }],
  ['wallClock', {}, { w: [0.3, 0.34], d: [0, 0.06] }], ['picture', {}, { w: [0.64, 0.68], d: [0, 0.04] }], ['curtain', {}, { v: [2.2, 2.3] }],
  ['diningTable', {}, { h: [0.74, 0.76], w: [1.58, 1.62], d: [0.88, 0.92] }], ['diningTable', { round: true, size: [1.1, 1.1] }, { h: [0.74, 0.76], w: [1.08, 1.12] }],
  ['chair', {}, { h: [0.88, 0.96], w: [0.42, 0.5] }], ['barStool', {}, { h: [0.74, 0.8] }],
  ['kitchenCounter', { wall: false }, { h: [0.95, 1.35], w: [2.38, 2.45], d: [0.6, 0.66] }], ['kitchenCounter', {}, { h: [2.15, 2.25] }],
  ['fridge', {}, { h: [1.84, 1.86], w: [0.58, 0.62] }], ['microwave', {}, { h: [0.27, 0.29] }], ['kettle', {}, { h: [0.19, 0.24] }], ['mug', {}, { h: [0.09, 0.1] }], ['placeSetting', {}, { h: [0.1, 0.13] }],
  ['bed', {}, { h: [0.92, 1.0], w: [1.65, 1.8], d: [2.05, 2.2] }], ['bed', { width: 0.9 }, { w: [0.95, 1.1] }], ['nightstand', {}, { h: [0.5, 0.6] }],
  ['wardrobe', {}, { h: [2.08, 2.15], w: [1.18, 1.22], d: [0.6, 0.66] }], ['dresser', {}, { h: [1.65, 1.75] }], ['dresser', { mirror: false }, { h: [0.82, 0.9] }],
  ['toilet', {}, { h: [0.78, 0.84] }], ['washbasin', {}, { h: [1.8, 1.9], w: [0.6, 0.65] }], ['bathtub', {}, { h: [0.74, 0.84], w: [1.68, 1.72], d: [0.74, 0.76] }], ['towelRail', {}, { h: [1.35, 1.45] }],
  ['desk', {}, { h: [1.1, 1.3], w: [1.38, 1.42], d: [0.68, 0.72] }], ['desk', { kit: false }, { h: [0.73, 0.75] }], ['monitor', {}, { h: [0.48, 0.52] }],
  ['laptop', {}, { h: [0.15, 0.25] }], ['keyboard', {}, { h: [0.02, 0.03], w: [0.43, 0.45] }], ['computerMouse', {}, { h: [0.01, 0.02] }], ['deskLamp', {}, { h: [0.45, 0.6] }],
  ['papers', {}, { h: [0.01, 0.04] }], ['officeChair', {}, { h: [1.0, 1.15], w: [0.55, 0.7] }], ['filingCabinet', {}, { h: [0.98, 1.0] }], ['filingCabinet', { drawers: 4 }, { h: [1.3, 1.34] }],
  ['whiteboard', {}, { h: [2.1, 2.15], w: [1.82, 1.86] }], ['printer', {}, { h: [0.86, 0.9] }], ['waterCooler', {}, { h: [1.4, 1.45] }], ['wasteBin', {}, { h: [0.31, 0.33] }],
  ['partition', {}, { h: [1.39, 1.41], w: [1.59, 1.61] }], ['meetingTable', { chairs: false }, { h: [0.74, 0.76] }], ['meetingTable', {}, { w: [3.2, 4.3] }], ['deskPhone', {}, { h: [0.06, 0.12] }],
];
const seen = new Set(), size = (bb) => ({ h: bb.max.y, v: bb.max.y - bb.min.y, w: bb.max.x - bb.min.x, d: bb.max.z - bb.min.z });
for (const [name, opts, want] of SIZE) {
  const b = batch(); K[name](b, M, I, opts); seen.add(name);
  const bb = b.bounds(), s = size(bb), label = `${name}(${JSON.stringify(opts)})`;
  ok(b.parts.length > 0 && b.parts.every((p) => p.g.attributes.position.array.every(Number.isFinite)), `${label} builds finite geometry`);
  ok(b.parts.every((p) => SLOTS.includes(p.mat.name)), `${label} uses only the material set's slots`);
  ok(b.parts.every((p) => p.mat.name === 'screen' || p.mat.name === 'glass' || p.g.attributes.color), `${label} tints every lit part (a vertex colour)`);
  ok(['wallClock', 'picture', 'curtain', 'whiteboard', 'towelRail'].includes(name) || bb.min.y > -0.006, `${label} stands on y = 0 (min y ${bb.min.y.toFixed(3)})`);
  for (const [k, [lo, hi]] of Object.entries(want)) ok(s[k] >= lo && s[k] <= hi, `${label} ${({ h: 'height', v: 'drop', w: 'width', d: 'depth' })[k]} ${s[k].toFixed(3)} m (${lo}..${hi})`);
}
const ALL = Object.keys(K).filter((k) => typeof K[k] === 'function' && !['homeMaterials', 'room'].includes(k));
for (const n of ALL) ok(seen.has(n), `${n} is checked`);
// seeds: a bookcase's books and a desk's things change with the seed and repeat with it
const sig = (fn, o) => { const b = batch(); K[fn](b, M, I, o); return b.parts.length + ':' + Math.round(b.tris()) + ':' + b.bounds().max.y.toFixed(4); };
ok(sig('bookshelf', { seed: 3 }) === sig('bookshelf', { seed: 3 }) && sig('bookshelf', { seed: 3 }) !== sig('bookshelf', { seed: 4 }), 'bookshelf: the same seed, the same books; another, other books');
// rooms
for (const kind of K.ROOM_KINDS) {
  const b = batch(), b2 = batch(), info = K.room(b, M, MB, I, { kind, size: [5, 4], seed: 2 }); K.room(b2, M, MB, I, { kind, size: [5, 4], seed: 2 });
  const bb = b.bounds();
  ok(b.parts.length === b2.parts.length && b.tris() === b2.tris(), `room ${kind}: deterministic`);
  ok(info.width === 5 && bb.max.x < 2.66 && bb.min.x > -2.66 && bb.max.z < 2.2 && bb.min.z > -2.2 && bb.max.y < 2.81, `room ${kind}: everything inside its walls (${bb.min.x.toFixed(2)}..${bb.max.x.toFixed(2)}, z ${bb.min.z.toFixed(2)}..${bb.max.z.toFixed(2)}, top ${bb.max.y.toFixed(2)})`);
  ok(b.tris() > 3000, `room ${kind}: furnished (${Math.round(b.tris())} triangles)`);
}
let threw = 0; try { K.room(batch(), M, MB, I, { kind: 'garage' }); } catch { threw++; }
ok(threw === 1, 'room: an unknown kind throws');
console.log(fails ? `props-home check: ${fails} failed` : `props-home check: ok (${ALL.length} props in ${SIZE.length} cases, ${K.ROOM_KINDS.length} rooms)`);
process.exit(fails ? 1 : 0);
