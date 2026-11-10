// Mirage original code.
// ---------------------------------------------------------------------------
// NPC brains: a behaviour tree with a blackboard, senses (sight cones the walk grid occludes, noises), and the
// behaviours most games start from. No three import; drives anything with { pos, heading, moveTo, stop, arrived }
// (crowd.actor(i), or agentActor(createNavAgent(...))).
//
//   const senses = createSenses(space);                         // the walk grid (with or without solids)
//   const brain = createBehaviorTree(guard({ points }), {
//     actor: crowd.actor(i), nav, senses,
//     perception: { targets: () => [player], range: 14, fov: 110, memory: 1 } });
//   each step: senses.update(dt); brain.tick(dt);               // -> 'running' | 'success' | 'failure'
//   senses.noise(pos, { radius: 9, tag: 'step', source: player });
//   brain.blackboard.get('target'), brain.describe() (the tree with each node's last status), brain.active()
//
// Nodes (bt.*): sequence (remembers the running child), selector (asks again from the first child every tick, so a
// higher branch interrupts a lower one; the interrupted branch is reset), parallel, invert, succeed, repeat,
// cooldown, timeout, wait, condition(name, (ctx) => bool), action(name, (ctx, dt) => status, onAbort).
// ctx: { bb, actor, nav, senses, time, dt }. Perception (optional, before each tick) writes the blackboard:
//   target (who is seen, kept `memory` seconds after losing sight), lastKnown ([x, y, z]: where it was when
//   forgotten; stays until investigate() deletes it), heard ([x, y, z] of the best noise).
// Behaviours: patrol(points), chase(), flee(), investigate(), follow(), and guard(): chase what it sees, go and
// look where it last saw or heard something, else patrol.
// ponytail: sight is two rays (head and chest) marched through the grid, so what the walk grid does not hold
// (foliage, glass, thin rails) neither hides nor reveals; hearing is distance with one occlusion test, no
// propagation round corners; no utility scoring, no planner (GOAP / HTN), no editor for trees.
// ---------------------------------------------------------------------------
import { gridRay } from './solids.js';

export const SUCCESS = 'success', FAILURE = 'failure', RUNNING = 'running';

function node(type, name, children, run, abort) {
  const n = { type, name: name || type, children, status: null };
  n.tick = (ctx, dt) => (n.status = run(ctx, dt, n));
  /** forget where it was (an interrupted branch): running actions get their abort */
  n.reset = (ctx) => { if (n.status === RUNNING && abort) abort(ctx, n); n.status = null; n.at = 0; n.t = 0; for (const c of children) c.reset(ctx); };
  n.at = 0; n.t = 0;
  return n;
}
export const bt = {
  sequence: (...c) => node('sequence', '', c, (ctx, dt, n) => {
    for (; n.at < c.length; n.at++) { const s = c[n.at].tick(ctx, dt); if (s === RUNNING) return RUNNING; if (s === FAILURE) { n.at = 0; return FAILURE; } }
    n.at = 0; return SUCCESS;
  }),
  selector: (...c) => node('selector', '', c, (ctx, dt, n) => {
    for (let i = 0; i < c.length; i++) {
      const s = c[i].tick(ctx, dt);
      if (s === FAILURE) continue;
      // a branch before the one that was running took over: the old one stops what it was doing
      for (let j = i + 1; j < c.length; j++) if (c[j].status !== null) c[j].reset(ctx);
      return s;
    }
    return FAILURE;
  }),
  /** all children every tick; success when `need` succeeded (default all), failure when that cannot happen any more */
  parallel: (need, ...c) => { if (typeof need !== 'number') { c.unshift(need); need = c.length; } return node('parallel', '', c, (ctx, dt) => { let ok = 0, bad = 0; for (const k of c) { const s = k.tick(ctx, dt); if (s === SUCCESS) ok++; else if (s === FAILURE) bad++; } return ok >= need ? SUCCESS : bad > c.length - need ? FAILURE : RUNNING; }); },
  invert: (c) => node('invert', '', [c], (ctx, dt) => { const s = c.tick(ctx, dt); return s === RUNNING ? RUNNING : s === SUCCESS ? FAILURE : SUCCESS; }),
  succeed: (c) => node('succeed', '', [c], (ctx, dt) => (c.tick(ctx, dt) === RUNNING ? RUNNING : SUCCESS)),
  /** again and again (`times` successes, default for ever); a failure ends it */
  repeat: (c, times = Infinity) => node('repeat', '', [c], (ctx, dt, n) => { const s = c.tick(ctx, dt); if (s === FAILURE) { n.at = 0; return FAILURE; } if (s === SUCCESS && ++n.at >= times) { n.at = 0; return SUCCESS; } return RUNNING; }),
  /** after the child ends, fails for `seconds` without asking it */
  cooldown: (seconds, c) => node('cooldown', '', [c], (ctx, dt, n) => { if (ctx.time < n.t) return FAILURE; const s = c.tick(ctx, dt); if (s !== RUNNING) n.t = ctx.time + seconds; return s; }),
  /** fails (and resets the child) when it runs longer than `seconds` */
  timeout: (seconds, c) => node('timeout', '', [c], (ctx, dt, n) => { n.t += dt; const s = c.tick(ctx, dt); if (s !== RUNNING) { n.t = 0; return s; } if (n.t > seconds) { c.reset(ctx); n.t = 0; return FAILURE; } return RUNNING; }),
  wait: (seconds) => node('wait', `wait ${seconds}`, [], (ctx, dt, n) => { n.t += dt; if (n.t >= seconds) { n.t = 0; return SUCCESS; } return RUNNING; }),
  condition: (name, fn) => node('condition', name, [], (ctx) => (fn(ctx) ? SUCCESS : FAILURE)),
  action: (name, fn, onAbort) => node('action', name, [], (ctx, dt, n) => fn(ctx, dt, n) || SUCCESS, onAbort),
};

/** key -> value with the time each was written (blackboard.age(key)) and change listeners */
export function createBlackboard(init = {}) {
  const data = new Map(Object.entries(init)), stamp = new Map(), fns = [];
  const bb = {
    time: 0, data,
    get: (k, d) => (data.has(k) ? data.get(k) : d),
    has: (k) => data.has(k),
    set(k, v) { const old = data.get(k); data.set(k, v); stamp.set(k, bb.time); if (old !== v) for (const f of fns) f(k, v, old); return v; },
    delete(k) { if (!data.has(k)) return false; const old = data.get(k); data.delete(k); stamp.delete(k); for (const f of fns) f(k, undefined, old); return true; },
    /** seconds since the key was written (Infinity: never) */
    age: (k) => (stamp.has(k) ? bb.time - stamp.get(k) : Infinity),
    onChange(f) { fns.push(f); return () => { const i = fns.indexOf(f); if (i >= 0) fns.splice(i, 1); }; },
    toJSON: () => Object.fromEntries(data),
  };
  return bb;
}

const posOf = (t) => (Array.isArray(t) || ArrayBuffer.isView(t) ? t : t.pos);

/** sight and hearing over a walk grid */
export function createSenses(grid, { ttl = 0.6 } = {}) {
  const a = [0, 0, 0], b = [0, 0, 0], noises = [];
  const senses = {
    time: 0, noises, rays: 0,
    /** observer { pos, heading: [x, z] } sees target ({ pos } or [x, y, z]): in range, inside the cone (or within
     *  `near` whatever the angle), and the grid lets a ray from the eye reach its head or chest */
    sees(o, target, { range = 15, fov = 110, near = 1.2, eye = 1.6, height = 1.5 } = {}) {
      const p = posOf(target), dx = p[0] - o.pos[0], dz = p[2] - o.pos[2], d = Math.hypot(dx, dz);
      if (d > range || Math.abs(p[1] - o.pos[1]) > range) return false;
      if (d > near) { const h = o.heading; if ((dx * h[0] + dz * h[1]) / d < Math.cos((fov * Math.PI) / 360)) return false; }
      a[0] = o.pos[0]; a[1] = o.pos[1] + eye; a[2] = o.pos[2];
      b[0] = p[0]; b[2] = p[2];
      for (const f of [1, 0.6]) { b[1] = p[1] + height * f; senses.rays++; if (gridRay(grid, a, b) === 1) return true; }
      return false;
    },
    /** a sound: { radius (metres it carries), tag, source (who made it: never hears itself) } */
    noise(pos, { radius = 8, tag = 'noise', source = null } = {}) { const n = { pos: [pos[0], pos[1], pos[2]], radius, tag, source, time: senses.time }; noises.push(n); return n; },
    /** the noise the observer hears best right now (nearest relative to how far it carries), or null; a wall
     *  between halves how far it carries (`muffle`) */
    hears(o, { hearing = 1, muffle = 0.5, ear = 1.5, tag } = {}) {
      let best = null, bs = 1;
      for (const n of noises) {
        if (n.source === o || (tag && n.tag !== tag)) continue;
        const d = Math.hypot(n.pos[0] - o.pos[0], n.pos[1] - o.pos[1], n.pos[2] - o.pos[2]);
        let r = n.radius * hearing;
        if (d >= r) continue;
        if (muffle < 1) { a[0] = o.pos[0]; a[1] = o.pos[1] + ear; a[2] = o.pos[2]; b[0] = n.pos[0]; b[1] = n.pos[1] + 1; b[2] = n.pos[2]; senses.rays++; if (gridRay(grid, a, b) < 1) r *= muffle; }
        if (d < r && d / r < bs) { bs = d / r; best = n; }
      }
      return best;
    },
    /** age the noises (each lives `ttl` seconds: long enough for every brain to tick once) */
    update(dt) { senses.time += dt; for (let i = noises.length - 1; i >= 0; i--) if (senses.time - noises[i].time > ttl) noises.splice(i, 1); },
  };
  return senses;
}

/** createNavAgent's agent as an actor for the behaviours */
export function agentActor(agent) {
  return { agent, get pos() { return agent.pos; }, get heading() { return agent.heading; }, radius: agent.radius,
    moveTo: (p) => agent.setGoal(p), stop: () => agent.stop(), get arrived() { return agent.arrived; }, get moving() { return agent.moving; },
    get speed() { return agent.walker.body.walk; }, set speed(v) { agent.walker.body.walk = agent.walker.body.run = v; } };
}

export function createBehaviorTree(root, { blackboard = createBlackboard(), actor = null, nav = null, senses = null, perception = null, ...rest } = {}) {
  const ctx = { ...rest, bb: blackboard, actor, nav, senses, time: 0, dt: 0 };
  const P = perception && { range: 15, fov: 110, memory: 1, hearing: 1, every: 0.1, ...perception };
  let pt = 0, sawAt = -Infinity;
  function perceive(dt) {
    pt -= dt;
    if (pt > 0) return;
    pt = P.every;
    const bb = blackboard;
    let seen = null, bd = Infinity;
    for (const t of P.targets ? P.targets(ctx) : []) {
      if (!t || t === actor || !senses.sees(actor, t, P)) continue;
      const p = posOf(t), d = Math.hypot(p[0] - actor.pos[0], p[2] - actor.pos[2]);
      if (d < bd) { bd = d; seen = t; }
    }
    // out of sight the target stays known for `memory` seconds (it is still chased, round the corner it went);
    // after that only the place is left, until a behaviour (investigate) forgets it
    if (seen) { bb.set('target', seen); sawAt = ctx.time; }
    else if (bb.has('target') && ctx.time - sawAt > P.memory) bb.delete('target');
    const t = bb.get('target');
    if (t) { const p = posOf(t); bb.set('lastKnown', [p[0], p[1], p[2]]); }
    const n = P.hearing > 0 ? senses.hears(actor, P) : null;
    if (n) bb.set('heard', n.pos.slice());
  }
  const tree = {
    root, blackboard, ctx, status: null,
    tick(dt) {
      ctx.dt = dt; ctx.time += dt; blackboard.time = ctx.time;
      if (P && senses && actor) perceive(dt);
      tree.status = root.tick(ctx, dt);
      return tree.status;
    },
    reset() { root.reset(ctx); },
    /** the names of the running leaves, e.g. ['chase'] */
    active() { const out = []; (function walk(n) { if (n.status !== RUNNING) return; if (!n.children.length) out.push(n.name); n.children.forEach(walk); })(root); return out; },
    /** the tree as text, one node a line, with what each returned last tick */
    describe() { const out = []; (function walk(n, d) { out.push(`${'  '.repeat(d)}${n.status === RUNNING ? '>' : n.status === SUCCESS ? '+' : n.status === FAILURE ? '-' : ' '} ${n.name}`); n.children.forEach((c) => walk(c, d + 1)); })(root, 0); return out.join('\n'); },
  };
  return tree;
}

// ---- ready behaviours (each a node; state lives in the node, so make one per brain) ----
const dist2 = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);
// A selector learns that a higher branch takes over only by ticking it, so the interrupted branch is aborted after
// the new one has already sent the actor somewhere: an abort stops the actor only if its own order is still the last.
const halt = (actor, node) => { if (actor.driver === node) { actor.stop(); actor.driver = null; } };
/** walk to where `where(ctx)` points, asking for a new path when it has moved `slack` metres; success within `reach` */
function goTo(name, where, { reach = 0.6, slack = 0.75, speed } = {}) {
  let asked = null, was;
  const me = bt.action(name, (ctx) => {
    const p = where(ctx), a = ctx.actor;
    if (!p) return FAILURE;
    if (dist2(a.pos, p) <= reach && Math.abs(a.pos[1] - p[1]) < 1.5) { a.stop(); asked = null; if (was !== undefined) { a.speed = was; was = undefined; } return SUCCESS; }
    if (asked && a.arrived && dist2(asked, p) <= slack) { asked = null; return FAILURE; }   // as near as the floor allows, and not there
    if (!asked || dist2(asked, p) > slack) {
      if (speed && was === undefined) { was = a.speed; a.speed = speed; }
      asked = [p[0], p[1], p[2]];
      a.driver = me;
      if (a.moveTo(asked) === false) { asked = null; return FAILURE; }
    }
    if (a.noPath) { asked = null; return FAILURE; }
    return RUNNING;
  }, (ctx) => { halt(ctx.actor, me); asked = null; if (was !== undefined) { ctx.actor.speed = was; was = undefined; } });
  return me;
}

/** round the points for ever, waiting `wait` seconds at each */
export function patrol(points, { wait = 1, reach = 0.5 } = {}) {
  let i = 0;
  const n = bt.repeat(bt.sequence(goTo('patrol', () => points[i], { reach }), bt.wait(wait), bt.action('next point', () => { i = (i + 1) % points.length; return SUCCESS; })));
  n.name = 'patrol';
  return n;
}
/** run after blackboard[key] (an actor, { pos }); success within `reach`, failure when the key is empty */
export function chase({ key = 'target', reach = 1.2, speed } = {}) { return goTo('chase', (ctx) => { const t = ctx.bb.get(key); return t ? posOf(t) : null; }, { reach, speed, slack: 0.5 }); }
/** go to blackboard[key] ([x, y, z]), look about for `wait` seconds, then forget it */
export function investigate({ key = 'lastKnown', wait = 2, reach = 0.8 } = {}) {
  const n = bt.sequence(bt.condition(`has ${key}`, (ctx) => ctx.bb.has(key)), bt.succeed(bt.timeout(12, goTo('investigate', (ctx) => ctx.bb.get(key), { reach }))), bt.wait(wait), bt.action(`forget ${key}`, (ctx) => { ctx.bb.delete(key); return SUCCESS; }));
  n.name = `investigate ${key}`;
  return n;
}
/** keep within `distance` of blackboard[key] (running while there is one) */
export function follow({ key = 'leader', distance = 2 } = {}) {
  let going = false;
  const me = bt.action('follow', (ctx) => {
    const t = ctx.bb.get(key), a = ctx.actor;
    if (!t) return FAILURE;
    const p = posOf(t), d = dist2(a.pos, p);
    if (d > distance + 0.6 || (going && d > distance)) { if (!going || ctx.time - (a._asked || 0) > 0.4) { a.driver = me; a.moveTo([p[0], p[1], p[2]]); a._asked = ctx.time; } going = true; }
    else if (going) { a.stop(); going = false; }
    return RUNNING;
  }, (ctx) => { halt(ctx.actor, me); going = false; });
  return me;
}
/** get `distance` metres from blackboard[key]: the reachable spot (ctx.nav) farthest from it of 12 round the actor */
export function flee({ key = 'threat', distance = 8, speed } = {}) {
  let to = null, was;
  const end = (a) => { to = null; if (was !== undefined) { a.speed = was; was = undefined; } };
  const me = bt.action('flee', (ctx) => {
    const t = ctx.bb.get(key), a = ctx.actor;
    if (!t) { end(a); return FAILURE; }
    const p = posOf(t);
    if (dist2(a.pos, p) >= distance) { a.stop(); end(a); return SUCCESS; }
    if (!to || a.arrived || a.noPath || dist2(to, p) < distance * 0.5) {
      let best = null, bs = -Infinity;
      for (let q = 0; q < 12; q++) {
        const ang = (q / 12) * Math.PI * 2, c = [a.pos[0] + Math.cos(ang) * distance, a.pos[1], a.pos[2] + Math.sin(ang) * distance];
        const s = ctx.nav ? ctx.nav.nearest(c, { radius: a.radius, snap: 1.5 }) : c;
        if (!s) continue;
        const score = dist2(s, p) - 0.25 * dist2(s, a.pos);
        if (score > bs) { bs = score; best = s; }
      }
      if (!best) return FAILURE;
      if (speed && was === undefined) { was = a.speed; a.speed = speed; }
      to = best; a.driver = me; a.moveTo(to);
    }
    return RUNNING;
  }, (ctx) => { halt(ctx.actor, me); end(ctx.actor); });
  return me;
}
/** the usual sentry: chase what it sees, look where it last saw or heard something, otherwise patrol */
export function guard({ points, reach = 1.2, chaseSpeed, wait = 1, onCatch } = {}) {
  return bt.selector(
    bt.sequence(bt.condition('sees target', (ctx) => ctx.bb.has('target')), chase({ reach, speed: chaseSpeed }), bt.action('caught', (ctx) => { onCatch?.(ctx); return SUCCESS; })),
    investigate({ key: 'lastKnown' }),
    investigate({ key: 'heard' }),
    points && points.length ? patrol(points, { wait }) : bt.wait(1));
}
