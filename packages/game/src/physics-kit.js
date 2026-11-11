// Mirage original code. The physics kit: what a game needs from Rapier beyond createPhysics' props, doors and
// character. Opt-in: nothing here runs until createPhysicsKit(phys) is called, and phys keeps working as before.
// ---------------------------------------------------------------------------
// const phys = await createPhysics(scene); phys.addStatic(scene);
// const kit = createPhysicsKit(phys, { hz: 60, layers: ['world', 'prop', 'debris', 'player'] });
//
//   kit.rigid(obj, { type: 'dynamic' | 'fixed' | 'kinematic', shape: 'box' | 'ball' | 'capsule' | 'cylinder' | 'cone'
//                    | 'hull' | 'mesh' | 'compound', mass, material: 'ice' | { friction, restitution, ... },
//                    layer: 'debris', mask: ['world'], ccd: true | 'soft', events: true, com: [x, y, z] })
//       -> a body: .pos .quat .velocity .impulse(j, at) .teleport(p, q) .moveTo(p, q) .wake() .sleep() .remove()
//       shape sizes come from obj's geometry unless given (half, radius, height, points, vertices / indices);
//       `colliders: [{ shape, pos, rot, ... }]` makes a compound by hand; obj may be null (no picture).
//   kit.sensor({ shape: 'box', half, pos }, { layer, mask })   a trigger volume: 'enter' / 'exit' events per body
//   kit.on('contact', (e) => ...)     a contact began: e.impulse (N s), e.point, e.normal, e.speed, e.a, e.b
//   kit.on('enter' | 'exit' | 'contactEnd' | 'break' | 'step', fn)       returns a function that removes it
//   kit.layers.collide('debris', 'player', false)          the layer matrix (16 layers at most)
//   kit.material('ice', { friction: 0.02, frictionCombine: 'min' })
//   kit.ray(from, dir, max, filter)  kit.rayAll(...)  kit.shapeCast(shape, from, dir, max, filter)
//   kit.overlap(shape, pos, filter)  kit.closest(point, filter)
//       filter: { layers: ['prop'], exclude: body, sensors: false, fixed: true, dynamic: true, kinematic: true, test }
//   kit.advance(frameDt)             fixed steps of 1 / hz from an accumulator, then render transforms interpolated
//   kit.interpolate(alpha)           the same blend for a loop that steps phys itself
//   kit.hash()                       a hash of every body's pose and velocity (determinism checks)
//   kit.stats()                      { bodies, awake, colliders, joints, stepMs, stepMsAvg, rapierMs }
//   phys.snapshot() / phys.restore() carry the kit's state with them (see physics.js)
// Joints, forces, ragdolls, vehicles and the debug draw are separate modules that take the kit:
// physics-joints.js, physics-forces.js, ragdoll.js, vehicle.js, physics-debug.js. Guide: docs/physics.md.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

/** friction / restitution presets; `density` in kg/m3 is used when a body gives no mass */
export const PHYSICS_MATERIALS = {
  default: { friction: 0.6, restitution: 0.15, density: 500 },
  wood: { friction: 0.55, restitution: 0.2, density: 600 },
  stone: { friction: 0.8, restitution: 0.05, density: 2400 },
  metal: { friction: 0.4, restitution: 0.25, density: 7800 },
  rubber: { friction: 1.1, restitution: 0.8, density: 1100, restitutionCombine: 'max' },
  ice: { friction: 0.02, restitution: 0.05, density: 900, frictionCombine: 'min' },
};
const COMBINE = { average: 0, min: 1, multiply: 2, max: 3 };   // Rapier's CoefficientCombineRule
const V = (a) => ({ x: a[0], y: a[1], z: a[2] });
const A3 = (v) => [v.x, v.y, v.z];
const Q4 = (a) => ({ x: a[0], y: a[1], z: a[2], w: a[3] });
const IDENT = { x: 0, y: 0, z: 0, w: 1 };
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

/** every vertex under obj, in the frame `inv` maps world into: { points, indices, box } */
function gather(obj, inv, wantMesh) {
  const pts = [], idx = [], box = new THREE.Box3();
  obj.traverse((o) => {
    const g = o.geometry, pos = g?.attributes?.position;
    if (!pos || !pos.count || o.userData.collide === false) return;
    _m.multiplyMatrices(inv, o.matrixWorld);
    const base = pts.length / 3;
    for (let i = 0; i < pos.count; i++) { _v.fromBufferAttribute(pos, i).applyMatrix4(_m); pts.push(_v.x, _v.y, _v.z); box.expandByPoint(_v); }
    if (wantMesh) { if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.array[i]); else for (let i = 0; i < pos.count; i++) idx.push(base + i); }
  });
  return { points: new Float32Array(pts), indices: new Uint32Array(idx), box };
}

export function createPhysicsKit(phys, { hz = 60, maxSteps = 5, interpolate: interp = true, layers: layerNames = ['default'], profile = false } = {}) {
  const R = phys.R, ext = phys.ext, info = phys.info;
  if (!ext) throw new Error('createPhysicsKit: this createPhysics has no ext hooks (an older @miragekit/game?)');
  const h = 1 / hz;
  const bodies = new Map();        // rigid-body handle -> Body
  const owner = new Map();         // collider handle -> Body
  const sensors = new Map();       // collider handle -> sensor
  const listeners = {};
  const kit = { phys, R, hz, bodies, sensors, time: 0, steps: 0, joints: null };
  let acc = 0, disposed = false;

  // ---- events
  kit.on = (type, fn) => { (listeners[type] ||= []).push(fn); return () => { const l = listeners[type], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; };
  kit.emit = (type, e) => { const l = listeners[type]; if (l) for (let i = 0; i < l.length; i++) l[i](e); };
  // the queue exists only once something asks for events: without it world.step() runs as it always did
  const needQueue = () => { if (!ext.queue) ext.queue = new R.EventQueue(true); };
  kit.wantEvents = needQueue;

  // ---- layers: name -> bit, and a symmetric matrix of which pairs collide (Unity's layer matrix)
  if (layerNames.length > 16) throw new Error('createPhysicsKit: 16 layers at most (Rapier interaction groups)');
  const matrix = new Uint16Array(16).fill(0xffff);
  const bit = (name) => { const i = typeof name === 'number' ? name : layerNames.indexOf(name); if (i < 0 || i > 15) throw new Error(`physics layer "${name}" is not one of ${layerNames.join(', ')}`); return i; };
  const bits = (names) => names == null ? 0xffff : [].concat(names).reduce((m, n) => m | (1 << bit(n)), 0);
  const groupsOf = (layer, mask) => ((1 << bit(layer)) << 16 | (mask == null ? matrix[bit(layer)] : bits(mask))) >>> 0;
  const regroup = () => { for (const b of bodies.values()) if (b.mask == null) for (const c of b.colliders) phys.world.getCollider(c)?.setCollisionGroups(groupsOf(b.layer, null)); for (const s of sensors.values()) if (s.mask == null) phys.world.getCollider(s.id)?.setCollisionGroups(groupsOf(s.layer, null)); };
  kit.layers = {
    names: layerNames, bit, bits, groups: groupsOf,
    /** do bodies of layer a and layer b collide? Applies to bodies made before and after. */
    collide(a, b, on = true) { const i = bit(a), j = bit(b); if (on) { matrix[i] |= 1 << j; matrix[j] |= 1 << i; } else { matrix[i] &= ~(1 << j); matrix[j] &= ~(1 << i); } regroup(); },
    collides: (a, b) => !!(matrix[bit(a)] & (1 << bit(b))),
    /** put a Rapier collider that the kit did not make (a character's, say) on a layer */
    assign(collider, layer, mask) { collider.setCollisionGroups(groupsOf(layer, mask)); },
    /** every collider from phys.addStatic / phys.body / phys.hinge: until this is called they are on all layers */
    assignStatic(layer) { for (const hnd of info.keys()) if (!owner.has(hnd) && !sensors.has(hnd)) phys.world.getCollider(hnd)?.setCollisionGroups(((1 << bit(layer)) << 16 | 0xffff) >>> 0); },
  };

  // ---- materials
  const materials = { ...PHYSICS_MATERIALS };
  kit.material = (name, def) => { if (def) materials[name] = { ...materials.default, ...def }; return materials[name]; };
  const materialOf = (m) => typeof m === 'string' ? (materials[m] || (() => { throw new Error(`physics material "${m}" is not defined`); })()) : { ...materials.default, ...m };

  // ---- collider descriptions
  function shapeDesc(c, fit) {
    const box = fit?.box, size = box && !box.isEmpty() ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(0.5, 0.5, 0.5);
    const centre = box && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    let d, pos = c.pos ? new THREE.Vector3(...c.pos) : c.half || c.radius || c.points || c.vertices ? new THREE.Vector3() : centre, rot = c.rot ? new THREE.Quaternion(...c.rot) : null;
    // long shapes lie along Rapier's y: turn the collider when the fitted box is longest on x or z
    const long = c.axis || (c.half || c.radius ? 'y' : size.x > size.y && size.x >= size.z ? 'x' : size.z > size.y ? 'z' : 'y');
    const turn = () => { if (!rot && long !== 'y') rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), long === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)); };
    const len = size[long], across = long === 'x' ? Math.max(size.y, size.z) : long === 'z' ? Math.max(size.x, size.y) : Math.max(size.x, size.z);
    switch (c.shape || 'box') {
      case 'box': { const hf = c.half || [size.x / 2, size.y / 2, size.z / 2]; d = R.ColliderDesc.cuboid(Math.max(hf[0], 1e-3), Math.max(hf[1], 1e-3), Math.max(hf[2], 1e-3)); break; }
      case 'ball': d = R.ColliderDesc.ball(c.radius ?? Math.max(size.x, size.y, size.z) / 2); break;
      case 'capsule': { const r = c.radius ?? across / 2, hh = Math.max(((c.height ?? len) - 2 * r) / 2, 1e-3); d = R.ColliderDesc.capsule(hh, r); turn(); break; }   // height: end to end
      case 'cylinder': d = R.ColliderDesc.cylinder((c.height ?? len) / 2, c.radius ?? across / 2); turn(); break;
      case 'cone': d = R.ColliderDesc.cone((c.height ?? len) / 2, c.radius ?? across / 2); turn(); break;
      case 'hull': { const pts = c.points ? Float32Array.from(c.points) : fit?.points; d = pts && pts.length >= 12 ? R.ColliderDesc.convexHull(pts) : null; if (!d) throw new Error('physics hull: needs at least 4 points that are not in one plane'); if (!c.pos) pos = new THREE.Vector3(); break; }
      case 'mesh': { const vs = c.vertices ? Float32Array.from(c.vertices) : fit?.points, ix = c.indices ? Uint32Array.from(c.indices) : fit?.indices; if (!vs || !ix || ix.length < 3) throw new Error('physics mesh: no triangles'); d = R.ColliderDesc.trimesh(vs, ix); if (!c.pos) pos = new THREE.Vector3(); break; }
      default: throw new Error(`physics shape "${c.shape}" is not box, ball, capsule, cylinder, cone, hull, mesh or compound`);
    }
    d.setTranslation(pos.x, pos.y, pos.z);
    if (rot) d.setRotation(rot);
    return d;
  }
  function dress(d, c, mat, layer, mask) {
    d.setFriction(c.friction ?? mat.friction).setRestitution(c.restitution ?? mat.restitution)
      .setFrictionCombineRule(COMBINE[c.frictionCombine ?? mat.frictionCombine ?? 'average']).setRestitutionCombineRule(COMBINE[c.restitutionCombine ?? mat.restitutionCombine ?? 'average'])
      .setDensity(c.density ?? mat.density).setCollisionGroups(groupsOf(c.layer ?? layer, c.layer ? c.mask : mask));
    if (c.mass != null) d.setMass(c.mass);
    if (c.sensor) d.setSensor(true).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS).setActiveCollisionTypes(R.ActiveCollisionTypes.ALL);
    return d;
  }

  // ---- bodies
  class Body {
    get body() { return this._b; }
    get pos() { return A3(this._b.translation()); }
    get quat() { const r = this._b.rotation(); return [r.x, r.y, r.z, r.w]; }
    get velocity() { return A3(this._b.linvel()); }
    set velocity(v) { this._b.setLinvel(V(v), true); }
    get spin() { return A3(this._b.angvel()); }
    set spin(v) { this._b.setAngvel(V(v), true); }
    get mass() { return this._b.mass(); }
    get sleeping() { return this._b.isSleeping(); }
    /** an impulse in N s at the centre of mass, or at a world point */
    impulse(j, at) { if (at) this._b.applyImpulseAtPoint(V(j), V(at), true); else this._b.applyImpulse(V(j), true); return this; }
    twist(j) { this._b.applyTorqueImpulse(V(j), true); return this; }
    wake() { this._b.wakeUp(); return this; }
    sleep() { this._b.sleep(); return this; }
    /** jump there (no sweep, no interpolation across the jump); velocities are kept unless `stop` */
    teleport(p, q, stop = false) {
      this._b.setTranslation(V(p), true); if (q) this._b.setRotation(Q4(q), true);
      if (stop) { this._b.setLinvel(V([0, 0, 0]), true); this._b.setAngvel(V([0, 0, 0]), true); }
      capture(this, true); write(this, 1); return this;
    }
    /** kinematic bodies: where to be after the next step (they push what is in the way and carry what stands on them) */
    moveTo(p, q) { if (p) this._b.setNextKinematicTranslation(V(p)); if (q) this._b.setNextKinematicRotation(Q4(q)); return this; }
    setLayer(layer, mask) { this.layer = layer; this.mask = mask ?? null; for (const c of this.colliders) phys.world.getCollider(c).setCollisionGroups(groupsOf(layer, mask)); return this; }
    setCcd(on) { this._b.enableCcd(!!on); return this; }
    /** report contacts of this body through kit.on('contact') */
    setEvents(on = true) { this.events = on; if (on) needQueue(); for (const c of this.colliders) { const col = phys.world.getCollider(c); col.setActiveEvents(on ? R.ActiveEvents.COLLISION_EVENTS | R.ActiveEvents.CONTACT_FORCE_EVENTS : R.ActiveEvents.NONE); col.setContactForceEventThreshold(0); } return this; }
    get state() { const b = this._b, t = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel(); return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z] }; }
    set state(s) { const b = this._b; b.setTranslation(V(s.p), true); b.setRotation(Q4(s.q), true); b.setLinvel(V(s.v || [0, 0, 0]), true); b.setAngvel(V(s.w || [0, 0, 0]), true); capture(this, true); write(this, 1); }
    remove() {
      if (!this.alive) return;
      this.alive = false;
      for (const c of this.colliders) { owner.delete(c); info.delete(c); }
      bodies.delete(this.id);
      kit.joints?.forget(this);
      phys.world.removeRigidBody(this._b);
    }
  }

  /** current pose into cur (and prev when `both`: after a jump there is nothing to blend from) */
  function capture(b, both) {
    const t = b._b.translation(), r = b._b.rotation(), c = b.cur, p = b.prev;
    if (!both) { p[0] = c[0]; p[1] = c[1]; p[2] = c[2]; p[3] = c[3]; p[4] = c[4]; p[5] = c[5]; p[6] = c[6]; }
    c[0] = t.x; c[1] = t.y; c[2] = t.z; c[3] = r.x; c[4] = r.y; c[5] = r.z; c[6] = r.w;
    if (both) p.set(c);
  }
  /** obj at prev..cur; a parent that is not at the origin is taken out again (obj's transform is local) */
  function write(b, a) {
    const o = b.obj; if (!o) return;
    const p = b.prev, c = b.cur;
    if (a >= 1) { o.position.set(c[0], c[1], c[2]); o.quaternion.set(c[3], c[4], c[5], c[6]); }
    else { o.position.set(p[0] + (c[0] - p[0]) * a, p[1] + (c[1] - p[1]) * a, p[2] + (c[2] - p[2]) * a); o.quaternion.set(p[3], p[4], p[5], p[6]).slerp(_q.set(c[3], c[4], c[5], c[6]), a); }
    if (b.local && o.parent) { o.parent.updateWorldMatrix(true, false); _inv.copy(o.parent.matrixWorld).invert(); o.position.applyMatrix4(_inv); o.parent.getWorldQuaternion(_q2); o.quaternion.premultiply(_q2.invert()); }
  }

  kit.rigid = (obj, o = {}) => {
    const type = o.type || 'dynamic', mat = materialOf(o.material || 'default'), layer = o.layer ?? 0, mask = o.mask ?? null;
    let p = o.pos, q = o.quat, local = false, fit = null;
    if (obj) {
      obj.updateWorldMatrix(true, true);
      obj.matrixWorld.decompose(_v, _q, _s);
      p ||= [_v.x, _v.y, _v.z]; q ||= [_q.x, _q.y, _q.z, _q.w];
      local = !!obj.parent && !obj.parent.matrixWorld.equals(_m.identity());
    }
    p ||= [0, 0, 0]; q ||= [0, 0, 0, 1];
    const desc = (type === 'fixed' ? R.RigidBodyDesc.fixed() : type === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
      .setTranslation(p[0], p[1], p[2]).setRotation(Q4(q)).setLinearDamping(o.damping ?? 0.05).setAngularDamping(o.angularDamping ?? 0.1)
      .setGravityScale(o.gravityScale ?? 1).setCanSleep(o.canSleep !== false).setCcdEnabled(o.ccd === true);
    if (o.ccd === 'soft') desc.setSoftCcdPrediction(o.ccdDistance ?? 1);
    if (o.velocity) desc.setLinvel(...o.velocity);
    if (o.spin) desc.setAngvel(V(o.spin));
    if (o.lockRotation) desc.enabledRotations(...(o.lockRotation === true ? [false, false, false] : o.lockRotation.map((l) => !l)));
    if (o.lockPosition) desc.enabledTranslations(...o.lockPosition.map((l) => !l));
    if (o.dominance) desc.setDominanceGroup(o.dominance);
    if (o.sleeping) desc.setSleeping(true);
    const rb = phys.world.createRigidBody(desc);
    const b = new Body();
    Object.assign(b, { id: rb.handle, _b: rb, obj: obj || null, type, layer, mask, colliders: [], events: false, alive: true, local, interp: o.interpolate !== false,
      name: o.name || obj?.name || '', userData: o.userData, prev: new Float64Array(7), cur: new Float64Array(7), surface: o.surface || obj?.userData?.surface || 'default' });
    // the body frame: obj's world position and rotation; its scale is baked into the colliders
    const frame = () => { _inv.compose(_v.set(p[0], p[1], p[2]), _q.set(q[0], q[1], q[2], q[3]), _one).invert(); return _inv; };
    let list = o.colliders;
    if (!list && o.shape === 'compound') {
      if (!obj) throw new Error('physics compound: needs an object whose child meshes become the parts');
      list = [];
      obj.traverse((c) => { if (c.geometry?.attributes?.position && c.userData.collide !== false) list.push({ shape: c.userData.shape || o.part || 'box', _fit: gather(c, frame(), false) }); });
    }
    list ||= [{ shape: o.shape || 'box', half: o.half, radius: o.radius, height: o.height, points: o.points, vertices: o.vertices, indices: o.indices, axis: o.axis }];
    for (const c of list) {
      const need = !(c.half || c.points || c.vertices || (c.radius != null && (c.shape === 'ball' || c.height != null)));
      if (need && !c._fit && obj) fit ||= gather(obj, frame(), list.some((x) => x.shape === 'mesh'));
      const d = dress(shapeDesc(c, c._fit || (need ? fit : null)), { ...c, sensor: c.sensor ?? o.sensor }, mat, layer, mask);
      const col = phys.world.createCollider(d, rb);
      b.colliders.push(col.handle); owner.set(col.handle, b);
      info.set(col.handle, { surface: b.surface, object: obj || undefined });
    }
    // Rapier folds collider masses into the body at the next step: ask for it now, the numbers are read below
    if (type === 'dynamic' && o.mass != null) { rb.recomputeMassPropertiesFromColliders(); const m1 = rb.mass(); if (m1 > 0) for (const c of b.colliders) { const col = phys.world.getCollider(c); col.setDensity(col.density() * o.mass / m1); } }
    if (type === 'dynamic') rb.recomputeMassPropertiesFromColliders();
    if (type === 'dynamic' && o.com) {
      // a centre of mass elsewhere (a car's, below its floor): keep the mass and the inertia of the shapes, move the point
      const m = rb.mass(), I = rb.principalInertia(), f = rb.principalInertiaLocalFrame();
      for (const c of b.colliders) phys.world.getCollider(c).setDensity(0);
      rb.setAdditionalMassProperties(m, V(o.com), I, f, true);
      rb.recomputeMassPropertiesFromColliders();
    }
    bodies.set(b.id, b);
    if (o.events) b.setEvents(true);
    capture(b, true);
    return b;
  };
  kit.bodyOf = (colliderHandle) => owner.get(colliderHandle) || null;

  // ---- sensors (trigger volumes)
  /** a volume that reports what enters and leaves it. spec: { shape, half | radius | height, pos, rot } in world
   *  space, or in the frame of `on` (a kit body that carries the sensor). One event per body, not per collider. */
  kit.sensor = (spec, { on = null, layer = 0, mask = null, name = '', userData } = {}) => {
    needQueue();
    const d = dress(shapeDesc(spec, null), { sensor: true, density: 0 }, materials.default, layer, mask);
    const col = phys.world.createCollider(d, on ? on._b : undefined);
    const s = { id: col.handle, name, userData, layer, mask, inside: new Map(), onEnter: null, onExit: null,
      get count() { return s.inside.size; },
      /** the kit bodies inside now */
      bodies: () => [...s.inside.values()].map((e) => e.body).filter(Boolean),
      remove() { sensors.delete(s.id); const c = phys.world.getCollider(s.id); if (c) phys.world.removeCollider(c, false); } };
    sensors.set(s.id, s);
    return s;
  };

  const sideOf = (hnd) => { const b = owner.get(hnd), i = info.get(hnd); return { body: b || null, object: b ? b.obj : i?.object, surface: b ? b.surface : i?.surface || 'default', collider: hnd }; };
  const forces = new Map();   // "h1,h2" -> force magnitude of this step
  function drain(dt) {
    const q = ext.queue, w = phys.world;
    forces.clear();
    q.drainContactForceEvents((e) => { forces.set(e.collider1() + ',' + e.collider2(), e.totalForceMagnitude()); kit.joints?.contactForce(e); });
    q.drainCollisionEvents((h1, h2, started) => {
      const s1 = sensors.get(h1), s2 = sensors.get(h2);
      if (s1 || s2) {
        for (const [s, other] of [[s1, h2], [s2, h1]]) {
          if (!s) continue;
          const side = sideOf(other), key = side.body ? 'b' + side.body.id : 'c' + other;
          let e = s.inside.get(key);
          if (started) { if (!e) s.inside.set(key, e = { n: 0, body: side.body }); if (e.n++ === 0) { const ev = { sensor: s, ...side }; s.onEnter?.(ev); kit.emit('enter', ev); } }
          else if (e && --e.n <= 0) { s.inside.delete(key); const ev = { sensor: s, ...side }; s.onExit?.(ev); kit.emit('exit', ev); }
        }
        return;
      }
      const A = sideOf(h1), B = sideOf(h2);
      if (!started) { if (listeners.contactEnd?.length) kit.emit('contactEnd', { a: A.body, b: B.body, objectA: A.object, objectB: B.object, colliderA: h1, colliderB: h2 }); return; }
      if (!listeners.contact?.length) return;
      const f = forces.get(h1 + ',' + h2) ?? forces.get(h2 + ',' + h1) ?? 0;
      let point = null, normal = null;
      const c1 = w.getCollider(h1), c2 = w.getCollider(h2);
      if (c1 && c2) w.contactPair(c1, c2, (m, flipped) => { if (point || !m.numSolverContacts()) return; point = A3(m.solverContactPoint(0)); const n = m.normal(); normal = flipped ? [-n.x, -n.y, -n.z] : [n.x, n.y, n.z]; });
      // how fast the two were closing before the step (centres of mass; a spinning body's rim is not counted)
      const va = A.body?.pv, vb = B.body?.pv;
      let speed = 0;
      if (normal) speed = Math.abs(((va ? va[0] : 0) - (vb ? vb[0] : 0)) * normal[0] + ((va ? va[1] : 0) - (vb ? vb[1] : 0)) * normal[1] + ((va ? va[2] : 0) - (vb ? vb[2] : 0)) * normal[2]);
      kit.emit('contact', { a: A.body, b: B.body, objectA: A.object, objectB: B.object, surfaceA: A.surface, surfaceB: B.surface, colliderA: h1, colliderB: h2,
        impulse: f * dt, force: f, point, normal, speed });
    });
  }

  // ---- queries
  const F = R.QueryFilterFlags;
  function filterArgs(f = {}) {
    let flags = f.sensors ? 0 : F.EXCLUDE_SENSORS;
    if (f.fixed === false) flags |= F.EXCLUDE_FIXED;
    if (f.dynamic === false) flags |= F.EXCLUDE_DYNAMIC;
    if (f.kinematic === false) flags |= F.EXCLUDE_KINEMATIC;
    const groups = f.layers == null ? undefined : (0xffff0000 | bits(f.layers)) >>> 0;
    const ex = f.exclude, exBody = ex instanceof Body ? ex._b : ex && typeof ex.numColliders === 'function' ? ex : undefined;
    const exCol = ex && !exBody ? ex : undefined;
    const test = f.test ? (c) => f.test(sideOf(c.handle)) : undefined;
    return [flags, groups, exCol, exBody, test];
  }
  const shapeOf = (s) => s.shape === 'ball' ? new R.Ball(s.radius) : s.shape === 'capsule' ? new R.Capsule(Math.max((s.height - 2 * s.radius) / 2, 1e-3), s.radius)
    : s.shape === 'cylinder' ? new R.Cylinder(s.height / 2, s.radius) : new R.Cuboid(...(s.half || [0.5, 0.5, 0.5]));
  /** the first thing along a ray: { point, normal, distance, body, object, surface, collider } | null */
  kit.ray = (from, dir, max = 100, filter) => {
    const hit = phys.world.castRayAndGetNormal(new R.Ray(V(from), V(dir)), max, true, ...filterArgs(filter));
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return { point: [from[0] + dir[0] * d, from[1] + dir[1] * d, from[2] + dir[2] * d], normal: A3(hit.normal), distance: d, ...sideOf(hit.collider.handle) };
  };
  /** everything along a ray, nearest first */
  kit.rayAll = (from, dir, max = 100, filter) => {
    const out = [];
    phys.world.intersectionsWithRay(new R.Ray(V(from), V(dir)), max, true, (hit) => { const d = hit.timeOfImpact; out.push({ point: [from[0] + dir[0] * d, from[1] + dir[1] * d, from[2] + dir[2] * d], normal: A3(hit.normal), distance: d, ...sideOf(hit.collider.handle) }); return true; }, ...filterArgs(filter));
    return out.sort((a, b) => a.distance - b.distance);
  };
  /** sweep a shape ({ shape, half | radius, height, rot }) from a point along dir; distance is how far it travels */
  kit.shapeCast = (shape, from, dir, max = 100, filter) => {
    const hit = phys.world.castShape(V(from), shape.rot ? Q4(shape.rot) : IDENT, V(dir), shapeOf(shape), 0, max, true, ...filterArgs(filter));
    if (!hit) return null;
    return { distance: hit.time_of_impact, point: A3(hit.witness1), normal: A3(hit.normal1), ...sideOf(hit.collider.handle) };
  };
  /** what a shape placed at pos touches: [{ body, object, surface, collider }] */
  kit.overlap = (shape, pos, filter) => {
    const out = [];
    phys.world.intersectionsWithShape(V(pos), shape.rot ? Q4(shape.rot) : IDENT, shapeOf(shape), (c) => { out.push(sideOf(c.handle)); return true; }, ...filterArgs(filter));
    return out;
  };
  /** the nearest point on any collider: { point, distance, inside, body, object, ... } | null */
  kit.closest = (point, filter) => {
    const hit = phys.world.projectPoint(V(point), true, ...filterArgs(filter));
    if (!hit) return null;
    const pt = A3(hit.point);
    return { point: pt, distance: Math.hypot(pt[0] - point[0], pt[1] - point[1], pt[2] - point[2]), inside: hit.isInside, ...sideOf(hit.collider.handle) };
  };

  // ---- stepping: phys.step calls these around world.step, whoever drives it
  const ms = new Float32Array(60); let msN = 0, t0 = 0, rapierMs = 0;
  const pre = (dt) => {
    t0 = performance.now();
    kit.emit('step', dt);
    // velocities before the step, for contact speeds (only bodies that report contacts)
    for (const b of bodies.values()) if (b.events) { const v = b._b.linvel(); (b.pv ||= [0, 0, 0])[0] = v.x; b.pv[1] = v.y; b.pv[2] = v.z; }
  };
  const post = (dt) => {
    let moved = false;
    for (const b of bodies.values()) {
      if (b.type === 'fixed') continue;
      if (b._b.isSleeping()) { if (!b.rest) { b.rest = true; capture(b, true); write(b, 1); } continue; }
      b.rest = false; capture(b, false); write(b, 1); moved = true;
    }
    if (ext.queue) drain(dt);
    kit.time += dt; kit.steps++;
    kit.emit('stepped', dt);
    if (profile) rapierMs = phys.world.timingStep();
    ms[msN++ % 60] = performance.now() - t0;
    return moved;
  };
  ext.pre.unshift(pre); ext.post.unshift(post);
  if (profile) phys.world.profilerEnabled = true;

  /** render transforms between the last two steps (0 = the step before, 1 = the last) */
  kit.interpolate = (alpha) => { for (const b of bodies.values()) if (b.interp && !b.rest && b.type !== 'fixed') write(b, alpha); };
  /** fixed steps for a frame of `dt` seconds; returns how many were taken. A long frame takes at most maxSteps. */
  kit.advance = (dt) => {
    acc += Math.min(Math.max(dt, 0), maxSteps * h);
    let n = 0;
    while (acc >= h - 1e-9) { phys.step(h); acc = Math.max(0, acc - h); n++; }
    if (interp) kit.interpolate(acc / h);
    return n;
  };
  Object.defineProperty(kit, 'alpha', { get: () => acc / h });

  // ---- determinism and stats
  const _f = new Float32Array(13), _u = new Uint32Array(_f.buffer);
  /** FNV-1a over every body's position, rotation and velocities (as float bits), in handle order */
  kit.hash = () => {
    let x = 2166136261;
    phys.world.forEachRigidBody((b) => {
      const t = b.translation(), r = b.rotation(), v = b.linvel(), a = b.angvel();
      _f[0] = t.x; _f[1] = t.y; _f[2] = t.z; _f[3] = r.x; _f[4] = r.y; _f[5] = r.z; _f[6] = r.w; _f[7] = v.x; _f[8] = v.y; _f[9] = v.z; _f[10] = a.x; _f[11] = a.y; _f[12] = a.z;
      for (let i = 0; i < 13; i++) { x ^= _u[i]; x = Math.imul(x, 16777619); }
    });
    return (x >>> 0).toString(16).padStart(8, '0');
  };
  kit.stats = () => {
    const w = phys.world; let awake = 0, dynamic = 0;
    w.forEachRigidBody((b) => { if (b.isDynamic()) { dynamic++; if (!b.isSleeping()) awake++; } });
    const n = Math.min(msN, 60); let sum = 0; for (let i = 0; i < n; i++) sum += ms[i];
    return { bodies: w.bodies.len(), dynamic, awake, colliders: w.colliders.len(), joints: w.impulseJoints.len(), sensors: sensors.size,
      stepMs: n ? ms[(msN - 1) % 60] : 0, stepMsAvg: n ? sum / n : 0, rapierMs, steps: kit.steps };
  };

  // ---- snapshot / restore (through phys.snapshot)
  ext.save.kit = () => ({ acc, time: kit.time, steps: kit.steps, sensors: [...sensors.values()].map((s) => [s.id, [...s.inside].map(([k, e]) => [k, e.n])]) });
  ext.load.kit = (s) => {
    acc = s.acc; kit.time = s.time; kit.steps = s.steps;
    for (const [id, inside] of s.sensors) { const sn = sensors.get(id); if (sn) sn.inside = new Map(inside.map(([k, n]) => [k, { n, body: k[0] === 'b' ? bodies.get(+k.slice(1)) || null : null }])); }
  };
  ext.rebind.unshift(() => {
    if (profile) phys.world.profilerEnabled = true;
    for (const b of [...bodies.values()]) {
      b._b = phys.world.getRigidBody(b.id);
      if (b._b && b._b.handle !== b.id) b._b = null;   // the slot was reused by a later body
      if (!b._b) { b.alive = false; bodies.delete(b.id); for (const c of b.colliders) { owner.delete(c); info.delete(c); } continue; }   // made after the snapshot
      b.rest = false; capture(b, true); write(b, 1);
    }
  });

  kit.dispose = () => {
    if (disposed) return; disposed = true;
    for (const [list, f] of [[ext.pre, pre], [ext.post, post]]) { const i = list.indexOf(f); if (i >= 0) list.splice(i, 1); }
    delete ext.save.kit; delete ext.load.kit;
    if (ext.queue) { ext.queue.free(); ext.queue = undefined; }
  };
  return kit;
}
