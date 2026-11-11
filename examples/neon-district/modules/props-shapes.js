// props-shapes: the small turned and folded shapes the props are made of (not a module). Each comes with its uv laid
// out for the atlas cell family it prints from (props-kit.js), so a product can be instanced with a per-instance
// label: a can (lathe: a domed base, the barrel, a necked shoulder, the rim, a recessed lid and a pull tab), a PET
// bottle (lathe: base feet, a waisted body, shoulder, neck ring, a ribbed cap), a noodle cup, a carton or box, a
// pillow snack pack, a capsule, a spiral feeder. Sizes in metres, standing on y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uvByHeight, uvRect } from './props-kit.js';

const lathe = (pts, seg) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg); g.computeVertexNormals(); return g; };
const fit = (g, r) => uvRect(g, r);

/** a 350 ml can: r 0.033, h 0.122 */
export function canGeo(rect, seg = 12) {
  const body = lathe([[0, 0.004], [0.026, 0.0], [0.031, 0.006], [0.033, 0.014], [0.033, 0.104], [0.0275, 0.117], [0.0275, 0.1225], [0.025, 0.1215], [0, 0.118]], seg);
  uvByHeight(body, 0.014, 0.104);
  const tab = new THREE.BoxGeometry(0.012, 0.0015, 0.02).translate(0, 0.1195, 0.006);
  uvByHeight(tab, 0.2, 0.3);   // all at v = 1: the silver lid
  const g = mergeGeometries([body.toNonIndexed(), tab.toNonIndexed()]);
  return fit(g, rect);
}
/** a 500 ml PET bottle: r 0.034, h 0.205 */
export function bottleGeo(rect, seg = 10) {
  const g = lathe([[0, 0.002], [0.03, 0], [0.034, 0.02], [0.031, 0.05], [0.034, 0.08], [0.034, 0.13], [0.022, 0.168], [0.014, 0.18], [0.016, 0.183], [0.0145, 0.185], [0.0145, 0.203], [0, 0.205]], seg);
  uvByHeight(g, 0, 0.205);
  return fit(g.toNonIndexed(), rect);
}
/** a glass bottle for the back bar: r, h; with a label band (uv by height over the whole bottle) */
export function wineGeo(rect, r = 0.038, h = 0.3, seg = 14) {
  const g = lathe([[0, 0.003], [r * 0.85, 0], [r, 0.01], [r, h * 0.6], [r * 0.9, h * 0.66], [r * 0.45, h * 0.74], [r * 0.34, h * 0.8], [r * 0.34, h * 0.95], [r * 0.4, h * 0.96], [r * 0.38, h], [0, h]], seg);
  uvByHeight(g, 0, h);
  return fit(g.toNonIndexed(), rect);
}
/** a noodle cup: r 0.05 at the top, h 0.1, a foil lid */
export function cupGeo(rect, seg = 16) {
  const g = lathe([[0, 0], [0.036, 0], [0.038, 0.004], [0.05, 0.096], [0.053, 0.1], [0.052, 0.102], [0, 0.102]], seg);
  uvByHeight(g, 0.004, 0.096);
  return fit(g.toNonIndexed(), rect);
}
/** a carton or a box w x h x d, one face printed all round */
export function boxGeo(rect, w = 0.065, h = 0.1, d = 0.045) { return fit(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).toNonIndexed(), rect); }
/** a pillow pack: puffed in the middle, crimped flat at top and bottom */
export function packGeo(rect, w = 0.11, h = 0.15, d = 0.04) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 6, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2), crimp = Math.abs(y) > 0.86 ? 0.08 : 1;
    p.setZ(i, p.getZ(i) * crimp * Math.max(0.15, 1 - 0.55 * x * x - 0.35 * y * y));
    p.setX(i, p.getX(i) * (1 - 0.04 * (1 - y * y)));
  }
  g.computeVertexNormals(); g.translate(0, h / 2, 0);
  return fit(g.toNonIndexed(), rect);
}
/** a capsule toy: r 0.032, two halves (the cell's top and bottom) */
export function capsuleGeo(rect) { const g = new THREE.SphereGeometry(0.032, 8, 6).scale(1, 1.1, 1); uvByHeight(g, -0.035, 0.035); return fit(g.toNonIndexed(), rect); }
/** a spiral feeder along -z from z = 0: r, length, turns; wire radius rw */
export function spiralGeo(r = 0.05, len = 0.42, turns = 4, rw = 0.0035) {
  const pts = [], n = turns * 7;
  for (let i = 0; i <= n; i++) { const a = (i / 7) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r + r, -len * i / n)); }
  pts.push(new THREE.Vector3(r, r, -len - 0.03));
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, rw, 3, false);
  return g.toNonIndexed();
}
/** a tumbler or a sake glass: an open lathe with a wall */
export function glassGeo(r = 0.035, h = 0.09, seg = 14) { return lathe([[0, 0], [r * 0.85, 0], [r, h], [r * 0.93, h], [r * 0.8, 0.012], [0, 0.012]], seg); }
/** a bowl: r at the rim, a foot ring */
export function bowlGeo(r = 0.085, h = 0.07, seg = 16) { return lathe([[0, 0.006], [r * 0.4, 0], [r * 0.42, 0.008], [r * 0.6, 0.012], [r * 0.92, h * 0.6], [r, h], [r * 0.95, h], [r * 0.86, h * 0.6], [0, h * 0.18]], seg); }
/** a jar with a lid: r, h */
export function jarGeo(rect, r = 0.04, h = 0.11, seg = 12) {
  const g = lathe([[0, 0], [r * 0.95, 0], [r, 0.008], [r, h * 0.8], [r * 0.85, h * 0.86], [r * 0.82, h * 0.88], [r * 0.86, h * 0.9], [r * 0.86, h], [0, h]], seg);
  uvByHeight(g, 0, h * 0.82);
  return fit(g.toNonIndexed(), rect);
}
