// cars: the three parked cars of plan.cars, as the scene's material showcase (built by street.js, not a module).
// Three designs of an invented marque, KESTREL MOTOR WORKS (no real badges or names), proportioned from real
// vehicles of their kind and scaled to the old cars' footprint (4.7 x 1.9 m):
//  - 0 the KMW "Slab": an angular electric pickup of flat brushed-steel planes meeting at hard creases, a wedge
//    roofline over a sloped bed cover, all-terrain tyres on flat aero covers; one thin red light bar across the
//    tailgate's top edge in a recessed black channel (brighter at its ends), red reflectors low in the bumper, a thin
//    white bar across the nose between two slim headlamps;
//  - 1 the KMW "Vane": a low wedge coupe, cab-forward canopy, very low nose, fender humps over big wheels, a long
//    tapering tail, thin light blades, aero channels in its flanks, a diffuser; pearlescent paint under clearcoat;
//    large rims with fine spokes, thin sidewalls, the brake disc and caliper behind them;
//  - 2 the KMW "Pod": a boxy autonomous cab, big glass, small enclosed wheels, a lidar dome and camera pods.
// Bodies: the upper body is lofted from cross sections (real creases where a ring has corners); the lower body is
// the car's side silhouette extruded across its width with real wheel arches cut out of it, a dark liner in each
// well; the wheels sit in their arches with clearance, track and wheelbase symmetric, the tyres' contact patch
// flattened on the ground, the front wheels turned a few degrees. Glass is flush with the body, a dotted black frit
// band round each pane. Shut lines, camera pods, a charge port, number plates, lamps with a chrome reflector behind a
// clear lens, under-glow (lit only at night), drops falling from the sills while it is wet.
// Materials are the surface library's (brushed stainless with the grain along each panel, pearl / metallic car paint
// with clearcoat, tinted glass, textured plastic, tyre rubber, machined aluminium, chrome, cast iron, vinyl), all with
// rain (rain-beads.js: beads that run at night, dry to water spots by day) and the wet film.
// The game reads only the anchors (pos, rotY) and the car's volume: each keeps the old car's collision boxes and lamps.
import * as THREE from 'three';
import { withWet, SURFACES, WET } from '@miragekit/core';
import { lamp } from './lib.js';
import { rainBeads } from './rain-beads.js';
import { surfaceLib } from './robot-kit.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;
// ---------------------------------------------------------------------------------------------------------------
// loft: stations [{ x, p: [[y, z], ...] }] (half rings, z >= 0, from the top centre outward and down); the part
// between ring points i0..i1 and stations s0..s1, both halves; flat (faceted) or smooth normals; uv in metres
// (u along the car, v round the section: the brushed grain runs along each panel)
function loft(st, i0, i1, s0, s1, smooth = false) {
  const half = (sgn) => {
    const pos = [], uv = [], idx = [], cols = i1 - i0 + 1;
    for (let s = s0; s <= s1; s++) {
      let arc = 0;
      for (let i = i0; i <= i1; i++) {
        const [y, z] = st[s].p[i];
        if (i > i0) { const [py, pz] = st[s].p[i - 1]; arc += Math.hypot(y - py, z - pz); }
        pos.push(st[s].x, y, z * sgn); uv.push(-st[s].x, arc);
      }
    }
    for (let s = 0; s < s1 - s0; s++) for (let i = 0; i < cols - 1; i++) {
      const a = s * cols + i, b = a + 1, c = a + cols, d = c + 1;
      if (sgn > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const out = smooth ? g : g.toNonIndexed();
    out.computeVertexNormals();
    return out.index ? out.toNonIndexed() : out;
  };
  return [half(1), half(-1)];
}
/** a cap closing station s (the nose or the tail): a fan over its full ring, facing `dir` (+1 front) */
function cap(st, s, dir) {
  const half = st[s].p.map(([y, z]) => [y, z]), ring = [...half.slice().reverse(), ...half.slice(1).map(([y, z]) => [y, -z]), half.at(-1)];   // closed along the bottom
  const cy = ring.reduce((a, [y]) => a + y, 0) / ring.length, x = st[s].x, pos = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const A = [x, cy, 0], B = [x, ring[i][0], ring[i][1]], C = [x, ring[i + 1][0], ring[i + 1][1]];
    const n = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
    pos.push(...A, ...(n * dir > 0 ? [...B, ...C] : [...C, ...B]));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const uv = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i + 2], pos[i + 1]);   // the grain across the tail
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
const ST = (list) => list.map(([x, p]) => ({ x, p }));
const v2 = (pts) => pts.map(([a, b]) => new THREE.Vector2(a, b));

// ---- the three designs: the upper body's stations (each ring's last point is where the lower body meets it), the
// glass bands [i0, i1, s0, s1], the lower body (clearance, half width), the wheels, the lights
const DESIGNS = [
  { // the Slab: ~5.7 x 2.0 x 1.8 m in life; here 4.7 x 1.9 x 1.56
    name: 'slab', flat: true, clear: 0.26, hw: 0.95, nose: 2.35, tail: -2.35,
    // reference (in life / here at 0.81): L 5.8 / 4.7, W 2.0 / 1.9 (the footprint), H 1.8 / 1.48, wheelbase 3.81 / 3.12,
    // tyre 0.88 / 0.72, the window's lower edge 1.27 / 1.04, steel down to 0.55 / 0.45 over black arch lips and sills
    st: ST([[2.35, [[0.96, 0], [0.96, 0.8], [0.93, 0.9], [0.84, 0.93]]], [2.28, [[1.0, 0], [1.0, 0.86], [0.96, 0.95], [0.84, 0.95]]],
      [1.02, [[1.13, 0], [1.13, 0.84], [1.05, 0.95], [0.84, 0.95]]], [-0.2, [[1.48, 0], [1.48, 0.6], [1.06, 0.95], [0.84, 0.95]]],
      [-0.9, [[1.37, 0], [1.37, 0.66], [1.06, 0.95], [0.84, 0.95]]], [-2.28, [[1.13, 0], [1.13, 0.86], [1.06, 0.95], [0.84, 0.95]]],
      [-2.35, [[1.09, 0], [1.09, 0.82], [1.04, 0.9], [0.84, 0.93]]]]),
    glass: [[0, 1, 2, 4], [1, 2, 2, 4]],
    wheel: { r: 0.36, w: 0.29, rim: 0.23, axle: 1.56, kind: 'aero', tread: 'at' }, interior: { dash: 0.98, seats: [[0.05, 0.95], [-0.55, 0.95]], floor: 0.46, wheel: true, seatY: 0.08, recline: 0.22 },
  },
  { // the Vane: ~4.5 x 1.95 x 1.15 m in life
    name: 'vane', flat: false, clear: 0.12, hw: 0.97, nose: 2.3, tail: -2.3,
    st: ST([[2.3, [[0.5, 0], [0.5, 0.6], [0.47, 0.84], [0.42, 0.88]]], [2.15, [[0.56, 0], [0.56, 0.7], [0.53, 0.9], [0.46, 0.94]]],
      [1.75, [[0.64, 0], [0.64, 0.55], [0.78, 0.86], [0.78, 0.96]]], [1.1, [[0.72, 0], [0.72, 0.5], [0.79, 0.84], [0.76, 0.97]]],
      [0.55, [[0.98, 0], [0.97, 0.46], [0.86, 0.76], [0.7, 0.97]]], [-0.1, [[1.12, 0], [1.11, 0.42], [0.96, 0.72], [0.7, 0.97]]],
      [-0.8, [[1.05, 0], [1.04, 0.42], [0.93, 0.76], [0.72, 0.98]]], [-1.45, [[0.9, 0], [0.9, 0.5], [0.87, 0.84], [0.78, 0.98]]],
      [-2.0, [[0.84, 0], [0.84, 0.62], [0.82, 0.86], [0.72, 0.9]]], [-2.3, [[0.78, 0], [0.78, 0.55], [0.76, 0.78], [0.66, 0.8]]]]),
    glass: [[0, 2, 4, 6]],
    wheel: { r: 0.345, w: 0.29, rim: 0.265, axle: 1.43, kind: 'spokes', tread: 'sport' }, interior: { dash: 0.5, seats: [[-0.42, 0.62]], floor: 0.24, wheel: true, recline: 0.55 },
  },
  { // the Pod: ~4.2 x 1.9 x 1.9 m in life
    name: 'pod', flat: false, clear: 0.17, hw: 0.93, nose: 2.2, tail: -2.2,
    st: ST([[2.2, [[0.92, 0], [0.92, 0.72], [0.88, 0.86], [0.72, 0.9]]], [2.12, [[0.98, 0], [0.98, 0.8], [0.93, 0.92], [0.72, 0.93]]],
      [1.6, [[1.1, 0], [1.1, 0.82], [1.0, 0.93], [0.72, 0.93]]], [1.15, [[1.82, 0], [1.82, 0.74], [1.06, 0.93], [0.72, 0.93]]],
      [-1.7, [[1.86, 0], [1.86, 0.74], [1.06, 0.93], [0.72, 0.93]]], [-2.12, [[1.6, 0], [1.6, 0.76], [1.04, 0.93], [0.72, 0.93]]],
      [-2.2, [[1.52, 0], [1.52, 0.72], [1.0, 0.88], [0.72, 0.9]]]]),
    glass: [[0, 1, 2, 3], [1, 2, 3, 5], [0, 1, 4, 5]],
    wheel: { r: 0.3, w: 0.22, rim: 0.2, axle: 1.5, kind: 'cover', tread: 'eco' }, interior: { dash: 1.05, seats: [[0.1, 0.95], [-1.0, 0.95]], floor: 0.42, wheel: false, screen: true },
  },
];
const GLOW = [[0.1, 0.85, 1.0], [1.0, 0.16, 0.5], [1.0, 0.6, 0.2]];

// ---------------------------------------------------------------------------------------------------------------
function carMaterials(ctx) {
  if (ctx.shared.carMats) return ctx.shared.carMats;
  const { mat } = ctx, lib = surfaceLib(ctx);
  const H = (spec, o = {}) => lib.hooks(spec, { space: 'object', ...o });
  const wet = (h, o = {}) => withWet(h, { porosity: 0, puddles: 0, band: 0.1, ...o });
  // brushed stainless: the grain along each panel's uv (u along the car), anisotropic highlights; rain on top
  const steel = mat.phys({ vertexColors: true, metalness: 1, roughness: 1, anisotropy: 0.6, anisotropyRotation: 0 }, wet(rainBeads(H(SURFACES.stainless({ variant: 'brushed', roughness: 0.28, grain: 0.45, scratches: 0.25 }), { mapping: 'uv', space: 'world' }), { scale: 1, density: 0.55, run: 0.6 })));
  const paint = (variant, color) => mat.phys({ metalness: 1, roughness: 1, ...SURFACES.carPaint({ variant, color }).material }, wet(rainBeads(H(SURFACES.carPaint({ variant, color, flakes: 0.4 }), { space: 'world' }), { scale: 1, density: 0.7, run: 0.45 })));
  const glassH = rainBeads(H(SURFACES.glass({ variant: 'tinted', color: [0.12, 0.15, 0.16], opacity: 0.62, dirt: 0.08 }), { space: 'world' }), { scale: 0.9, density: 0.75, run: 0.7, film: 0 });
  const glass = mat.std({ transparent: true, premultipliedAlpha: true, depthWrite: false, metalness: 1, roughness: 1 }, glassH);
  const lens = mat.std({ transparent: true, premultipliedAlpha: true, depthWrite: false, metalness: 1, roughness: 1 }, H(SURFACES.glass({ variant: 'clear', opacity: 0.05, dirt: 0.04 })));
  const std = (spec, o = {}, base = {}) => mat.std({ vertexColors: true, metalness: 1, roughness: 1, ...base }, wet(H(spec, o)));
  const M = {
    steel, glass, lens,
    pearl: paint('pearl', [0.06, 0.32, 0.38]), amber: paint('metallic', [0.62, 0.28, 0.06]),
    trim: std(SURFACES.plastic({ variant: 'textured', color: [0.6, 0.6, 0.6], roughness: 0.6 })),       // cladding, channels, wells (by vertex colour)
    tyre: std(SURFACES.rubber({ variant: 'tread', pitch: 0.032, groove: 0.007 }), { mapping: 'uv' }),
    alloy: std(SURFACES.metal({ metal: 'aluminium', variant: 'machined', roughness: 0.22 })),           // rims, spokes (tinted by vertex colour)
    iron: std(SURFACES.castIron({ variant: 'plain', rust: 0.25 })),                                     // brake discs
    chrome: std(SURFACES.chrome({ variant: 'new' })),                                                   // the lamps' reflectors, trims
    vinyl: mat.std({ vertexColors: true, metalness: 1, roughness: 1 }, H(SURFACES.leather({ variant: 'vinyl', color: [0.6, 0.6, 0.6] }))),   // seats (no rain inside)
    glow: mat.glow([1, 1, 1], 1, { vertexColors: true }),
    // under-glow: lit only while the lamps are (night), not by day
    under: mat.patch(new THREE.MeshBasicMaterial({ vertexColors: true }), { output: 'outgoingLight *= clamp(uLampGain - 0.15, 0.0, 1.0);' }),
    frit: mat.std({ map: fritTexture(), alphaTest: 0.5, color: 0x050505, roughness: 0.25, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
    drops: dropMaterial(mat),
  };
  return (ctx.shared.carMats = M);
}
/** the frit: a black band at the pane's edge breaking into dots that shrink inward (v: 0 at the edge .. 1 inside) */
function fritTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); g.clearRect(0, 0, 64, 64); g.fillStyle = '#fff';
  g.fillRect(0, 64 - 26, 64, 26);
  for (let row = 0; row < 6; row++) for (let i = 0; i < 8; i++) {
    const r = 3.6 * (1 - row / 6.5), y = 64 - 30 - row * 5.6, x = i * 8 + 4 + (row % 2) * 4;
    if (r > 0.4) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
/** drops falling from the sills and bumpers while it is wet: each a tiny bead (uv.x its phase, uv.y its rate) that
 *  swells under the edge, then falls 0.2-0.3 m to the road; underground when the street is dry */
function dropMaterial(mat) {
  return mat.std({ color: new THREE.Color(0.02, 0.022, 0.025), roughness: 0.02, metalness: 0 }, {
    uniforms: { ndDropWet: WET.uWet }, vertexDecl: 'uniform float ndDropWet;',
    vertexWorld: `{ float k = fract(uTime * (0.35 + 0.5 * uv.y) + uv.x * 7.31);
      float fall = k < 0.72 ? 0.0 : (k - 0.72) / 0.28;
      mgWorld.y -= fall * fall * 0.26 + (ndDropWet < 0.05 ? 50.0 : 0.0); }`,
  });
}

/** Build the cars into `pb` (the street's props batch: number plates) and their own batch; returns the anchors */
export function parkedCars(ctx, P, pb, list, proxyBox) {
  const { geom, root } = ctx, CM = carMaterials(ctx), { mats, put, R } = P;
  const cb = new geom.MeshBatch(), sb = new geom.MeshBatch();   // cb: the bodies (cast shadows); sb: small parts (none)
  const anchors = [];
  const col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  list.forEach(([x, z, rot], ci) => {
    const Dz = DESIGNS[ci % DESIGNS.length], m = geom.compose([x, 0, z], [0, rot, 0]), at = (p, r = [0, 0, 0], s = 1) => m.clone().multiply(geom.compose(p, r, s));
    const body = Dz.name === 'slab' ? CM.steel : Dz.name === 'vane' ? CM.pearl : CM.amber, st = Dz.st, last = st.length - 1, W = Dz.wheel;
    const add = (b, g, mt, mm, c = [1, 1, 1]) => b.add(col(g, c), mt, mm);
    const glassOf = (i0, s0) => Dz.glass.some(([g0, g1, a, b]) => i0 >= g0 && i0 < g1 && s0 >= a && s0 < b);
    // ---- the upper body: each facet band of the loft, steel / paint or glass; the steel's tone panel to panel
    const np = st[0].p.length;
    for (let i = 0; i < np - 1; i++) for (let s = 0; s < last; s++) {
      const gl = glassOf(i, s), tone = 0.95 + 0.08 * Math.abs(Math.sin(ci * 3.1 + i * 1.7 + s * 2.3));
      for (const g of loft(st, i, i + 1, s, s + 1, !Dz.flat)) add(cb, g, gl ? CM.glass : body, m, Dz.name === 'slab' ? [tone, tone, tone] : [1, 1, 1]);
    }
    for (const [s, d] of [[0, 1], [last, -1]]) add(cb, cap(st, s, d), body, m);
    // ---- the lower body: the side silhouette (the clearance up to each station's lowest ring point) extruded across
    // the width, the wheel arches cut out of it (the tyre's radius plus clearance), rounded where the bumpers turn
    const ax = W.axle, ra = W.r + (Dz.name === 'pod' ? 0.03 : 0.045), cy = W.r - 0.012;
    const top = st.map((s) => [s.x, s.p[np - 1][0]]);
    // an arch: from where its circle meets the clearance line on the tail side, over the wheel, down to the nose side
    const arch = (path, cx, r, from) => { const a = Math.asin(Math.min(1, (cy - Dz.clear) / r)), dx = r * Math.cos(a); if (from) path.lineTo(cx - dx, Dz.clear); path.absarc(cx, cy, r, Math.PI + a, -a, true); return dx; };
    const sh = new THREE.Shape();
    sh.moveTo(Dz.tail + 0.06, Dz.clear);
    arch(sh, -ax, ra, true); arch(sh, ax, ra, true);
    sh.lineTo(Dz.nose - 0.08, Dz.clear); sh.quadraticCurveTo(Dz.nose, Dz.clear, Dz.nose, Dz.clear + 0.1);
    for (const [px, py] of top) sh.lineTo(px, py);
    sh.quadraticCurveTo(Dz.tail, Dz.clear, Dz.tail + 0.06, Dz.clear);
    const lowerW = 2 * Dz.hw, bev = 0.045;
    const lower = new THREE.ExtrudeGeometry(sh, { depth: lowerW - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 3, curveSegments: 24 });
    lower.translate(0, 0, -(lowerW - 2 * bev) / 2);
    // the grain along the car; z folded into v so no face has a uv constant in one direction (the steel's anisotropy
    // builds its tangent frame from the uv's derivatives: a degenerate one gave NaN)
    { const p = lower.attributes.position, uv = lower.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, -p.getX(i) + 0.31 * p.getZ(i), p.getY(i) + 0.73 * p.getZ(i)); }
    if (Dz.name === 'slab') {   // the pickup: steel above, black cladding below a crease (the arches' lips and the sills)
      add(cb, lower, CM.steel, m, [0.98, 0.98, 0.98]);
      const ext = (shape, d = 0.03) => new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 20 });
      const lips = [-ax, ax].map((cx) => { const p = new THREE.Shape(), ao = Math.asin(Math.min(1, (cy - Dz.clear) / (ra + 0.075))), ai = Math.asin(Math.min(1, (cy - Dz.clear) / ra));
        p.absarc(cx, cy, ra + 0.075, Math.PI + ao, -ao, true); p.absarc(cx, cy, ra, -ai, Math.PI + ai, false); p.closePath(); return p; });
      const dxo = (ra + 0.075) * Math.cos(Math.asin(Math.min(1, (cy - Dz.clear) / (ra + 0.075))));
      const strip = (x0, x1) => { const p = new THREE.Shape(); p.moveTo(x0, Dz.clear - 0.004); p.lineTo(x1, Dz.clear - 0.004); p.lineTo(x1, Dz.clear + 0.13); p.lineTo(x0, Dz.clear + 0.13); p.closePath(); return p; };
      const parts = [...lips, strip(-ax + dxo - 0.01, ax - dxo + 0.01), strip(ax + dxo - 0.01, Dz.nose - 0.12), strip(Dz.tail + 0.1, -ax - dxo + 0.01)];
      for (const sz of [-1, 1]) for (const shp of parts) { const cg = ext(shp); cg.translate(0, 0, sz > 0 ? Dz.hw - 0.022 : -Dz.hw - 0.008); add(cb, cg, CM.trim, m, [0.05, 0.05, 0.055]); }
    } else add(cb, lower, body, m);
    // the wheel wells: a dark liner round each arch from the body side inward, closed by a panel
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const liner = new THREE.CylinderGeometry(ra - 0.005, ra - 0.005, 0.36, 28, 1, true).rotateX(HP).scale(-1, 1, 1).toNonIndexed(); liner.computeVertexNormals();
      add(cb, liner, CM.trim, at([sx * ax, cy, sz * (Dz.hw - 0.2)], [0, sz > 0 ? 0 : Math.PI, 0]), [0.02, 0.02, 0.022]);
      add(cb, new THREE.CircleGeometry(ra, 24, 0, Math.PI), CM.trim, at([sx * ax, cy, sz * (Dz.hw - 0.38)], [0, sz > 0 ? 0 : Math.PI, 0]), [0.015, 0.015, 0.017]);
    }
    // the underbody between the wheels (in the shadow)
    add(cb, new THREE.BoxGeometry(2 * ax - 2 * ra - 0.1, 0.04, 2 * Dz.hw - 0.3), CM.trim, at([0, Dz.clear + 0.02, 0]), [0.02, 0.02, 0.02]);
    // ---- glass: the frit, a dotted black band round each pane on its inside edge (flush, no seal tube)
    for (const [g0, g1, a, b] of Dz.glass) for (const sz of [1, -1]) {
      const P3 = (s, i) => new THREE.Vector3(st[s].x, st[s].p[i][0], st[s].p[i][1] * sz);
      const centre = new THREE.Vector3((st[a].x + st[b].x) / 2, 0.55, 0);
      // a strip from the edge A-B inward (toward `to`) 7.5 cm, its v 0 at the edge, 1 mm proud of the glass
      const seg = (A, B, to) => {
        const d = B.clone().sub(A), len = d.length(); if (len < 1e-4) return;
        const inw = to.clone().sub(A); inw.sub(d.clone().multiplyScalar(inw.dot(d) / (len * len))).normalize().multiplyScalar(0.075);
        const n = new THREE.Vector3().crossVectors(d, inw).normalize(); if (n.dot(A.clone().add(B).multiplyScalar(0.5).sub(centre)) < 0) n.negate();
        const o = n.clone().multiplyScalar(0.0015), q = [A.clone().add(o), B.clone().add(o), B.clone().add(inw).add(o), A.clone().add(inw).add(o)], u = len / 0.064;
        const tri = new THREE.Vector3().crossVectors(q[1].clone().sub(q[0]), q[2].clone().sub(q[0])).dot(n) > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        const UV = [[0, 0], [u, 0], [u, 1], [0, 1]], pos = [], uv = [];
        for (const k of tri) { pos.push(...q[k].toArray()); uv.push(...UV[k]); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
        add(sb, g, CM.frit, m);
      };
      // (a pane that starts on the centre line is one pane with its mirror: no band down the middle)
      for (let s = a; s < b; s++) { if (g0 > 0) seg(P3(s, g0), P3(s + 1, g0), P3(s, g1)); seg(P3(s, g1), P3(s + 1, g1), P3(s, g0)); }
      for (let i = g0; i < g1; i++) { seg(P3(a, i), P3(a, i + 1), P3(a + 1, i)); seg(P3(b, i), P3(b, i + 1), P3(b - 1, i)); }
    }
    // ---- wheels: tyre, rim / cover, the brake disc and caliper; centred in their arches, the fronts steered
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(CM, cb, sb, at([sx * ax, cy, sz * (Dz.hw - W.w / 2 - 0.035)], [0, (sz > 0 ? 0 : Math.PI) + (sx > 0 ? 0.11 : 0), 0]), W, ci, add);
    // ---- interior under the glass: the floor, a dash, the seats (cushion, reclined back, headrest), a wheel or screen
    interior(Dz, CM, sb, at, add);
    // ---- lights, trim and details by design
    details(Dz, ci, CM, cb, sb, at, add, st);
    // mirrors are cameras: a pod on a short stalk at each A pillar's foot
    const cowl = st.find((s) => s.x < (Dz.name === 'vane' ? 0.7 : Dz.name === 'pod' ? 1.3 : 1.1)) || st[2];
    for (const sz of [-1, 1]) {
      const y = cowl.p[np - 2][0] + 0.02, zz = sz * (cowl.p[np - 2][1] + 0.02);
      add(sb, new THREE.CylinderGeometry(0.011, 0.014, 0.1, 8).rotateX(HP), CM.trim, at([cowl.x + 0.05, y, zz + sz * 0.04]), [0.05, 0.05, 0.055]);
      add(sb, new THREE.CapsuleGeometry(0.03, 0.07, 4, 10).rotateZ(HP), body === CM.steel ? CM.steel : body, at([cowl.x + 0.03, y + 0.01, zz + sz * 0.1]));
      add(sb, new THREE.CircleGeometry(0.012, 12).rotateY(HP), CM.lens, at([cowl.x + 0.091, y + 0.01, zz + sz * 0.1]));
      add(sb, new THREE.CircleGeometry(0.014, 12).rotateY(HP), CM.trim, at([cowl.x + 0.09, y + 0.01, zz + sz * 0.1]), [0.01, 0.01, 0.012]);
    }
    // number plates (invented characters) front and rear
    const plateY = Dz.name === 'vane' ? [0.3, 0.46] : [0.42, 0.55];
    put(pb, new THREE.PlaneGeometry(0.42, 0.105).rotateY(HP), mats.paint, at([Dz.nose + 0.004, plateY[0], 0]), [1, 1, 1], R['plate' + (ci % 3)]);
    put(pb, new THREE.PlaneGeometry(0.42, 0.105).rotateY(-HP), mats.paint, at([Dz.tail - 0.004, plateY[1], 0]), [1, 1, 1], R['plate' + (ci % 3)]);
    // under-glow: a lit strip under each sill (night only), its light on the wet road
    for (const sz of [-1, 1]) add(sb, new THREE.BoxGeometry(2 * ax - 2 * ra - 0.3, 0.01, 0.02), CM.under, at([0, Dz.clear - 0.012, sz * (Dz.hw - 0.12)]), GLOW[ci].map((v) => v * 5));
    lamp(ctx, { pos: new THREE.Vector3(0, 0.2, 0).applyMatrix4(m).toArray(), color: new THREE.Color().setRGB(...GLOW[ci]), intensity: 1.6, range: 3.6 });
    // drops from the sills' and bumpers' lower edges (between the arches and at the ends), while it is wet
    let k = ci * 97;
    const hsh = () => { k = (k * 16807 + 11) % 2147483647; return k / 2147483647; };
    for (let i = 0; i < 46; i++) {
      const side = i % 3, u = hsh(), dx = side < 2 ? -ax + ra + 0.1 + u * (2 * ax - 2 * ra - 0.2) : (hsh() < 0.5 ? Dz.nose - 0.15 : Dz.tail + 0.15), dz = side < 2 ? (side ? 1 : -1) * (Dz.hw - 0.03) : (u - 0.5) * 2 * (Dz.hw - 0.25);
      const g = new THREE.SphereGeometry(0.0032, 5, 3).scale(1, 1.8, 1), uv = g.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setXY(j, hsh(), hsh());
      add(sb, g, CM.drops, at([dx, Dz.clear - 0.006, dz]));
    }
    // ---- the old car's volume (the walk grid, the cover), the anchors and the tail lamp as before
    proxyBox([4.68, 1.0, 1.9], at([0, 0.5, 0]), rot); proxyBox([2.9, 0.52, 1.64], at([-0.56, 1.14, 0]), rot);
    anchors.push({ pos: new THREE.Vector3(0, 1.6, 0).applyMatrix4(m).toArray(), rotY: rot });
    // (the tail lamp's glow: low behind the bumper, on the road rather than washing the tailgate)
    lamp(ctx, { pos: new THREE.Vector3(-2.75, 0.3, 0).applyMatrix4(m).toArray(), color: 0xff2010, intensity: 1.4, range: 4.5 });
  });
  const g = cb.finish({ name: 'cars', castShadow: true }), s = sb.finish({ name: 'cars-parts', castShadow: false });
  for (const o of [g, s]) o.traverse((x) => { x.userData.collide = false; });
  s.traverse((x) => { if (x.material === CM.drops) { x.frustumCulled = false; x.userData.occlude = false; } });
  root.add(g, s);
  return anchors;
}

// ---------------------------------------------------------------------------------------------------------------
/** a wheel at matrix m (its outer face toward +z): the tyre (tread and sidewall by its uv, grooves in its profile,
 *  the contact patch flattened), the rim or cover, the brake disc and caliper */
function wheel(CM, cb, sb, m, W, ci, add) {
  const at = (p, r = [0, 0, 0]) => m.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1)));
  const hw = W.w / 2, r = W.r, rr = W.rim, SEG = 48;
  // the tyre's half profile from the rim's bead round the shoulder over the tread (three grooves) and back
  const side = W.tread === 'at' ? 0.03 : 0.018, prof = [[rr, -hw + 0.02], [rr + 0.02, -hw + 0.004], [r - side - 0.03, -hw - 0.006], [r - side, -hw + 0.004], [r - 0.006, -hw + side * 0.8], [r, -hw + side * 1.4]];
  const grooves = W.tread === 'sport' ? [-0.05, 0.05] : [-0.07, 0, 0.07];
  let z0 = -hw + side * 1.4;
  for (const gz of grooves) { prof.push([r, gz - 0.008], [r - 0.009, gz - 0.006], [r - 0.009, gz + 0.006], [r, gz + 0.008]); z0 = gz + 0.008; }
  void z0;
  prof.push([r, hw - side * 1.4], [r - 0.006, hw - side * 0.8], [r - side, hw - 0.004], [r - side - 0.03, hw + 0.006], [rr + 0.02, hw - 0.004], [rr, hw - 0.02]);
  const tyre = new THREE.LatheGeometry(v2(prof.map(([a, b]) => [a, b])), SEG);
  { // uv in metres (u round the tread, v across), the contact patch flattened, the axis along z
    const p = tyre.attributes.position, uv = tyre.attributes.uv, circ = TAU * r;
    for (let i = 0; i < p.count; i++) { uv.setXY(i, uv.getX(i) * circ, p.getY(i)); }
    tyre.rotateX(HP);
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -(r - 0.012)) p.setY(i, -(r - 0.012));
    tyre.computeVertexNormals();
  }
  add(cb, tyre, CM.tyre, m, [1, 1, 1]);
  // a raised sidewall band of lettering (a ring), the bead seat
  add(sb, new THREE.TorusGeometry((rr + r) / 2 + 0.01, 0.0035, 3, SEG), CM.tyre, at([0, 0, hw + 0.004]), [1.4, 1.4, 1.4]);
  // the brake: a disc (cast iron, cross-drilled look from its rings) and a caliper over its top rear
  const disc = rr * 0.82;
  add(sb, new THREE.CylinderGeometry(disc, disc, 0.026, 40, 1).rotateX(HP), CM.iron, at([0, 0, -0.03]));
  add(sb, new THREE.CylinderGeometry(disc * 0.42, disc * 0.42, 0.05, 20).rotateX(HP), CM.alloy, at([0, 0, -0.01]), [0.35, 0.35, 0.36]);
  const cal = new THREE.Shape(); cal.absarc(0, 0, disc + 0.02, 0.5, 1.6, false); cal.absarc(0, 0, disc - 0.055, 1.6, 0.5, true);
  add(sb, new THREE.ExtrudeGeometry(cal, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 8 }).translate(0, 0, -0.065), CM.trim, at([0, 0, 0], [0, 0, 0.6]), [[0.6, 0.45, 0.04], [0.55, 0.02, 0.02], [0.04, 0.2, 0.5]][ci % 3]);
  // the rim: a barrel, then the face by kind
  add(cb, new THREE.CylinderGeometry(rr, rr, W.w - 0.04, SEG, 1, true).rotateX(HP), CM.alloy, m, [0.45, 0.45, 0.47]);
  const face = hw - 0.012;
  if (W.kind === 'spokes') {   // fine spokes: fourteen thin twisted pairs from a hub to the lip
    add(cb, new THREE.TorusGeometry(rr - 0.006, 0.01, 6, SEG), CM.alloy, at([0, 0, face - 0.004]), [0.9, 0.9, 0.92]);
    add(cb, new THREE.LatheGeometry(v2([[0, face + 0.012], [0.05, face + 0.01], [0.062, face - 0.002], [0.07, face - 0.02]].map(([a, b]) => [a, b])), 24).rotateX(HP), CM.alloy, m, [0.85, 0.85, 0.87]);
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU, len = rr - 0.075;
      const sp = new THREE.CylinderGeometry(0.006, 0.011, len, 5).rotateZ(-HP).translate(0.065 + len / 2, 0, 0);
      add(cb, sp, CM.alloy, at([0, 0, face - 0.012 - 0.012 * (i % 2)], [0, (i % 2 ? 0.12 : -0.12), a]), [0.88, 0.88, 0.9]);
    }
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; add(sb, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6).rotateX(HP), CM.chrome, at([Math.cos(a) * 0.035, Math.sin(a) * 0.035, face + 0.014])); }
  } else if (W.kind === 'aero') {   // a flat aero cover, five shallow segments and a centre cap
    add(cb, new THREE.LatheGeometry(v2([[0, face + 0.006], [rr * 0.32, face + 0.005], [rr * 0.95, face - 0.004], [rr, face - 0.014]]), SEG).rotateX(HP), CM.trim, m, [0.22, 0.22, 0.23]);
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.3; add(sb, new THREE.BoxGeometry(rr * 0.55, 0.006, 0.004), CM.trim, at([Math.cos(a) * rr * 0.62, Math.sin(a) * rr * 0.62, face + 0.002], [0, 0, a]), [0.03, 0.03, 0.03]); }
    add(sb, new THREE.CircleGeometry(0.045, 20), CM.alloy, at([0, 0, face + 0.0075]), [0.7, 0.7, 0.72]);
  } else {   // the cab: a flush cover
    add(cb, new THREE.LatheGeometry(v2([[0, face + 0.004], [rr * 0.6, face + 0.003], [rr, face - 0.008]]), SEG).rotateX(HP), CM.trim, m, [0.55, 0.55, 0.56]);
    add(sb, new THREE.TorusGeometry(rr * 0.6, 0.004, 3, SEG), CM.trim, at([0, 0, face + 0.004]), [0.04, 0.04, 0.045]);
  }
}

/** the cabin: the floor, the dash, the seats (a cushion, a reclined back, a headrest), the wheel or a screen */
function interior(Dz, CM, sb, at, add) {
  const I = Dz.interior, dark = [0.05, 0.05, 0.055], seatC = [0.07, 0.065, 0.06];
  add(sb, new THREE.BoxGeometry(Dz.name === 'pod' ? 3.0 : 2.2, 0.02, 2 * Dz.hw - 0.2), CM.trim, at([Dz.name === 'pod' ? -0.3 : -0.3, I.floor, 0]), [0.03, 0.03, 0.032]);
  const dash = new THREE.Shape(v2([[0.0, 0.0], [0.28, 0.0], [0.3, 0.12], [0.1, 0.18], [-0.05, 0.14]]));
  add(sb, new THREE.ExtrudeGeometry(dash, { depth: 2 * Dz.hw - 0.36, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }).rotateY(0).translate(0, 0, -(2 * Dz.hw - 0.36) / 2), CM.trim, at([I.dash - 0.25, I.floor + (Dz.name === 'vane' ? 0.14 : 0.32), 0]), dark);
  const recline = I.recline ?? 0.3;
  for (const [sx, ] of I.seats) for (const sz of [-0.4, 0.4]) {
    const y = I.floor + (I.seatY ?? (Dz.name === 'vane' ? 0.06 : 0.22));
    add(sb, new THREE.CapsuleGeometry(0.06, 0.36, 4, 10).rotateZ(HP).scale(1, 0.9, 3.6), CM.vinyl, at([sx, y + 0.06, sz]), seatC);
    const back = new THREE.CapsuleGeometry(0.055, 0.42, 4, 10).scale(1, 1, 3.4);
    add(sb, back, CM.vinyl, at([sx - 0.2 - Math.sin(recline) * 0.22, y + 0.12 + Math.cos(recline) * 0.24, sz], [0, 0, recline]), seatC);
    add(sb, new THREE.CapsuleGeometry(0.045, 0.08, 4, 10).scale(1, 1, 2.8), CM.vinyl, at([sx - 0.2 - Math.sin(recline) * 0.52, y + 0.12 + Math.cos(recline) * 0.54, sz], [0, 0, recline]), seatC);
  }
  if (I.wheel) {
    const sz = Dz.name === 'vane' ? 0.4 : 0.4, wx = I.seats[0][0] + 0.48, wy = I.floor + (Dz.name === 'vane' ? 0.36 : 0.62);
    add(sb, new THREE.TorusGeometry(0.17, 0.016, 6, 28).rotateY(HP).rotateZ(0.45), CM.vinyl, at([wx, wy, sz]), dark);
    add(sb, new THREE.CylinderGeometry(0.025, 0.03, 0.26, 8).rotateZ(HP), CM.trim, at([wx + 0.12, wy - 0.04, sz], [0, 0, -0.45]), dark);
  }
  if (I.screen) add(sb, new THREE.PlaneGeometry(0.9, 0.28).rotateY(-HP), CM.glow, at([I.dash - 0.27, I.floor + 0.62, 0], [0, 0, 0.3]), [0.25, 0.6, 0.8]);
}

/** lights and details by design */
function details(Dz, ci, CM, cb, sb, at, add, st) {
  const hw = Dz.hw, np = st[0].p.length;
  // a lamp: a black housing, a chrome reflector bowl behind a clear lens, the lit element (light: intensity colour)
  const unit = (x, y, z, w, h, dir, light) => {
    add(sb, new THREE.BoxGeometry(0.02, h + 0.016, w + 0.016), CM.trim, at([x - dir * 0.012, y, z]), [0.02, 0.02, 0.022]);
    add(sb, new THREE.CylinderGeometry(h * 0.5, h * 0.2, 0.012, 16, 1, true).rotateZ(dir * HP).scale(1, 1, w / h), CM.chrome, at([x - dir * 0.004, y, z]));
    add(sb, new THREE.PlaneGeometry(w * 0.9, h * 0.32).rotateY(dir * HP), CM.glow, at([x - dir * 0.001, y, z]), light);
    add(sb, new THREE.PlaneGeometry(w, h).rotateY(dir * HP), CM.lens, at([x + dir * 0.003, y, z]));
  };
  if (Dz.name === 'slab') {
    // the tail: one thin red bar across the tailgate's top edge, in a recessed black channel, its ends brighter
    const tx = Dz.tail - 0.004, ty = 1.02, w = 2 * hw - 0.14;
    add(sb, new THREE.BoxGeometry(0.03, 0.05, w + 0.04), CM.trim, at([tx + 0.008, ty, 0]), [0.012, 0.012, 0.014]);
    add(sb, new THREE.PlaneGeometry(w - 0.2, 0.022).rotateY(-HP), CM.glow, at([tx - 0.008, ty, 0]), [5.5, 0.35, 0.2]);
    for (const sz of [-1, 1]) add(sb, new THREE.PlaneGeometry(0.1, 0.028).rotateY(-HP), CM.glow, at([tx - 0.0085, ty, sz * (w / 2 - 0.06)]), [10, 0.7, 0.4]);
    add(sb, new THREE.PlaneGeometry(w, 0.03).rotateY(-HP), CM.lens, at([tx - 0.012, ty, 0]));
    for (const sz of [-1, 1]) add(sb, new THREE.PlaneGeometry(0.08, 0.025).rotateY(-HP), CM.glow, at([Dz.tail + 0.02, 0.42, sz * (hw - 0.14)]), [0.5, 0.03, 0.02]);   // red reflectors in the bumper
    // the nose: a thin white bar across, between two slim headlamp units
    const nx = Dz.nose + 0.004, ny = 0.93;
    add(sb, new THREE.BoxGeometry(0.025, 0.03, 2 * hw - 0.1), CM.trim, at([nx - 0.006, ny, 0]), [0.012, 0.012, 0.014]);
    add(sb, new THREE.PlaneGeometry(2 * hw - 0.5, 0.016).rotateY(HP), CM.glow, at([nx + 0.008, ny, 0]), [6, 6.2, 6.6]);
    for (const sz of [-1, 1]) unit(nx + 0.004, ny - 0.045, sz * (hw - 0.2), 0.24, 0.04, 1, [7, 7.2, 7.6]);
    // the bed cover's slats, a third brake light over the cab, door shut lines, the charge port
    for (let i = 1; i < 7; i++) { const t = i / 7, xx = -0.9 + (-2.28 + 0.9) * t, yy = 1.37 + (1.13 - 1.37) * t; add(sb, new THREE.BoxGeometry(0.006, 0.004, 1.3), CM.trim, at([xx, yy + 0.002, 0], [0, 0, 0.165]), [0.01, 0.01, 0.01]); }
  } else if (Dz.name === 'vane') {
    // thin light blades: across the nose and the tail, set into black slots
    add(sb, new THREE.BoxGeometry(0.02, 0.02, 1.5), CM.trim, at([Dz.nose - 0.002, 0.47, 0]), [0.01, 0.01, 0.012]);
    add(sb, new THREE.PlaneGeometry(1.42, 0.007).rotateY(HP), CM.glow, at([Dz.nose + 0.009, 0.47, 0]), [6, 6.3, 7]);
    for (const sz of [-1, 1]) unit(Dz.nose - 0.03, 0.42, sz * 0.66, 0.18, 0.03, 1, [7, 7.2, 7.6]);
    add(sb, new THREE.BoxGeometry(0.02, 0.02, 1.4), CM.trim, at([Dz.tail + 0.002, 0.74, 0]), [0.01, 0.01, 0.012]);
    add(sb, new THREE.PlaneGeometry(1.34, 0.008).rotateY(-HP), CM.glow, at([Dz.tail - 0.009, 0.74, 0]), [6, 0.4, 0.3]);
    // the aero channels in the flanks behind the doors, the diffuser's strakes
    for (const sz of [-1, 1]) {
      const ch = new THREE.Shape(v2([[0, 0], [0.9, 0.05], [0.92, 0.14], [0.05, 0.1]]));
      add(sb, new THREE.ExtrudeGeometry(ch, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }), CM.trim, at([-1.15, 0.4, sz * (hw + 0.002) - (sz > 0 ? 0.02 : 0)]), [0.02, 0.02, 0.022]);
    }
    for (let i = 0; i < 6; i++) add(sb, new THREE.BoxGeometry(0.45, 0.1, 0.012), CM.trim, at([Dz.tail + 0.2, Dz.clear + 0.05, -0.55 + i * 0.22]), [0.04, 0.04, 0.045]);
    add(sb, new THREE.BoxGeometry(0.5, 0.012, 1.4), CM.trim, at([Dz.tail + 0.22, Dz.clear + 0.004, 0]), [0.03, 0.03, 0.032]);
  } else {
    // the cab: light bars across both ends, a lidar dome, camera pods at the corners
    add(sb, new THREE.PlaneGeometry(1.5, 0.04).rotateY(HP), CM.glow, at([Dz.nose + 0.006, 0.88, 0]), [5.5, 5.8, 6.2]);
    for (const sz of [-1, 1]) unit(Dz.nose + 0.002, 0.8, sz * 0.62, 0.26, 0.06, 1, [7, 7.2, 7.6]);
    add(sb, new THREE.PlaneGeometry(1.5, 0.05).rotateY(-HP), CM.glow, at([Dz.tail - 0.006, 1.2, 0]), [5.5, 0.35, 0.2]);
    add(cb, new THREE.CylinderGeometry(0.12, 0.14, 0.1, 24), CM.trim, at([0.3, 1.9, 0]), [0.04, 0.04, 0.045]);
    add(sb, new THREE.SphereGeometry(0.11, 24, 10, 0, TAU, 0, HP), CM.glass, at([0.3, 1.95, 0]));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(sb, new THREE.CapsuleGeometry(0.03, 0.05, 4, 10), CM.trim, at([sx * 1.95, 1.07, sz * (hw + 0.02)]), [0.03, 0.03, 0.035]);
  }
  // door shut lines on the lower body (a dark seam), a flush handle; the charging port's door with its ring
  const doors = Dz.name === 'pod' ? [0.9, -0.2, -1.3] : Dz.name === 'vane' ? [1.0, -0.65] : [1.0, -0.12, -0.95];
  const yTop = (x) => { for (let s = 0; s < st.length - 1; s++) if (x <= st[s].x && x >= st[s + 1].x) { const t = (x - st[s].x) / (st[s + 1].x - st[s].x); return st[s].p[np - 1][0] + (st[s + 1].p[np - 1][0] - st[s].p[np - 1][0]) * t; } return 0.8; };
  for (const sz of [-1, 1]) {
    const zz = sz * (hw + 0.0015);
    for (const x of doors) add(sb, new THREE.PlaneGeometry(0.005, yTop(x) - Dz.clear - 0.1).rotateY(sz > 0 ? 0 : Math.PI), CM.trim, at([x, (yTop(x) + Dz.clear + 0.1) / 2, zz]), [0.005, 0.005, 0.006]);
    add(sb, new THREE.PlaneGeometry(doors[0] - doors.at(-1), 0.005).rotateY(sz > 0 ? 0 : Math.PI), CM.trim, at([(doors[0] + doors.at(-1)) / 2, Dz.clear + 0.1, zz]), [0.005, 0.005, 0.006]);
    add(sb, new THREE.BoxGeometry(0.12, 0.016, 0.006), CM.chrome, at([doors[0] - 0.25, yTop(doors[0] - 0.25) - 0.08, zz + sz * 0.002]));
  }
  const px = Dz.tail + 0.42, py = yTop(px) - 0.12, pz = -(hw + 0.0015);
  add(sb, new THREE.PlaneGeometry(0.12, 0.1).rotateY(Math.PI), CM.trim, at([px, py, pz - 0.0005]), [0.006, 0.006, 0.007]);
  add(sb, new THREE.TorusGeometry(0.03, 0.004, 4, 20).rotateY(Math.PI), CM.glow, at([px, py, pz - 0.002]), [0.15, 1.1, 0.4]);
}
