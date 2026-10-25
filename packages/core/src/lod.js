// Mirage — adapted from the author's own project.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

// ---------------------------------------------------------------------------
// lod.js — coarse-view twins of big static meshes.
//
// A merged, finely tessellated mesh under a costly material is expensive from afar: most triangles cover a few
// pixels and the GPU shades every 2x2 quad along their edges again. A twin decimated to a geometric error below
// a pixel (meshoptimizer from three's addons, borders locked, vertex attributes weighted) looks the same and
// shades far fewer quads.
//
//   const lod = createLod();
//   await lod.register(object, { errors: [0.02, 0.045], minTris: 4000, weights: { uv: 20 } })   // after building
//   lod.update(camera, { viewHalf, heightPx })   // per frame, before rendering
//
// Level 0 = the original meshes (anything that never calls update() sees only those); level k = the twin whose
// error is errors[k-1], used while that error stays under a pixel (orthographic: from viewHalf, the view's half
// height in metres; perspective: from the distance to the group's bounding sphere). Twins share material,
// layers, shadow flags, render order and custom depth materials with their source.
// ---------------------------------------------------------------------------

// weld identical vertices (all attributes equal, positions within 1e-5 m): meshoptimizer needs shared vertices
function weld(g) {
  const names = ['position', ...Object.keys(g.attributes).filter((k) => k !== 'position' && g.attributes[k].itemSize <= 4)];
  const pos = g.attributes.position;
  const n = pos.count;
  const src = g.index ? g.index.array : null;
  const nIdx = src ? src.length : n;
  const cols = [];
  for (const k of names) { const a = g.attributes[k]; for (let c = 0; c < a.itemSize; c++) cols.push([a, c]); }
  const W = cols.length;
  const vals = new Float32Array(n * W);
  for (let j = 0; j < W; j++) { const [a, c] = cols[j]; for (let i = 0; i < n; i++) vals[i * W + j] = a.getComponent(i, c); }
  // open-addressing hash on quantised values
  const cap = 1 << Math.ceil(Math.log2(n * 2 + 2));
  const table = new Int32Array(cap).fill(-1);
  const remap = new Int32Array(n);
  const uniq = [];
  const q = (v, j) => Math.round(v * (j < 3 ? 1e5 : 1e4));
  for (let i = 0; i < n; i++) {
    let h = 2166136261;
    for (let j = 0; j < W; j++) { h ^= q(vals[i * W + j], j); h = Math.imul(h, 16777619); }
    let s = (h >>> 0) & (cap - 1);
    for (;;) {
      const u = table[s];
      if (u < 0) { table[s] = uniq.length; remap[i] = uniq.length; uniq.push(i); break; }
      const r = uniq[u];
      let eq = true;
      for (let j = 0; j < W; j++) if (q(vals[i * W + j], j) !== q(vals[r * W + j], j)) { eq = false; break; }
      if (eq) { remap[i] = u; break; }
      s = (s + 1) & (cap - 1);
    }
  }
  const out = new THREE.BufferGeometry();
  for (const k of names) {
    const a = g.attributes[k], it = a.itemSize;
    const arr = new Float32Array(uniq.length * it);
    for (let u = 0; u < uniq.length; u++) for (let c = 0; c < it; c++) arr[u * it + c] = a.getComponent(uniq[u], c);
    out.setAttribute(k, new THREE.BufferAttribute(arr, it, a.normalized));
  }
  const idx = new Uint32Array(nIdx);
  for (let i = 0; i < nIdx; i++) idx[i] = remap[src ? src[i] : i];
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geo: out, names };
}

export function createLod() {
  const groups = [];   // { full: [Mesh], twins: [[Mesh]] per level, errors, sphere }
  const stats = { meshes: 0, tris: 0, twinTris: [], ms: 0 };

  async function register(root, { errors = [0.02, 0.045], minTris = 4000, filter = null, weights = {} } = {}) {
    const t0 = performance.now();
    await MeshoptSimplifier.ready;
    root.updateMatrixWorld(true);
    const list = [];
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isSkinnedMesh || o.morphTargetInfluences) return;
      const g = o.geometry;
      if (!g || !g.attributes.position || (g.groups && g.groups.length > 1) || Array.isArray(o.material)) return;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (tris < minTris || (filter && !filter(o))) return;
      list.push(o);
    });
    if (!list.length) return null;
    const grp = { full: list, twins: errors.map(() => []), errors, sphere: new THREE.Sphere() };
    const box = new THREE.Box3();
    for (const o of list) {
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld));
      const { geo, names } = weld(g);
      const pos = geo.attributes.position.array;
      // attributes beside the position, weighted (normals lightly: shading normals follow the surface anyway)
      const an = names.filter((k) => k !== 'position');
      let stride = 0; for (const k of an) stride += geo.attributes[k].itemSize;
      stride = Math.min(stride, 32);
      const nv = pos.length / 3, attr = new Float32Array(nv * Math.max(stride, 1)), w = [];
      let off = 0;
      for (const k of an) {
        const a = geo.attributes[k];
        for (let c = 0; c < a.itemSize && off < 32; c++, off++) { w.push(weights[k] ?? (k === 'normal' ? 0.3 : 0.5)); for (let i = 0; i < nv; i++) attr[i * stride + off] = a.array[i * a.itemSize + c]; }
      }
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      stats.meshes++; stats.tris += tris;
      errors.forEach((err, k) => {
        const [ni] = stride
          ? MeshoptSimplifier.simplifyWithAttributes(geo.index.array, pos, 3, attr, stride, w, null, 0, err, ['ErrorAbsolute', 'LockBorder'])
          : MeshoptSimplifier.simplify(geo.index.array, pos, 3, 0, err, ['ErrorAbsolute', 'LockBorder']);
        const tg = new THREE.BufferGeometry();
        for (const name of Object.keys(geo.attributes)) tg.setAttribute(name, geo.attributes[name]);   // shared buffers
        tg.setIndex(new THREE.BufferAttribute(ni, 1));
        tg.boundingBox = g.boundingBox; tg.boundingSphere = g.boundingSphere || null;
        if (!tg.boundingSphere) tg.computeBoundingSphere();
        const t = new THREE.Mesh(tg, o.material);
        t.name = o.name + '.lod' + (k + 1);
        t.matrixAutoUpdate = o.matrixAutoUpdate;
        t.position.copy(o.position); t.quaternion.copy(o.quaternion); t.scale.copy(o.scale);
        t.matrix.copy(o.matrix);
        t.layers.mask = o.layers.mask;
        t.castShadow = o.castShadow; t.receiveShadow = o.receiveShadow;
        t.renderOrder = o.renderOrder; t.frustumCulled = o.frustumCulled;
        t.customDepthMaterial = o.customDepthMaterial; t.customDistanceMaterial = o.customDistanceMaterial;
        t.userData.lodOf = o;
        t.visible = false;
        o.parent.add(t);
        grp.twins[k].push(t);
        stats.twinTris[k] = (stats.twinTris[k] || 0) + ni.length / 3;
      });
    }
    box.getBoundingSphere(grp.sphere);
    groups.push(grp);
    stats.ms += performance.now() - t0;
    return grp;
  }

  // the coarsest level whose error stays under a pixel
  const _v = new THREE.Vector3();
  function pick(grp, camera, viewHalf, heightPx) {
    let px;   // world size of one pixel at the group's nearest point
    if (viewHalf > 0) px = (2 * viewHalf) / heightPx;
    else {
      camera.getWorldPosition(_v);
      const d = Math.max(0, _v.distanceTo(grp.sphere.center) - grp.sphere.radius);
      const fov = camera.isPerspectiveCamera ? camera.fov : 50;
      px = (2 * d * Math.tan((fov * Math.PI) / 360)) / heightPx;
    }
    let lv = 0;
    grp.errors.forEach((e, k) => { if (e < px) lv = k + 1; });
    return lv;
  }
  function setLevel(grp, lv) {
    if (grp.level === lv) return;
    grp.level = lv;
    for (const o of grp.full) o.visible = lv === 0;
    grp.twins.forEach((list, k) => { for (const t of list) t.visible = lv === k + 1; });
  }
  /** Pick each group's level for this view: viewHalf = an orthographic view's half height in metres (0 for a
   *  perspective camera), heightPx = the render height in pixels. */
  function update(camera, { viewHalf = 0, heightPx = 900 } = {}) {
    for (const g of groups) setLevel(g, pick(g, camera, viewHalf, heightPx));
  }
  /** Back to the modules' own meshes (stills, bakes). */
  function reset() { for (const g of groups) setLevel(g, 0); }

  return { register, update, reset, groups, stats };
}
