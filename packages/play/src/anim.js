// Mirage original code.

// ---------------------------------------------------------------------------
// Animation controller: state machines, blend spaces, masked and additive layers, root motion, clip events.
//
//   import { createAnimator } from '@mirage/play';
//   const anim = createAnimator(model, clips, {
//     parameters: { speed: 0, grounded: true, jump: 'trigger', wave: 'trigger' },
//     rootMotion: { bone: 'Root' },
//     layers: [
//       { name: 'base', start: 'move',
//         states: { move: { blend1d: { param: 'speed', points: [[0, 'idle'], [1.5, 'walk'], [4.2, 'run']] } }, jump: { clip: 'jump', loop: false } },
//         transitions: [{ from: '*', to: 'jump', when: ['jump'], duration: 0.1 }, { from: 'jump', to: 'move', exitTime: 0.8, duration: 0.2 }] },
//       { name: 'arm', mask: ['RightArm'], start: 'none',
//         states: { none: {}, wave: { clip: 'wave', loop: false } },
//         transitions: [{ from: 'none', to: 'wave', when: ['wave'], duration: 0.15 }, { from: 'wave', to: 'none', exitTime: 0.85, duration: 0.25 }] },
//       { name: 'lean', additive: true, weight: 0, start: 'lean', states: { lean: { clip: 'lean', loop: false, speed: 0, time: 1 } } },
//     ],
//   });
//   anim.on('footL', (e) => step.play());
//   anim.set('speed', 1.5); anim.trigger('jump');
//   const move = anim.update(dt);          // poses the bones; move = { x, y, z, yaw } travelled by the root bone
//
// Clips are plain THREE.AnimationClips (GLTFLoader's included) whose tracks are `<node>.position|quaternion|scale`.
// They are sampled with three's own interpolants, but blended here rather than by THREE.AnimationMixer: the mixer
// renormalises weights per property, has no per-bone masks, cannot take the root's travel out of a blend, and
// keeps its time in accumulated floats that cannot be scrubbed. Everything below is a pure function of the
// parameter values and the sequence of dt passed to update(): same inputs, same bones, bit for bit; with
// `fixedStep` the result is also independent of how the caller's frames happen to slice the time.
//
// Blending: within a layer, sources are averaged by weight (quaternions on one hemisphere, then normalised).
// Layer 0 fills what nothing animates with the bind pose. Later layers override (or, with `additive`, add their
// offset from each clip's first key) by layer weight x mask weight x how much of the bone their clips cover, so
// a clip that keys only an arm needs no mask to leave the legs alone.
// Blend spaces advance their clips on one shared phase (feet stay in step between walk and run).
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const SIZE = { position: 3, quaternion: 4, scale: 3 };
const Q = THREE.Quaternion;

/** Weights of a 1D blend: `points` = thresholds in ascending order. Linear between neighbours, clamped outside. */
export function blend1d(points, x, out = new Float32Array(points.length)) {
  out.fill(0);
  const n = points.length;
  if (x <= points[0]) { out[0] = 1; return out; }
  if (x >= points[n - 1]) { out[n - 1] = 1; return out; }
  for (let i = 0; i < n - 1; i++) if (x <= points[i + 1]) { const t = (x - points[i]) / (points[i + 1] - points[i]); out[i] = 1 - t; out[i + 1] = t; break; }
  return out;
}

/** Weights of a 2D blend by gradient bands: each sample's influence falls linearly to zero towards every other
 *  sample. 'cartesian' measures in the parameter plane; 'directional' in (speed, angle), which is what keeps a
 *  forward walk out of a blend between strafes at running speed. `points` = [[x, y], ...]. */
export function blend2d(points, x, y, mode = 'cartesian', out = new Float32Array(points.length)) {
  const n = points.length, polar = mode === 'directional', ms = Math.hypot(x, y);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = points[i], mi = Math.hypot(xi, yi);
    let w = 1;
    for (let j = 0; j < n && w > 0; j++) {
      if (j === i) continue;
      const [xj, yj] = points[j];
      let ax, ay, bx, by;
      if (polar) {
        const mj = Math.hypot(xj, yj), avg = (mi + mj) / 2 || 1;
        const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        // a sample at the origin has no direction: it takes the other vector's, so only speed separates them
        let aij = mi && mj ? ang(xi, yi, xj, yj) : 0, ais = mi && ms ? ang(xi, yi, x, y) : 0;
        if (!mi) { aij = 0; ais = 0; } else if (!mj) aij = ais; else if (!ms) ais = aij;
        ax = (mj - mi) / avg; ay = aij * 2; bx = (ms - mi) / avg; by = ais * 2;
      } else { ax = xj - xi; ay = yj - yi; bx = x - xi; by = y - yi; }
      const d = ax * ax + ay * ay;
      if (d > 0) w = Math.min(w, Math.max(0, 1 - (bx * ax + by * ay) / d));
    }
    out[i] = w; total += w;
  }
  if (total > 0) for (let i = 0; i < n; i++) out[i] /= total; else out[0] = 1;
  return out;
}

// 'speed > 0.1', 'grounded', '!grounded', a trigger's name, or a function of the parameter table
function compileCondition(c, triggers) {
  if (typeof c === 'function') return { test: c };
  const m = /^\s*(!)?\s*([\w.]+)\s*(?:(>=|<=|==|!=|>|<)\s*(\S+))?\s*$/.exec(c);
  if (!m) throw new Error(`anim: condition "${c}" not understood`);
  const [, not, name, op, raw] = m;
  if (!op) return triggers.has(name) ? { trigger: name } : { test: (p) => !!p[name] !== !!not };
  const v = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
  const f = { '>': (a) => a > v, '<': (a) => a < v, '>=': (a) => a >= v, '<=': (a) => a <= v, '==': (a) => a === v, '!=': (a) => a !== v }[op];
  return { test: (p) => f(p[name]) };
}

/** A controller posing the nodes under `root` from `clips`. See the header for the options. */
export function createAnimator(root, clips, options = {}) {
  // ---- binding: one slot per animated (node, property), values in flat arrays ------------------------------
  const slots = [], slotOf = new Map(), unbound = new Set();
  let size = 0;
  function slot(trackName) {
    if (slotOf.has(trackName)) return slotOf.get(trackName);
    const dot = trackName.lastIndexOf('.'), prop = trackName.slice(dot + 1), name = trackName.slice(0, dot);
    const node = SIZE[prop] ? (root.name === name ? root : root.getObjectByName(name)) : null;
    let s = null;
    if (node) { s = { node, prop, name, n: SIZE[prop], at: size, index: slots.length, quat: prop === 'quaternion' }; size += s.n; slots.push(s); } else unbound.add(trackName);
    slotOf.set(trackName, s);
    return s;
  }
  const rm = options.rootMotion ? { bone: 'Root', yaw: false, ...options.rootMotion } : null;
  const clipData = new Map();
  for (const clip of clips) {
    const tracks = [];
    for (const track of clip.tracks) {
      const s = slot(track.name);
      if (!s) continue;
      const interp = track.createInterpolant(undefined);
      tracks.push({ s, interp, ref: Float32Array.from(interp.evaluate(0)) });
    }
    const events = [...(clip.userData?.events || []), ...(options.events?.[clip.name] || [])].map((e) => ({ ...e })).sort((a, b) => a.time - b.time);
    const cd = { clip, name: clip.name, duration: Math.max(clip.duration, 1e-6), tracks, events, loop: clip.userData?.loop !== false };
    if (rm) {
      const tp = tracks.find((t) => t.s.name === rm.bone && t.s.prop === 'position'), tq = rm.yaw && tracks.find((t) => t.s.name === rm.bone && t.s.quat);
      const yawOf = (q) => 2 * Math.atan2(q[1], q[3]);
      cd.root = {
        tp, tq,
        pos: (t, o) => { if (tp) { const v = tp.interp.evaluate(t); o[0] = v[0]; o[1] = v[1]; o[2] = v[2]; } else o[0] = o[1] = o[2] = 0; return o; },
        yaw: (t) => (tq ? yawOf(tq.interp.evaluate(t)) : 0),
      };
      const a = cd.root.pos(0, [0, 0, 0]), b = cd.root.pos(cd.duration, [0, 0, 0]);
      cd.root.total = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      let dy = cd.root.yaw(cd.duration) - cd.root.yaw(0); dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
      cd.root.totalYaw = dy;
    }
    clipData.set(clip.name, cd);
  }
  const rest = new Float32Array(size), pose = new Float32Array(size);
  for (const s of slots) s.node[s.prop].toArray(rest, s.at);
  const rootPos = rm && slots.find((s) => s.name === rm.bone && s.prop === 'position'), rootRot = rm && rm.yaw && slots.find((s) => s.name === rm.bone && s.quat);

  // ---- parameters ------------------------------------------------------------------------------------------
  const params = {}, triggers = new Set();
  for (const [k, v] of Object.entries(options.parameters || {})) { if (v === 'trigger') { triggers.add(k); params[k] = false; } else params[k] = v; }

  // ---- layers ----------------------------------------------------------------------------------------------
  const need = (name) => { const cd = clipData.get(name); if (!cd) throw new Error(`anim: no clip "${name}"`); return cd; };
  function compileState(name, def) {
    const st = { name, speed: def.speed ?? 1, speedParam: def.speedParam, start: def.time ?? 0, children: [], kind: 'clip' };
    if (def.blend1d) {
      const pts = [...def.blend1d.points].sort((a, b) => a[0] - b[0]);
      Object.assign(st, { kind: '1d', param: def.blend1d.param, thresholds: pts.map((p) => p[0]), children: pts.map((p) => need(p[1])) });
    } else if (def.blend2d) {
      const b = def.blend2d;
      Object.assign(st, { kind: '2d', x: b.x, y: b.y, mode: b.mode || 'cartesian', points: b.points.map((p) => [p[0], p[1]]), children: b.points.map((p) => need(p[2])) });
    } else if (def.clip) st.children = [need(def.clip)];
    else st.kind = 'empty';
    st.carriers = new Map();   // event name -> the children that carry it
    st.children.forEach((c, i) => { for (const e of c.events) { if (!st.carriers.has(e.name)) st.carriers.set(e.name, []); st.carriers.get(e.name).push(i); } });
    st.loop = def.loop ??(st.children.length ? st.children.every((c) => c.loop) : true);
    return st;
  }
  function maskWeights(mask) {
    const w = new Float32Array(slots.length).fill(mask ? 0 : 1);
    if (!mask) return w;
    const spec = Array.isArray(mask) ? { include: mask } : mask.include || mask.exclude ? mask : { weights: mask };
    const under = (names, v) => { for (const n of names || []) { const o = root.getObjectByName(n); if (!o) throw new Error(`anim: mask bone "${n}" not found`); o.traverse((c) => { for (const s of slots) if (s.node === c) w[s.index] = v; }); } };
    under(spec.include, 1); under(spec.exclude, 0);
    for (const [n, v] of Object.entries(spec.weights || {})) under([n], v);
    return w;
  }
  const layers = (options.layers || []).map((def, li) => {
    const states = Object.fromEntries(Object.entries(def.states || {}).map(([k, v]) => [k, compileState(k, v)]));
    const transitions = (def.transitions || []).map((t) => ({
      from: t.from === '*' || t.from == null ? null : [].concat(t.from), to: t.to, duration: t.duration ?? 0.2, exitTime: t.exitTime, self: !!t.self,
      interrupt: t.interrupt !== false, offset: t.offset ?? 0, when: (t.when || []).map((c) => compileCondition(c, triggers)),
    }));
    for (const t of transitions) if (!states[t.to]) throw new Error(`anim: transition to unknown state "${t.to}"`);
    const start = def.start ?? Object.keys(states)[0];
    if (!states[start]) throw new Error(`anim: layer "${def.name ?? li}" has no state "${start}"`);
    const L = { name: def.name ?? `layer${li}`, index: li, states, transitions, startState: start, weight: def.weight ?? 1, additive: !!def.additive, mask: maskWeights(def.mask),
      acc: new Float32Array(size), wsum: new Float32Array(slots.length), cur: null, fading: [], fadeT: 1, fadeDur: 0, locked: false };
    return L;
  });
  const instance = (L, state, offset = 0) => ({ state, phase: Math.min(Math.max(state.start + offset, 0), 1), elapsed: state.start + offset, done: false, w0: 1,
    bw: new Float32Array(Math.max(1, state.children.length)), prev: 0, wraps: 0 });
  const layerOf = (l) => (typeof l === 'number' ? layers[l] : layers.find((x) => x.name === l)) || (() => { throw new Error(`anim: no layer "${l}"`); })();

  // ---- events ----------------------------------------------------------------------------------------------
  const listeners = new Map();
  const eventWeight = options.eventWeight ?? 0.5;
  function emit(e) {
    for (const k of [e.name, '*']) for (const fn of listeners.get(k) || []) fn(e);
    options.onEvent?.(e);
  }

  // ---- stepping --------------------------------------------------------------------------------------------
  const move = { x: 0, y: 0, z: 0, yaw: 0 }, tmpA = [0, 0, 0], tmpB = [0, 0, 0];
  function blendWeights(inst) {
    const st = inst.state;
    if (st.kind === '1d') blend1d(st.thresholds, params[st.param] ?? 0, inst.bw);
    else if (st.kind === '2d') blend2d(st.points, params[st.x] ?? 0, params[st.y] ?? 0, st.mode, inst.bw);
    else inst.bw[0] = 1;
  }
  function stateDuration(inst) {
    const c = inst.state.children; let d = 0;
    for (let i = 0; i < c.length; i++) d += inst.bw[i] * c[i].duration;
    return d || 1;
  }
  function begin(L, t, state, duration, offset = 0) {
    const s = L.fadeT;   // weights frozen where the interrupted fade stood
    if (L.cur) {
      for (const f of L.fading) f.w0 *= 1 - s;
      L.cur.w0 = L.fading.length ? s : 1; L.fading.push(L.cur);
      emit({ name: 'exit', state: L.cur.state.name, layer: L.name });
    }
    L.cur = instance(L, state, offset); blendWeights(L.cur);
    L.fadeDur = duration; L.fadeT = duration > 0 && L.fading.length ? 0 : 1; L.locked = t ? !t.interrupt : false;
    if (L.fadeT >= 1) L.fading.length = 0;
    emit({ name: 'enter', state: state.name, layer: L.name });
  }
  function advance(L, inst, dt, weight) {
    const st = inst.state;
    blendWeights(inst);
    inst.prev = inst.phase; inst.wraps = 0;
    if (st.kind === 'empty') { inst.elapsed += dt; return; }
    const speed = st.speed * (st.speedParam ? params[st.speedParam] ?? 1 : 1);
    const d = (dt * speed) / stateDuration(inst);
    let p = inst.phase + d;
    inst.elapsed += d;
    if (st.loop) { inst.wraps = Math.floor(p); p -= inst.wraps; } else if (p >= 1) { p = 1; inst.done = true; } else if (p < 0) p = 0;
    inst.phase = p;
    if (d <= 0) return;
    // events: where several blended clips carry one name (foot falls in walk and run), the heaviest of them
    // speaks for the state; two clips' keys never land on quite the same phase, and both would fire
    for (let i = 0; i < st.children.length; i++) {
      const cd = st.children[i], w = weight * inst.bw[i];
      if (weight >= eventWeight && cd.events.length) {
        const t0 = inst.prev * cd.duration, t1 = p * cd.duration;
        for (const e of cd.events) {
          const hit = inst.wraps ? e.time > t0 || e.time <= t1 : e.time > t0 && e.time <= t1;
          if (!hit) continue;
          let best = i;
          for (const j of st.carriers.get(e.name)) if (inst.bw[j] > inst.bw[best] || (inst.bw[j] === inst.bw[best] && j < best)) best = j;
          if (best === i) emit({ ...e, clip: cd.name, state: st.name, layer: L.name, weight: w });
        }
      }
      if (rm && L.index === 0 && w > 0 && cd.root) {
        const r = cd.root, a = r.pos(inst.prev * cd.duration, tmpA), b = r.pos(p * cd.duration, tmpB);
        move.x += w * (b[0] - a[0] + inst.wraps * r.total[0]); move.y += w * (b[1] - a[1] + inst.wraps * r.total[1]); move.z += w * (b[2] - a[2] + inst.wraps * r.total[2]);
        if (r.tq) { let dy = r.yaw(p * cd.duration) - r.yaw(inst.prev * cd.duration); dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI; move.yaw += w * (dy + inst.wraps * r.totalYaw); }
      }
    }
  }
  function step(dt) {
    for (const L of layers) {
      if (!L.cur) begin(L, null, L.states[L.startState], 0);
      const fadingIn = L.fadeT < 1;
      if (!(fadingIn && L.locked)) {
        for (const t of L.transitions) {
          const here = L.cur.state.name;
          if (t.from ? !t.from.includes(here) : here === t.to && !t.self) continue;
          if (t.exitTime != null && L.cur.elapsed < t.exitTime) continue;
          if (!t.when.every((c) => (c.trigger ? params[c.trigger] : c.test(params)))) continue;
          for (const c of t.when) if (c.trigger) params[c.trigger] = false;
          begin(L, t, L.states[t.to], t.duration, t.offset);
          break;
        }
      }
      if (L.fadeT < 1) { L.fadeT = Math.min(1, L.fadeT + dt / L.fadeDur); if (L.fadeT >= 1) L.fading.length = 0; }
      const s = L.fadeT;
      advance(L, L.cur, dt, s);
      for (const f of L.fading) advance(L, f, dt, f.w0 * (1 - s));
    }
  }

  // ---- pose ------------------------------------------------------------------------------------------------
  const qa = new Float32Array(4), qb = new Float32Array(4);
  function accumulate(L, cd, time, w) {
    const { acc, wsum } = L;
    for (const tr of cd.tracks) {
      const s = tr.s, at = s.at;
      let v = tr.interp.evaluate(time);
      if (L.additive) {   // the clip's offset from its first key, re-based on the bind pose
        if (s.quat) { qa[0] = -tr.ref[0]; qa[1] = -tr.ref[1]; qa[2] = -tr.ref[2]; qa[3] = tr.ref[3]; Q.multiplyQuaternionsFlat(qb, 0, qa, 0, v, 0); Q.multiplyQuaternionsFlat(qa, 0, rest, at, qb, 0); v = qa; } else { for (let k = 0; k < s.n; k++) qb[k] = rest[at + k] + v[k] - tr.ref[k]; v = qb; }
      }
      let sign = w;
      if (s.quat && wsum[s.index] > 0 && acc[at] * v[0] + acc[at + 1] * v[1] + acc[at + 2] * v[2] + acc[at + 3] * v[3] < 0) sign = -w;
      for (let k = 0; k < s.n; k++) acc[at + k] += sign * v[k];
      wsum[s.index] += w;
    }
  }
  function layerPose(L) {
    L.acc.fill(0); L.wsum.fill(0);
    if (!L.cur) return;
    const s = L.fadeT;
    const add = (inst, w) => { const c = inst.state.children; for (let i = 0; i < c.length; i++) { const wi = w * inst.bw[i]; if (wi > 1e-6) accumulate(L, c[i], inst.phase * c[i].duration, wi); } };
    add(L.cur, s);
    for (const f of L.fading) add(f, f.w0 * (1 - s));
  }
  function evaluate() {
    for (const L of layers) {
      layerPose(L);
      const { acc, wsum } = L;
      for (const sl of slots) {
        const at = sl.at, n = sl.n, ws = wsum[sl.index];
        if (L.index === 0) {
          // the base layer owns every slot: whatever weight is missing is the bind pose
          const fill = Math.max(0, 1 - ws);
          if (sl.quat) {
            const sg = ws > 0 && acc[at] * rest[at] + acc[at + 1] * rest[at + 1] + acc[at + 2] * rest[at + 2] + acc[at + 3] * rest[at + 3] < 0 ? -fill : fill;
            let len = 0; for (let k = 0; k < 4; k++) { const v = acc[at + k] + sg * rest[at + k]; pose[at + k] = v; len += v * v; }
            len = 1 / Math.sqrt(len || 1); for (let k = 0; k < 4; k++) pose[at + k] *= len;
          } else { const norm = ws > 1 ? 1 / ws : 1; for (let k = 0; k < n; k++) pose[at + k] = (acc[at + k] + fill * rest[at + k]) * norm; }
          continue;
        }
        const f = Math.min(1, ws) * L.weight * L.mask[sl.index];
        if (f <= 1e-6) continue;
        if (sl.quat) {
          let len = 0; for (let k = 0; k < 4; k++) len += acc[at + k] * acc[at + k];
          len = 1 / Math.sqrt(len || 1); for (let k = 0; k < 4; k++) qa[k] = acc[at + k] * len;
          if (L.additive) {   // pose * (rest^-1 * layer), eased in by f
            qb[0] = -rest[at]; qb[1] = -rest[at + 1]; qb[2] = -rest[at + 2]; qb[3] = rest[at + 3];
            Q.multiplyQuaternionsFlat(qa, 0, qb, 0, qa, 0);
            qb[0] = qb[1] = qb[2] = 0; qb[3] = 1; Q.slerpFlat(qa, 0, qb, 0, qa, 0, f);
            Q.multiplyQuaternionsFlat(pose, at, pose, at, qa, 0);
          } else Q.slerpFlat(pose, at, pose, at, qa, 0, f);
        } else {
          const inv = 1 / ws;
          if (L.additive) for (let k = 0; k < n; k++) pose[at + k] += f * (acc[at + k] * inv - rest[at + k]);
          else for (let k = 0; k < n; k++) pose[at + k] += f * (acc[at + k] * inv - pose[at + k]);
        }
      }
    }
    if (!layers.length) pose.set(rest);
    if (rootPos) { const at = rootPos.at; pose[at] = rest[at]; pose[at + 2] = rest[at + 2]; if (rm.y) pose[at + 1] = rest[at + 1]; }
    if (rootRot) {   // take the heading out, keep pitch and roll
      const at = rootRot.at, h = Math.atan2(pose[at + 1], pose[at + 3]);
      qb[0] = 0; qb[1] = -Math.sin(h); qb[2] = 0; qb[3] = Math.cos(h);
      Q.multiplyQuaternionsFlat(pose, at, qb, 0, pose, at);
    }
    write();
  }
  function write() {
    for (const s of slots) s.node[s.prop].fromArray(pose, s.at);
    for (const fn of api.post) fn(api);
  }

  const fixed = options.fixedStep || 0;
  let carry = 0, time = 0, ticks = 0;   // fixed mode counts whole steps, so time does not depend on the frame slicing
  const api = {
    root, parameters: params, clips: clipData, unbound: [...unbound], layers,
    /** functions run after every pose write (IK, look-at): fn(animator) */
    post: [],
    set(name, value) { params[name] = value; return api; },
    get: (name) => params[name],
    trigger(name) { params[name] = true; return api; },
    /** Advance by dt seconds and pose the bones. Returns the root bone's travel in the model's frame (zeros without
     *  rootMotion); the same object every call. */
    update(dt) {
      move.x = move.y = move.z = move.yaw = 0;
      if (fixed) { carry += dt; const n = Math.floor(carry / fixed + 1e-9); carry -= n * fixed; for (let i = 0; i < n; i++) step(fixed); ticks += n; time = ticks * fixed; } else { step(dt); time += dt; }
      evaluate();
      return move;
    },
    /** pose again from the current state without advancing (after changing a layer weight while paused) */
    evaluate,
    get time() { return time; },
    state: (layer = 0) => layerOf(layer).cur?.state.name ?? layerOf(layer).startState,
    /** normalised time in the current state (whole loops included) */
    stateTime: (layer = 0) => layerOf(layer).cur?.elapsed ?? 0,
    transitioning: (layer = 0) => layerOf(layer).fadeT < 1,
    /** force a crossfade to `state`, bypassing conditions */
    play(state, { layer = 0, duration = 0.2, offset = 0 } = {}) {
      const L = layerOf(layer);
      if (!L.states[state]) throw new Error(`anim: no state "${state}"`);
      if (!L.cur) begin(L, null, L.states[L.startState], 0);
      begin(L, null, L.states[state], duration, offset);
      return api;
    },
    setLayerWeight(layer, w) { layerOf(layer).weight = w; return api; },
    /** weights of the current state's clips: [[clip, weight], ...] (blend-space debugging, tests) */
    weights(layer = 0) { const c = layerOf(layer).cur; return c ? c.state.children.map((cd, i) => [cd.name, c.bw[i]]) : []; },
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    /** Pose from one clip at `t` seconds, outside the state machine (timeline scrubbing, thumbnails). */
    poseClip(name, t, weight = 1) {
      const cd = need(name), tt = cd.loop ? ((t % cd.duration) + cd.duration) % cd.duration : Math.min(Math.max(t, 0), cd.duration);
      if (weight >= 1) pose.set(rest);
      for (const tr of cd.tracks) {
        const v = tr.interp.evaluate(tt), at = tr.s.at;
        if (weight >= 1) for (let k = 0; k < tr.s.n; k++) pose[at + k] = v[k];
        else if (tr.s.quat) Q.slerpFlat(pose, at, pose, at, v, 0, weight); else for (let k = 0; k < tr.s.n; k++) pose[at + k] += weight * (v[k] - pose[at + k]);
      }
      if (rootPos) { const at = rootPos.at; pose[at] = rest[at]; pose[at + 2] = rest[at + 2]; }
      write();
      return api;
    },
    /** back to the bind pose and the start states */
    reset() { for (const L of layers) { L.cur = null; L.fading.length = 0; L.fadeT = 1; } for (const k of triggers) params[k] = false; carry = 0; time = 0; ticks = 0; pose.set(rest); write(); return api; },
    /** The whole playback state as plain data; restore() of it continues bit-identically. */
    snapshot() {
      const inst = (i) => ({ state: i.state.name, phase: i.phase, elapsed: i.elapsed, done: i.done, w0: i.w0 });
      return { time, carry, ticks, params: { ...params }, layers: layers.map((L) => ({ weight: L.weight, fadeT: L.fadeT, fadeDur: L.fadeDur, locked: L.locked, cur: L.cur && inst(L.cur), fading: L.fading.map(inst) })) };
    },
    restore(s) {
      time = s.time; carry = s.carry; ticks = s.ticks || 0; Object.assign(params, s.params);
      s.layers.forEach((d, i) => {
        const L = layers[i], make = (x) => { const n = instance(L, L.states[x.state]); Object.assign(n, { phase: x.phase, elapsed: x.elapsed, done: x.done, w0: x.w0 }); blendWeights(n); return n; };
        Object.assign(L, { weight: d.weight, fadeT: d.fadeT, fadeDur: d.fadeDur, locked: d.locked, cur: d.cur && make(d.cur), fading: d.fading.map(make) });
      });
      evaluate();
      return api;
    },
    /** the final pose as flat numbers (tests compare these) */
    pose: () => pose,
  };
  return api;
}

/** Root motion as walker input: w.update(dt, rootMotionInput(move, figure.rotation.y, body, dt)) moves the walker
 *  exactly as far as the clips travelled (the walker multiplies its input by speed x dt and does not clamp it). */
export function rootMotionInput(move, heading, body, dt, out = {}) {
  const c = Math.cos(heading), s = Math.sin(heading), k = dt > 0 ? 1 / (body.walk * dt) : 0;
  out.x = (move.x * c + move.z * s) * k; out.z = (-move.x * s + move.z * c) * k; out.run = false;
  return out;
}
