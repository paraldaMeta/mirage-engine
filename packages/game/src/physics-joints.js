// Mirage original code. Joints between physics-kit bodies: fixed, ball, hinge, slider, spring, rope and a
// six-axis joint, with limits, motors and a break force.
// ---------------------------------------------------------------------------
// const joints = createJoints(kit);
//   joints.fixed(a, b, { anchor })                      a = null pins b to the world
//   joints.ball(a, b, { anchor, limits: { x: [-0.5, 0.5], y: [-0.2, 0.2], z: [-1, 1] } })      radians, body axes
//   joints.cone(a, b, { anchor, axis: [0, -1, 0], centre: [0, -0.9, 0.4], swing: 1, twist: 0.4 })   a shoulder, a hip:
//       b's `axis` stays within `swing` radians of `centre` (fixed in a), and turns at most `twist` about itself
//   joints.hinge(a, b, { anchor, axis: [0, 1, 0], limits: [-1.2, 1.2], motor: { speed: 2 } })
//   joints.slider(a, b, { anchor, axis: [1, 0, 0], limits: [0, 2], motor: { target: 1, stiffness: 400, damping: 40 } })
//   joints.spring(a, b, { anchorA, anchorB, rest: 1, stiffness: 300, damping: 12 })
//   joints.rope(a, b, { anchorA, anchorB, length: 2 })  no further apart than length
//   joints.sixDof(a, b, { anchor, axis, linear: { x: 'locked', y: [-0.4, 0.1], z: 'locked' }, angular: { x: 'free', ... } })
//   every one takes { breakForce: newtons, contacts: false } and returns a joint:
//     j.force (the last estimate, N)  j.angle (hinge)  j.travel (slider)  j.setLimits(min, max)  j.setMotor(m | null)
//     j.alive  j.remove()
//   kit.on('break', ({ joint, force }) => ...)
// Anchors and axes are given in world space at the moment of creation.
//
// What Rapier's JavaScript build sets the limits of:
// - a hinge, slider or six-axis joint takes ONE axis, used in both bodies' own frames. So the two bodies must have
//   the same orientation when such a joint is made (a joint to the world, a = null, is always fine). It throws
//   otherwise. Angles and travel are then measured from the pose at creation.
// - a ball joint's per-axis limits are measured from "both bodies turned the same way", and Rapier takes each
//   angle from the relative rotation on its own: they hold when one axis does most of the turning, and not when
//   two are far from zero at once (measured: a shoulder with three limits swung through all of them). `cone` is
//   the limit for that case. It is worked out here, before each step, as a torque impulse on both bodies that
//   stops the motion out of the cone and brings the overshoot back at 12 rad/s per radian: a soft stop, a few
//   degrees of give under load.
// - it has no readout of the force a joint carries, so `breakForce` works on an estimate made here: per body,
//   mass x (change of velocity / dt - gravity) minus the contact forces Rapier reports, shared out over the joints
//   (exact for chains and trees, least-norm for loops; damping and forces you apply yourself count as joint load).
//   There is no break torque.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const AX = { x: 0, y: 1, z: 2 }, LIN = 0, ANG = 3;   // Rapier's joint axes: LinX, LinY, LinZ, AngX, AngY, AngZ = 0..5
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const rbOf = (x) => x._b || x.body || x;
const local = (rb, p) => { const t = rb.translation(), r = rb.rotation(); _p.set(p[0] - t.x, p[1] - t.y, p[2] - t.z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert()); return { x: _p.x, y: _p.y, z: _p.z }; };
const localDir = (rb, d) => { const r = rb.rotation(); _p.set(d[0], d[1], d[2]).normalize().applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert()); return { x: _p.x, y: _p.y, z: _p.z }; };
const world = (rb, l, out) => { const t = rb.translation(), r = rb.rotation(); return out.set(l.x, l.y, l.z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_p.set(t.x, t.y, t.z)); };

export function createJoints(kit) {
  if (kit.joints) return kit.joints;
  const { phys, R } = kit, ext = phys.ext;
  const all = new Map();          // joint handle -> joint (broken ones stay: a restore can bring them back)
  const raw = () => phys.world.impulseJoints.raw;
  let dirty = true, breakables = 0;

  class Joint {
    get bodyA() { return phys.world.getRigidBody(this.ha); }
    get bodyB() { return phys.world.getRigidBody(this.hb); }
    /** hinge: the angle from the pose at creation, radians */
    get angle() {
      const ra = this.bodyA.rotation(), rb = this.bodyB.rotation(), ax = this.axis;
      _q.set(ra.x, ra.y, ra.z, ra.w).invert().multiply(_q2.set(rb.x, rb.y, rb.z, rb.w));
      return 2 * Math.atan2(_q.x * ax.x + _q.y * ax.y + _q.z * ax.z, _q.w);
    }
    /** slider: how far b has moved along the axis since creation, metres */
    get travel() {
      world(this.bodyA, this.anchorA, _a); world(this.bodyB, this.anchorB, _b).sub(_a);
      const r = this.bodyA.rotation(), ax = this.axis;
      _a.set(ax.x, ax.y, ax.z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
      return _b.dot(_a);
    }
    /** the distance between the two anchors (spring, rope) */
    get length() { return world(this.bodyA, this.anchorA, _a).distanceTo(world(this.bodyB, this.anchorB, _b)); }
    setLimits(min, max, axis = this.main) { if (this.alive) raw().jointSetLimits(this.id, axis, min, max); return this; }
    /** { speed, strength } turns / pushes at a speed; { target, stiffness, damping } holds a position; null lets go */
    setMotor(m, axis = this.main) {
      if (!this.alive) return this;
      const r = raw();
      r.jointConfigureMotorModel(this.id, axis, m?.model === 'force' ? 1 : 0);   // 0: by acceleration (mass does not matter)
      if (!m) r.jointConfigureMotor(this.id, axis, 0, 0, 0, 0);
      else if (m.target != null) r.jointConfigureMotorPosition(this.id, axis, m.target, m.stiffness ?? 400, m.damping ?? 40);
      else r.jointConfigureMotorVelocity(this.id, axis, m.speed ?? 0, m.strength ?? 1e4);
      this.bodyA?.wakeUp(); this.bodyB?.wakeUp();
      return this;
    }
    setContacts(on) { if (this.alive) raw().jointSetContactsEnabled(this.id, !!on); return this; }
    remove() { drop(this, true); all.delete(this.id); }
  }
  function drop(j, fromWorld) {
    if (!j.alive) return;
    j.alive = false; dirty = true;
    if (j.breakForce != null) breakables--;
    const w = phys.world;
    if (fromWorld) { const r = w.getImpulseJoint(j.id); if (r && r.handle === j.id) w.removeImpulseJoint(r, true); }
  }

  function make(type, a, b, o, build, main = -1) {
    if (!b) throw new Error(`joints.${type}: the second body is required (the first may be null: the world)`);
    const w = phys.world, B = rbOf(b);
    let A = a ? rbOf(a) : null, pin = null;
    if (!A) {
      // the world side: a fixed body turned like b, so one-axis joints work whatever b's orientation
      const t = B.translation(), r = B.rotation();
      A = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(t.x, t.y, t.z).setRotation(r)); pin = A.handle;
    }
    const data = build(A, B);
    if (!data) throw new Error(`joints.${type}: Rapier refused the joint (a zero axis?)`);
    const r = w.createImpulseJoint(data, A, B, true);
    const j = Object.assign(new Joint(), { id: r.handle, type, a: a || null, b, ha: A.handle, hb: B.handle, pin, main, alive: true, force: 0,
      breakForce: o.breakForce ?? null, name: o.name || '', anchorA: r.anchor1(), anchorB: r.anchor2(), axis: null, f: [0, 0, 0], done: false });
    if (o.contacts != null) j.setContacts(o.contacts);
    if (j.breakForce != null) breakables++;
    all.set(j.id, j); dirty = true;
    return j;
  }
  const anchors = (A, B, o) => {
    const t = B.translation(), p = o.anchor || [t.x, t.y, t.z];
    return [local(A, o.anchorA || p), local(B, o.anchorB || p)];
  };
  /** the axis in both bodies' frames; they must agree (see the note at the top) */
  const sharedAxis = (type, A, B, axis) => {
    const la = localDir(A, axis), lb = localDir(B, axis);
    if (Math.hypot(la.x - lb.x, la.y - lb.y, la.z - lb.z) > 2e-3) throw new Error(`joints.${type}: the two bodies must have the same orientation when the joint is made (Rapier's JS build takes one axis for both); turn the shapes instead of the bodies, or joint through a body that is aligned`);
    return la;
  };
  const range = (j, axis, l, flip) => { if (Array.isArray(l)) j.setLimits(flip ? -l[1] : l[0], flip ? -l[0] : l[1], axis); };

  const api = {
    all,
    fixed(a, b, o = {}) {
      return make('fixed', a, b, o, (A, B) => {
        const [pa, pb] = anchors(A, B, o), ra = A.rotation(), rb = B.rotation();
        // frames that keep the relative pose of this moment: the identity in a, a's rotation seen from b in b
        _q.set(rb.x, rb.y, rb.z, rb.w).invert().multiply(_q2.set(ra.x, ra.y, ra.z, ra.w));
        return R.JointData.fixed(pa, { x: 0, y: 0, z: 0, w: 1 }, pb, { x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      });
    },
    ball(a, b, o = {}) {
      const j = make('ball', a, b, o, (A, B) => R.JointData.spherical(...anchors(A, B, o)));
      if (o.limits) for (const k in o.limits) range(j, ANG + AX[k], o.limits[k]);
      return j;
    },
    hinge(a, b, o = {}) {
      let ax;
      const j = make('hinge', a, b, o, (A, B) => { ax = sharedAxis('hinge', A, B, o.axis || [0, 1, 0]); return R.JointData.revolute(...anchors(A, B, o), ax); }, ANG);
      j.axis = ax;
      if (o.limits) j.setLimits(o.limits[0], o.limits[1]);
      if (o.motor) j.setMotor(o.motor);
      return j;
    },
    slider(a, b, o = {}) {
      let ax;
      const j = make('slider', a, b, o, (A, B) => { ax = sharedAxis('slider', A, B, o.axis || [1, 0, 0]); return R.JointData.prismatic(...anchors(A, B, o), ax); }, LIN);
      j.axis = ax;
      if (o.limits) j.setLimits(o.limits[0], o.limits[1]);
      if (o.motor) j.setMotor(o.motor);
      return j;
    },
    spring(a, b, o = {}) {
      return make('spring', a, b, o, (A, B) => {
        const [pa, pb] = anchors(A, B, o);
        const rest = o.rest ?? world(A, pa, _a).distanceTo(world(B, pb, _b));
        return R.JointData.spring(rest, o.stiffness ?? 300, o.damping ?? 12, pa, pb);
      });
    },
    rope(a, b, o = {}) {
      return make('rope', a, b, o, (A, B) => {
        const [pa, pb] = anchors(A, B, o);
        return R.JointData.rope(o.length ?? world(A, pa, _a).distanceTo(world(B, pb, _b)), pa, pb);
      });
    },
    cone(a, b, o = {}) {
      const j = make('cone', a, b, o, (A, B) => R.JointData.spherical(...anchors(A, B, o)));
      const A = j.bodyA, B = j.bodyB, ra = A.rotation(), rb = B.rotation();
      j.axis = localDir(B, o.axis || [1, 0, 0]); j.centre = localDir(A, o.centre || o.axis || [1, 0, 0]);
      j.swing = o.swing ?? Math.PI / 4; j.twist = o.twist == null ? null : Array.isArray(o.twist) ? o.twist : [-o.twist, o.twist];
      const r0 = new THREE.Quaternion(ra.x, ra.y, ra.z, ra.w).invert().multiply(_q2.set(rb.x, rb.y, rb.z, rb.w));
      j.r0inv = r0.clone().invert(); j.twistAxis = new THREE.Vector3(j.axis.x, j.axis.y, j.axis.z).applyQuaternion(r0);
      cones.add(j);
      return j;
    },
    /** per axis: 'locked' (the default), 'free' or [min, max]. x is `axis` (default the bodies' x); y and z are the
     *  bodies' own y and z when axis is their x. */
    sixDof(a, b, o = {}) {
      const lin = o.linear || {}, ang = o.angular || {};
      // Rapier builds the joint frame from the axis: with x as the axis its Y is the body's -z and its Z the body's y
      const slot = { x: [0, false], y: [2, false], z: [1, true] };
      let mask = 0;
      for (const k of ['x', 'y', 'z']) { if ((lin[k] ?? 'locked') === 'locked') mask |= 1 << slot[k][0]; if ((ang[k] ?? 'locked') === 'locked') mask |= 8 << slot[k][0]; }
      let ax;
      const j = make('sixDof', a, b, o, (A, B) => { ax = sharedAxis('sixDof', A, B, o.axis || [1, 0, 0]); return R.JointData.generic(...anchors(A, B, o), ax, mask); });
      j.axis = ax;
      for (const k of ['x', 'y', 'z']) { range(j, LIN + slot[k][0], lin[k], slot[k][1]); range(j, ANG + slot[k][0], ang[k], slot[k][1]); }
      return j;
    },
    /** kit bodies call this when they are removed: Rapier drops their joints with them */
    forget(body) { const h = rbOf(body).handle; for (const j of all.values()) if (j.alive && (j.ha === h || j.hb === h)) { drop(j, false); all.delete(j.id); } },
  };

  // ---- cone limits (see the note at the top)
  const cones = new Set(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _at = new THREE.Vector3();
  // how easily a body turns about n when it is held at the joint: its own inertia plus its mass on the lever from
  // the anchor to its centre (exact when the anchor stays put, close enough when it does not)
  const invI = (rb, n, at) => {
    if (!rb.isDynamic()) return 0;
    const m = rb.effectiveWorldInvInertia(), i = n.x * (m.m11 * n.x + m.m12 * n.y + m.m13 * n.z) + n.y * (m.m12 * n.x + m.m22 * n.y + m.m23 * n.z) + n.z * (m.m13 * n.x + m.m23 * n.y + m.m33 * n.z);
    if (!(i > 0)) return 0;
    const c = rb.worldCom(), rx = c.x - at.x, ry = c.y - at.y, rz = c.z - at.z, along = rx * n.x + ry * n.y + rz * n.z;
    return 1 / (1 / i + rb.mass() * Math.max(0, rx * rx + ry * ry + rz * rz - along * along));
  };
  /** b may not turn about n (world, unit) relative to a faster than what brings `over` radians back */
  function stop(A, B, n, over, dt, at) {
    const wa = A.angvel(), wb = B.angvel(), rate = (wb.x - wa.x) * n.x + (wb.y - wa.y) * n.y + (wb.z - wa.z) * n.z, want = -Math.min(over * 12, 8);
    if (rate <= want) return;
    const inv = invI(A, n, at) + invI(B, n, at);
    if (!(inv > 0)) return;
    const L = (want - rate) / inv;
    // not a waking impulse: a limb that hangs on its limit must still be able to fall asleep
    if (B.isDynamic()) B.applyTorqueImpulse({ x: n.x * L, y: n.y * L, z: n.z * L }, false);
    if (A.isDynamic()) A.applyTorqueImpulse({ x: -n.x * L, y: -n.y * L, z: -n.z * L }, false);
  }
  function limitCones(dt) {
    for (const j of cones) {
      if (!j.alive) { if (!all.has(j.id)) cones.delete(j); continue; }
      const A = j.bodyA, B = j.bodyB;
      if (!A || !B || ((A.isSleeping() || !A.isDynamic()) && (B.isSleeping() || !B.isDynamic()))) continue;
      const ra = A.rotation(), rb = B.rotation();
      _qa.set(ra.x, ra.y, ra.z, ra.w); _qb.set(rb.x, rb.y, rb.z, rb.w);
      _c.set(j.centre.x, j.centre.y, j.centre.z).applyQuaternion(_qa); _d.set(j.axis.x, j.axis.y, j.axis.z).applyQuaternion(_qb);
      const ang = Math.acos(Math.max(-1, Math.min(1, _c.dot(_d))));
      j.swingAngle = ang;
      if (ang > j.swing && _n.crossVectors(_c, _d).lengthSq() > 1e-12) stop(A, B, _n.normalize(), ang - j.swing, dt, world(B, j.anchorB, _at));
      if (j.twist) {
        // the turn since creation, seen from a; its part about the bone's own axis
        _q.copy(_qa).invert().multiply(_qb).multiply(j.r0inv);
        const u = j.twistAxis, p = _q.x * u.x + _q.y * u.y + _q.z * u.z;
        let tw = 2 * Math.atan2(p, _q.w); if (tw > Math.PI) tw -= 2 * Math.PI; else if (tw < -Math.PI) tw += 2 * Math.PI;
        j.twistAngle = tw;
        if (tw > j.twist[1]) stop(A, B, _d, tw - j.twist[1], dt, world(B, j.anchorB, _at));
        else if (tw < j.twist[0]) stop(A, B, _n.copy(_d).negate(), j.twist[0] - tw, dt, world(B, j.anchorB, _at));
      }
    }
  }

  // ---- the break estimate (see the note at the top)
  const nodes = new Map();        // rigid-body handle -> { rb, joints, pv, cf, r, deg }
  let prevPairs = new Set(), pairs = new Set();
  function rebuild() {
    dirty = false; nodes.clear();
    if (!breakables) return;
    kit.wantEvents();
    const w = phys.world, by = new Map();
    for (const j of all.values()) if (j.alive) for (const h of [j.ha, j.hb]) { let l = by.get(h); if (!l) by.set(h, l = []); l.push(j); }
    const todo = [];
    for (const j of all.values()) if (j.alive && j.breakForce != null) todo.push(j.ha, j.hb);
    while (todo.length) {
      const h = todo.pop();
      if (nodes.has(h)) continue;
      const rb = w.getRigidBody(h);
      if (!rb || !rb.isDynamic()) continue;
      nodes.set(h, { rb, joints: by.get(h) || [], pv: [0, 0, 0], cf: [0, 0, 0], r: [0, 0, 0], deg: 0 });
      for (let i = 0; i < rb.numColliders(); i++) { const c = rb.collider(i); c.setActiveEvents(c.activeEvents() | R.ActiveEvents.CONTACT_FORCE_EVENTS); c.setContactForceEventThreshold(0); }
      for (const j of by.get(h) || []) todo.push(j.ha, j.hb);
    }
  }
  const pre = (dt) => {
    if (cones.size) limitCones(dt);
    if (dirty) rebuild();
    for (const n of nodes.values()) { const v = n.rb.linvel(); n.pv[0] = v.x; n.pv[1] = v.y; n.pv[2] = v.z; n.cf[0] = n.cf[1] = n.cf[2] = 0; }
  };
  /** from the kit's event drain: one contact pair's force of this step */
  api.contactForce = (e) => {
    if (!nodes.size) return;
    const w = phys.world, h1 = e.collider1(), h2 = e.collider2(), key = h1 + ',' + h2;
    const n1 = nodes.get(w.getCollider(h1)?.parent()?.handle), n2 = nodes.get(w.getCollider(h2)?.parent()?.handle);
    pairs.add(key);
    if (!n1 && !n2) return;
    // measured: a contact that carries on reports (n + 1) / n times the force it applied, n the solver's
    // iterations; one that began in this step reports it as it was
    const it = w.numSolverIterations, s = prevPairs.has(key) ? it / (it + 1) : 1, f = e.totalForce();
    if (n2) { n2.cf[0] += f.x * s; n2.cf[1] += f.y * s; n2.cf[2] += f.z * s; }
    if (n1) { n1.cf[0] -= f.x * s; n1.cf[1] -= f.y * s; n1.cf[2] -= f.z * s; }
  };
  const post = (dt) => {
    const t = prevPairs; prevPairs = pairs; pairs = t; pairs.clear();
    if (!nodes.size) return false;
    const g = phys.world.gravity, queue = [];
    for (const [h, n] of nodes) {
      const v = n.rb.linvel(), m = n.rb.mass(), gs = n.rb.gravityScale();
      n.r[0] = m * ((v.x - n.pv[0]) / dt - g.x * gs) - n.cf[0]; n.r[1] = m * ((v.y - n.pv[1]) / dt - g.y * gs) - n.cf[1]; n.r[2] = m * ((v.z - n.pv[2]) / dt - g.z * gs) - n.cf[2];
      n.deg = 0; n.h = h;
      for (const j of n.joints) if (j.alive) { n.deg++; j.done = false; j.f[0] = j.f[1] = j.f[2] = 0; }
      if (n.rb.isSleeping()) { n.r[0] = n.r[1] = n.r[2] = 0; }
      if (n.deg === 1) queue.push(n);
    }
    // the force of joint j acts on its body b as +f and on a as -f. A body with one joint left gives that joint.
    while (queue.length) {
      const n = queue.pop();
      if (n.deg !== 1) continue;
      const j = n.joints.find((x) => x.alive && !x.done), s = j.hb === n.h ? 1 : -1;
      j.f[0] = s * n.r[0]; j.f[1] = s * n.r[1]; j.f[2] = s * n.r[2]; j.done = true; n.deg = 0;
      const k = nodes.get(s === 1 ? j.ha : j.hb);
      if (k) { k.r[0] += s * j.f[0]; k.r[1] += s * j.f[1]; k.r[2] += s * j.f[2]; if (--k.deg === 1) queue.push(k); }
    }
    // what is left are loops: sweeps that spread each body's residual over its open joints (Kaczmarz)
    let open = false;
    for (const n of nodes.values()) if (n.deg > 0) { open = true; break; }
    if (open) for (let sweep = 0; sweep < 12; sweep++) for (const n of nodes.values()) {
      if (n.deg <= 0) continue;
      let rx = n.r[0], ry = n.r[1], rz = n.r[2];
      for (const j of n.joints) if (j.alive && !j.done) { const s = j.hb === n.h ? 1 : -1; rx -= s * j.f[0]; ry -= s * j.f[1]; rz -= s * j.f[2]; }
      for (const j of n.joints) if (j.alive && !j.done) { const s = j.hb === n.h ? 1 : -1; j.f[0] += s * rx / n.deg; j.f[1] += s * ry / n.deg; j.f[2] += s * rz / n.deg; }
    }
    let broke = null;
    for (const j of all.values()) {
      if (!j.alive || j.breakForce == null) continue;
      j.force = Math.hypot(j.f[0], j.f[1], j.f[2]);
      if (j.force > j.breakForce) (broke ||= []).push(j);
    }
    if (broke) for (const j of broke) { drop(j, true); kit.emit('break', { joint: j, force: j.force, a: j.a, b: j.b }); }
    return false;
  };
  ext.pre.push(pre); ext.post.push(post);

  // ---- snapshot / restore: the joints themselves are in Rapier's bytes
  ext.save.joints = () => ({ pairs: [...prevPairs] });
  ext.load.joints = (s) => { prevPairs = new Set(s.pairs); pairs.clear(); };
  ext.rebind.push(() => {
    const w = phys.world;
    for (const j of [...all.values()]) {
      // Rapier looks handles up by slot alone: a freed slot may hold a newer joint, so compare the whole handle
      const was = j.alive, now = w.getImpulseJoint(j.id)?.handle === j.id && w.getRigidBody(j.hb)?.handle === j.hb;
      if (was && !now) { j.alive = false; if (j.breakForce != null) breakables--; all.delete(j.id); }   // made after the snapshot
      else if (!was && now) { j.alive = true; if (j.breakForce != null) breakables++; }               // broken after it
    }
    dirty = true;
  });
  api.dispose = () => { for (const [l, f] of [[ext.pre, pre], [ext.post, post]]) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } delete ext.save.joints; delete ext.load.joints; kit.joints = null; };
  kit.joints = api;
  return api;
}
