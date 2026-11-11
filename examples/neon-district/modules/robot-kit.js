// robot-kit: the parts every robot in the district is assembled from (not a module). Used by the enemies
// (game/enemies.js, skinned on @miragekit/play's rig), the civilians (machines.js, batched and posed in code) and the
// robot dogs (enemy hounds, the civilian courier).
//   materials  shell: the library's powder coat (dielectric; worn edges show steel; object space so the texture rides
//              on the part), per-vertex colour, a per-vertex roughness (`ndR`: rubber, visor glass, fabric) and printed
//              decals from one canvas (`ndD`: unit numbers, warning labels, the maker's plate); metal: the library's
//              anodised aluminium (the actuator housings' machined faces). Both wet at night (withWet, no puddles).
//   parts      actuators (a drum: a dark housing round a machined face and hub), links (turned, oval), shells
//              (extruded profiles with rounded edges), cable loops, hands with jointed fingers, feet with a rubber sole
//   bodies     humanoid(style, lod): every bone's parts in that bone's own frame (the joint at the origin, a limb
//              hanging along -y, +z forward) for three styles: 'sentinel' (slim, carbon black and graphite, a sensor
//              visor and a ring of cameras), 'warden' (wide shoulders, ring actuators, a ring-light head) and 'home'
//              (a compact domestic humanoid: light shells, black joints in fabric boots, a dark glass face plate);
//              quadruped(style, lod): a robot dog ('scout', 'hauler', 'courier') by segment
//   gait       legIK, a biped gait (stance and swing from the distance travelled, heel strike and toe-off rolled round
//              the heel and the toe, the hip as low as the stance leg's reach makes it, sway, arm swing) and a trot
// Design language learned from current humanoid and legged robots in general (exposed rotary actuators, panel gaps,
// sensor heads instead of faces, battery packs); no maker's shapes, names or marks: the makers here are invented.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURFACES, createSurfaces, withWet } from '@miragekit/core';

const HP = Math.PI / 2, TAU = Math.PI * 2;
const v2 = (pts) => pts.map(([a, b]) => new THREE.Vector2(a, b));
const M4 = (p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
export const tf = (g, p, r, s) => g.applyMatrix4(M4(p, r, s));

// ---------------------------------------------------------------------------------------------------------------
// the printed decals: one 512 canvas (stencils white on transparent: the material tints nothing, it mixes by alpha)
const DA = 512, CELLS = {};
['S-07', 'S-12', 'S-23', 'S-31', 'W-04', 'W-09', 'Q-02', 'Q-15'].forEach((t, i) => { CELLS['n' + i] = [(i % 4) * 128, Math.floor(i / 4) * 64, 128, 64, t]; });
Object.assign(CELLS, { warn: [0, 128, 256, 64], plate: [256, 128, 128, 64], chev: [384, 128, 128, 64], home0: [0, 192, 128, 64], home1: [128, 192, 128, 64], home2: [256, 192, 128, 64], home3: [384, 192, 128, 64],
  lift: [0, 256, 128, 64], volt: [128, 256, 128, 64], homePlate: [256, 256, 256, 64], dog: [0, 320, 256, 64], parcel: [256, 320, 256, 128] });
let decalTex = null;
export function decalTexture() {
  if (decalTex || typeof document === 'undefined') return decalTex;
  const c = document.createElement('canvas'); c.width = c.height = DA;
  const g = c.getContext('2d'), F = '"DIN Condensed", "Arial Narrow", "Helvetica Neue", "PingFang TC", "Noto Sans TC", sans-serif';
  const cell = (k, fn) => { const [x, y, w, h] = CELLS[k]; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); fn(w, h); g.restore(); };
  const text = (s, x, y, size, col, weight = 800, max = 0) => { g.font = `${weight} ${size}px ${F}`; if (max) { const m = g.measureText(s).width; if (m > max) g.font = `${weight} ${size * max / m}px ${F}`; } g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); };
  const bars = (x, y, w, h, seed) => { let s = seed; for (let i = 0; i < w;) { s = (s * 16807) % 2147483647; const bw = 1 + (s % 3); if ((s >> 3) % 2) g.fillRect(x + i, y, bw, h); i += bw + 1; } };
  // unit numbers: a stencil (bridges cut through the strokes), slightly worn
  for (let i = 0; i < 8; i++) cell('n' + i, (w, h) => {
    text(CELLS['n' + i][4], w / 2, h / 2 + 2, 50, '#f2f2ee', 900, w - 10);
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (let x = 14; x < w; x += 17) g.fillRect(x, 0, 2.5, h);
    for (let k = 0; k < 40; k++) { const px = (k * 37.3) % w, py = (k * 23.9) % h; g.globalAlpha = 0.5; g.fillRect(px, py, 2 + (k % 3), 1.5); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  });
  cell('warn', (w, h) => {   // a warning label: a hazard edge, a triangle, two lines
    g.fillStyle = '#e8c21e'; g.fillRect(0, 0, w, h); g.fillStyle = '#121212';
    for (let x = -h; x < w; x += 18) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 9, h); g.lineTo(x + 9 + 14, h - 14); g.lineTo(x + 14, h - 14); g.fill(); }
    g.fillRect(0, 0, w, 4);
    g.beginPath(); g.moveTo(30, 8); g.lineTo(50, 42); g.lineTo(10, 42); g.closePath(); g.fill();
    g.fillStyle = '#e8c21e'; g.fillRect(28.5, 18, 3, 13); g.fillRect(28.5, 34, 3, 3);
    text('HIGH VOLTAGE  高壓危險', 150, 18, 17, '#121212', 900, 180); text('KEEP CLEAR OF JOINTS', 150, 36, 14, '#121212', 800, 180);
  });
  cell('plate', (w, h) => {   // the maker's plate (an invented maker)
    g.fillStyle = '#c9cbc7'; g.fillRect(2, 2, w - 4, h - 4); g.fillStyle = '#1a1b1d';
    text('KORVID SYSTEMS', w / 2, 14, 13, '#1a1b1d', 900, w - 12); text('AX-4 · 48V · IP54', w / 2, 30, 11, '#1a1b1d', 700, w - 12); bars(10, 40, w - 20, 16, 4711);
  });
  cell('chev', (w, h) => { g.fillStyle = '#e8c21e'; for (let x = -h; x < w + h; x += 26) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 0); g.lineTo(x + 12 + h / 2, h / 2); g.lineTo(x + 12, h); g.lineTo(x, h); g.lineTo(x + h / 2, h / 2); g.fill(); } });
  ['H-0417', 'H-0031', 'H-2207', 'H-0815'].forEach((s, i) => cell('home' + i, (w, h) => { text(s, w / 2, h / 2, 34, '#2a2e33', 800, w - 12); }));
  cell('lift', (w, h) => { g.fillStyle = '#f2f2ee'; g.beginPath(); g.moveTo(20, 40); g.lineTo(32, 20); g.lineTo(44, 40); g.fill(); g.fillRect(29, 38, 6, 16); text('LIFT', 82, 34, 28, '#f2f2ee', 900); });
  cell('volt', (w, h) => { g.fillStyle = '#e8c21e'; g.beginPath(); g.moveTo(64, 6); g.lineTo(100, 58); g.lineTo(28, 58); g.closePath(); g.fill(); g.fillStyle = '#121212'; g.beginPath(); g.moveTo(68, 20); g.lineTo(58, 40); g.lineTo(66, 40); g.lineTo(60, 54); g.lineTo(74, 34); g.lineTo(66, 34); g.closePath(); g.fill(); });
  cell('homePlate', (w, h) => { text('MIRU HOME', 70, h / 2, 26, '#3a3f45', 800); g.fillStyle = '#3a3f45'; bars(140, 18, 100, 28, 97); });
  cell('dog', (w, h) => { text('QUADRA · Q-SERIES', w / 2, 20, 22, '#f2f2ee', 900, w - 16); text('DO NOT STAND ON  勿踩踏', w / 2, 46, 16, '#e8c21e', 800, w - 16); });
  cell('parcel', (w, h) => {
    g.fillStyle = '#e9e5da'; g.fillRect(0, 0, w, h); g.fillStyle = '#2b6fd6'; g.fillRect(0, 0, w, 16);
    text('速達 EXPRESS', w * 0.4, 46, 28, '#14181c', 900, 180); text('便 07-B · 2F', w * 0.4, 78, 18, '#14181c', 700, 180);
    g.fillStyle = '#14181c'; bars(16, 92, 170, 26, 4711); text('↑', 222, 72, 60, '#14181c', 900);
  });
  decalTex = new THREE.CanvasTexture(c); decalTex.colorSpace = THREE.SRGBColorSpace; decalTex.anisotropy = 8;
  return decalTex;
}
/** uv rectangle [u0, v0, u1, v1] of a decal cell */
export const decalUV = (k, inset = 2) => { const [x, y, w, h] = CELLS[k]; return [(x + inset) / DA, 1 - (y + h - inset) / DA, (x + w - inset) / DA, 1 - (y + inset) / DA]; };

// ---------------------------------------------------------------------------------------------------------------
// materials: one surface library per renderer
const LIBS = new WeakMap();
export function surfaceLib(world) { let l = LIBS.get(world.renderer); if (!l) LIBS.set(world.renderer, (l = createSurfaces(world))); return l; }
const ATTR = { vertexDecl: ' attribute float ndR; attribute vec3 ndD; varying float vNdR; varying vec3 vNdD;', vertexWorld: '\n vNdR = ndR; vNdD = ndD; msOP = position; msON = normal;\n' };
/** extend library hooks: the texture rides on the bind pose (skinned, batched: it sticks to the part), per-vertex
 *  roughness, decals, an optional rim (the enemies' outline) */
function extend(h, { decals = false, rim = null } = {}) {
  const o = { ...h, uniforms: { ...h.uniforms } };
  o.vertexDecl = (h.vertexDecl || '') + ATTR.vertexDecl;
  o.vertexWorld = (h.vertexWorld || '') + ATTR.vertexWorld;
  o.fragmentDecl = (h.fragmentDecl || '') + '\nvarying float vNdR; varying vec3 vNdD;' + (decals ? ' uniform sampler2D ndDecalT;' : '') + (rim ? ' uniform vec3 uNdRim;' : '');
  if (decals) {
    o.uniforms.ndDecalT = { value: decalTexture() };
    o.albedo = (h.albedo || '') + '\nif (vNdD.z > 0.5) { vec4 ndDc = texture2D(ndDecalT, vNdD.xy); diffuseColor.rgb = mix(diffuseColor.rgb, ndDc.rgb, ndDc.a); }';
  }
  o.roughness = (h.roughness || '') + '\nif (vNdR > 0.0) roughnessFactor = vNdR;';
  o.metalness = (h.metalness || '') + '\nif (vNdR > 0.0 || vNdD.z > 0.5) metalnessFactor = 0.0;';
  if (rim) { o.uniforms.uNdRim = rim; o.output = (h.output || '') + '\noutgoingLight += uNdRim * pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.2);'; }
  return o;
}
const wet = (h, porosity) => withWet(h, { porosity, height: 'msH', heightMid: 0.5, heightScale: 0.004, puddles: 0, band: 0.15 });
/** shell: powder coat over the vertex colour; metal: anodised aluminium. opts: rim (a { value: Vector3 } uniform) */
export function robotMaterials(world, { rim = null, key = 'default' } = {}) {
  const cache = (world.__ndRobotMats ||= {});
  if (cache[key]) return cache[key];
  const lib = surfaceLib(world), mat = world.mat;
  const shellH = extend(lib.hooks(SURFACES.powderCoat({ variant: 'powder', color: [0.8, 0.8, 0.8], roughness: 0.42, dirt: 0, edgeWear: 0.6 }), { space: 'object', mode: 'procedural' }), { decals: true, rim });
  const metalH = extend(lib.hooks(SURFACES.aluminium({ variant: 'anodised', color: [0.62, 0.63, 0.66], roughness: 0.34, dirt: 0 }), { space: 'object', mode: 'procedural' }), { rim });
  const shell = mat.std({ vertexColors: true, roughness: 1, metalness: 1 }, wet(shellH, 0.08)); shell.name = 'robot-shell';
  const metal = mat.std({ vertexColors: true, roughness: 1, metalness: 1 }, wet(metalH, 0.05)); metal.name = 'robot-metal';
  return (cache[key] = { shell, metal });
}

// ---------------------------------------------------------------------------------------------------------------
// geometry: every part non-indexed with position, normal, uv, color, ndR, ndD
const C = (r, g = r, b = r) => [r, g, b];
export const COL = {
  carbon: C(0.022, 0.023, 0.026), graphite: C(0.075, 0.079, 0.086), grey: C(0.2, 0.21, 0.22), rubber: C(0.02, 0.02, 0.021), glass: C(0.012, 0.013, 0.016),
  white: C(0.72, 0.72, 0.7), pale: C(0.55, 0.56, 0.57), fabric: C(0.16, 0.165, 0.17), joint: C(0.03, 0.03, 0.033), amber: C(0.75, 0.42, 0.04), mud: C(0.11, 0.085, 0.06),
  natural: C(1, 1, 1), dark: C(0.32, 0.33, 0.36), gun: C(0.16, 0.16, 0.17),
};
/** finish a geometry as a part: slot 's' (shell) | 'm' (metal) | 'l' (lights); c colour; r roughness (0: the
 *  material's); d a decal cell (its uv over the plane's own uv); mud: [y0, y1] a mud gradient below y1 (bone frame) */
export function part(g, slot, c = COL.carbon, { r = 0, d = null, mud = null } = {}) {
  let x = g.index ? g.toNonIndexed() : g;
  if (!x.attributes.normal) x.computeVertexNormals();
  const n = x.attributes.position.count, col = new Float32Array(n * 3), nr = new Float32Array(n).fill(r), nd = new Float32Array(n * 3);
  const P = x.attributes.position, U = x.attributes.uv;
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (mud) { const y = P.getY(i), t = Math.min(1, Math.max(0, (y - mud[0]) / (mud[1] - mud[0]))); k = t; }
    for (let j = 0; j < 3; j++) col[i * 3 + j] = c[j] * k + COL.mud[j] * (1 - k) * (c[j] > 0.3 ? 1.6 : 1);
  }
  if (d && U) { const R = decalUV(d); for (let i = 0; i < n; i++) { nd[i * 3] = R[0] + U.getX(i) * (R[2] - R[0]); nd[i * 3 + 1] = R[1] + U.getY(i) * (R[3] - R[1]); nd[i * 3 + 2] = 1; } }
  for (const k of Object.keys(x.attributes)) if (!['position', 'normal'].includes(k)) x.deleteAttribute(k);
  x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  x.setAttribute('color', new THREE.BufferAttribute(col, 3)); x.setAttribute('ndR', new THREE.BufferAttribute(nr, 1)); x.setAttribute('ndD', new THREE.BufferAttribute(nd, 3));
  return { g: x, slot };
}
/** merge parts of one slot (and a transform each) into one geometry */
export function mergeParts(list) {
  const n = list.reduce((s, p) => s + p.g.attributes.position.count, 0), out = new THREE.BufferGeometry();
  for (const [k, w] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['ndR', 1], ['ndD', 3]]) {
    const a = new Float32Array(n * w); let o = 0;
    for (const p of list) { a.set(p.g.attributes[k].array, o); o += p.g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(a, w));
  }
  return out;
}
/** move a part list by a matrix (a copy) */
/** a part moved by t (in place) */
const mv = (pp, t) => { pp.g.translate(...t); return pp; };
export const moved = (list, m) => list.map((p) => ({ ...p, g: p.g.clone().applyMatrix4(m) }));

// primitives (indexed or not: part() makes them flat lists)
const lathe = (pts, seg, a0 = 0, a1 = TAU) => new THREE.LatheGeometry(v2(pts), seg, a0, a1);
/** an extruded profile with rounded edges: plane 'xy' (depth along z), 'zy' (a side profile [z, y], across x), 'xz' */
export function ext(pts, depth, bevel = 0.01, plane = 'xy', segs = 2) {
  const b = Math.min(bevel, depth * 0.45), g = new THREE.ExtrudeGeometry(new THREE.Shape(v2(pts)), { depth: Math.max(1e-4, depth - 2 * b), steps: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: segs, curveSegments: 4 });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  if (plane === 'zy') g.rotateY(-HP); else if (plane === 'xz') g.rotateX(HP);
  return g;
}
const rb = (w, h, d, r, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, 0.49 * Math.min(w, h, d)));
const cyl = (r0, r1, len, seg, open = false) => new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);   // r0 bottom, r1 top, along y
const axisTo = (g, axis) => (axis === 'x' ? g.rotateZ(-HP) : axis === 'z' ? g.rotateX(HP) : g);
/** an actuator: a dark housing ring round a machined face with a hub on each side, axis along `axis`, at p */
export function drum(r, w, q, axis = 'x', p = [0, 0, 0], { housing = COL.carbon, face = COL.natural, hub = COL.dark, ring = true } = {}) {
  const seg = [8, 10, 16][q], hw = w / 2, out = [];
  out.push(part(tf(axisTo(lathe([[r * 0.8, -hw], [r * 0.97, -hw + 0.004], [r, -hw * 0.6], [r, hw * 0.6], [r * 0.97, hw - 0.004], [r * 0.8, hw]], seg), axis), p), 's', housing));
  if (q > 0) {
    out.push(part(tf(axisTo(lathe([[0, hw + 0.006], [r * 0.3, hw + 0.006], [r * 0.34, hw + 0.002], [r * 0.5, hw], [r * 0.8, hw - 0.004], [r * 0.8, -hw + 0.004], [r * 0.5, -hw], [r * 0.34, -hw - 0.002], [r * 0.3, -hw - 0.006], [0, -hw - 0.006]].reverse(), seg), axis), p), 'm', face));
    if (ring && q > 1) out.push(part(tf(axisTo(new THREE.TorusGeometry(r * 0.66, r * 0.035, 3, seg).rotateX(HP), axis), p).translate(...(axis === 'x' ? [hw + 0.001, 0, 0] : axis === 'z' ? [0, 0, hw + 0.001] : [0, hw + 0.001, 0])), 'm', hub));
  } else out.push(part(tf(axisTo(cyl(r * 0.8, r * 0.8, w + 0.006, seg), axis), p), 'm', face));
  return out;
}
/** a turned link from y0 down to y1 (y1 < y0), radius r0 -> r1, oval (sx, sz) */
export const link = (r0, r1, y0, y1, seg, c, sx = 1, sz = 1, slot = 's', opts = {}) => part(tf(lathe([[0, y1], [r1 * 0.8, y1], [r1, y1 + 0.012], [r0, y0 - 0.012], [r0 * 0.8, y0], [0, y0]], seg), [0, 0, 0], [0, 0, 0], [sx, 1, sz]), slot, c, opts);
/** an oval turned cover: profile [[r, y], ...] bottom to top (closed at both ends), scaled (sx, sz), moved to p;
 *  `seam` a y at which a dark panel gap runs round it */
export function cover(pts, seg, c, sx = 1, sz = 1, p = [0, 0, 0], { seam = null, opts = {} } = {}) {
  const out = [part(tf(lathe(pts, seg), p, [0, 0, 0], [sx, 1, sz]), 's', c, opts)];
  if (seam != null) {
    let r = 0; for (let i = 1; i < pts.length; i++) { const [r0, y0] = pts[i - 1], [r1, y1] = pts[i]; if ((y0 - seam) * (y1 - seam) <= 0 && y1 !== y0) r = r0 + (r1 - r0) * (seam - y0) / (y1 - y0); }
    if (r > 0) out.push(part(tf(new THREE.TorusGeometry(r * 1.004, 0.0022, 3, seg).rotateX(HP), [p[0], p[1] + seam, p[2]], [0, 0, 0], [sx, 1, sz]), 's', COL.glass));
  }
  return out;
}
/** a cable from a to b bulging by `bulge` (a vector) */
export function cable(a, b, bulge, r, q, c = COL.rubber) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), M = A.clone().add(B).multiplyScalar(0.5).add(new THREE.Vector3(...bulge));
  return part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([A, A.clone().lerp(M, 0.6).add(new THREE.Vector3(...bulge).multiplyScalar(0.3)), M, B.clone().lerp(M, 0.6).add(new THREE.Vector3(...bulge).multiplyScalar(0.3)), B]), [4, 6, 8][q], r, [3, 4, 5][q], false), 's', c, { r: 0.6 });
}
/** a printed decal: a w x h plane facing `rot` at p (1.5 mm proud of the surface the caller places it on) */
export const decal = (k, w, h, p, rot = [0, 0, 0]) => part(tf(new THREE.PlaneGeometry(w, h), p, rot), 's', COL.white, { d: k });

// ---------------------------------------------------------------------------------------------------------------
// a hand at the wrist, hanging along -y, palm toward -x * s (the body), fingers curled by `curl` (0 open .. 1 a fist)
function hand(s, q, curl, shell, k = 1) {
  const out = [], seg = (a, b, r) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), g = cyl(r, r * 0.86, d.length(), q > 1 ? 6 : 4);
    g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)));
    out.push(part(g, 's', COL.joint, { r: 0.55 }));
  };
  out.push(part(tf(rb(0.03 * k, 0.085 * k, 0.07 * k, 0.012 * k, q > 1 ? 2 : 1), [0, -0.055 * k, 0]), 's', shell));   // the back of the hand: a shell
  out.push(part(tf(rb(0.022 * k, 0.07 * k, 0.062 * k, 0.008 * k), [-s * 0.012 * k, -0.05 * k, 0]), 's', COL.joint, { r: 0.6 }));   // the palm pad
  if (q === 0) return out;
  // four fingers: three phalanges each, curling toward the palm (-x * s)
  for (let i = 0; i < 4; i++) {
    const z = (-0.024 + i * 0.016) * k, len = [0.03, 0.034, 0.032, 0.026][i] * k;
    let p = new THREE.Vector3(0, -0.095 * k, z), a = 0;
    for (let j = 0; j < (q > 1 ? 3 : 2); j++) {
      a += curl * [0.9, 1.0, 0.7][j];
      const n = p.clone().add(new THREE.Vector3(-s * Math.sin(a) * len, -Math.cos(a) * len, 0));
      seg(p.toArray(), n.toArray(), (0.0085 - j * 0.0012) * k); p = n;
    }
  }
  // the thumb: from the palm's front edge, across
  const t0 = [-s * 0.012 * k, -0.035 * k, 0.034 * k], t1 = [-s * (0.02 + 0.02 * curl) * k, -0.065 * k, 0.05 * k], t2 = [-s * (0.03 + 0.025 * curl) * k, -0.09 * k, 0.04 * k];
  seg(t0, t1, 0.01 * k); seg(t1, t2, 0.0085 * k);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
/** The rig's joints (rest, metres): the humanoid bodies are built round these, so the enemies skin to the rig and
 *  the civilians pose the same frames in code */
export const JOINTS = {
  Hips: [0, 0.95, 0], Spine: [0, 1.08, 0], Chest: [0, 1.25, 0], Neck: [0, 1.46, 0], Head: [0, 1.54, 0],
  UpLeg: [0.1, 0.92, 0], Leg: [0.1, 0.5, 0], Foot: [0.1, 0.08, 0], Toe: [0.1, 0.02, 0.13], Arm: [0.19, 1.4, 0], ForeArm: [0.47, 1.4, 0], Hand: [0.73, 1.4, 0],
};
export const LEN = { thigh: 0.42, shin: 0.42, ankle: 0.08, upper: 0.28, fore: 0.26 };
const BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', ...['Left', 'Right'].flatMap((s) => ['UpLeg', 'Leg', 'Foot', 'Toe', 'Arm', 'ForeArm', 'Hand'].map((b) => s + b))];

/**
 * A humanoid robot's parts per bone, each in its bone's frame (see JOINTS; limbs hang along -y).
 * style: 'sentinel' | 'warden' | 'home'; lod 0 (near, ~5 k triangles) | 1 | 2 (far, a few hundred);
 * kit: { shield, mast, number (decal cell), grip (the right hand's curl), id (home: label cell) }
 */
export function humanoid(style, lod, kit = {}) {
  const q = 2 - lod, P = Object.fromEntries(BONES.map((b) => [b, []])), add = (b, list) => P[b].push(...(Array.isArray(list) ? list : [list]));
  const home = style === 'home', heavy = style === 'warden';
  const SH = home ? COL.white : COL.graphite, SH2 = home ? COL.pale : COL.carbon, JT = home ? COL.joint : COL.carbon;
  const dr = (r, w, axis, p, o) => (home ? [part(tf(axisTo(lathe([[r * 0.75, -w / 2], [r, -w * 0.35], [r * 1.02, 0], [r, w * 0.35], [r * 0.75, w / 2]], [6, 8, 12][q]), axis), p), 's', COL.fabric, { r: 0.92 }), part(tf(axisTo(cyl(r * 0.76, r * 0.76, w + 0.004, [6, 8, 12][q]), axis), p), 's', JT)] : drum(r, w, q, axis, p, o));
  const sc = heavy ? 1.18 : home ? 1.06 : 1;   // limb girth

  // ---- pelvis and waist
  add('Hips', cover([[0, -0.125], [0.05, -0.12], [0.1, -0.075], [0.13, -0.01], [0.13, 0.035], [0.11, 0.065], [0, 0.07]], [8, 12, 18][q], SH, home ? 1.15 : 1.12, home ? 0.9 : 0.78, [0, 0, 0], { seam: q > 1 ? 0.0 : null }));
  if (q > 0) add('Hips', mv(part(ext([[-0.06, 0.03], [0.06, 0.03], [0.05, -0.09], [-0.05, -0.09]], 0.05, 0.012), 's', SH2), [0, 0, home ? 0.12 : 0.1]));
  for (const s of [-1, 1]) add('Hips', dr(0.05 * sc, 0.06, 'y', [s * 0.1, -0.06, 0], { housing: JT }));
  if (heavy) {   // the torso turns on a big bearing ring
    add('Spine', dr(0.15, 0.06, 'y', [0, 0.05, 0], { housing: COL.carbon }));
    add('Spine', part(lathe([[0.1, 0.08], [0.13, 0.1], [0.12, 0.16], [0.1, 0.17]], [6, 8, 14][q]), 's', COL.rubber, { r: 0.75 }));
  } else {
    add('Spine', dr(home ? 0.085 : 0.07, 0.05, 'y', [0, 0.025, 0], { housing: JT }));
    add('Spine', part(lathe(home ? [[0.075, 0.05], [0.1, 0.07], [0.09, 0.1], [0.1, 0.13], [0.09, 0.16], [0.075, 0.175]] : [[0.06, 0.05], [0.08, 0.065], [0.07, 0.09], [0.08, 0.115], [0.07, 0.14], [0.08, 0.16], [0.06, 0.175]], [6, 8, 12][q]), 's', home ? COL.fabric : COL.rubber, { r: home ? 0.92 : 0.75 }));   // a bellows
  }

  // ---- the chest: a deep shell, the shoulder housings, the back pack, the neck base
  const W = heavy ? 0.25 : home ? 0.17 : 0.165;
  const chest = home ? [[0, -0.02], [0.09, -0.015], [0.125, 0.03], [0.148, 0.1], [0.15, 0.16], [0.13, 0.2], [0.08, 0.218], [0, 0.22]]
    : [[0, -0.02], [0.095, -0.015], [0.12, 0.03], [0.145, 0.1], [0.15, 0.165], [0.135, 0.2], [0.09, 0.218], [0, 0.222]];
  add('Chest', cover(chest, [8, 12, 20][q], SH, W / 0.15, heavy ? 0.85 : home ? 0.88 : 0.74, [0, 0, 0], { seam: q > 1 ? 0.06 : null }));
  const fz = 0.15 * (heavy ? 0.85 : home ? 0.88 : 0.74);   // the chest's front
  if (!home) {   // a breast plate over the shell
    add('Chest', mv(part(ext([[-W * 0.8, 0.2], [W * 0.8, 0.2], [W * 0.85, 0.1], [W * 0.45, 0.02], [-W * 0.45, 0.02], [-W * 0.85, 0.1]], 0.03, 0.01, 'xy', q > 1 ? 2 : 1), 's', heavy ? COL.graphite : COL.carbon), [0, 0, fz - 0.004]));
    if (q > 0) add('Chest', decal(kit.number || 'n0', 0.1, 0.05, [W * 0.42, 0.15, fz + 0.0125], [0, 0, 0]));
  } else if (q > 0) add('Chest', decal(kit.id || 'home0', 0.08, 0.04, [0.075, 0.165, fz - 0.012], [-0.15, 0.5, 0]));
  for (const s of [-1, 1]) {
    add('Chest', dr((heavy ? 0.095 : 0.07) * (home ? 0.95 : 1), heavy ? 0.1 : 0.07, 'x', [s * (W + 0.02), 0.15, 0], { housing: JT }));
    if (heavy) add('Chest', mv(part(ext([[-0.1, 0], [0.1, 0], [0.12, 0.08], [0.06, 0.12], [-0.08, 0.11], [-0.12, 0.05]], 0.14, 0.02, 'zy', q > 1 ? 2 : 1), 's', COL.graphite), [s * (W + 0.03), 0.17, 0]));
  }
  add('Chest', dr(0.045, 0.05, 'y', [0, 0.215, 0], { housing: JT }));
  // the battery pack on the back: a rounded case with ribs, a handle, two status lights, a warning label
  const pz = heavy ? -0.21 : home ? -0.165 : -0.17, pw = heavy ? 0.3 : 0.22, ph = heavy ? 0.26 : 0.22;
  add('Chest', part(tf(rb(pw, ph, 0.08, 0.025, q > 1 ? 2 : 1), [0, 0.1, pz]), 's', home ? COL.pale : COL.carbon));
  if (q > 0) {
    if (!home) for (let i = 0; i < 4; i++) add('Chest', part(tf(rb(pw - 0.04, 0.012, 0.012, 0.004), [0, 0.03 + i * 0.04, pz - 0.043]), 's', COL.graphite));
    add('Chest', cable([-0.05, ph / 2 + 0.1, pz - 0.02], [0.05, ph / 2 + 0.1, pz - 0.02], [0, 0.03, -0.01], 0.008, q, home ? COL.joint : COL.graphite));
    add('Chest', part(tf(rb(0.03, 0.012, 0.004, 0.002), [-pw / 2 + 0.03, 0.17, pz - 0.041]), 'l', [1, 1, 1]));
    add('Chest', part(tf(rb(0.03, 0.012, 0.004, 0.002), [-pw / 2 + 0.07, 0.17, pz - 0.041]), 'l', [0.4, 0.4, 0.4]));
    add('Chest', decal(home ? 'homePlate' : 'warn', home ? 0.14 : 0.13, 0.035, [0.03, 0.1, pz - 0.0415], [0, Math.PI, 0]));
    if (!home) add('Chest', decal(kit.number || 'n0', 0.12, 0.06, [0, 0.19, pz - 0.0405 + 0.0], [0, Math.PI, 0]));
    // cables from the pack into the shoulder housings
    for (const s of [-1, 1]) add('Chest', cable([s * pw * 0.35, ph / 2 + 0.08, pz + 0.03], [s * (W + 0.0), 0.2, -0.04], [s * 0.03, 0.05, -0.02], home ? 0.007 : 0.009, q, home ? COL.joint : COL.rubber));
  }
  if (!home && !heavy && q > 0) for (const s of [-1, 1]) {   // two short antennas on the pack's shoulders
    add('Chest', part(tf(cyl(0.004, 0.0025, 0.16, 4), [s * pw * 0.4, ph / 2 + 0.18, pz - 0.01]), 'm', COL.dark));
    add('Chest', part(tf(new THREE.SphereGeometry(0.007, 6, 4), [s * pw * 0.4, ph / 2 + 0.265, pz - 0.01]), 'l', [1, 1, 1]));
  }
  if (kit.mast) {   // the marksman: a tall sensor mast on the pack, a sensor pod with three lenses
    add('Chest', part(tf(cyl(0.012, 0.01, 0.55, [4, 6, 8][q]), [-0.07, 0.48, pz - 0.02]), 'm', COL.dark));
    add('Chest', part(tf(rb(0.09, 0.06, 0.07, 0.015), [-0.07, 0.77, pz - 0.01]), 's', COL.carbon));
    for (const x of [-0.025, 0, 0.025]) add('Chest', part(tf(cyl(0.01, 0.01, 0.01, 8).rotateX(HP), [-0.07 + x, 0.77, pz + 0.027]), 'l', [1, 1, 1]));
  }
  if (kit.shield) {   // the shield kit: plates over the chest and the shoulders, amber chevrons
    add('Chest', mv(part(ext([[-W, 0.22], [W, 0.22], [W + 0.02, 0.1], [W * 0.5, -0.01], [-W * 0.5, -0.01], [-W - 0.02, 0.1]], 0.025, 0.008, 'xy', q > 1 ? 2 : 1), 's', COL.graphite), [0, 0, fz + 0.012]));
    if (q > 0) add('Chest', decal('chev', 0.18, 0.04, [0, 0.04, fz + 0.026]));
  }

  // ---- neck and head
  add('Neck', dr(0.035, 0.05, 'x', [0, 0.04, 0], { housing: JT }));
  if (q > 0) for (const s of [-1, 1]) add('Neck', cable([s * 0.03, -0.01, -0.03], [s * 0.025, 0.09, -0.04], [s * 0.015, 0, -0.02], 0.005, q, JT));
  if (heavy) {   // a ring-light sensor head: a flat puck, a dark face disc, the lit ring round it
    add('Head', part(tf(lathe([[0, 0.02], [0.09, 0.02], [0.11, 0.04], [0.115, 0.1], [0.1, 0.15], [0, 0.155]], [8, 10, 16][q]), [0, 0, 0], [0, 0, 0], [1, 1, 0.92]), 's', COL.graphite));
    add('Head', part(tf(cyl(0.085, 0.085, 0.03, [8, 12, 20][q]).rotateX(HP), [0, 0.085, 0.095]), 's', COL.glass, { r: 0.06 }));
    add('Head', part(tf(new THREE.TorusGeometry(0.083, 0.008, 4, [8, 14, 24][q]), [0, 0.085, 0.112]), 'l', [1, 1, 1]));
    if (q > 0) add('Head', part(tf(cyl(0.02, 0.02, 0.01, 10).rotateX(HP), [0, 0.085, 0.112]), 'l', [0.5, 0.5, 0.5]));
  } else if (home) {   // a rounded helmet, a dark glass face plate, a soft status bar under it
    add('Head', part(tf(lathe([[0, -0.005], [0.07, 0.0], [0.11, 0.03], [0.122, 0.09], [0.115, 0.15], [0.085, 0.19], [0.04, 0.205], [0, 0.207]], [8, 10, 16][q]), [0, 0, 0], [0, 0, 0], [1, 1, 1.05]), 's', COL.white));
    add('Head', part(tf(lathe([[0.112, 0.025], [0.126, 0.05], [0.13, 0.11], [0.122, 0.16], [0.105, 0.18]], [4, 6, 10][q], -0.95, 1.9), [0, 0, 0.004], [0, 0, 0], [1, 1, 1.05]), 's', COL.glass, { r: 0.05 }));
    add('Head', part(tf(rb(0.07, 0.008, 0.004, 0.002), [0, 0.07, 0.137]), 'l', [1, 1, 1]));
    if (q > 0) for (const s of [-1, 1]) add('Head', dr(0.035, 0.025, 'x', [s * 0.12, 0.1, -0.01], { housing: COL.pale }));
  } else {   // the sentinel: a narrow head, a wraparound visor, a ring of cameras, a crest
    add('Head', part(tf(lathe([[0, 0.0], [0.06, 0.005], [0.085, 0.04], [0.092, 0.11], [0.085, 0.16], [0.055, 0.19], [0, 0.198]], [8, 10, 16][q]), [0, 0, 0], [0, 0, 0], [0.92, 1, 1.12]), 's', COL.carbon));
    add('Head', part(tf(lathe([[0.083, 0.07], [0.094, 0.085], [0.096, 0.115], [0.09, 0.13]], [4, 6, 10][q], -1.15, 2.3), [0, 0, 0.004], [0, 0, 0], [0.95, 1, 1.15]), 's', COL.glass, { r: 0.05 }));
    add('Head', part(tf(lathe([[0.0935, 0.098], [0.0945, 0.104]], [4, 6, 10][q], -0.85, 1.7), [0, 0, 0.004], [0, 0, 0], [0.95, 1, 1.15]), 'l', [1, 1, 1]));
    if (q > 0) {
      for (let i = 0; i < 6; i++) { const a = -2.4 + i * 0.96, x = Math.sin(a) * 0.088 * 0.92, z = Math.cos(a) * 0.088 * 1.12; if (Math.abs(a) < 1) continue; add('Head', part(tf(cyl(0.011, 0.011, 0.012, 8).rotateX(HP), [x, 0.15, z], [0, a, 0]), 's', COL.glass, { r: 0.05 })); add('Head', part(tf(new THREE.TorusGeometry(0.009, 0.0016, 3, 8), [x * 1.07, 0.15, z * 1.07], [0, a, 0]), 'l', [0.6, 0.6, 0.6])); }
      add('Head', part(ext([[0.08, 0.17], [0.02, 0.215], [-0.09, 0.2], [-0.105, 0.15]], 0.03, 0.008, 'zy', 1), 's', COL.graphite));
      add('Head', decal(kit.number || 'n0', 0.05, 0.025, [0.084, 0.06, -0.02], [0, HP + 0.25, 0]));
    }
  }

  // ---- arms and legs, both sides (s = +1 the robot's left, +x)
  for (const [S, s] of [['Left', 1], ['Right', -1]]) {
    const Arm = S + 'Arm', Fore = S + 'ForeArm', Hand = S + 'Hand', Up = S + 'UpLeg', Leg = S + 'Leg', Foot = S + 'Foot', Toe = S + 'Toe', seg = [5, 7, 10][q];
    // upper arm: the shoulder's rotor, a link, an outer shell, the elbow's housing
    add(Arm, dr(0.055 * sc, 0.06, 'x', [s * 0.005, -0.01, 0], { housing: JT }));
    add(Arm, cover([[0, -0.238], [0.032, -0.235], [0.042, -0.2], [0.047, -0.12], [0.045, -0.06], [0.036, -0.04], [0, -0.038]].map(([r, y]) => [r * sc, y]), seg + 2, SH, 1, 1.12, [0, 0, 0], { seam: q > 1 ? -0.14 : null }));
    add(Arm, dr(0.045 * sc, 0.075 * sc, 'x', [0, -LEN.upper, 0], { housing: JT }));
    if (q > 1 && !home) add(Arm, cable([s * 0.03, -0.05, -0.035], [s * 0.035, -0.25, -0.03], [s * 0.02, 0, -0.03], 0.005, q, COL.rubber));
    // forearm: a link, a shell (thick with a tool mount on the warden), the wrist
    const fk = heavy ? 1.32 : sc;
    add(Fore, cover([[0, -0.222], [0.03, -0.218], [0.038, -0.18], [0.046, -0.1], [0.044, -0.05], [0.034, -0.03], [0, -0.028]].map(([r, y]) => [r * fk, y]), seg + 2, SH, 1, 1.1, [0, 0, 0.004], { seam: q > 1 ? -0.12 : null }));
    if (heavy && q > 0) {   // a tool mount: a rail with a clamp under the forearm
      add(Fore, part(tf(rb(0.04, 0.14, 0.03, 0.008), [0, -0.12, -0.075]), 'm', COL.dark));
      add(Fore, part(tf(rb(0.05, 0.03, 0.045, 0.01), [0, -0.09, -0.09]), 's', COL.carbon));
    }
    if (kit.shield && s > 0) {   // the left forearm carries the shield's emitter: a curved plate and a lens
      add(Fore, mv(part(ext([[0.07, -0.02], [0.075, -0.12], [0.06, -0.21], [-0.06, -0.21], [-0.075, -0.12], [-0.07, -0.02]], 0.03, 0.01, 'zy', 1), 's', COL.graphite), [0.065, 0, 0]));
      add(Fore, part(tf(cyl(0.022, 0.022, 0.012, 10).rotateZ(-HP), [0.084, -0.12, 0]), 'l', [1, 1, 1]));
    }
    add(Fore, dr(0.03 * sc, 0.035, 'y', [0, -LEN.fore + 0.02, 0], { housing: JT }));
    add(Hand, hand(s, q, s < 0 ? kit.grip ?? 0.85 : kit.grip2 ?? 0.45, home ? COL.pale : COL.graphite, heavy ? 1.15 : home ? 0.95 : 1));
    // thigh: the hip pitch actuator, a link, a front shell, the knee housing, a cable loop outside
    add(Up, dr(0.065 * sc, 0.075, 'x', [s * 0.02, 0, 0], { housing: JT }));
    add(Up, cover([[0, -0.37], [0.045, -0.366], [0.056, -0.32], [0.066, -0.2], [0.068, -0.11], [0.06, -0.06], [0.045, -0.045], [0, -0.042]].map(([r, y]) => [r * sc, y]), seg + 2, SH, 0.92, 1.18, [0, 0, 0.008], { seam: q > 1 ? -0.24 : null }));
    if (q > 0 && !home) add(Up, decal('volt', 0.035, 0.03, [s * 0.056 * sc, -0.14, 0.02], [0, s * HP, 0]));
    add(Up, dr(0.055 * sc, 0.085 * sc, 'x', [0, -LEN.thigh, 0], { housing: JT }));
    if (q > 1 && !home) add(Up, cable([s * 0.04, -0.06, -0.04], [s * 0.04, -0.38, -0.04], [s * 0.035, 0, -0.03], 0.0065, q, COL.rubber));
    // shin: a link, a front shell (mud low down), a linear actuator behind (the ankle's push rod), the ankle
    add(Leg, cover([[0, -0.372], [0.036, -0.368], [0.044, -0.32], [0.054, -0.17], [0.054, -0.09], [0.046, -0.05], [0, -0.045]].map(([r, y]) => [r * sc, y]), seg + 2, SH, 0.88, 1.22, [0, 0, 0.012], { seam: q > 1 ? -0.12 : null, opts: { mud: [-0.37, -0.12] } }));
    if (q > 0 && !home) {
      add(Leg, part(tf(cyl(0.016, 0.016, 0.16, [4, 6, 8][q]), [0, -0.16, -0.055]), 's', COL.carbon));
      add(Leg, part(tf(cyl(0.008, 0.008, 0.14, [4, 6, 8][q]), [0, -0.29, -0.055]), 'm', COL.natural));
    }
    add(Leg, dr(0.04 * sc, 0.07, 'x', [0, -LEN.shin, 0], { housing: JT }));
    // foot: an ankle housing, an upper shell, a rubber sole; the toe plate with its own sole
    add(Foot, part(ext([[-0.075, -0.07], [0.13, -0.07], [0.13, -0.035], [0.06, -0.01], [0.0, 0.02], [-0.06, 0.01], [-0.08, -0.03]], home ? 0.1 : 0.09 * sc, 0.015, 'zy', q > 1 ? 2 : 1), 's', SH2, { mud: [-0.08, 0.0] }));
    add(Foot, part(tf(rb(0.095 * sc, 0.014, 0.215, 0.006), [0, -0.075, 0.025]), 's', COL.rubber, { r: 0.85, mud: [-0.085, -0.06] }));
    add(Toe, part(ext([[0.0, -0.005], [0.075, -0.005], [0.085, 0.012], [0.06, 0.03], [0.0, 0.035]].map(([z, y]) => [z, y - 0.012]), 0.09 * sc, 0.01, 'zy', 1), 's', SH2, { mud: [-0.03, 0.03] }));
    add(Toe, part(tf(rb(0.09 * sc, 0.012, 0.08, 0.005), [0, -0.016, 0.038]), 's', COL.rubber, { r: 0.85 }));
  }
  return P;
}

/** the parts moved into the rig's T-pose space (arms out along +-x), per bone, merged by slot: { bone: { s, m, l } } */
export function humanoidRig(P) {
  const out = {};
  for (const [bone, list] of Object.entries(P)) {
    const side = bone.startsWith('Left') ? 1 : bone.startsWith('Right') ? -1 : 0, b = side ? bone.slice(side > 0 ? 4 : 5) : bone;
    const j = JOINTS[b], at = [side ? j[0] * side : j[0], j[1], j[2]];
    const arm = ['Arm', 'ForeArm', 'Hand'].includes(b);
    const m = M4(at, [0, 0, arm ? side * HP : 0]);
    out[bone] = moved(list, m);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// a robot dog by segment: 'scout' (small, fast), 'hauler' (larger, a turret), 'courier' (a parcel box on its back).
// Frames: body (origin at the body's centre, +z forward); each leg's upper (origin at the hip pitch axis, hanging
// along -y), lower (origin at the knee). Dimensions in D (the gait reads them).
export function quadrupedDims(style) {
  return style === 'hauler' ? { L: 1.0, W: 0.38, H: 0.24, hipX: 0.16, hipZ: 0.36, thigh: 0.3, calf: 0.32, foot: 0.03, stand: 0.52 }
    : style === 'courier' ? { L: 0.66, W: 0.28, H: 0.16, hipX: 0.12, hipZ: 0.24, thigh: 0.22, calf: 0.23, foot: 0.022, stand: 0.37 }
      : { L: 0.62, W: 0.26, H: 0.15, hipX: 0.11, hipZ: 0.22, thigh: 0.21, calf: 0.22, foot: 0.022, stand: 0.36 };
}
export function quadruped(style, lod, { light = [1, 1, 1] } = {}) {
  const q = 2 - lod, D = quadrupedDims(style), home = style === 'courier', SH = home ? COL.white : COL.carbon, SH2 = home ? COL.pale : COL.graphite;
  const body = [], upper = [], lower = [];
  const hl = D.L / 2, hw = D.W / 2, hh = D.H / 2;
  // the body: a long rounded hull with a raised spine, chamfered nose and tail
  body.push(part(ext([[-hl, -hh * 0.7], [-hl + 0.04, -hh], [hl - 0.06, -hh], [hl, -hh * 0.4], [hl - 0.02, hh * 0.6], [hl - 0.08, hh], [-hl + 0.05, hh], [-hl, hh * 0.5]].map(([z, y]) => [z, y]), D.W, 0.035, 'zy', q > 1 ? 3 : 1), 's', SH));
  if (q > 0) {
    body.push(part(tf(rb(D.W * 0.6, 0.03, D.L * 0.55, 0.012), [0, hh + 0.012, -0.02]), 's', SH2));   // the spine panel
    for (const s of [-1, 1]) body.push(part(tf(rb(0.012, D.H * 0.5, D.L * 0.5, 0.005), [s * (hw + 0.004), -0.01, 0]), 's', SH2));   // side panels
    body.push(decal(home ? 'homePlate' : 'dog', D.L * 0.32, D.L * 0.07, [hw + 0.012, 0.0, -0.02], [0, HP, 0]));
    body.push(decal(home ? 'homePlate' : 'dog', D.L * 0.32, D.L * 0.07, [-hw - 0.012, 0.0, -0.02], [0, -HP, 0]));
    body.push(part(tf(rb(0.06, 0.02, 0.04, 0.008), [0, hh + 0.03, -hl + 0.08]), 'm', COL.dark));   // a handle block
  }
  // the head: a sensor face at the front: dark glass with two lens clusters and a light bar
  body.push(part(tf(rb(D.W * 0.78, D.H * 0.72, 0.05, 0.02, q > 1 ? 2 : 1), [0, 0, hl - 0.005]), 's', COL.glass, { r: 0.06 }));
  for (const s of [-1, 1]) {
    body.push(part(tf(cyl(0.016, 0.016, 0.012, [6, 8, 12][q]).rotateX(HP), [s * D.W * 0.2, 0.004, hl + 0.022]), 's', COL.glass, { r: 0.04 }));
    if (q > 0) body.push(part(tf(new THREE.TorusGeometry(0.016, 0.0025, 3, 10), [s * D.W * 0.2, 0.004, hl + 0.029]), 'l', light));
  }
  body.push(part(tf(rb(D.W * 0.5, 0.008, 0.004, 0.003), [0, -D.H * 0.22, hl + 0.022]), 'l', light));
  if (q > 0) { body.push(part(tf(cyl(0.04, 0.045, 0.035, [6, 10, 14][q]), [0, hh + 0.03, hl - 0.12]), 's', COL.graphite)); body.push(part(tf(cyl(0.032, 0.032, 0.02, [6, 10, 14][q]), [0, hh + 0.057, hl - 0.12]), 's', COL.glass, { r: 0.05 })); }   // a lidar puck
  if (style === 'hauler') {   // a small turret on a yoke (its parts marked: they turn on their own bone)
    const t0 = body.length;
    body.push(...drum(0.06, 0.05, q, 'y', [0, hh + 0.04, 0.02]));
    body.push(part(tf(rb(0.16, 0.08, 0.2, 0.02, q > 1 ? 2 : 1), [0, hh + 0.11, 0.04]), 's', COL.graphite));
    body.push(part(tf(cyl(0.018, 0.018, 0.3, [6, 8, 10][q]).rotateX(HP), [0, hh + 0.12, 0.27]), 'm', COL.gun));
    body.push(part(tf(cyl(0.026, 0.026, 0.05, [6, 8, 10][q]).rotateX(HP), [0, hh + 0.12, 0.42]), 's', COL.carbon));
    body.push(part(tf(rb(0.03, 0.012, 0.004, 0.003), [0.05, hh + 0.13, 0.142]), 'l', light));
    if (q > 0) body.push(decal('warn', 0.12, 0.03, [0, hh + 0.152, 0.04], [-HP, 0, 0]));
    for (let i = t0; i < body.length; i++) body[i].turret = true;
  }
  if (home) {   // the parcel box on its back
    body.push(part(tf(rb(D.W * 0.95, 0.2, D.L * 0.6, 0.015, q > 1 ? 2 : 1), [0, hh + 0.11, -0.03]), 's', [0.42, 0.29, 0.16], { r: 0.88 }));
    if (q > 0) for (const s of [-1, 1]) body.push(decal('parcel', D.L * 0.34, D.L * 0.17, [s * (D.W * 0.475 + 0.002), hh + 0.11, -0.03], [0, s * HP, 0]));
    body.push(part(tf(rb(D.W * 0.97, 0.02, 0.025, 0.006), [0, hh + 0.2, -0.03]), 's', COL.pale));
  }
  // legs: the hip abduction housing on the body, the knee motor at the top of the thigh link
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.push(...drum(D.H * 0.36, 0.05, q, 'z', [sx * (hw - 0.01), 0, sz * D.hipZ], { housing: SH2 }));
  upper.push(...drum(D.H * 0.38, 0.06, q, 'x', [0, 0, 0], { housing: COL.carbon }));
  upper.push(part(ext([[0.035, -0.02], [0.03, -D.thigh * 0.6], [0.02, -D.thigh], [-0.025, -D.thigh], [-0.035, -D.thigh * 0.5], [-0.03, -0.02]], 0.045, 0.012, 'zy', q > 1 ? 2 : 1), 's', SH2));
  if (q > 1) upper.push(cable([0, -0.02, -0.03], [0, -D.thigh + 0.03, -0.03], [0, 0, -0.02], 0.005, q));
  upper.push(...drum(0.026, 0.05, q, 'x', [0, -D.thigh, 0], { housing: COL.carbon }));
  lower.push(link(0.016, 0.012, -0.01, -D.calf + 0.02, [4, 6, 8][q], COL.graphite, 1, 1.2, 's', { mud: [-D.calf, -D.calf * 0.5] }));
  lower.push(part(tf(new THREE.SphereGeometry(D.foot, [6, 8, 10][q], [4, 5, 6][q]), [0, -D.calf, 0]), 's', COL.rubber, { r: 0.85, mud: [-D.calf - D.foot, -D.calf + 0.02] }));
  return { D, body, upper, lower };
}

// ---------------------------------------------------------------------------------------------------------------
// gait
/** two-bone IK in a leg's plane: target (dz forward, dy up) from the upper joint; a, b the bone lengths;
 *  knee +1 forward (humanoid), -1 back (a dog's). Returns [upper angle forward of straight down, bend >= 0] */
export function legIK(dz, dy, a, b, knee = 1) {
  const c = Math.min(Math.hypot(dz, dy), (a + b) * 0.9995), base = Math.atan2(dz, -dy);
  const alpha = Math.acos(Math.min(1, Math.max(-1, (a * a + c * c - b * b) / (2 * a * c))));
  const bend = Math.PI - Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - c * c) / (2 * a * b))));
  return [base + knee * alpha, bend];
}
const sstep = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const HEEL = [0.075, 0.08], TOEJ = [-0.13, 0.06];   // from the heel to the ankle, from the toe joint to the ankle (z, y)
const rot = (a, [z, y]) => [z * Math.cos(a) + y * Math.sin(a), -z * Math.sin(a) + y * Math.cos(a)];   // a > 0: the toe down

/**
 * A biped's legs at phase p (0..1; the left heel strikes at 0) for a gait G: { T cycle (s), v (m/s), duty (stance
 * share), lift (m), hip (the hip joint's height standing), crouch, shift (the stance centre, m), strike, push (foot
 * pitch at heel strike and toe-off, rad), thigh, shin }. The stance foot is fixed on the ground (it moves back under
 * the hip at exactly v), rolled over the heel, then flat, then over the toe; the hip is as high as the stance leg
 * reaches. Returns { hipY, legs: [{ up, bend, foot, toe }] (left, right) } with angles for the rig's X rotations.
 */
export function bipedLegs(p, G, out = { hipY: 0, legs: [{}, {}] }) {
  const a = G.thigh ?? LEN.thigh, b = G.shin ?? LEN.shin, D = G.v * G.T * G.duty, nominal = G.hip - G.crouch;
  const tg = [];
  for (let k = 0; k < 2; k++) {
    const ph = ((p + k * 0.5) % 1 + 1) % 1;
    let z, y, pitch, stance = ph < G.duty;
    const heel0 = D / 2 - HEEL[0] + G.shift;   // where the heel lands, relative to the hip
    if (stance) {
      const u = ph / G.duty, xh = heel0 - D * u;   // the heel's ground point moves back at v
      if (u < 0.14) { pitch = -G.strike * (1 - sstep(u / 0.14)); [z, y] = rot(pitch, HEEL); z += xh; }
      else if (u > 0.62) { pitch = G.push * sstep((u - 0.62) / 0.38); const [dz, dy] = rot(pitch, TOEJ); z = xh + HEEL[0] - TOEJ[0] + dz; y = 0.02 + dy; }
      else { pitch = 0; z = xh + HEEL[0]; y = HEEL[1]; }
    } else {
      const u = (ph - G.duty) / (1 - G.duty), s = sstep(u);
      const [z0, y0] = (() => { const [dz, dy] = rot(G.push, TOEJ); return [heel0 - D + HEEL[0] - TOEJ[0] + dz, 0.02 + dy]; })();
      const [z1, y1] = (() => { const [dz, dy] = rot(-G.strike, HEEL); return [heel0 + dz, dy]; })();
      z = z0 + (z1 - z0) * s; y = y0 + (y1 - y0) * s + G.lift * Math.sin(Math.PI * Math.min(1, u * 1.15));
      pitch = G.push + (-G.strike - G.push) * sstep(u * 1.3);
    }
    tg.push({ z, y, pitch, stance });
  }
  // the hip: no higher than what each stance leg reaches (a compass bob), never above the nominal height
  let hipY = nominal;
  for (const t of tg) if (t.stance) hipY = Math.min(hipY, t.y + Math.sqrt(Math.max(0, ((a + b) * 0.985) ** 2 - t.z * t.z)));
  out.hipY = hipY;
  for (let k = 0; k < 2; k++) {
    const t = tg[k], [up, bend] = legIK(t.z, t.y - hipY, a, b, 1), L = out.legs[k];
    L.up = up; L.bend = bend; L.foot = t.pitch + up - bend; L.toe = t.pitch > 0 && t.stance ? -t.pitch : t.stance ? 0 : -0.15 * Math.max(0, t.pitch);
    L.stance = t.stance;
  }
  return out;
}
/** standing gaits: the walk, the run (a flight phase), both at the rig's own speeds */
export const GAITS = {
  walk: { T: 1.0, v: 1.5, duty: 0.62, lift: 0.07, hip: 0.92, crouch: 0.045, shift: -0.035, strike: 0.28, push: 0.55 },
  run: { T: 0.64, v: 4.2, duty: 0.4, lift: 0.16, hip: 0.92, crouch: 0.07, shift: 0.02, strike: 0.2, push: 0.7 },
  // the civilians: smaller (scaled 0.82 in their frame) and slower
  stroll: { T: 1.08, v: 1.15, duty: 0.63, lift: 0.055, hip: 0.92, crouch: 0.03, shift: -0.03, strike: 0.24, push: 0.48 },
};

/** a dog's legs at phase p for a trot (diagonal pairs) or a stand: { v, T, duty, lift }; D: quadrupedDims.
 *  Returns per leg (FL, FR, HL, HR) [upper angle, bend] for knees that point back, and the body's height */
export function trotLegs(p, D, G, crouch = 0, out = [[0, 0], [0, 0], [0, 0], [0, 0]]) {
  const stride = G.v * G.T * G.duty, h = D.stand - crouch;
  [[0, 0], [1, 0.5], [2, 0.5], [3, 0]].forEach(([i, off]) => {
    const ph = ((p + off) % 1 + 1) % 1;
    let z, y;
    if (ph < G.duty) { const u = ph / G.duty; z = stride * (0.5 - u); y = 0; }
    else { const u = (ph - G.duty) / (1 - G.duty), s = sstep(u); z = -stride / 2 + stride * s; y = G.lift * Math.sin(Math.PI * u); }
    const [up, bend] = legIK(z + (i < 2 ? 0.02 : -0.02), y + D.foot - h, D.thigh, D.calf, -1);
    out[i][0] = up; out[i][1] = bend;
  });
  return out;
}
