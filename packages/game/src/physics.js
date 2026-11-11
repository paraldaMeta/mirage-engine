// Mirage original code. Rapier (Apache-2.0, @dimforge/rapier3d-compat 0.19.3) under a built world.
// ---------------------------------------------------------------------------
// const phys = await createPhysics(world.scene)       lazy: the WASM (1.6 MB, inlined as base64) loads here only
//   phys.addStatic(root)        one fixed trimesh collider per solid mesh (the walk grid's rule: visible layer-0
//                               meshes that write depth, minus userData.collide === false, plus collider proxies)
//   phys.body(obj, { shape: 'box' | 'ball', mass })        a dynamic prop; obj follows the body
//   phys.hinge(obj, { half, offset, swing })               a kinematic door leaf turning about obj's origin (y axis)
//   phys.character({ pos })     a kinematic character controller with the @miragekit/play walker's shape
//   phys.step(dt)               one Rapier step; true while anything moved (props awake, a door turning)
//   phys.settle(maxSteps?)      step until every dynamic prop sleeps (a hand-placed pile at rest before the first frame)
//   phys.ray(from, dir, max)    -> { point, distance, surface, object, normal } | null
//   phys.snapshot() / phys.restore(snap)   the whole state (Rapier's own bytes, doors, characters and what the
//                               physics kit keeps); restore swaps in a new Rapier world, so read `phys.world` and
//                               `prop.body` afresh afterwards. More in docs/physics.md and physics-kit.js.
// Surfaces (footsteps): `userData.surface` on the mesh or its material, else 'default'.
// startGame drives the character and step() together at 60 Hz. Low-level callers may still step explicitly.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

let rapierReady;
const MIN_DT = 1 / 90;   // the shortest character move (see character())
/** Share in-flight initialization between mounts; a failed attempt can be retried. */
export function loadRapier() {
  if (!rapierReady) {
    rapierReady = import('@dimforge/rapier3d-compat').then(async module => {
      const rapier = module.default || module;
      await rapier.init();
      return rapier;
    }).catch(error => {
      rapierReady = undefined;
      throw error;
    });
  }
  return rapierReady;
}

const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible || p.userData.collide === false) return false; return true; };
const solid = (o) => (o.isMesh || o.isInstancedMesh) && shown(o) &&
  (o.userData.collider || ((o.layers.mask & 1) && [].concat(o.material).some((m) => m && m.depthWrite !== false && !m.transparent)));
const surfaceOf = (o) => o.userData.surface || [].concat(o.material)[0]?.userData?.surface || 'default';

export async function createPhysics(scene, { gravity = 9.81 } = {}) {
  const R = await loadRapier();
  let world = new R.World({ x: 0, y: -gravity, z: 0 });
  // what createPhysicsKit and its modules hang on this world (all empty without them, and step() is then as before):
  // an event queue for world.step, functions run before and after each step, and their part of a snapshot
  const ext = { queue: undefined, pre: [], post: [], save: {}, load: {}, rebind: [] };
  const chars = [];              // { save, load, rebind } per character, for snapshot / restore
  const info = new Map();        // collider handle -> { surface, object }
  const moving = [];             // { body, obj } synced every step
  const hinges = [];
  const characters = new Set();  // character collider handles
  const stats = { colliders: 0, triangles: 0, buildMs: 0 };
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();

  const skipped = [];
  function addStatic(root = scene) {
    const t0 = performance.now();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!solid(o)) return;
      if (o.isBatchedMesh) { skipped.push(o.name || o.uuid); return; }   // ponytail: no per-instance trimeshes yet; give it a ctx.collider proxy
      const g = o.geometry, pos = g?.attributes?.position, n = o.isInstancedMesh ? o.count : 1;
      if (!pos || !pos.count || !n || (g.index && !g.index.count)) return;   // nothing to collide with (empty geometry, no instances)
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
    if (skipped.length) console.warn(`[mirage physics] BatchedMesh has no collider (give it a ctx.collider proxy): ${skipped.join(', ')}`);
    skipped.length = 0;
    world.step();   // scene queries (rays, the character) see colliders only after a step
    stats.buildMs += performance.now() - t0;
  }

  /** a dynamic prop from obj's bounding box (or a ball); obj must sit in a world-aligned parent */
  function body(obj, { shape = 'box', mass = 10, friction = 0.6, restitution = 0.15, damping = 0.2 } = {}) {
    obj.updateMatrixWorld(true);
    // measure the box in the body's own frame (obj's position and rotation, scale kept): a world-aligned box of a
    // turned prop was larger than the prop, and was then turned once more with the body
    const frame = new THREE.Matrix4().compose(obj.position, obj.quaternion, _one);
    if (obj.parent) frame.premultiply(obj.parent.matrixWorld);
    const inv = frame.invert(), box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4();
    obj.traverse((o) => {
      const g = o.geometry;
      if (!g || !g.attributes?.position) return;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(part.copy(g.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.25, -0.25, -0.25), new THREE.Vector3(0.25, 0.25, 0.25));
    const size = box.getSize(new THREE.Vector3()), off = box.getCenter(new THREE.Vector3());
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(obj.position.x, obj.position.y, obj.position.z)
      .setRotation(obj.quaternion).setLinearDamping(damping).setAngularDamping(damping * 2).setCcdEnabled(true));
    const desc = shape === 'ball' ? R.ColliderDesc.ball(Math.max(size.x, size.y, size.z) / 2) : R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    const col = world.createCollider(desc.setTranslation(off.x, off.y, off.z).setMass(mass).setFriction(friction).setRestitution(restitution), b);
    info.set(col.handle, { surface: surfaceOf(obj), object: obj });
    const entry = { body: b, obj };   // restore() puts the new world's body here
    moving.push(entry);
    return {
      get body() { return entry.body; }, obj,
      get pos() { const t = entry.body.translation(); return [t.x, t.y, t.z]; },
      /** for save / load */
      get state() { const t = entry.body.translation(), r = entry.body.rotation(); return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] }; },
      set state(s) { const b = entry.body; b.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true); b.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); sync(b, obj); },
    };
  }

  /** a kinematic leaf turning about obj's origin (y axis): half extents and the box centre's offset in obj space */
  function hinge(obj, { half, offset = [0, 0, 0], swing = Math.PI / 2, speed = 1.6 } = {}) {
    const base = obj.quaternion.clone();
    const b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(obj.position.x, obj.position.y, obj.position.z).setRotation(base));
    const col = world.createCollider(R.ColliderDesc.cuboid(...half).setTranslation(...offset), b);
    info.set(col.handle, { surface: 'wood', object: obj });
    const h = { body: b, obj, angle: 0, target: 0, swing, speed, base, offset: new THREE.Vector3(...offset),
      open() { h.target = swing; }, close() { h.target = 0; }, toggle() { h.target = h.target ? 0 : swing; },
      get isOpen() { return h.target !== 0; },
      /** jump to a state (load) */
      set(open) { h.target = h.angle = open ? swing : 0; apply(h, true); },
    };
    hinges.push(h);
    return h;
  }
  const _up = new THREE.Vector3(0, 1, 0), _one = new THREE.Vector3(1, 1, 1);
  function apply(h, now) {
    _q.setFromAxisAngle(_up, h.angle).premultiply(h.base);
    if (now) { h.body.setRotation(_q, false); h.obj.quaternion.copy(_q); }
    else h.body.setNextKinematicRotation(_q);
  }
  function sync(b, obj) { const t = b.translation(), r = b.rotation(); obj.position.set(t.x, t.y, t.z); obj.quaternion.set(r.x, r.y, r.z, r.w); }

  // a kinematic leaf does not push the kinematic character: it waits while its next pose would overlap one
  const _p = new THREE.Vector3(), _o = new THREE.Vector3();
  const isCharacter = (c) => characters.has(c.handle);
  function pinches(h, angle) {
    _q.setFromAxisAngle(_up, angle).premultiply(h.base);
    const t = h.body.translation(), c = h.body.collider(0);
    _p.set(t.x, t.y, t.z).add(_o.copy(h.offset).applyQuaternion(_q));
    return !!world.intersectionWithShape(_p, _q, c.shape, undefined, undefined, c, h.body, isCharacter);
  }
  /** one step; returns true while something moved */
  function step(dt) {
    let moved = false;
    for (const h of hinges) {
      if (h.angle === h.target) continue;
      const d = h.target - h.angle, s = h.speed * dt;
      const next = Math.abs(d) <= s ? h.target : h.angle + Math.sign(d) * s;
      if (characters.size && pinches(h, next)) continue;
      h.angle = next;
      apply(h, false); moved = true;
    }
    world.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    for (let i = 0; i < ext.pre.length; i++) ext.pre[i](world.timestep);
    world.step(ext.queue);
    for (const h of hinges) h.obj.quaternion.copy(h.body.rotation());
    for (const { body: b, obj } of moving) if (!b.isSleeping()) { sync(b, obj); moved = true; }
    for (let i = 0; i < ext.post.length; i++) if (ext.post[i](world.timestep)) moved = true;
    return moved;
  }

  /** step until every dynamic prop sleeps (at most maxSteps of 1/60 s); returns the steps taken. A pile of props
   *  set down by hand otherwise settles during the first seconds of play, so what a view shows depends on when it
   *  is drawn (mirage-snap --determinism found it); call it at setup, after the props are made. */
  function settle(maxSteps = 600) {
    let n = 0;
    while (n < maxSteps && moving.some(({ body: b }) => !b.isSleeping())) { step(1 / 60); n++; }
    return n;
  }

  function ray(from, dir, max = 100, exclude) {
    const r = new R.Ray({ x: from[0], y: from[1], z: from[2] }, { x: dir[0], y: dir[1], z: dir[2] });
    const hit = world.castRayAndGetNormal(r, max, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, exclude);
    if (!hit) return null;
    const d = hit.timeOfImpact ?? hit.toi, i = info.get(hit.collider.handle) || {}, n = hit.normal;
    return { point: from.map((v, k) => v + dir[k] * d), distance: d, surface: i.surface || 'default', object: i.object, normal: [n.x, n.y, n.z] };
  }

  /** a cylinder on a kinematic character controller with the @miragekit/play walker's interface */
  function character({ pos = [0, 0, 0], body: B0 = {}, onPlace } = {}) {
    const B = { radius: 0.28, head: 1.8, eye: 1.62, step: 0.4, walk: 1.5, run: 4.2, gravity, jump: 4.2, stride: 0.75, ...B0 };
    // a cylinder like the walk grid's body: a capsule's round bottom climbs 0.18 m risers at a third of the walking
    // speed under Rapier's autostep (measured), a flat bottom at ~92 %
    const lift = B.head / 2, OFF = 0.02;
    let rb = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1] + lift, pos[2]));
    let col = world.createCollider(R.ColliderDesc.cylinder(lift, B.radius), rb);
    characters.add(col.handle);
    const controller = () => {
      const kcc = world.createCharacterController(OFF);
      kcc.setUp({ x: 0, y: 1, z: 0 });
      kcc.enableAutostep(B.step, 0.15, false);      // the walk grid's step: 0.4 m risers, treads >= 0.15 m
      kcc.enableSnapToGround(0.3);
      kcc.setMaxSlopeClimbAngle((46 * Math.PI) / 180);
      kcc.setMinSlopeSlideAngle((40 * Math.PI) / 180);
      kcc.setApplyImpulsesToDynamicBodies(true);
      kcc.setCharacterMass(70);
      return kcc;
    };
    let kcc = controller();
    // sensors are left out by the flag; the predicate must not call back into Rapier (c.isSensor() here left the
    // collider set marked as borrowed for good, and world.free() then threw)
    const notMe = (c) => c.handle !== col.handle;
    const w = { pos: pos.slice(), vy: 0, onGround: false, blocked: false, body: B, collider: col, controller: kcc, walked: 0, surface: 'default', onStride: null };
    // Rapier's autostep needs a move longer than the controller's offset (2 cm): at 120 fps and up a walking step
    // is 1.25 cm or less and the character stopped at snow-hut's bevelled door step (Firefox at 120 Hz). Frames
    // shorter than MIN_DT are added up and moved as one.
    // Only variable-step low-level callers accumulate here. Each game tick is already longer than MIN_DT.
    let acc = 0;
    // Autostep can lift the character without carrying it onto the step: a short last move at a riser ends with the
    // cylinder beside the lip, and the controller's offset then holds it there in the air (garden-quest's 14.5 cm
    // plinth: 17 of 84 last steps at the edge; a save made there loaded 14.5 cm lower). Such a step-up is not taken:
    // the move is dropped and its horizontal part is carried into the next one, which is long enough to land on the
    // step; with no more input the character stays below. Only moves with a horizontal part are checked: autostep
    // needs one, and a character set down inside a step (place() puts the feet under its centre) rises out of it
    // with no input.
    const _down = { x: 0, y: -1, z: 0 }, _rot = { x: 0, y: 0, z: 0, w: 1 };
    const supported = (x, y, z) => !!world.castShape({ x, y: y + lift, z }, _rot, _down, col.shape, 0, OFF + 0.03, true,
      R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, col);
    let carry = null;
    // where place() puts the feet: on the ground under the centre, as before, unless the cylinder there would sit
    // inside something (beside a step: the higher step under its rim); then on the highest thing under the whole
    // cylinder (a shape cast; it stops a few millimetres early, so it is only the fallback)
    const groundUnder = (p) => {
      const top = (p[1] ?? 0) + 0.5, g = ray([p[0], top, p[2]], [0, -1, 0], 50, col);
      const y = g ? g.point[1] + OFF : p[1] ?? 0;
      if (!world.intersectionWithShape({ x: p[0], y: y + lift, z: p[2] }, _rot, col.shape, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, col)) return y;
      const hit = world.castShape({ x: p[0], y: top + lift, z: p[2] }, _rot, _down, col.shape, 0, 50, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, col);
      return hit && hit.time_of_impact > 0 ? top - hit.time_of_impact + OFF : y;
    };
    w.update = (dt, input = {}) => {
      acc += dt;
      if (acc < MIN_DT) return w;
      dt = Math.min(acc, 0.1); acc = 0;
      const speed = input.run ? B.run : B.walk;
      if (w.onGround && input.jump) { w.vy = B.jump; w.onGround = false; }
      w.vy = w.onGround && w.vy <= 0 ? -1 : w.vy - B.gravity * dt;   // a little down force keeps it on stairs going down
      const want = { x: (input.x || 0) * speed * dt, y: w.vy * dt, z: (input.z || 0) * speed * dt };
      if (carry && (want.x || want.z)) { want.x += carry.x; want.z += carry.z; }
      carry = null;
      kcc.computeColliderMovement(col, want, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, notMe);
      let m = kcc.computedMovement();
      if ((want.x || want.z) && m.y > 0.01 && w.vy <= 0 && !supported(w.pos[0] + m.x, w.pos[1] + m.y, w.pos[2] + m.z)) {
        carry = { x: want.x, z: want.z }; m = { x: 0, y: 0, z: 0 };
      }
      // standing still on the ground: the solver's sub-millimetre drift (0.3 mm/s down a gentle slope, +-0.1 mm
      // up and down) is dropped, so a still view stays still; a real push (a door) is centimetres per step
      if (!want.x && !want.z && w.onGround && w.vy <= 0 && Math.hypot(m.x, m.y, m.z) < 0.002) m = { x: 0, y: 0, z: 0 };
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
      carry = null;   // a step-up deferred at the old spot is not a move at the new one
      w.pos = [p[0], exact ? p[1] ?? 0 : groundUnder(p), p[2]];
      const centre = { x: w.pos[0], y: w.pos[1] + lift, z: w.pos[2] };
      rb.setTranslation(centre, true);
      rb.setNextKinematicTranslation(centre);
      world.propagateModifiedBodyPositionsToColliders();
      acc = 0; w.vy = 0; w.onGround = true; w.blocked = false; w.walked = 0;
      onPlace?.();
      return w;
    };
    w.place(pos);
    chars.push({
      save: () => ({ pos: w.pos.slice(), vy: w.vy, onGround: w.onGround, blocked: w.blocked, walked: w.walked, surface: w.surface, acc, carry: carry && { ...carry } }),
      load: (s) => { w.pos = s.pos.slice(); w.vy = s.vy; w.onGround = s.onGround; w.blocked = s.blocked; w.walked = s.walked; w.surface = s.surface; acc = s.acc; carry = s.carry && { ...s.carry }; },
      // handles survive a restore, the objects do not; a controller belongs to its world and is made again
      rebind: () => { rb = world.getRigidBody(rb.handle); col = world.getCollider(col.handle); kcc = controller(); w.collider = col; w.controller = kcc; },
    });
    return w;
  }

  /** The whole state as data: Rapier's snapshot bytes plus what lives outside Rapier (door targets, character
   *  state, the kit's records). A world read back from bytes does not continue bit for bit like the one the
   *  bytes were taken from (measured: 60 stacked boxes differ after 17 steps), but two worlds read from the same
   *  bytes do. So `canonical` (the default) also replaces the live world by its own snapshot: from then on
   *  "carry on" and "restore, then carry on" are the same computation. Pass false to only read the state. */
  function snapshot({ canonical = true } = {}) {
    const snap = { bytes: world.takeSnapshot(), hinges: hinges.map((h) => [h.angle, h.target]), chars: chars.map((c) => c.save()), ext: {} };
    for (const k in ext.save) snap.ext[k] = ext.save[k]();
    if (canonical) restore(snap);
    return snap;
  }
  /** Back to a snapshot of this physics (same bodies, joints and characters: what was created since is dropped
   *  from Rapier, what was removed since comes back without its three.js side). */
  function restore(snap) {
    const next = R.World.restoreSnapshot(snap.bytes);
    if (!next) throw new Error('mirage physics: not a snapshot of this Rapier version');
    world.free();
    world = next;
    for (const m of moving) { m.body = world.getRigidBody(m.body.handle); if (m.body) sync(m.body, m.obj); }
    hinges.forEach((h, i) => { h.body = world.getRigidBody(h.body.handle); if (snap.hinges[i]) [h.angle, h.target] = snap.hinges[i]; h.obj.quaternion.copy(h.body.rotation()); });
    chars.forEach((c, i) => { c.rebind(); if (snap.chars[i]) c.load(snap.chars[i]); });
    for (const f of ext.rebind) f();
    for (const k in ext.load) if (snap.ext[k] !== undefined) ext.load[k](snap.ext[k]);
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    info.clear(); characters.clear(); moving.length = hinges.length = 0;
    world.free();
  }
  return { dispose, R, get world() { return world; }, stats, info, addStatic, body, hinge, character, step, settle, ray, hinges, snapshot, restore, ext };
}
