// Mirage original code. The winding-number idea is @mirage/play walkgrid.js's; this file does it without a GPU.
// ---------------------------------------------------------------------------
// The walk grid for a machine with no GPU: the server's collision.
//
// @mirage/play bakes the grid by rendering the scene top-down on the GPU (walkgrid.js). A dedicated server has no
// GPU, so it gets the same arrays one of two ways:
//
// 1. A serialised grid. A page that baked the grid writes it out, the server loads it, and every client loads the
//    server's copy instead of baking its own: both ends then predict on identical bits (docs/multiplayer.md).
//      const bytes = serializeGrid(play.grid);            // browser, after the GPU bake (`mirage-net bake` does this)
//      const grid = deserializeGrid(bytes);               // Node: { nx, nz, x0, z0, cell, floors, count, support(), ... }
//    Format: 'MGRD' u8 version | nx u32 nz u32 | x0 z0 cell f64 | runs { length varu, count u8, count x (floor f32, ceil f32) }
//    (identical neighbouring columns are one run: hello-courtyard's 44 544 columns are 239 KB, 18 KB gzipped).
//    deserializeGrid validates every size before it allocates and throws on anything inconsistent.
// 2. A CPU bake from triangles, for worlds whose solids can be listed without a renderer (boxes from a plan, a
//    three scene built in Node):
//      const grid = bakeGridCPU(triangles, { bounds, cell, yMin, yMax });   // triangles: Float32Array, 9 numbers each
//      const grid = bakeGridCPU(sceneTriangles(scene), { bounds });         // any three.js scene (duck-typed, no import)
//      boxTriangles([[x0, y0, z0, x1, y1, z1], ...])                        // axis-aligned solids
//    Same rule as the GPU bake: per column, walking down, the winding number (front faces minus back faces crossed)
//    is non-zero inside a solid; 0 -> non-zero is a floor, non-zero -> 0 a ceiling. The CPU version takes the exact
//    crossing heights where the GPU one has 8-bit depths in 0.1 m slabs, so floors agree to about a millimetre but
//    not bit for bit: use ONE grid on both ends (ship the serialised one), never a GPU bake against a CPU bake.
//
// makeGrid here is the same query object as @mirage/play's (createWalker and createNavGrid take either).
// ---------------------------------------------------------------------------

export const MAXL = 4;
const MIN_GAP = 0.3;
const MAX_CELLS = 16 << 20;   // 16.7 M columns: a 512 m square at 0.125 m. More is refused, from a file or an option.

export function makeGrid({ nx, nz, x0, z0, cell, floors, count }) {
  const idx = (x, z) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i;
  };
  return {
    nx, nz, x0, z0, cell, floors, count, idx,
    layers(x, z) {
      const k = idx(x, z), out = [];
      if (k >= 0) for (let l = 0; l < count[k]; l++) out.push([floors[(k * MAXL + l) * 2], floors[(k * MAXL + l) * 2 + 1]]);
      return out;
    },
    supportAt(k, y, step) {
      if (k < 0) return null;
      for (let l = count[k] - 1; l >= 0; l--) {
        const f = floors[(k * MAXL + l) * 2];
        if (f <= y + step) return [f, floors[(k * MAXL + l) * 2 + 1]];
      }
      return null;
    },
    support(x, z, y, step = 0.4) { return this.supportAt(idx(x, z), y, step); },
    groundAt(x, z, y = 1e4, step = 0) { const s = this.support(x, z, y, step); return s ? s[0] : NaN; },
  };
}

const same = (floors, a, b, n) => { for (let i = 0; i < n * 2; i++) if (floors[a * MAXL * 2 + i] !== floors[b * MAXL * 2 + i]) return false; return true; };

export function serializeGrid(grid) {
  const { nx, nz, floors, count } = grid, N = nx * nz;
  let size = 4 + 1 + 8 + 24;
  for (let k = 0; k < N;) {   // first pass: the size
    let e = k + 1; while (e < N && count[e] === count[k] && same(floors, e, k, count[k])) e++;
    let len = e - k; do { size++; len >>>= 7; } while (len);
    size += 1 + count[k] * 8; k = e;
  }
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set([77, 71, 82, 68, 1]);
  v.setUint32(5, nx, true); v.setUint32(9, nz, true);
  v.setFloat64(13, grid.x0, true); v.setFloat64(21, grid.z0, true); v.setFloat64(29, grid.cell, true);
  let o = 37;
  for (let k = 0; k < N;) {
    let e = k + 1; while (e < N && count[e] === count[k] && same(floors, e, k, count[k])) e++;
    let len = e - k; while (len > 127) { out[o++] = (len & 127) | 128; len >>>= 7; } out[o++] = len;
    out[o++] = count[k];
    for (let i = 0; i < count[k] * 2; i++) { v.setFloat32(o, floors[k * MAXL * 2 + i], true); o += 4; }
    k = e;
  }
  return out;
}

export function deserializeGrid(bytes) {
  const bad = (m) => { throw new Error('mirage net: walk grid file: ' + m); };
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < 37 || bytes[0] !== 77 || bytes[1] !== 71 || bytes[2] !== 82 || bytes[3] !== 68) bad('not a grid');
  if (bytes[4] !== 1) bad('version ' + bytes[4]);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = v.getUint32(5, true), nz = v.getUint32(9, true), x0 = v.getFloat64(13, true), z0 = v.getFloat64(21, true), cell = v.getFloat64(29, true);
  if (!nx || !nz || nx * nz > MAX_CELLS) bad(`${nx} x ${nz} cells`);
  if (![x0, z0, cell].every(Number.isFinite) || !(cell > 0.01 && cell < 100)) bad('frame');
  const N = nx * nz, floors = new Float32Array(N * MAXL * 2), count = new Uint8Array(N);
  let o = 37, k = 0;
  while (k < N) {
    let len = 0, s = 0, b;
    do { if (o >= bytes.length || s > 28) bad('truncated'); b = bytes[o++]; len |= (b & 127) << s; s += 7; } while (b & 128);
    const c = bytes[o++];
    if (!(len > 0) || k + len > N || c > MAXL || o + c * 8 > bytes.length) bad('run');
    for (let i = 0; i < c * 2; i++) { const f = v.getFloat32(o + i * 4, true); if (!Number.isFinite(f) && f !== Infinity) bad('height'); floors[k * MAXL * 2 + i] = f; }
    count[k] = c;
    for (let e = k + 1; e < k + len; e++) { count[e] = c; floors.copyWithin(e * MAXL * 2, k * MAXL * 2, k * MAXL * 2 + c * 2); }
    o += c * 8; k += len;
  }
  return makeGrid({ nx, nz, x0, z0, cell, floors, count });
}

/** Bake a walk grid on the CPU. triangles: Float32Array of world-space corners (9 numbers a triangle), wound
 *  counter-clockwise seen from outside the solid. */
export function bakeGridCPU(triangles, { bounds, cell = 0.125, yMin = -1, yMax = 12 } = {}) {
  const t0 = performance.now();
  const [bx0, bz0, bx1, bz1] = bounds;
  const nx = Math.ceil((bx1 - bx0) / cell), nz = Math.ceil((bz1 - bz0) / cell), N = nx * nz;
  if (!(N > 0) || N > MAX_CELLS) throw new Error(`mirage net: walk grid of ${nx} x ${nz} cells; use larger cells or smaller bounds`);
  // crossings per column as linked lists in growing arrays
  let cap = 1 << 16, n = 0, ys = new Float32Array(cap), sign = new Int8Array(cap), next = new Int32Array(cap);
  const head = new Int32Array(N).fill(-1);
  // column centres are nudged off the lattice by an amount no modelled edge lands on, so a centre exactly on the
  // edge two triangles share is counted once (what a rasteriser's fill rule does)
  const EX = 1.37e-5, EZ = 2.11e-5;
  const T = triangles;
  for (let p = 0; p + 8 < T.length; p += 9) {
    const ax = T[p], ay = T[p + 1], az = T[p + 2], bx = T[p + 3], by = T[p + 4], bz = T[p + 5], cx = T[p + 6], cy = T[p + 7], cz = T[p + 8];
    // twice the signed area seen from above: its sign is the side the face shows to the sky
    const area = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (!(Math.abs(area) > 1e-12)) continue;   // vertical or degenerate: never crossed by a vertical line
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - bx0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - bx0) / cell - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - bz0) / cell - 0.5)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - bz0) / cell - 0.5));
    for (let j = j0; j <= j1; j++) {
      const z = bz0 + (j + 0.5) * cell + EZ;
      for (let i = i0; i <= i1; i++) {
        const x = bx0 + (i + 0.5) * cell + EX;
        const w0 = ((bz - z) * (cx - x) - (bx - x) * (cz - z)) / area, w1 = ((cz - z) * (ax - x) - (cx - x) * (az - z)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        if (n === cap) { cap *= 2; const y2 = new Float32Array(cap); y2.set(ys); ys = y2; const s2 = new Int8Array(cap); s2.set(sign); sign = s2; const n2 = new Int32Array(cap); n2.set(next); next = n2; }
        const k = j * nx + i;
        ys[n] = w0 * ay + w1 * by + w2 * cy; sign[n] = area > 0 ? 1 : -1; next[n] = head[k]; head[k] = n++;
      }
    }
  }
  const floors = new Float32Array(N * MAXL * 2), count = new Uint8Array(N);
  const col = [], found = [];
  let nFloors = 0, overflow = 0;
  for (let k = 0; k < N; k++) {
    if (head[k] < 0) continue;
    col.length = 0; found.length = 0;
    for (let q = head[k]; q >= 0; q = next[q]) col.push(q);
    col.sort((a, b) => ys[b] - ys[a] || sign[b] - sign[a]);   // top down; at one height the face entering a solid first
    let wind = 0, ceil = Infinity, q = 0;
    for (; q < col.length && ys[col[q]] > yMax; q++) wind += sign[col[q]];   // what is above the range only sets the start
    if (wind) ceil = yMax;
    for (; q < col.length && ys[col[q]] >= yMin; q++) {
      const y = ys[col[q]], after = wind + sign[col[q]];
      if (!wind && after) { if (ceil - y >= MIN_GAP) found.push(y, ceil); }
      else if (wind && !after) ceil = y;
      wind = after;
    }
    const nq = found.length / 2, m = Math.min(nq, MAXL);
    for (let l = 0; l < m; l++) { floors[(k * MAXL + l) * 2] = found[(nq - 1 - l) * 2]; floors[(k * MAXL + l) * 2 + 1] = found[(nq - 1 - l) * 2 + 1]; }
    count[k] = m; nFloors += m; overflow += nq - m;
  }
  const grid = makeGrid({ nx, nz, x0: bx0, z0: bz0, cell, floors, count });
  grid.bake = { bounds: [bx0, bz0, bx1, bz1], cell, yMin, yMax, cpu: true };
  grid.stats = { nx, nz, triangles: T.length / 9, crossings: n, floors: nFloors, overflow, ms: +(performance.now() - t0).toFixed(1) };
  return grid;
}

/** triangles of axis-aligned boxes [[x0, y0, z0, x1, y1, z1], ...] (only their tops and bottoms matter to the bake) */
export function boxTriangles(boxes) {
  const out = new Float32Array(boxes.length * 36);
  boxes.forEach(([x0, y0, z0, x1, y1, z1], b) => {
    // top faces counter-clockwise from above, bottoms the other way
    out.set([x0, y1, z0, x0, y1, z1, x1, y1, z1, x0, y1, z0, x1, y1, z1, x1, y1, z0,
      x0, y0, z0, x1, y0, z1, x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1], b * 36);
  });
  return out;
}

/** World-space triangles of what the walk-grid bake counts as solid in a three.js scene: visible meshes on layer 0
 *  that write depth and are not transparent, plus `userData.collider` proxies, minus `userData.collide === false`
 *  subtrees. Reads plain properties only (no three import): works in Node on a scene built without a renderer. */
export function sceneTriangles(scene) {
  scene.updateMatrixWorld?.(true);
  const chunks = [];
  let total = 0;
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible || p.userData?.collide === false) return false; return true; };
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || !shown(o)) return;
    const solid = o.userData?.collider || ((o.layers.mask & 1) && [].concat(o.material).some((m) => m && m.depthWrite !== false && !m.transparent));
    if (!solid) return;
    const pos = o.geometry.attributes.position, index = o.geometry.index, nTri = (index ? index.count : pos.count) / 3 | 0;
    const mats = [];
    if (o.isInstancedMesh) {
      const a = o.instanceMatrix.array, w = o.matrixWorld.elements;
      for (let i = 0; i < o.count; i++) mats.push(mul(w, a, i * 16));
    } else mats.push(o.matrixWorld.elements);
    for (const m of mats) {
      const out = new Float32Array(nTri * 9);
      // a mirrored transform flips the winding on screen and three flips the front face to match: do the same
      const flip = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]) < 0;
      for (let t = 0; t < nTri; t++) for (let c = 0; c < 3; c++) {
        const v = index ? index.getX(t * 3 + c) : t * 3 + c, x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        const d = t * 9 + (flip ? 2 - c : c) * 3;
        out[d] = m[0] * x + m[4] * y + m[8] * z + m[12]; out[d + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; out[d + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      chunks.push(out); total += out.length;
    }
  });
  const all = new Float32Array(total);
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  return all;
}
function mul(a, b, bo) {
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) r[c * 4 + row] = a[row] * b[bo + c * 4] + a[4 + row] * b[bo + c * 4 + 1] + a[8 + row] * b[bo + c * 4 + 2] + a[12 + row] * b[bo + c * 4 + 3];
  return r;
}

/** the first solid a segment meets on the grid: marching in half-cell steps; returns the distance or Infinity.
 *  Used by the server's lag-compensated hit query so a wall between two players blocks the hit. */
export function gridRay(grid, o, d, range) {
  const step = grid.cell * 0.5;
  for (let t = step; t < range; t += step) {
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t, k = grid.idx(x, z);
    if (k < 0) continue;
    // free where some layer has its floor below y and its ceiling above y
    let free = grid.count[k] === 0;
    for (let l = 0; l < grid.count[k] && !free; l++) if (grid.floors[(k * MAXL + l) * 2] <= y && grid.floors[(k * MAXL + l) * 2 + 1] >= y) free = true;
    if (!free) return t;
  }
  return Infinity;
}
