// Mirage original code. What the destructibles (destruct.js) draw: handles that hide and show a prop however it is
// drawn (a mesh, one instance of an InstancedMesh or a BatchedMesh, a vertex range of a merged mesh), the debris pool
// (instanced pieces with a ballistic step, bounce, spin, settle and fade: no rigid bodies), surface marks (cracks,
// holes, dents, puddles: one instanced quad layer over a procedural atlas) and the broken-state pools (a shattered
// pane with a jagged rim, a split crate, a dented panel, a deflated tyre: one InstancedMesh per kind and material).
// Everything is made on first use and pooled; the step and the sync allocate nothing.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { sfc32, hash32 } from '@miragekit/core/rng';

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _b = new THREE.Box3();
const _qr = new THREE.Quaternion();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const passOut = (o) => { o.castShadow = o.receiveShadow = false; o.userData.collide = false; o.userData.mgNoCapture = true; o.userData.mgDynamic = true; o.userData.mgNoBounce = true; return o; };

// ---- handles: hide / show what is drawn, and where it is ------------------------------------------------------------
/** a handle for spec.draw: an Object3D, { mesh: InstancedMesh, index }, { mesh: BatchedMesh, id }, { mesh, range:
 *  [firstVertex, count] } (non-indexed merged geometry), { mesh, indexRange: [first, count] } (indexed), { hide, show }
 *  of your own, or an array of these. Returns { hide(), show(), hidden, box(obb) | null, material, kind, parts } */
export function makeHandle(draw) {
  if (!draw) return { kind: 'none', hidden: false, hide() {}, show() {}, box: () => false, material: null, parts: [] };
  if (Array.isArray(draw)) {
    const parts = draw.map(makeHandle);
    return { kind: 'list', parts, hidden: false, material: parts[0]?.material ?? null,
      hide() { for (const p of parts) p.hide(); this.hidden = true; }, show() { for (const p of parts) p.show(); this.hidden = false; },
      box(out) { return parts.length ? parts[0].box(out) : false; } };
  }
  if (draw.isObject3D) {
    const mat = draw.isMesh ? [].concat(draw.material)[0] : findMaterial(draw);
    return { kind: 'object', object: draw, hidden: false, material: mat,
      hide() { draw.visible = false; this.hidden = true; }, show() { draw.visible = true; this.hidden = false; },
      box(out) {
        draw.updateWorldMatrix(true, true);
        if (draw.isMesh && draw.geometry) { const g = draw.geometry; if (!g.boundingBox) g.computeBoundingBox(); return obbFrom(out, draw.matrixWorld, g.boundingBox); }
        _b.setFromObject(draw); if (_b.isEmpty()) return false;
        return obbFrom(out, _m.identity(), _b);
      } };
  }
  const mesh = draw.mesh;
  if (mesh && mesh.isInstancedMesh) {
    const i = draw.index, saved = new Float32Array(16);
    return { kind: 'instance', mesh, index: i, hidden: false, material: [].concat(mesh.material)[0],
      hide() { if (this.hidden) return; const a = mesh.instanceMatrix.array; for (let k = 0; k < 16; k++) saved[k] = a[i * 16 + k]; mesh.setMatrixAt(i, ZERO); touch(mesh.instanceMatrix, i * 16, 16); this.hidden = true; },
      show() { if (!this.hidden) return; mesh.instanceMatrix.array.set(saved, i * 16); touch(mesh.instanceMatrix, i * 16, 16); this.hidden = false; },
      /** the instance's matrix now (the saved one while hidden) */
      matrix(out) { if (this.hidden) out.fromArray(saved); else mesh.getMatrixAt(i, out); return out; },
      setMatrix(m) { if (this.hidden) m.toArray(saved); else { mesh.setMatrixAt(i, m); touch(mesh.instanceMatrix, i * 16, 16); } },
      box(out) { mesh.updateWorldMatrix(true, false); const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); this.matrix(_m2); return obbFrom(out, _m.multiplyMatrices(mesh.matrixWorld, _m2), g.boundingBox); } };
  }
  if (mesh && mesh.isBatchedMesh) {
    const id = draw.id;
    return { kind: 'batched', mesh, id, hidden: false, material: [].concat(mesh.material)[0],
      hide() { mesh.setVisibleAt(id, false); this.hidden = true; }, show() { mesh.setVisibleAt(id, true); this.hidden = false; },
      matrix(out) { return mesh.getMatrixAt(id, out); }, setMatrix(m) { mesh.setMatrixAt(id, m); },
      box(out) {
        mesh.updateWorldMatrix(true, false);
        const gid = mesh.getGeometryIdAt(id), bb = mesh.getBoundingBoxAt(gid, new THREE.Box3());
        if (!bb) return false;
        mesh.getMatrixAt(id, _m2);
        return obbFrom(out, _m.multiplyMatrices(mesh.matrixWorld, _m2), bb);
      } };
  }
  if (mesh && (draw.range || draw.indexRange)) {
    const g = mesh.geometry, idx = !!draw.indexRange, [first, count] = draw.indexRange || draw.range;
    const attr = idx ? g.index : g.attributes.position, w = idx ? 1 : 3, saved = new (idx ? attr.array.constructor : Float32Array)(count * w);
    return { kind: 'range', mesh, first, count, hidden: false, material: [].concat(mesh.material)[0],
      hide() {
        if (this.hidden) return;
        const a = attr.array, o = first * w;
        for (let k = 0; k < count * w; k++) saved[k] = a[o + k];
        // every triangle of the range collapses onto its first vertex: nothing drawn, no draw call split
        for (let k = 0; k < count; k++) for (let c = 0; c < w; c++) a[o + k * w + c] = saved[c];
        touch(attr, o, count * w); this.hidden = true;
      },
      show() { if (!this.hidden) return; attr.array.set(saved, first * w); touch(attr, first * w, count * w); this.hidden = false; },
      box(out) {
        mesh.updateWorldMatrix(true, false); _b.makeEmpty();
        const p = g.attributes.position;
        for (let k = 0; k < count; k++) {
          const vi = idx ? (this.hidden ? saved[k] : g.index.array[first + k]) : first + k;
          if (!idx && this.hidden) _v.set(saved[k * 3], saved[k * 3 + 1], saved[k * 3 + 2]); else _v.fromBufferAttribute(p, vi);
          _b.expandByPoint(_v);
        }
        return _b.isEmpty() ? false : obbFrom(out, mesh.matrixWorld, _b);
      } };
  }
  if (typeof draw.hide === 'function') return { kind: 'custom', hidden: false, material: draw.material ?? null,
    hide() { draw.hide(); this.hidden = true; }, show() { draw.show?.(); this.hidden = false; }, box: (out) => (draw.box ? draw.box(out) : false) };
  throw new Error('destructibles: draw must be an Object3D, { mesh, index | id | range | indexRange }, { hide, show } or a list of them');
}
function findMaterial(o) { let m = null; o.traverse((c) => { if (!m && c.isMesh) m = [].concat(c.material)[0]; }); return m; }
function touch(attr, start, count) { if (attr.addUpdateRange) attr.addUpdateRange(start, count); attr.needsUpdate = true; }

/** an oriented box { c: [3], u: [9] (unit axes, columns), h: [3] } from a local box under matrix m */
export function obbFrom(out, m, box) {
  const e = m.elements;
  const lc = box.getCenter(_v), cx = lc.x, cy = lc.y, cz = lc.z;
  out.c[0] = e[0] * cx + e[4] * cy + e[8] * cz + e[12]; out.c[1] = e[1] * cx + e[5] * cy + e[9] * cz + e[13]; out.c[2] = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
  const hx = (box.max.x - box.min.x) / 2, hy = (box.max.y - box.min.y) / 2, hz = (box.max.z - box.min.z) / 2;
  for (let k = 0; k < 3; k++) {
    const x = e[k * 4], y = e[k * 4 + 1], z = e[k * 4 + 2], L = Math.hypot(x, y, z) || 1;
    out.u[k * 3] = x / L; out.u[k * 3 + 1] = y / L; out.u[k * 3 + 2] = z / L;
    out.h[k] = Math.max(1e-3, [hx, hy, hz][k] * L);
  }
  return true;
}

// ---- geometry ---------------------------------------------------------------------------------------------------
function geo(pos, idx) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (idx) g.setIndex(idx); g.computeVertexNormals(); return g; }
/** debris shapes, about a unit across (each piece is scaled by its size) */
export function debrisGeometries() {
  const prism = (pts, t) => {   // a flat polygon (fan) with thickness t along z
    const p = [], ix = [], n = pts.length;
    for (const z of [t / 2, -t / 2]) for (const [x, y] of pts) p.push(x, y, z);
    for (let i = 1; i < n - 1; i++) { ix.push(0, i, i + 1); ix.push(n, n + i + 1, n + i); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; ix.push(i, n + i, j, j, n + i, n + j); }
    return geo(p, ix).toNonIndexed();
  };
  const glass = prism([[0, 0.62], [-0.42, -0.35], [0.1, -0.5], [0.5, -0.2]], 0.05);
  const shard = prism([[0, 0.5], [-0.5, -0.3], [0.45, -0.4]], 0.18);
  const chunk = new THREE.BoxGeometry(1, 0.55, 0.75).toNonIndexed(); chunk.computeVertexNormals();
  const flake = prism([[-0.5, -0.4], [0.45, -0.5], [0.5, 0.4], [-0.35, 0.5]], 0.04);
  const bolt = new THREE.CylinderGeometry(0.18, 0.18, 1, 6).rotateZ(Math.PI / 2);
  return { glass, shard, chunk, flake, bolt };
}

/** broken-state geometries in a unit box (-0.5..0.5) the prop's own box is mapped onto */
export const BROKEN_STATES = {
  /** a pane (the XY plane, thin along Z) shot out: a rim with a jagged inner edge and a few shards still hanging */
  pane(seed = 'pane') {
    const R = sfc32(hash32('mirage/destruct/pane/' + seed)), N = 12, out = [], inn = [];
    for (let s = 0; s < 4; s++) for (let i = 0; i < N; i++) {
      const t = i / N, corner = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]][s], next = [[0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]][s];
      const x = corner[0] + (next[0] - corner[0]) * t, y = corner[1] + (next[1] - corner[1]) * t;
      out.push([x, y]);
      const d = 0.025 + Math.pow(R(), 2.2) * 0.2 + (i === 0 ? 0.06 : 0);   // deeper at the corners: glass holds there
      inn.push([x * (1 - 2 * d / 1) + (R() - 0.5) * 0.02, y * (1 - 2 * d) + (R() - 0.5) * 0.02]);
    }
    const p = [], n = out.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = out[i], b = out[j], c = inn[j], d = inn[i];
      p.push(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0, a[0], a[1], 0, c[0], c[1], 0, d[0], d[1], 0);
    }
    // long shards still in the frame, pointing in from the rim
    for (let k = 0; k < 5; k++) {
      const i = Math.floor(R() * n), a = inn[i], b = inn[(i + 1) % n], L = 0.12 + R() * 0.22;
      p.push(a[0], a[1], 0, b[0], b[1], 0, (a[0] + b[0]) / 2 * (1 - L * 2), (a[1] + b[1]) / 2 * (1 - L * 2), 0);
    }
    return geo(p);
  },
  /** a crate split open: two halves fallen apart on their bottom edges, lower than the crate was */
  crate() {
    const half = (side) => {
      const b = new THREE.BoxGeometry(0.48, 0.9, 1).toNonIndexed();
      b.translate(side * 0.24, 0.45, 0); b.rotateZ(-side * 0.3); b.translate(side * 0.04, -0.5, 0);
      return b;
    };
    const lid = new THREE.BoxGeometry(0.9, 0.08, 0.95).toNonIndexed(); lid.rotateZ(0.25); lid.rotateY(0.3); lid.translate(-0.1, -0.42, 0.15);
    const parts = [half(-1), half(1), lid], p = [];
    for (const g of parts) p.push(...g.attributes.position.array);
    return geo(p);
  },
  /** a panel (front face +Z) dented in where it was hit, the rest crumpled a little */
  dent(seed = 'dent') {
    const R = sfc32(hash32('mirage/destruct/dent/' + seed)), g = new THREE.BoxGeometry(1, 1, 1, 8, 8, 2), p = g.attributes.position;
    const cx = (R() - 0.5) * 0.4, cy = (R() - 0.5) * 0.4;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (z > 0.49) p.setZ(i, z - 0.22 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 0.06) - 0.02 * R());
      else p.setX(i, x + (R() - 0.5) * 0.015);
    }
    g.computeVertexNormals();
    return g;
  },
  /** a tyre (axis along X) gone flat: the bottom squashed and bulging */
  tyre() {
    const g = new THREE.TorusGeometry(0.33, 0.17, 10, 28).rotateY(Math.PI / 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < -0.24) { p.setY(i, -0.24 - (y + 0.24) * 0.25); p.setX(i, p.getX(i) * 1.35); p.setZ(i, p.getZ(i) * 1.08); }
    }
    g.translate(0, -0.08, 0);
    g.computeVertexNormals();
    return g;
  },
};

// ---- the debris pool ----------------------------------------------------------------------------------------------
const SHAPES = ['glass', 'shard', 'chunk', 'flake', 'bolt'];
const FLAT = { glass: 2, flake: 2, shard: 2, chunk: 1, bolt: -1 };   // the thin local axis that lies flat at rest (-1: none)
export function createDebris(root, { max = 600 } = {}) {
  const N = max;
  const P = new Float32Array(N * 3), O = new Float32Array(N * 3), V = new Float32Array(N * 3), Q = new Float32Array(N * 4), QO = new Float32Array(N * 4), W = new Float32Array(N * 3);
  const S = new Float32Array(N * 3), age = new Float32Array(N), rest = new Float32Array(N), restFor = new Float32Array(N), fade = new Float32Array(N), floor = new Float32Array(N);
  const bounce = new Float32Array(N), fric = new Float32Array(N), drag = new Float32Array(N), kind = new Int8Array(N).fill(-1), slot = new Int32Array(N), seq = new Uint32Array(N);
  const free = new Int32Array(N); let nFree = N; for (let i = 0; i < N; i++) free[i] = N - 1 - i;
  const slots = SHAPES.map(() => new Int32Array(N)), counts = new Int32Array(SHAPES.length);
  let meshes = null, group = null, live = 0, serial = 0, dirty = false;
  const st = { live: 0, spawned: 0, recycled: 0, dropped: 0 };
  const _c = new THREE.Color();
  function build() {
    if (meshes) return;
    group = passOut(new THREE.Group()); group.name = 'destruct:debris'; root.add(group);
    const G = debrisGeometries();
    meshes = SHAPES.map((k) => {
      const glass = k === 'glass';
      const mat = new THREE.MeshStandardMaterial(glass ? { color: 0xffffff, roughness: 0.03, metalness: 0.35, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2.4, emissive: 0x6f8890, emissiveIntensity: 0.025 }
        : { color: 0xffffff, roughness: k === 'bolt' ? 0.4 : 0.85, metalness: k === 'bolt' ? 0.8 : 0, side: k === 'flake' ? THREE.DoubleSide : THREE.FrontSide });
      mat.name = 'destruct:debris:' + k;
      const m = passOut(new THREE.InstancedMesh(G[k], mat, N));
      m.name = 'destruct:debris:' + k; m.count = 0; m.frustumCulled = false; m.visible = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _c.set(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      if (glass) m.renderOrder = 3;
      group.add(m);
      return m;
    });
  }
  function release(i) {
    const k = kind[i], s = slot[i], last = --counts[k], j = slots[k][last], m = meshes[k];
    if (j !== i) {   // the last of this mesh moves into the freed slot (its colour with it)
      slots[k][s] = j; slot[j] = s;
      const c = m.instanceColor.array; c[s * 3] = c[last * 3]; c[s * 3 + 1] = c[last * 3 + 1]; c[s * 3 + 2] = c[last * 3 + 2]; m.instanceColor.needsUpdate = true;
    }
    kind[i] = -1; free[nFree++] = i; live--;
  }
  function oldest() { let best = -1, bs = Infinity; for (let i = 0; i < N; i++) if (kind[i] >= 0 && seq[i] < bs) { bs = seq[i]; best = i; } return best; }
  /** one piece. d: the class's debris record; at: the centre it flies from, ext: the half size it is spread over,
   *  dir: which way; R: the seeded stream; flo: the floor height; scale: the prop's size factor; cap: most live */
  function spawn(d, at, ext, dir, R, flo, scale, cap) {
    build();
    let i;
    if (nFree && live < cap) i = free[--nFree];
    else { i = oldest(); if (i < 0) { st.dropped++; return -1; } release(i); i = free[--nFree]; st.recycled++; }
    const k = Math.max(0, SHAPES.indexOf(d.shape));
    kind[i] = k; slot[i] = counts[k]; slots[k][counts[k]++] = i; live++; seq[i] = ++serial; st.spawned++;
    const s = (d.size[0] + (d.size[1] - d.size[0]) * Math.pow(R(), 2.4)) * Math.min(1.6, Math.max(0.5, scale));
    S[i * 3] = s * (0.7 + 0.6 * R()); S[i * 3 + 1] = s * (0.7 + 0.6 * R()); S[i * 3 + 2] = s;
    for (let c = 0; c < 3; c++) P[i * 3 + c] = O[i * 3 + c] = at[c] + (R() - 0.5) * 2 * ext[c];
    // along the hit with a spread, slower the larger the piece (big shards drop, small ones fly), plus a lift
    const sp = (d.speed[0] + (d.speed[1] - d.speed[0]) * R()) * (1 - 0.45 * Math.min(1, (s - d.size[0]) / (d.size[1] - d.size[0] + 1e-6)));
    let x = dir[0] + (R() - 0.5) * 2 * d.spread, y = dir[1] + (R() - 0.5) * 2 * d.spread, z = dir[2] + (R() - 0.5) * 2 * d.spread;
    const L = Math.hypot(x, y, z) || 1; x /= L; y /= L; z /= L;
    V[i * 3] = x * sp; V[i * 3 + 1] = y * sp + (d.up || 0) * R(); V[i * 3 + 2] = z * sp;
    _q.setFromAxisAngle(_v.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), R() * 6.283);
    Q[i * 4] = QO[i * 4] = _q.x; Q[i * 4 + 1] = QO[i * 4 + 1] = _q.y; Q[i * 4 + 2] = QO[i * 4 + 2] = _q.z; Q[i * 4 + 3] = QO[i * 4 + 3] = _q.w;
    for (let c = 0; c < 3; c++) W[i * 3 + c] = (R() - 0.5) * 2 * d.spin;
    age[i] = 0; rest[i] = 0; restFor[i] = d.rest * (0.75 + 0.5 * R()); fade[i] = 1; floor[i] = flo;
    bounce[i] = d.bounce; fric[i] = d.friction; drag[i] = d.drag || 0.15;
    const col = d.colors[Math.floor(R() * d.colors.length)];
    _c.set(col); const sh = 0.85 + 0.3 * R(); _c.r *= sh; _c.g *= sh; _c.b *= sh;
    meshes[k].setColorAt(slot[i], _c); meshes[k].instanceColor.needsUpdate = true;
    dirty = true;
    return i;
  }
  const up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  /** one fixed step of every piece; returns the live count */
  function step(dt, g = 9.81) {
    if (!live) return 0;
    for (let i = 0; i < N; i++) {
      const k = kind[i]; if (k < 0) continue;
      const i3 = i * 3, i4 = i * 4;
      O[i3] = P[i3]; O[i3 + 1] = P[i3 + 1]; O[i3 + 2] = P[i3 + 2];
      QO[i4] = Q[i4]; QO[i4 + 1] = Q[i4 + 1]; QO[i4 + 2] = Q[i4 + 2]; QO[i4 + 3] = Q[i4 + 3];
      age[i] += dt;
      if (rest[i] > 0) {   // lying still: wait, then shrink into the ground and go
        rest[i] += dt;
        if (rest[i] > restFor[i]) { fade[i] -= dt / 0.6; P[i3 + 1] -= dt * 0.02; if (fade[i] <= 0) { release(i); continue; } }
        continue;
      }
      const dk = 1 - Math.min(0.5, drag[i] * dt);
      V[i3] *= dk; V[i3 + 2] *= dk; V[i3 + 1] = (V[i3 + 1] - g * dt) * dk;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      qa.set(Q[i4], Q[i4 + 1], Q[i4 + 2], Q[i4 + 3]);
      const wl = Math.hypot(W[i3], W[i3 + 1], W[i3 + 2]);
      if (wl > 1e-4) { qb.setFromAxisAngle(ax.set(W[i3] / wl, W[i3 + 1] / wl, W[i3 + 2] / wl), wl * dt); qa.premultiply(qb); }
      const hh = Math.min(S[i3], S[i3 + 1], S[i3 + 2]) * 0.06 + 0.004;
      if (P[i3 + 1] - hh <= floor[i]) {
        P[i3 + 1] = floor[i] + hh;
        if (V[i3 + 1] < 0) V[i3 + 1] = V[i3 + 1] < -1.2 ? -V[i3 + 1] * bounce[i] : 0;
        const f = Math.max(0, 1 - fric[i] * 9 * dt);
        V[i3] *= f; V[i3 + 2] *= f; W[i3] *= 0.86; W[i3 + 1] *= 0.86; W[i3 + 2] *= 0.86;
        // a flat piece turns to lie flat: its thin axis toward up (or down, whichever is nearer)
        const fa = FLAT[SHAPES[k]];
        if (fa >= 0) {
          ax.set(fa === 0 ? 1 : 0, fa === 1 ? 1 : 0, fa === 2 ? 1 : 0).applyQuaternion(qa);
          if (ax.y < 0) ax.negate();
          qb.setFromUnitVectors(ax, up); qa.premultiply(qb.slerp(_q.identity(), 1 - Math.min(1, 12 * dt)));
        }
        if (Math.abs(V[i3]) + Math.abs(V[i3 + 1]) + Math.abs(V[i3 + 2]) < 0.06) { rest[i] = 1e-6; V[i3] = V[i3 + 1] = V[i3 + 2] = 0; W[i3] = W[i3 + 1] = W[i3 + 2] = 0; }
      }
      qa.normalize(); Q[i4] = qa.x; Q[i4 + 1] = qa.y; Q[i4 + 2] = qa.z; Q[i4 + 3] = qa.w;
      if (age[i] > 20) { release(i); continue; }   // safety: nothing lives forever (fell off the world)
    }
    st.live = live; dirty = true;
    return live;
  }
  const qi = new THREE.Quaternion(), pi = new THREE.Vector3(), si = new THREE.Vector3();
  /** write the instance matrices, blended alpha (0..1) of the way from the previous step to the last */
  function sync(alpha = 1) {
    if (!meshes || !dirty) return;
    dirty = false;
    for (let k = 0; k < SHAPES.length; k++) {
      const m = meshes[k], n = counts[k], a = m.instanceMatrix.array, sl = slots[k];
      for (let s = 0; s < n; s++) {
        const i = sl[s], i3 = i * 3, i4 = i * 4;
        pi.set(O[i3] + (P[i3] - O[i3]) * alpha, O[i3 + 1] + (P[i3 + 1] - O[i3 + 1]) * alpha, O[i3 + 2] + (P[i3 + 2] - O[i3 + 2]) * alpha);
        qi.set(QO[i4], QO[i4 + 1], QO[i4 + 2], QO[i4 + 3]).slerp(qb.set(Q[i4], Q[i4 + 1], Q[i4 + 2], Q[i4 + 3]), alpha);
        const f = Math.max(0, fade[i]);
        si.set(S[i3] * f, S[i3 + 1] * f, S[i3 + 2] * f);
        _m.compose(pi, qi, si); _m.toArray(a, s * 16);
      }
      m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true;
      if (n) m.instanceMatrix.clearUpdateRanges?.();
    }
  }
  function clear() { for (let i = 0; i < N; i++) if (kind[i] >= 0) release(i); st.live = 0; dirty = true; sync(1); }
  /** a hash of every live piece's position (determinism checks) */
  function hash() { let h = 2166136261 >>> 0; const b = new Uint32Array(P.buffer); for (let i = 0; i < N; i++) if (kind[i] >= 0) for (let c = 0; c < 3; c++) h = Math.imul(h ^ b[i * 3 + c], 16777619) >>> 0; return (h >>> 0).toString(16) + ':' + live; }
  function dispose() { if (!meshes) return; for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); m.dispose(); } group.removeFromParent(); meshes = null; }
  return { spawn, step, sync, clear, hash, dispose, stats: st, get live() { return live; }, get meshes() { return meshes; }, get group() { return group; }, prewarm: build };
}

// ---- marks: cracks, holes, dents, splinters, puddles, scorch -----------------------------------------------------
export const MARKS = {
  crack: { tile: 0, size: 0.42, color: '#dfeef2', opacity: 0.85 },
  hole: { tile: 1, size: 0.07, color: '#ffffff', opacity: 1 },
  dent: { tile: 2, size: 0.17, color: '#ffffff', opacity: 0.9 },
  splinter: { tile: 3, size: 0.16, color: '#ffffff', opacity: 1 },
  puddle: { tile: 4, size: 1, color: '#151a1d', opacity: 0.82 },
  scorch: { tile: 5, size: 0.8, color: '#ffffff', opacity: 0.9 },
  soot: { tile: 6, size: 0.4, color: '#ffffff', opacity: 0.7 },
};
function atlasTexture() {
  const T = 128, W = T * 4, H = T * 2, d = new Uint8Array(W * H * 4), R = sfc32(hash32('mirage/destruct/atlas'));
  const put = (tile, fn) => {
    const ox = (tile % 4) * T, oy = Math.floor(tile / 4) * T;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const u = (x + 0.5) / T * 2 - 1, v = (y + 0.5) / T * 2 - 1, [l, a] = fn(u, v, Math.hypot(u, v), Math.atan2(v, u));
      const o = ((oy + y) * W + ox + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.max(0, Math.min(255, l * 255)); d[o + 3] = Math.max(0, Math.min(255, a * 255));
    }
  };
  // crack: radial lines (jagged, branching) and two broken rings round a crushed centre
  const rays = Array.from({ length: 13 }, (_, k) => [k / 13 * 6.283 + (R() - 0.5) * 0.4, 0.55 + R() * 0.45, R() * 100]);
  const rings = [0.18 + R() * 0.06, 0.38 + R() * 0.1];
  put(0, (u, v, r, a) => {
    let s = 0;
    for (const [ang, len, ph] of rays) { const da = Math.abs(((a - ang - 0.06 * Math.sin(r * 23 + ph) + 9.42) % 6.283) - 3.14); const dist = da * r; if (r < len) s = Math.max(s, Math.max(0, 1 - dist / (0.012 + 0.008 * (1 - r))) * (1 - r / len * 0.6)); }
    for (const rr of rings) { const w = Math.abs(r - rr - 0.015 * Math.sin(a * 7)); if (Math.sin(a * 5 + rr * 40) > -0.2) s = Math.max(s, Math.max(0, 1 - w / 0.01) * 0.8); }
    if (r < 0.07) s = Math.max(s, 0.85 * (1 - r / 0.07) + 0.3);
    return [1, s];
  });
  // hole: a black core, a torn grey rim
  put(1, (u, v, r, a) => { const e = 0.32 + 0.06 * Math.sin(a * 9) + 0.04 * Math.sin(a * 17); return r < e ? [0.02, 1] : r < e + 0.38 ? [0.3 + 0.2 * (r - e), Math.max(0, 0.75 * (1 - (r - e) / 0.38))] : [0, 0]; });
  // dent: a dark soft ring with a bright lip
  put(2, (u, v, r) => [r < 0.55 ? 0.12 + r * 0.3 : 0.7, r < 0.9 ? 0.75 * Math.sin(Math.min(1, r / 0.9) * Math.PI) ** 0.7 : 0]);
  // splinter: a long torn gash
  put(3, (u, v) => { const w = 0.16 * (1 - Math.abs(u)) * (0.8 + 0.2 * Math.sin(u * 31)); return Math.abs(v) < w ? [0.05 + Math.abs(v) / w * 0.4, 1] : [0, 0]; });
  // puddle: a soft blob with a wobbly edge
  put(4, (u, v, r, a) => { const e = 0.78 + 0.08 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 7 + 2) + 0.03 * Math.sin(a * 13); return [1, Math.max(0, Math.min(1, (e - r) / 0.12))]; });
  // scorch / soot: noisy dark radial
  put(5, (u, v, r, a) => [0.04, Math.max(0, 1 - r / (0.8 + 0.12 * Math.sin(a * 6) + 0.08 * Math.sin(a * 13))) ** 0.8]);
  put(6, (u, v, r, a) => [0.08, Math.max(0, 1 - r) ** 1.6 * (0.7 + 0.3 * Math.sin(a * 11 + r * 9))]);
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
export function createMarks(root, { max = 96 } = {}) {
  let mesh = null, tile = null, n = 0, dirty = false;
  const owner = new Int32Array(max).fill(-1), P = new Float32Array(max * 3), Nn = new Float32Array(max * 3), size = new Float32Array(max * 2), rot = new Float32Array(max), seqs = new Uint32Array(max);
  let serial = 0;
  const _c = new THREE.Color(), up = new THREE.Vector3(0, 0, 1);
  function build() {
    if (mesh) return;
    // lit like the surface it is on (a crack on a pane catches the lamps; at night a white unlit mark would glow)
    const mat = new THREE.MeshStandardMaterial({ map: atlasTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide, roughness: 0.45, metalness: 0 });
    mat.name = 'destruct:marks';
    mat.onBeforeCompile = (s) => {
      s.vertexShader = 'attribute vec3 aMark;\nvarying float vMarkA;\n' + s.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (uv + aMark.xy) * vec2(0.25, 0.5);\nvMarkA = aMark.z;');
      s.fragmentShader = 'varying float vMarkA;\n' + s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vMarkA;');
    };
    mat.customProgramCacheKey = () => 'destruct:marks';
    const g = new THREE.PlaneGeometry(1, 1);
    tile = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); tile.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aMark', tile);
    mesh = passOut(new THREE.InstancedMesh(g, mat, max)); mesh.name = 'destruct:marks'; mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 4; mesh.visible = false;
    mesh.setColorAt(0, _c.set(1, 1, 1));
    root.add(mesh);
  }
  function write(i) {
    _v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    _q.setFromUnitVectors(up, _s.set(Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]));
    _q.multiply(_qr.setFromAxisAngle(up, rot[i]));
    _m.compose(_v, _q, _s.set(size[i * 2], size[i * 2 + 1], 1));
    mesh.setMatrixAt(i, _m); dirty = true;
  }
  function move(from, to) {
    owner[to] = owner[from]; seqs[to] = seqs[from]; rot[to] = rot[from];
    for (let c = 0; c < 3; c++) { P[to * 3 + c] = P[from * 3 + c]; Nn[to * 3 + c] = Nn[from * 3 + c]; tile.array[to * 3 + c] = tile.array[from * 3 + c]; mesh.instanceColor.array[to * 3 + c] = mesh.instanceColor.array[from * 3 + c]; }
    size[to * 2] = size[from * 2]; size[to * 2 + 1] = size[from * 2 + 1];
    write(to);
  }
  function removeAt(i) { n--; if (i !== n) move(n, i); owner[n] = -1; dirty = true; }
  /** a mark; returns its slot (stable until a remove). The oldest goes when the layer is full. */
  function add(type, at, normal, s, who, rotation, color, opacity, cap = max) {
    build();
    const M = MARKS[type] || MARKS.hole;
    while (n >= Math.min(cap, max)) { let o = 0; for (let i = 1; i < n; i++) if (seqs[i] < seqs[o]) o = i; removeAt(o); }
    const i = n++;
    owner[i] = who; seqs[i] = ++serial; rot[i] = rotation;
    for (let c = 0; c < 3; c++) { P[i * 3 + c] = at[c] + normal[c] * 0.004; Nn[i * 3 + c] = normal[c]; }
    size[i * 2] = s[0]; size[i * 2 + 1] = s[1];
    tile.array[i * 3] = M.tile % 4; tile.array[i * 3 + 1] = Math.floor(M.tile / 4); tile.array[i * 3 + 2] = opacity ?? M.opacity;
    mesh.setColorAt(i, _c.set(color || M.color));
    write(i);
    return i;
  }
  /** the slots of who's marks (into out); count returned */
  function of(who, out) { let k = 0; for (let i = 0; i < n; i++) if (owner[i] === who) out[k++] = i; return k; }
  function resize(i, sx, sy) { size[i * 2] = sx; size[i * 2 + 1] = sy; write(i); }
  function removeOwner(who) { for (let i = n - 1; i >= 0; i--) if (owner[i] === who) removeAt(i); }
  function sync() {
    if (!mesh || !dirty) return;
    dirty = false; mesh.count = n; mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; tile.needsUpdate = true;
  }
  function clear() { n = 0; owner.fill(-1); dirty = true; sync(); }
  function dispose() { if (!mesh) return; mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose(); mesh.removeFromParent(); mesh = null; }
  return { add, of, resize, removeOwner, sync, clear, dispose, size, get count() { return n; }, get mesh() { return mesh; }, prewarm: build };
}

// ---- broken states: one InstancedMesh per kind and material, grown when full -------------------------------------
export function createBrokenPools(root) {
  const pools = new Map(), geos = new Map();
  let group = null;
  const glassMat = () => { const m = new THREE.MeshStandardMaterial({ color: 0xcfe6ec, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }); m.name = 'destruct:broken-glass'; return m; };
  const plainMat = (c) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }); m.name = 'destruct:broken'; return m; };
  const defaults = { pane: null, crate: 0x8a6440, dent: 0x8c9094, tyre: 0x1c1c1e };
  function pool(kind, material) {
    const key = kind + '|' + (material ? material.uuid : 'default');
    let p = pools.get(key);
    if (!p) {
      if (!group) { group = new THREE.Group(); group.name = 'destruct:broken'; group.userData.collide = false; root.add(group); }
      if (!geos.has(kind)) geos.set(kind, BROKEN_STATES[kind]());
      const mat = material || (kind === 'pane' ? glassMat() : plainMat(defaults[kind] ?? 0x808080));
      p = { mesh: null, cap: 0, used: 0, free: [], mat, own: !material };
      grow(p, kind, 8);
      pools.set(key, p);
    }
    return p;
  }
  function grow(p, kind, cap) {
    const m = new THREE.InstancedMesh(geos.get(kind), p.mat, cap);
    m.name = 'destruct:broken:' + kind; m.count = 0; m.frustumCulled = false; m.castShadow = kind !== 'pane'; m.receiveShadow = true; m.userData.collide = false;
    if (p.mesh) { m.instanceMatrix.array.set(p.mesh.instanceMatrix.array); m.count = p.mesh.count; p.mesh.removeFromParent(); p.mesh.dispose(); }
    p.mesh = m; p.cap = cap; group.add(m);
  }
  /** show a broken state with matrix m; returns a ticket for hide() */
  function show(kind, material, m) {
    const p = pool(kind, material);
    let s = p.free.length ? p.free.pop() : p.used++;
    if (s >= p.cap) grow(p, kind, p.cap * 2);
    p.mesh.setMatrixAt(s, m); p.mesh.count = Math.max(p.mesh.count, s + 1); p.mesh.instanceMatrix.needsUpdate = true;
    return { p, s };
  }
  function hide(t) { if (!t) return; t.p.mesh.setMatrixAt(t.s, ZERO); t.p.mesh.instanceMatrix.needsUpdate = true; t.p.free.push(t.s); }
  function clear() { for (const p of pools.values()) { p.mesh.count = 0; p.used = 0; p.free.length = 0; } }
  function dispose() { for (const p of pools.values()) { p.mesh.removeFromParent(); p.mesh.dispose(); if (p.own) p.mat.dispose(); } for (const g of geos.values()) g.dispose(); pools.clear(); geos.clear(); group?.removeFromParent(); }
  return { show, hide, clear, dispose, pools };
}

// ---- mover layers: a pooled dynamic copy of an instanced prop, one InstancedMesh per source mesh ------------------
export function createMoverLayers(max = 64) {
  const layers = new Map();
  function layer(src) {
    let L = layers.get(src);
    if (!L) {
      const m = new THREE.InstancedMesh(src.geometry, src.material, max);
      m.name = (src.name || 'instances') + ':moving'; m.count = 0; m.frustumCulled = false; m.castShadow = src.castShadow; m.receiveShadow = src.receiveShadow;
      m.userData.collide = false; m.userData.mgDynamic = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (src.instanceColor) m.setColorAt(0, new THREE.Color(1, 1, 1));
      // the layer sits beside its source and takes the source's world matrix into account (copies are in world space)
      src.parent?.add(m);
      L = { mesh: m, src, free: [], used: 0, inv: new THREE.Matrix4() };
      layers.set(src, L);
    }
    return L;
  }
  /** a slot drawing the source's geometry; colour copied from the source instance */
  function take(src, index) {
    const L = layer(src);
    if (!L.free.length && L.used >= max) return null;
    const s = L.free.length ? L.free.pop() : L.used++;
    if (src.instanceColor) { const c = src.instanceColor.array; L.mesh.instanceColor.array.set(c.subarray(index * 3, index * 3 + 3), s * 3); L.mesh.instanceColor.needsUpdate = true; }
    L.mesh.count = Math.max(L.mesh.count, s + 1);
    return { L, s };
  }
  /** set a slot's world matrix (the layer has the source's parent, so world -> parent space here) */
  function set(t, world) {
    const L = t.L; L.src.parent?.updateWorldMatrix(true, false);
    L.inv.copy(L.src.parent ? L.src.parent.matrixWorld : _m.identity()).invert();
    _m2.multiplyMatrices(L.inv, world);
    L.mesh.setMatrixAt(t.s, _m2); L.mesh.instanceMatrix.needsUpdate = true;
  }
  function give(t) { if (!t) return; t.L.mesh.setMatrixAt(t.s, ZERO); t.L.mesh.instanceMatrix.needsUpdate = true; t.L.free.push(t.s); }
  function clear() { for (const L of layers.values()) { L.mesh.count = 0; L.used = 0; L.free.length = 0; } }
  function dispose() { for (const L of layers.values()) { L.mesh.removeFromParent(); L.mesh.dispose(); } layers.clear(); }
  return { take, set, give, clear, dispose, layers };
}
