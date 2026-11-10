// Mirage code. Approach adapted from the author's own earlier bakewalk (top-down rasterisation of layer-0
// geometry into a walk grid with step height and clearance); the method below (winding-number slabs) is new.
import * as THREE from 'three';
import { LAYER } from '@mirage/world';
import { nextFrame } from '@mirage/core/stream';

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
// bakeWalkGrid is one synchronous bake (0.1-1 s with the page frozen). bakeWalkGridAsync makes the same arrays over
// frames (fenced pixel-pack reads, a time budget a frame, tiles), and both re-bake a region of an earlier grid in
// place ({ region, into }), e.g. after a streamed module came in. ponytail: no moving obstacles (a swinging door
// needs a region re-bake).
// ---------------------------------------------------------------------------

export const MAXL = 4;
const MIN_GAP = 0.3;            // air thinner than this between two solids is ignored
const OFFSET = 0.0137;          // keeps slab boundaries off round heights (a face on a boundary would count twice)

// one for the page, kept: its program stays linked, so a re-bake while walking does not compile it again (~35 ms)
let shared = null;
const overrideMaterial = () => (shared ??= makeOverride());
function makeOverride() {
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

// the bake's fixed frame: grid size, slab count and the top-down camera. Every slab, tile and region re-bake renders
// through this same projection, so a cell's pixel is the same fragment whichever rectangle is drawn (a tile or a
// region only scissors the draw): a tiled or region bake gives the arrays of the whole bake, bit for bit.
function bakeFrame(world, { bounds, cell = 0.125, dy = 0.1, yMin = -1, yMax = 12 }) {
  const { renderer } = world;
  const [bx0, bz0, bx1, bz1] = bounds;
  const NX = Math.ceil((bx1 - bx0) / cell), NZ = Math.ceil((bz1 - bz0) / cell);
  if (NX > renderer.capabilities.maxTextureSize || NZ > renderer.capabilities.maxTextureSize) {
    throw new Error(`walk grid: ${NX} x ${NZ} cells is more than this GPU's ${renderer.capabilities.maxTextureSize} px; use larger cells or smaller plan bounds`);
  }
  const top = yMax + OFFSET, K = Math.ceil((yMax - yMin) / dy);
  const cam = new THREE.OrthographicCamera(-(NX * cell) / 2, (NX * cell) / 2, (NZ * cell) / 2, -(NZ * cell) / 2, 0, dy);
  cam.layers.set(LAYER.VIEW); cam.layers.enable(LAYER.COLLIDE);
  cam.up.set(0, 0, -1);   // image right = +x, image up = -z (north)
  return { bounds: [bx0, bz0, bx1, bz1], cell, dy, yMin, yMax, NX, NZ, top, K, cam, cx: bx0 + (NX * cell) / 2, cz: bz0 + (NZ * cell) / 2 };
}
// an earlier grid's frame for { into } (grids from makeGrid without .bake: their own extent, default slabs)
const frameOf = (o) => {
  const g = o.into;
  if (!g) return o;
  const b = g.bake || { bounds: [g.x0, g.z0, g.x0 + g.nx * g.cell, g.z0 + g.nz * g.cell], cell: g.cell };
  return { ...o, ...b };
};

// Take the scene over for bake draws; returns { draw(yTop, depth), leave() } (leave gives everything back).
function enterBake(world, F, rt) {
  const { renderer, scene } = world;
  // what counts: visible meshes on layer 0 that write depth, minus collide === false; plus collider proxies
  // Things that draw but do not count are taken off the bake camera's layers. Layers, unlike `visible`, do not pass
  // to children, so a solid mesh under a plain Object3D (glTF nodes), a LOD or a non-solid mesh still counts.
  const hidden = [];
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible || p.userData.collide === false) return false; return true; };
  // sig: what the bake sees (which solids, their geometry and placement), so an async bake notices a change between
  // its frames
  let h = 2166136261, w = 0, n = 0;
  scene.traverse((o) => {
    if (o === scene || !(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
    const solid = o.isMesh && shown(o) &&
      (o.userData.collider || ((o.layers.mask & 1) && [].concat(o.material).some((m) => m && m.depthWrite !== false && !m.transparent)));
    if (!solid) { hidden.push([o, o.layers.mask]); o.layers.disableAll(); return; }
    h = Math.imul(h ^ o.id, 16777619); h = Math.imul(h ^ (o.geometry?.id ?? 0), 16777619); n++;
    const e = o.matrixWorld.elements;
    for (let i = 0; i < 16; i++) w += e[i] * (i + 1) * ((n % 7) + 1);
    if (o.isInstancedMesh) { h = Math.imul(h ^ o.count, 16777619); h = Math.imul(h ^ o.instanceMatrix.version, 16777619); }
  });
  const saved = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, shadow: renderer.shadowMap.autoUpdate, ovr: scene.overrideMaterial, bg: scene.background, fog: scene.fog };
  renderer.getClearColor(saved.clear = new THREE.Color()); saved.alpha = renderer.getClearAlpha();
  renderer.shadowMap.autoUpdate = false;
  scene.overrideMaterial = F.material; scene.background = null; scene.fog = null;
  const { cam } = F;
  return {
    hidden: hidden.length, sig: `${h >>> 0}:${n}:${w}`,
    draw(yTop, depth) {
      cam.far = depth; cam.updateProjectionMatrix();
      cam.position.set(F.cx, yTop, F.cz); cam.lookAt(F.cx, yTop - 1, F.cz); cam.updateMatrixWorld();
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
      renderer.autoClear = false;
      renderer.render(scene, cam);
    },
    leave() {
      for (const [o, mask] of hidden) o.layers.mask = mask;
      renderer.setRenderTarget(saved.target); renderer.autoClear = saved.autoClear; renderer.shadowMap.autoUpdate = saved.shadow;
      renderer.setClearColor(saved.clear, saved.alpha);
      scene.overrideMaterial = saved.ovr; scene.background = saved.bg; scene.fog = saved.fog;
    },
  };
}

// The walk down the slabs for one rectangle of the image (x0, r0: its bottom-left pixel; w x h). top(px): the slab
// above the range; slab(px, yT): the next slab down; px = the rectangle's RGBA bytes. finish(floors, count) writes
// each column's lowest MAXL floors into the grid's arrays (image row r is cell row NZ - 1 - r).
function columns(F, x0, r0, w, h) {
  const n = w * h, { NX, NZ, top, dy } = F;
  const wind = new Int16Array(n), ceil = new Float32Array(n), found = new Float32Array(n * 8 * 2), nFound = new Uint8Array(n);   // floors top-down, before sorting
  let overflow = 0;
  return {
    top(px) { for (let q = 0; q < n; q++) { wind[q] = px[q * 4] - px[q * 4 + 1]; ceil[q] = wind[q] ? top : Infinity; } },
    slab(px, yT) {
      for (let q = 0; q < n; q++) {
        const Fr = px[q * 4], B = px[q * 4 + 1];
        if (!Fr && !B) continue;
        const wa = wind[q], wb = wa + Fr - B;
        wind[q] = wb;
        // depth in the slab (0 = top): the first crossing (exact), and the mean of the back faces (ceilings)
        const zMin = px[q * 4 + 3] / 255, zMax = B ? Math.max(zMin, (px[q * 4 + 2] * 4) / 255 / B) : zMin;
        const add = (f, c) => {
          if (c - f < MIN_GAP) return;
          if (nFound[q] >= 8) {   // full: drop the highest (found first), the lowest floors are the ones kept
            overflow++;
            found.copyWithin(q * 16, q * 16 + 2, q * 16 + 16); nFound[q]--;
          }
          found[(q * 8 + nFound[q]) * 2] = f; found[(q * 8 + nFound[q]) * 2 + 1] = c; nFound[q]++;
        };
        if (!wa && wb) add(yT - zMin * dy, ceil[q]);                       // air above, solid below: a floor
        else if (wa && !wb) ceil[q] = yT - zMax * dy;                      // solid above, air below: a ceiling
        else if (!wa && !wb && Fr && B) { add(yT - zMin * dy, ceil[q]); ceil[q] = yT - zMax * dy; }   // a thin plate inside the slab
      }
    },
    // keep the lowest MAXL floors (top-down order -> bottom-up); unused layers are zeroed (a re-bake overwrites)
    finish(floors, count) {
      let nf = 0;
      for (let q = 0; q < n; q++) {
        const i = q % w, k = (NZ - 1 - (r0 + (q - i) / w)) * NX + x0 + i, nq = nFound[q], m = Math.min(nq, MAXL);
        for (let l = 0; l < MAXL; l++) {
          const src = (q * 8 + (nq - 1 - l)) * 2, dst = (k * MAXL + l) * 2;
          floors[dst] = l < m ? found[src] : 0; floors[dst + 1] = l < m ? found[src + 1] : 0;
        }
        count[k] = m; nf += m; if (nq > MAXL) overflow += nq - MAXL;
      }
      return { floors: nf, overflow };
    },
  };
}

// a world-space region [x0, z0, x1, z1] -> the image rectangle of the cells it touches { x0, r0, w, h } (null: none)
function regionRect(F, region) {
  if (!region) return { x0: 0, r0: 0, w: F.NX, h: F.NZ };
  const [bx0, bz0] = F.bounds, c = F.cell;
  const i0 = Math.max(0, Math.floor((region[0] - bx0) / c)), i1 = Math.min(F.NX - 1, Math.floor((region[2] - bx0) / c));
  const j0 = Math.max(0, Math.floor((region[1] - bz0) / c)), j1 = Math.min(F.NZ - 1, Math.floor((region[3] - bz0) / c));
  return i1 < i0 || j1 < j0 ? null : { x0: i0, r0: F.NZ - 1 - j1, w: i1 - i0 + 1, h: j1 - j0 + 1 };
}
const tilesOf = (R, T) => {
  const out = [];
  if (R) for (let r = R.r0; r < R.r0 + R.h; r += T) for (let x = R.x0; x < R.x0 + R.w; x += T) out.push({ x0: x, r0: r, w: Math.min(T, R.x0 + R.w - x), h: Math.min(T, R.r0 + R.h - r) });
  return out;
};
const bakeTarget = (F) => new THREE.WebGLRenderTarget(F.NX, F.NZ, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
// the grid a bake fills: `into` (an earlier bake, updated in place) or new arrays
function gridFor(F, into) {
  if (into) {
    if (into.nx !== F.NX || into.nz !== F.NZ) throw new Error(`walk grid: into is ${into.nx} x ${into.nz} cells, this bake ${F.NX} x ${F.NZ}`);
    return into;
  }
  const N = F.NX * F.NZ;
  const grid = makeGrid({ nx: F.NX, nz: F.NZ, x0: F.bounds[0], z0: F.bounds[1], cell: F.cell, floors: new Float32Array(N * MAXL * 2), count: new Uint8Array(N) });
  grid.bake = { bounds: F.bounds, cell: F.cell, dy: F.dy, yMin: F.yMin, yMax: F.yMax };
  return grid;
}

/** Bake the walk grid of `world.scene` over `bounds`. Synchronous (one GPU readback per slab).
 *  { region: [x0, z0, x1, z1], into: grid }: re-bake only the cells under `region`, into an earlier bake's arrays. */
export function bakeWalkGrid(world, opts = {}) {
  const t0 = performance.now();
  const { renderer } = world;
  const F = bakeFrame(world, frameOf(opts));
  const R = regionRect(F, opts.region), grid = gridFor(F, opts.into);
  F.material = overrideMaterial();
  const rt = bakeTarget(F);
  let res = { floors: 0, overflow: 0 }, hidden = 0;
  try {
    if (R) {
      if (R.w !== F.NX || R.h !== F.NZ) { rt.scissor.set(R.x0, R.r0, R.w, R.h); rt.scissorTest = true; }
      const px = new Uint8Array(R.w * R.h * 4), col = columns(F, R.x0, R.r0, R.w, R.h);
      const bake = enterBake(world, F, rt);
      hidden = bake.hidden;
      try {
        // everything above the range first: the winding number at its top
        bake.draw(F.top + 1000, 1000); renderer.readRenderTargetPixels(rt, R.x0, R.r0, R.w, R.h, px); col.top(px);
        for (let s = 0; s < F.K; s++) {
          const yT = F.top - s * F.dy;
          bake.draw(yT, F.dy); renderer.readRenderTargetPixels(rt, R.x0, R.r0, R.w, R.h, px); col.slab(px, yT);
        }
      } finally { bake.leave(); }   // a throw mid-bake still gives the scene and the renderer back as they were
      res = col.finish(grid.floors, grid.count);
    }
  } finally { rt.dispose(); }
  grid.stats = { nx: F.NX, nz: F.NZ, slabs: F.K + 1, floors: res.floors, overflow: res.overflow, hidden, ms: +(performance.now() - t0).toFixed(1), ...(opts.region ? { region: R } : {}) };
  return grid;
}

/** The same bake spread over frames. Each frame it takes the scene over for at most `budgetMs` (4; at least one read
 *  is issued or taken per frame, whatever the budget), draws slabs and reads them through pixel-pack buffers polled
 *  with fences (no stall; at most `inflight` (8) reads in the air), and gives the scene back so the page draws in
 *  between. Tiles of `tile` (1024) cells a side are baked one after another, each written to the grid when complete
 *  (every tile draws the whole scene once per slab: smaller tiles cost more draws; they bound the memory and make a
 *  small region cheap). { region, into }: a region of an earlier bake, in place; async bakes into one grid run one
 *  after another, in the order asked. The arrays equal bakeWalkGrid's (the same draws through the same camera,
 *  scissored). If what the bake sees changes between its frames (a solid added, removed, moved), the tile starts again
 *  (up to `restarts` (3) times a tile; after that it finishes and grid.stats.changed = true: re-bake that region
 *  later). `signal`: an AbortSignal (tiles already finished stay written). Without fences (WebGL1) the reads are
 *  synchronous. `frame`: how to wait for the next frame (default: requestAnimationFrame). grid.stats adds tiles,
 *  frames, maxSliceMs, restarts. */
export function bakeWalkGridAsync(world, opts = {}) {
  const into = opts.into;
  if (!into) return bakeAsync(world, opts);
  const run = (queues.get(into) || Promise.resolve()).catch(() => {}).then(() => bakeAsync(world, opts));
  queues.set(into, run);
  return run;
}
const queues = new WeakMap();   // grid -> its last async bake: one at a time into a grid (two would interleave slabs)

async function bakeAsync(world, opts) {
  const t0 = performance.now();
  const { renderer } = world;
  const { tile = 1024, budgetMs = 4, inflight = 8, frame = nextFrame, restarts = 3, signal } = opts;
  const F = bakeFrame(world, frameOf(opts));
  const R = regionRect(F, opts.region), grid = gridFor(F, opts.into);
  const gl = renderer.getContext(), fences = typeof gl.fenceSync === 'function';
  F.material = overrideMaterial();
  const rt = bakeTarget(F), tiles = tilesOf(R, Math.max(16, tile | 0));
  const air = [];   // reads in flight, in slab order: { s, buf, sync } (or { s, px } without fences)
  const st = { floors: 0, overflow: 0, frames: 0, maxSliceMs: 0, hidden: 0, restarts: 0, changed: false };
  const total = F.K + 1;   // read 0: everything above the range; read s: the slab below top - (s - 1) dy
  const yOf = (s) => F.top - (s - 1) * F.dy;
  const drop = () => { for (const a of air) if (a.sync) { gl.deleteSync(a.sync); gl.deleteBuffer(a.buf); } air.length = 0; };
  try {
    for (const T of tiles) {
      rt.scissor.set(T.x0, T.r0, T.w, T.h); rt.scissorTest = T.w !== F.NX || T.h !== F.NZ;
      const bytes = T.w * T.h * 4, px = new Uint8Array(bytes);
      let col = columns(F, T.x0, T.r0, T.w, T.h), issued = 0, done = 0, sig = null, again = 0;
      while (done < total) {
        if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('walk grid bake aborted'), { name: 'AbortError' });
        const ts = performance.now();
        const bake = enterBake(world, F, rt);
        st.hidden = bake.hidden;
        try {
          if (sig !== null && bake.sig !== sig) {
            // the scene changed under this tile: start it again (its slabs so far saw another scene)
            if (again < restarts) { again++; st.restarts++; drop(); col = columns(F, T.x0, T.r0, T.w, T.h); issued = done = 0; }
            else st.changed = true;
          }
          sig = bake.sig;
          let did = 0;   // at least one read taken or issued per frame: a tiny budget or a slow traverse still moves
          const over = () => did > 0 && performance.now() - ts > budgetMs;
          for (;;) {
            // finished reads, oldest first (the columns take the slabs in order)
            while (air.length && (!air[0].sync || gl.clientWaitSync(air[0].sync, 0, 0) !== gl.TIMEOUT_EXPIRED)) {
              const a = air.shift();
              if (a.sync) {
                gl.deleteSync(a.sync);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, a.buf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                gl.deleteBuffer(a.buf);   // one buffer per read: Chrome warns when a read-back buffer is written again
              } else px.set(a.px);
              if (a.s === 0) col.top(px); else col.slab(px, yOf(a.s));
              done++; did++;
              if (over()) break;
            }
            if (issued >= total || air.length >= inflight || over()) break;
            const s = issued++;
            did++;
            bake.draw(s === 0 ? F.top + 1000 : yOf(s), s === 0 ? 1000 : F.dy);
            if (fences) {
              const buf = gl.createBuffer();
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf); gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
              gl.readPixels(T.x0, T.r0, T.w, T.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);   // draw() left the bake target bound
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
              air.push({ s, buf, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) });
              gl.flush();
            } else {
              const copy = new Uint8Array(bytes);
              renderer.readRenderTargetPixels(rt, T.x0, T.r0, T.w, T.h, copy);
              air.push({ s, px: copy, sync: null });
            }
          }
        } finally { bake.leave(); }
        st.maxSliceMs = Math.max(st.maxSliceMs, performance.now() - ts);
        if (done < total) { st.frames++; await frame(); }
      }
      const r = col.finish(grid.floors, grid.count);   // the tile goes live in one step
      st.floors += r.floors; st.overflow += r.overflow;
    }
  } finally {
    drop();   // a throw or an abort mid-bake
    rt.dispose();
  }
  grid.stats = { nx: F.NX, nz: F.NZ, slabs: total, floors: st.floors, overflow: st.overflow, hidden: st.hidden, tiles: tiles.length,
    frames: st.frames, maxSliceMs: +st.maxSliceMs.toFixed(1), restarts: st.restarts, ...(st.changed ? { changed: true } : {}),
    ms: +(performance.now() - t0).toFixed(1), ...(opts.region ? { region: R } : {}) };
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
