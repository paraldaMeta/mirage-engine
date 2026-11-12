// props-goods: the things on counters and shelves (not a module): bottles with glass, liquid at a level, a label and a
// cap; tumblers; bowls in stacks; pots with lids and handles; noodle baskets on long handles; a rice cooker; a
// chopstick holder; skewers on a grill; a bar stool with a footrest; jars; boxes with printed faces; a goods rack
// for a shop's pavement display. Each adds to a MeshBatch through the props kit, at a matrix `m` (its foot at y 0).
import * as THREE from 'three';
import { bowlGeo, glassGeo, jarGeo, boxGeo } from './props-shapes.js';
import { uvByHeight } from './props-kit.js';

const lathe = (pts, seg) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg); g.computeVertexNormals(); return g; };
const cache = new Map(), once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const C = (m, geom, p, r = [0, 0, 0], s = 1) => m.clone().multiply(geom.compose(p, r, s));

/** a spirits bottle: glass (tinted), the liquid to `fill` (0..1), a label band printed from the bar family, a cap */
export function spiritBottle(P, bt, geom, m, { r = 0.04, h = 0.3, glass = [0.5, 0.6, 0.45], liquid = [0.5, 0.25, 0.05], fill = 0.6, label = 0, cap = [0.1, 0.05, 0.02], square = false } = {}) {
  const { mats, put, R } = P, seg = square ? 4 : 8;
  const prof = (k) => [[0, 0.004], [r * k * 0.85, 0.002], [r * k, 0.012], [r * k, h * 0.6], [r * k * 0.9, h * 0.67], [r * k * 0.42, h * 0.75], [r * k * 0.33, h * 0.8], [r * k * 0.33, h * 0.93]];
  put(bt, lathe([...prof(1), [r * 0.38, h * 0.94], [r * 0.36, h * 0.95], [0, h * 0.95]], seg), mats.clear, C(m, geom, [0, 0, 0], [0, square ? Math.PI / 4 : 0, 0]), glass);
  const lv = Math.max(0.03, fill * h * 0.62);
  put(bt, lathe([[0, 0.006], [r * 0.9, 0.006], [r * 0.92, 0.014], [r * 0.92, lv], [0, lv]], seg), mats.paint, C(m, geom, [0, 0, 0], [0, square ? Math.PI / 4 : 0, 0]), liquid);
  const band = once(`band${r}${h}${seg}`, () => uvByHeight(new THREE.CylinderGeometry(r * 1.015, r * 1.015, h * 0.26, seg, 1, true, -Math.PI * 0.45, Math.PI * 0.9), -h * 0.13, h * 0.13));
  put(bt, band, mats.paint, C(m, geom, [0, h * 0.3, 0], [0, square ? Math.PI / 4 : 0, 0]), [1, 1, 1], R['bar' + (label % 6)]);
  put(bt, new THREE.CylinderGeometry(r * 0.4, r * 0.4, h * 0.08, 10), mats.metal, C(m, geom, [0, h * 0.97, 0]), cap);
}
/** a tumbler / sake cup in clear glass */
export const tumbler = (P, bt, geom, m, s = 1) => P.put(bt, once('tum', () => glassGeo(0.034, 0.09)), P.mats.clear, C(m, geom, [0, 0, 0], [0, 0, 0], s), [0.8, 0.85, 0.85]);
/** a stack of n bowls (glazed ceramic) */
export function bowls(P, bt, geom, m, n = 4, color = [0.85, 0.82, 0.75], r = 0.085) {
  for (let i = 0; i < n; i++) P.put(bt, once('bowl' + r, () => bowlGeo(r, r * 0.8, 12)), P.mats.ceramic, C(m, geom, [0, i * r * 0.28, 0]), color);
  P.put(bt, once('bowlrim' + r, () => new THREE.TorusGeometry(r * 0.97, 0.004, 4, 20).rotateX(Math.PI / 2)), P.mats.ceramic, C(m, geom, [0, (n - 1) * r * 0.28 + r * 0.8, 0]), [0.5, 0.06, 0.04]);
}
/** a stock pot with a lid, two handles; r, h */
export function pot(P, bt, geom, m, r = 0.2, h = 0.26, lid = true) {
  const { mats, put } = P;
  put(bt, lathe([[0, 0], [r * 0.96, 0], [r, 0.01], [r, h], [r * 1.03, h + 0.005], [r * 0.97, h], [r * 0.95, 0.02], [0, 0.02]], 20), mats.metal, m, [0.62, 0.62, 0.64]);
  for (const s of [-1, 1]) put(bt, new THREE.TorusGeometry(0.035, 0.008, 4, 10, Math.PI).rotateY(s * Math.PI / 2), mats.metal, C(m, geom, [s * r, h * 0.8, 0]), [0.5, 0.5, 0.52]);
  if (lid) { put(bt, lathe([[r * 1.01, 0], [r * 0.8, 0.03], [0.02, 0.045], [0, 0.045]], 20), mats.metal, C(m, geom, [0, h, 0]), [0.66, 0.66, 0.68]); put(bt, new THREE.SphereGeometry(0.02, 8, 6), mats.paint, C(m, geom, [0, h + 0.055, 0]), [0.03, 0.03, 0.03]); }
  else put(bt, new THREE.CircleGeometry(r * 0.95, 20).rotateX(-Math.PI / 2), mats.paint, C(m, geom, [0, h * 0.8, 0]), [0.42, 0.28, 0.12]);   // broth
}
/** a noodle basket (tebo): a mesh cup on a long handle, hanging into a pot or on a rail */
export function noodleBasket(P, bt, geom, m) {
  const { mats, put } = P;
  put(bt, once('tebo', () => lathe([[0, 0], [0.04, 0.004], [0.06, 0.06], [0.062, 0.18], [0.058, 0.18], [0.056, 0.064], [0.036, 0.01], [0, 0.008]], 12)), mats.metal, m, [0.55, 0.55, 0.5]);
  put(bt, new THREE.CylinderGeometry(0.008, 0.008, 0.42, 6).rotateZ(0.9), mats.metal, C(m, geom, [0.22, 0.28, 0]), [0.5, 0.5, 0.52]);
  put(bt, new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8).rotateZ(0.9), mats.paint, C(m, geom, [0.36, 0.38, 0]), [0.25, 0.12, 0.05]);
}
/** a rice cooker: a body with a domed lid, a hinge, a lit panel */
export function riceCooker(P, bt, geom, m) {
  const { mats, put } = P;
  put(bt, lathe([[0, 0], [0.15, 0], [0.16, 0.02], [0.16, 0.2], [0.15, 0.22], [0, 0.22]], 18), mats.paint, m, [0.85, 0.84, 0.8]);
  put(bt, lathe([[0.155, 0], [0.14, 0.05], [0.08, 0.075], [0, 0.08]], 18), mats.metal, C(m, geom, [0, 0.22, 0]), [0.7, 0.7, 0.72]);
  put(bt, new THREE.BoxGeometry(0.07, 0.04, 0.02), mats.glow, C(m, geom, [0, 0.12, 0.158]), [0.4, 2.2, 0.6]);
  put(bt, new geom.RoundedBoxGeometry(0.09, 0.03, 0.05, 1, 0.01), mats.paint, C(m, geom, [0, 0.27, -0.14]), [0.2, 0.2, 0.2]);
}
/** a chopstick holder: a lacquered cup and a fan of sticks */
export function chopsticks(P, bt, geom, m) {
  const { mats, put } = P;
  put(bt, lathe([[0, 0], [0.035, 0], [0.038, 0.1], [0.034, 0.1], [0.032, 0.01], [0, 0.01]], 12), mats.paint, m, [0.25, 0.02, 0.02]);
  for (let i = 0; i < 9; i++) { const a = i * 0.7; put(bt, new THREE.CylinderGeometry(0.003, 0.004, 0.22, 4), mats.paint, C(m, geom, [Math.cos(a) * 0.015, 0.12, Math.sin(a) * 0.015], [Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12]), [0.6, 0.45, 0.25]); }
}
/** skewers of yakitori over a grill: n along x */
export function skewers(P, bt, geom, m, n = 8, span = 0.9) {
  const { mats, put } = P, meat = once('meat', () => new THREE.SphereGeometry(0.022, 6, 4).scale(1.3, 0.9, 1));
  for (let i = 0; i < n; i++) {
    const x = -span / 2 + (i + 0.5) * span / n, c = i % 3 === 0 ? [0.25, 0.32, 0.08] : [0.32, 0.13, 0.05];
    put(bt, new THREE.CylinderGeometry(0.0025, 0.0025, 0.3, 4).rotateX(Math.PI / 2), mats.paint, C(m, geom, [x, 0, 0]), [0.6, 0.5, 0.35]);
    for (let k = 0; k < 4; k++) put(bt, meat, mats.paint, C(m, geom, [x, 0.004, -0.06 + k * 0.034], [0, k, 0]), c);
  }
}
/** a bar stool: a padded seat, a steel column, a footrest ring, a domed base */
export function stool(P, bt, geom, m, seatY = 0.66) {
  const { mats, put } = P;
  put(bt, lathe([[0, 0], [0.17, 0], [0.19, 0.02], [0.19, 0.05], [0.17, 0.07], [0, 0.075]], 18), mats.paint, C(m, geom, [0, seatY - 0.035, 0]), [0.32, 0.03, 0.03]);
  put(bt, lathe([[0, 0], [0.19, 0], [0.18, 0.02], [0.06, 0.04], [0.04, 0.05], [0, 0.05]], 18), mats.metal, m, [0.6, 0.6, 0.62]);
  put(bt, new THREE.CylinderGeometry(0.03, 0.035, seatY - 0.08, 10), mats.metal, C(m, geom, [0, (seatY - 0.08) / 2 + 0.04, 0]), [0.62, 0.62, 0.64]);
  put(bt, new THREE.TorusGeometry(0.15, 0.011, 4, 16).rotateX(Math.PI / 2), mats.metal, C(m, geom, [0, 0.26, 0]), [0.65, 0.65, 0.67]);
  for (let i = 0; i < 3; i++) { const a = i * 2.094; put(bt, new THREE.CylinderGeometry(0.007, 0.007, 0.13, 5).rotateZ(Math.PI / 2), mats.metal, C(m, geom, [Math.cos(a) * 0.08, 0.26, Math.sin(a) * 0.08], [0, -a, 0]), [0.6, 0.6, 0.62]); }
}
/** a printed box (goods family i) w x h x d */
export const goodsBox = (P, bt, geom, m, i, w = 0.12, h = 0.16, d = 0.09) => P.put(bt, boxGeo([0, 0, 1, 1], w, h, d), P.mats.paint, m, [1, 1, 1], P.R['goods' + (i % 6)]);
/** a jar with a printed band (box family i for the band) */
export const jar = (P, bt, geom, m, i, r = 0.04, h = 0.11) => P.put(bt, jarGeo([0, 0, 1, 1], r, h), P.mats.paint, m, [1, 1, 1], P.R['box' + (6 + (i % 2))]);

/** A shop's pavement display: a two-tier slatted rack of goods (boxes, jars, bottles, bowls), w wide, at m */
export function goodsRack(P, bt, geom, m, seed = 0, w = 1.2) {
  const { mats, put } = P, rnd = (k) => { const x = Math.sin(seed * 77.1 + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  for (const [y, z] of [[0.55, 0.12], [0.85, -0.08]]) {
    for (let i = 0; i < 4; i++) put(bt, new geom.RoundedBoxGeometry(w, 0.02, 0.07, 1, 0.006), mats.paint, C(m, geom, [0, y, z - 0.12 + i * 0.08]), [0.35, 0.22, 0.12]);
    for (let i = 0, x = -w / 2 + 0.08; x < w / 2 - 0.08; i++) {
      const k = Math.floor(rnd(i + y * 10) * 6), mm = C(m, geom, [x, y + 0.01, z], [0, (rnd(i + 3) - 0.5) * 0.4, 0]);
      if (k < 2) { goodsBox(P, bt, geom, mm, Math.floor(rnd(i + 7) * 6), 0.12, 0.14, 0.09); x += 0.15; }
      else if (k < 4) { jar(P, bt, geom, mm, i); jar(P, bt, geom, C(m, geom, [x + 0.09, y + 0.01, z]), i + 1); x += 0.19; }
      else if (k < 5) { bowls(P, bt, geom, mm, 3, [0.9, 0.88, 0.82], 0.07); x += 0.17; }
      else { spiritBottle(P, bt, geom, mm, { r: 0.03, h: 0.22, label: i, liquid: [0.6, 0.3, 0.05], glass: [0.4, 0.5, 0.35] }); x += 0.09; }
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(bt, new THREE.BoxGeometry(0.03, 0.9, 0.03), mats.metal, C(m, geom, [sx * (w / 2 - 0.02), 0.45, sz * 0.18 - 0.02]), [0.08, 0.08, 0.09]);
}

/** a stall's gas bottle (LPG, about 0.62 m): a welded steel body in worn blue-grey paint with a collar round the valve,
 *  a foot ring, a printed danger band, a regulator and a hose to the grill */
export function gasBottle(P, bt, geom, m) {
  const { mats, put, R } = P;
  put(bt, lathe([[0.12, 0], [0.145, 0.03], [0.15, 0.1], [0.15, 0.44], [0.13, 0.52], [0.07, 0.56], [0.03, 0.57]], 18), mats.paint, C(m, geom, [0, 0.03, 0]), [0.16, 0.24, 0.3]);
  put(bt, new THREE.CylinderGeometry(0.13, 0.13, 0.035, 18, 1, true), mats.metal, C(m, geom, [0, 0.017, 0]), [0.2, 0.2, 0.21]);                     // the foot ring
  put(bt, lathe([[0.075, 0], [0.08, 0.01], [0.08, 0.09], [0.075, 0.1]], 14), mats.metal, C(m, geom, [0, 0.55, 0]), [0.25, 0.27, 0.3]);             // the collar
  put(bt, new THREE.CylinderGeometry(0.152, 0.152, 0.07, 18, 1, true, -1.2, 2.4), mats.paint, C(m, geom, [0, 0.33, 0]), [1, 1, 1], R.warn0);      // the band
  put(bt, new THREE.CylinderGeometry(0.018, 0.022, 0.05, 8), mats.metal, C(m, geom, [0, 0.61, 0]), [0.7, 0.55, 0.2]);                              // the valve (brass)
  put(bt, new geom.RoundedBoxGeometry(0.06, 0.04, 0.05, 1, 0.01), mats.metal, C(m, geom, [0.03, 0.64, 0]), [0.55, 0.56, 0.58]);                       // the regulator
  put(bt, geom.taperedTube([[0.06, 0.64, 0], [0.16, 0.66, 0], [0.22, 0.5, -0.05], [0.24, 0.3, -0.1], [0.2, 0.75, -0.2]], [0.008, 0.008, 0.008, 0.008, 0.008], { radial: 5, segments: 16 }), mats.paint, m, [0.6, 0.1, 0.05]);
}

/** a fire extinguisher hanging on a wall bracket (back at z 0): a red cylinder, a black head and lever, a hose, a
 *  printed label, the bracket */
export function extinguisher(P, bt, geom, m) {
  const { mats, put, R } = P, z = 0.085;
  put(bt, lathe([[0.07, 0], [0.078, 0.015], [0.078, 0.42], [0.06, 0.47], [0.025, 0.49]], 16), mats.paint, C(m, geom, [0, 0, z]), [0.62, 0.04, 0.03]);
  put(bt, new THREE.CylinderGeometry(0.0795, 0.0795, 0.14, 16, 1, true, -1.0, 2.0), mats.paint, C(m, geom, [0, 0.22, z]), [1, 1, 1], R.warn1);
  put(bt, new geom.RoundedBoxGeometry(0.05, 0.06, 0.05, 1, 0.01), mats.paint, C(m, geom, [0, 0.52, z]), [0.03, 0.03, 0.03]);                        // the head
  put(bt, new THREE.BoxGeometry(0.11, 0.012, 0.025), mats.metal, C(m, geom, [0.03, 0.56, z], [0, 0, -0.2]), [0.12, 0.12, 0.13]);                     // the lever
  put(bt, geom.taperedTube([[0.02, 0.52, z + 0.02], [0.08, 0.5, z + 0.05], [0.1, 0.32, z + 0.07], [0.08, 0.16, z + 0.06]], [0.008, 0.008, 0.008, 0.01], { radial: 5, segments: 10 }), mats.paint, m, [0.03, 0.03, 0.03]);
  put(bt, new THREE.BoxGeometry(0.1, 0.03, 0.09), mats.metal, C(m, geom, [0, 0.3, 0.045]), [0.2, 0.2, 0.22]);                                         // the bracket
}
