// Mirage original code.
// Instances with per-instance frustum culling and per-instance level of detail. three's InstancedMesh is culled
// as one object (one sphere around all of it) and draws every instance at full detail; a forest of 100 000 trees
// is then always 100 000 full trees. Here the instances live in a grid of cells; each frame the cells are tested
// against the frustum (a cell fully outside or inside settles all its instances at once), the rest per instance,
// and each visible instance goes to the InstancedMesh of the level its distance asks for: the source mesh,
// simplified copies (simplify.js), or an impostor quad (impostor.js) as the last level.
//
//   import { createInstances } from '@mirage/core/instancing';
//   const trees = createInstances(world, { source: treeGroup,            // a Mesh or a Group of meshes (one material each)
//     matrices,                                                         // Float32Array, 16 per instance (world space)
//     ratios: [0.5, 0.2, 0.08], errorPx: 1.5, hysteresis: 0.15,         // LOD chain and switch rule, as autolod.js
//     impostor: true | bakeImpostor(...), impostorPx: 90,               // a quad once the instance is under 90 px tall
//     maxDistance: Infinity, cell: 32, castShadow: true, shadowMargin: 10 });
//   scene.add(trees.object);       // culls itself before each render of world.camera (auto: false -> trees.update(camera, heightPx))
//   trees.object.position may move (a floating origin); the walk grid ignores the instances unless collide: true
//   trees.stats                    // { instances, visible, perLevel: [...], cellsTested, instancesTested, triangles, ms }
//
// The work per frame is on the CPU: about 2-3 ns per culled-by-cell instance and 15-30 ns per individually
// tested one (measured numbers are in docs/big-worlds.md). The frame is skipped when the camera did not move.
// A GPU-driven version is not here: WebGL2 has no compute shaders, no indirect draws and transform feedback
// cannot drop or route primitives without a geometry shader, so the visible set would still have to come back to
// the CPU to set instance counts; see docs/big-worlds.md.
// Shadows: the sun's pass draws the same instances as the view. An instance just outside the view can still cast
// into it, so cast-shadow instances are kept while within `shadowMargin` metres of the frustum; impostors cast none.
import * as THREE from 'three';
import { createChain } from './simplify.js';
import { meshInput, levelGeometry } from './autolod.js';
import { bakeImpostor, impostorMaterial } from './impostor.js';
import { onView } from './frame.js';

const _m = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _fr = new THREE.Frustum(), _v = new THREE.Vector3();

export function createInstances(world, opts) {
  const { source, matrices, ratios = [0.5, 0.2, 0.08], errorPx = 1.5, hysteresis = 0.15, impostorPx = 90, maxDistance = Infinity, cell = 32,
    castShadow = true, receiveShadow = true, shadowMargin = castShadow ? 10 : 0, auto = true, levels: given = null } = opts;
  const n = (matrices.length / 16) | 0, object = new THREE.Group();
  object.name = (source.name || 'instances') + ':lod';
  // ---- the parts (one per material) with geometry in the source's root space, and their chains
  source.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(source.matrixWorld).invert(), parts = [];
  source.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) { const g = o.geometry.clone().applyMatrix4(_m.multiplyMatrices(rootInv, o.matrixWorld)); g.computeBoundingBox(); g.computeBoundingSphere(); parts.push({ material: o.material, geos: [g], errs: [0] }); } });
  const box = new THREE.Box3();
  for (const p of parts) box.union(p.geos[0].boundingBox);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  let nLevels = 1;
  for (const p of parts) {
    if (given) { for (const l of given) { p.geos.push(l.geometry); p.errs.push(l.error); } }
    else if ((p.geos[0].index ? p.geos[0].index.count : p.geos[0].attributes.position.count) >= 3 * 24) {
      const input = meshInput(p.geos[0]), chain = createChain(input, { ratios });
      chain.step();
      for (const l of chain.levels) { p.geos.push(levelGeometry(l, input.names, p.geos[0])); p.errs.push(l.error); }
    }
    nLevels = Math.max(nLevels, p.geos.length);
  }
  const errs = [];
  for (let l = 0; l < nLevels; l++) errs.push(Math.max(...parts.map((p) => p.errs[Math.min(l, p.errs.length - 1)])));
  const imp = opts.impostor === true ? bakeImpostor(world, source, opts.impostorBake) : opts.impostor || null;
  const L = nLevels + (imp ? 1 : 0);
  // ---- per level: one growing instance-matrix buffer shared by that level's meshes
  const lv = [];
  for (let l = 0; l < L; l++) {
    const isImp = imp && l === L - 1, attr = new THREE.InstancedBufferAttribute(new Float32Array(16 * 64), 16), meshes = [];
    attr.setUsage(THREE.DynamicDrawUsage);
    const add = (geo, material) => {
      const m = new THREE.InstancedMesh(geo, material, 1);
      m.instanceMatrix = attr; m.count = 0; m.frustumCulled = false; m.castShadow = castShadow && !isImp; m.receiveShadow = receiveShadow;
      m.userData = { lod: false, chunk: false, ...(isImp ? { collide: false } : {}), instanceLevel: l };
      m.name = `${object.name}:${l}`; meshes.push(m); object.add(m);
    };
    if (isImp) add(imp.geometry, opts.impostorMaterial || impostorMaterial(world, imp));
    else for (const p of parts) add(p.geos[Math.min(l, p.geos.length - 1)], p.material);
    lv.push({ attr, meshes, count: 0, tris: isImp ? 2 : parts.reduce((s, p) => { const g = p.geos[Math.min(l, p.geos.length - 1)]; return s + (g.index ? g.index.count : g.attributes.position.count) / 3; }, 0) });
  }
  // ---- instances: centre and radius, sorted into cells (xz grid); a cell knows its box and its range
  const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n), rad = new Float32Array(n), sc = new Float32Array(n), level = new Uint8Array(n), order = new Uint32Array(n);
  let cells = [];
  function index() {
    const key = new Map();
    for (let i = 0; i < n; i++) {
      const e = i * 16;
      _m.fromArray(matrices, e); _v.copy(sphere.center).applyMatrix4(_m);
      cx[i] = _v.x; cy[i] = _v.y; cz[i] = _v.z; sc[i] = Math.hypot(matrices[e], matrices[e + 1], matrices[e + 2]); rad[i] = sphere.radius * sc[i];
      const k = Math.floor(_v.x / cell) + ',' + Math.floor(_v.z / cell);
      let c = key.get(k);
      if (!c) key.set(k, c = { list: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], start: 0, end: 0, rmax: 0, smax: 0 });
      c.list.push(i);
      c.min[0] = Math.min(c.min[0], _v.x - rad[i]); c.min[1] = Math.min(c.min[1], _v.y - rad[i]); c.min[2] = Math.min(c.min[2], _v.z - rad[i]);
      c.max[0] = Math.max(c.max[0], _v.x + rad[i]); c.max[1] = Math.max(c.max[1], _v.y + rad[i]); c.max[2] = Math.max(c.max[2], _v.z + rad[i]);
      c.rmax = Math.max(c.rmax, rad[i]); c.smax = Math.max(c.smax, sc[i]);
    }
    cells = [...key.values()];
    let o = 0;
    for (const c of cells) { c.start = o; for (const i of c.list) order[o++] = i; c.end = o; c.list = null; c.cx = (c.min[0] + c.max[0]) / 2; c.cy = (c.min[1] + c.max[1]) / 2; c.cz = (c.min[2] + c.max[2]) / 2; c.r = Math.hypot(c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]) / 2; }
    level.fill(255);
  }
  index();

  const stats = { instances: n, visible: 0, perLevel: new Array(L).fill(0), cells: cells.length, cellsTested: 0, instancesTested: 0, triangles: 0, ms: 0, frames: 0 };
  const planes = new Float32Array(24), dist2 = new Float64Array(L + 1), lastCam = new Float64Array(22);
  object.userData.collide = opts.collide ?? false;   // the walk-grid bake has its own camera: it would see the last view's set
  const put = (l, i) => {
    const v = lv[l];
    if ((v.count + 1) * 16 > v.attr.array.length) { const a = new Float32Array(v.attr.array.length * 2); a.set(v.attr.array); const na = new THREE.InstancedBufferAttribute(a, 16); na.setUsage(THREE.DynamicDrawUsage); v.attr = na; for (const m of v.meshes) m.instanceMatrix = na; }
    const a = v.attr.array, o = v.count++ * 16, e = i * 16;
    for (let k = 0; k < 16; k++) a[o + k] = matrices[e + k];
  };
  function update(camera = world.camera, heightPx = 1080, force = false) {
    const t0 = performance.now(), me = camera.matrixWorld.elements, pe = camera.projectionMatrix.elements;
    // nothing to do while the view stands (the projection's jitter terms, [8] and [9], are left out on purpose)
    let same = !force && lastCam[18] === heightPx;
    for (let i = 0; i < 16; i++) if (lastCam[i] !== me[i]) { same = false; lastCam[i] = me[i]; }
    if (lastCam[16] !== pe[0] || lastCam[17] !== pe[5]) { same = false; lastCam[16] = pe[0]; lastCam[17] = pe[5]; }
    lastCam[18] = heightPx;
    // the group may be moved as a whole (a floating origin): the test runs in its space (translation only)
    object.updateWorldMatrix(true, false);
    const oe = object.matrixWorld.elements;
    for (let i = 0; i < 3; i++) if (lastCam[19 + i] !== oe[12 + i]) { same = false; lastCam[19 + i] = oe[12 + i]; }
    if (same) return;
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse.copy(camera.matrixWorld).invert()).multiply(object.matrixWorld);
    _fr.setFromProjectionMatrix(_pm, camera.coordinateSystem, camera.reversedDepth);
    for (let p = 0; p < 6; p++) { const pl = _fr.planes[p]; planes[p * 4] = pl.normal.x; planes[p * 4 + 1] = pl.normal.y; planes[p * 4 + 2] = pl.normal.z; planes[p * 4 + 3] = pl.constant; }
    const ex = me[12] - oe[12], ey = me[13] - oe[13], ez = me[14] - oe[14];
    // switch distances per level for a unit-scale instance: error * K / d = errorPx  ->  d = error * K / errorPx
    const K = camera.isPerspectiveCamera ? heightPx / (2 * Math.tan(camera.fov * Math.PI / 360)) : 0;
    for (let l = 1; l < nLevels; l++) dist2[l] = K ? errs[l] * K / errorPx : 0;
    if (imp) dist2[L - 1] = K ? 2 * sphere.radius * K / impostorPx : 0;
    for (const v of lv) v.count = 0;
    let tested = 0, cellsTested = 0;
    const max2 = maxDistance * maxDistance, hUp = 1 + hysteresis, hDown = 1 - hysteresis;
    for (let ci = 0; ci < cells.length; ci++) {
      const c = cells[ci];
      // the cell's sphere against the planes: out, in, or straddling
      let inside = true, out = false;
      const dxc = c.cx - ex, dyc = c.cy - ey, dzc = c.cz - ez, dc = Math.sqrt(dxc * dxc + dyc * dyc + dzc * dzc);
      if (dc - c.r > maxDistance) continue;
      for (let p = 0; p < 24; p += 4) {
        const d = planes[p] * c.cx + planes[p + 1] * c.cy + planes[p + 2] * c.cz + planes[p + 3];
        if (d < -c.r - shadowMargin) { out = true; break; }
        if (d < c.r + shadowMargin) inside = false;
      }
      if (out) continue;
      cellsTested++;
      for (let s = c.start; s < c.end; s++) {
        const i = order[s], x = cx[i], y = cy[i], z = cz[i];
        if (!inside) {
          tested++;
          const r = rad[i] + shadowMargin;
          if (planes[0] * x + planes[1] * y + planes[2] * z + planes[3] < -r || planes[4] * x + planes[5] * y + planes[6] * z + planes[7] < -r || planes[8] * x + planes[9] * y + planes[10] * z + planes[11] < -r ||
            planes[12] * x + planes[13] * y + planes[14] * z + planes[15] < -r || planes[16] * x + planes[17] * y + planes[18] * z + planes[19] < -r || planes[20] * x + planes[21] * y + planes[22] * z + planes[23] < -r) continue;
        }
        const dx = x - ex, dy = y - ey, dz = z - ez, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > max2) continue;
        const d = Math.sqrt(d2) / sc[i], was = level[i];
        let l = 0;
        // the coarsest level whose switch distance is behind us; the band around the level it has now is sticky
        for (let k = L - 1; k > 0; k--) { const t = dist2[k]; if (t > 0 && d >= t * (k > was || was === 255 ? (was === 255 ? 1 : hUp) : hDown)) { l = k; break; } }
        level[i] = l;
        put(l, i);
      }
    }
    let vis = 0, tri = 0;
    for (let l = 0; l < L; l++) {
      const v = lv[l];
      for (const m of v.meshes) { m.count = v.count; m.visible = v.count > 0; }
      if (v.count) { v.attr.clearUpdateRanges(); v.attr.addUpdateRange(0, v.count * 16); v.attr.needsUpdate = true; }
      stats.perLevel[l] = v.count; vis += v.count; tri += v.count * v.tris;
    }
    stats.visible = vis; stats.triangles = tri; stats.cellsTested = cellsTested; stats.instancesTested = tested; stats.ms = performance.now() - t0; stats.frames++;
  }
  const off = auto && world.scene ? onView(world.scene, world.camera, (cam, h) => update(cam, h)) : null;
  return {
    object, stats, update, levels: L, errors: errs, impostor: imp,
    // the instance set changed (same count): re-read `matrices`
    refresh() { index(); lastCam[0] = NaN; },
    dispose() { off?.(); object.removeFromParent(); for (const p of parts) p.geos.forEach((g) => g.dispose()); if (opts.impostor === true) imp.dispose(); for (const v of lv) for (const m of v.meshes) m.dispose(); },
  };
}
