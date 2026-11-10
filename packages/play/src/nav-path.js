// Mirage original code.
// ---------------------------------------------------------------------------
// Path queries on a budget, and paths with their corners rounded.
//
//   const queue = createPathQueue(nav, { budgetMs: 2 });
//   const job = queue.request(from, to, { radius, priority: 1 });   // a promise: await job -> waypoints | null
//   job.cancel();                                                    // resolves null, never runs
//   queue.request(from, to, { then: (path) => ... })                 // called inside update(): for fixed-step code
//   each frame: queue.update();                                      // runs queries, best priority first, until the
//   queue.pending, queue.stats -> { ran, ms, worst }                 // budget is spent (at least one per call)
//
//   smoothPath(nav, path, { radius, corner: 0.6 }) -> more waypoints: each corner replaced by an arc that
//   nav.visible() accepts segment by segment: inside the corner where there is room, else swinging wide through
//   it (corners hug walls); a corner that takes neither stays sharp; link waypoints stay
//   pathLength(path) -> metres
//
// ponytail: one findPath is not sliced: the budget decides how many start in a frame, not how long one takes. Bound
// a single query with maxNodes (it returns null past it) when a 512 x 512 worst case (docs/navigation.md) is too long.
// ---------------------------------------------------------------------------

export function createPathQueue(nav, { budgetMs = 2, max = Infinity } = {}) {
  const jobs = [];
  let order = 0;
  const queue = {
    budgetMs, stats: { ran: 0, ms: 0, worst: 0, total: 0 },
    get pending() { return jobs.length; },
    request(from, to, opts = {}) {
      let done;
      const job = new Promise((r) => { done = r; });
      const j = { from: from.slice(), to: to.slice(), opts, priority: opts.priority ?? 0, order: order++, done, dead: false };
      job.cancel = () => { if (j.dead) return; j.dead = true; const i = jobs.indexOf(j); if (i >= 0) jobs.splice(i, 1); done(null); };
      jobs.push(j);
      return job;
    },
    /** run queued queries until `budgetMs` is spent; returns how many ran */
    update(budget = queue.budgetMs) {
      const t0 = performance.now();
      let n = 0, worst = 0;
      if (jobs.length > 1) jobs.sort((a, b) => b.priority - a.priority || a.order - b.order);
      while (jobs.length && n < max) {
        const j = jobs.shift(), t1 = performance.now();
        j.dead = true;
        // opts.origin(): where the asker is now (a query that waited starts from there); null: nobody is asking any more
        const from = j.opts.origin ? j.opts.origin() : j.from;
        const path = from ? nav.findPath(from, j.to, j.opts) : null;
        if (j.opts.then) j.opts.then(path);   // in this call, not a microtask later: a fixed-step loop sees it at once
        j.done(path);
        n++;
        const now = performance.now();
        if (now - t1 > worst) worst = now - t1;
        if (now - t0 >= budget) break;
      }
      const s = queue.stats;
      s.ran = n; s.ms = +(performance.now() - t0).toFixed(3); s.worst = +worst.toFixed(3); s.total += n;
      return n;
    },
    clear() { for (const j of jobs.splice(0)) { j.dead = true; j.done(null); } },
  };
  return queue;
}

export function pathLength(path) {
  let l = 0;
  for (let q = 1; q < path.length; q++) l += Math.hypot(path[q][0] - path[q - 1][0], path[q][1] - path[q - 1][1], path[q][2] - path[q - 1][2]);
  return l;
}

/** round the corners of a findPath result: quadratic arcs of up to `corner` metres each side, `segments` pieces each */
export function smoothPath(nav, path, { radius, corner = 0.6, segments = 5 } = {}) {
  if (!path || path.length < 3) return path;
  const out = [path[0]], o = { radius };
  for (let q = 1; q < path.length - 1; q++) {
    const A = out[out.length - 1], B = path[q], C = path[q + 1];
    // a link's two ends are places to stand, not corners; a change of floor height is left alone too
    if (B.link || C.link || Math.abs(A[1] - B[1]) > 1e-3 || Math.abs(C[1] - B[1]) > 1e-3) { out.push(B); continue; }
    const la = Math.hypot(A[0] - B[0], A[2] - B[2]), lc = Math.hypot(C[0] - B[0], C[2] - B[2]);
    let done = false;
    for (let r = Math.min(corner, la / 2, lc / 2), tries = 0; tries < 3 && r > 0.05 && !done; tries++, r /= 2) {
      const p1 = [B[0] + ((A[0] - B[0]) / la) * r, B[1], B[2] + ((A[2] - B[2]) / la) * r], p2 = [B[0] + ((C[0] - B[0]) / lc) * r, B[1], B[2] + ((C[2] - B[2]) / lc) * r];
      // first the arc inside the corner (shorter); a corner that hugs a wall has no room there, so then the arc that
      // swings wide and passes through the corner itself (control point mirrored out: 2B - the chord's middle)
      for (const k of [B, [2 * B[0] - (p1[0] + p2[0]) / 2, B[1], 2 * B[2] - (p1[2] + p2[2]) / 2]]) {
        const arc = [];
        for (let s = 0; s <= segments; s++) { const t = s / segments, u = 1 - t; arc.push([u * u * p1[0] + 2 * u * t * k[0] + t * t * p2[0], B[1], u * u * p1[2] + 2 * u * t * k[2] + t * t * p2[2]]); }
        let ok = nav.visible(A, arc[0], o);
        for (let s = 1; s < arc.length && ok; s++) ok = nav.visible(arc[s - 1], arc[s], o);
        if (ok) { out.push(...arc); done = true; break; }
      }
    }
    if (!done) out.push(B);
  }
  out.push(path[path.length - 1]);
  return out;
}
