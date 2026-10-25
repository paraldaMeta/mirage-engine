// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// Geometry helpers for code-built worlds. Units are metres, +Y up.
//
//   compose(pos, rot, scale)           Matrix4 from [x,y,z], Euler [x,y,z] (radians, order YXZ), number|[x,y,z]
//   new MeshBatch()                    collects geometry per material and merges it into few draw calls
//     .add(geo, material, matrix?)  .box(material, [w,h,d], pos, rot?, bevel?)  .cylinder(material, rTop, rBot, h, pos, rot?, seg?)
//     .finish({ name, castShadow, receiveShadow }) -> THREE.Group (one Mesh per material)
//   instances(geo, material, matrices) InstancedMesh
//   lathe([[r, y], ...], segments)     surface of revolution about +Y (jars, columns, domes)
//   taperedTube(points, radii, radial) a tube whose radius varies along a Catmull-Rom path (trunks, branches)
//   archPath(path, x0, x1, y, kind, rise)   adds an arch (round | pointed | segmental | flat) to a THREE.Path
//   wall({ length, height, thickness, openings })   an extruded wall with doors (from the ground) and windows
//   lerp, clamp, smoothstep, remap
// ---------------------------------------------------------------------------

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const remap = (x, a0, a1, b0, b1) => b0 + ((x - a0) / (a1 - a0)) * (b1 - b0);

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function compose(pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  _p.fromArray(pos);
  _q.setFromEuler(_e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'YXZ'));
  if (typeof scale === 'number') _s.setScalar(scale); else _s.fromArray(scale);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// bring a geometry to the common attribute set (position, normal, uv, optional color), non-indexed
function normalise(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

export class MeshBatch {
  constructor() { this.groups = new Map(); }
  add(geo, material, matrix = null) {
    const g = normalise(geo.clone());
    if (matrix) g.applyMatrix4(matrix);
    const key = material.uuid + (g.attributes.color ? '+c' : '');
    let entry = this.groups.get(key);
    if (!entry) { entry = { material, parts: [], verts: 0 }; this.groups.set(key, entry); }
    entry.parts.push(g);
    entry.verts += g.attributes.position.count;
    return this;
  }
  box(material, size, pos = [0, 0, 0], rot = [0, 0, 0], bevel = 0) {
    const [w, h, d] = size;
    const geo = bevel > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(bevel, 0.45 * Math.min(w, h, d))) : new THREE.BoxGeometry(w, h, d);
    return this.add(geo, material, compose(pos, rot));
  }
  cylinder(material, rTop, rBot, h, pos = [0, 0, 0], rot = [0, 0, 0], seg = 20) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), material, compose(pos, rot));
  }
  finish({ name = 'batch', castShadow = true, receiveShadow = true } = {}) {
    const out = new THREE.Group();
    out.name = name;
    for (const { material, parts } of this.groups.values()) {
      // split very large batches so a single buffer stays well below index limits
      for (let i = 0; i < parts.length;) {
        const chunk = []; let n = 0;
        while (i < parts.length && (chunk.length === 0 || n + parts[i].attributes.position.count < 2_000_000)) { n += parts[i].attributes.position.count; chunk.push(parts[i++]); }
        const geo = mergeGeometries(chunk, false);
        geo.computeBoundingBox(); geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = `${name}:${material.name || 'mat'}`;
        mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
        out.add(mesh);
      }
    }
    return out;
  }
}

export function instances(geo, material, matrices, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Surface of revolution from a profile [[radius, y], ...] (bottom to top). */
export function lathe(profile, segments = 32) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return geo;
}

/** A tube along a Catmull-Rom curve through `points` ([x,y,z]...), radius interpolated from `radii`
 *  (one per point, or a function of u in 0..1), with rotation-minimising frames. */
export function taperedTube(points, radii, { radial = 10, segments = null, capEnd = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const n = segments || Math.max(8, points.length * 6);
  const rAt = typeof radii === 'function' ? radii : (u) => {
    const f = u * (radii.length - 1), i = Math.min(Math.floor(f), radii.length - 2);
    return lerp(radii[i], radii[i + 1], f - i);
  };
  const frames = curve.computeFrenetFrames(n, false);   // three's implementation uses parallel transport
  const pos = [], nrm = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    curve.getPointAt(u, P);
    const r = rAt(u);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      N.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nrm.push(N.x, N.y, N.z);
      uv.push(j / radial, u);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  if (capEnd) {
    curve.getPointAt(1, P);
    const c = pos.length / 3, t = frames.tangents[n];
    pos.push(P.x, P.y, P.z); nrm.push(t.x, t.y, t.z); uv.push(0.5, 1);
    for (let j = 0; j < radial; j++) idx.push(n * row + j, n * row + j + 1, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** Append an arch over the span x0 -> x1 springing at height y to `path` (the path's pen is at (x0, y)).
 *  kind: 'round' (semicircle), 'pointed' (two-centred, `rise` = extra point height factor), 'segmental'
 *  (`rise` metres), 'flat'. Direction: x0 -> x1, so walk left-to-right on the outline, right-to-left on holes. */
export function archPath(path, x0, x1, y, kind = 'round', rise = null, steps = 16) {
  const w = Math.abs(x1 - x0), cx = (x0 + x1) / 2, s = Math.sign(x1 - x0) || 1;
  if (kind === 'flat') { path.lineTo(x1, y); return path; }
  if (kind === 'round') {
    for (let i = 1; i <= steps; i++) { const t = Math.PI * (1 - i / steps); path.lineTo(cx + s * (w / 2) * Math.cos(t), y + (w / 2) * Math.sin(t)); }
    return path;
  }
  if (kind === 'segmental') {
    const h = rise ?? w * 0.2, R = (w * w / 4 + h * h) / (2 * h), cy = y + h - R, half = Math.asin(Math.min(1, w / 2 / R));
    for (let i = 1; i <= steps; i++) { const a = -half + (i / steps) * 2 * half; path.lineTo(cx + s * Math.sin(a) * R, cy + Math.cos(a) * R); }
    return path;
  }
  // pointed (two-centred): each side is an arc of radius R = rise * span whose centre lies on the springing line
  const R = Math.max(rise ?? 0.8, 0.5) * w;
  const apex = Math.acos((R - w / 2) / R);
  const cL = x0 + s * R, cR = x1 - s * R, half = Math.max(2, steps >> 1);
  for (let i = 1; i <= half; i++) { const f = apex * (i / half); path.lineTo(cL - s * R * Math.cos(f), y + R * Math.sin(f)); }
  for (let i = half - 1; i >= 0; i--) { const f = apex * (i / half); path.lineTo(cR + s * R * Math.cos(f), y + R * Math.sin(f)); }
  return path;
}

/** An extruded wall along local +X (centred), from y = 0 to `height`, `thickness` along Z (centred).
 *  openings: [{ x (centre along the wall), width, height (springing height), arch: 'round' | 'pointed' |
 *  'segmental' | 'flat', rise, sill (0 = a door from the ground) }] */
export function wall({ length, height, thickness = 0.4, openings = [], curveSteps = 18 }) {
  const L = length / 2;
  const doors = openings.filter((o) => !(o.sill > 0)).sort((a, b) => a.x - b.x);
  const windows = openings.filter((o) => o.sill > 0);
  const shape = new THREE.Shape();
  shape.moveTo(-L, 0);
  for (const d of doors) {
    const x0 = d.x - d.width / 2, x1 = d.x + d.width / 2;
    shape.lineTo(x0, 0); shape.lineTo(x0, d.height);
    archPath(shape, x0, x1, d.height, d.arch || 'round', d.rise, curveSteps);
    shape.lineTo(x1, 0);
  }
  shape.lineTo(L, 0); shape.lineTo(L, height); shape.lineTo(-L, height); shape.lineTo(-L, 0);
  for (const w of windows) {
    const x0 = w.x - w.width / 2, x1 = w.x + w.width / 2;
    const hole = new THREE.Path();
    hole.moveTo(x0, w.sill); hole.lineTo(x1, w.sill); hole.lineTo(x1, w.height);
    archPath(hole, x1, x0, w.height, w.arch || 'round', w.rise, curveSteps);
    hole.lineTo(x0, w.sill);
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: curveSteps });
  geo.translate(0, 0, -thickness / 2);
  geo.computeVertexNormals();
  return geo;
}

export { mergeGeometries, RoundedBoxGeometry };
