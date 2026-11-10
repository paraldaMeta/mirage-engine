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
//   wall({ length, height, thickness, openings, round })   an extruded wall with doors (from the ground) and windows;
//                                      round > 0: every arris (openings, ends) rounded inside the same bounds
//   softExtrude(shape, depth, r)       ExtrudeGeometry over z 0..depth with every outline / hole edge rounded by r,
//                                      never bigger than the plain extrusion
//   softBox(w, h, d, r)                a box with rounded edges inside the same bounds (thin parts < 12 cm stay sharp)
//   sootPlumes(list)                   multiply-blended soot quads on the wall above lamps (one merged mesh)
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
    idx.push(a, a + 1, b, b, a + 1, b + 1);   // outward, with the normals (it was wound inward)
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
    const h = rise ?? w * 0.2, R = (w * w / 4 + h * h) / (2 * h), cy = y + h - R;
    // a rise above half the span is more than a semicircle: the major arc (asin alone gave the minor one)
    const half = h > w / 2 ? Math.PI - Math.asin(Math.min(1, w / 2 / R)) : Math.asin(Math.min(1, w / 2 / R));
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

// the top of an opening's arch (its apex)
function archTop(o) {
  const w = o.width, kind = o.arch || 'round';
  if (kind === 'flat') return o.height;
  if (kind === 'round') return o.height + w / 2;
  if (kind === 'segmental') return o.height + (o.rise ?? w * 0.2);
  const R = Math.max(o.rise ?? 0.8, 0.5) * w;
  return o.height + R * Math.sin(Math.acos((R - w / 2) / R));
}

/** An extruded wall along local +X (centred), from y = 0 to `height`, `thickness` along Z (centred).
 *  openings: [{ x (centre along the wall), width, height (springing height), arch: 'round' | 'pointed' |
 *  'segmental' | 'flat', rise, sill (0 = a door from the ground) }]; round: arris chamfer (m, 0 = sharp; 45°, cut
 *  into the faces, never beyond the plain bounds). The chamfer is capped at 0.35 x the narrowest strip of wall
 *  (an opening to the top, an end, the sill line or another opening) and dropped below 4 mm; the foot is not
 *  chamfered (the outline starts that far below y = 0). */
export function wall({ length, height, thickness = 0.4, openings = [], curveSteps = 18, round = 0 }) {
  const L = length / 2;
  const doors = openings.filter((o) => !(o.sill > 0)).sort((a, b) => a.x - b.x);
  const windows = openings.filter((o) => o.sill > 0);
  let rr = 0;
  if (round > 0) {
    // the narrowest strip of wall round any opening: the inset contours of a softExtrude must not cross
    let clear = Infinity;
    const box = (o) => [o.x - o.width / 2, o.x + o.width / 2, o.sill > 0 ? o.sill : -Infinity, archTop(o)];
    const B = openings.map(box);
    for (const [x0, x1, y0, y1] of B) {
      clear = Math.min(clear, x0 + L, L - x1, height - y1);
      if (y0 > -Infinity) clear = Math.min(clear, y0);
    }
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      const gx = Math.max(b[0] - a[1], a[0] - b[1]), gy = Math.max(b[2] - a[3], a[2] - b[3]);
      clear = Math.min(clear, Math.max(gx, gy));
    }
    rr = Math.min(round, thickness * 0.3, 0.35 * clear);
    if (!(rr > 0.004)) rr = 0;
  }
  const yb = rr > 0 ? -rr * 1.5 : 0;   // the foot: its chamfer below ground
  const shape = new THREE.Shape();
  shape.moveTo(-L, yb);
  for (const d of doors) {
    const x0 = d.x - d.width / 2, x1 = d.x + d.width / 2;
    shape.lineTo(x0, yb); shape.lineTo(x0, d.height);
    archPath(shape, x0, x1, d.height, d.arch || 'round', d.rise, curveSteps);
    shape.lineTo(x1, yb);
  }
  shape.lineTo(L, yb); shape.lineTo(L, height); shape.lineTo(-L, height); shape.lineTo(-L, yb);
  for (const w of windows) {
    const x0 = w.x - w.width / 2, x1 = w.x + w.width / 2;
    const hole = new THREE.Path();
    hole.moveTo(x0, w.sill); hole.lineTo(x1, w.sill); hole.lineTo(x1, w.height);
    archPath(hole, x1, x0, w.height, w.arch || 'round', w.rise, curveSteps);
    hole.lineTo(x0, w.sill);
    shape.holes.push(hole);
  }
  const geo = rr > 0 ? softExtrude(shape, thickness, rr, curveSteps) : new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: curveSteps });
  geo.translate(0, 0, -thickness / 2);
  geo.computeVertexNormals();
  return geo;
}

/** An ExtrudeGeometry of `shape` over z in [0, depth] whose outline and hole edges are chamfered (rounded with
 *  more `segments`) by r: the faces' contours are inset, the sides are exact, so the part never grows beyond the
 *  plain extrusion AS LONG AS r < ~0.35 x the narrowest strip of the shape (a hole to the outline, two holes):
 *  wider, the inset contours cross and fold (wall() caps r for you). Falls back to the plain extrusion for
 *  r <= 4 mm (r is capped at 0.3 x depth). */
export function softExtrude(shape, depth, r, curveSegments = 2, segments = 1) {
  const rr = Math.min(r, depth * 0.3);
  if (!(rr > 0.004)) return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments, steps: 1 });
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * rr, bevelEnabled: true, bevelThickness: rr, bevelSize: rr, bevelOffset: -rr, bevelSegments: segments, curveSegments, steps: 1,
  });
  g.translate(0, 0, rr);
  return g;
}

/** A w x h x d box with rounded edges inside the same bounds (RoundedBoxGeometry, r <= a quarter of the thinnest
 *  side); parts thinner than 12 cm keep the sharp BoxGeometry. */
export function softBox(w, h, d, r = 0.035) {
  const m = Math.min(w, h, d);
  if (m < 0.12 || !(r > 0)) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, m * 0.25));
}

// a soot plume: dark and narrow at the lamp, spreading and fading upward (y = 0 at the lamp .. 1 at the top);
// RGB multiplies what is behind (1 = no change)
function sootTexture() {
  const W = 64, H = 128, data = new Uint8Array(W * H * 4);
  const hsh = (i, j) => { let n = (i * 374761393 + j * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = (i + 0.5) / W * 2 - 1, y = (j + 0.5) / H;
    const w = 0.22 + 0.7 * Math.pow(y, 0.8) + 0.06 * Math.sin(y * 9.0 + 1.3);
    const sx = x + 0.12 * Math.sin(y * 6.0) * y;
    let k = Math.exp(-((sx / w) ** 2) * 2.6) * Math.min(1, y / 0.08) * Math.pow(1 - y, 1.1);
    k *= 0.8 + 0.2 * hsh(i >> 2, j >> 2) + 0.2 * hsh(i, j);
    const c = Math.round(255 * (1 - 0.62 * Math.min(1, k))), o = (j * W + i) * 4;
    data[o] = c; data[o + 1] = Math.round(c * 0.985); data[o + 2] = Math.round(c * 0.97); data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

/** Soot blackening the wall above lamps (anything that smokes), as one merged mesh of quads multiplying what is
 *  behind them (no light of its own, no shadows, no depth writes: the walk grid and SSAO ignore it).
 *  list: [{ pos: [x, y, z] on the wall face, normal: [nx, ny, nz] | rotY (out of the wall), scale = 1,
 *  up = 1.25 (m) }]. Quads stand 3.5 cm off the face. Returns null when no entry is usable. */
export function sootPlumes(list) {
  if (!list || !list.length) return null;
  const P = [], UV = [], IX = [];
  for (const it of list) {
    if (!it || !Array.isArray(it.pos) || it.pos.length < 3) { console.warn('[mirage/geom] sootPlumes: an entry without pos [x, y, z] skipped'); continue; }
    const n = it.normal ? new THREE.Vector3(...it.normal) : new THREE.Vector3(Math.sin(it.rotY || 0), 0, Math.cos(it.rotY || 0));
    n.y = 0; if (n.lengthSq() < 1e-6) continue; n.normalize();
    const t = new THREE.Vector3(n.z, 0, -n.x), s = it.scale ?? 1, up = (it.up ?? 1.25) * s, hw = 0.32 * s;
    const b = new THREE.Vector3(...it.pos).addScaledVector(n, 0.035); b.y -= 0.12 * s;
    const k = P.length / 3;
    for (const [a, v] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      const p = b.clone().addScaledVector(t, a * hw); p.y += v * up;
      P.push(p.x, p.y, p.z); UV.push((a + 1) / 2, v);
    }
    IX.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  if (!P.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(IX); g.computeBoundingSphere();
  const m = new THREE.MeshBasicMaterial({ map: sootTexture(), blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true,
    depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.name = 'soot';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'soot'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 5;
  return mesh;
}

export { mergeGeometries, RoundedBoxGeometry };
