// Experiment (img2threejs method by hand): a faceted stainless electric pickup, rear three-quarter as the hero view.
// createTruck({ pass, lights }) -> THREE.Group. Procedural geometry only; generic three.js materials.
//
// Frame: +X forward, Y up, metres, origin on the ground midway between the axles. The truck's left is -Z.
// Hierarchy (named pivots):
//   truck
//     body            shell (stainless facets), glass, trim (black cladding, bumpers, seams), lamps
//     tailgate        pivot on the hinge line at the bottom of the tail (rotate about Z to open)
//     steer_FL / steer_FR   pivots at the front wheel centres (rotate about Y to steer) -> wheel_FL / wheel_FR
//     wheel_RL / wheel_RR   pivots at the rear wheel centres (rotate about Z to roll)
// Passes (the method's locked build order; each one is rendered and reviewed before the next):
//   1 blockout     volumes at the measured dimensions: a box per body mass, a cylinder per wheel
//   2 structure    the faceted shell from stations (one ridge line, wedge nose, vault slope), arch cut-outs, pivots
//   3 form         cladding, sills, bumpers, light bars, glass frames, seams, mirrors, plate, tyres with lugs, rims
//   4 material     brushed stainless, textured black plastic, tinted glass, rubber, lit / unlit lenses
//   5 optimise     merge by material per pivot (draw calls), report triangles
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// the reference sheet, in numbers (NOTES-img2threejs.md, truck section)
export const TRUCK = {
  length: 5.68, width: 2.03, height: 1.79, wheelbase: 3.81, track: 1.72, tyreR: 0.44, tyreW: 0.285, rimR: 0.255,
  front: 2.84, rear: -2.84, axleF: 1.85, axleR: -1.96, apexX: -0.1, clearance: 0.40,
};
const T = TRUCK;

const lerp = (a, b, t) => a + (b - a) * t;
/** piecewise linear through [[x, v], ...] (x descending) */
const pw = (pts) => (x) => {
  if (x >= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) { const [x0, v0] = pts[i], [x1, v1] = pts[i + 1]; if (x <= x0 && x >= x1) return lerp(v0, v1, (x0 - x) / (x0 - x1)); }
  return pts[pts.length - 1][1];
};
// the side profile: one straight ridge from the nose to the apex, one straight slope from the apex to the tail
const yTop = pw([[T.front, 1.03], [T.apexX, T.height], [T.rear, 1.30]]);
const wTop = pw([[T.front, 0.90], [T.apexX, 0.58], [T.rear, 0.80]]);           // half width of the top plane
const yShoulder = pw([[T.front, 0.98], [1.95, 1.05], [-1.0, 1.07], [T.rear, 1.10]]);   // the side crease
const zShoulder = pw([[T.front, 0.97], [1.95, 1.015], [-2.6, 1.015], [T.rear, 0.99]]);
const Z_LOW = 0.985;                                                            // the side wall's bottom edge
const STATIONS = [T.front, 1.95, 0.95, T.apexX, -0.95, T.rear];
const yBelt = pw([[0.95, 1.22], [T.apexX, 1.27], [-0.95, 1.27]]);
/** the point on the upper side plane at the belt line (between the crease and the top edge), right side */
const belt = (x) => { const y = yBelt(x), t = (y - yShoulder(x)) / (yTop(x) - yShoulder(x)); return [x, y, lerp(zShoulder(x), wTop(x), t)]; };

const MATS = (pass) => {
  if (pass < 4) {
    const g = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1, flatShading: true });
    const steel = g(0x9a9da1), dark = g(0x2a2b2e);
    return { steel, glass: g(0x3a4048), plastic: dark, tyre: dark, rim: g(0x444548), tonneau: g(0x55585c), lampRed: g(0x6a1010), lampWhite: g(0xdddddd), satin: g(0xb0b0b0), plate: g(0xd8d8d0), gap: dark };
  }
  return {
    // brushed stainless: fully metallic, mid roughness, faint warm grey; panels differ a little (vertex colour)
    steel: new THREE.MeshPhysicalMaterial({ color: 0xc4c6c8, metalness: 1, roughness: 0.34, vertexColors: true, flatShading: true, name: 'stainless' }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0c0f, metalness: 0.0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, name: 'glass' }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.82, metalness: 0, name: 'blackPlastic' }),
    tonneau: new THREE.MeshPhysicalMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.3, clearcoat: 0.4, name: 'tonneau' }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.92, name: 'rubber' }),
    rim: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.42, metalness: 0.55, name: 'rimSatinBlack' }),
    lampRed: new THREE.MeshStandardMaterial({ color: 0x1a0303, roughness: 0.15, emissive: 0xff1608, emissiveIntensity: 0, name: 'lensRed' }),
    lampWhite: new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.15, emissive: 0xf0f4ff, emissiveIntensity: 0, name: 'lensWhite' }),
    satin: new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.25, metalness: 1, name: 'satinStrip' }),
    plate: new THREE.MeshStandardMaterial({ color: 0xe2e2da, roughness: 0.5, name: 'plate' }),
    gap: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, name: 'panelGap' }),
  };
};

// ---- geometry helpers --------------------------------------------------------------------------------------
/** a flat polygon (convex, points in order) as triangles, wound to face away from `inside` */
function poly(pts, inside = new THREE.Vector3(0, 0.9, 0)) {
  const P = pts.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), c = P.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(P.length);
  const n = new THREE.Vector3().subVectors(P[1], P[0]).cross(new THREE.Vector3().subVectors(P[2], P[0]));
  const flip = n.dot(new THREE.Vector3(c.x - inside.x, c.y - inside.y, c.z - inside.z)) < 0;
  const pos = [];
  for (let i = 1; i < P.length - 1; i++) { const tri = flip ? [P[0], P[i + 1], P[i]] : [P[0], P[i], P[i + 1]]; for (const p of tri) pos.push(p.x, p.y, p.z); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
const mirrorZ = (g) => { const m = g.clone().scale(1, 1, -1); const p = m.attributes.position; for (let i = 0; i < p.count; i += 3) { for (const k of ['x', 'y', 'z']) { const a = p['get' + k.toUpperCase()](i + 1), b = p['get' + k.toUpperCase()](i + 2); p['set' + k.toUpperCase()](i + 1, b); p['set' + k.toUpperCase()](i + 2, a); } } m.computeVertexNormals(); return m; };
const both = (g) => [g, mirrorZ(g)];
/** a box between two corners */
const boxAt = (min, max) => new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]).translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
/** a thin bar from a to b (square section s) */
function bar(a, b, s = 0.025) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.BoxGeometry(s, len, s);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// the arch opening: a trapezoid with chamfered top corners, around axle x (bottom at the sill line)
const archPts = (x, yb = 0.53) => [[x + 0.66, yb], [x + 0.5, 0.86], [x + 0.36, 0.995], [x - 0.36, 0.995], [x - 0.5, 0.86], [x - 0.66, yb]];

// ---- the shell ----------------------------------------------------------------------------------------------
function shell(pass, M, add) {
  if (pass === 1) {   // blockout: the lower body, the cab wedge, the vault, as boxes at the sheet's numbers
    add(boxAt([T.rear, 0.55, -1.0], [T.front, 1.07, 1.0]), M.steel);
    add(boxAt([-0.95, 1.07, -0.62], [0.95, T.height, 0.62]), M.glass);
    add(boxAt([T.rear, 1.07, -0.8], [-0.95, 1.45, 0.8]), M.tonneau);
    add(boxAt([T.rear - 0.08, 0.38, -1.0], [T.front + 0.04, 0.55, 1.0]), M.plastic);
    return;
  }
  // top planes between stations: hood (steel), windscreen (glass), roof glass, vault cover (tonneau)
  const topMat = [M.steel, M.steel, M.glass, M.glass, M.tonneau];
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i], b = STATIONS[i + 1], ya = yTop(a), yb = yTop(b);
    add(poly([[a, ya, -wTop(a)], [a, ya, wTop(a)], [b, yb, wTop(b)], [b, yb, -wTop(b)]]), topMat[i]);
    // the upper side planes (fender / window / sail) from the top edge down to the shoulder crease
    if (i === 2 || i === 3) {
      // the cab: steel from the crease up to the belt line, glass above it (gate 4: the reference's belt is ~1.27 m)
      const A0 = [a, yShoulder(a), zShoulder(a)], B0 = [b, yShoulder(b), zShoulder(b)], A1 = belt(a), B1 = belt(b);
      for (const g of both(poly([A1, A0, B0, B1]))) add(g, M.steel, 0.96);
      for (const g of both(poly([[a, ya, wTop(a)], A1, B1, [b, yb, wTop(b)]]))) add(g, M.glass);
    } else for (const g of both(poly([[a, ya, wTop(a)], [a, yShoulder(a), zShoulder(a)], [b, yShoulder(b), zShoulder(b)], [b, yb, wTop(b)]]))) add(g, M.steel, 1 + i * 0.37);
  }
  // the side wall: shoulder crease down to the lower edge, the arches cut out (a shape in x / y, leaned out a touch)
  const s = new THREE.Shape(), xs = [T.front, 1.95, 0.95, T.apexX, -0.95, -2.2, T.rear];
  const low = [[T.front, 0.62], ...archPts(T.axleF, 0.56), ...archPts(T.axleR, 0.56), [T.rear, 0.76]];
  s.moveTo(T.front, yShoulder(T.front)); for (const x of xs.slice(1)) s.lineTo(x, yShoulder(x));
  for (const [x, y] of low.reverse()) s.lineTo(x, y);
  const side = new THREE.ShapeGeometry(s).toNonIndexed(), p = side.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), ys = yShoulder(x); p.setZ(i, lerp(Z_LOW, zShoulder(x), Math.min(1, Math.max(0, (y - 0.56) / (ys - 0.56))))); }
  side.computeVertexNormals();
  for (const g of both(side)) add(g, M.steel, 0.97);
  // the nose face and the tail (the tail's steel below the light bar is the tailgate: added by the caller)
  const ring = (x, yLow) => [[x, yLow, -Z_LOW], [x, yShoulder(x), -zShoulder(x)], [x, yTop(x), -wTop(x)], [x, yTop(x), wTop(x)], [x, yShoulder(x), zShoulder(x)], [x, yLow, Z_LOW]];
  add(poly(ring(T.front, 0.62)), M.steel, 1.02);
  // the tail above the tailgate: from the light bar up to the vault's edge
  add(poly([[T.rear, 1.2, -zShoulder(T.rear)], [T.rear, yShoulder(T.rear), -zShoulder(T.rear)], [T.rear, yTop(T.rear), -wTop(T.rear)], [T.rear, yTop(T.rear), wTop(T.rear)], [T.rear, yShoulder(T.rear), zShoulder(T.rear)], [T.rear, 1.2, zShoulder(T.rear)]]), M.steel, 0.95);
  // wheel wells: dark inner liners so the openings are not see-through
  for (const ax of [T.axleF, T.axleR]) for (const sz of [-1, 1]) add(boxAt([ax - 0.62, 0.5, sz > 0 ? 0.62 : -0.98], [ax + 0.62, 1.0, sz > 0 ? 0.98 : -0.62]).translate(0, 0, 0), M.gap);
}

// ---- form: cladding, bumpers, lamps, frames, seams, mirrors --------------------------------------------------
function trim(pass, M, add, lit) {
  if (pass < 3) {   // structure: the sill and bumper volumes only
    add(boxAt([T.rear - 0.1, 0.4, -1.0], [T.front + 0.05, 0.56, 1.0]), M.plastic);
    return;
  }
  // arch cladding: the same trapezoid, 9 cm wide, standing 4 cm proud of the side wall
  for (const ax of [T.axleF, T.axleR]) for (const sz of [-1, 1]) {
    // an open band (a U over the wheel): the outer edge over the top, then the inner edge back (one simple polygon)
    const inner = archPts(ax, 0.5), outer = inner.map(([x, y], i, a) => [x + (i < a.length / 2 ? 0.09 : -0.09), y + (i === 0 || i === a.length - 1 ? 0 : 0.085)]);
    const sh = new THREE.Shape([...outer, ...inner.slice().reverse()].map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 });
    g.translate(0, 0, Z_LOW - 0.03); if (sz < 0) g.scale(1, 1, -1);
    add(sz < 0 ? flipWinding(g) : g, M.plastic);
  }
  // sills between the arches and from the arches to the ends (black, proud of the wall)
  add(boxAt([T.axleR + 0.66, 0.38, -1.04], [T.axleF - 0.66, 0.57, 1.04]), M.plastic);
  add(boxAt([T.rear + 0.05, 0.36, -0.95], [T.front - 0.05, 0.5, 0.95]), M.plastic);   // underbody
  // the front: a black lower bumper; a full-width white light bar along the nose's top edge
  add(boxAt([T.front - 0.18, 0.36, -1.0], [T.front + 0.06, 0.63, 1.0]), M.plastic);
  add(boxAt([T.front - 0.01, 0.985, -0.88], [T.front + 0.012, 1.012, 0.88]), M.lampWhite);
  // the rear bumper: a deep black block with a plate recess, outer reflectors, a step notch, the hitch receiver
  const RB = T.rear;
  add(boxAt([RB - 0.1, 0.4, -1.0], [RB + 0.2, 0.77, 1.0]), M.plastic);
  add(boxAt([RB - 0.14, 0.55, -0.98], [RB - 0.1, 0.77, 0.98]), M.plastic);                   // the upper lip that stands proud
  add(boxAt([RB - 0.145, 0.6, -0.29], [RB - 0.11, 0.75, 0.29]), M.gap);                      // the plate recess
  add(boxAt([RB - 0.15, 0.62, -0.26], [RB - 0.142, 0.73, 0.26]), M.plate);                   // a blank plate (no characters)
  for (const sz of [-1, 1]) add(boxAt([RB - 0.145, 0.69, sz > 0 ? 0.78 : -0.92], [RB - 0.13, 0.72, sz > 0 ? 0.92 : -0.78]), M.lampRed);   // reflectors
  add(boxAt([RB - 0.16, 0.42, -0.06], [RB - 0.06, 0.5, 0.06]), M.gap);                       // hitch receiver
  // THE tail lamp: one full-width bar across the top of the tailgate, smoked lens in a black housing, a bright
  // satin line under it; it reads dark by day and as one continuous red line when lit
  add(boxAt([RB - 0.03, 1.19, -0.99], [RB + 0.01, 1.285, 0.99]), M.plastic);
  add(boxAt([RB - 0.036, 1.205, -0.97], [RB - 0.02, 1.27, 0.97]), M.lampRed);
  add(boxAt([RB - 0.03, 1.176, -0.98], [RB, 1.19, 0.98]), M.satin);
  // glass frames: black bars round the windscreen, side windows and roof glass (the seals and pillars)
  const fr = (pts) => { for (let i = 0; i < pts.length - 1; i++) add(bar(pts[i], pts[i + 1], 0.035), M.plastic); };
  for (const sz of [-1, 1]) {
    const P = (x, y, z) => [x, y, z * sz];
    fr([P(0.95, yTop(0.95), wTop(0.95)), P(T.apexX, yTop(T.apexX), wTop(T.apexX)), P(-0.95, yTop(-0.95), wTop(-0.95))]);
    fr([0.95, T.apexX, -0.95].map((x) => P(...belt(x))));
    for (const x of [0.95, T.apexX, -0.95]) fr([P(...belt(x)), P(x, yTop(x), wTop(x))]);
    // door seams (front door, rear door) down the side wall; a flush charge-port door on the left rear
    for (const x of [0.93, T.apexX - 0.02, -0.97]) { add(bar([x, 0.58, sz * (Z_LOW + 0.012)], [x, yShoulder(x) - 0.01, sz * (zShoulder(x) + 0.006)], 0.008), M.gap); const [bx, by, bz] = belt(Math.min(0.95, Math.max(-0.95, x))); add(bar([x, yShoulder(x), sz * (zShoulder(x) + 0.004)], [bx, by, sz * (bz + 0.004)], 0.008), M.gap); }
    add(bar([0.93, 0.58, sz * (Z_LOW + 0.012)], [-0.97, 0.58, sz * (Z_LOW + 0.012)], 0.008), M.gap);
    // mirrors: a flat blade on a short stalk at the base of the A pillar
    add(bar([0.9, 1.18, sz * 1.0], [0.86, 1.2, sz * 1.1], 0.03), M.plastic);
    add(boxAt([0.78, 1.15, sz > 0 ? 1.08 : -1.2], [0.9, 1.25, sz > 0 ? 1.2 : -1.08]), M.plastic);
  }
  add(boxAt([-2.32, 0.94, -1.03], [-2.18, 1.04, -1.015]), M.gap);   // charge-port door outline (left rear)
  for (const x of [T.front - 0.02]) add(boxAt([x - 0.006, 0.9, -0.5], [x + 0.006, 0.96, 0.5]), M.gap);   // the frunk seam
  // the vault cover is smooth in the reference (gate 3: slats read as stripes from behind; removed)
  void lit;
}
const flipWinding = (g) => { const n = g.index ? g.toNonIndexed() : g; const p = n.attributes.position; for (let i = 0; i < p.count; i += 3) for (const k of ['X', 'Y', 'Z']) { const a = p['get' + k](i + 1); p['set' + k](i + 1, p['get' + k](i + 2)); p['set' + k](i + 2, a); } n.deleteAttribute('normal'); n.computeVertexNormals(); return n; };

// ---- the tailgate: the steel panel below the light bar, on a hinge pivot ----------------------------------------
function tailgate(pass, M) {
  const g = new THREE.Group(); g.name = 'tailgate'; g.position.set(T.rear, 0.77, 0);
  if (pass === 1) return g;
  const z0 = Z_LOW - 0.005, z1 = zShoulder(T.rear) - 0.005;
  const panel = poly([[0, 0, -z0], [0, 1.176 - 0.77, -z1], [0, 1.176 - 0.77, z1], [0, 0, z0]], new THREE.Vector3(1, 0.2, 0));
  const m = new THREE.Mesh(panel, M.steel); m.name = 'tailgatePanel'; colourise(panel, 0.99); g.add(m);
  return g;
}

// ---- wheels ----------------------------------------------------------------------------------------------------
function wheelGeoms(pass) {
  const R = T.tyreR, W = T.tyreW, hw = W / 2;
  if (pass === 1) return { tyre: new THREE.CylinderGeometry(R, R, W, 24).rotateX(Math.PI / 2), rim: null };
  // tyre: a lathe with rounded shoulders, then lugs (two staggered rows) and shoulder blocks: an all-terrain read
  const prof = [[T.rimR + 0.01, -hw + 0.02], [R - 0.06, -hw], [R - 0.025, -hw + 0.012], [R - 0.012, -hw + 0.04], [R - 0.012, hw - 0.04], [R - 0.025, hw - 0.012], [R - 0.06, hw], [T.rimR + 0.01, hw - 0.02]];
  const parts = [new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 40)];
  if (pass >= 3) {
    const n = 26;
    // the lathe's axis is Y here (turned to Z below): a lug sits on the tread at +X and is swung round Y.
    // Blocks are tangential (x) by radial (y) by across the tread (z... the lathe's Y): built along Y, swung round Y.
    for (let i = 0; i < n; i++) for (const row of [-1, 1]) {
      const a = (i + (row > 0 ? 0.5 : 0)) / n * Math.PI * 2;
      const lug = new THREE.BoxGeometry(0.03, 0.105, 0.075).translate(R - 0.004, row * 0.062, 0);
      const shoulder = new THREE.BoxGeometry(0.026, 0.05, 0.06).translate(R - 0.022, row * (hw - 0.014), 0);
      parts.push(lug.applyMatrix4(new THREE.Matrix4().makeRotationY(a)), shoulder.applyMatrix4(new THREE.Matrix4().makeRotationY(a + 0.08)));
    }
  }
  const tyre = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv)).rotateX(Math.PI / 2);
  tyre.computeVertexNormals();
  // rim: a recessed dark disc, six broad spokes, a hub, six lug nuts, the barrel
  const rp = [];
  rp.push(new THREE.CylinderGeometry(T.rimR, T.rimR, W - 0.06, 32, 1, true));                    // barrel
  rp.push(new THREE.CylinderGeometry(T.rimR * 0.98, T.rimR * 0.98, 0.012, 32).translate(0, -0.035, 0));   // the back of the dish
  rp.push(new THREE.TorusGeometry(T.rimR - 0.01, 0.016, 6, 32).rotateX(Math.PI / 2).translate(0, -hw + 0.03, 0));   // the lip
  if (pass >= 3) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, sp = new THREE.BoxGeometry(0.075, 0.035, T.rimR - 0.05).translate(0, -hw + 0.055, (T.rimR - 0.05) / 2 + 0.04);
      sp.applyMatrix4(new THREE.Matrix4().makeRotationY(a)); rp.push(sp);
      const nut = new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6).translate(0, -hw + 0.05, 0.07).applyMatrix4(new THREE.Matrix4().makeRotationY(a + Math.PI / 6)); rp.push(nut);
    }
    rp.push(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 16).translate(0, -hw + 0.06, 0));   // hub
  }
  const rim = mergeGeometries(rp.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv)).rotateX(Math.PI / 2);
  rim.computeVertexNormals();
  return { tyre, rim };
}
const stripUv = (g) => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; };

// a panel-to-panel tone (vertex colour): stainless sheets never match exactly
function colourise(g, tone) { const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(tone); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }

/** The truck. pass 1..5; lights 0..1 (lamp glow) */
export function createTruck({ pass = 5, lights = 0 } = {}) {
  const M = MATS(pass);
  if (M.lampRed.emissiveIntensity !== undefined && pass >= 4) { M.lampRed.emissiveIntensity = 3 * lights; M.lampWhite.emissiveIntensity = 3 * lights; }
  const root = new THREE.Group(); root.name = 'truck';
  const body = new THREE.Group(); body.name = 'body'; root.add(body);
  const parts = [];
  const add = (g, m, tone = 1) => { if (m === M.steel) colourise(g, tone); else if (g.attributes.color) g.deleteAttribute('color'); parts.push({ g, m }); };
  shell(pass, M, add);
  trim(pass, M, add, lights);
  // each part a mesh (passes 1-4: easy to inspect and pick), merged by material in pass 5
  if (pass >= 5) {
    const byMat = new Map();
    for (const { g, m } of parts) { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); if (m !== M.steel && n.attributes.color) n.deleteAttribute('color'); (byMat.get(m) || byMat.set(m, []).get(m)).push(n); }
    for (const [m, list] of byMat) { const mesh = new THREE.Mesh(mergeGeometries(list), m); mesh.name = 'body:' + m.name; body.add(mesh); }
  } else for (const { g, m } of parts) body.add(new THREE.Mesh(g, m));
  root.add(tailgate(pass, M));
  const W = wheelGeoms(pass);
  for (const [name, x, z, steer] of [['FL', T.axleF, -T.track / 2, true], ['FR', T.axleF, T.track / 2, true], ['RL', T.axleR, -T.track / 2, false], ['RR', T.axleR, T.track / 2, false]]) {
    const wheel = new THREE.Group(); wheel.name = 'wheel_' + name;
    const outward = z < 0 ? -1 : 1;
    const tyre = new THREE.Mesh(W.tyre, M.tyre); tyre.name = 'tyre'; wheel.add(tyre);
    if (W.rim) { const rim = new THREE.Mesh(W.rim, M.rim); rim.name = 'rim'; rim.scale.z = -outward; wheel.add(rim); }   // the spoke face outward
    if (steer) { const s = new THREE.Group(); s.name = 'steer_' + name; s.position.set(x, T.tyreR, z); s.add(wheel); root.add(s); }
    else { wheel.position.set(x, T.tyreR, z); root.add(wheel); }
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  return root;
}

/** triangles and draw calls (one per mesh) */
export function stats(root) {
  let tris = 0, draws = 0; const mats = new Set();
  root.traverse((o) => { if (o.isMesh && o.visible) { draws++; mats.add(o.material); const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
  return { triangles: Math.round(tris), drawCalls: draws, materials: mats.size };
}
