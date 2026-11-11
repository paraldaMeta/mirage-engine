// Mirage original code.
// Mesh simplification by quadric error metrics, written for Mirage (no three.js, no DOM: runs in Node and in a
// worker). Technique: Garland & Heckbert 1997 (plane quadrics, edge collapse), Hoppe 1999 (attributes in the
// quadric), the link condition for topology; the code is ours.
//
//   import { createSimplifier, simplify } from '@mirage/core/simplify';
//   const s = createSimplifier({ positions, index,                       // Float32Array xyz, Uint32Array or null (soup)
//     attributes: [{ array: normals, itemSize: 3, weight: 0.3 }, { array: uvs, itemSize: 2, weight: 0.3 }],
//     locked,                                                           // Uint8Array per input vertex: never removed
//     lockBorder: false, borderWeight: 4 });
//   s.run({ triangles: s.triangles >> 1, error: 0.05 });                // until either holds; error in input units
//   const lod = s.extract();                                            // { positions, attributes, index, triangles, error }
//   s.run({ triangles: s.triangles >> 1 }); ...                         // goes on from there: a chain in one pass
//   s.run({ triangles: 0, budgetMs: 4 })                                // -> false when the time ran out: call again
//
// How it works, and why this way:
// - Vertices are welded twice: by position (the topology: "positions") and by position + every attribute (the
//   "wedges": what the GPU calls a vertex). A cube corner is one position and three wedges.
// - A collapse moves position a onto position b (no new points, so attributes are never invented). Each wedge at a
//   is replaced by the wedge at b it shares a triangle with; a wedge with no such partner (the far side of a crease
//   or UV seam) keeps its attributes and moves to b, and the quadrics below say what that costs.
// - Each wedge carries a quadric over (position, attributes): the area-weighted squared distance to the planes of
//   its original triangles plus, per attribute channel, the squared difference from that triangle's linear attribute
//   field at the new position. Flat regions with linear UVs cost exactly nothing; a crease, a UV seam or a colour
//   edge costs what it shows. Open borders get a plane through each border edge, perpendicular to its triangle,
//   and a border position collapses only along the border.
// - Rejected: a collapse that flips or nearly flips a triangle, one that breaks the link condition (it would pinch
//   the surface into a fin), locked positions.
// - `error` is sqrt(cost / area) of the worst collapse so far, in input units (metres): what LOD selection projects
//   to pixels. It is a root-mean-square over the merged triangles, not a Hausdorff bound.
const EPS = 1e-12;

// weld records of `stride` floats: ids per record and the count of unique ones (open addressing on the float bits)
function weld(rec, stride, n) {
  const bits = new Uint32Array(rec.buffer, rec.byteOffset, n * stride);
  let cap = 1; while (cap < n * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), ids = new Uint32Array(n), first = new Uint32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    let h = 2166136261;
    for (let k = 0, o = i * stride; k < stride; k++) { h ^= bits[o + k]; h = Math.imul(h, 16777619); h ^= h >>> 15; }
    let slot = h & (cap - 1);
    for (;;) {
      const j = table[slot];
      if (j < 0) { table[slot] = count; first[count] = i; ids[i] = count++; break; }
      let same = true;
      for (let k = 0, a = i * stride, b = first[j] * stride; k < stride; k++) if (bits[a + k] !== bits[b + k]) { same = false; break; }
      if (same) { ids[i] = j; break; }
      slot = (slot + 1) & (cap - 1);
    }
  }
  return { ids, first, count };
}

export function createSimplifier({ positions, index = null, attributes = [], locked = null, lockBorder = false, borderWeight = 4 }) {
  const nIn = positions.length / 3, T0 = index ? (index.length / 3) | 0 : (nIn / 3) | 0;
  const K = attributes.reduce((s, a) => s + a.itemSize, 0);
  // normalise: centre and scale to the unit box, so weights and tolerances mean the same on a pebble and a hill
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nIn; i++) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const scale = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9), cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, cz = (lo[2] + hi[2]) / 2;
  // weld: positions, then wedges (position + attributes); -0 becomes 0 so the bit compare is a value compare
  const prec = new Float32Array(nIn * 3);
  for (let i = 0; i < nIn * 3; i++) prec[i] = positions[i] + 0;
  const pw = weld(prec, 3, nIn), NP = pw.count;
  const stride = 1 + K, wrec = new Float32Array(nIn * stride);
  for (let i = 0; i < nIn; i++) {
    let o = i * stride; wrec[o++] = pw.ids[i];   // exact below 2^24 positions; beyond that the id is split below
    for (const a of attributes) for (let k = 0; k < a.itemSize; k++) wrec[o++] = a.array[i * a.itemSize + k] + 0;
  }
  if (NP >= 16777216) throw new Error('simplify: more than 2^24 distinct positions; split the mesh first');
  const ww = weld(wrec, stride, nIn), NW = ww.count;
  const P = new Uint32Array(NW);                 // wedge -> position
  const src = ww.first;                          // wedge -> an input vertex with its attributes
  for (let w = 0; w < NW; w++) P[w] = pw.ids[src[w]];
  const pos = new Float64Array(NP * 3);
  for (let p = 0; p < NP; p++) { const i = pw.first[p] * 3; pos[p * 3] = (positions[i] - cx) / scale; pos[p * 3 + 1] = (positions[i + 1] - cy) / scale; pos[p * 3 + 2] = (positions[i + 2] - cz) / scale; }
  // attributes per wedge, scaled by their weights (a unit of attribute counts as `weight` box sizes)
  const S = new Float64Array(NW * K);
  { let c = 0; for (const a of attributes) { for (let k = 0; k < a.itemSize; k++, c++) for (let w = 0; w < NW; w++) S[w * K + c] = a.array[src[w] * a.itemSize + k] * (a.weight ?? 0.3); } }
  // triangles (wedge ids); degenerate ones are dropped at once
  const tri = new Uint32Array(T0 * 3), alive = new Uint8Array(T0);
  let live = 0;
  for (let t = 0; t < T0; t++) {
    const a = ww.ids[index ? index[t * 3] : t * 3], b = ww.ids[index ? index[t * 3 + 1] : t * 3 + 1], c = ww.ids[index ? index[t * 3 + 2] : t * 3 + 2];
    tri[t * 3] = a; tri[t * 3 + 1] = b; tri[t * 3 + 2] = c;
    if (P[a] !== P[b] && P[b] !== P[c] && P[a] !== P[c]) { alive[t] = 1; live++; }
  }
  // triangles around each position (plain arrays: they grow as positions merge)
  const fan = new Array(NP);
  for (let p = 0; p < NP; p++) fan[p] = [];
  for (let t = 0; t < T0; t++) if (alive[t]) for (let k = 0; k < 3; k++) fan[P[tri[t * 3 + k]]].push(t);
  const gone = new Uint8Array(NP), fixed = new Uint8Array(NP), border = new Uint8Array(NP), ver = new Uint32Array(NP);
  if (locked) for (let i = 0; i < nIn; i++) if (locked[i]) fixed[pw.ids[i]] = 1;

  // ---- quadrics: per wedge [A(6) b(3) c w, then per channel g(3) d]
  const QS = 11 + 4 * K, Q = new Float64Array(NW * QS);
  const g = new Float64Array(4 * K);
  const sharedTris = (a, b) => { let n = 0; for (const t of fan[a]) if (alive[t] && (P[tri[t * 3]] === b || P[tri[t * 3 + 1]] === b || P[tri[t * 3 + 2]] === b)) n++; return n; };
  for (let t = 0; t < T0; t++) {
    if (!alive[t]) continue;
    const w0 = tri[t * 3], w1 = tri[t * 3 + 1], w2 = tri[t * 3 + 2], p0 = P[w0] * 3, p1 = P[w1] * 3, p2 = P[w2] * 3;
    const e1x = pos[p1] - pos[p0], e1y = pos[p1 + 1] - pos[p0 + 1], e1z = pos[p1 + 2] - pos[p0 + 2];
    const e2x = pos[p2] - pos[p0], e2y = pos[p2 + 1] - pos[p0 + 1], e2z = pos[p2 + 2] - pos[p0 + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l2 = Math.hypot(nx, ny, nz);
    if (l2 < EPS) continue;
    nx /= l2; ny /= l2; nz /= l2;
    const ar = l2 / 2, d = -(nx * pos[p0] + ny * pos[p0 + 1] + nz * pos[p0 + 2]);
    // the attribute gradients in the triangle's plane: g.e1 = s1 - s0, g.e2 = s2 - s0, g.n = 0
    const ux = e2y * nz - e2z * ny, uy = e2z * nx - e2x * nz, uz = e2x * ny - e2y * nx;   // e2 x n
    const vx = ny * e1z - nz * e1y, vy = nz * e1x - nx * e1z, vz = nx * e1y - ny * e1x;   // n x e1
    let a00 = nx * nx, a01 = nx * ny, a02 = nx * nz, a11 = ny * ny, a12 = ny * nz, a22 = nz * nz, b0 = d * nx, b1 = d * ny, b2 = d * nz, c = d * d;
    for (let k = 0; k < K; k++) {
      const s0 = S[w0 * K + k], d1 = S[w1 * K + k] - s0, d2 = S[w2 * K + k] - s0;
      const gx = (d1 * ux + d2 * vx) / l2, gy = (d1 * uy + d2 * vy) / l2, gz = (d1 * uz + d2 * vz) / l2, gd = s0 - (gx * pos[p0] + gy * pos[p0 + 1] + gz * pos[p0 + 2]);
      g[k * 4] = gx; g[k * 4 + 1] = gy; g[k * 4 + 2] = gz; g[k * 4 + 3] = gd;
      a00 += gx * gx; a01 += gx * gy; a02 += gx * gz; a11 += gy * gy; a12 += gy * gz; a22 += gz * gz; b0 += gd * gx; b1 += gd * gy; b2 += gd * gz; c += gd * gd;
    }
    for (let j = 0; j < 3; j++) {
      const o = tri[t * 3 + j] * QS;
      Q[o] += ar * a00; Q[o + 1] += ar * a01; Q[o + 2] += ar * a02; Q[o + 3] += ar * a11; Q[o + 4] += ar * a12; Q[o + 5] += ar * a22;
      Q[o + 6] += ar * b0; Q[o + 7] += ar * b1; Q[o + 8] += ar * b2; Q[o + 9] += ar * c; Q[o + 10] += ar;
      for (let k = 0; k < 4 * K; k++) Q[o + 11 + k] += ar * g[k];
    }
    // open borders: a plane through the edge, perpendicular to the triangle, holds the outline in place
    for (let j = 0; j < 3; j++) {
      const wa = tri[t * 3 + j], wb = tri[t * 3 + (j + 1) % 3], a = P[wa], b = P[wb];
      if (sharedTris(a, b) !== 1) continue;
      border[a] = border[b] = 1;
      const ex = pos[b * 3] - pos[a * 3], ey = pos[b * 3 + 1] - pos[a * 3 + 1], ez = pos[b * 3 + 2] - pos[a * 3 + 2];
      let mx = ey * nz - ez * ny, my = ez * nx - ex * nz, mz = ex * ny - ey * nx;
      const ml = Math.hypot(mx, my, mz);
      if (ml < EPS) continue;
      mx /= ml; my /= ml; mz /= ml;
      const md = -(mx * pos[a * 3] + my * pos[a * 3 + 1] + mz * pos[a * 3 + 2]), wgt = borderWeight * ml * ml;   // ml = edge length
      for (const w of [wa, wb]) {
        const o = w * QS;
        Q[o] += wgt * mx * mx; Q[o + 1] += wgt * mx * my; Q[o + 2] += wgt * mx * mz; Q[o + 3] += wgt * my * my; Q[o + 4] += wgt * my * mz; Q[o + 5] += wgt * mz * mz;
        Q[o + 6] += wgt * md * mx; Q[o + 7] += wgt * md * my; Q[o + 8] += wgt * md * mz; Q[o + 9] += wgt * md * md;
      }
    }
  }
  if (lockBorder) for (let p = 0; p < NP; p++) if (border[p]) fixed[p] = 1;
  const evalQ = (w, px, py, pz, sw) => {   // wedge w's quadric at a position, with the attributes of wedge sw
    const o = w * QS;
    let e = px * (Q[o] * px + 2 * (Q[o + 1] * py + Q[o + 2] * pz)) + py * (Q[o + 3] * py + 2 * Q[o + 4] * pz) + Q[o + 5] * pz * pz + 2 * (Q[o + 6] * px + Q[o + 7] * py + Q[o + 8] * pz) + Q[o + 9];
    for (let k = 0, q = o + 11, s = sw * K; k < K; k++, q += 4, s++) { const sv = S[s]; e += sv * (Q[o + 10] * sv - 2 * (Q[q] * px + Q[q + 1] * py + Q[q + 2] * pz + Q[q + 3])); }
    return e;
  };

  // ---- candidates: a binary heap of directed collapses a -> b; an entry is stale when either end changed since
  let hN = 0, hCap = 1 << 16, hC = new Float64Array(hCap), hA = new Uint32Array(hCap), hB = new Uint32Array(hCap), hV = new Uint32Array(hCap * 2);
  const hSwap = (i, j) => { let t = hC[i]; hC[i] = hC[j]; hC[j] = t; t = hA[i]; hA[i] = hA[j]; hA[j] = t; t = hB[i]; hB[i] = hB[j]; hB[j] = t; t = hV[i * 2]; hV[i * 2] = hV[j * 2]; hV[j * 2] = t; t = hV[i * 2 + 1]; hV[i * 2 + 1] = hV[j * 2 + 1]; hV[j * 2 + 1] = t; };
  const push = (c, a, b) => {
    if (hN === hCap) { hCap *= 2; const g1 = (A, m = 1) => { const B = new A.constructor(hCap * m); B.set(A); return B; }; hC = g1(hC); hA = g1(hA); hB = g1(hB); hV = g1(hV, 2); }
    let i = hN++; hC[i] = c; hA[i] = a; hB[i] = b; hV[i * 2] = ver[a]; hV[i * 2 + 1] = ver[b];
    while (i > 0) { const p = (i - 1) >> 1; if (hC[p] <= hC[i]) break; hSwap(i, p); i = p; }
  };
  const pop = () => {
    hSwap(0, --hN);
    for (let i = 0; ;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < hN && hC[l] < hC[m]) m = l; if (r < hN && hC[r] < hC[m]) m = r; if (m === i) break; hSwap(i, m); i = m; }
    return hN;   // the popped entry sits at index hN
  };
  // the wedges at position a and, for a collapse onto b, what each becomes: wa[i] -> wt[i] (itself when it has no partner)
  const wa = [], wt = [];
  const wedgesOf = (a, b) => {
    wa.length = 0; wt.length = 0;
    for (const t of fan[a]) {
      if (!alive[t]) continue;
      let w = -1, partner = -1;
      for (let k = 0; k < 3; k++) { const x = tri[t * 3 + k], px = P[x]; if (px === a) w = x; else if (px === b) partner = x; }
      const i = wa.indexOf(w);
      if (i < 0) { wa.push(w); wt.push(partner < 0 ? w : partner); } else if (partner >= 0 && wt[i] === w) wt[i] = partner;
    }
  };
  const cost = (a, b) => {
    wedgesOf(a, b);
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    let e = 0;
    for (let i = 0; i < wa.length; i++) e += evalQ(wa[i], bx, by, bz, wt[i]);
    const dx = bx - pos[a * 3], dy = by - pos[a * 3 + 1], dz = bz - pos[a * 3 + 2];
    return Math.max(e, 0) + 1e-10 * (dx * dx + dy * dy + dz * dz);   // among free collapses, the short edges first: better triangles
  };
  const stamp = new Uint32Array(NP), near = [];
  let stampN = 0;
  const neighbours = (a) => {   // positions sharing a live triangle with a, into `near`
    near.length = 0; stampN++;
    for (const t of fan[a]) if (alive[t]) for (let k = 0; k < 3; k++) { const p = P[tri[t * 3 + k]]; if (p !== a && stamp[p] !== stampN) { stamp[p] = stampN; near.push(p); } }
  };
  const offer = (a, b) => { if (!fixed[a] && !(border[a] && !border[b])) push(cost(a, b), a, b); };
  for (let a = 0; a < NP; a++) { if (!fan[a].length) { gone[a] = 1; continue; } neighbours(a); for (let i = 0; i < near.length; i++) offer(a, near[i]); }

  // would a -> b keep the surface a surface, facing the same way?
  const legal = (a, b) => {
    if (border[a]) { if (!border[b] || sharedTris(a, b) !== 1) return false; }
    // the link condition: positions next to both a and b are exactly the third corners of the triangles on a-b
    neighbours(b); const mark = stampN; let common = 0, onEdge = 0;
    for (const t of fan[a]) {
      if (!alive[t]) continue;
      let hasB = false;
      for (let k = 0; k < 3; k++) if (P[tri[t * 3 + k]] === b) hasB = true;
      if (hasB) onEdge++;
    }
    const seen = stampN + 1; stampN++;
    for (const t of fan[a]) if (alive[t]) for (let k = 0; k < 3; k++) { const p = P[tri[t * 3 + k]]; if (p !== a && p !== b && stamp[p] === mark) { stamp[p] = seen; common++; } }
    if (common !== onEdge) return false;
    // no triangle around a may flip or collapse to a sliver
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    for (const t of fan[a]) {
      if (!alive[t]) continue;
      const q0 = P[tri[t * 3]], q1 = P[tri[t * 3 + 1]], q2 = P[tri[t * 3 + 2]];
      if (q0 === b || q1 === b || q2 === b) continue;
      const o0 = q0 * 3, o1 = q1 * 3, o2 = q2 * 3;
      const x0 = pos[o0], y0 = pos[o0 + 1], z0 = pos[o0 + 2], x1 = pos[o1], y1 = pos[o1 + 1], z1 = pos[o1 + 2], x2 = pos[o2], y2 = pos[o2 + 1], z2 = pos[o2 + 2];
      const nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0), ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0), nz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      const X0 = q0 === a ? bx : x0, Y0 = q0 === a ? by : y0, Z0 = q0 === a ? bz : z0, X1 = q1 === a ? bx : x1, Y1 = q1 === a ? by : y1, Z1 = q1 === a ? bz : z1, X2 = q2 === a ? bx : x2, Y2 = q2 === a ? by : y2, Z2 = q2 === a ? bz : z2;
      const mx = (Y1 - Y0) * (Z2 - Z0) - (Z1 - Z0) * (Y2 - Y0), my = (Z1 - Z0) * (X2 - X0) - (X1 - X0) * (Z2 - Z0), mz = (X1 - X0) * (Y2 - Y0) - (Y1 - Y0) * (X2 - X0);
      const dot = nx * mx + ny * my + nz * mz, n2 = nx * nx + ny * ny + nz * nz, m2 = mx * mx + my * my + mz * mz;
      if (m2 < 1e-24 || dot < 0.2 * Math.sqrt(n2 * m2)) return false;
    }
    return true;
  };
  let worst = 0;
  const collapse = (a, b, c) => {
    wedgesOf(a, b);
    let wsum = 0;
    for (let i = 0; i < wa.length; i++) {
      const w = wa[i], t = wt[i];
      wsum += Q[w * QS + 10];
      if (t !== w) { for (let k = 0, o = w * QS, q = t * QS; k < QS; k++) Q[q + k] += Q[o + k]; } else P[w] = b;
    }
    const fb = fan[b];
    for (const t of fan[a]) {
      if (!alive[t]) continue;
      let hasB = false;
      for (let k = 0; k < 3; k++) if (P[tri[t * 3 + k]] === b && wa.indexOf(tri[t * 3 + k]) < 0) hasB = true;
      if (hasB) { alive[t] = 0; live--; continue; }
      for (let k = 0; k < 3; k++) { const i = wa.indexOf(tri[t * 3 + k]); if (i >= 0) tri[t * 3 + k] = wt[i]; }
      fb.push(t);
    }
    // drop dead triangles from b's fan now and then, so fans do not grow without bound
    if (fb.length > 64) { let n = 0; for (const t of fb) if (alive[t]) fb[n++] = t; fb.length = n; }
    fan[a] = []; gone[a] = 1; ver[a]++; ver[b]++;
    if (wsum > EPS) worst = Math.max(worst, Math.sqrt(c / wsum));
    neighbours(b);
    const list = near.slice();
    for (const n of list) { offer(b, n); offer(n, b); }
  };

  const api = {
    positions: NP, wedges: NW, scale,
    get triangles() { return live; },
    get error() { return worst * scale; },
    // collapse until at most `triangles` remain or the next collapse would exceed `error` (input units);
    // true when it stopped for one of those (or ran out of legal collapses), false when `budgetMs` ran out first
    run({ triangles = 0, error = Infinity, budgetMs = Infinity } = {}) {
      const lim = error / scale, t0 = budgetMs < Infinity ? performance.now() : 0;
      let n = 0;
      while (live > triangles && hN > 0) {
        const i = pop(), a = hA[i], b = hB[i], c = hC[i];
        if (gone[a] || gone[b] || ver[a] !== hV[i * 2] || ver[b] !== hV[i * 2 + 1]) continue;
        // an estimate of this collapse's error from the area it touches: stop before it, the heap is in cost order
        if (lim < Infinity) { wedgesOf(a, b); let ws = 0; for (const w of wa) ws += Q[w * QS + 10]; if (ws > EPS && Math.sqrt(c / ws) > lim) { push(c, a, b); break; } }
        if (!legal(a, b)) continue;
        collapse(a, b, c);
        if ((++n & 255) === 0 && budgetMs < Infinity && performance.now() - t0 > budgetMs) return false;
      }
      return true;
    },
    // the mesh as it is now: compact arrays, same attribute layout as the input
    extract() {
      const map = new Int32Array(NW).fill(-1), idx = new Uint32Array(live * 3);
      let nv = 0, o = 0;
      for (let t = 0; t < T0; t++) if (alive[t]) for (let k = 0; k < 3; k++) { const w = tri[t * 3 + k]; if (map[w] < 0) map[w] = nv++; idx[o++] = map[w]; }
      const outP = new Float32Array(nv * 3), outA = attributes.map((a) => new (a.array.constructor)(nv * a.itemSize));
      for (let w = 0; w < NW; w++) {
        const v = map[w]; if (v < 0) continue;
        const p = P[w] * 3;
        outP[v * 3] = pos[p] * scale + cx; outP[v * 3 + 1] = pos[p + 1] * scale + cy; outP[v * 3 + 2] = pos[p + 2] * scale + cz;
        attributes.forEach((a, j) => { for (let k = 0; k < a.itemSize; k++) outA[j][v * a.itemSize + k] = a.array[src[w] * a.itemSize + k]; });
      }
      return { positions: outP, attributes: outA, index: nv <= 65535 ? new Uint16Array(idx) : idx, triangles: live, vertices: nv, error: worst * scale };
    },
  };
  return api;
}

// one level: simplify({ positions, index, attributes, ... }, { triangles | ratio, error })
export function simplify(mesh, { triangles, ratio = 0.5, error = Infinity } = {}) {
  const s = createSimplifier(mesh);
  s.run({ triangles: triangles ?? Math.floor(s.triangles * ratio), error });
  return s.extract();
}

// a chain in one pass: levels of at most ratio[i] of the source's triangles (each also stops at `error`, when given);
// a level that removes less than `minGain` of the level before it is left out (nothing to win), and the chain ends there.
// `step(budgetMs)` runs it in slices (-> true when done); `levels` is the result.
export function createChain(mesh, { ratios = [0.5, 0.25, 0.125], error = Infinity, minGain = 0.2 } = {}) {
  const s = createSimplifier(mesh), T = s.triangles, levels = [];
  let i = 0, last = T;
  return {
    levels, source: T,
    step(budgetMs = Infinity) {
      while (i < ratios.length) {
        if (!s.run({ triangles: Math.floor(T * ratios[i]), error, budgetMs })) return false;
        i++;
        if (s.triangles > last * (1 - minGain) || s.triangles === 0) { i = ratios.length; break; }
        last = s.triangles; levels.push(s.extract());
      }
      return true;
    },
  };
}
