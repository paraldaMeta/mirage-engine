// Mirage original code. Things to do with your hands in XR: grab (near, or far along the ray), throw, hold with two
// hands (turn and scale), snap zones, poke buttons, and canvas UI panels (@mirage/game ui-canvas) by ray and by poke.
// It knows nothing of WebXR: it is fed "pointers" (a grip pose, a ray, a fingertip, grab / select flags), which
// createXR builds from controllers and tracked hands, and a test can build from numbers.
// ---------------------------------------------------------------------------
// const ix = createXRInteraction({ physics: g.physics });          // physics (optional): @mirage/game createPhysics
// const xr = createXR(play, { interact: ix });                     // createXR feeds it every frame
// ix.grabbable(mesh, { body: phys.body(mesh, { mass: 2 }) });      // near grab within reach, else along the ray;
//                                                                  // thrown with the hand's velocity on release
// ix.grabbable(statue, { twoHanded: true, scale: [0.5, 2] });      // a second hand turns and scales it
// ix.snapZone({ position: [1, 0.9, 2], radius: 0.15, onSnap: (obj) => {} });   // released near it, the object seats
// ix.pokeable(button, { radius: 0.03, onPress: () => {} });        // a fingertip (or controller tip) presses it
// ix.panel(screen, screen.mesh({ width: 0.6 }));                   // ui-canvas panel: ray + trigger / pinch, or poke
// low level: ix.update(dt, [{ id, grip: Matrix4, origin: Vector3, dir: Vector3, tip: Vector3, grab, select, pulse(v, ms) }])
// ---------------------------------------------------------------------------
// With a Rapier body (physics.js's handle or a RigidBody) the held object is kinematic (it pushes what it touches;
// it is not stopped by walls) and becomes dynamic again on release with the hand's linear and angular velocity
// (mean over the last 0.1 s). Without physics a released object flies a ballistic arc down to `ground(x, z)`.
// ponytail: no physical hands (a held object passes through walls), no joint-based grab, no hover highlight (the
// onHover callback is the hook), one pointer drives a panel at a time, no multi-object grab, no sockets with poses
// per object type. Scaling is off for objects with a body (the collider would not follow).
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = new THREE.Vector3(), _p2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** The hand's velocity for a throw: poses over the last `window` s -> linear (m/s) and angular (rad/s, world axis). */
export function createVelocityTracker(window = 0.1, cap = 24) {
  const d = new Float64Array(cap * 8);
  let n = 0, k = 0;
  return {
    reset() { n = 0; k = 0; },
    push(t, p, q) { const i = k * 8; d[i] = t; d[i + 1] = p.x; d[i + 2] = p.y; d[i + 3] = p.z; d[i + 4] = q.x; d[i + 5] = q.y; d[i + 6] = q.z; d[i + 7] = q.w; k = (k + 1) % cap; n = Math.min(cap, n + 1); },
    /** into lin and ang (Vector3); false (and zeros) with less than two samples */
    read(lin, ang) {
      lin.set(0, 0, 0); ang.set(0, 0, 0);
      if (n < 2) return false;
      const last = ((k - 1 + cap) % cap) * 8, t1 = d[last];
      let first = last;
      for (let j = 1; j < n; j++) { const i = ((k - 1 - j + cap * 2) % cap) * 8; if (t1 - d[i] > window) break; first = i; }
      const dt = t1 - d[first];
      if (first === last || dt < 1e-4) return false;
      lin.set((d[last + 1] - d[first + 1]) / dt, (d[last + 2] - d[first + 2]) / dt, (d[last + 3] - d[first + 3]) / dt);
      _q.set(d[last + 4], d[last + 5], d[last + 6], d[last + 7]); _q2.set(-d[first + 4], -d[first + 5], -d[first + 6], d[first + 7]);
      _q.multiply(_q2);   // the turn from first to last, in the world
      if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
      const sh = Math.hypot(_q.x, _q.y, _q.z);
      if (sh > 1e-6) { const w = (2 * Math.atan2(sh, _q.w)) / dt / sh; ang.set(_q.x * w, _q.y * w, _q.z * w); }
      return true;
    },
  };
}

/** Two hands on one object: hands at a0, b0 when the second took hold, at a1, b1 now. Writes into `out` (Matrix4) the
 *  world transform that takes the object's matrix at the start to now: about the hands' midpoint, turned by the
 *  change of the hand-to-hand direction (the shortest arc: no roll about that axis), scaled by the change of their
 *  distance clamped to range [min, max] x `scale0` (the object's scale then). Returns the scale factor applied. */
export function twoHandTransform(a0, b0, a1, b1, out, range = null, scale0 = 1) {
  const d0 = _a.subVectors(b0, a0), d1 = _b.subVectors(b1, a1), l0 = d0.length() || 1e-6, l1 = d1.length() || 1e-6;
  let s = l1 / l0;
  if (range) s = Math.min(range[1], Math.max(range[0], s * scale0)) / scale0; else s = 1;
  _q.setFromUnitVectors(d0.multiplyScalar(1 / l0), d1.multiplyScalar(1 / l1));
  _p.addVectors(a1, b1).multiplyScalar(0.5); _p2.addVectors(a0, b0).multiplyScalar(-0.5);
  out.compose(_p, _q, _s.setScalar(s)).multiply(_m2.makeTranslation(_p2.x, _p2.y, _p2.z));
  return s;
}

/** A fingertip against a panel of w x h m that faces +z (ui-canvas's mesh): `l` is the tip in the panel's space.
 *  -> st { over, u, v (0..1 from the top left), down }: over within `hover` m in front; pressed once the tip is
 *  through the surface (z < press), released when it is back past `release` (hysteresis: no chatter at the surface)
 *  or further than `back` behind it (a hand that came from behind is not a press). */
export function pokeTest(l, w, h, st, c = POKE) {
  const u = l.x / w + 0.5, v = 0.5 - l.y / h;
  st.over = u >= 0 && u <= 1 && v >= 0 && v <= 1 && l.z < c.hover && l.z > -c.back;
  st.u = u; st.v = v;
  st.down = st.over && (st.down ? l.z < c.release : l.z < c.press && st.front);
  st.front = st.over ? l.z >= c.press || st.down : l.z >= c.press;   // it has to come from the front
  return st;
}
export const POKE = { hover: 0.08, press: 0.004, release: 0.012, back: 0.05 };

const bodyOf = (b) => (b && b.body && typeof b.body.setBodyType === 'function' ? b.body : b && typeof b.setBodyType === 'function' ? b : null);
const DYNAMIC = 0, KINEMATIC = 2;   // Rapier's RigidBodyType

export function createXRInteraction(opts = {}) {
  const o = { physics: null, reach: 0.1, rayReach: 6, ray: true, gravity: 9.81, ground: null, throwScale: 1, window: 0.1, ...opts };
  const items = [], zones = [], panels = [], pokes = [], states = new Map();
  const rc = new THREE.Raycaster(), hits = [], lin = new THREE.Vector3(), ang = new THREE.Vector3();
  const stats = { grabs: 0, throws: 0, snaps: 0, presses: 0, pulses: 0 };
  let time = 0, last = [];
  const stateOf = (id) => {
    let s = states.get(id);
    if (!s) states.set(id, s = { id, hover: null, far: false, held: null, local: new THREE.Matrix4(), grip: new THREE.Matrix4(), pos: new THREE.Vector3(), wasGrab: false, ui: false, pulse: null });
    return s;
  };
  const pulse = (s, v, ms) => { stats.pulses++; if (s && s.pulse) s.pulse(v, ms); };
  const worldPos = (it, out) => out.setFromMatrixPosition(it.obj.matrixWorld);

  // the object's world matrix -> its local transform, the body's next pose, the throw tracker
  function write(it, M) {
    M.decompose(_p, _q, _s);
    it.tracker.push(time, _p, _q);
    const b = it.body;
    if (b) { b.setNextKinematicTranslation(_p); b.setNextKinematicRotation(_q); }
    const par = it.obj.parent;
    if (par && par.parent) { par.updateWorldMatrix(true, false); _m2.copy(par.matrixWorld).invert().multiply(M).decompose(it.obj.position, it.obj.quaternion, it.obj.scale); }
    else { it.obj.position.copy(_p); it.obj.quaternion.copy(_q); it.obj.scale.copy(_s); }
    it.obj.updateMatrixWorld(true);
  }

  function take(s, it) {
    if (it.zone) { const z = it.zone; z.item = null; it.zone = null; if (z.onUnsnap) z.onUnsnap(it.obj, z); }
    it.fly = null;
    it.obj.updateWorldMatrix(true, false);
    if (it.holders.length === 1 && it.twoHanded) {   // the second hand: turn and scale from here
      const first = states.get(it.holders[0]);
      it.two = { a0: first.pos.clone(), b0: s.pos.clone(), M0: it.obj.matrixWorld.clone(), s0: it.obj.scale.x };
      it.holders.push(s.id);
    } else {
      if (it.holders.length) { const other = states.get(it.holders[0]); other.held = null; it.holders.length = 0; it.two = null; }   // taken from the other hand
      else { it.tracker.reset(); if (it.body) it.body.setBodyType(KINEMATIC, true); }
      it.holders.push(s.id);
      s.local.copy(s.grip).invert().multiply(it.obj.matrixWorld);
    }
    s.held = it; s.hover = null; stats.grabs++;
    pulse(s, 0.5, 30);
    if (it.onGrab) it.onGrab(it.obj, s.id, it.holders.length);
  }

  function drop(s) {
    const it = s.held;
    s.held = null;
    it.holders.splice(it.holders.indexOf(s.id), 1);
    if (it.holders.length) {   // the other hand keeps it: it holds from where the object is now
      const other = states.get(it.holders[0]);
      it.two = null;
      it.obj.updateWorldMatrix(true, false);
      other.local.copy(other.grip).invert().multiply(it.obj.matrixWorld);
      if (it.onRelease) it.onRelease(it.obj, s.id, 1);
      return;
    }
    it.two = null;
    it.tracker.read(lin, ang); lin.multiplyScalar(o.throwScale);
    // a snap zone in reach takes it
    worldPos(it, _p);
    let zone = null, zd = Infinity;
    for (const z of zones) {
      if (z.item || (z.accepts && !z.accepts(it.obj))) continue;
      const d = z.where(_p2).distanceTo(_p);
      if (d < z.radius && d < zd) { zone = z; zd = d; }
    }
    if (zone) {
      zone.where(_p2); zone.facing(_q2);
      _m.compose(_p2, _q2, it.obj.getWorldScale(_s));
      write(it, _m);
      if (it.body) { it.body.setTranslation(_p2, true); it.body.setRotation(_q2, true); }
      it.zone = zone; zone.item = it; stats.snaps++;
      pulse(s, 0.7, 40);
      if (zone.onSnap) zone.onSnap(it.obj, zone);
    } else if (it.body) {
      it.body.setBodyType(DYNAMIC, true);
      it.body.setLinvel(lin, true); it.body.setAngvel(ang, true);
      stats.throws++;
    } else { it.fly = { v: lin.clone(), w: ang.clone() }; stats.throws++; }
    if (it.onRelease) it.onRelease(it.obj, s.id, 0, lin, ang);
  }

  function hoverOf(p, s) {
    let best = null, bd = Infinity;
    for (const it of items) {
      if (it.holders.length === 2 || it.holders[0] === s.id) continue;   // held by the other hand: a second hold, or a hand-over
      const d = worldPos(it, _p).distanceTo(s.pos) - it.radius;
      if (d < o.reach && d < bd) { best = it; bd = d; }
    }
    s.far = false;
    if (best || !o.ray || !p.origin || !p.dir || s.ui) return best;
    rc.set(p.origin, p.dir); rc.near = 0; rc.far = o.rayReach;
    for (const it of items) {
      if (!it.ray || it.holders.length) continue;
      hits.length = 0; rc.intersectObject(it.obj, true, hits);
      if (hits.length && hits[0].distance < bd) { best = it; bd = hits[0].distance; s.far = true; }
    }
    return best;
  }

  function stepPanels(pointers) {
    for (const pn of panels) {
      const { ui, mesh } = pn;
      if (!mesh.visible || !mesh.parent) continue;
      mesh.updateWorldMatrix(true, false);
      _m.copy(mesh.matrixWorld).invert();
      const g = mesh.geometry.parameters, sx = mesh.scale.x || 1;
      let done = false;
      if (pn.poke) for (const p of pointers) {
        if (!p.tip) continue;
        const st = pn.pokes.get(p.id) || pn.pokes.set(p.id, { over: false, down: false, front: false, u: 0, v: 0 }).get(p.id), was = st.down;
        pokeTest(_p.copy(p.tip).applyMatrix4(_m).multiply(_s.set(1, 1, sx)), g.width, g.height, st);   // z back in metres
        if (!st.over || done) continue;
        ui.pointer(st.u, st.v, st.down);
        const s = stateOf(p.id); s.ui = true; done = true; pn.by = 'poke';
        if (st.down && !was) { stats.presses++; pulse(s, 0.4, 15); }
      }
      if (!done && pn.ray) for (const p of pointers) {
        const s = stateOf(p.id);
        if (!p.origin || !p.dir || s.held) continue;
        rc.set(p.origin, p.dir); rc.near = 0; rc.far = o.rayReach;
        hits.length = 0; rc.intersectObject(mesh, false, hits);
        if (!hits.length) continue;   // not ui.raycast: its miss is a pointer-leave, which would cancel the other hand's press
        ui.pointerUV(hits[0].uv, !!p.select);
        s.ui = true; done = true; pn.by = 'ray';
        if (p.select && !pn.wasSelect) { stats.presses++; pulse(s, 0.3, 15); }
        pn.wasSelect = !!p.select;
        break;
      }
      if (!done) { ui.pointer(-1, -1, false); pn.by = null; pn.wasSelect = false; }
      ui.update();
    }
    for (const k of pokes) {
      if (!k.obj.visible) continue;
      k.obj.getWorldPosition(_p);
      let inside = null;
      for (const p of pointers) if (p.tip && p.tip.distanceTo(_p) < k.radius) { inside = p; break; }
      if (inside && !k.pressed) { stats.presses++; const s = stateOf(inside.id); s.ui = true; pulse(s, 0.5, 20); if (k.onPress) k.onPress(k.obj, inside.id); }
      else if (!inside && k.pressed && k.onRelease) k.onRelease(k.obj);
      k.pressed = !!inside;
    }
  }

  /** One frame. pointers: [{ id, grip (Matrix4, world), origin, dir (Vector3, world: the ray; optional), tip (Vector3,
   *  world: the poking point; optional), grab, select (booleans), pulse(strength, ms) (optional) }] */
  function update(dt, pointers) {
    time += dt; last = pointers;
    for (const p of pointers) { const s = stateOf(p.id); s.grip.copy(p.grip); s.pos.setFromMatrixPosition(p.grip); s.pulse = p.pulse || null; s.ui = false; }
    for (const s of states.values()) if (s.held && !pointers.some((p) => p.id === s.id)) drop(s);   // the pointer is gone
    stepPanels(pointers);
    for (const p of pointers) {
      const s = stateOf(p.id), grab = !!p.grab;
      if (s.held) { if (!grab) drop(s); }
      else {
        const h = hoverOf(p, s);
        if (h !== s.hover) { const was = s.hover; s.hover = h; if (h) pulse(s, 0.15, 8); if (was && was.onHover) was.onHover(was.obj, false, s.id); if (h && h.onHover) h.onHover(h.obj, true, s.id); }
        if (grab && !s.wasGrab && s.hover) take(s, s.hover);
      }
      s.wasGrab = grab;
    }
    for (const it of items) {
      if (it.holders.length === 2 && it.two) {
        const a = states.get(it.holders[0]), b = states.get(it.holders[1]);
        twoHandTransform(it.two.a0, it.two.b0, a.pos, b.pos, _m, it.body ? null : it.scale, it.two.s0);
        write(it, _m.multiply(it.two.M0));
      } else if (it.holders.length) {
        const s = states.get(it.holders[0]);
        write(it, _m.multiplyMatrices(s.grip, s.local));
      } else if (it.fly) {   // no physics: a ballistic arc to the ground
        // in the world (the object may sit in a moved or turned parent), written back through its parent
        const f = it.fly, ob = it.obj;
        ob.updateWorldMatrix(true, false); ob.matrixWorld.decompose(_p, _q, _s);
        f.v.y -= o.gravity * dt;
        _p.addScaledVector(f.v, dt);
        const w = f.w.length();
        if (w > 1e-4) _q.premultiply(_q2.setFromAxisAngle(_a.copy(f.w).multiplyScalar(1 / w), w * dt));
        const gy = (o.ground ? o.ground(_p.x, _p.z) : 0) + it.radius * _s.x;
        const landed = _p.y <= gy && f.v.y < 0;
        if (landed) _p.y = gy;
        write(it, _m.compose(_p, _q, _s));
        if (landed) { it.fly = null; if (it.onLand) it.onLand(ob); }
      }
    }
  }

  return {
    update, stats, options: o,
    /** obj: an Object3D. { body (physics.js handle or Rapier RigidBody), radius (m, near-grab reach around its origin;
     *  default: its bounding sphere), twoHanded = false, scale: [min, max] (two-handed; none with a body), ray = true,
     *  onGrab(obj, pointerId, hands), onRelease(obj, pointerId, handsLeft, velocity, angular), onHover(obj, on), onLand(obj) } */
    grabbable(obj, g = {}) {
      let radius = g.radius;
      if (!(radius >= 0)) { obj.updateWorldMatrix(true, true); const sp = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere()); radius = Number.isFinite(sp.radius) ? sp.radius : 0.1; }
      const it = { obj, body: bodyOf(g.body), radius, twoHanded: !!g.twoHanded, scale: g.scale || null, ray: g.ray !== false, holders: [], two: null, zone: null, fly: null,
        tracker: createVelocityTracker(o.window), onGrab: g.onGrab, onRelease: g.onRelease, onHover: g.onHover, onLand: g.onLand };
      items.push(it);
      return it;
    },
    /** { position: [x, y, z] | object (its world pose), radius = 0.15, accepts(obj), onSnap(obj, zone), onUnsnap(obj, zone) } */
    snapZone(z = {}) {
      const pos = z.position ? new THREE.Vector3().fromArray(z.position) : null, ob = z.object || null;
      const zone = { radius: z.radius ?? 0.15, accepts: z.accepts || null, onSnap: z.onSnap, onUnsnap: z.onUnsnap, item: null,
        where: (out) => (ob ? ob.getWorldPosition(out) : out.copy(pos)), facing: (out) => (ob ? ob.getWorldQuaternion(out) : out.identity()) };
      zones.push(zone);
      return zone;
    },
    /** a ui-canvas panel and its mesh (ui.mesh()): { ray = true, poke = true } */
    panel(ui, mesh, p = {}) { const pn = { ui, mesh, ray: p.ray !== false, poke: p.poke !== false, pokes: new Map(), by: null, wasSelect: false }; panels.push(pn); return pn; },
    /** a button to press with a fingertip: { radius = 0.03, onPress(obj, pointerId), onRelease(obj) } */
    pokeable(obj, k = {}) { const pk = { obj, radius: k.radius ?? 0.03, onPress: k.onPress, onRelease: k.onRelease, pressed: false }; pokes.push(pk); return pk; },
    remove(x) { for (const list of [items, zones, panels, pokes]) { const i = list.findIndex((e) => e === x || e.obj === x || e.ui === x); if (i >= 0) list.splice(i, 1); } },
    /** what pointer `id` holds (the Object3D) or null; whether it is over a panel, hovering or holding something */
    held(id) { const s = states.get(id); return s && s.held ? s.held.obj : null; },
    busy(id) { const s = states.get(id); return !!s && (s.ui || !!s.held || !!s.hover); },
    /** release everything (a session ended) */
    reset() { for (const s of states.values()) { if (s.held) drop(s); s.hover = null; s.wasGrab = false; } },
    /** a plain snapshot for tests */
    state: () => ({ time: +time.toFixed(3), pointers: [...states.values()].map((s) => ({ id: s.id, held: s.held ? s.held.obj.name || true : null, hover: s.hover ? s.hover.obj.name || true : null, far: s.far, ui: s.ui })),
      items: items.map((it) => ({ name: it.obj.name, holders: it.holders.length, snapped: !!it.zone, flying: !!it.fly, pos: it.obj.position.toArray().map((v) => +v.toFixed(3)), scale: +it.obj.scale.x.toFixed(3) })),
      panels: panels.map((pn) => pn.by), ...stats }),
    get pointers() { return last; },
  };
}
