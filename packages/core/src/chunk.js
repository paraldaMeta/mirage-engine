// Mirage original code.
// Spatial chunks: a merged batch is one draw call but also one bounding sphere, so the frustum never culls it.
// This splits a geometry into pieces that are compact in space, each with tight bounds and at most a vertex
// budget, so three's per-object frustum test (and the occlusion test, hiz.js) has something to reject.
//
//   import { chunkGeometry, chunkObject } from '@mirage/core/chunk';
//   const parts = chunkGeometry(geo, { maxVertices: 24000, maxSize: 40, minVertices: 1500 });   // BufferGeometry[]
//   const stats = chunkObject(root, { maxSize: 40 });      // every static mesh under root, replaced in place
//   new MeshBatch().add(...).finish({ chunk: true | { maxSize: 40 } })                           // the same, at merge time
//
// How: triangles are grouped into connected components (welded positions), so a bench or a column is never cut in
// two; a component larger than `maxSize` is cut by triangle instead. The items are split at the median of the
// longest axis of their centres until a piece is within `maxVertices` and either within `maxSize` metres or too
// small to be worth another draw call (`minVertices`: a split never makes a piece below it). Cut components
// leave shared positions on both sides of the cut: `geometry.userData.locked` (Uint8Array per vertex) marks them
// so the simplifier (simplify.js, autolod.js) keeps them and LODs of neighbours never crack.
// A geometry already small in both senses comes back as it was (same object): no extra draw calls for it.
import * as THREE from 'three';

const DEFAULTS = { maxVertices: 24000, maxSize: 40, minVertices: 1500 };

export function chunkGeometry(geo, opts = {}) {
  const { maxVertices, maxSize, minVertices } = { ...DEFAULTS, ...opts };
  const posA = geo.attributes.position, index = geo.index ? geo.index.array : null;
  const T = index ? (index.length / 3) | 0 : (posA.count / 3) | 0;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox, ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  if (T < 2 || posA.isInterleavedBufferAttribute || (T * 3 <= maxVertices && (ext <= maxSize || T * 3 < 2 * minVertices))) return [geo];
  const pos = posA.array, vi = (t, k) => (index ? index[t * 3 + k] : t * 3 + k);
  // weld positions (exact bits) -> components by union-find over triangles
  const N = posA.count, bits = new Uint32Array(pos.buffer, pos.byteOffset, N * 3);
  let cap = 1; while (cap < N * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), pid = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    const a = bits[i * 3], b = bits[i * 3 + 1], c = bits[i * 3 + 2];
    let h = Math.imul(a ^ Math.imul(b, 0x9E3779B1) ^ Math.imul(c, 0x85EBCA6B), 0xC2B2AE35); h ^= h >>> 15;
    let s = h & (cap - 1);
    for (;;) { const j = table[s]; if (j < 0) { table[s] = i; pid[i] = i; break; } if (bits[j * 3] === a && bits[j * 3 + 1] === b && bits[j * 3 + 2] === c) { pid[i] = j; break; } s = (s + 1) & (cap - 1); }
  }
  const up = new Uint32Array(N); for (let i = 0; i < N; i++) up[i] = i;
  const find = (x) => { while (up[x] !== x) { up[x] = up[up[x]]; x = up[x]; } return x; };
  for (let t = 0; t < T; t++) { const a = find(pid[vi(t, 0)]), b = find(pid[vi(t, 1)]), c = find(pid[vi(t, 2)]); if (b !== a) up[b] = a; if (c !== a) up[find(c)] = a; }
  // items: a whole component, or (for a component wider than maxSize) each of its triangles
  const comp = new Int32Array(N).fill(-1), cMin = [], cMax = [], cTris = [];
  const triComp = new Uint32Array(T);
  for (let t = 0; t < T; t++) {
    const r = find(pid[vi(t, 0)]);
    let c = comp[r];
    if (c < 0) { c = comp[r] = cTris.length; cTris.push(0); cMin.push(Infinity, Infinity, Infinity); cMax.push(-Infinity, -Infinity, -Infinity); }
    triComp[t] = c; cTris[c]++;
    for (let k = 0; k < 3; k++) for (let a = 0, o = vi(t, k) * 3; a < 3; a++) { const v = pos[o + a]; if (v < cMin[c * 3 + a]) cMin[c * 3 + a] = v; if (v > cMax[c * 3 + a]) cMax[c * 3 + a] = v; }
  }
  const C = cTris.length, whole = new Uint8Array(C), itemOfComp = new Int32Array(C).fill(-1);
  const iC = [], iW = [];   // item centre xyz, weight (vertices: 3 per triangle, the worst case)
  const itemTris = [];      // item -> triangles (array) for whole components; a single triangle otherwise
  for (let c = 0; c < C; c++) {
    whole[c] = Math.max(cMax[c * 3] - cMin[c * 3], cMax[c * 3 + 1] - cMin[c * 3 + 1], cMax[c * 3 + 2] - cMin[c * 3 + 2]) <= maxSize && cTris[c] * 3 <= maxVertices ? 1 : 0;
    if (whole[c]) { itemOfComp[c] = iW.length; iC.push((cMin[c * 3] + cMax[c * 3]) / 2, (cMin[c * 3 + 1] + cMax[c * 3 + 1]) / 2, (cMin[c * 3 + 2] + cMax[c * 3 + 2]) / 2); iW.push(cTris[c] * 3); itemTris.push([]); }
  }
  let cut = false;
  for (let t = 0; t < T; t++) {
    const c = triComp[t];
    if (whole[c]) { itemTris[itemOfComp[c]].push(t); continue; }
    cut = true;
    const a = vi(t, 0) * 3, b = vi(t, 1) * 3, d = vi(t, 2) * 3;
    iC.push((pos[a] + pos[b] + pos[d]) / 3, (pos[a + 1] + pos[b + 1] + pos[d + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[d + 2]) / 3); iW.push(3); itemTris.push(t);
  }
  // median splits along the longest axis of the item centres
  const order = new Uint32Array(iW.length); for (let i = 0; i < order.length; i++) order[i] = i;
  const out = [];
  const split = (lo, hi) => {
    let w = 0; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = lo; i < hi; i++) { const it = order[i]; w += iW[it]; for (let a = 0; a < 3; a++) { const v = iC[it * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; } }
    const e = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], ax = e[0] >= e[1] && e[0] >= e[2] ? 0 : e[1] >= e[2] ? 1 : 2;
    if (hi - lo < 2 || (w <= maxVertices && (e[ax] <= maxSize || w < 2 * minVertices))) { out.push([lo, hi]); return; }
    // sort this range by the axis, then cut where half the weight is (so both sides get about the same vertices)
    const part = Array.from(order.subarray(lo, hi)).sort((p, q) => iC[p * 3 + ax] - iC[q * 3 + ax]);
    order.set(part, lo);
    let acc = 0, mid = lo + 1;
    for (let i = lo; i < hi - 1; i++) { acc += iW[order[i]]; mid = i + 1; if (acc >= w / 2) break; }
    split(lo, mid); split(mid, hi);
  };
  split(0, order.length);
  if (out.length === 1) return [geo];
  // which chunks touch each welded position: more than one = on a cut (locked for the simplifier)
  const owner = cut ? new Int32Array(N).fill(-1) : null;
  const chunkTris = out.map(([lo, hi]) => { const ts = []; for (let i = lo; i < hi; i++) { const x = itemTris[order[i]]; if (typeof x === 'number') ts.push(x); else for (const t of x) ts.push(t); } return ts; });
  if (cut) chunkTris.forEach((ts, ci) => { for (const t of ts) if (!whole[triComp[t]]) for (let k = 0; k < 3; k++) { const p = pid[vi(t, k)]; if (owner[p] === -1) owner[p] = ci; else if (owner[p] !== ci) owner[p] = -2; } });
  const names = Object.keys(geo.attributes), remap = new Int32Array(N).fill(-1);
  return chunkTris.map((ts) => {
    const g = new THREE.BufferGeometry(), src = [];
    let idx = null;
    if (index) {
      idx = new Uint32Array(ts.length * 3);
      ts.forEach((t, i) => { for (let k = 0; k < 3; k++) { const v = index[t * 3 + k]; if (remap[v] < 0) { remap[v] = src.length; src.push(v); } idx[i * 3 + k] = remap[v]; } });
      for (const v of src) remap[v] = -1;
    } else for (const t of ts) src.push(t * 3, t * 3 + 1, t * 3 + 2);
    for (const name of names) {
      const a = geo.attributes[name], n = a.itemSize, arr = new a.array.constructor(src.length * n);
      for (let i = 0; i < src.length; i++) for (let k = 0, o = src[i] * n; k < n; k++) arr[i * n + k] = a.array[o + k];
      g.setAttribute(name, new THREE.BufferAttribute(arr, n, a.normalized));
    }
    if (idx) g.setIndex(new THREE.BufferAttribute(src.length <= 65535 ? new Uint16Array(idx) : idx, 1));
    if (cut) { const lock = new Uint8Array(src.length); let any = false; for (let i = 0; i < src.length; i++) if (owner[pid[src[i]]] === -2) { lock[i] = 1; any = true; } if (any) g.userData.locked = lock; }
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  });
}

// every static mesh under root (one material, no skinning / morphs / instancing) is replaced by its chunks, as
// siblings with the same transform, material, shadow flags, layers and userData. -> { meshes, chunks, split }
export function chunkObject(root, opts = {}) {
  const todo = [];
  root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh && !Array.isArray(o.material) && o.geometry?.attributes.position && !o.geometry.morphAttributes?.position && o.userData.chunk !== false && o.parent) todo.push(o); });
  const stats = { meshes: todo.length, chunks: 0, split: 0 };
  for (const mesh of todo) {
    const parts = chunkGeometry(mesh.geometry, opts);
    stats.chunks += parts.length;
    if (parts.length === 1) continue;
    stats.split++;
    const at = mesh.parent.children.indexOf(mesh), made = parts.map((g, i) => {
      const m = new THREE.Mesh(g, mesh.material);
      m.name = `${mesh.name}#${i}`;
      m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale);
      m.matrix.copy(mesh.matrix); m.matrixAutoUpdate = mesh.matrixAutoUpdate;
      m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow; m.layers.mask = mesh.layers.mask; m.renderOrder = mesh.renderOrder; m.frustumCulled = mesh.frustumCulled;
      m.userData = { ...mesh.userData }; m.customDepthMaterial = mesh.customDepthMaterial; m.customDistanceMaterial = mesh.customDistanceMaterial;
      return m;
    });
    const parent = mesh.parent;
    parent.remove(mesh);
    parent.children.splice(at, 0, ...made);
    for (const m of made) m.parent = parent;
    mesh.geometry.dispose();
  }
  return stats;
}
