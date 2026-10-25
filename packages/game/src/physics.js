// Mirage original code. Rapier (Apache-2.0, @dimforge/rapier3d-compat 0.19.3) under a built world.
// ---------------------------------------------------------------------------
// const phys = await createPhysics(world.scene)       lazy: the WASM (1.6 MB, inlined as base64) loads here only
//   phys.addStatic(root)        one fixed trimesh collider per solid mesh (the walk grid's rule: visible layer-0
//                               meshes that write depth, minus userData.collide === false, plus collider proxies)
//   phys.body(obj, { shape: 'box' | 'ball', mass })        a dynamic prop; obj follows the body
//   phys.hinge(obj, { half, offset, swing })               a kinematic door leaf turning about obj's origin (y axis)
//   phys.character({ pos })     a kinematic character controller with the @mirage/play walker's shape
//   phys.step(dt)               one Rapier step; true while anything moved (props awake, a door turning)
//   phys.ray(from, dir, max)    -> { point, distance, surface, object } | null
// Surfaces (footsteps): `userData.surface` on the mesh or its material, else 'default'.
// ponytail: one variable-length step per frame (dt clamped to 1/30), no interpolation; a fixed step with an
// accumulator when determinism or replays matter. Sensors / contact events are not wired (interactables use
// distance); add an EventQueue when a game needs triggers.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

let RAPIER = null;
/** load and initialise Rapier once (the dynamic import keeps it out of pages that never call this) */
export async function loadRapier() {
  if (!RAPIER) {
    const m = await import('@dimforge/rapier3d-compat');
    RAPIER = m.default || m;
    // the compat build calls wasm-bindgen's init the old way, which warns once; that warning is not ours to fix
    const warn = console.warn;
    console.warn = (...a) => { if (!String(a[0]).includes('deprecated parameters for the initialization')) warn(...a); };
    try { await RAPIER.init(); } finally { console.warn = warn; }
  }
  return RAPIER;
}

const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible || p.userData.collide === false) return false; return true; };
const solid = (o) => (o.isMesh || o.isInstancedMesh) && shown(o) &&
  (o.userData.collider || ((o.layers.mask & 1) && [].concat(o.material).some((m) => m && m.depthWrite !== false && !m.transparent)));
const surfaceOf = (o) => o.userData.surface || [].concat(o.material)[0]?.userData?.surface || 'default';

export async function createPhysics(scene, { gravity = 9.81 } = {}) {
  const R = await loadRapier();
  const world = new R.World({ x: 0, y: -gravity, z: 0 });
  const info = new Map();        // collider handle -> { surface, object }
  const moving = [];             // { body, obj } synced every step
  const hinges = [];
  const stats = { colliders: 0, triangles: 0, buildMs: 0 };
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();

  function addStatic(root = scene) {
    const t0 = performance.now();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!solid(o)) return;
      const g = o.geometry, pos = g.attributes.position, n = o.isInstancedMesh ? o.count : 1;
      const idx = g.index ? g.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
      const verts = new Float32Array(pos.count * 3 * n), ind = new Uint32Array(idx.length * n);
      for (let k = 0; k < n; k++) {
        _m.copy(o.matrixWorld);
        if (o.isInstancedMesh) { const im = new THREE.Matrix4(); o.getMatrixAt(k, im); _m.multiply(im); }
        for (let i = 0; i < pos.count; i++) _v.fromBufferAttribute(pos, i).applyMatrix4(_m).toArray(verts, (k * pos.count + i) * 3);
        for (let i = 0; i < idx.length; i++) ind[k * idx.length + i] = idx[i] + k * pos.count;
      }
      const c = world.createCollider(R.ColliderDesc.trimesh(verts, ind).setFriction(0.8));
      info.set(c.handle, { surface: surfaceOf(o), object: o });
      stats.colliders++; stats.triangles += ind.length / 3;
    });
    world.step();   // scene queries (rays, the character) see colliders only after a step
    stats.buildMs += performance.now() - t0;
  }

  /** a dynamic prop from obj's bounding box (or a ball); obj must sit in a world-aligned parent */
  function body(obj, { shape = 'box', mass = 10, friction = 0.6, restitution = 0.15, damping = 0.2 } = {}) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(obj.position.x, obj.position.y, obj.position.z)
      .setRotation(obj.quaternion).setLinearDamping(damping).setAngularDamping(damping * 2).setCcdEnabled(true));
    const off = c.sub(obj.position);
    const desc = shape === 'ball' ? R.ColliderDesc.ball(Math.max(size.x, size.y, size.z) / 2) : R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    const col = world.createCollider(desc.setTranslation(off.x, off.y, off.z).setMass(mass).setFriction(friction).setRestitution(restitution), b);
    info.set(col.handle, { surface: surfaceOf(obj), object: obj });
    moving.push({ body: b, obj });
    return {
      body: b, obj,
      get pos() { const t = b.translation(); return [t.x, t.y, t.z]; },
      /** for save / load */
      get state() { const t = b.translation(), r = b.rotation(); return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] }; },
      set state(s) { b.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true); b.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); sync(b, obj); },
    };
  }

  /** a kinematic leaf turning about obj's origin (y axis): half extents and the box centre's offset in obj space */
  function hinge(obj, { half, offset = [0, 0, 0], swing = Math.PI / 2, speed = 1.6 } = {}) {
    const base = obj.quaternion.clone();
    const b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(obj.position.x, obj.position.y, obj.position.z).setRotation(base));
    const col = world.createCollider(R.ColliderDesc.cuboid(...half).setTranslation(...offset), b);
    info.set(col.handle, { surface: 'wood', object: obj });
    const h = { body: b, obj, angle: 0, target: 0, swing, speed, base,
      open() { h.target = swing; }, close() { h.target = 0; }, toggle() { h.target = h.target ? 0 : swing; },
      get isOpen() { return h.target !== 0; },
      /** jump to a state (load) */
      set(open) { h.target = h.angle = open ? swing : 0; apply(h, true); },
    };
    hinges.push(h);
    return h;
  }
  const _up = new THREE.Vector3(0, 1, 0);
  function apply(h, now) {
    _q.setFromAxisAngle(_up, h.angle).premultiply(h.base);
    if (now) { h.body.setRotation(_q, false); h.obj.quaternion.copy(_q); }
    else h.body.setNextKinematicRotation(_q);
  }
  function sync(b, obj) { const t = b.translation(), r = b.rotation(); obj.position.set(t.x, t.y, t.z); obj.quaternion.set(r.x, r.y, r.z, r.w); }

  /** one step; returns true while something moved */
  function step(dt) {
    let moved = false;
    for (const h of hinges) {
      if (h.angle === h.target) continue;
      const d = h.target - h.angle, s = h.speed * dt;
      h.angle = Math.abs(d) <= s ? h.target : h.angle + Math.sign(d) * s;
      apply(h, false); moved = true;
    }
    world.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    world.step();
    for (const h of hinges) h.obj.quaternion.copy(h.body.rotation());
    for (const { body: b, obj } of moving) if (!b.isSleeping()) { sync(b, obj); moved = true; }
    return moved;
  }

  function ray(from, dir, max = 100, exclude) {
    const r = new R.Ray({ x: from[0], y: from[1], z: from[2] }, { x: dir[0], y: dir[1], z: dir[2] });
    const hit = world.castRay(r, max, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, exclude);
    if (!hit) return null;
    const d = hit.timeOfImpact ?? hit.toi, i = info.get(hit.collider.handle) || {};
    return { point: from.map((v, k) => v + dir[k] * d), distance: d, surface: i.surface || 'default', object: i.object };
  }

  /** a cylinder on a kinematic character controller with the @mirage/play walker's interface */
  function character({ pos = [0, 0, 0], body: B0 = {} } = {}) {
    const B = { radius: 0.28, head: 1.8, eye: 1.62, step: 0.4, walk: 1.5, run: 4.2, gravity, jump: 4.2, stride: 0.75, ...B0 };
    // a cylinder like the walk grid's body: a capsule's round bottom climbs 0.18 m risers at a third of the walking
    // speed under Rapier's autostep (measured), a flat bottom at ~92 %
    const lift = B.head / 2, OFF = 0.02;
    const rb = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1] + lift, pos[2]));
    const col = world.createCollider(R.ColliderDesc.cylinder(lift, B.radius), rb);
    const kcc = world.createCharacterController(OFF);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.enableAutostep(B.step, 0.15, false);      // the walk grid's step: 0.4 m risers, treads >= 0.15 m
    kcc.enableSnapToGround(0.3);
    kcc.setMaxSlopeClimbAngle((46 * Math.PI) / 180);
    kcc.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    kcc.setApplyImpulsesToDynamicBodies(true);
    kcc.setCharacterMass(70);
    const notMe = (c) => c.handle !== col.handle && !c.isSensor();
    const w = { pos: pos.slice(), vy: 0, onGround: false, blocked: false, body: B, collider: col, controller: kcc, walked: 0, surface: 'default', onStride: null };
    w.update = (dt, input = {}) => {
      dt = Math.min(dt, 0.1);
      const speed = input.run ? B.run : B.walk;
      if (w.onGround && input.jump) { w.vy = B.jump; w.onGround = false; }
      w.vy = w.onGround && w.vy <= 0 ? -1 : w.vy - B.gravity * dt;   // a little down force keeps it on stairs going down
      const want = { x: (input.x || 0) * speed * dt, y: w.vy * dt, z: (input.z || 0) * speed * dt };
      kcc.computeColliderMovement(col, want, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, notMe);
      const m = kcc.computedMovement();
      w.pos[0] += m.x; w.pos[1] += m.y; w.pos[2] += m.z;
      rb.setNextKinematicTranslation({ x: w.pos[0], y: w.pos[1] + lift, z: w.pos[2] });
      const h = Math.hypot(want.x, want.z), got = Math.hypot(m.x, m.z);
      w.blocked = h > 1e-4 && got < h * 0.7;
      if (w.vy > 0 && m.y < want.y * 0.5) w.vy = 0;                       // head against a ceiling
      w.onGround = kcc.computedGrounded();
      if (w.onGround && w.vy < 0) w.vy = 0;
      if (w.onGround && got > 0) {                                         // strides: footsteps by surface
        w.walked += got;
        if (w.walked > B.stride * (input.run ? 1.35 : 1)) {
          w.walked = 0;
          const g = ray([w.pos[0], w.pos[1] + 0.2, w.pos[2]], [0, -1, 0], 0.6, col);
          w.surface = g ? g.surface : 'default';
          if (w.onStride) w.onStride(w.surface, input.run);
        }
      }
      return w;
    };
    /** put the feet on the ground under p (searching from p.y + 0.5 down); exact: at p as given (a saved spot) */
    w.place = (p, { exact = false } = {}) => {
      const g = exact ? null : ray([p[0], (p[1] ?? 0) + 0.5, p[2]], [0, -1, 0], 50, col);
      w.pos = [p[0], g ? g.point[1] + OFF : p[1] ?? 0, p[2]];
      rb.setTranslation({ x: w.pos[0], y: w.pos[1] + lift, z: w.pos[2] }, true);
      world.propagateModifiedBodyPositionsToColliders();
      w.vy = 0; w.onGround = true; w.walked = 0;
      return w;
    };
    w.place(pos);
    return w;
  }

  return { R, world, stats, info, addStatic, body, hinge, character, step, ray, hinges };
}
