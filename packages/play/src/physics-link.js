// Mirage original code.
// ---------------------------------------------------------------------------
// One description, two collision worlds: createSolids' moving shapes mirrored into a Rapier world (@miragekit/game's
// createPhysics, or any { R, world }). Nothing is imported here: Rapier arrives as an argument, so @miragekit/play
// still has no physics dependency.
//
//   const phys = await createPhysics(scene);                 // @miragekit/game
//   const link = linkSolids(space, phys);                    // a Rapier body + collider per solid, now and later
//   link.addMover(mover);                                    // the character as a kinematic capsule: crates stop at it
//   each fixed step:  link.pre(); phys.step(dt); link.post(); mover.update(dt, input);
//   link.body(solid) -> the Rapier rigid body
//
// THE RULE (docs/character.md): a solid has one owner of its pose. kind 'kinematic' (doors, lifts, turntables): the
// game calls solid.set(); pre() copies that to Rapier. kind 'dynamic' (crates, barrels): Rapier integrates it;
// post() copies the pose back with solid.set(), so the walker, the camera and the navigation carve see where the
// crate really is. A mover pushes a dynamic solid through space.push, which lands here as an impulse. Shapes are
// built from the same half extents on both sides, so "blocked in one world, free in the other" can only be the
// grid's sampling (a cell, 0.125 m) and one step of latency: play/mover.check.mjs measures both.
// ---------------------------------------------------------------------------

export function linkSolids(space, { R, world }) {
  const bodies = new Map(), movers = [];
  function make(s) {
    const d = s.kind === 'dynamic' ? R.RigidBodyDesc.dynamic() : s.kind === 'static' ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.kinematicPositionBased();
    d.setTranslation(s.pos[0], s.pos[1], s.pos[2]).setRotation({ x: s.quat[0], y: s.quat[1], z: s.quat[2], w: s.quat[3] });
    if (s.kind === 'dynamic') d.setLinearDamping(0.4).setAngularDamping(0.6);
    const body = world.createRigidBody(d);
    const c = s.box ? R.ColliderDesc.cuboid(s.box[0], s.box[1], s.box[2]) : s.cylinder ? R.ColliderDesc.cylinder(s.cylinder[1], s.cylinder[0]) : R.ColliderDesc.ball(s.sphere);
    if (s.kind === 'dynamic') c.setMass(s.mass).setFriction(0.7);
    world.createCollider(c, body);
    bodies.set(s.id, { body, solid: s, rev: s.rev });
  }
  for (const s of space.solids.values()) make(s);
  const off = space.onChange((s, what) => {
    if (what === 'add') make(s);
    else if (what === 'remove') { const b = bodies.get(s.id); if (b) { world.removeRigidBody(b.body); bodies.delete(s.id); } }
  });
  space.onPush = (s, ix, iy, iz, px, py, pz) => { const b = bodies.get(s.id); if (b) b.body.applyImpulseAtPoint({ x: ix, y: iy, z: iz }, { x: px, y: py, z: pz }, true); };
  return {
    bodies,
    body: (s) => bodies.get(s.id)?.body,
    /** the character in Rapier: a kinematic capsule that follows the mover, so dynamic bodies collide with it */
    addMover(m) {
      const B = m.body, body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(m.pos[0], m.pos[1] + B.head / 2, m.pos[2]));
      world.createCollider(R.ColliderDesc.capsule(Math.max(0.01, B.head / 2 - B.radius), B.radius), body);
      movers.push({ m, body });
      return body;
    },
    /** before the physics step: kinematic solids and movers go to where the game put them */
    pre() {
      for (const b of bodies.values()) {
        const s = b.solid;
        if (s.kind !== 'kinematic' || b.rev === s.rev) continue;
        b.rev = s.rev;
        b.body.setNextKinematicTranslation({ x: s.pos[0], y: s.pos[1], z: s.pos[2] });
        b.body.setNextKinematicRotation({ x: s.quat[0], y: s.quat[1], z: s.quat[2], w: s.quat[3] });
      }
      for (const { m, body } of movers) body.setNextKinematicTranslation({ x: m.pos[0], y: m.pos[1] + m.body.head / 2, z: m.pos[2] });
    },
    /** after it: dynamic solids come back from where Rapier put them; true when any moved */
    post() {
      let moved = false;
      for (const b of bodies.values()) {
        const s = b.solid;
        if (s.kind !== 'dynamic') continue;
        const asleep = b.body.isSleeping();
        if (asleep && b.asleep) continue;   // its last step awake still moved it: copied once more, then left alone
        b.asleep = asleep;
        const t = b.body.translation(), r = b.body.rotation(), rev = s.rev;
        s.set({ pos: [t.x, t.y, t.z], quat: [r.x, r.y, r.z, r.w] });
        if (s.rev !== rev) moved = true;
      }
      return moved;
    },
    dispose() { off(); space.onPush = null; for (const b of bodies.values()) world.removeRigidBody(b.body); for (const { body } of movers) world.removeRigidBody(body); bodies.clear(); movers.length = 0; },
  };
}
