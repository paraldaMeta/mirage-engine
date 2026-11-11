// Mirage original code.
// ---------------------------------------------------------------------------
// NPC navigation on the walk grid the player already walks on: no second mesh, no wasm, no re-bake.
//
//   const nav = createNavGrid(grid, { coarse: 4 });           // grid: bakeWalkGrid / makeGrid / play.grid
//   nav.findPath([x, y, z], [x, y, z], { radius })  -> [[x, y, z], ...] waypoints (feet heights) | null
//   nav.flowField(goal, { radius, maxCost })        -> one Dijkstra field per goal; field.direction(x, y, z)
//   nav.block({ box: [x0, y0, z0, x1, y1, z1] } | { cylinder: [x, z, r, y0, y1] }) -> id;  nav.unblock(id)
//   nav.block({ obb: [cx, cz, hx, hz, yaw, y0, y1] })          // a turned box (a door leaf, a crate): nav-carve.js feeds these
//   nav.setArea(shape, id); nav.setAreaCost(id, 4)             // areas (mud, road, a guard's forbidden zone): the cost of a
//   nav.findPath(a, b, { costs: { 2: Infinity } })             // metre there; per query too (Infinity: no way through)
//   nav.link({ from, to, cost, bidirectional, type: 'jump' })  // off-mesh link: a jump, a ladder, a door; the waypoint that
//   nav.unlink(id)                                             // lands on `to` carries .link (agents traverse it: docs/navigation.md)
//   createNavAgent(nav, { radius, speed, pos }).setGoal(p | field); agent.update(dt)
//   createNavCrowd(nav, { separation }).add(agent); crowd.update(dt)
//
// Nodes are (cell, layer): one per floor of the grid (ids packed: base[cell] + layer). Each carries a "fits" bit
// per agent radius, computed by the walker's own test (walker.js fits(): the disc of cells under the body, each
// supported within `step` of the feet with `head` of air above), at the floor's height and again at the height
// the walker's feet would settle to. The walker's disc offsets are whole cells, so a walker anywhere inside a
// cell samples exactly the cells it samples at the centre: a fit bit is the walker's answer for the whole cell,
// and a path that keeps to fit cells is a path the walker can walk (the agents below are walkers).
// Moving from a node into a neighbouring cell lands on that cell's highest floor within `step` above (what the
// walker's support search finds); down by at most `drop` (default: step, so no jumping off ledges). Diagonal
// moves need both side cells too (no corner cutting), in the searches and in line of sight alike.
// Path: A* over coarse nodes (blocks of coarse x coarse cells, split into the connected pieces of fit nodes in
// each, so floors stacked in a block stay apart), then cell A* inside that corridor (and its neighbours), then
// greedy string pulling with a cell walk (DDA) along each candidate segment that follows heights cell by cell.
// Searches reuse typed arrays and one binary heap: no allocation per query beyond the returned waypoints.
// Dynamic obstacles mark the nodes whose air they fill, then recompute fit bits and coarse pieces in the
// dilated region only; nav.grid is the walk grid with them in (walkers made on it collide with a closed door).
// ponytail: fit bits use the floor heights (and the feet-settled height), not the walker's exact y on stairs, so
// a stair edge can differ from the walker by one cell; flow fields are cell Dijkstra over the whole reachable
// floor (bound them with maxCost on big grids); separation is recast-like pushing, not RVO avoidance.
// ---------------------------------------------------------------------------
import { MAXL } from './walkgrid.js';
import { BODY, createWalker } from './walker.js';

const MAXC = 8;   // coarse pieces per block; more (fences cutting a block into slivers) share the last one
const SQ2 = Math.SQRT2;
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];   // 4 orthogonal, then 4 diagonal
const REV = [1, 0, 3, 2, 7, 6, 5, 4];                                       // the opposite direction
const HALF = [0, 2, 4, 5];
const octile = (a, b) => { a = Math.abs(a); b = Math.abs(b); return a + b + (SQ2 - 2) * Math.min(a, b); };

/** a binary min-heap of (id, key) over growable typed arrays; `key` holds the last popped key */
function makeHeap(cap = 4096) {
  let ids = new Int32Array(cap), keys = new Float64Array(cap);
  const h = { n: 0, key: 0 };
  h.push = (id, key) => {
    if (h.n === ids.length) { const a = new Int32Array(ids.length * 2), b = new Float64Array(ids.length * 2); a.set(ids); b.set(keys); ids = a; keys = b; }
    let i = h.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= key) break; ids[i] = ids[p]; keys[i] = keys[p]; i = p; }
    ids[i] = id; keys[i] = key;
  };
  h.pop = () => {
    const top = ids[0]; h.key = keys[0];
    const id = ids[--h.n], key = keys[h.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= h.n) break;
      if (c + 1 < h.n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= key) break;
      ids[i] = ids[c]; keys[i] = keys[c]; i = c;
    }
    ids[i] = id; keys[i] = key;
    return top;
  };
  return h;
}

export function createNavGrid(grid, opts = {}) {
  const t0 = performance.now();
  const { nx, nz, x0, z0, cell, floors, count } = grid, N = nx * nz;
  const step = opts.step ?? BODY.step, head = opts.head ?? BODY.head, drop = opts.drop ?? step;
  const C = Math.max(1, opts.coarse ?? 4) | 0;
  const bx = Math.ceil(nx / C), bz = Math.ceil(nz / C), NB = bx * bz;
  // nodes: one per floor, packed
  const base = new Int32Array(N + 1);
  for (let k = 0; k < N; k++) base[k + 1] = base[k] + count[k];
  const F = base[N];
  const cellOf = new Int32Array(F), fy = new floors.constructor(F), cy = new floors.constructor(F);
  for (let k = 0; k < N; k++) for (let l = 0; l < count[k]; l++) { const v = base[k] + l; cellOf[v] = k; fy[v] = floors[(k * MAXL + l) * 2]; cy[v] = floors[(k * MAXL + l) * 2 + 1]; }
  const blk = new Uint8Array(F);   // how many dynamic obstacles fill this node's air
  const area = new Uint8Array(F), areaCosts = new Float32Array(256).fill(1);   // area id per node, default cost per id
  let areas = 0;                   // setArea calls so far: 0 keeps every search on the uncosted path
  // off-mesh links as directed edges (a bidirectional link is two); hl: each edge's best cost to the goal of the
  // running query over straight lines and other links, so the A* estimate stays a lower bound when a link is a shortcut
  const E = [], linkFrom = new Map(), links = new Map(), via = new Int32Array(F);
  let hl = new Float64Array(8), linkId = 0;
  function prepLinks(ti, tj) {
    const L = E.length;
    if (hl.length < L) hl = new Float64Array(L * 2);
    for (let e = 0; e < L; e++) hl[e] = E[e].cost / cell + octile(E[e].vi - ti, E[e].vj - tj);
    for (let pass = 0, any = true; any && pass < L; pass++) {
      any = false;
      for (let e = 0; e < L; e++) for (let m = 0; m < L; m++) { const c = E[e].cost / cell + octile(E[e].vi - E[m].ui, E[e].vj - E[m].uj) + hl[m]; if (c < hl[e] - 1e-9) { hl[e] = c; any = true; } }
    }
  }
  /** cells to the goal cell (ti, tj) from cell (i, j): straight, or through the links, whichever is less */
  function hcells(i, j, ti, tj) {
    let d = octile(i - ti, j - tj);
    for (let e = 0; e < E.length; e++) { const c = octile(i - E[e].ui, j - E[e].uj) + hl[e]; if (c < d) d = c; }
    return d;
  }

  /** the highest floor of column k at most yTop (node id), or -1: the walker's support search */
  const layerAt = (k, yTop) => { for (let v = base[k + 1] - 1; v >= base[k]; v--) if (fy[v] <= yTop) return v; return -1; };
  const cellIdx = (x, z) => { const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell); return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i; };

  // the walk grid with the dynamic obstacles in: a closed door is a solid to walkers made on nav.grid
  const view = Object.create(grid);
  view.supportAt = (k, y, s, out) => { if (k < 0) return null; const v = layerAt(k, y + s); if (v < 0 || blk[v]) return null; if (!out) return [fy[v], cy[v]]; out[0] = fy[v]; out[1] = cy[v]; return out; };

  // ---- profiles: fit bits and coarse pieces per agent radius ----
  const profiles = new Map();
  /** walker.js fits() at the centre of cell (i, j) with feet at y: the ground under the feet, or NaN */
  function discFits(P, i, j, y) {
    const d = P.disc, top = y + step;
    for (let q = 0; q < d.length; q += 2) {
      const ii = i + d[q], jj = j + d[q + 1];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) return NaN;
      const v = layerAt(jj * nx + ii, top);
      if (v < 0 || blk[v] || cy[v] < Math.max(y, fy[v]) + head) return NaN;
    }
    let g = -Infinity;
    for (let q = 0; q < P.feet.length; q += 2) { const v = layerAt((j + P.feet[q + 1]) * nx + i + P.feet[q], top); if (fy[v] > g) g = fy[v]; }
    return g;
  }
  function bakeFits(P, i0, j0, i1, j1) {
    for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
      const k = j * nx + i;
      for (let v = base[k]; v < base[k + 1]; v++) {
        const f = fy[v];
        // the walker standing here stands on this floor (not one a sliver above it), fits, and still fits where its
        // feet settle (the highest floor under the feet disc, a riser up on stairs)
        let ok = cy[v] - f >= head && layerAt(k, f + step) === v;
        if (ok) { const g = discFits(P, i, j, f); ok = g === g && (g <= f || !Number.isNaN(discFits(P, i, j, g))); }
        P.fit[v] = ok ? 1 : 0;
      }
    }
  }
  /** the node a move from height f into cell k lands on, if it fits there and is not a drop: else -1 */
  const edge = (fit, f, k) => { const v = layerAt(k, f + step); return v >= 0 && fit[v] && fy[v] >= f - drop ? v : -1; };
  /** the node of a move from node u (cell i, j) by direction d, with the side cells for diagonals: else -1 */
  function move(fit, u, i, j, d) {
    const i2 = i + DI[d], j2 = j + DJ[d];
    if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= nz) return -1;
    const f = fy[u];
    if (d >= 4 && (edge(fit, f, j * nx + i2) < 0 || edge(fit, f, j2 * nx + i) < 0)) return -1;
    return edge(fit, f, j2 * nx + i2);
  }
  const blockOf = (k) => { const i = k % nx, j = (k - i) / nx; return ((j / C) | 0) * bx + ((i / C) | 0); };
  const coarseOf = (P, v) => blockOf(cellOf[v]) * MAXC + P.clu[v];

  // the connected pieces of fit nodes inside block b (a move either way joins two nodes: union-find over the
  // block's node slots), each a coarse node with a representative near the block centre
  const uf = new Int32Array(C * C * MAXL), ufLabel = new Int8Array(C * C * MAXL), ufBest = new Float64Array(MAXC);
  const find = (q) => { while (uf[q] !== q) q = uf[q] = uf[uf[q]]; return q; };
  function clusterBlock(P, b) {
    const bi = b % bx, bj = (b - bi) / bx, i0 = bi * C, j0 = bj * C, i1 = Math.min(nx, i0 + C), j1 = Math.min(nz, j0 + C);
    const { fit, clu, rep } = P;
    const slot = (v) => { const k = cellOf[v], i = k % nx; return ((((k - i) / nx - j0) * C + i - i0) * MAXL) + v - base[k]; };
    for (let q = 0; q < uf.length; q++) { uf[q] = q; ufLabel[q] = -1; }
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const k = j * nx + i;
      for (let u = base[k]; u < base[k + 1]; u++) {
        clu[u] = 255;
        if (!fit[u]) continue;
        // half the directions (+x, +z and the two diagonals east); the way back only where the way there fails
        for (const d of HALF) {
          const i2 = i + DI[d], j2 = j + DJ[d];
          if (i2 < i0 || j2 < j0 || i2 >= i1 || j2 >= j1) continue;
          let v = move(fit, u, i, j, d);
          if (v < 0) { const k2 = j2 * nx + i2; for (let w = base[k2]; w < base[k2 + 1] && v < 0; w++) if (fit[w] && move(fit, w, i2, j2, REV[d]) === u) v = w; }
          if (v >= 0) { const ra = find(slot(u)), rb = find(slot(v)); if (ra !== rb) uf[ra] = rb; }
        }
      }
    }
    for (let c = 0; c < MAXC; c++) { rep[b * MAXC + c] = -1; ufBest[c] = Infinity; }
    let c = 0;
    const ci = (i0 + i1 - 1) / 2, cj = (j0 + j1 - 1) / 2;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const k = j * nx + i;
      for (let u = base[k]; u < base[k + 1]; u++) {
        if (!fit[u]) continue;
        const r = find(slot(u));
        if (ufLabel[r] < 0) ufLabel[r] = Math.min(c++, MAXC - 1);
        const label = (clu[u] = ufLabel[r]), dd = octile(i - ci, j - cj);
        if (dd < ufBest[label]) { ufBest[label] = dd; rep[b * MAXC + label] = u; P.ri[b * MAXC + label] = i; P.rj[b * MAXC + label] = j; }
      }
    }
  }
  /** fit bits per radius, baked on first use and cached */
  function profile(radius = BODY.radius) {
    const key = Math.round(radius * 1000);
    let P = profiles.get(key);
    if (P) return P;
    const t = performance.now();
    // the walker's disc and feet, built the way walker.js builds them
    const disc = [], feet = [], n = Math.ceil(radius / cell) + 1;
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const d = Math.hypot(i, j) * cell;
      if (d <= radius) disc.push(i, j);
      if (d <= radius * 0.55) feet.push(i, j);
    }
    P = { radius, disc: Int32Array.from(disc), feet: Int32Array.from(feet), fit: new Uint8Array(F), clu: new Uint8Array(F).fill(255), rep: new Int32Array(NB * MAXC).fill(-1),
      adjAt: new Int32Array(C > 1 ? NB * MAXC : 0).fill(-1), ri: new Int32Array(C > 1 ? NB * MAXC : 0), rj: new Int32Array(C > 1 ? NB * MAXC : 0), adjN: new Uint8Array(C > 1 ? NB * MAXC : 0), pool: new Int32Array(1024), poolN: 0 };
    bakeFits(P, 0, 0, nx - 1, nz - 1);
    if (C > 1) for (let b = 0; b < NB; b++) clusterBlock(P, b);
    P.ms = +(performance.now() - t).toFixed(1);
    profiles.set(key, P);
    return P;
  }

  // ---- shared search state (one query at a time; nothing allocated per query) ----
  const heap = makeHeap();
  const g = new Float64Array(F), parent = new Int32Array(F), seen = new Uint32Array(F), closed = new Uint32Array(F);
  const NC = C > 1 ? NB * MAXC : 0;
  const cg = new Float64Array(NC), cparent = new Int32Array(NC), cseen = new Uint32Array(NC), cclosed = new Uint32Array(NC), corridor = new Uint32Array(NC);
  let stamp = 0, cstamp = 0;
  const nb = new Int32Array(MAXC * 8 + 8);
  let pbuf = new Int32Array(4096);
  const stats = {};

  /** coarse neighbours of coarse node id: P.pool[start .. start + P.adjN[id]), found once and cached per profile
   *  (an edit forgets the blocks around it) */
  function adj(P, id) {
    if (P.adjAt[id] >= 0) return P.adjAt[id];
    const b = (id / MAXC) | 0, c = id % MAXC, bi = b % bx, bj = (b - bi) / bx;
    const i0 = bi * C, j0 = bj * C, i1 = Math.min(nx, i0 + C) - 1, j1 = Math.min(nz, j0 + C) - 1;
    let m = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i !== i0 && i !== i1 && j !== j0 && j !== j1) { i = i1 - 1; continue; }   // border cells only
      const k = j * nx + i;
      for (let u = base[k]; u < base[k + 1]; u++) {
        if (P.clu[u] !== c) continue;
        for (let d = 0; d < 8; d++) {
          const i2 = i + DI[d], j2 = j + DJ[d];
          if (i2 >= i0 && i2 <= i1 && j2 >= j0 && j2 <= j1) continue;
          const v = move(P.fit, u, i, j, d);
          if (v < 0) continue;
          const o = coarseOf(P, v);
          let q = 0;
          while (q < m && nb[q] !== o) q++;
          if (q === m && m < nb.length) nb[m++] = o;
        }
      }
    }
    if (P.poolN + m > P.pool.length) { const p2 = new Int32Array(Math.max(P.pool.length * 2, P.poolN + m)); p2.set(P.pool); P.pool = p2; }
    P.pool.set(nb.subarray(0, m), P.poolN);
    P.adjN[id] = m;
    P.adjAt[id] = P.poolN; P.poolN += m;
    return P.adjAt[id];
  }
  const repDist = (P, a, b) => octile(P.ri[a] - P.ri[b], P.rj[a] - P.rj[b]) * cell;
  /** A* over coarse nodes; marks the path and its neighbours as the corridor; false if unreachable */
  function coarseSearch(P, s, t, maxNodes) {
    const q = ++cstamp, L = E.length, ti = P.ri[t], tj = P.rj[t];
    const hc = L ? (v) => hcells(P.ri[v], P.rj[v], ti, tj) * cell : (v) => repDist(P, v, t);
    heap.n = 0; cg[s] = 0; cseen[s] = q; cparent[s] = -1; heap.push(s, hc(s));
    let n = 0, found = false;
    while (heap.n) {
      const u = heap.pop();
      if (cclosed[u] === q) continue;
      cclosed[u] = q;
      if (u === t) { found = true; break; }
      if (++n > maxNodes) break;
      const a0 = adj(P, u), a1 = a0 + P.adjN[u], pool = P.pool;
      for (let e = a0; e < a1; e++) {
        const v = pool[e];
        if (cclosed[v] === q) continue;
        const ng = cg[u] + repDist(P, u, v);
        if (cseen[v] !== q || ng < cg[v]) { cseen[v] = q; cg[v] = ng; cparent[v] = u; heap.push(v, ng + hc(v) * 1.001); }
      }
      for (let e = 0; e < L; e++) {
        const l = E[e];
        if (!P.fit[l.u] || !P.fit[l.v] || coarseOf(P, l.u) !== u) continue;
        const v = coarseOf(P, l.v), ng = cg[u] + l.cost;
        if (cclosed[v] !== q && (cseen[v] !== q || ng < cg[v])) { cseen[v] = q; cg[v] = ng; cparent[v] = u; heap.push(v, ng + hc(v) * 1.001); }
      }
    }
    stats.coarseExpanded = n;
    if (!found) return false;
    for (let u = t; u >= 0; u = cparent[u]) {
      corridor[u] = q;
      const a0 = adj(P, u);
      for (let e = a0; e < a0 + P.adjN[u]; e++) corridor[P.pool[e]] = q;
    }
    return true;
  }
  /** A* over cell nodes, inside the corridor if `inCorridor`; false if unreachable */
  function cellSearch(P, s, t, inCorridor, maxNodes, ac, use) {
    const q = ++stamp, fit = P.fit, kt = cellOf[t], ti = kt % nx, tj = (kt - ti) / nx, L = E.length;
    const h = L ? (k) => { const i = k % nx; return hcells(i, (k - i) / nx, ti, tj) * cell * 1.001; } : (k) => { const i = k % nx; return octile(i - ti, (k - i) / nx - tj) * cell * 1.001; };
    heap.n = 0; g[s] = 0; seen[s] = q; parent[s] = -1; via[s] = 0; heap.push(s, h(cellOf[s]));
    let n = 0;
    while (heap.n) {
      const u = heap.pop();
      if (closed[u] === q) continue;
      closed[u] = q;
      if (u === t) { stats.cellExpanded = n; return true; }
      if (++n > maxNodes) break;
      const k = cellOf[u], i = k % nx, j = (k - i) / nx;
      for (let d = 0; d < 8; d++) {
        const v = move(fit, u, i, j, d);
        if (v < 0 || closed[v] === q || (inCorridor && corridor[coarseOf(P, v)] !== cstamp)) continue;
        let w = d < 4 ? cell : cell * SQ2;
        if (ac) { const c = ac[area[v]]; if (!(c < Infinity)) continue; w *= c; }
        const ng = g[u] + w;
        if (seen[v] !== q || ng < g[v]) { seen[v] = q; g[v] = ng; parent[v] = u; via[v] = 0; heap.push(v, ng + h(cellOf[v])); }
      }
      const le = L ? linkFrom.get(u) : null;
      if (le) for (const l of le) {
        const v = l.v;
        if (!fit[v] || closed[v] === q || (use && !use(l.link)) || (ac && !(ac[area[v]] < Infinity))) continue;
        const ng = g[u] + l.cost;
        if (seen[v] !== q || ng < g[v]) { seen[v] = q; g[v] = ng; parent[v] = u; via[v] = l.idx + 1; heap.push(v, ng + h(cellOf[v])); }
      }
    }
    stats.cellExpanded = n;
    return false;
  }

  /** cell walk from (ax, az) on node ua to (bx, bz): every cell crossed fits, each move a valid step, ends on ub */
  function los(fit, ax, az, ua, bX, bZ, ub, ac) {
    const c0 = ac ? ac[area[ua]] : 0;   // with area costs a straight line may not leave the cost it starts in
    let i = Math.floor((ax - x0) / cell), j = Math.floor((az - z0) / cell);
    const ie = Math.floor((bX - x0) / cell), je = Math.floor((bZ - z0) / cell);
    const dx = bX - ax, dz = bZ - az, si = Math.sign(dx), sj = Math.sign(dz);
    const tdx = si ? cell / Math.abs(dx) : Infinity, tdz = sj ? cell / Math.abs(dz) : Infinity;
    let tx = si ? (si > 0 ? x0 + (i + 1) * cell - ax : ax - (x0 + i * cell)) / Math.abs(dx) : Infinity;
    let tz = sj ? (sj > 0 ? z0 + (j + 1) * cell - az : az - (z0 + j * cell)) / Math.abs(dz) : Infinity;
    let u = ua;
    for (let guard = Math.abs(ie - i) + Math.abs(je - j); (i !== ie || j !== je) && guard >= 0; guard--) {
      let d;
      if (Math.abs(tx - tz) < 1e-9) { d = si > 0 ? (sj > 0 ? 4 : 5) : (sj > 0 ? 6 : 7); tx += tdx; tz += tdz; }   // through a corner
      else if (tx < tz) { d = si > 0 ? 0 : 1; tx += tdx; }
      else { d = sj > 0 ? 2 : 3; tz += tdz; }
      u = move(fit, u, i, j, d);
      if (u < 0 || (ac && ac[area[u]] !== c0)) return false;
      i += DI[d]; j += DJ[d];
    }
    return i === ie && j === je && u === ub;
  }

  /** the fit node for a body with feet near (x, y, z): its own cell, else the nearest within `snap` m on that floor */
  function nodeNear(P, p, snap = 1) {
    const [x, y, z] = p, k = cellIdx(x, z);
    if (k >= 0) { const v = layerAt(k, y + step); if (v >= 0 && P.fit[v]) return v; }
    const i0 = Math.floor((x - x0) / cell), j0 = Math.floor((z - z0) / cell), R = Math.ceil(snap / cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= R && best < 0; r++) {
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if ((Math.abs(i - i0) !== r && Math.abs(j - j0) !== r) || i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const k2 = j * nx + i;
        for (let v = base[k2]; v < base[k2 + 1]; v++) {
          if (!P.fit[v] || Math.abs(fy[v] - y) > step + 0.6) continue;
          const dd = Math.hypot(x0 + (i + 0.5) * cell - x, z0 + (j + 0.5) * cell - z);
          if (dd < bd && dd <= snap) { bd = dd; best = v; }
        }
      }
    }
    return best;
  }
  const cx = (v) => x0 + ((cellOf[v] % nx) + 0.5) * cell, cz = (v) => z0 + (((cellOf[v] / nx) | 0) + 0.5) * cell;

  const nav = {
    grid: view, base: grid, step, head, drop, coarse: C, nodes: F, version: 0, stats,
    profile, layerAt, cellIdx,
    /** the node under a body with feet at (x, y, z) (-1 off the grid / no floor) */
    nodeAt(x, y, z) { const k = cellIdx(x, z); return k < 0 ? -1 : layerAt(k, y + step); },
    /** a body of `radius` with feet at (x, y, z) fits there (the walker's test, with the dynamic obstacles) */
    fits(x, y, z, radius) { const v = nav.nodeAt(x, y, z); return v >= 0 && profile(radius).fit[v] === 1; },
    /** the floor height of node v */
    floorOf: (v) => fy[v],
    /** nearest fit spot to p on its floor within `snap` m: [x, y, z] (a cell centre unless p fits), or null */
    nearest(p, { radius, snap = 1 } = {}) {
      const P = profile(radius), v = nodeNear(P, p, snap);
      if (v < 0) return null;
      return cellOf[v] === cellIdx(p[0], p[2]) ? [p[0], fy[v], p[2]] : [cx(v), fy[v], cz(v)];
    },
    /** a body walking straight from a to b (feet positions) stays on fit cells all the way, on the floor of b */
    visible(a, b, { radius } = {}) {
      const P = profile(radius), ua = nav.nodeAt(a[0], a[1], a[2]), ub = nav.nodeAt(b[0], b[1], b[2]);
      return ua >= 0 && ub >= 0 && P.fit[ua] === 1 && los(P.fit, a[0], a[2], ua, b[0], b[2], ub);
    },
    /** waypoints [[x, y, z], ...] (feet, floor heights) from `from` to `to`, or null; stats in nav.stats */
    findPath(from, to, { radius, snap = 1, maxNodes = 1e7, costs, canUse } = {}) {
      const t1 = performance.now(), P = profile(radius), fit = P.fit;
      // area costs: the defaults, or this query's on top ({ id: cost } or a Float32Array(256)); null while no area is set
      let ac = null;
      if (areas) { ac = areaCosts; if (costs) { ac = costs.length === 256 ? costs : areaCosts.slice(); if (ac !== costs) for (const id in costs) ac[id] = costs[id]; } }
      stats.coarseExpanded = 0; stats.cellExpanded = 0; stats.corridor = false;
      const s = nodeNear(P, from, snap), t = nodeNear(P, to, snap);
      const done = (r) => { stats.ms = +(performance.now() - t1).toFixed(3); stats.found = !!r; return r; };
      if (s < 0 || t < 0) return done(null);
      // coarse first; the cell search keeps to the corridor, and searches the whole grid only if that fails
      let ok = false;
      if (E.length) { const kt = cellOf[t]; prepLinks(kt % nx, (kt / nx) | 0); }
      // (with area costs the coarse corridor could hide the cheaper way round: the cell search runs unbounded)
      if (C > 1 && !ac) {
        if (!coarseSearch(P, coarseOf(P, s), coarseOf(P, t), maxNodes)) return done(null);
        ok = stats.corridor = cellSearch(P, s, t, true, maxNodes, null, canUse);
      }
      if (!ok && !cellSearch(P, s, t, false, maxNodes, ac, canUse)) return done(null);
      stats.cost = +g[t].toFixed(3);
      stats.searchMs = +(performance.now() - t1).toFixed(3);
      // the cell path (in a reused buffer); positions: the exact ends, cell centres between
      let n = 0;
      for (let v = t; v >= 0; v = parent[v]) { if (n === pbuf.length) { const nb2 = new Int32Array(n * 2); nb2.set(pbuf); pbuf = nb2; } pbuf[n++] = v; }
      const sx = cellIdx(from[0], from[2]) === cellOf[s] ? from[0] : cx(s), sz = cellIdx(from[0], from[2]) === cellOf[s] ? from[2] : cz(s);
      const ex = cellIdx(to[0], to[2]) === cellOf[t] ? to[0] : cx(t), ez = cellIdx(to[0], to[2]) === cellOf[t] ? to[2] : cz(t);
      const last = n + 1;
      const node = (q) => (q === 0 ? s : q === last ? t : pbuf[n - q]);
      // link crossings: path index q whose node was reached over a link (its two ends keep the link's own points,
      // and no straight line is pulled across one)
      let cuts = null;
      if (E.length) for (let q = 2; q <= n; q++) { const e = via[pbuf[n - q]]; if (e) { (cuts ??= new Map()).set(q, E[e - 1]); } }
      const X = (q) => (q === 0 ? sx : q === last ? ex : cuts && cuts.has(q) ? cuts.get(q).tx : cuts && cuts.has(q + 1) ? cuts.get(q + 1).fx : cx(node(q)));
      const Z = (q) => (q === 0 ? sz : q === last ? ez : cuts && cuts.has(q) ? cuts.get(q).tz : cuts && cuts.has(q + 1) ? cuts.get(q + 1).fz : cz(node(q)));
      const cut = (a, b) => { if (cuts) for (const c of cuts.keys()) if (c > a && c <= b) return true; return false; };
      const vis = (a, b) => !cut(a, b) && los(fit, X(a), Z(a), node(a), X(b), Z(b), node(b), ac);
      // string pulling: from each corner the farthest path point in sight (gallop, then bisect; neighbours on the
      // path are always in sight), then drop any corner its neighbours see past
      const idx = [0];
      for (let a = 0; a < last;) {
        let good = a + 1, bad = last + 1;
        if (cuts && cuts.has(a + 1)) { idx.push(a + 1); a++; continue; }   // over the link: its far end is the next point
        for (let jump = 1; good < last; jump *= 2) { const b = Math.min(last, good + jump); if (vis(a, b)) good = b; else { bad = b; break; } }
        while (bad - good > 1) { const m = (good + bad) >> 1; if (vis(a, m)) good = m; else bad = m; }
        idx.push(good); a = good;
      }
      for (let q = idx.length - 2; q > 0; q--) if (vis(idx[q - 1], idx[q + 1])) idx.splice(q, 1);
      const out = idx.map((q) => { const w = [X(q), fy[node(q)], Z(q)]; if (cuts && cuts.has(q)) w.link = cuts.get(q).view; return w; });
      // drop a repeated point (an end exactly on a cell centre)
      for (let q = out.length - 1; q > 0; q--) if (out[q][0] === out[q - 1][0] && out[q][2] === out[q - 1][2] && out.length > 2 && !out[q].link) { if (out[q - 1].link) out[q].link = out[q - 1].link; out.splice(q - 1, 1); }
      let len = 0;
      for (let q = 1; q < out.length; q++) len += Math.hypot(out[q][0] - out[q - 1][0], out[q][1] - out[q - 1][1], out[q][2] - out[q - 1][2]);
      stats.length = +len.toFixed(3);
      return done(out);
    },
    /** one integration field toward `goal` for every agent of `radius`: distance per node, steering per position */
    flowField(goal, { radius, maxCost = Infinity, snap = 1 } = {}) {
      const t1 = performance.now(), P = profile(radius), fit = P.fit, t = nodeNear(P, goal, snap);
      const dist = new Float32Array(F).fill(Infinity);
      const field = { goal: goal.slice(), radius: P.radius, dist, version: nav.version, reached: 0, ms: 0 };
      if (t >= 0) {
        dist[t] = 0; heap.n = 0; heap.push(t, 0);
        let n = 0;
        while (heap.n) {
          const u = heap.pop();
          if (heap.key > dist[u]) continue;
          n++;
          const k = cellOf[u], i = k % nx, j = (k - i) / nx;
          // predecessors: nodes w next door whose move toward u lands on u
          for (let d = 0; d < 8; d++) {
            const i2 = i + DI[d], j2 = j + DJ[d];
            if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= nz) continue;
            const k2 = j2 * nx + i2, nd = Math.fround(dist[u] + (d < 4 ? cell : cell * SQ2));
            if (nd > maxCost) continue;
            for (let w = base[k2]; w < base[k2 + 1]; w++) if (fit[w] && nd < dist[w] && move(fit, w, i2, j2, REV[d]) === u) { dist[w] = nd; heap.push(w, nd); }
          }
        }
        field.reached = n;
      }
      // steering: the lowest-distance node in sight within 6 cells (else 3, else the best neighbour), cached per node
      let aim = null;
      const target = (u) => {
        aim ??= new Int32Array(F).fill(-1);
        if (aim[u] !== -1) return aim[u];
        const k = cellOf[u], i = k % nx, j = (k - i) / nx;
        let res = -2;
        for (const R of [6, 3]) {
          let best = -1, bd = dist[u];
          for (let jj = Math.max(0, j - R); jj <= Math.min(nz - 1, j + R); jj++) for (let ii = Math.max(0, i - R); ii <= Math.min(nx - 1, i + R); ii++) {
            const k2 = jj * nx + ii;
            for (let w = base[k2]; w < base[k2 + 1]; w++) if (dist[w] < bd && Math.abs(fy[w] - fy[u]) <= step + R * cell) { bd = dist[w]; best = w; }
          }
          if (best >= 0 && los(fit, cx(u), cz(u), u, cx(best), cz(best), best)) { res = best; break; }
        }
        if (res === -2) {
          let bd = dist[u];
          for (let d = 0; d < 8; d++) { const v = move(fit, u, i, j, d); if (v >= 0 && dist[v] < bd) { bd = dist[v]; res = v; } }
        }
        return (aim[u] = res);
      };
      field.nodeAt = (x, y, z) => nav.nodeAt(x, y, z);
      /** metres to the goal along the field from a body at (x, y, z) (Infinity: not reached) */
      field.distance = (x, y, z) => { const u = nav.nodeAt(x, y, z); return u >= 0 ? dist[u] : Infinity; };
      /** the unit direction [dx, dz] to walk from (x, y, z), [0, 0] at the goal, or null off the field */
      field.direction = (x, y, z) => {
        let u = nav.nodeAt(x, y, z);
        if (u >= 0 && dist[u] === Infinity) {
          // on a cell the field does not cover (a stair edge the walker stands on): toward the best one next door
          const k = cellOf[u], i = k % nx, j = (k - i) / nx;
          let bd = Infinity, best = -1;
          for (let d = 0; d < 8; d++) {
            const i2 = i + DI[d], j2 = j + DJ[d];
            if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= nz) continue;
            const w = layerAt(j2 * nx + i2, y + step);
            if (w >= 0 && dist[w] < bd) { bd = dist[w]; best = w; }
          }
          if (best < 0) return null;
          const dx = cx(best) - x, dz = cz(best) - z, l = Math.hypot(dx, dz);
          return l > 1e-6 ? [dx / l, dz / l] : [0, 0];
        }
        if (u < 0) return null;
        let tx = field.goal[0], tz = field.goal[2], w = t;
        if (u !== t) { w = target(u); if (w < 0) return null; if (w !== t) { tx = cx(w); tz = cz(w); } }
        // the aim was chosen from the cell centre: from off-centre the line is checked again, else the best cell
        // next door, else the centre of this one (always reachable)
        if (!los(fit, x, z, u, tx, tz, w)) {
          const k = cellOf[u], i = k % nx, j = (k - i) / nx;
          let bd = dist[u], best = -1;
          for (let d = 0; d < 8; d++) { const v = move(fit, u, i, j, d); if (v >= 0 && dist[v] < bd) { bd = dist[v]; best = v; } }
          if (best >= 0 && los(fit, x, z, u, cx(best), cz(best), best)) { tx = cx(best); tz = cz(best); } else { tx = cx(u); tz = cz(u); }
        }
        const dx = tx - x, dz = tz - z, l = Math.hypot(dx, dz);
        return l > 1e-6 ? [dx / l, dz / l] : [0, 0];
      };
      field.stale = () => field.version !== nav.version;
      // the same goal after block / unblock: rebuilt once and shared by every agent that steers by this field
      field.refreshed = () => (field.stale() ? (field.next && !field.next.stale() ? field.next : (field.next = nav.flowField(field.goal, { radius: field.radius, maxCost, snap }))) : field);
      field.ms = +(performance.now() - t1).toFixed(2);
      return field;
    },
    /** a dynamic obstacle (box [x0, y0, z0, x1, y1, z1] or cylinder [x, z, r, y0, y1]): paths and nav.grid avoid it */
    block(shape) { const o = { ...shape, box: shape.box && [...shape.box], cylinder: shape.cylinder && [...shape.cylinder], obb: shape.obb && [...shape.obb], id: ++obstacleId, nodes: [] }; edit(o, 1); obstacles.set(o.id, o); return o.id; },
    /** remove an obstacle made by block() */
    unblock(id) { const o = obstacles.get(id); if (!o) return false; obstacles.delete(id); edit(o, -1); return true; },
    obstacles: () => [...obstacles.values()],
    /** mark the nodes inside a shape (block()'s shapes) as area `id` (0..255, 0: plain ground); returns how many */
    setArea(shape, id) {
      const { inside, lo, hi, i0, i1, j0, j1 } = bounds(shape);
      let n = 0;
      for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
        if (!inside(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell)) continue;
        for (let v = base[j * nx + i]; v < base[j * nx + i + 1]; v++) if (lo < cy[v] && hi >= fy[v]) { area[v] = id; n++; }
      }
      areas++; nav.version++;
      return n;
    },
    /** what a metre in area `id` costs every query that does not say otherwise (1: plain; Infinity: closed; keep >= 1) */
    setAreaCost(id, cost) { areaCosts[id] = cost; nav.version++; },
    areaCosts,
    /** the area id under a body with feet at (x, y, z) (0 off the grid) */
    areaAt(x, y, z) { const v = nav.nodeAt(x, y, z); return v < 0 ? 0 : area[v]; },
    areaOf: (v) => area[v],
    /** an off-mesh link between two floor points: { from, to, cost (metres-worth, default the distance), bidirectional,
     *  type ('jump' | 'ladder' | 'door' | yours), ...your fields (time, height, canEnter, traverse) } -> the link
     *  (null when an end is not on walkable floor within `snap`) */
    link(def) {
      const P = profile(def.radius), a = nodeNear(P, def.from, def.snap ?? 1), b = nodeNear(P, def.to, def.snap ?? 1);
      if (a < 0 || b < 0) return null;
      const at = (p, v) => (cellIdx(p[0], p[2]) === cellOf[v] ? [p[0], fy[v], p[2]] : [cx(v), fy[v], cz(v)]);
      const l = { type: 'jump', bidirectional: false, ...def, id: ++linkId, from: at(def.from, a), to: at(def.to, b), a, b };
      l.cost = def.cost ?? Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1], l.to[2] - l.from[2]);
      links.set(l.id, l); relink();
      return l;
    },
    unlink(l) { const ok = links.delete(l?.id ?? l); if (ok) relink(); return ok; },
    links: () => [...links.values()],
    /** nodes of the grid cell by cell, for debug views: fn(x, y, z, node, fits, area, blocked) */
    eachNode(fn, { radius } = {}) { const fit = profile(radius).fit; for (let v = 0; v < F; v++) fn(cx(v), fy[v], cz(v), v, fit[v] === 1, area[v], blk[v] > 0); },
  };
  function relink() {
    E.length = 0; linkFrom.clear();
    const ij = (v) => { const k = cellOf[v], i = k % nx; return [i, (k - i) / nx]; };
    for (const l of links.values()) for (const back of l.bidirectional ? [false, true] : [false]) {
      const u = back ? l.b : l.a, v = back ? l.a : l.b, f = back ? l.to : l.from, t = back ? l.from : l.to, [ui, uj] = ij(u), [vi, vj] = ij(v);
      // what a waypoint carries: the link as walked (from / to in the direction of travel)
      const view = back ? Object.assign(Object.create(l), { from: f.slice(), to: t.slice(), reverse: true, link: l }) : Object.assign(Object.create(l), { reverse: false, link: l });
      const e = { u, v, ui, uj, vi, vj, cost: l.cost, link: l, idx: E.length, fx: f[0], fz: f[2], tx: t[0], tz: t[2], view };
      E.push(e);
      if (!linkFrom.has(u)) linkFrom.set(u, []);
      linkFrom.get(u).push(e);
    }
    nav.version++;
  }
  /** a block / area shape as a cell range, a y range and an inside test over cell centres */
  function bounds(o) {
    let inside, lo, hi, X0, X1, Z0, Z1;
    if (o.box) { const b = o.box; [X0, lo, Z0, X1, hi, Z1] = [Math.min(b[0], b[3]), Math.min(b[1], b[4]), Math.min(b[2], b[5]), Math.max(b[0], b[3]), Math.max(b[1], b[4]), Math.max(b[2], b[5])]; inside = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1; }
    else if (o.cylinder) { const [x, z, r, y0, y1] = o.cylinder; [X0, X1, Z0, Z1, lo, hi] = [x - r, x + r, z - r, z + r, y0, y1]; inside = (px, pz) => (px - x) ** 2 + (pz - z) ** 2 <= r * r; }
    else if (o.obb) {
      // a box turned about y: local x = (cos, -sin), local z = (sin, cos) of the offset (three's rotation.y)
      const [x, z, hx, hz, yaw, y0, y1] = o.obb, c = Math.cos(yaw), sn = Math.sin(yaw), ex = Math.abs(c) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(c) * hz;
      [X0, X1, Z0, Z1, lo, hi] = [x - ex, x + ex, z - ez, z + ez, y0, y1];
      inside = (px, pz) => { const dx = px - x, dz = pz - z; return Math.abs(dx * c - dz * sn) <= hx && Math.abs(dx * sn + dz * c) <= hz; };
    }
    else throw new Error('nav.block: give { box: [x0, y0, z0, x1, y1, z1] }, { cylinder: [x, z, r, y0, y1] } or { obb: [cx, cz, hx, hz, yaw, y0, y1] }');
    return { inside, lo, hi, X0, X1, Z0, Z1, i0: Math.floor((X0 - x0) / cell), i1: Math.floor((X1 - x0) / cell), j0: Math.floor((Z0 - z0) / cell), j1: Math.floor((Z1 - z0) / cell) };
  }

  const obstacles = new Map();
  let obstacleId = 0;
  function edit(o, sign) {
    const t1 = performance.now();
    const { inside, lo, hi, X0, X1, Z0, Z1, i0, i1, j0, j1 } = bounds(o);
    // a node is filled when the cell centre is inside and the obstacle reaches into its air (floor .. ceiling);
    // a thin obstacle that misses every centre still fills the cell nearest its centre
    let any = false;
    for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
      if (!inside(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell)) continue;
      const k = j * nx + i;
      for (let v = base[k]; v < base[k + 1]; v++) if (lo < cy[v] && hi > fy[v]) { if (sign > 0) { blk[v]++; o.nodes.push(v); } any = true; }
    }
    if (!any && sign > 0) { const k = cellIdx((X0 + X1) / 2, (Z0 + Z1) / 2); if (k >= 0) for (let v = base[k]; v < base[k + 1]; v++) if (lo < cy[v] && hi > fy[v]) { blk[v]++; o.nodes.push(v); } }
    // removing: exactly the nodes this obstacle filled (the shape arrays are our own copies, but a count never wraps)
    if (sign < 0) for (const v of o.nodes) if (blk[v] > 0) blk[v]--;
    // fit bits and coarse pieces around it, per cached radius
    for (const P of profiles.values()) {
      const r = Math.ceil(P.radius / cell) + 2;
      bakeFits(P, i0 - r, j0 - r, i1 + r, j1 + r);
      if (C > 1) {
        const b0 = Math.max(0, ((i0 - r) / C) | 0), b1 = Math.min(bx - 1, Math.floor((i1 + r) / C)), c0 = Math.max(0, ((j0 - r) / C) | 0), c1 = Math.min(bz - 1, Math.floor((j1 + r) / C));
        for (let bj = c0; bj <= c1; bj++) for (let bi = b0; bi <= b1; bi++) clusterBlock(P, bj * bx + bi);
        // neighbour lists of these blocks and the ring around them are found again (start over when the pool is
        // mostly stale)
        if (P.poolN > 4 * NB * 8) { P.adjAt.fill(-1); P.poolN = 0; }
        else for (let bj = Math.max(0, c0 - 1); bj <= Math.min(bz - 1, c1 + 1); bj++) for (let bi = Math.max(0, b0 - 1); bi <= Math.min(bx - 1, b1 + 1); bi++) P.adjAt.fill(-1, (bj * bx + bi) * MAXC, (bj * bx + bi + 1) * MAXC);
      }
    }
    nav.version++;
    stats.editMs = +(performance.now() - t1).toFixed(2);
  }

  profile(opts.radius ?? BODY.radius);
  nav.ms = +(performance.now() - t0).toFixed(1);
  return nav;
}

// ---------------------------------------------------------------------------
// An NPC: a walker (the player's collision, steps and ground following, with its own radius) steered along
// waypoints or a flow field. Re-plans when the nav changes (block / unblock) or when stuck.
// ---------------------------------------------------------------------------
export function createNavAgent(nav, opts = {}) {
  const radius = opts.radius ?? BODY.radius, speed = opts.speed ?? BODY.walk, arrive = opts.arrive ?? 0.15;
  const walker = createWalker(nav.grid, { pos: opts.pos || [0, 0, 0], body: { radius, walk: speed, run: speed, step: nav.step, head: nav.head } });
  nav.profile(radius);
  let goal = null, field = null, ver = nav.version, stuck = 0, retry = 0, last = [0, 0, 0];
  const a = { walker, pos: walker.pos, radius, speed, path: null, index: 0, arrived: false, moving: false, blocked: false, separation: opts.separation ?? 1, push: [0, 0], heading: [0, 1] };
  function repath() {
    if (a.link) return;   // mid-link: the plan waits for the landing
    a.path = nav.findPath(walker.pos, goal, { radius, snap: opts.snap ?? 1.5, costs: opts.costs, canUse: opts.canUse });
    a.index = 1; ver = nav.version; stuck = 0;
  }
  /** a point [x, y, z] (feet) or a flow field; false if there is no way there */
  a.setGoal = (target) => {
    a.arrived = false;
    if (target && target.direction) { field = target; goal = null; a.path = null; return field.distance(...walker.pos) < Infinity; }
    field = null; goal = target ? target.slice() : null;
    if (!goal) { a.path = null; return false; }
    repath();
    return !!a.path;
  };
  a.stop = () => { goal = null; field = null; a.path = null; a.link = null; };
  /** one step: dt seconds; push: a [x, z] steering push added to the way (the crowd's separation) */
  a.update = (dt, push = a.push) => {
    const [x, y, z] = walker.pos;
    let dx = 0, dz = 0, slow = 1;
    if (goal && !a.arrived) {
      retry += dt;
      if (nav.version !== ver || (!a.path && retry > 1)) { repath(); retry = 0; }
      const p = a.path;
      if (p) {
        // on to the next waypoint once at this one, or as soon as the next is in a straight walk from here (only
        // lines checked by nav.visible are walked: the walker steps onto each cell where the bits were baked)
        while (a.index < p.length - 1 && !p[a.index].link && (Math.hypot(p[a.index][0] - x, p[a.index][2] - z) < 1e-3 || (!p[a.index + 1].link && nav.visible(walker.pos, p[a.index + 1], { radius })))) a.index++;
        const w = p[a.index], d = Math.hypot(w[0] - x, w[2] - z);
        if (w.link) {
          // an off-mesh link: wait while link.canEnter says no (a shut door), then cross in link.time seconds (default: its
          // length at this speed) along link.traverse(f, link, agent) -> [x, y, z], or straight with a hop for 'jump'
          const l = w.link;
          if (!a.link) { if (l.canEnter && l.canEnter(a, l) === false) { a.moving = false; return a; } a.link = { link: l, t: 0, T: l.time ?? Math.max(0.2, Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1], l.to[2] - l.from[2]) / speed) }; opts.onLink?.(a, l, 'start'); }
          const s = a.link, f = Math.min(1, (s.t += dt) / s.T), q = l.traverse ? l.traverse(f, l, a) : [l.from[0] + (l.to[0] - l.from[0]) * f, l.from[1] + (l.to[1] - l.from[1]) * f + (l.type === 'jump' ? Math.sin(Math.PI * f) * (l.height ?? 0.5) : 0), l.from[2] + (l.to[2] - l.from[2]) * f];
          walker.pos[0] = q[0]; walker.pos[1] = q[1]; walker.pos[2] = q[2]; walker.vy = 0; a.moving = true;
          if (f >= 1) { walker.place(l.to); a.link = null; a.index++; opts.onLink?.(a, l, 'end'); if (a.index >= p.length) { a.index = p.length - 1; a.arrived = true; } }
          last = walker.pos.slice();
          return a;
        }
        if (a.index === p.length - 1 && d < arrive) a.arrived = true;
        else if (d > 1e-6) { dx = (w[0] - x) / d; dz = (w[2] - z) / d; slow = Math.min(1, d / (speed * Math.max(dt, 1e-3))); }   // lands on it
      }
    } else if (field && !a.arrived) {
      if (field.stale()) field = field.refreshed();
      if (field.distance(x, y, z) < arrive && Math.hypot(field.goal[0] - x, field.goal[2] - z) < arrive) a.arrived = true;
      else { const d = field.direction(x, y, z); if (d) { dx = d[0]; dz = d[1]; } }
    }
    let mx = dx * slow, mz = dz * slow;
    if (push[0] || push[1]) {
      // separation (arrived agents too make room) only where it keeps the body on fit cells of this floor
      const px = mx + push[0] * a.separation, pz = mz + push[1] * a.separation, l = Math.max(1, Math.hypot(px, pz)), s = speed * Math.min(dt, 0.1) + radius;
      if (nav.visible(walker.pos, [x + (px / l) * s, y, z + (pz / l) * s], { radius })) { mx = px / l; mz = pz / l; }
    }
    const was = walker.pos.slice(), wasOn = walker.onGround, wasFit = nav.fits(x, y, z, radius);
    walker.update(dt, { x: mx, z: mz });
    // the walker tests a cell at the height it comes from, so stepping up beside a low ceiling it can enter a
    // cell where it then does not fit (and would stick): an agent never leaves fit cells, it stays put instead
    a.blocked = walker.blocked;
    if (wasFit && !nav.fits(walker.pos[0], walker.pos[1], walker.pos[2], radius)) {
      walker.pos[0] = was[0]; walker.pos[1] = was[1]; walker.pos[2] = was[2]; walker.vy = 0; walker.onGround = wasOn; a.blocked = true;
    }
    const moved = Math.hypot(walker.pos[0] - last[0], walker.pos[2] - last[2]);
    a.moving = moved > 1e-4;
    if (a.moving) a.heading = [(walker.pos[0] - last[0]) / moved, (walker.pos[2] - last[2]) / moved];
    // stuck (pushed around a corner, a door shut in its face): plan again from here
    stuck = (mx || mz) && moved < speed * dt * 0.2 ? stuck + dt : 0;
    if (stuck > 1 && goal) repath();
    last = walker.pos.slice();
    return a;
  };
  a.place = (p) => { walker.place(p); last = walker.pos.slice(); return a; };
  return a;
}

// Separation for many agents (recast Crowd's separationWeight idea): each pushes away from neighbours closer
// than the sum of radii plus `range`, weighted by how close; neighbours found through a hash of 2 m buckets.
export function createNavCrowd(nav, { separation = 1, range = 0.4 } = {}) {
  const agents = [], buckets = new Map(), S = 2;
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  const crowd = {
    agents, separation, range,
    add(a) { agents.push(a); return a; },
    remove(a) { const i = agents.indexOf(a); if (i >= 0) agents.splice(i, 1); },
    update(dt) {
      buckets.clear();
      for (const a of agents) { const k = key(Math.floor(a.pos[0] / S), Math.floor(a.pos[2] / S)); let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(a); }
      for (const a of agents) {
        let px = 0, pz = 0, n = 0;
        const i = Math.floor(a.pos[0] / S), j = Math.floor(a.pos[2] / S);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          for (const b of buckets.get(key(i + di, j + dj)) || []) {
            if (b === a || Math.abs(b.pos[1] - a.pos[1]) > 1) continue;
            const dx = a.pos[0] - b.pos[0], dz = a.pos[2] - b.pos[2], d = Math.hypot(dx, dz), R = a.radius + b.radius + crowd.range;
            if (d >= R) continue;
            const w = 1 - (d * d) / (R * R);
            if (d > 1e-4) { px += (dx / d) * w; pz += (dz / d) * w; } else { const q = agents.indexOf(a) - agents.indexOf(b); px += Math.cos(q) * w; pz += Math.sin(q) * w; }   // on the same spot: apart by order
            n++;
          }
        }
        a.push[0] = n ? (px / n) * crowd.separation : 0; a.push[1] = n ? (pz / n) * crowd.separation : 0;
      }
      for (const a of agents) a.update(dt);
    },
  };
  return crowd;
}
