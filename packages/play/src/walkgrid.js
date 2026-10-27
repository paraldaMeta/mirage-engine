// Mirage code. Approach adapted from the author's own earlier bakewalk (top-down rasterisation of layer-0
// geometry into a walk grid with step height and clearance); the method below (winding-number slabs) is new.
import * as THREE from 'three';
import { LAYER } from '@mirage/world';

// ---------------------------------------------------------------------------
// The walk grid: collision and ground from the real geometry, baked on the GPU in the page.
//
// The playable rectangle is cut into columns (cell = 0.125 m) and the height range into slabs (dy = 0.1 m).
// Each slab is one orthographic top-down render of every solid layer-0 mesh (plus collider proxies), clipped
// to the slab, DoubleSide: per cell R counts front faces, G back faces (additive), B sums the back faces'
// depths, A keeps the smallest depth of any face (min blending): the first crossing from above.
// Walking down a column, the winding number (fronts - backs seen so far) is non-zero inside a solid, so
// overlapping boxes, open-bottomed walls and inverted meshes all come out solid (no inside/outside guessing,
// no side views). Where it turns from 0 to non-zero is a floor (exact height from the depth sums), where it
// turns back is a ceiling. Per cell: up to MAXL floors, each with the ceiling above it.
//
//   const grid = bakeWalkGrid(world, { bounds: [x0, z0, x1, z1], yMin, yMax });
//   grid.layers(x, z) -> [[floor, ceil], ...] bottom to top     grid.support(x, z, y, step) -> [floor, ceil] | null
//
// Walls are simply floors far above your feet, gates are floors with a ceiling above head height, stairs are
// floors a step apart. Rules for modules: meshes with `userData.collide === false` are ignored (foliage, glass,
// the figure); open vertical tubes and water need a closed proxy (ctx.collider) because a vertical face is never
// seen from above, and so do solids thinner than a cell (railings): cells are sampled at their centres, so give
// them a proxy at least 0.2 m thick (packages/tools/bake-check.mjs).
// ponytail: one bake at load (0.1-1 s); no streaming, no moving obstacles (doors that swing need a re-bake).
// ---------------------------------------------------------------------------

export const MAXL = 4;
const MIN_GAP = 0.3;            // air thinner than this between two solids is ignored
const OFFSET = 0.0137;          // keeps slab boundaries off round heights (a face on a boundary would count twice)

function overrideMaterial() {
  const m = new THREE.MeshBasicMaterial({
    // forceSinglePass: a transparent DoubleSide material would be drawn as two passes, the back one with the
    // winding flipped (gl_FrontFacing true for back faces)
    side: THREE.DoubleSide, fog: false, depthTest: false, depthWrite: false, forceSinglePass: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.MinEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <dithering_fragment>', /* glsl */ `
      float z = gl_FragCoord.z;
      gl_FragColor = gl_FrontFacing ? vec4(1.0 / 255.0, 0.0, 0.0, z) : vec4(0.0, 1.0 / 255.0, z * 0.25, z);   // B: up to 4 back faces sum below 1`);
  };
  return m;
}

/** Bake the walk grid of `world.scene` over `bounds`. Synchronous (one GPU readback per slab). */
export function bakeWalkGrid(world, { bounds, cell = 0.125, dy = 0.1, yMin = -1, yMax = 12 } = {}) {
  const t0 = performance.now();
  const { renderer, scene } = world;
  const [bx0, bz0, bx1, bz1] = bounds;
  const NX = Math.ceil((bx1 - bx0) / cell), NZ = Math.ceil((bz1 - bz0) / cell), N = NX * NZ;
  const top = yMax + OFFSET, K = Math.ceil((yMax - yMin) / dy);

  // what counts: visible meshes on layer 0 that write depth, minus collide === false; plus collider proxies
  const hidden = [];
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible || p.userData.collide === false) return false; return true; };
  scene.traverse((o) => {
    if (o === scene) return;
    const solid = (o.isMesh || o.isInstancedMesh || o.isBatchedMesh) && shown(o) &&
      (o.userData.collider || ((o.layers.mask & 1) && [].concat(o.material).some((m) => m && m.depthWrite !== false && !m.transparent)));
    if (!solid && o.visible && !o.isGroup && !o.isScene && !o.isLight) { o.visible = false; hidden.push(o); }
  });
  const saved = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, shadow: renderer.shadowMap.autoUpdate, ovr: scene.overrideMaterial, bg: scene.background, fog: scene.fog };
  renderer.getClearColor(saved.clear = new THREE.Color()); saved.alpha = renderer.getClearAlpha();
  renderer.shadowMap.autoUpdate = false;
  scene.overrideMaterial = overrideMaterial(); scene.background = null; scene.fog = null;
  const rt = new THREE.WebGLRenderTarget(NX, NZ, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const cam = new THREE.OrthographicCamera(-(NX * cell) / 2, (NX * cell) / 2, (NZ * cell) / 2, -(NZ * cell) / 2, 0, dy);
  cam.layers.set(LAYER.VIEW); cam.layers.enable(LAYER.COLLIDE);
  cam.up.set(0, 0, -1);   // image right = +x, image up = -z (north)
  const cx = bx0 + (NX * cell) / 2, cz = bz0 + (NZ * cell) / 2;
  const px = new Uint8Array(N * 4);
  const slab = (yTop, depth) => {
    cam.far = depth; cam.updateProjectionMatrix();
    cam.position.set(cx, yTop, cz); cam.lookAt(cx, yTop - 1, cz); cam.updateMatrixWorld();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
    renderer.autoClear = false;
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, NX, NZ, px);
  };
  // pixel row r (from the bottom of the image) is the cell row j = NZ - 1 - r (z grows downward in the image)
  const cellOf = (p) => { const i = p % NX, r = (p - i) / NX; return (NZ - 1 - r) * NX + i; };

  const wind = new Int16Array(N), ceil = new Float32Array(N), floors = new Float32Array(N * MAXL * 2), count = new Uint8Array(N);
  let nf = 0, overflow = 0;
  // everything above the range first: the winding number at its top
  slab(top + 1000, 1000);
  for (let p = 0; p < N; p++) { const k = cellOf(p); wind[k] = px[p * 4] - px[p * 4 + 1]; ceil[k] = wind[k] ? top : Infinity; }
  const found = new Float32Array(N * 8 * 2), nFound = new Uint8Array(N);   // floors top-down, before sorting
  for (let s = 0; s < K; s++) {
    const yT = top - s * dy;
    slab(yT, dy);
    for (let p = 0; p < N; p++) {
      const F = px[p * 4], B = px[p * 4 + 1];
      if (!F && !B) continue;
      const k = cellOf(p), wa = wind[k], wb = wa + F - B;
      wind[k] = wb;
      // depth in the slab (0 = top): the first crossing (exact), and the mean of the back faces (ceilings)
      const zMin = px[p * 4 + 3] / 255, zMax = B ? Math.max(zMin, (px[p * 4 + 2] * 4) / 255 / B) : zMin;
      const add = (f, c) => {
        if (c - f < MIN_GAP) return;
        if (nFound[k] >= 8) { overflow++; return; }
        found[(k * 8 + nFound[k]) * 2] = f; found[(k * 8 + nFound[k]) * 2 + 1] = c; nFound[k]++;
      };
      if (!wa && wb) add(yT - zMin * dy, ceil[k]);                       // air above, solid below: a floor
      else if (wa && !wb) ceil[k] = yT - zMax * dy;                      // solid above, air below: a ceiling
      else if (!wa && !wb && F && B) { add(yT - zMin * dy, ceil[k]); ceil[k] = yT - zMax * dy; }   // a thin plate inside the slab
    }
  }
  // keep the lowest MAXL floors (top-down order -> bottom-up)
  for (let k = 0; k < N; k++) {
    const n = nFound[k], m = Math.min(n, MAXL);
    for (let l = 0; l < m; l++) { const src = (k * 8 + (n - 1 - l)) * 2; floors[(k * MAXL + l) * 2] = found[src]; floors[(k * MAXL + l) * 2 + 1] = found[src + 1]; }
    count[k] = m; nf += m; if (n > MAXL) overflow += n - MAXL;
  }

  for (const o of hidden) o.visible = true;
  renderer.setRenderTarget(saved.target); renderer.autoClear = saved.autoClear; renderer.shadowMap.autoUpdate = saved.shadow;
  renderer.setClearColor(saved.clear, saved.alpha);
  scene.overrideMaterial.dispose(); scene.overrideMaterial = saved.ovr; scene.background = saved.bg; scene.fog = saved.fog;
  rt.dispose();
  const grid = makeGrid({ nx: NX, nz: NZ, x0: bx0, z0: bz0, cell, floors, count });
  grid.stats = { nx: NX, nz: NZ, slabs: K + 1, floors: nf, overflow, hidden: hidden.length, ms: +(performance.now() - t0).toFixed(1) };
  return grid;
}

/** Queries over baked arrays (also used by tests with a hand-made grid). */
export function makeGrid({ nx, nz, x0, z0, cell, floors, count }) {
  const idx = (x, z) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i;
  };
  return {
    nx, nz, x0, z0, cell, floors, count, idx,
    /** [[floor, ceil], ...] of the column at (x, z), bottom to top */
    layers(x, z) {
      const k = idx(x, z), out = [];
      if (k >= 0) for (let l = 0; l < count[k]; l++) out.push([floors[(k * MAXL + l) * 2], floors[(k * MAXL + l) * 2 + 1]]);
      return out;
    },
    /** the highest floor at most `step` above y, with its ceiling: [floor, ceil], or null (inside a solid, off the grid) */
    supportAt(k, y, step) {
      if (k < 0) return null;
      for (let l = count[k] - 1; l >= 0; l--) {
        const f = floors[(k * MAXL + l) * 2];
        if (f <= y + step) return [f, floors[(k * MAXL + l) * 2 + 1]];
      }
      return null;
    },
    support(x, z, y, step = 0.4) { return this.supportAt(idx(x, z), y, step); },
    /** the ground a body standing at (x, z) at height y would stand on (NaN if none) */
    groundAt(x, z, y = 1e4, step = 0) { const s = this.support(x, z, y, step); return s ? s[0] : NaN; },
  };
}
