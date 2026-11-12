// Mirage original code. Home and office props (@miragekit/assets, props-home), made in code to real sizes: living
// room, kitchen and dining, bedroom, bathroom and office. A prop adds to a MeshBatch (core's geom) at a matrix with
// the materials of homeMaterials(ctx) (or any object with its slots), tinted per part with a linear-RGB colour:
//   prop(b, M, matrix, options)        // its foot on y = 0 at the matrix, its front toward +z, centred on x
//   const b = new geom.MeshBatch(), M = homeMaterials(ctx);
//   sofa(b, M, geom.compose([0, 0, -2]), { seats: 3, color: [0.25, 0.32, 0.4] });
//   desk(b, M, geom.compose([3, 0, 0])); officeChair(b, M, geom.compose([3, 0, 0.6], [0, Math.PI, 0]));
// Sizes follow common furniture: seats at 0.42-0.46 m, tables at 0.74 m, counters at 0.9 m, a bed's top at 0.55 m.
// Options name colours as [r, g, b] (linear); `seed` varies what a prop has on it (books, plates, papers).
import * as THREE from 'three';
import { rng } from '@miragekit/core/rng';
import { at as T } from '../building/parts.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------------------------------------------
/** a vertex colour over the whole geometry */
function tinted(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
const put = (b, g, mat, m, c = WHITE) => b.add(tinted(g.index ? g.toNonIndexed() : g, c), mat, m);
const box = (b, mat, m, size, pos, c, rot = [0, 0, 0], r = 0) => put(b, r ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(r, 0.45 * Math.min(...size))) : new THREE.BoxGeometry(...size), mat, T(m, pos, rot), c);
const cyl = (b, mat, m, r0, r1, h, pos, c, rot = [0, 0, 0], seg = 18) => put(b, new THREE.CylinderGeometry(r0, r1, h, seg), mat, T(m, pos, rot), c);
const lathe = (b, mat, m, pts, pos, c, seg = 24) => put(b, new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat, T(m, pos), c);
const rnd = (seed) => rng(seed).next;
const WHITE = [1, 1, 1], OAK = [0.75, 0.6, 0.45], WALNUT = [0.42, 0.3, 0.22], STEEL = [0.62, 0.63, 0.65], DARK = [0.05, 0.05, 0.055], BLACK = [0.02, 0.02, 0.022];
const legs4 = (b, M, m, w, d, h, r, inset, c, mat = M.wood) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(b, mat, m, r, r * 0.8, h, [sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)], c, [0, 0, 0], 10); };

// ---------------------------------------------------------------------------------------------------------------
// living room
/** A sofa of `seats` 0.7 m seats: a plinth on short legs, seat and back cushions, two arms. */
export function sofa(b, M, m, { seats = 3, color = [0.28, 0.33, 0.38], leather = false, depth = 0.92 } = {}) {
  const W = seats * 0.7 + 0.4, F = leather ? M.leather : M.fabric;
  legs4(b, M, m, W - 0.1, depth - 0.1, 0.1, 0.022, 0.05, WALNUT);
  box(b, F, m, [W, 0.22, depth], [0, 0.21, 0], color, [0, 0, 0], 0.03);
  for (let i = 0; i < seats; i++) {
    const x = -W / 2 + 0.2 + 0.7 * (i + 0.5);
    box(b, F, m, [0.69, 0.14, depth - 0.25], [x, 0.39, 0.06], color, [0, 0, 0], 0.05);                       // the seat cushion
    box(b, F, m, [0.69, 0.48, 0.18], [x, 0.66, -depth / 2 + 0.17], color, [-0.12, 0, 0], 0.06);              // the back cushion, leaning
  }
  box(b, F, m, [W, 0.5, 0.16], [0, 0.55, -depth / 2 + 0.08], color, [0, 0, 0], 0.03);                         // the back frame
  for (const s of [-1, 1]) box(b, F, m, [0.2, 0.42, depth], [s * (W / 2 - 0.1), 0.5, 0], color, [0, 0, 0], 0.06);
  return { width: W, depth };
}
/** An armchair: one seat of the sofa, wider arms. */
export const armchair = (b, M, m, o = {}) => sofa(b, M, m, { seats: 1, ...o });
/** A cushion `size` square, plumped (a rounded box squeezed at the edges). */
export function cushion(b, M, m, { size = 0.45, color = [0.7, 0.42, 0.2] } = {}) {
  const g = new RoundedBoxGeometry(size, 0.14, size, 3, 0.06), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (size / 2), z = p.getZ(i) / (size / 2); p.setY(i, p.getY(i) * (1 - 0.45 * Math.max(x * x, z * z))); }
  g.computeVertexNormals(); put(b, g, M.fabric, T(m, [0, 0.07, 0]), color);
}
/** A coffee table `size` [w, d], 0.42 m high: a top, a shelf, four legs. */
export function coffeeTable(b, M, m, { size = [1.1, 0.6], color = OAK, glass = false } = {}) {
  if (glass) put(b, new THREE.BoxGeometry(size[0], 0.012, size[1]), M.glass, T(m, [0, 0.415, 0]));
  else box(b, M.wood, m, [size[0], 0.035, size[1]], [0, 0.4, 0], color, [0, 0, 0], 0.008);
  box(b, M.wood, m, [size[0] - 0.12, 0.02, size[1] - 0.12], [0, 0.12, 0], color);
  legs4(b, M, m, size[0], size[1], 0.39, 0.018, 0.05, color, glass ? M.chrome : M.wood);
}
/** A side table: a round top on a pedestal, 0.55 m. */
export function sideTable(b, M, m, { radius = 0.25, color = WALNUT } = {}) {
  cyl(b, M.wood, m, radius, radius, 0.03, [0, 0.54, 0], color, [0, 0, 0], 28);
  cyl(b, M.wood, m, 0.025, 0.03, 0.52, [0, 0.27, 0], color, [0, 0, 0], 12);
  cyl(b, M.wood, m, 0.16, 0.18, 0.025, [0, 0.0125, 0], color, [0, 0, 0], 24);
}
/** A low media unit `width` wide with two drawers and an open middle, and a flat TV on it (`tv`: its diagonal, m). */
export function tvStand(b, M, m, { width = 1.6, tv = 1.4, color = [0.2, 0.2, 0.21] } = {}) {
  box(b, M.wood, m, [width, 0.45, 0.42], [0, 0.29, 0], color, [0, 0, 0], 0.01);
  for (const s of [-1, 1]) box(b, M.wood, m, [width * 0.3, 0.32, 0.01], [s * width * 0.33, 0.29, 0.212], color.map((v) => v * 1.4));
  box(b, M.wood, m, [width * 0.32, 0.3, 0.38], [0, 0.29, 0.03], BLACK);   // the open middle
  for (const s of [-1, 1]) box(b, M.metal, m, [0.05, 0.06, 0.05], [s * (width / 2 - 0.08), 0.03, 0], DARK);
  if (tv) television(b, M, T(m, [0, 0.515, -0.05]), { diagonal: tv });
}
/** A flat television `diagonal` m (16:9) on a foot, its screen lit. */
export function television(b, M, m, { diagonal = 1.4 } = {}) {
  const w = diagonal * 0.8716, h = diagonal * 0.4903;
  box(b, M.plastic, m, [w + 0.02, h + 0.02, 0.035], [0, 0.08 + h / 2, 0], BLACK, [0, 0, 0], 0.005);
  put(b, new THREE.PlaneGeometry(w, h), M.screen, T(m, [0, 0.08 + h / 2, 0.0185]));
  box(b, M.metal, m, [0.06, 0.08, 0.04], [0, 0.04, 0], DARK); box(b, M.metal, m, [0.4, 0.012, 0.22], [0, 0.006, 0], DARK);
}
/** A bookcase `width` x `height` with `shelves` shelves and books (sizes, colours and gaps from `seed`). */
export function bookshelf(b, M, m, { width = 0.9, height = 2.0, depth = 0.32, shelves = 5, color = OAK, seed = 1, fill = 0.8 } = {}) {
  const R = rnd(seed), t = 0.022;
  for (const s of [-1, 1]) box(b, M.wood, m, [t, height, depth], [s * (width / 2 - t / 2), height / 2, 0], color);
  box(b, M.wood, m, [width, t, depth], [0, height - t / 2, 0], color); box(b, M.wood, m, [width - t * 2, 0.008, 0.008], [0, height / 2, -depth / 2 + 0.004], color);
  box(b, M.wood, m, [width - t * 2, height, 0.008], [0, height / 2, -depth / 2 + 0.004], color.map((v) => v * 0.8));   // the back
  const COLS = [[0.5, 0.08, 0.06], [0.06, 0.18, 0.35], [0.12, 0.3, 0.14], [0.75, 0.62, 0.35], [0.85, 0.83, 0.78], [0.18, 0.12, 0.08], [0.55, 0.32, 0.08], [0.08, 0.08, 0.1]];
  const gap = (height - t) / shelves;
  for (let k = 0; k < shelves; k++) {
    const y = k * gap; box(b, M.wood, m, [width - t * 2, t, depth - 0.01], [0, y + t / 2 + (k ? 0 : 0.06), 0], color);
    if (!k) box(b, M.wood, m, [width - t * 2, 0.06, 0.015], [0, 0.03, depth / 2 - 0.01], color);   // the kick board
    let x = -width / 2 + t + 0.01; const y0 = y + t + (k ? 0 : 0.06), room = gap - t - 0.03;
    while (x < width / 2 - t - 0.04) {
      if (R() > fill) { x += 0.05 + R() * 0.1; continue; }
      const bw = 0.018 + R() * 0.035, bh = Math.min(room, 0.16 + R() * 0.14), bd = Math.min(depth - 0.04, 0.14 + R() * 0.08), lean = R() < 0.08 ? 0.18 : 0;
      box(b, M.paper, m, [bw, bh, bd], [x + bw / 2 + (lean ? bh * 0.09 : 0), y0 + bh / 2, depth / 2 - bd / 2 - 0.02], COLS[Math.floor(R() * COLS.length)], [0, 0, -lean]);
      x += bw + 0.002 + (lean ? bh * 0.18 : 0);
    }
  }
}
/** A rug `size` [w, d] a few mm thick, a border in `border`. */
export function rug(b, M, m, { size = [2.4, 1.7], color = [0.45, 0.16, 0.12], border = [0.85, 0.75, 0.55] } = {}) {
  box(b, M.fabric, m, [size[0], 0.006, size[1]], [0, 0.003, 0], border);
  box(b, M.fabric, m, [size[0] - 0.16, 0.007, size[1] - 0.16], [0, 0.0035, 0], color);
}
/** A floor lamp 1.6 m: a weighted base, a pole, a drum shade. The light is the host's (its centre: [0, 1.45, 0]). */
export function floorLamp(b, M, m, { color = [0.9, 0.85, 0.75] } = {}) {
  cyl(b, M.metal, m, 0.15, 0.16, 0.025, [0, 0.0125, 0], DARK, [0, 0, 0], 24);
  cyl(b, M.chrome, m, 0.012, 0.012, 1.4, [0, 0.72, 0], STEEL, [0, 0, 0], 10);
  lathe(b, M.fabric, m, [[0.2, 0], [0.21, 0], [0.17, 0.3], [0.16, 0.3]], [0, 1.32, 0], color, 28);
}
/** A table lamp 0.5 m: a ceramic body, a pleated shade. */
export function tableLamp(b, M, m, { color = [0.32, 0.45, 0.4], shade = [0.92, 0.9, 0.84] } = {}) {
  lathe(b, M.ceramic, m, [[0, 0], [0.07, 0], [0.09, 0.08], [0.1, 0.16], [0.07, 0.25], [0.025, 0.28], [0.02, 0.3], [0, 0.3]], [0, 0, 0], color, 24);
  cyl(b, M.chrome, m, 0.006, 0.006, 0.1, [0, 0.35, 0], STEEL, [0, 0, 0], 8);
  const g = new THREE.LatheGeometry([[0.18, 0], [0.11, 0.2]].map(([x, y]) => new THREE.Vector2(x, y)), 32), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + 0.03 * Math.cos(a * 16); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }   // the pleats
  g.computeVertexNormals(); put(b, g, M.fabric, T(m, [0, 0.33, 0]), shade);
}
/** A house plant in a pot: `kind` 'leafy' (broad leaves on stems) | 'tall' (a fiddle-leaf trunk) | 'grass' (blades). */
export function plant(b, M, m, { kind = 'leafy', size = 1, pot = [0.82, 0.78, 0.72], seed = 1 } = {}) {
  const R = rnd(seed), s = size;
  lathe(b, M.ceramic, m, [[0, 0], [0.11 * s, 0], [0.15 * s, 0.24 * s], [0.155 * s, 0.25 * s], [0.14 * s, 0.25 * s], [0, 0.22 * s]], [0, 0, 0], pot, 24);
  cyl(b, M.paper, m, 0.135 * s, 0.135 * s, 0.01, [0, 0.225 * s, 0], [0.12, 0.08, 0.05], [0, 0, 0], 20);   // the soil
  const green = () => [0.06 + R() * 0.05, 0.22 + R() * 0.12, 0.05 + R() * 0.04];
  const leaf = (len, wid) => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(wid, len * 0.4, 0, len); sh.quadraticCurveTo(-wid, len * 0.4, 0, 0); const g = new THREE.ShapeGeometry(sh, 6), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -0.25 * y * y / len + 0.08 * Math.abs(p.getX(i))); } g.computeVertexNormals(); return g; };
  if (kind === 'grass') { for (let i = 0; i < 40; i++) { const a = R() * Math.PI * 2, tilt = 0.15 + R() * 0.5; put(b, leaf(0.4 * s + R() * 0.3 * s, 0.012 * s), M.leaf, T(m, [Math.cos(a) * 0.05 * s, 0.22 * s, Math.sin(a) * 0.05 * s], [tilt, a, 0]), green()); } return; }
  const tall = kind === 'tall', trunk = tall ? 1.1 * s : 0.12 * s;
  if (tall) cyl(b, M.wood, m, 0.012 * s, 0.018 * s, trunk, [0, 0.22 * s + trunk / 2, 0], [0.3, 0.22, 0.14], [0, 0, 0], 8);
  const n = tall ? 22 : 14;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + R() * 0.3, y = tall ? 0.22 * s + trunk * (0.25 + 0.75 * i / n) : 0.24 * s, tilt = tall ? 0.6 + R() * 0.5 : 0.35 + R() * 0.6;
    const L = (tall ? 0.22 : 0.3 + R() * 0.12) * s, Wd = (tall ? 0.11 : 0.09) * s;
    if (!tall) put(b, new THREE.CylinderGeometry(0.004 * s, 0.005 * s, L * 0.6, 4).translate(0, L * 0.3, 0), M.leaf, T(m, [0, y, 0], [tilt * 0.8, a, 0]), green());   // a stem
    put(b, leaf(L, Wd), M.leaf, T(m, [Math.cos(-a) * (tall ? 0.01 : L * 0.25), y + (tall ? 0 : L * 0.45 * Math.cos(tilt)), Math.sin(-a) * (tall ? 0.01 : L * 0.25)], [tilt, a, 0]), green());
  }
}
/** A wall clock `radius` on the wall plane (its back at z = 0), centred at y 0. */
export function wallClock(b, M, m, { radius = 0.16, time = [10, 10] } = {}) {
  cyl(b, M.plastic, m, radius, radius, 0.04, [0, 0, 0.02], BLACK, [Math.PI / 2, 0, 0], 32);
  cyl(b, M.paper, m, radius * 0.9, radius * 0.9, 0.005, [0, 0, 0.042], [0.95, 0.94, 0.9], [Math.PI / 2, 0, 0], 32);
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; box(b, M.plastic, m, [0.008, i % 3 ? 0.012 : 0.024, 0.002], [Math.sin(a) * radius * 0.78, Math.cos(a) * radius * 0.78, 0.046], BLACK, [0, 0, -a]); }
  const [hh, mm] = time, ah = (hh % 12 + mm / 60) / 12 * Math.PI * 2, am = mm / 60 * Math.PI * 2;
  box(b, M.metal, m, [0.012, radius * 0.5, 0.003], [Math.sin(ah) * radius * 0.25, Math.cos(ah) * radius * 0.25, 0.049], BLACK, [0, 0, -ah]);
  box(b, M.metal, m, [0.008, radius * 0.75, 0.003], [Math.sin(am) * radius * 0.37, Math.cos(am) * radius * 0.37, 0.052], BLACK, [0, 0, -am]);
}
/** A framed picture `size` [w, h] on the wall (back at z = 0, centred at y 0): a mat, an abstract painting in code. */
export function picture(b, M, m, { size = [0.6, 0.45], frame = BLACK, seed = 1 } = {}) {
  const R = rnd(seed), [w, h] = size, f = 0.03;
  for (const s of [-1, 1]) { box(b, M.wood, m, [w + f * 2, f, 0.03], [0, s * (h / 2 + f / 2), 0.015], frame); box(b, M.wood, m, [f, h, 0.03], [s * (w / 2 + f / 2), 0, 0.015], frame); }
  box(b, M.paper, m, [w, h, 0.005], [0, 0, 0.005], [0.93, 0.92, 0.88]);
  const pal = [[0.8, 0.3, 0.15], [0.1, 0.3, 0.5], [0.9, 0.7, 0.2], [0.15, 0.15, 0.17], [0.4, 0.55, 0.45]];
  for (let i = 0; i < 6; i++) { const pw = (0.1 + R() * 0.35) * w, ph = (0.1 + R() * 0.35) * h; box(b, M.paper, m, [pw, ph, 0.002], [(R() - 0.5) * (w * 0.75 - pw), (R() - 0.5) * (h * 0.75 - ph), 0.009 + i * 0.0005], pal[Math.floor(R() * pal.length)]); }
}
/** A curtain on a rail `width` wide hanging `drop` m from y 0 (the rail): folds as a wavy sheet, `open` 0..1 drawn to the sides. */
export function curtain(b, M, m, { width = 1.6, drop = 2.2, color = [0.55, 0.5, 0.42], open = 0.5 } = {}) {
  cyl(b, M.metal, m, 0.012, 0.012, width + 0.3, [0, 0, 0.08], DARK, [0, 0, Math.PI / 2], 8);
  const panel = width / 2 * (1 - open * 0.7);
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(panel, drop, Math.round(panel * 30), 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.035 * Math.sin(p.getX(i) / panel * Math.PI * panel * 9));
    g.computeVertexNormals();
    put(b, g, M.fabric, T(m, [s * (width / 2 - panel / 2 + 0.1), -drop / 2 - 0.02, 0.08]), color);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// kitchen and dining
/** A dining table `size` [w, d], 0.75 m: a top with a rounded edge, an apron, legs. */
export function diningTable(b, M, m, { size = [1.6, 0.9], color = OAK, round = false } = {}) {
  if (round) { cyl(b, M.wood, m, size[0] / 2, size[0] / 2, 0.035, [0, 0.735, 0], color, [0, 0, 0], 40); cyl(b, M.wood, m, 0.06, 0.08, 0.7, [0, 0.36, 0], color, [0, 0, 0], 16); cyl(b, M.wood, m, 0.3, 0.32, 0.04, [0, 0.02, 0], color, [0, 0, 0], 28); return; }
  box(b, M.wood, m, [size[0], 0.035, size[1]], [0, 0.735, 0], color, [0, 0, 0], 0.01);
  for (const s of [-1, 1]) { box(b, M.wood, m, [size[0] - 0.16, 0.08, 0.02], [0, 0.68, s * (size[1] / 2 - 0.08)], color); box(b, M.wood, m, [0.02, 0.08, size[1] - 0.16], [s * (size[0] / 2 - 0.08), 0.68, 0], color); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, M.wood, m, [0.055, 0.72, 0.055], [sx * (size[0] / 2 - 0.08), 0.36, sz * (size[1] / 2 - 0.08)], color);
}
/** A dining chair: seat at 0.45 m, a slatted back. */
export function chair(b, M, m, { color = OAK, seat = null } = {}) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, M.wood, m, [0.035, sz < 0 ? 0.92 : 0.43, 0.035], [sx * 0.2, (sz < 0 ? 0.92 : 0.43) / 2, sz * 0.2], color);
  box(b, seat ? M.fabric : M.wood, m, [0.46, 0.04, 0.44], [0, 0.45, 0], seat || color, [0, 0, 0], 0.01);
  for (const y of [0.62, 0.74, 0.86]) box(b, M.wood, m, [0.4, 0.05, 0.02], [0, y, -0.2], color, [0.08, 0, 0]);
  for (const s of [-1, 1]) box(b, M.wood, m, [0.02, 0.025, 0.38], [s * 0.2, 0.2, 0], color);
}
/** A bar stool: a round seat at 0.75 m on a chrome column with a footring. */
export function barStool(b, M, m, { color = [0.1, 0.1, 0.11] } = {}) {
  cyl(b, M.leather, m, 0.19, 0.18, 0.07, [0, 0.74, 0], color, [0, 0, 0], 28);
  cyl(b, M.chrome, m, 0.025, 0.025, 0.7, [0, 0.36, 0], STEEL, [0, 0, 0], 12);
  put(b, new THREE.TorusGeometry(0.17, 0.01, 6, 28).rotateX(Math.PI / 2), M.chrome, T(m, [0, 0.3, 0]), STEEL);
  cyl(b, M.chrome, m, 0.22, 0.23, 0.02, [0, 0.01, 0], STEEL, [0, 0, 0], 28);
}
/** A run of kitchen counter `width` wide (cabinets, a worktop, a sink with a tap when `sink`, a hob when `hob`),
 *  0.9 m high, 0.62 m deep, its back against z = -0.31; wall cabinets above when `wall`. */
export function kitchenCounter(b, M, m, { width = 2.4, sink = true, hob = true, wall = true, front = [0.86, 0.86, 0.84], top = [0.22, 0.22, 0.23] } = {}) {
  const n = Math.max(1, Math.round(width / 0.6)), u = width / n;
  box(b, M.wood, m, [width, 0.1, 0.56], [0, 0.05, -0.01], BLACK);   // the plinth
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + u * (i + 0.5);
    box(b, M.wood, m, [u - 0.004, 0.76, 0.58], [x, 0.48, 0], front.map((v) => v * 0.94));
    box(b, M.plastic, m, [u - 0.008, 0.72, 0.018], [x, 0.48, 0.3], front);   // the door
    box(b, M.chrome, m, [0.14, 0.012, 0.02], [x, 0.8, 0.32], STEEL, [0, 0, 0], 0.004);   // its handle
  }
  box(b, M.ceramic, m, [width + 0.02, 0.035, 0.63], [0, 0.88, 0.005], top);   // the worktop
  if (sink) {
    const x = -width / 2 + u * 0.5 + (n > 2 ? u : 0);
    box(b, M.chrome, m, [0.5, 0.012, 0.42], [x, 0.9, 0.02], STEEL);
    box(b, M.chrome, m, [0.44, 0.18, 0.36], [x, 0.81, 0.02], STEEL.map((v) => v * 0.6));   // the bowl (a dark box)
    cyl(b, M.chrome, m, 0.018, 0.022, 0.3, [x, 1.05, -0.22], STEEL, [0, 0, 0], 12);
    put(b, new THREE.TorusGeometry(0.11, 0.012, 8, 20, Math.PI).rotateY(Math.PI / 2), M.chrome, T(m, [x, 1.2, -0.11]), STEEL);   // the swan neck
  }
  if (hob) {
    const x = width / 2 - u * 0.5;
    box(b, M.ceramic, m, [0.58, 0.008, 0.5], [x, 0.9, 0.02], BLACK);
    for (const [dx, dz, r] of [[-0.14, -0.1, 0.09], [0.14, -0.1, 0.07], [-0.14, 0.12, 0.07], [0.14, 0.12, 0.1]]) put(b, new THREE.RingGeometry(r * 0.85, r, 24).rotateX(-Math.PI / 2), M.plastic, T(m, [x + dx, 0.905, 0.02 + dz]), [0.25, 0.25, 0.27]);
    box(b, M.chrome, m, [u - 0.02, 0.6, 0.02], [x, 0.45, 0.31], [0.15, 0.15, 0.16]);   // an oven door
    box(b, M.glass, m, [u - 0.12, 0.3, 0.005], [x, 0.43, 0.322], WHITE);
  }
  if (wall) for (let i = 0; i < n; i++) { const x = -width / 2 + u * (i + 0.5); box(b, M.wood, m, [u - 0.004, 0.7, 0.34], [x, 1.85, -0.14], front.map((v) => v * 0.94)); box(b, M.plastic, m, [u - 0.008, 0.68, 0.016], [x, 1.85, 0.035], front); }
}
/** A fridge-freezer 1.85 m: a cabinet, two doors with bar handles. */
export function fridge(b, M, m, { color = [0.85, 0.86, 0.86] } = {}) {
  box(b, M.plastic, m, [0.6, 1.85, 0.64], [0, 0.925, 0], color, [0, 0, 0], 0.02);
  box(b, M.plastic, m, [0.585, 0.005, 0.01], [0, 1.18, 0.322], DARK);
  for (const [y, h] of [[1.5, 0.5], [0.62, 0.6]]) box(b, M.chrome, m, [0.025, h, 0.03], [0.24, y, 0.35], STEEL, [0, 0, 0], 0.008);
}
/** A microwave on a worktop. */
export function microwave(b, M, m) { box(b, M.plastic, m, [0.48, 0.28, 0.36], [0, 0.14, 0], [0.15, 0.15, 0.16], [0, 0, 0], 0.01); box(b, M.glass, m, [0.3, 0.18, 0.004], [-0.06, 0.14, 0.182], WHITE); box(b, M.plastic, m, [0.1, 0.22, 0.004], [0.17, 0.14, 0.182], DARK); }
/** A kettle. */
export function kettle(b, M, m, { color = [0.7, 0.71, 0.72] } = {}) {
  lathe(b, M.chrome, m, [[0, 0], [0.08, 0], [0.085, 0.04], [0.075, 0.17], [0.05, 0.2], [0, 0.205]], [0, 0, 0], color, 24);
  put(b, new THREE.TorusGeometry(0.07, 0.012, 6, 16, Math.PI).rotateZ(-Math.PI / 2), M.plastic, T(m, [-0.06, 0.12, 0], [0, 0, 0.4]), BLACK);
  cyl(b, M.chrome, m, 0.008, 0.016, 0.08, [0.09, 0.14, 0], color, [0, 0, -0.8], 8);
}
/** A mug. */
export function mug(b, M, m, { color = [0.9, 0.88, 0.84] } = {}) {
  lathe(b, M.ceramic, m, [[0, 0], [0.04, 0], [0.042, 0.095], [0.038, 0.095], [0.036, 0.01], [0, 0.01]], [0, 0, 0], color, 20);
  put(b, new THREE.TorusGeometry(0.025, 0.006, 6, 12, Math.PI).rotateZ(-Math.PI / 2), M.ceramic, T(m, [0.042, 0.05, 0]), color);
}
/** A place setting: a plate, a glass, a knife and a fork. */
export function placeSetting(b, M, m, { color = WHITE } = {}) {
  lathe(b, M.ceramic, m, [[0, 0], [0.07, 0], [0.12, 0.012], [0.13, 0.02], [0.125, 0.022], [0.11, 0.015], [0, 0.008]], [0, 0, 0], color, 32);
  for (const s of [-1, 1]) box(b, M.chrome, m, [0.015, 0.004, 0.2], [s * 0.17, 0.002, 0], STEEL);
  lathe(b, M.glass, m, [[0, 0], [0.035, 0], [0.04, 0.12], [0.037, 0.12], [0.032, 0.006], [0, 0.006]], [0.16, 0, -0.15], WHITE, 18);
}

// ---------------------------------------------------------------------------------------------------------------
// bedroom
/** A bed `width` (0.9 single .. 1.8 king) x 2.0 m: a frame on legs, a headboard, a mattress, a duvet, pillows. */
export function bed(b, M, m, { width = 1.6, frame = WALNUT, duvet = [0.82, 0.84, 0.86], pillow = [0.95, 0.95, 0.93], made = true } = {}) {
  const L = 2.05;
  legs4(b, M, m, width + 0.06, L, 0.18, 0.025, 0.05, frame);
  box(b, M.wood, m, [width + 0.08, 0.16, L + 0.04], [0, 0.26, 0], frame, [0, 0, 0], 0.01);
  box(b, M.fabric, m, [width + 0.08, 0.95, 0.07], [0, 0.48, -L / 2 - 0.02], frame.map((v) => v * 1.4), [0, 0, 0], 0.03);   // the headboard
  box(b, M.fabric, m, [width - 0.02, 0.22, L - 0.04], [0, 0.45, 0.01], [0.92, 0.92, 0.9], [0, 0, 0], 0.05);   // the mattress
  const pw = width > 1.2 ? (width - 0.12) / 2 : width - 0.12;
  for (let i = 0; i < (width > 1.2 ? 2 : 1); i++) cushion(b, M, T(m, [width > 1.2 ? (i ? 1 : -1) * (pw / 2 + 0.03) : 0, 0.55, -L / 2 + 0.3], [-0.25, 0, 0], [pw / 0.45, 1, 0.6]), { color: pillow });
  if (made) {
    const g = new RoundedBoxGeometry(width + 0.1, 0.08, L * 0.72, 3, 0.035), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); if (Math.abs(x) > width / 2 - 0.03) p.setY(i, p.getY(i) - 0.18 * (Math.abs(x) - width / 2 + 0.03) / 0.08); p.setY(i, p.getY(i) + 0.01 * Math.sin(z * 9 + x * 4)); }   // the duvet hangs over the sides, a few soft wrinkles
    g.computeVertexNormals(); put(b, g, M.fabric, T(m, [0, 0.58, L * 0.14]), duvet);
  }
}
/** A bedside table 0.55 m with a drawer. */
export function nightstand(b, M, m, { color = WALNUT } = {}) {
  box(b, M.wood, m, [0.45, 0.48, 0.38], [0, 0.31, 0], color, [0, 0, 0], 0.008);
  box(b, M.wood, m, [0.42, 0.14, 0.01], [0, 0.46, 0.192], color.map((v) => v * 1.25)); box(b, M.chrome, m, [0.1, 0.012, 0.015], [0, 0.46, 0.2], STEEL);
  legs4(b, M, m, 0.42, 0.34, 0.07, 0.015, 0.02, color);
}
/** A wardrobe `width` x 2.1 m with two (or three) doors and handles. */
export function wardrobe(b, M, m, { width = 1.2, color = [0.88, 0.86, 0.82] } = {}) {
  box(b, M.wood, m, [width, 2.1, 0.6], [0, 1.08, 0], color.map((v) => v * 0.9), [0, 0, 0], 0.01);
  const n = width > 1.4 ? 3 : 2, u = width / n;
  for (let i = 0; i < n; i++) { const x = -width / 2 + u * (i + 0.5); box(b, M.wood, m, [u - 0.006, 2.0, 0.02], [x, 1.08, 0.305], color); box(b, M.chrome, m, [0.015, 0.3, 0.02], [x + (i % 2 ? -1 : 1) * (u / 2 - 0.05), 1.1, 0.325], STEEL, [0, 0, 0], 0.005); }
  box(b, M.wood, m, [width, 0.04, 0.6], [0, 0.02, 0], BLACK);
}
/** A chest of drawers `width` x 0.85 m, `drawers` high, a mirror above when `mirror`. */
export function dresser(b, M, m, { width = 1.0, drawers = 4, color = OAK, mirror = true } = {}) {
  box(b, M.wood, m, [width, 0.8, 0.48], [0, 0.45, 0], color, [0, 0, 0], 0.008);
  for (let i = 0; i < drawers; i++) { const y = 0.12 + (0.72 / drawers) * (i + 0.5); box(b, M.wood, m, [width - 0.04, 0.72 / drawers - 0.012, 0.015], [0, y, 0.245], color.map((v) => v * 1.12)); for (const s of [-1, 1]) cyl(b, M.chrome, m, 0.012, 0.012, 0.025, [s * width * 0.25, y, 0.265], STEEL, [Math.PI / 2, 0, 0], 10); }
  legs4(b, M, m, width - 0.02, 0.44, 0.05, 0.018, 0.04, color);
  if (mirror) { box(b, M.wood, m, [width * 0.7, 0.8, 0.025], [0, 1.3, -0.2], color); box(b, M.chrome, m, [width * 0.7 - 0.06, 0.74, 0.005], [0, 1.3, -0.185], [0.95, 0.96, 0.97]); }
}

// ---------------------------------------------------------------------------------------------------------------
// bathroom
/** A toilet: a pedestal, a bowl, a seat and lid, a cistern against the wall (back at z = -0.36). */
export function toilet(b, M, m, { color = [0.95, 0.95, 0.94] } = {}) {
  lathe(b, M.ceramic, m, [[0, 0], [0.13, 0], [0.11, 0.2], [0.18, 0.38], [0.19, 0.4], [0, 0.4]], [0, 0, 0.04], color, 28);
  put(b, new THREE.TorusGeometry(0.15, 0.025, 8, 28).rotateX(Math.PI / 2).scale(1, 1, 1.25), M.plastic, T(m, [0, 0.42, 0.04]), color);
  box(b, M.ceramic, m, [0.4, 0.38, 0.17], [0, 0.6, -0.27], color, [0, 0, 0], 0.03);
  box(b, M.chrome, m, [0.06, 0.02, 0.03], [0, 0.8, -0.2], STEEL, [0, 0, 0], 0.008);
}
/** A washbasin on a vanity unit 0.85 m, a mixer tap, a mirror above. */
export function washbasin(b, M, m, { width = 0.6, color = [0.95, 0.95, 0.94], unit = [0.3, 0.25, 0.2] } = {}) {
  box(b, M.wood, m, [width, 0.7, 0.45], [0, 0.45, 0], unit, [0, 0, 0], 0.008);
  box(b, M.ceramic, m, [width + 0.02, 0.1, 0.47], [0, 0.85, 0], color, [0, 0, 0], 0.02);
  put(b, new THREE.CylinderGeometry(0.2, 0.15, 0.06, 28, 1, true), M.ceramic, T(m, [0, 0.87, 0.02]), color.map((v) => v * 0.8));
  cyl(b, M.chrome, m, 0.018, 0.02, 0.16, [0, 0.98, -0.16], STEEL, [0, 0, 0], 12); box(b, M.chrome, m, [0.025, 0.025, 0.12], [0, 1.06, -0.11], STEEL, [0, 0, 0], 0.01);
  box(b, M.chrome, m, [width - 0.04, 0.7, 0.01], [0, 1.5, -0.22], [0.95, 0.96, 0.97]);
}
/** A bathtub 1.7 x 0.75 m against a wall (its back at z = -0.375), a panel front, a tap. */
export function bathtub(b, M, m, { color = [0.96, 0.96, 0.95] } = {}) {
  box(b, M.ceramic, m, [1.7, 0.56, 0.75], [0, 0.28, 0], color, [0, 0, 0], 0.03);
  box(b, M.ceramic, m, [1.56, 0.44, 0.6], [0, 0.36, 0], color.map((v) => v * 0.82), [0, 0, 0], 0.08);   // the inside (darker: in shade)
  cyl(b, M.chrome, m, 0.02, 0.02, 0.18, [0.7, 0.65, -0.33], STEEL, [0, 0, 0], 12); box(b, M.chrome, m, [0.03, 0.03, 0.14], [0.7, 0.73, -0.27], STEEL, [0, 0, 0], 0.01);
}
/** A heated towel rail on a wall (back at z = 0) with a towel over it. */
export function towelRail(b, M, m, { color = [0.35, 0.55, 0.6] } = {}) {
  for (const s of [-1, 1]) cyl(b, M.chrome, m, 0.014, 0.014, 0.8, [s * 0.25, 1.0, 0.06], STEEL, [0, 0, 0], 10);
  for (let y = 0.7; y < 1.4; y += 0.12) cyl(b, M.chrome, m, 0.01, 0.01, 0.5, [0, y, 0.06], STEEL, [0, 0, Math.PI / 2], 8);
  box(b, M.fabric, m, [0.44, 0.5, 0.025], [0, 1.1, 0.08], color, [0, 0, 0], 0.01);
}

// ---------------------------------------------------------------------------------------------------------------
// office
/** A desk `size` [w, d] at 0.74 m on two panel legs, a modesty panel, and what is on it (`kit`: a monitor, a
 *  keyboard, a mouse, a lamp, papers, a mug) from `seed`. */
export function desk(b, M, m, { size = [1.4, 0.7], color = [0.9, 0.89, 0.86], legs = [0.25, 0.25, 0.27], kit = true, seed = 1 } = {}) {
  const [w, d] = size, R = rnd(seed);
  box(b, M.wood, m, [w, 0.025, d], [0, 0.7275, 0], color, [0, 0, 0], 0.006);
  for (const s of [-1, 1]) box(b, M.metal, m, [0.05, 0.715, d - 0.08], [s * (w / 2 - 0.06), 0.3575, 0], legs);
  box(b, M.metal, m, [w - 0.16, 0.35, 0.012], [0, 0.5, -d / 2 + 0.08], legs);
  if (!kit) return;
  const top = T(m, [0, 0.74, 0]);
  monitor(b, M, T(top, [0, 0, -d / 2 + 0.2]));
  keyboard(b, M, T(top, [0, 0, 0.12])); computerMouse(b, M, T(top, [0.3, 0, 0.12]));
  if (R() < 0.7) deskLamp(b, M, T(top, [-w / 2 + 0.32, 0, -d / 2 + 0.15], [0, 0.6, 0]));   // its head reaches back over the desk's corner
  if (R() < 0.8) papers(b, M, T(top, [w / 2 - 0.25, 0, 0], [0, (R() - 0.5) * 0.4, 0]), { seed: seed + 3 });
  if (R() < 0.6) mug(b, M, T(top, [w / 2 - 0.12, 0, -0.15]), { color: [[0.7, 0.15, 0.1], [0.1, 0.25, 0.45], [0.9, 0.88, 0.84]][Math.floor(R() * 3)] });
}
/** A monitor 27" on a stand, its screen lit. */
export function monitor(b, M, m, { width = 0.62 } = {}) {
  const h = width * 0.5625;
  box(b, M.plastic, m, [width + 0.012, h + 0.012, 0.03], [0, 0.14 + h / 2, 0], BLACK, [0, 0, 0], 0.004);
  put(b, new THREE.PlaneGeometry(width, h), M.screen, T(m, [0, 0.14 + h / 2, 0.0155]));
  box(b, M.metal, m, [0.05, 0.25, 0.03], [0, 0.125, -0.04], STEEL.map((v) => v * 0.5)); box(b, M.metal, m, [0.24, 0.01, 0.18], [0, 0.005, -0.02], STEEL.map((v) => v * 0.5), [0, 0, 0], 0.004);
}
/** A laptop open at `angle` (radians, 1.9 = a working angle). */
export function laptop(b, M, m, { angle = 1.9, color = [0.6, 0.61, 0.63] } = {}) {
  box(b, M.metal, m, [0.32, 0.015, 0.22], [0, 0.0075, 0], color, [0, 0, 0], 0.004);
  box(b, M.plastic, m, [0.28, 0.002, 0.1], [0, 0.0155, -0.02], BLACK);
  const lid = T(m, [0, 0.015, -0.11], [Math.PI / 2 - angle, 0, 0]);
  box(b, M.metal, lid, [0.32, 0.22, 0.008], [0, 0.11, 0], color, [0, 0, 0], 0.003);
  put(b, new THREE.PlaneGeometry(0.29, 0.18), M.screen, T(lid, [0, 0.11, 0.0045]));
}
/** A keyboard: a low slab and a grid of keys. */
export function keyboard(b, M, m, { color = [0.18, 0.18, 0.19] } = {}) {
  box(b, M.plastic, m, [0.44, 0.018, 0.14], [0, 0.009, 0], color, [0, 0, 0], 0.004);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) box(b, M.plastic, m, [0.024, 0.008, 0.021], [-0.2 + c * 0.0286, 0.022, -0.052 + r * 0.026], color.map((v) => v * 1.5));
}
/** A computer mouse. */
export function computerMouse(b, M, m, { color = [0.18, 0.18, 0.19] } = {}) {
  const g = new THREE.SphereGeometry(0.03, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1.8);
  put(b, g, M.plastic, T(m), color);
}
/** An articulated desk lamp: a base, two arms, a cone head (the light is the host's: at the head). */
export function deskLamp(b, M, m, { color = [0.85, 0.2, 0.12] } = {}) {
  cyl(b, M.metal, m, 0.08, 0.09, 0.02, [0, 0.01, 0], color, [0, 0, 0], 20);
  box(b, M.metal, m, [0.015, 0.35, 0.015], [0, 0.18, 0], color, [0, 0, -0.25]);
  box(b, M.metal, m, [0.015, 0.32, 0.015], [-0.18, 0.43, 0], color, [0, 0, 1.0]);
  put(b, new THREE.ConeGeometry(0.07, 0.12, 20, 1, true).translate(0, -0.06, 0), M.metal, T(m, [-0.33, 0.5, 0], [0, 0, 0.6]), color);
}
/** A stack of papers and a closed folder. */
export function papers(b, M, m, { seed = 1 } = {}) {
  const R = rnd(seed);
  for (let i = 0; i < 6; i++) box(b, M.paper, m, [0.21, 0.002, 0.297], [(R() - 0.5) * 0.01, 0.001 + i * 0.002, (R() - 0.5) * 0.01], [0.95, 0.95, 0.93], [0, (R() - 0.5) * 0.08, 0]);
  box(b, M.paper, m, [0.24, 0.012, 0.31], [0.02, 0.019, 0.01], [[0.1, 0.3, 0.6], [0.7, 0.15, 0.1], [0.9, 0.7, 0.1]][Math.floor(R() * 3)], [0, 0.12, 0]);
}
/** An office chair: a five-star base on casters, a gas lift, a seat at 0.47 m, a mesh back, arms. */
export function officeChair(b, M, m, { color = [0.12, 0.12, 0.13] } = {}) {
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    box(b, M.metal, m, [0.3, 0.035, 0.05], [Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15], DARK, [0, -a, 0]);
    put(b, new THREE.SphereGeometry(0.03, 10, 6).scale(1, 1, 0.6), M.plastic, T(m, [Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3], [0, -a, 0]), BLACK);   // a caster
  }
  cyl(b, M.chrome, m, 0.025, 0.025, 0.32, [0, 0.25, 0], STEEL, [0, 0, 0], 12);
  box(b, M.fabric, m, [0.5, 0.08, 0.48], [0, 0.45, 0], color, [0, 0, 0], 0.035);
  box(b, M.metal, m, [0.06, 0.4, 0.04], [0, 0.6, -0.24], DARK);
  const back = new RoundedBoxGeometry(0.46, 0.55, 0.04, 2, 0.02), p = back.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.06 * (p.getX(i) / 0.23) ** 2);   // curved round the back
  back.computeVertexNormals(); put(b, back, M.fabric, T(m, [0, 0.82, -0.25], [-0.1, 0, 0]), color);
  for (const s of [-1, 1]) { box(b, M.plastic, m, [0.04, 0.2, 0.04], [s * 0.26, 0.58, -0.04], DARK); box(b, M.plastic, m, [0.07, 0.03, 0.24], [s * 0.26, 0.69, -0.02], DARK, [0, 0, 0], 0.012); }
}
/** A filing cabinet of `drawers` drawers (0.72 m for two, 1.3 m for four). */
export function filingCabinet(b, M, m, { drawers = 3, color = [0.6, 0.62, 0.62] } = {}) {
  const h = 0.33 * drawers;
  box(b, M.metal, m, [0.46, h, 0.6], [0, h / 2, 0], color, [0, 0, 0], 0.006);
  for (let i = 0; i < drawers; i++) { const y = 0.33 * (i + 0.5); box(b, M.metal, m, [0.44, 0.31, 0.012], [0, y, 0.302], color.map((v) => v * 1.1)); box(b, M.chrome, m, [0.14, 0.02, 0.025], [0, y + 0.06, 0.315], STEEL); box(b, M.paper, m, [0.08, 0.04, 0.002], [0, y + 0.11, 0.309], [0.95, 0.95, 0.9]); }
}
/** A whiteboard `size` [w, h] on the wall (back at z = 0, its bottom at y 0.9), a tray and two markers. */
export function whiteboard(b, M, m, { size = [1.8, 1.2] } = {}) {
  const [w, h] = size;
  box(b, M.metal, m, [w + 0.04, h + 0.04, 0.02], [0, 0.9 + h / 2, 0.01], STEEL);
  box(b, M.ceramic, m, [w, h, 0.004], [0, 0.9 + h / 2, 0.022], [0.97, 0.97, 0.97]);
  box(b, M.metal, m, [w * 0.6, 0.02, 0.07], [0, 0.89, 0.04], STEEL);
  for (const [x, c] of [[-0.2, [0.1, 0.2, 0.7]], [-0.05, [0.7, 0.1, 0.1]]]) cyl(b, M.plastic, m, 0.008, 0.008, 0.13, [x, 0.91, 0.05], c, [0, 0, Math.PI / 2], 8);
  for (let i = 0; i < 4; i++) box(b, M.paper, m, [0.4 + i * 0.12, 0.012, 0.001], [-w / 2 + 0.4 + i * 0.06, 0.9 + h - 0.2 - i * 0.12, 0.025], [0.1, 0.2, 0.6]);   // a few written lines
}
/** A printer on a stand. */
export function printer(b, M, m) {
  box(b, M.metal, m, [0.5, 0.6, 0.45], [0, 0.3, 0], [0.3, 0.3, 0.32], [0, 0, 0], 0.006);
  box(b, M.plastic, m, [0.46, 0.28, 0.42], [0, 0.74, 0], [0.86, 0.86, 0.85], [0, 0, 0], 0.015);
  box(b, M.paper, m, [0.21, 0.004, 0.25], [0, 0.82, 0.12], WHITE, [0.2, 0, 0]);
  box(b, M.plastic, m, [0.12, 0.004, 0.06], [0.15, 0.881, -0.1], [0.1, 0.4, 0.2]);
}
/** A water cooler with a bottle. */
export function waterCooler(b, M, m) {
  box(b, M.plastic, m, [0.32, 1.0, 0.32], [0, 0.5, 0], [0.92, 0.92, 0.92], [0, 0, 0], 0.02);
  lathe(b, M.glass, m, [[0, 0], [0.13, 0.02], [0.135, 0.33], [0.06, 0.4], [0.025, 0.42], [0, 0.42]], [0, 1.0, 0], WHITE, 24);
  for (const [x, c] of [[-0.06, [0.15, 0.3, 0.8]], [0.06, [0.8, 0.15, 0.1]]]) box(b, M.plastic, m, [0.04, 0.05, 0.03], [x, 0.85, 0.17], c);
}
/** A waste-paper bin. */
export function wasteBin(b, M, m, { color = [0.2, 0.2, 0.21] } = {}) { put(b, new THREE.CylinderGeometry(0.14, 0.11, 0.32, 20, 1, true), M.plastic, T(m, [0, 0.16, 0]), color); cyl(b, M.plastic, m, 0.11, 0.11, 0.01, [0, 0.005, 0], color, [0, 0, 0], 20); }
/** A cubicle partition `width` x 1.4 m (fabric panel, aluminium frame), along x. */
export function partition(b, M, m, { width = 1.6, height = 1.4, color = [0.35, 0.38, 0.42] } = {}) {
  box(b, M.fabric, m, [width - 0.04, height - 0.04, 0.05], [0, height / 2, 0], color);
  for (const s of [-1, 1]) box(b, M.metal, m, [0.03, height, 0.06], [s * (width / 2 - 0.015), height / 2, 0], STEEL);
  box(b, M.metal, m, [width, 0.03, 0.06], [0, height - 0.015, 0], STEEL);
  for (const s of [-1, 1]) box(b, M.metal, m, [0.05, 0.02, 0.4], [s * (width / 2 - 0.1), 0.01, 0], STEEL);
}
/** A meeting table `size` [w, d] with chairs round it (one per 0.7 m along each long side, one at each end). */
export function meetingTable(b, M, m, { size = [2.8, 1.1], color = WALNUT, chairs = true } = {}) {
  const [w, d] = size;
  box(b, M.wood, m, [w, 0.04, d], [0, 0.73, 0], color, [0, 0, 0], 0.015);
  for (const s of [-1, 1]) box(b, M.metal, m, [0.08, 0.71, d * 0.6], [s * w * 0.32, 0.355, 0], STEEL);
  if (!chairs) return;
  const n = Math.max(1, Math.floor(w / 0.7));
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) officeChair(b, M, T(m, [-w / 2 + w * (i + 0.5) / n, 0, s * (d / 2 + 0.35)], [0, s > 0 ? Math.PI : 0, 0]));
  for (const s of [-1, 1]) officeChair(b, M, T(m, [s * (w / 2 + 0.4), 0, 0], [0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0]));
}
/** A desk phone. */
export function deskPhone(b, M, m) {
  const lift = 0.022;   // the base is tilted toward the user: raised so its front edge rests on the desk
  box(b, M.plastic, m, [0.2, 0.05, 0.18], [0, 0.025 + lift, 0], BLACK, [-0.25, 0, 0], 0.01);
  box(b, M.plastic, m, [0.05, 0.035, 0.2], [-0.065, 0.07 + lift, 0], DARK, [0, 0, 0], 0.012);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) box(b, M.plastic, m, [0.018, 0.006, 0.016], [0.015 + c * 0.025, 0.055 + lift - r * 0.0055, -0.04 + r * 0.025], [0.5, 0.5, 0.52], [-0.25, 0, 0]);
}
