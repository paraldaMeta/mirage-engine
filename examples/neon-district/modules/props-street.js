// props-street: street furniture for a close look (not a module). Each adds to a MeshBatch through the props kit,
// at matrix `m` (its foot at y 0, its front toward +z): a bin (tapered body, a liner folded over the rim, a hinged
// lid), a slatted crate with a stencil, a rubbish bag (a lumpy sack with a knotted top), a cardboard box with flaps
// and tape, an AC unit (casing, a fan behind a round grille, brackets, its pipes), a junction box (door, hinges,
// a warning label, conduits, a padlock), a bollard (domed, reflective bands, a bolted base), a jersey barrier
// (its real profile, foot slots, lifting eyes, a yellow cap), a newspaper box, a bench (slats on steel legs).
// The colliding volumes stay where their modules put them; these are drawn as decor.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hex } from './props-kit.js';

const lathe = (pts, seg) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg); g.computeVertexNormals(); return g; };
const cache = new Map(), once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const C = (m, geom, p, r = [0, 0, 0], s = 1) => m.clone().multiply(geom.compose(p, r, s));
const DARK = [0.03, 0.03, 0.033];

/** a street bin, r 0.26, h 0.85: a body colour, an open or shut lid */
export function bin(P, bt, geom, m, color = [0.04, 0.12, 0.08], open = false) {
  const { mats, put } = P;
  put(bt, lathe([[0.2, 0], [0.21, 0.02], [0.25, 0.78], [0.265, 0.8], [0.265, 0.83], [0.25, 0.83], [0.235, 0.79], [0.19, 0.03], [0, 0.03]], 14), mats.plastic, m, color.map((c) => c * 2.2));
  for (const y of [0.25, 0.55]) put(bt, new THREE.TorusGeometry(0.22 + y * 0.045, 0.008, 3, 16).rotateX(Math.PI / 2), mats.metal, C(m, geom, [0, y, 0]), color.map((c) => c * 0.7));
  // the liner, folded over the rim, a few creases
  put(bt, once('liner', () => { const g = new THREE.TorusGeometry(0.262, 0.018, 4, 18).rotateX(Math.PI / 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, p.getY(i) * (1 + 0.6 * Math.abs(Math.sin(a * 5))) - 0.025 * Math.abs(Math.sin(a * 3))); } g.computeVertexNormals(); return g; }), mats.paint, C(m, geom, [0, 0.82, 0]), [0.01, 0.01, 0.012]);
  // the lid: a shallow dome on a hinge at the back
  const lid = C(m, geom, [0, 0.835, -0.25], [open ? -1.1 : -0.02, 0, 0]);
  put(bt, lathe([[0.275, 0], [0.27, 0.025], [0.18, 0.06], [0, 0.07]], 14), mats.plastic, lid.clone().multiply(geom.compose([0, 0, 0.25])), color.map((c) => c * 2.2));
  put(bt, new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8).rotateZ(Math.PI / 2), mats.metal, C(m, geom, [0, 0.835, -0.26]), [0.3, 0.3, 0.3]);
  put(bt, new geom.RoundedBoxGeometry(0.1, 0.02, 0.03, 1, 0.008), mats.metal, lid.clone().multiply(geom.compose([0, 0.03, 0.52])), [0.4, 0.4, 0.42]);   // the handle
  put(bt, new THREE.PlaneGeometry(0.16, 0.12), mats.paint, C(m, geom, [0, 0.55, 0.245], [-0.05, 0, 0]), [1, 1, 1], P.R.sticker3);
}

/** a slatted crate s (height), 1.2 s wide; the stencil on its front */
export function crate(P, bt, geom, m, s = 0.7, color = [0.32, 0.22, 0.12], stencil = 0) {
  const { mats, put, R } = P, w = s * 1.2, d = s, sl = s / 4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(bt, new THREE.BoxGeometry(0.06, s, 0.06), mats.wood, C(m, geom, [sx * (w / 2 - 0.03), s / 2, sz * (d / 2 - 0.03)]), color.map((c) => c * 0.8));
  for (let i = 0; i < 3; i++) {
    const y = sl * 0.7 + i * sl * 1.25;
    for (const sz of [-1, 1]) put(bt, new THREE.BoxGeometry(w - 0.02, sl * 0.9, 0.02), mats.wood, C(m, geom, [0, y, sz * (d / 2 - 0.005)]), color.map((c, k) => c * (0.9 + 0.12 * Math.sin(i * 3 + k))));
    for (const sx of [-1, 1]) put(bt, new THREE.BoxGeometry(0.02, sl * 0.9, d - 0.02), mats.wood, C(m, geom, [sx * (w / 2 - 0.005), y, 0]), color);
  }
  for (let i = 0; i < 4; i++) put(bt, new THREE.BoxGeometry(w - 0.02, 0.02, d / 4 - 0.02), mats.wood, C(m, geom, [0, s - 0.01, -d / 2 + d / 8 + i * d / 4]), color.map((c) => c * 1.05));
  put(bt, new THREE.PlaneGeometry(w * 0.7, s * 0.4), mats.paint, C(m, geom, [0, s * 0.5, d / 2 + 0.012]), [0.9, 0.9, 0.85], R['stencil' + (stencil % 2)]);
}

/** a rubbish bag: a lumpy sack (seeded) with a knotted top */
export function bag(P, bt, geom, m, seed = 0, color = [0.012, 0.012, 0.014]) {
  const { mats, put } = P;
  const g = once('bag' + (seed % 4), () => {
    const b = new THREE.SphereGeometry(0.3, 11, 8), p = b.attributes.position, k = seed % 4;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.08 * Math.sin(x * 17 + k) * Math.sin(z * 13 - k) + 0.05 * Math.sin(y * 23 + x * 9);
      const sag = y < 0 ? 0.62 : 1 - 0.35 * Math.max(0, y / 0.3 - 0.4);   // flat underneath, gathered toward the neck
      p.setXYZ(i, x * n * (y > 0.15 ? 1 - (y - 0.15) * 2.2 : 1) * (1.08 + 0.06 * k), y * sag * n, z * n * (y > 0.15 ? 1 - (y - 0.15) * 2.2 : 1));
    }
    const sm = mergeVertices(b.deleteAttribute('normal').deleteAttribute('uv')); sm.computeVertexNormals(); return sm;
  });
  put(bt, g, mats.paint, C(m, geom, [0, 0.18, 0]), color);
  const top = C(m, geom, [0, 0.36, 0], [0.2, seed, 0]);
  put(bt, lathe([[0.05, 0], [0.025, 0.04], [0.03, 0.06], [0.0, 0.07]], 7), mats.paint, top, color);
  for (const s of [-1, 1]) put(bt, new THREE.SphereGeometry(0.03, 6, 4).scale(1.6, 0.6, 0.9), mats.paint, top.clone().multiply(geom.compose([s * 0.04, 0.065, 0], [0, 0, s * 0.6])), color);
}

/** a cardboard box with flaps open, a tape strip, printed goods faces */
export function cardboard(P, bt, geom, m, s = 0.45, print = 0) {
  const { mats, put, R } = P, h = s * 0.8, d = s * 0.85, card = [0.55, 0.4, 0.25];
  put(bt, new THREE.BoxGeometry(s, h, d).translate(0, h / 2, 0), mats.cardboard, m, [1, 0.95, 0.9], R['goods' + (print % 6)]);
  for (const sz of [-1, 1]) put(bt, new THREE.BoxGeometry(s, 0.006, d / 2).translate(0, 0, sz * d / 4), mats.cardboard, C(m, geom, [0, h, sz * d / 2], [sz * -0.8, 0, 0]), card);    // flaps folded out
  for (const sx of [-1, 1]) put(bt, new THREE.BoxGeometry(s / 2, 0.006, d).translate(sx * s / 4, 0, 0), mats.cardboard, C(m, geom, [sx * s / 2, h, 0], [0, 0, sx * (1.0 + 0.3 * sx)]), card);
  put(bt, new THREE.BoxGeometry(0.05, h * 0.5, 0.004), mats.paint, C(m, geom, [0, h * 0.75, d / 2 + 0.002]), [0.6, 0.55, 0.4]);
}

/** an AC unit on a wall (its back at z 0): casing, a fan behind a round grille, two brackets, pipes into the wall */
export function acUnit(P, bt, geom, m, color = [0.55, 0.56, 0.54]) {
  const { mats, put, R } = P, w = 0.9, h = 0.6, d = 0.4, z = d / 2 + 0.04;
  put(bt, new geom.RoundedBoxGeometry(w, h, d, 1, 0.03), mats.metal, C(m, geom, [0, 0, z]), color);
  put(bt, new THREE.PlaneGeometry(d * 0.8, h * 0.8).rotateY(Math.PI / 2), mats.paint, C(m, geom, [w / 2 + 0.002, 0, z]), [1, 1, 1], R.vent);
  put(bt, new THREE.CircleGeometry(0.22, 20), mats.paint, C(m, geom, [-0.12, 0, z + d / 2 - 0.03]), [0.01, 0.01, 0.01]);
  for (let i = 0; i < 4; i++) put(bt, new THREE.BoxGeometry(0.19, 0.06, 0.008), mats.metal, C(m, geom, [-0.12, 0, z + d / 2 - 0.05], [0.3, 0, i * Math.PI / 2 + 0.3]).multiply(geom.compose([0.09, 0, 0])), [0.3, 0.3, 0.3]);   // fan blades
  for (const r of [0.07, 0.15, 0.225]) put(bt, new THREE.TorusGeometry(r, 0.005, 3, 16), mats.metal, C(m, geom, [-0.12, 0, z + d / 2 + 0.004]), [0.45, 0.45, 0.45]);
  for (const a of [0, Math.PI / 2]) put(bt, new THREE.BoxGeometry(0.45, 0.008, 0.008), mats.metal, C(m, geom, [-0.12, 0, z + d / 2 + 0.006], [0, 0, a]), [0.45, 0.45, 0.45]);
  put(bt, new THREE.PlaneGeometry(0.14, 0.1), mats.paint, C(m, geom, [0.3, -0.18, z + d / 2 + 0.002]), [1, 1, 1], R.sticker2);
  for (const sx of [-0.32, 0.32]) {   // L brackets
    put(bt, new THREE.BoxGeometry(0.04, 0.008, d + 0.08), mats.metal, C(m, geom, [sx, -h / 2 - 0.004, d / 2 + 0.04]), DARK);
    put(bt, new THREE.BoxGeometry(0.04, 0.2, 0.008), mats.metal, C(m, geom, [sx, -h / 2 - 0.1, 0.004]), DARK);
    put(bt, new THREE.BoxGeometry(0.008, 0.18, 0.008), mats.metal, C(m, geom, [sx, -h / 2 - 0.09, 0.2], [Math.PI / 4.4, 0, 0]), DARK);
  }
  for (const [y, r] of [[-0.16, 0.012], [-0.2, 0.008]]) put(bt, geom.taperedTube([[w / 2 - 0.05, y, 0.12], [w / 2 + 0.06, y, 0.1], [w / 2 + 0.1, y - 0.1, 0.02], [w / 2 + 0.1, y - 0.6, 0.02]], [r, r, r, r], { radial: 4, segments: 8 }), mats.paint, m, r > 0.01 ? [0.6, 0.6, 0.55] : DARK);
}

/** a junction box on a wall (back at z 0): door, hinges, a warning label, a padlock, conduits down */
export function junctionBox(P, bt, geom, m, h = 0.5, color = [0.3, 0.32, 0.3], conduit = 2) {
  const { mats, put, R } = P, w = 0.38, d = 0.22;
  put(bt, new geom.RoundedBoxGeometry(w, h, d, 1, 0.02), mats.metal, C(m, geom, [0, 0, d / 2]), color);
  put(bt, new THREE.BoxGeometry(w - 0.04, h - 0.04, 0.01), mats.metal, C(m, geom, [0, 0, d + 0.004]), color.map((c) => c * 1.08));
  put(bt, new THREE.PlaneGeometry(w * 0.82, w * 0.31), mats.paint, C(m, geom, [0, h * 0.22, d + 0.011]), [1, 1, 1], R.warn0);
  for (const y of [-h * 0.3, h * 0.3]) put(bt, new THREE.CylinderGeometry(0.01, 0.01, 0.05, 6), mats.metal, C(m, geom, [-w / 2 + 0.005, y, d + 0.005]), [0.2, 0.2, 0.2]);
  put(bt, new geom.RoundedBoxGeometry(0.04, 0.05, 0.02, 1, 0.008), mats.metal, C(m, geom, [w / 2 - 0.05, -h * 0.1, d + 0.03]), [0.7, 0.6, 0.3]);
  put(bt, new THREE.TorusGeometry(0.014, 0.004, 4, 8, Math.PI), mats.metal, C(m, geom, [w / 2 - 0.05, -h * 0.1 + 0.025, d + 0.03]), [0.6, 0.6, 0.62]);
  for (let i = 0; i < conduit; i++) put(bt, new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), mats.metal, C(m, geom, [-0.1 + i * 0.12, -h / 2 - 0.05, d / 2]), [0.25, 0.25, 0.27]);
}

/** a bollard r 0.12, 0.9 high: a domed steel post, two reflective bands, a bolted base plate */
export function bollard(P, bt, geom, m, band = [1.0, 0.55, 0.12]) {
  const { mats, put } = P;
  put(bt, lathe([[0.13, 0], [0.125, 0.8], [0.11, 0.86], [0.07, 0.895], [0, 0.9]], 16), mats.metal, m, [0.06, 0.065, 0.07]);
  for (const y of [0.68, 0.76]) put(bt, new THREE.CylinderGeometry(0.128, 0.128, 0.035, 16, 1, true), mats.glow, C(m, geom, [0, y, 0]), band.map((c) => c * 0.9));
  put(bt, new THREE.CylinderGeometry(0.19, 0.2, 0.02, 16), mats.metal, C(m, geom, [0, 0.01, 0]), [0.08, 0.08, 0.085]);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; put(bt, new THREE.CylinderGeometry(0.014, 0.014, 0.02, 6), mats.metal, C(m, geom, [Math.cos(a) * 0.16, 0.025, Math.sin(a) * 0.16]), [0.35, 0.33, 0.3]); }
}

/** a jersey barrier `len` long along x: the real profile, slots in its foot, two lifting eyes, a hazard cap */
export function jersey(P, bt, geom, m, len = 2.4) {
  const { mats, put } = P;
  const sh = once('jersey', () => { const s = new THREE.Shape(); [[-0.31, 0], [0.31, 0], [0.31, 0.08], [0.2, 0.33], [0.1, 0.94], [-0.1, 0.94], [-0.2, 0.33], [-0.31, 0.08]].forEach(([a, b], i) => (i ? s.lineTo(a, b) : s.moveTo(a, b))); return s; });
  const g = new THREE.ExtrudeGeometry(sh, { depth: len - 0.04, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 }).translate(0, 0, -(len - 0.04) / 2).rotateY(Math.PI / 2);
  put(bt, g, mats.concrete, m, [0.42, 0.41, 0.39]);
  for (const sx of [-0.6, 0.6]) put(bt, new THREE.BoxGeometry(0.4, 0.09, 0.66), mats.concrete, C(m, geom, [sx * len / 2.4, 0.04, 0]), [0.01, 0.01, 0.01]);   // the slots under it
  for (const sx of [-0.35, 0.35]) put(bt, new THREE.TorusGeometry(0.05, 0.012, 5, 10, Math.PI), mats.metal, C(m, geom, [sx * len / 2.4, 0.94, 0]), [0.3, 0.2, 0.12]);
  put(bt, new THREE.BoxGeometry(len * 0.5, 0.012, 0.21), mats.paint, C(m, geom, [0, 0.946, 0]), hex('#d8a810'));
  for (let i = 0; i < 6; i++) put(bt, new THREE.BoxGeometry(0.06, 0.013, 0.215), mats.paint, C(m, geom, [-len * 0.25 + 0.05 + i * len * 0.5 / 6, 0.947, 0], [0, 0.6, 0]), [0.02, 0.02, 0.02]);
}

/** a newspaper / flyer box: a body on legs, a window, a coin slot, a lit name strip */
export function newsBox(P, bt, geom, m, color = [0.4, 0.05, 0.04], lit = [1, 0.2, 0.3]) {
  const { mats, put, R } = P;
  put(bt, new geom.RoundedBoxGeometry(0.5, 0.62, 0.42, 1, 0.03), mats.metal, C(m, geom, [0, 0.63, 0]), color);
  for (const sx of [-0.2, 0.2]) for (const sz of [-0.16, 0.16]) put(bt, new THREE.CylinderGeometry(0.018, 0.018, 0.32, 6), mats.metal, C(m, geom, [sx, 0.16, sz]), [0.1, 0.1, 0.1]);
  put(bt, new THREE.PlaneGeometry(0.36, 0.26), mats.paint, C(m, geom, [0, 0.64, 0.212]), [0.9, 0.9, 0.9], R['goods' + 5]);
  put(bt, new THREE.BoxGeometry(0.4, 0.28, 0.01), mats.paint, C(m, geom, [0, 0.64, 0.22]), [0.02, 0.025, 0.03]);
  put(bt, new THREE.BoxGeometry(0.36, 0.06, 0.012), mats.glow, C(m, geom, [0, 0.86, 0.215]), lit.map((c) => c * 2));
  put(bt, new geom.RoundedBoxGeometry(0.08, 0.1, 0.03, 1, 0.01), mats.metal, C(m, geom, [0.15, 0.42, 0.22]), [0.5, 0.5, 0.52]);
}

/** a bench: slats on two steel frames, 2 m */
export function bench(P, bt, geom, m, len = 2.0) {
  const { mats, put } = P;
  for (let i = 0; i < 4; i++) put(bt, new geom.RoundedBoxGeometry(len, 0.035, 0.11, 1, 0.012), mats.wood, C(m, geom, [0, 0.44, -0.18 + i * 0.12]), [0.28, 0.16, 0.08]);
  for (const sx of [-0.8, 0.8]) {
    put(bt, new geom.RoundedBoxGeometry(0.06, 0.42, 0.5, 1, 0.02), mats.metal, C(m, geom, [sx * len / 2, 0.21, 0]), [0.06, 0.06, 0.065]);
    put(bt, new THREE.BoxGeometry(0.2, 0.012, 0.56), mats.metal, C(m, geom, [sx * len / 2, 0.006, 0]), [0.06, 0.06, 0.065]);
  }
}
