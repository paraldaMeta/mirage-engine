// Mirage original code. kit/cyber's parked cars, a material showcase: parkedCars(ctx, P, batch, [[x, z, rotY]...],
// proxyBox(size, matrix, rotY), { lamp(ctx, { pos, color, intensity, range }) }) returns their anchors; `lamp` is how
// the host lights the under-glow and the tail light (none without it), `proxyBox` its collision volume per car.
// Three designs of an invented marque, KESTREL MOTOR WORKS (no real badges or names):
//  - 0 the KMW "Slab": an angular pickup of folded flat brushed-steel planes meeting at hard creases, a wedge
//    roofline over a sloped bed cover, trapezoid arches in black cladding, a single full-width light bar each end;
//  - 1 the KMW "Vane": a low wedge coupe, very low nose, cab-forward canopy, a long tapering tail, thin light blades,
//    aero channels in its flanks, a diffuser, scissor-door seams; pearlescent paint under clearcoat;
//  - 2 the KMW "Pod": a boxy autonomous cab with big glass, a lidar dome and camera pods.
// Bodies are lofted from cross sections (rings of points at stations along the car: real creases where the ring
// has corners); the wheel openings are real (the body stops above the tyres, sills and bumpers fill between); wheels
// are a tyre (tread and sidewall lettering from the props atlas), a spoked or aero rim, a disc with a faint glow and a
// caliper; glass over a dark interior with seats, a dash and a wheel; lenses with emissive strips behind; mirrors /
// camera pods, door seams, a charging port, number plates with invented characters; under-glow on the wet road.
// Materials: brushed stainless (anisotropic, panel-to-panel tone, water spots), pearlescent paint (two-tone flip,
// metallic flake, clearcoat), tinted glass with a frit band; all three carry rain (rain-beads.js) under the wet layer.
// The game reads only the anchors (pos, rotY) and the car's volume: each keeps the old car's collision boxes.
import * as THREE from 'three';
import { withWet } from '@miragekit/core';
import { rainBeads } from './rain-beads.js';
import { uvByHeight } from './kit.js';

// ---------------------------------------------------------------------------------------------------------------
// loft: stations [{ x, p: [[y, z], ...] }] (half rings, z >= 0, from the top centre outward and down); the part
// between ring points i0..i1 and stations s0..s1, both halves; flat (faceted) or smooth normals
function loft(st, i0, i1, s0, s1, smooth = false) {
  const half = (sgn) => {
    const pos = [], uv = [], idx = [], cols = i1 - i0 + 1;
    for (let s = s0; s <= s1; s++) {
      let arc = 0;
      for (let i = i0; i <= i1; i++) {
        const [y, z] = st[s].p[i];
        if (i > i0) { const [py, pz] = st[s].p[i - 1]; arc += Math.hypot(y - py, z - pz); }
        pos.push(st[s].x, y, z * sgn); uv.push(-st[s].x / 2.4, arc);
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
  const ring = [...st[s].p.map(([y, z]) => [y, z]).reverse(), ...st[s].p.slice(1).map(([y, z]) => [y, -z])];
  const cy = ring.reduce((a, [y]) => a + y, 0) / ring.length, x = st[s].x, pos = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const A = [x, cy, 0], B = [x, ring[i][0], ring[i][1]], C = [x, ring[i + 1][0], ring[i + 1][1]];
    const n = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
    pos.push(...A, ...(n * dir > 0 ? [...B, ...C] : [...C, ...B]));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  // a real uv (z, y): the steel's anisotropy builds its tangent frame from uv derivatives (zero uv gave NaN under the sun)
  const uv = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i + 2], pos[i + 1]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
// rings: [x, [[y, z], ...]] -> stations
const ST = (list) => list.map(([x, p]) => ({ x, p }));

// ---- the three designs: stations, which parts are glass, the wheels, the lights
export const CAR_DESIGNS = [
  { // the Slab: [top, roof half width], [shoulder y, half width], [low, half width]
    name: 'slab', low: 0.82, wheel: { r: 0.38, w: 0.29, z: 0.8, spokes: 6 }, flat: true,
    st: ST([[2.36, [[1.0, 0], [1.0, 0.7], [0.95, 0.86], [0.82, 0.86]]], [2.3, [[1.04, 0], [1.04, 0.76], [0.98, 0.93], [0.82, 0.93]]],
      [1.05, [[1.15, 0], [1.15, 0.8], [1.06, 0.95], [0.82, 0.95]]], [-0.25, [[1.62, 0], [1.62, 0.58], [1.1, 0.95], [0.82, 0.95]]],
      [-0.95, [[1.5, 0], [1.5, 0.62], [1.1, 0.95], [0.82, 0.95]]], [-2.28, [[1.22, 0], [1.22, 0.86], [1.1, 0.95], [0.82, 0.95]]],
      [-2.36, [[1.16, 0], [1.16, 0.8], [1.06, 0.88], [0.82, 0.88]]]]),
    glass: [[0, 1, 2, 3], [1, 2, 2, 4]],     // [i0, i1, s0, s1]
    front: { y: 1.0, h: 0.035, x: 2.33 }, rear: { y: 1.12, h: 0.04, x: -2.35 }, arch: 'trap', interior: 1.05,
  },
  { // the Vane
    name: 'vane', low: 0.62, wheel: { r: 0.35, w: 0.3, z: 0.81, spokes: 0 }, flat: false,
    st: ST([[2.36, [[0.62, 0], [0.62, 0.55], [0.6, 0.8], [0.58, 0.86], [0.56, 0.86]]], [2.25, [[0.66, 0], [0.66, 0.7], [0.64, 0.88], [0.62, 0.93], [0.6, 0.93]]],
      [1.6, [[0.8, 0], [0.8, 0.62], [0.78, 0.85], [0.74, 0.95], [0.62, 0.95]]], [1.0, [[0.95, 0], [0.95, 0.5], [0.9, 0.78], [0.78, 0.95], [0.62, 0.95]]],
      [0.2, [[1.17, 0], [1.16, 0.45], [1.02, 0.74], [0.8, 0.93], [0.62, 0.93]]], [-0.7, [[1.14, 0], [1.13, 0.44], [1.0, 0.76], [0.82, 0.97], [0.62, 0.97]]],
      [-1.4, [[0.98, 0], [0.97, 0.5], [0.92, 0.82], [0.82, 0.97], [0.62, 0.97]]], [-2.0, [[0.88, 0], [0.88, 0.62], [0.86, 0.84], [0.78, 0.92], [0.62, 0.92]]],
      [-2.3, [[0.84, 0], [0.84, 0.6], [0.82, 0.8], [0.74, 0.86], [0.62, 0.86]]], [-2.36, [[0.8, 0], [0.8, 0.5], [0.78, 0.7], [0.7, 0.78], [0.62, 0.78]]]]),
    glass: [[0, 2, 3, 6]],
    front: { y: 0.6, h: 0.014, x: 2.36 }, rear: { y: 0.8, h: 0.018, x: -2.37 }, arch: 'round', interior: 0.8,
  },
  { // the Pod
    name: 'pod', low: 0.72, wheel: { r: 0.33, w: 0.25, z: 0.84, spokes: 0 }, flat: false,
    st: ST([[2.36, [[0.95, 0], [0.95, 0.7], [0.9, 0.86], [0.72, 0.86]]], [2.28, [[1.0, 0], [1.0, 0.8], [0.95, 0.93], [0.72, 0.93]]],
      [1.7, [[1.12, 0], [1.12, 0.82], [1.0, 0.95], [0.72, 0.95]]], [1.2, [[1.7, 0], [1.7, 0.72], [1.02, 0.95], [0.72, 0.95]]],
      [-1.6, [[1.72, 0], [1.72, 0.72], [1.02, 0.95], [0.72, 0.95]]], [-2.2, [[1.45, 0], [1.45, 0.75], [1.0, 0.95], [0.72, 0.95]]],
      [-2.36, [[1.38, 0], [1.38, 0.7], [0.96, 0.88], [0.72, 0.88]]]]),
    glass: [[0, 1, 2, 3], [1, 2, 2, 5]],
    front: { y: 0.93, h: 0.05, x: 2.33 }, rear: { y: 1.2, h: 0.05, x: -2.35 }, arch: 'round', interior: 0.95,
  },
];

// ---------------------------------------------------------------------------------------------------------------
export function carMaterials(ctx) {
  if (ctx.shared.carMats) return ctx.shared.carMats;
  const { mat } = ctx;
  const wet = (h) => withWet(h, { porosity: 0, puddles: 0, band: 0.1 });
  // brushed stainless: anisotropic along the car (uv u), each panel its own tone (vertex colour), water spots
  const steel = mat.phys({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.2, anisotropy: 0.75, anisotropyRotation: 0, clearcoat: 0 }, wet(rainBeads({
    fragmentDecl: 'float ndSp;',
    albedo: '{ vec3 p = mgWorldPos; float brush = mgValue2(vec2(dot(p.xz, vec2(0.7, 0.7)) * 3.0, p.y * 900.0)); ndSp = smoothstep(0.62, 0.8, mgFbm3(p * 9.0, 3)) * 0.7 + 0.3 * smoothstep(0.7, 0.9, mgValue3(p * 60.0)); diffuseColor.rgb *= vec3(0.62, 0.63, 0.65) * (0.9 + 0.12 * brush) * (1.0 - 0.12 * ndSp); }',
    roughness: 'roughnessFactor = clamp(roughnessFactor + 0.18 * ndSp, 0.05, 1.0);',
  }, { scale: 1, density: 0.55, run: 0.6 })));
  // pearlescent paint: the vertex colour at face-on, a flip colour toward grazing, flake, clearcoat on top
  const pearl = mat.phys({ color: 0xffffff, vertexColors: true, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.025, iridescence: 0.35, iridescenceIOR: 1.6 }, wet(rainBeads({
    fragmentDecl: 'float ndFl;',
    albedo: `{ vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal); float f = 1.0 - abs(dot(V, N));
      vec3 flip = vec3(diffuseColor.b * 0.9 + 0.1, diffuseColor.r * 0.4, diffuseColor.g * 0.8 + 0.25);
      diffuseColor.rgb = mix(diffuseColor.rgb, flip, smoothstep(0.25, 0.95, f));
      vec3 cell = floor(mgWorldPos * 1400.0); float hf = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float px = length(fwidth(mgWorldPos)) * 1400.0; ndFl = step(0.93, hf) * (1.0 - smoothstep(0.4, 1.4, px));
      diffuseColor.rgb *= 1.0 + 1.6 * ndFl; }`,
    roughness: 'roughnessFactor = mix(roughnessFactor, 0.12, ndFl);',
  }, { scale: 1, density: 0.7, run: 0.45 })));
  // tinted glass (its black frit and seals are geometry: a frame round each pane)
  const glass = mat.phys({ color: new THREE.Color(0.02, 0.025, 0.03), metalness: 0, roughness: 0.03, transparent: true, opacity: 0.72, clearcoat: 1, clearcoatRoughness: 0.02 }, rainBeads({}, { scale: 0.9, density: 0.75, run: 0.7, film: 0 }));
  return (ctx.shared.carMats = { steel, pearl, glass });
}

/** Build the cars into `pb` (the street's props batch: decor) and their own batch; returns the anchors */
export function parkedCars(ctx, P, pb, list, proxyBox = () => {}, { lamp = () => null } = {}) {
  const { geom, root } = ctx, CM = carMaterials(ctx), { mats, put, R } = P;
  const cb = new geom.MeshBatch();   // the car bodies: steel, pearl, glass
  const anchors = [];
  const PAINT = [[1, 1, 1], [0.06, 0.34, 0.42], [0.85, 0.55, 0.25]];
  const GLOW = [[0.1, 0.85, 1.0], [1.0, 0.16, 0.5], [1.0, 0.6, 0.2]];
  list.forEach(([x, z, rot], ci) => {
    const Dz = CAR_DESIGNS[ci % CAR_DESIGNS.length], m = geom.compose([x, 0, z], [0, rot, 0]), at = (p, r = [0, 0, 0], s = 1) => m.clone().multiply(geom.compose(p, r, s));
    const body = Dz.name === 'slab' ? CM.steel : CM.pearl, paint = PAINT[ci % 3], st = Dz.st, last = st.length - 1;
    const glassOf = (i0, s0) => Dz.glass.some(([g0, g1, a, b]) => i0 >= g0 && i0 < g1 && s0 >= a && s0 < b);
    // ---- the body: each facet band of the loft, steel / paint or glass; tone varies a little panel to panel
    const np = st[0].p.length;
    for (let i = 0; i < np - 1; i++) for (let s = 0; s < last; s++) {
      const gl = glassOf(i, s), tone = 0.94 + 0.1 * Math.abs(Math.sin(ci * 3.1 + i * 1.7 + s * 2.3));
      for (const g of loft(st, i, i + 1, s, s + 1, !Dz.flat)) {
        if (gl) cb.add(g, CM.glass, m);
        else put(cb, g, body, m, paint.map((c) => c * (Dz.name === 'slab' ? tone : 1)), null);
      }
    }
    for (const [s, d] of [[0, 1], [last, -1]]) put(cb, cap(st, s, d), body, m, paint, null);
    // a black seal round every pane (the frit band, the pillars between them)
    for (const [g0, g1, a, b] of Dz.glass) for (const sz of [1, -1]) {
      const P3 = (s, i) => [st[s].x, st[s].p[i][0], st[s].p[i][1] * sz];
      const lines = [[...Array(b - a + 1)].map((_, k) => P3(a + k, g0)), [...Array(b - a + 1)].map((_, k) => P3(a + k, g1)), [...Array(g1 - g0 + 1)].map((_, k) => P3(a, g0 + k)), [...Array(g1 - g0 + 1)].map((_, k) => P3(b, g0 + k))];
      for (const L of lines) for (let k = 0; k < L.length - 1; k++) put(pb, geom.taperedTube([L[k], L[k + 1]], [0.022, 0.022], { radial: 6, segments: 1, capEnd: false }), mats.paint, m, [0.012, 0.012, 0.014]);
    }
    // sills between the wheels, bumpers at both ends (below the body's lower edge), the chassis in the shadow
    const W = Dz.wheel, lo = Dz.low, hw = 0.93, ax = 1.45, open = W.r + 0.1;
    const lowerMat = Dz.name === 'slab' ? mats.paint : body, lowerCol = Dz.name === 'slab' ? [0.025, 0.025, 0.028] : paint;
    put(cb, new geom.RoundedBoxGeometry(2 * (ax - open), lo - 0.26, 2 * hw, 1, 0.04), lowerMat, at([0, (lo + 0.26) / 2, 0]), lowerCol, Dz.name === 'slab' ? R.white : null);
    for (const s of [-1, 1]) {
      const x0 = s * (ax + open), x1 = s * 2.34;
      put(cb, new geom.RoundedBoxGeometry(Math.abs(x1 - x0), lo - 0.24 + 0.02, 2 * hw - 0.04, 1, 0.05), lowerMat, at([(x0 + x1) / 2, (lo + 0.24) / 2, 0]), lowerCol, Dz.name === 'slab' ? R.white : null);
    }
    put(pb, new THREE.BoxGeometry(4.2, 0.3, 1.36), mats.paint, at([0, 0.45, 0]), [0.01, 0.01, 0.012]);
    for (const s of [-1, 1]) put(pb, new THREE.BoxGeometry(2 * open, 0.05, 2 * hw - 0.1), mats.paint, at([s * ax, lo - 0.02, 0]), [0.008, 0.008, 0.01]);   // the wheel-well roofs
    // ---- arches: trapezoid cladding (the Slab) or a round lip, both sides of each axle
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const sh = new THREE.Shape(), hole = new THREE.Path(), r0 = open, r1 = open + (Dz.arch === 'trap' ? 0.09 : 0.035);
      if (Dz.arch === 'trap') {
        const tr = (r, k) => [[-r * 1.05, 0], [-r * 0.62, r * 0.98 + k], [r * 0.62, r * 0.98 + k], [r * 1.05, 0]];
        tr(r1, 0.03).forEach(([a, b], i) => (i ? sh.lineTo(a, b) : sh.moveTo(a, b))); sh.lineTo(r1 * 1.05, -0.06); sh.lineTo(-r1 * 1.05, -0.06);
        tr(r0, 0).reverse().forEach(([a, b], i) => (i ? hole.lineTo(a, b) : hole.moveTo(a, b))); hole.lineTo(-r0 * 1.05, -0.04); hole.lineTo(r0 * 1.05, -0.04);
      } else {
        sh.absarc(0, 0, r1, 0, Math.PI, false); sh.lineTo(-r1, -0.04); sh.lineTo(r1, -0.04);
        hole.absarc(0, 0, r0, Math.PI, 0, true); hole.lineTo(r0, -0.02); hole.lineTo(-r0, -0.02);
      }
      sh.holes.push(hole);
      const ex = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, curveSegments: 6 });
      put(pb, ex, Dz.arch === 'trap' ? mats.paint : mats.metal, at([sx * ax, W.r + 0.02, sz * (hw - 0.02)], [0, sz > 0 ? 0 : Math.PI, 0]), Dz.arch === 'trap' ? [0.03, 0.03, 0.032] : [0.04, 0.04, 0.045]);
    }
    // ---- wheels: tyre, rim, disc and caliper
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(P, pb, geom, at([sx * ax, W.r, sz * W.z], [0, sz > 0 ? 0 : Math.PI, 0]), W, ci);
    // ---- interior under the glass: a dash, two rows of seats, a wheel
    const ix = Dz.interior;
    put(pb, new geom.RoundedBoxGeometry(0.4, 0.2, 1.5, 1, 0.05), mats.paint, at([ix - 0.15, lo + 0.18, 0]), [0.02, 0.02, 0.022]);
    for (const [sx, row] of [[ix - 0.95, 0], [ix - 1.75, 1]]) for (const sz of [-0.4, 0.4]) {
      if (Dz.name === 'vane' && row) continue;
      put(pb, new geom.RoundedBoxGeometry(0.5, 0.14, 0.48, 1, 0.05), mats.paint, at([sx, lo + 0.05, sz]), [0.03, 0.025, 0.025]);
      put(pb, new geom.RoundedBoxGeometry(0.14, 0.6, 0.46, 1, 0.06), mats.paint, at([sx - 0.25, lo + 0.32, sz], [0, 0, 0.25]), [0.035, 0.028, 0.028]);
    }
    if (Dz.name !== 'pod') put(pb, new THREE.TorusGeometry(0.17, 0.018, 6, 20).rotateY(Math.PI / 2), mats.paint, at([ix - 0.45, lo + 0.32, 0.4], [0, 0, 0.45]), [0.02, 0.02, 0.02]);
    else put(pb, new THREE.PlaneGeometry(0.8, 0.25).rotateY(-Math.PI / 2), mats.glow, at([ix - 0.33, lo + 0.34, 0], [0, 0, 0.3]), [0.3, 0.9, 1.2]);   // the pod's passenger screen
    // ---- lights: a lens housing with a bright strip behind, front and rear, full width; plate lights
    for (const [L, front] of [[Dz.front, 1], [Dz.rear, 0]]) {
      const w = 2 * hw - 0.12;
      put(pb, new THREE.BoxGeometry(0.03, L.h + 0.03, w + 0.02), mats.metal, at([L.x - (front ? 0.012 : -0.012), L.y, 0]), [0.03, 0.03, 0.035]);
      put(pb, new THREE.PlaneGeometry(w, L.h).rotateY(front ? Math.PI / 2 : -Math.PI / 2), mats.glow, at([L.x + (front ? 0.006 : -0.006), L.y, 0]), front ? [6, 6.2, 6.6] : [6.5, 0.4, 0.25], R.lens);
    }
    // the Vane's flanks: aero channels; its diffuser; the Slab's bed-cover slats; the Pod's sensors
    if (Dz.name === 'vane') {
      for (const sz of [-1, 1]) {
        put(pb, new THREE.PlaneGeometry(1.0, 0.1), mats.paint, at([0.45, 0.72, sz * 0.955], [0, sz > 0 ? 0 : Math.PI, 0]), [0.005, 0.005, 0.006]);
        put(pb, new THREE.BoxGeometry(1.0, 0.012, 0.03), mats.glow, at([0.45, 0.665, sz * 0.95]), GLOW[ci].map((v) => v * 2));
      }
      for (let i = 0; i < 6; i++) put(pb, new THREE.BoxGeometry(0.4, 0.1, 0.012), mats.metal, at([-2.12, 0.3, -0.6 + i * 0.24]), [0.05, 0.05, 0.055]);
    }
    if (Dz.name === 'slab') for (let i = 1; i < 6; i++) { const t = i / 6, xx = -0.95 + (-2.28 + 0.95) * t, yy = 1.5 + (1.22 - 1.5) * t; put(pb, new THREE.BoxGeometry(0.012, 0.006, 1.3), mats.paint, at([xx, yy + 0.003, 0], [0, 0, -0.21]), [0.02, 0.02, 0.02]); }
    if (Dz.name === 'pod') {
      put(pb, new THREE.CylinderGeometry(0.12, 0.14, 0.1, 16), mats.paint, at([0.3, 1.77, 0]), [0.03, 0.03, 0.035]);
      put(pb, new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), CM.glass, at([0.3, 1.82, 0]));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(pb, new geom.RoundedBoxGeometry(0.1, 0.06, 0.06, 1, 0.02), mats.paint, at([sx * 1.95, 1.0, sz * 0.96]), [0.03, 0.03, 0.035]);
    }
    // mirrors or camera pods on short stalks at the base of the A pillars
    const cowl = st.find((s) => s.p[0][0] > (Dz.name === 'vane' ? 0.9 : 1.1)) || st[2];
    for (const sz of [-1, 1]) {
      put(pb, new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6).rotateX(Math.PI / 2), mats.metal, at([cowl.x - 0.1, cowl.p[2][0] + 0.03, sz * 0.98]), [0.05, 0.05, 0.055]);
      put(pb, new geom.RoundedBoxGeometry(0.12, 0.07, 0.06, 1, 0.025), mats.metal, at([cowl.x - 0.12, cowl.p[2][0] + 0.05, sz * 1.05]), paint.map((c) => c * 0.6));
      put(pb, new THREE.PlaneGeometry(0.02, 0.012).rotateY(-Math.PI / 2), mats.glow, at([cowl.x - 0.181, cowl.p[2][0] + 0.05, sz * 1.05]), GLOW[ci].map((v) => v * 4));
    }
    // wipers (not on the Pod), door seams, the charging port, plates
    if (Dz.name !== 'pod') for (const sz of [-0.35, 0.3]) put(pb, new THREE.BoxGeometry(0.02, 0.012, 0.6), mats.paint, at([cowl.x - 0.04, cowl.p[0][0] + 0.02, sz], [0, 0.35, 0]), [0.015, 0.015, 0.015]);
    for (const sz of [-1, 1]) {
      const zz = sz * (hw + 0.025), y0 = lo + 0.02, y1 = (st[2].p[2] || st[2].p[1])[0] - 0.03;
      for (const sx of Dz.name === 'pod' ? [0.2, -0.6] : Dz.name === 'vane' ? [0.95, -0.55] : [0.95, -0.15, -0.95]) put(pb, new THREE.BoxGeometry(0.008, y1 - y0, 0.006), mats.paint, at([sx, (y0 + y1) / 2, zz]), [0.01, 0.01, 0.01]);
      put(pb, new THREE.BoxGeometry(0.1, 0.012, 0.006), mats.metal, at([Dz.name === 'pod' ? 0.05 : 0.65, y1 - 0.12, zz + sz * 0.004]), [0.4, 0.4, 0.42]);   // a flush handle
    }
    put(pb, new geom.RoundedBoxGeometry(0.11, 0.1, 0.012, 1, 0.02), mats.metal, at([-1.95, lo + 0.13, -(hw + 0.02)]), paint.map((c) => c * 0.8));   // the charging port's door
    put(pb, new THREE.TorusGeometry(0.035, 0.005, 4, 16), mats.glow, at([-1.95, lo + 0.13, -(hw + 0.03)]), [0.2, 1.4, 0.5]);
    put(pb, new THREE.PlaneGeometry(0.42, 0.105).rotateY(Math.PI / 2), mats.paint, at([2.345, Dz.name === 'vane' ? 0.42 : 0.5, 0]), [1, 1, 1], R['plate' + (ci % 3)]);
    put(pb, new THREE.PlaneGeometry(0.42, 0.105).rotateY(-Math.PI / 2), mats.paint, at([-2.345, Dz.name === 'vane' ? 0.55 : 0.6, 0]), [1, 1, 1], R['plate' + (ci % 3)]);
    // under-glow: a lit strip under each sill, its light on the wet road
    for (const sz of [-1, 1]) put(pb, new THREE.BoxGeometry(2.2, 0.012, 0.03), mats.glow, at([0, 0.27, sz * 0.86]), GLOW[ci].map((v) => v * 5));
    lamp(ctx, { pos: new THREE.Vector3(0, 0.2, 0).applyMatrix4(m).toArray(), color: new THREE.Color().setRGB(...GLOW[ci]), intensity: 1.6, range: 3.6 });
    // ---- the old car's volume (the walk grid, the cover), the anchors and the tail lamp as before
    proxyBox([4.68, 1.0, 1.9], at([0, 0.5, 0]), rot); proxyBox([2.9, 0.52, 1.64], at([-0.56, 1.14, 0]), rot);
    anchors.push({ pos: new THREE.Vector3(0, 1.6, 0).applyMatrix4(m).toArray(), rotY: rot });
    lamp(ctx, { pos: new THREE.Vector3(-2.7, 0.6, 0).applyMatrix4(m).toArray(), color: 0xff2010, intensity: 1.4, range: 4.5 });
  });
  const g = cb.finish({ name: 'cars', castShadow: true });
  g.traverse((o) => { o.userData.collide = false; });
  root.add(g);
  return anchors;
}

// a wheel at matrix m (its outer face toward +z): tyre, rim (spokes or an aero disc), the brake disc and caliper
const cache = new Map(), once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
function wheel(P, bt, geom, m, W, ci) {
  const { mats, put, R } = P, at = (p, r = [0, 0, 0]) => m.clone().multiply(geom.compose(p, r));
  const rr = W.r * 0.66, hw = W.w / 2;
  const tyre = once('tyre' + W.r + W.w, () => {
    const g = new THREE.LatheGeometry([[rr, -hw], [W.r - 0.05, -hw], [W.r - 0.012, -hw + 0.018], [W.r, -hw + 0.05], [W.r, hw - 0.05], [W.r - 0.012, hw - 0.018], [W.r - 0.05, hw], [rr, hw]].map(([a, b]) => new THREE.Vector2(a, b)), 24);
    g.computeVertexNormals(); return uvByHeight(g, -hw, hw).rotateX(Math.PI / 2);
  });
  put(bt, tyre, mats.paint, m, [0.9, 0.9, 0.9], R.tyre);
  const face = hw - 0.02;
  put(bt, new THREE.CylinderGeometry(rr, rr, W.w - 0.04, 24, 1, true).rotateX(Math.PI / 2), mats.metal, m, [0.3, 0.3, 0.32]);   // the barrel
  if (W.spokes) {
    put(bt, new THREE.CylinderGeometry(0.07, 0.08, 0.06, 12).rotateX(Math.PI / 2), mats.metal, at([0, 0, face - 0.03]), [0.55, 0.55, 0.58]);
    for (let i = 0; i < W.spokes; i++) { const a = i / W.spokes * Math.PI * 2; put(bt, new THREE.BoxGeometry(rr - 0.06, 0.05, 0.035), mats.metal, at([Math.cos(a) * (rr / 2 + 0.03), Math.sin(a) * (rr / 2 + 0.03), face - 0.03 - 0.02 * Math.sin(i)], [0, 0, a]), [0.6, 0.6, 0.62]); }
    put(bt, new THREE.TorusGeometry(rr - 0.01, 0.014, 4, 20), mats.metal, at([0, 0, face - 0.01]), [0.62, 0.62, 0.64]);
  } else {   // an aero disc with slots
    put(bt, new THREE.LatheGeometry([[0, 0.02], [rr * 0.3, 0.018], [rr * 0.95, 0], [rr, -0.015]].map(([a, b]) => new THREE.Vector2(a, b)), 30).rotateX(Math.PI / 2), mats.metal, at([0, 0, face - 0.02]), ci === 1 ? [0.08, 0.08, 0.09] : [0.7, 0.7, 0.72]);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; put(bt, new THREE.BoxGeometry(rr * 0.42, 0.03, 0.01), mats.paint, at([Math.cos(a) * rr * 0.62, Math.sin(a) * rr * 0.62, face + 0.002], [0, 0, a + 0.4]), [0.005, 0.005, 0.005]); }
    put(bt, new THREE.CircleGeometry(0.05, 16), mats.glow, at([0, 0, face + 0.024]), [0.6, 1.8, 2.2].map((v, k) => v * [1, 0.5, 1.3][ci % 3] * (k ? 1 : 1)));
  }
  put(bt, new THREE.CylinderGeometry(rr * 0.85, rr * 0.85, 0.02, 24).rotateX(Math.PI / 2), mats.metal, at([0, 0, -0.04]), [0.35, 0.32, 0.3]);   // the disc
  put(bt, new THREE.TorusGeometry(rr * 0.8, 0.008, 3, 16), mats.glow, at([0, 0, -0.03]), [0.45, 0.1, 0.02]);                               // its glow
  put(bt, new geom.RoundedBoxGeometry(0.1, 0.16, 0.06, 1, 0.02), mats.paint, at([rr * 0.62, rr * 0.35, -0.02], [0, 0, 0.5]), [[0.8, 0.5, 0.05], [0.7, 0.05, 0.05], [0.1, 0.4, 0.8]][ci % 3]);   // the caliper
}
