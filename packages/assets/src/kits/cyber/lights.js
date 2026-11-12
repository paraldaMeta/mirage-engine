// Mirage original code. kit/cyber's light fixtures: the visible fittings of lights. The light itself is the host's
// (a lamp-pool entry or a PointLight it declares); these are what a player sees of it from a metre: a paper lantern (a ribbed lathe of
// printed paper between lacquered caps, bamboo hoops, a cord and a tassel; brighter where it faces you), a string
// bulb (a pear of glass on a socket with a hot filament), a street lamp head (a housing with cooling fins, a visor,
// a recessed lens with a reflector pattern, on a bracket), a caged bulkhead, a tube fixture (a channel, a diffuser,
// end caps, hangers), a floodlight on a yoke, a rotating beacon, a signal head with hoods. Each adds to a MeshBatch
// through the props kit (one draw per material for everything a module builds). Emissive parts are small and hot.
import * as THREE from 'three';
import { uvByHeight, track, markBatch, sinceMark } from './kit.js';

const LAQ = [0.04, 0.012, 0.01], IRON = [0.05, 0.05, 0.055];
const lathe = (pts, seg) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg); g.computeVertexNormals(); return g; };
const cache = new Map();
const once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

/** the paper of a lantern, r x h, its base at y = 0: 12 ribs */
function lanternPaper(r, h) {
  return once(`lp${r}${h}`, () => {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = 0.04 + 0.92 * i / 24, rib = 1 - 0.045 * Math.pow(Math.abs(Math.cos(t * Math.PI * 12)), 3); pts.push([r * Math.pow(Math.sin(Math.PI * t), 0.55) * rib, h * t]); }
    return uvByHeight(lathe(pts, 11), h * 0.04, h * 0.96);
  });
}
/** A paper lantern hanging from `top` ([x, y, z], where its cord starts): r, h, the print (0..3), a colour, how
 *  bright, a tilt, the cord's length. */
export function paperLantern(P, bt, geom, top, { r = 0.2, h = 0.46, print = 0, color = [1.0, 0.3, 0.18], k = 1.6, tilt = 0, cord = 0.3, yaw = 0 } = {}) {
  const { mats, put, R } = P, all = markBatch(bt);
  const m = geom.compose([top[0], top[1] - cord, top[2]], [tilt, yaw, tilt * 0.6]);
  const at = (p) => m.clone().multiply(geom.compose(p));
  const y0 = -h - 0.05;   // the paper's foot, under the top cap
  const paper = track(bt, () => put(bt, lanternPaper(r, h), mats.lantern, at([0, y0, 0]), color.map((c) => c * k), R['lantern' + (print % 4)]));
  const capR = r * 0.42;
  put(bt, lathe([[0, 0], [capR, 0], [capR, 0.035], [capR * 0.8, 0.05], [0.012, 0.06]], 12), mats.paint, at([0, -0.06, 0]), LAQ);       // the top cap
  put(bt, lathe([[0, 0.05], [capR, 0.05], [capR, 0.015], [capR * 0.8, 0], [0.012, -0.01]], 12), mats.paint, at([0, y0 - 0.04, 0]), LAQ);   // the bottom cap
  for (const t of [0.12, 0.88]) { const rr = r * Math.pow(Math.sin(Math.PI * t), 0.55); put(bt, new THREE.TorusGeometry(rr, 0.005, 3, 14).rotateX(Math.PI / 2), mats.paint, at([0, y0 + h * t, 0]), [0.25, 0.14, 0.06]); }
  put(bt, new THREE.CylinderGeometry(0.004, 0.004, cord + 0.06, 4), mats.paint, at([0, cord / 2 - 0.03, 0]), [0.02, 0.02, 0.02]);     // the cord
  // the tassel: a knot, a skirt of strands
  put(bt, new THREE.SphereGeometry(0.014, 6, 4), mats.paint, at([0, y0 - 0.07, 0]), [0.5, 0.05, 0.03]);
  put(bt, lathe([[0.008, 0], [0.022, -0.02], [0.03, -0.14], [0.0, -0.14]], 8), mats.paint, at([0, y0 - 0.075, 0]), [0.55, 0.06, 0.03]);
  // for the destructibles: the paper's ranges (it dims when the lantern dies), all of it, its centre and size
  return { paper, all: sinceMark(bt, all), center: new THREE.Vector3(0, y0 + h / 2, 0).applyMatrix4(m).toArray(), r, h };
}

/** a string of bulbs on a sagging cable from a to c: n intervals; tint names -> colour */
export function bulbString(P, bt, geom, a, c, sag, n, colors, { r = 0.012 } = {}) {
  const { mats, put } = P, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t]); }
  put(bt, geom.taperedTube(pts, pts.map(() => r), { radial: 4, segments: n * 2 }), mats.paint, null, [0.015, 0.015, 0.015]);
  const sock = once('sock', () => new THREE.CylinderGeometry(0.011, 0.013, 0.035, 6));
  const glass = once('bulb', () => lathe([[0.0, -0.06], [0.012, -0.058], [0.024, -0.045], [0.028, -0.03], [0.022, -0.012], [0.01, -0.002], [0.009, 0]], 6));
  const fil = once('fil', () => new THREE.BoxGeometry(0.012, 0.004, 0.004));
  const bulbs = [];   // for the destructibles: each bulb's glass and filament (one range of the glow material)
  for (let i = 1; i < n; i++) {
    const p = pts[i], col = colors[i % colors.length];
    put(bt, sock, mats.paint, geom.compose([p[0], p[1] - 0.025, p[2]]), [0.03, 0.03, 0.032]);
    const lit = track(bt, () => { put(bt, glass, mats.glow, geom.compose([p[0], p[1] - 0.04, p[2]]), col.map((v) => v * 1.4)); put(bt, fil, mats.glow, geom.compose([p[0], p[1] - 0.075, p[2]]), col.map((v) => v * 9)); });
    bulbs.push({ pos: [p[0], p[1] - 0.07, p[2]], lit });
  }
  return Object.assign(pts, { bulbs });
}

/** A street lamp: base with bolts and a cable door, a tapered post with collars, a curved arm, a head (housing, fins,
 *  visor, a recessed lens) at `reach` metres along `dir` ([dx, dz]) and height H over the foot at [x, y, z]. */
export function streetLamp(P, bt, geom, [x, y, z], H, dir, reach = 1.45) {
  const { mats, put, R } = P, paint = [0.05, 0.055, 0.06];
  const yaw = Math.atan2(dir[0], dir[1]), m = geom.compose([x, y, z], [0, yaw, 0]), at = (p, r = [0, 0, 0], s = 1) => m.clone().multiply(geom.compose(p, r, s));
  put(bt, lathe([[0.2, 0], [0.2, 0.06], [0.17, 0.09], [0.15, 0.42], [0.12, 0.5], [0.105, 0.52]], 16), mats.metal, at([0, 0, 0]), paint);   // the base
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; put(bt, new THREE.CylinderGeometry(0.014, 0.014, 0.025, 6), mats.metal, at([Math.cos(a) * 0.17, 0.07, Math.sin(a) * 0.17]), [0.35, 0.33, 0.3]); }
  put(bt, new geom.RoundedBoxGeometry(0.1, 0.2, 0.02, 1, 0.006), mats.metal, at([0, 0.28, 0.152], [0.08, 0, 0]), [0.08, 0.085, 0.09]);   // the cable door
  put(bt, new THREE.CylinderGeometry(0.006, 0.006, 0.01, 6).rotateX(Math.PI / 2), mats.metal, at([0, 0.35, 0.166]), [0.4, 0.4, 0.4]);
  put(bt, lathe([[0.11, 0], [0.07, H - 0.3], [0.068, H]], 12), mats.metal, at([0, 0.5, 0]), paint);   // the post
  for (const t of [1.8, 3.4, H - 0.1]) put(bt, new THREE.CylinderGeometry(0.095, 0.095, 0.05, 12), mats.metal, at([0, t, 0]), [0.06, 0.06, 0.065]);
  // the arm: up, over, a little down to the head; a bracket plate at the post
  const arm = [[0, H - 0.6, 0], [0, H - 0.1, 0.12], [0, H + 0.08, 0.6], [0, H + 0.02, reach - 0.4]];
  put(bt, geom.taperedTube(arm, [0.05, 0.045, 0.04, 0.035], { radial: 8, segments: 12 }), mats.metal, m, paint);
  put(bt, new geom.RoundedBoxGeometry(0.16, 0.3, 0.04, 1, 0.01), mats.metal, at([0, H - 0.45, 0.07]), [0.06, 0.06, 0.07]);
  // the head: a shaped housing (wider at the back), fins on top, a visor, the lens set into its underside
  const hm = (p, r = [0, 0, 0]) => at([0, H, reach - 0.05].map((v, i) => v + p[i]), r);
  const sh = new THREE.Shape([[-0.13, -0.42], [0.13, -0.42], [0.18, 0.25], [0.12, 0.42], [-0.12, 0.42], [-0.18, 0.25]].map(([a, b]) => new THREE.Vector2(a, b)));
  const housing = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 }).rotateX(Math.PI / 2);
  put(bt, housing, mats.metal, hm([0, 0.04, 0]), [0.07, 0.075, 0.08]);
  for (let i = 0; i < 7; i++) put(bt, new THREE.BoxGeometry(0.22, 0.04, 0.008), mats.metal, hm([0, 0.065, -0.3 + i * 0.09]), [0.12, 0.12, 0.13]);   // fins
  put(bt, new THREE.BoxGeometry(0.4, 0.008, 0.06), mats.metal, hm([0, -0.035, 0.42], [0.3, 0, 0]), [0.06, 0.06, 0.06]);                              // the visor lip
  put(bt, new THREE.BoxGeometry(0.2, 0.012, 0.6), mats.paint, hm([0, -0.043, 0]), [0.02, 0.02, 0.02]);                                              // the lens bezel
  const lens = track(bt, () => put(bt, new THREE.PlaneGeometry(0.16, 0.54).rotateX(Math.PI / 2), mats.glow, hm([0, -0.05, 0]), [7, 6.3, 5.7], R.lens));   // the lens
  // for the destructibles: the lens's range and the head's box (centre, half sizes, yaw)
  return { lens, head: { center: new THREE.Vector3(0, H - 0.02, reach - 0.05).applyMatrix4(m).toArray(), half: [0.17, 0.06, 0.42], yaw } };
}

/** a caged bulkhead light on a wall, at matrix m (facing +z): an oval base, a glass dome, three cage bars */
export function bulkhead(P, bt, geom, m, color = [1, 0.8, 0.55], k = 3) {
  const { mats, put } = P, at = (p, r = [0, 0, 0], s = 1) => m.clone().multiply(geom.compose(p, r, s));
  put(bt, new THREE.CylinderGeometry(0.11, 0.12, 0.04, 16).rotateX(Math.PI / 2), mats.metal, at([0, 0, 0.02], [0, 0, 0], [1, 1.35, 1]), [0.06, 0.065, 0.07]);
  put(bt, new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), mats.glow, at([0, 0, 0.04], [0, 0, 0], [1, 1.35, 1]), color.map((v) => v * k));
  for (const a of [0, Math.PI / 3, -Math.PI / 3]) put(bt, new THREE.TorusGeometry(0.085, 0.006, 4, 12, Math.PI).rotateY(Math.PI / 2), mats.metal, at([0, 0, 0.04], [0, 0, a + Math.PI / 2], [1, 1.35, 1]), [0.05, 0.05, 0.055]);
  put(bt, new THREE.TorusGeometry(0.085, 0.008, 4, 16), mats.metal, at([0, 0, 0.045], [0, 0, 0], [1, 1.35, 1]), [0.05, 0.05, 0.055]);
}

/** a tube fixture len long along x at matrix m, hung `drop` below its anchors (0: flat on the surface) */
export function tubeFixture(P, bt, geom, m, len, color = [1, 1, 1], k = 4, drop = 0) {
  const { mats, put } = P, at = (p, r = [0, 0, 0]) => m.clone().multiply(geom.compose(p, r));
  put(bt, new geom.RoundedBoxGeometry(len, 0.05, 0.11, 1, 0.012), mats.metal, at([0, 0, 0]), [0.12, 0.12, 0.13]);           // the channel
  const tube = track(bt, () => put(bt, new THREE.CylinderGeometry(0.03, 0.03, len - 0.08, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI), mats.glow, at([0, -0.026, 0]), color.map((v) => v * k)));   // the diffuser
  for (const s of [-1, 1]) put(bt, new THREE.CylinderGeometry(0.034, 0.034, 0.03, 10).rotateZ(Math.PI / 2), mats.paint, at([s * (len / 2 - 0.03), -0.022, 0]), [0.8, 0.8, 0.78]);   // end caps
  if (drop > 0) for (const s of [-1, 1]) put(bt, new THREE.CylinderGeometry(0.003, 0.003, drop, 4), mats.metal, at([s * len * 0.35, drop / 2 + 0.025, 0]), [0.3, 0.3, 0.3]);
  // for the destructibles: the diffuser's range (dimmed when the tube dies) and the fixture's box
  return { tube, box: { center: new THREE.Vector3(0, -0.015, 0).applyMatrix4(m).toArray(), half: [len / 2, 0.045, 0.06], quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m)).toArray() } };
}

/** a floodlight on a yoke, at matrix m (light out along +z, tilted down by `tilt`) */
export function floodlight(P, bt, geom, m, color = [1, 0.62, 0.25], k = 6, tilt = 0.5) {
  const { mats, put, R } = P, at = (p, r = [0, 0, 0]) => m.clone().multiply(geom.compose(p, r));
  put(bt, new THREE.TorusGeometry(0.17, 0.012, 4, 12, Math.PI).rotateZ(Math.PI), mats.metal, at([0, 0, 0]), IRON);
  const hm = (p, r = [0, 0, 0]) => at([0, 0, 0]).multiply(geom.compose([0, 0, 0], [tilt, 0, 0])).multiply(geom.compose(p, r));
  put(bt, new geom.RoundedBoxGeometry(0.3, 0.24, 0.12, 1, 0.02), mats.metal, hm([0, 0, 0]), [0.08, 0.08, 0.09]);
  for (let i = 0; i < 6; i++) put(bt, new THREE.BoxGeometry(0.008, 0.2, 0.06), mats.metal, hm([-0.12 + i * 0.048, 0, -0.08]), [0.1, 0.1, 0.11]);
  put(bt, new THREE.PlaneGeometry(0.24, 0.18), mats.glow, hm([0, 0, 0.062]), color.map((v) => v * k), R.lens);
  put(bt, new THREE.BoxGeometry(0.3, 0.012, 0.08), mats.metal, hm([0, 0.125, 0.09], [-0.25, 0, 0]), [0.06, 0.06, 0.06]);
}

/** a rotating beacon on a base (dome of red lens over a reflector), at the base's centre */
export function beacon(P, bt, geom, pos, color = [1, 0.1, 0.05], k = 4, r = 0.07) {
  const { mats, put } = P;
  put(bt, new THREE.CylinderGeometry(r * 1.2, r * 1.3, r * 0.6, 14), mats.metal, geom.compose([pos[0], pos[1] + r * 0.3, pos[2]]), [0.06, 0.06, 0.065]);
  put(bt, lathe([[r, 0], [r, r * 1.2], [r * 0.85, r * 1.7], [r * 0.4, r * 2.0], [0, r * 2.05]], 14), mats.glow, geom.compose([pos[0], pos[1] + r * 0.6, pos[2]]), color.map((v) => v * k));
  for (let i = 0; i < 4; i++) put(bt, new THREE.BoxGeometry(0.006, r * 1.9, 0.006), mats.metal, geom.compose([pos[0] + Math.cos(i * 1.57) * r * 1.05, pos[1] + r * 1.5, pos[2] + Math.sin(i * 1.57) * r * 1.05]), IRON);
}

/** a traffic signal head at matrix m (facing +z): three lenses under hoods; on: which one is lit (0 top) */
export function signalHead(P, bt, geom, m, colors, on = 0) {
  const { mats, put } = P, at = (p, r = [0, 0, 0]) => m.clone().multiply(geom.compose(p, r));
  put(bt, new geom.RoundedBoxGeometry(0.34, 0.95, 0.24, 1, 0.04), mats.metal, at([0, 0, 0]), [0.03, 0.032, 0.035]);
  put(bt, new THREE.BoxGeometry(0.5, 1.1, 0.02), mats.paint, at([0, 0, -0.13]), [0.02, 0.02, 0.022]);   // the back plate
  colors.forEach((c, i) => {
    const y = 0.3 - i * 0.3;
    put(bt, new THREE.CylinderGeometry(0.1, 0.1, 0.18, 14, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI), mats.metal, at([0, y, 0.2]), [0.03, 0.03, 0.035]);   // the hood
    put(bt, lathe([[0.085, 0], [0.08, 0.012], [0.05, 0.024], [0, 0.028]], 14).rotateX(Math.PI / 2), mats.glow, at([0, y, 0.122]), c.map((v) => v * (i === on ? 6 : 0.25)));
  });
}
