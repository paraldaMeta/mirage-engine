// Mirage original code.
// ---------------------------------------------------------------------------
// A crowd that avoids itself: reciprocal velocity obstacles (ORCA: each pair shares the detour, so nobody jitters)
// over the navigation grid. Agents are rows of typed arrays, not walkers: hundreds cost a millisecond or two.
//
//   const crowd = createCrowd(nav, { max: 512 });
//   const i = crowd.add({ pos: [x, y, z], radius: 0.28, speed: 1.5 });      // radii may differ per agent
//   crowd.setGoal(i, [x, y, z]);            // a path query, queued and budgeted (crowd.queue, nav-path.js)
//   crowd.setField(i, nav.flowField(goal)); // or one shared field for many agents with one goal
//   crowd.setVelocity(i, vx, vz);           // or just a wish: avoidance still applies
//   crowd.update(dt);                       // fixed step: same inputs, same result
//   (bit-exact replays: the default path budget is wall-clock milliseconds, so pass your own counted queue:
//    { queue: createPathQueue(nav, { budgetMs: Infinity, max: 8 }) } and call queue.update() before crowd.update)
//   crowd.x[i], crowd.y[i], crowd.z[i], crowd.vx[i], crowd.vz[i], crowd.arrived(i), crowd.count
//   const p = crowd.add({ pos, radius, fixed: true }); crowd.move(p, x, y, z);   // the player: avoided, never steered
//   crowd.actor(i) -> { pos, heading, moveTo, stop, arrived }                    // what ai.js behaviours drive
//   crowd.onLink = (i, link, 'start' | 'end') => {}                              // off-mesh link traversal
//
// Each step: neighbours from a hash of `range`-metre buckets (the `neighbours` nearest on the same floor); one
// half-plane of allowed velocities per neighbour (collision-free for `horizon` seconds if both keep to their
// half); the velocity nearest the wished one inside all of them and the speed limit, by a small linear program
// (when the planes leave nothing: the velocity that breaks them least). Then the move, kept on cells the agent's
// radius fits (nav.visible; sliding along x or z when the straight step is refused).
// Off-mesh links: a waypoint carrying .link is crossed in link.time seconds (default: its length at the agent's
// speed) along link.traverse(f, link, actor) or a straight line (with a hop for type 'jump'); link.canEnter(actor,
// link) === false holds the agent at the near end (a door that is still shut). Agents on a link are not avoided.
// ponytail: walls are not velocity obstacles, the nav clamp stops an agent at them (a dense crowd pressed into a
// corner packs rather than flows round); no gravity or falling: an agent is on a floor or on a link; agents and
// createNavAgent walkers do not see each other unless the walker is added as a `fixed` agent.
// ---------------------------------------------------------------------------
import { createPathQueue } from './nav-path.js';

const EPS = 1e-5;
const det = (ax, az, bx, bz) => ax * bz - az * bx;

export function createCrowd(nav, opts = {}) {
  const max = opts.max ?? 512, K = opts.neighbours ?? 8, range = opts.range ?? 2.5, horizon = opts.horizon ?? 1.2, arrive = opts.arrive ?? 0.2;
  const f64 = () => new Float64Array(max);
  const x = f64(), y = f64(), z = f64(), vx = f64(), vz = f64(), wx = f64(), wz = f64(), radius = f64(), speed = f64(), hx = f64(), hz = f64().fill(1), stall = f64();
  // state: 0 free slot, 1 idle, 2 path, 3 field, 4 wish (setVelocity), 5 on a link, 6 fixed, 7 waiting for a path
  const state = new Uint8Array(max), done = new Uint8Array(max), gen = new Uint32Array(max), ver = new Uint32Array(max);
  const path = new Array(max).fill(null), pidx = new Int32Array(max), goal = new Array(max).fill(null), field = new Array(max).fill(null), link = new Array(max).fill(null), actors = new Array(max).fill(null), popts = new Array(max).fill(null);
  const queue = opts.queue || createPathQueue(nav, { budgetMs: opts.pathBudgetMs ?? 1 });
  // the bucket hash, rebuilt each step by a counting sort
  const H = 1 << Math.max(8, Math.ceil(Math.log2(max * 2))), start = new Int32Array(H + 2), sorted = new Int32Array(max), ci = new Int32Array(max), cj = new Int32Array(max), slot = new Int32Array(max);
  const hash = (i, j) => ((i * 73856093) ^ (j * 19349663)) & (H - 1);
  // per agent: neighbours, then the half-planes (a point and a direction each; allowed: left of the direction)
  const nbr = new Int32Array(K), nd = new Float64Array(K), lpx = new Float64Array(K), lpz = new Float64Array(K), ldx = new Float64Array(K), ldz = new Float64Array(K);
  const qpx = new Float64Array(K), qpz = new Float64Array(K), qdx = new Float64Array(K), qdz = new Float64Array(K);
  const nvx = f64(), nvz = f64(), a3 = [0, 0, 0], b3 = [0, 0, 0], vo = { radius: 0 };
  let rx = 0, rz = 0, high = 0, frame = 0;

  // ---- the linear programs (all in velocity space; r: the speed limit) ----
  /** the best point on line `n` of (px, pz, dx, dz) inside the circle and the lines before it; false: none */
  function lp1(PX, PZ, DX, DZ, n, r, ox, oz, dirOpt) {
    const dot = PX[n] * DX[n] + PZ[n] * DZ[n], disc = dot * dot + r * r - (PX[n] * PX[n] + PZ[n] * PZ[n]);
    if (disc < 0) return false;
    const sq = Math.sqrt(disc);
    let tl = -dot - sq, tr = -dot + sq;
    for (let i = 0; i < n; i++) {
      const den = det(DX[n], DZ[n], DX[i], DZ[i]), num = det(DX[i], DZ[i], PX[n] - PX[i], PZ[n] - PZ[i]);
      if (Math.abs(den) <= EPS) { if (num < 0) return false; continue; }
      const t = num / den;
      if (den >= 0) { if (t < tr) tr = t; } else if (t > tl) tl = t;
      if (tl > tr) return false;
    }
    let t;
    if (dirOpt) t = ox * DX[n] + oz * DZ[n] > 0 ? tr : tl;
    else { t = DX[n] * (ox - PX[n]) + DZ[n] * (oz - PZ[n]); if (t < tl) t = tl; else if (t > tr) t = tr; }
    rx = PX[n] + t * DX[n]; rz = PZ[n] + t * DZ[n];
    return true;
  }
  /** the velocity nearest (ox, oz) (or farthest along it: dirOpt) inside the circle and all m lines; returns m, or the line that failed */
  function lp2(PX, PZ, DX, DZ, m, r, ox, oz, dirOpt) {
    if (dirOpt) { rx = ox * r; rz = oz * r; }
    else { const l = ox * ox + oz * oz; if (l > r * r) { const s = r / Math.sqrt(l); rx = ox * s; rz = oz * s; } else { rx = ox; rz = oz; } }
    for (let i = 0; i < m; i++) {
      if (det(DX[i], DZ[i], PX[i] - rx, PZ[i] - rz) > 0) {
        const tx = rx, tz = rz;
        if (!lp1(PX, PZ, DX, DZ, i, r, ox, oz, dirOpt)) { rx = tx; rz = tz; return i; }
      }
    }
    return m;
  }
  /** nothing satisfies all m lines: from line `from` on, the velocity that goes least far past the worst of them */
  function lp3(m, from, r) {
    let dist = 0;
    for (let i = from; i < m; i++) {
      if (det(ldx[i], ldz[i], lpx[i] - rx, lpz[i] - rz) <= dist) continue;
      let q = 0;
      for (let j = 0; j < i; j++) {
        const d = det(ldx[i], ldz[i], ldx[j], ldz[j]);
        if (Math.abs(d) <= EPS) {
          if (ldx[i] * ldx[j] + ldz[i] * ldz[j] > 0) continue;
          qpx[q] = 0.5 * (lpx[i] + lpx[j]); qpz[q] = 0.5 * (lpz[i] + lpz[j]);
        } else { const t = det(ldx[j], ldz[j], lpx[i] - lpx[j], lpz[i] - lpz[j]) / d; qpx[q] = lpx[i] + t * ldx[i]; qpz[q] = lpz[i] + t * ldz[i]; }
        const ex = ldx[j] - ldx[i], ez = ldz[j] - ldz[i], l = Math.hypot(ex, ez) || 1;
        qdx[q] = ex / l; qdz[q] = ez / l; q++;
      }
      const tx = rx, tz = rz;
      if (lp2(qpx, qpz, qdx, qdz, q, r, -ldz[i], ldx[i], true) < q) { rx = tx; rz = tz; }
      dist = det(ldx[i], ldz[i], lpx[i] - rx, lpz[i] - rz);
    }
  }

  function steer(i, dt) {
    // the wished velocity (wx, wz) of agent i from its path, field or wish
    const s = state[i];
    if (s === 2) {
      const p = path[i];
      if (!p) { wx[i] = wz[i] = 0; return; }
      let q = pidx[i];
      a3[0] = x[i]; a3[1] = y[i]; a3[2] = z[i]; vo.radius = radius[i];
      // on to the next waypoint when at this one, or (looked at every 4th step, or when close) when the next is in a
      // straight walk; a link's near end is walked to exactly
      while (q < p.length - 1 && !p[q].link) {
        const d = Math.hypot(p[q][0] - x[i], p[q][2] - z[i]), nextLink = !!p[q + 1].link;
        if (d < (nextLink ? 0.12 : 0.05) || (!nextLink && (d < 0.6 || ((i + frame) & 3) === 0) && nav.visible(a3, p[q + 1], vo))) q++; else break;
      }
      pidx[i] = q;
      const w = p[q];
      if (w.link) {
        const l = w.link;
        if (l.canEnter && l.canEnter(crowd.actor(i), l) === false) { wx[i] = wz[i] = 0; stall[i] = 0; return; }
        const len = Math.hypot(l.to[0] - x[i], l.to[1] - y[i], l.to[2] - z[i]);
        link[i] = { link: l, t: 0, T: l.time ?? Math.max(0.2, len / speed[i]), fx: x[i], fy: y[i], fz: z[i] };
        state[i] = 5; wx[i] = wz[i] = 0; vx[i] = vz[i] = 0;
        crowd.onLink?.(i, l, 'start');
        return;
      }
      const dx = w[0] - x[i], dz = w[2] - z[i], d = Math.hypot(dx, dz);
      if (q === p.length - 1 && d < arrive) { done[i] = 1; state[i] = 1; wx[i] = wz[i] = 0; return; }
      const sp = q === p.length - 1 ? speed[i] * Math.min(1, d / 0.5 + 0.15) : speed[i];
      wx[i] = (dx / (d || 1)) * sp; wz[i] = (dz / (d || 1)) * sp;
    } else if (s === 3) {
      let f = field[i];
      if (f.stale()) f = field[i] = f.refreshed();
      if (f.distance(x[i], y[i], z[i]) < Math.max(arrive, radius[i])) { done[i] = 1; wx[i] = wz[i] = 0; return; }
      const d = f.direction(x[i], y[i], z[i]);
      wx[i] = d ? d[0] * speed[i] : 0; wz[i] = d ? d[1] * speed[i] : 0;
    } else if (s !== 4) { wx[i] = wz[i] = 0; }
  }

  function request(i) {
    const g = gen[i];
    ver[i] = nav.version;
    queue.request([x[i], y[i], z[i]], goal[i], { radius: radius[i], snap: 1.5, ...popts[i], then: (p) => {
      if (gen[i] !== g || !state[i]) return;
      if (state[i] === 5) { ver[i] = nav.version - 1; return; }   // mid-link: asked again after the landing
      path[i] = p; pidx[i] = p ? 1 : 0; state[i] = 2; stall[i] = 0;
      if (!p) crowd.onNoPath?.(i);
    } });
  }

  const crowd = {
    x, y, z, vx, vz, radius, speed, state, queue, max, count: 0,
    /** a new agent: { pos, radius, speed, fixed, costs, canUse } -> its index (-1: the crowd is full) */
    add(a = {}) {
      let i = 0;
      while (i < max && state[i]) i++;
      if (i === max) return -1;
      const p = a.pos || [0, 0, 0];
      radius[i] = a.radius ?? 0.28; speed[i] = a.speed ?? 1.5;
      nav.profile(radius[i]);
      const n = nav.nearest(p, { radius: radius[i], snap: 2 }) || p;
      x[i] = a.fixed ? p[0] : n[0]; y[i] = a.fixed ? p[1] : n[1]; z[i] = a.fixed ? p[2] : n[2];
      vx[i] = vz[i] = wx[i] = wz[i] = 0; hx[i] = 0; hz[i] = 1; done[i] = 0; stall[i] = 0;
      state[i] = a.fixed ? 6 : 1; path[i] = goal[i] = field[i] = link[i] = actors[i] = null; gen[i]++;
      popts[i] = a.costs || a.canUse ? { costs: a.costs, canUse: a.canUse } : null;
      if (i >= high) high = i + 1;
      crowd.count++;
      return i;
    },
    remove(i) { if (!state[i]) return; state[i] = 0; gen[i]++; path[i] = goal[i] = field[i] = link[i] = actors[i] = null; crowd.count--; while (high > 0 && !state[high - 1]) high--; },
    /** walk to p (a queued path query; false only for a fixed agent). The path arrives inside a later update(). */
    setGoal(i, p) { if (state[i] === 6 || !state[i]) return false; goal[i] = p.slice(); field[i] = null; done[i] = 0; gen[i]++; if (state[i] !== 5) state[i] = 7; request(i); return true; },
    setField(i, f) { if (state[i] === 6 || !state[i]) return false; field[i] = f; goal[i] = null; path[i] = null; done[i] = 0; gen[i]++; state[i] = 3; return true; },
    setVelocity(i, ax, az) { if (state[i] === 6 || !state[i] || state[i] === 5) return; goal[i] = field[i] = path[i] = null; gen[i]++; state[i] = 4; wx[i] = ax; wz[i] = az; done[i] = 0; },
    stop(i) { if (state[i] === 6 || !state[i] || state[i] === 5) return; goal[i] = field[i] = path[i] = null; gen[i]++; state[i] = 1; wx[i] = wz[i] = 0; },
    /** put a fixed agent (the player, a vehicle) where it is now; its velocity is taken from the move */
    move(i, px, py, pz, dt = 1 / 60) { vx[i] = (px - x[i]) / dt; vz[i] = (pz - z[i]) / dt; x[i] = px; y[i] = py; z[i] = pz; const a = actors[i]; if (a) { a.pos[0] = px; a.pos[1] = py; a.pos[2] = pz; } },
    /** teleport an agent (keeps its goal: it plans again from there) */
    place(i, p) { const n = nav.nearest(p, { radius: radius[i], snap: 2 }) || p; x[i] = n[0]; y[i] = n[1]; z[i] = n[2]; vx[i] = vz[i] = 0; if (state[i] === 5) { link[i] = null; state[i] = 7; } if (goal[i]) { gen[i]++; state[i] = 7; request(i); } },
    arrived: (i) => done[i] === 1,
    onLink: null, onNoPath: null,
    pathOf: (i) => path[i], waypoint: (i) => pidx[i], linkOf: (i) => link[i]?.link || null,
    heading: (i, out = [0, 0]) => { out[0] = hx[i]; out[1] = hz[i]; return out; },
    position: (i, out = [0, 0, 0]) => { out[0] = x[i]; out[1] = y[i]; out[2] = z[i]; return out; },
    /** agent i as the object ai.js behaviours drive (one per agent, kept current by update) */
    actor(i) {
      if (actors[i]) return actors[i];
      const a = { id: i, crowd, pos: [x[i], y[i], z[i]], heading: [hx[i], hz[i]], radius: radius[i],
        moveTo: (p) => crowd.setGoal(i, p), stop: () => crowd.stop(i),
        get arrived() { return done[i] === 1; }, get moving() { return Math.hypot(vx[i], vz[i]) > 0.05; },
        get speed() { return speed[i]; }, set speed(v) { speed[i] = v; },
        get onLink() { return state[i] === 5; }, get noPath() { return state[i] === 2 && !path[i]; } };
      return (actors[i] = a);
    },
    update(dt) {
      frame++;
      if (!opts.queue) queue.update();
      // buckets
      const inv = 1 / range;
      start.fill(0);
      for (let i = 0; i < high; i++) { if (!state[i] || state[i] === 5) continue; ci[i] = Math.floor(x[i] * inv); cj[i] = Math.floor(z[i] * inv); slot[i] = hash(ci[i], cj[i]); start[slot[i] + 2]++; }
      for (let h = 0; h < H; h++) start[h + 2] += start[h + 1];
      for (let i = 0; i < high; i++) { if (!state[i] || state[i] === 5) continue; sorted[start[slot[i] + 1]++] = i; }
      // (bucket h is now sorted[start[h] .. start[h + 1]))
      const invT = 1 / horizon, invDt = 1 / Math.max(dt, 1e-4);
      for (let i = 0; i < high; i++) {
        const s = state[i];
        if (!s || s === 6) continue;
        if (s === 5) continue;
        if (s === 7) { wx[i] = wz[i] = 0; }
        else {
          if ((s === 2 || (s === 1 && goal[i] && !done[i])) && ver[i] !== nav.version) request(i);   // the nav changed under the path
          steer(i, dt);
          if (state[i] === 5) continue;
        }
        // the K nearest neighbours on this floor
        let n = 0;
        const R2 = range * range;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const bi = ci[i] + di, bj = cj[i] + dj, h = hash(bi, bj), e = start[h + 1];
          for (let q = start[h]; q < e; q++) {
            const o = sorted[q];
            if (o === i || ci[o] !== bi || cj[o] !== bj || Math.abs(y[o] - y[i]) > 1.2) continue;
            const d2 = (x[o] - x[i]) ** 2 + (z[o] - z[i]) ** 2;
            if (d2 > R2) continue;
            let m;
            if (n < K) m = n++; else if (d2 >= nd[K - 1]) continue; else m = K - 1;
            while (m > 0 && nd[m - 1] > d2) { nd[m] = nd[m - 1]; nbr[m] = nbr[m - 1]; m--; }
            nd[m] = d2; nbr[m] = o;
          }
        }
        // a little of the wish turned by the agent's index: two agents meeting head on pick different sides
        const ang = ((i * 2654435761) >>> 0) / 4294967296 * 0.1 - 0.05, pwx = wx[i] - wz[i] * ang, pwz = wz[i] + wx[i] * ang;
        for (let q = 0; q < n; q++) {
          const o = nbr[q], px = x[o] - x[i], pz = z[o] - z[i], rvx = vx[i] - vx[o], rvz = vz[i] - vz[o], R = radius[i] + radius[o], d2 = nd[q];
          let ux, uz;
          if (d2 > R * R) {
            const wX = rvx - invT * px, wZ = rvz - invT * pz, wl2 = wX * wX + wZ * wZ, dot = wX * px + wZ * pz;
            if (dot < 0 && dot * dot > R * R * wl2) {
              const wl = Math.sqrt(wl2) || 1, nx = wX / wl, nz = wZ / wl;
              ldx[q] = nz; ldz[q] = -nx; ux = (R * invT - wl) * nx; uz = (R * invT - wl) * nz;
            } else {
              const leg = Math.sqrt(d2 - R * R);
              if (det(px, pz, wX, wZ) > 0) { ldx[q] = (px * leg - pz * R) / d2; ldz[q] = (px * R + pz * leg) / d2; }
              else { ldx[q] = -(px * leg + pz * R) / d2; ldz[q] = -(-px * R + pz * leg) / d2; }
              const dot2 = rvx * ldx[q] + rvz * ldz[q];
              ux = dot2 * ldx[q] - rvx; uz = dot2 * ldz[q] - rvz;
            }
          } else {
            // already overlapping: apart within this step
            const wX = rvx - invDt * px, wZ = rvz - invDt * pz, wl = Math.hypot(wX, wZ) || 1, nx = wX / wl, nz = wZ / wl;
            ldx[q] = nz; ldz[q] = -nx; ux = (R * invDt - wl) * nx; uz = (R * invDt - wl) * nz;
          }
          const share = state[o] === 6 ? 1 : 0.5;   // a fixed agent does not give way: all of the detour is ours
          lpx[q] = vx[i] + share * ux; lpz[q] = vz[i] + share * uz;
        }
        const fail = lp2(lpx, lpz, ldx, ldz, n, speed[i], pwx, pwz, false);
        if (fail < n) lp3(n, fail, speed[i]);
        nvx[i] = rx; nvz[i] = rz;
      }
      // move, on fit cells
      for (let i = 0; i < high; i++) {
        const s = state[i];
        if (!s || s === 6) continue;
        if (s === 5) {
          const k = link[i], l = k.link, f = Math.min(1, (k.t += dt) / k.T);
          const p = l.traverse ? l.traverse(f, l, crowd.actor(i)) : null;
          const ox = x[i], oz = z[i];
          if (p) { x[i] = p[0]; y[i] = p[1]; z[i] = p[2]; }
          else { x[i] = k.fx + (l.to[0] - k.fx) * f; y[i] = k.fy + (l.to[1] - k.fy) * f + (l.type === 'jump' ? Math.sin(Math.PI * f) * (l.height ?? 0.5) : 0); z[i] = k.fz + (l.to[2] - k.fz) * f; }
          vx[i] = (x[i] - ox) / dt; vz[i] = (z[i] - oz) / dt;
          if (f >= 1) {
            x[i] = l.to[0]; y[i] = l.to[1]; z[i] = l.to[2]; vx[i] = vz[i] = 0; link[i] = null; state[i] = 2;
            const p2 = path[i];
            if (p2 && pidx[i] < p2.length - 1) pidx[i]++; else if (p2) { done[i] = 1; state[i] = 1; }
            crowd.onLink?.(i, l, 'end');
          }
        } else {
          let ax = nvx[i], az = nvz[i];
          a3[0] = x[i]; a3[1] = y[i]; a3[2] = z[i]; vo.radius = radius[i];
          b3[0] = x[i] + ax * dt; b3[1] = y[i]; b3[2] = z[i] + az * dt;
          if (ax || az) {
            if (!nav.visible(a3, b3, vo)) {
              b3[2] = z[i];
              if (ax && nav.visible(a3, b3, vo)) az = 0;
              else { b3[0] = x[i]; b3[2] = z[i] + az * dt; if (az && nav.visible(a3, b3, vo)) ax = 0; else { ax = az = 0; b3[2] = z[i]; } }
            }
            x[i] = b3[0]; z[i] = b3[2];
            const v = nav.nodeAt(x[i], y[i], z[i]);
            if (v >= 0) y[i] = nav.floorOf(v);
          }
          vx[i] = ax; vz[i] = az;
          const sp = Math.hypot(ax, az);
          if (sp > 0.05) { hx[i] = ax / sp; hz[i] = az / sp; }
          // wanting to go and not going for 2 s (a door shut in its face, a jam round a corner): plan again from here
          if (s === 2 && path[i]) { stall[i] = sp < speed[i] * 0.1 ? stall[i] + dt : 0; if (stall[i] > 2) { stall[i] = 0; request(i); } }
        }
        const a = actors[i];
        if (a) { a.pos[0] = x[i]; a.pos[1] = y[i]; a.pos[2] = z[i]; a.heading[0] = hx[i]; a.heading[1] = hz[i]; }
      }
    },
  };
  return crowd;
}
