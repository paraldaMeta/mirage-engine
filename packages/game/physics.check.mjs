// Node checks of the physics kit: bodies, layers, materials, sensors, contact events, queries, CCD, joints and
// their break force, water, explosions, platforms, the vehicle, the ragdoll, the debug draw, and that a restored
// snapshot stepped N times ends on the same state hash as the run it was taken from.
import * as THREE from 'three';
import { createPhysics } from './src/physics.js';
import { createPhysicsKit } from './src/physics-kit.js';
import { createJoints } from './src/physics-joints.js';
import { createForces } from './src/physics-forces.js';
import { createVehicle } from './src/vehicle.js';
import { createRagdoll } from './src/ragdoll.js';
import { createPhysicsDebug } from './src/physics-debug.js';
import { createRigModel } from '@miragekit/play/rig-model';
import { createAnimator } from '@miragekit/play/anim';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('  ok', m); };
const f = (v) => +v.toFixed(3);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const M = new THREE.MeshBasicMaterial();
async function world(opts, size = 400) {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(size, 1, size), M); floor.position.y = -0.5; scene.add(floor);
  const phys = await createPhysics(scene); phys.addStatic(scene);
  const kit = createPhysicsKit(phys, opts);
  return { scene, phys, kit, run: (n) => { for (let i = 0; i < n; i++) phys.step(1 / 60); } };
}

// ---- the kit off: phys steps as before, and nothing of the kit is in it
{
  const scene = new THREE.Scene();
  const phys = await createPhysics(scene);
  ok(phys.ext && !phys.ext.queue && phys.ext.pre.length === 0 && phys.ext.post.length === 0, 'without a kit: no event queue, no step hooks');
}

// ---- bodies, shapes, materials, layers, sleep, interpolation
{
  const { scene, phys, kit, run } = await world({ layers: ['world', 'prop', 'ghost'] });
  kit.layers.assignStatic('world');
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 2), M); mesh.position.set(0, 3, 0); scene.add(mesh);
  const b = kit.rigid(mesh, { mass: 8, layer: 'prop' });
  ok(near(b.mass, 8, 1e-3) && b.pos[1] === 3, `a box fitted to its mesh, mass ${f(b.mass)} kg`);
  // shapes: each comes to rest on the floor at the height its size says
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 12), M); cyl.position.set(3, 2, 0); scene.add(cyl);
  const tetra = new THREE.Mesh(new THREE.TetrahedronGeometry(0.6), M); tetra.position.set(6, 2, 0); scene.add(tetra);
  const table = new THREE.Group(); table.position.set(9, 2, 0); scene.add(table);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1), M); top.position.y = 0.75; table.add(top);
  for (const [x, z] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), M); leg.position.set(x, 0.35, z); table.add(leg); }
  const bowl = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.15, 6, 12), M); bowl.position.set(12, 0.15, 0); bowl.rotation.x = Math.PI / 2; scene.add(bowl);
  const shapes = { capsule: kit.rigid(null, { shape: 'capsule', radius: 0.25, height: 1.2, pos: [-3, 2, 0] }), ball: kit.rigid(null, { shape: 'ball', radius: 0.4, pos: [-6, 2, 0] }),
    cylinder: kit.rigid(cyl, { shape: 'cylinder' }), hull: kit.rigid(tetra, { shape: 'hull' }), compound: kit.rigid(table, { shape: 'compound' }) };
  kit.rigid(bowl, { shape: 'mesh', type: 'fixed' });
  const marble = kit.rigid(null, { shape: 'ball', radius: 0.1, pos: [12, 1.5, 0], ccd: true });
  ok(shapes.compound.colliders.length === 5, 'a compound body: one collider per child mesh (5)');
  run(360);
  ok(near(shapes.capsule.pos[1], 0.25, 0.03) || near(shapes.capsule.pos[1], 0.6, 0.03), `capsule rests at ${f(shapes.capsule.pos[1])}`);
  ok(near(shapes.ball.pos[1], 0.4, 0.02) && near(shapes.cylinder.pos[1], 0.6, 0.03), `ball at ${f(shapes.ball.pos[1])}, cylinder at ${f(shapes.cylinder.pos[1])}`);
  ok(shapes.hull.pos[1] > 0.1 && shapes.hull.pos[1] < 0.5, `convex hull of a tetrahedron rests at ${f(shapes.hull.pos[1])}`);
  ok(near(shapes.compound.pos[1], 0, 0.03), `the table stands on its legs (origin at ${f(shapes.compound.pos[1])})`);
  ok(Math.hypot(marble.pos[0] - 12, marble.pos[2]) < 0.5 && marble.pos[1] < 0.3, `a marble dropped into a trimesh ring stays inside it (${marble.pos.map(f)})`);
  ok(b.sleeping && near(b.pos[1], 0.25, 0.02), `the box came to rest at ${f(b.pos[1])} and sleeps`);
  const st = kit.stats();
  ok(st.bodies >= 8 && st.awake < st.dynamic && st.stepMs > 0 && st.steps === 360, `stats: ${st.bodies} bodies, ${st.awake} of ${st.dynamic} awake, step ${st.stepMs.toFixed(3)} ms`);

  // materials: restitution and its combine rule, friction and its combine rule
  const rub = kit.rigid(null, { shape: 'ball', radius: 0.2, pos: [20, 2, 0], material: 'rubber', canSleep: false }), stn = kit.rigid(null, { shape: 'ball', radius: 0.2, pos: [22, 2, 0], material: 'stone', canSleep: false });
  let topR = 0, topS = 0, hitR = false, hitS = false;
  for (let i = 0; i < 150; i++) { phys.step(1 / 60); if (rub.pos[1] < 0.25) hitR = true; if (stn.pos[1] < 0.25) hitS = true; if (hitR && rub.velocity[1] > 0) topR = Math.max(topR, rub.pos[1]); if (hitS) topS = Math.max(topS, stn.pos[1]); }
  ok(topR > 1 && topS < 0.5, `rubber (restitution 0.8, combine max) bounces to ${f(topR)} m from 2, stone to ${f(topS)}`);
  kit.material('glue', { friction: 2, frictionCombine: 'max' });
  const slide = (material, z) => kit.rigid(null, { shape: 'box', half: [0.2, 0.2, 0.2], pos: [30, 0.2, z], material, velocity: [6, 0, 0], canSleep: false, lockRotation: true });
  const ice = slide('ice', 0), wood = slide('wood', 2), glue = slide('glue', 4);
  run(120);
  ok(ice.pos[0] - 30 > 10 && wood.pos[0] - 30 < 6 && glue.pos[0] < wood.pos[0], `pushed at 6 m/s: ice slid ${f(ice.pos[0] - 30)} m, wood ${f(wood.pos[0] - 30)}, glue ${f(glue.pos[0] - 30)}`);

  // layers: a ghost falls through props but not the floor; the matrix can be changed afterwards
  kit.layers.collide('ghost', 'prop', false);
  const shelf = kit.rigid(null, { type: 'fixed', shape: 'box', half: [1, 0.1, 1], pos: [40, 1, 0], layer: 'prop' });
  const ghost = kit.rigid(null, { shape: 'ball', radius: 0.2, pos: [40, 2, 0], layer: 'ghost' }), solid = kit.rigid(null, { shape: 'ball', radius: 0.2, pos: [40.5, 2, 0], layer: 'prop' });
  run(120);
  ok(near(ghost.pos[1], 0.2, 0.02) && near(solid.pos[1], 1.3, 0.02), `layer matrix: the ghost passed the shelf (y ${f(ghost.pos[1])}), the prop lies on it (${f(solid.pos[1])})`);
  ok(!kit.layers.collides('ghost', 'prop') && kit.layers.collides('ghost', 'world'), 'layers.collides reads the matrix');
  void shelf;

  // queries and their filters
  const hit = kit.ray([40.5, 5, 0], [0, -1, 0], 10);
  ok(hit && hit.body === solid && near(hit.distance, 3.5, 0.03) && hit.normal[1] > 0.99, `ray: the ball on the shelf at ${f(hit.distance)} m`);
  const under = kit.ray([40.5, 5, 0], [0, -1, 0], 10, { layers: ['world'] });
  ok(under && !under.body && near(under.distance, 5, 1e-3), 'ray with a layer filter: only the floor');
  const all = kit.rayAll([40.5, 5, 0], [0, -1, 0], 10);
  ok(all.length === 3 && all[0].body === solid && all[1].body === shelf && !all[2].body, `rayAll: ${all.length} hits, nearest first`);
  ok(kit.ray([40.5, 5, 0], [0, -1, 0], 10, { exclude: solid }).body === shelf && kit.ray([40.5, 5, 0], [0, -1, 0], 10, { fixed: false }).body === solid, 'ray filters: exclude a body, skip fixed ones');
  const sweep = kit.shapeCast({ shape: 'ball', radius: 0.5 }, [40, 5, 0], [0, -1, 0], 10, { dynamic: false });
  ok(sweep && sweep.body === shelf && near(sweep.distance, 3.4, 0.02), `shape cast: a 0.5 m ball travels ${f(sweep.distance)} m to the shelf`);
  const touching = kit.overlap({ shape: 'box', half: [1, 1, 1] }, [40, 1.5, 0]);
  ok(touching.some((t) => t.body === solid) && touching.some((t) => t.body === shelf) && !touching.some((t) => t.body === ghost), `overlap: ${touching.length} colliders in the box`);
  const cl = kit.closest([40, 3, 0], { test: (s) => s.body === shelf });
  ok(cl && near(cl.distance, 1.9, 1e-3) && !cl.inside, `closest point on the shelf: ${f(cl.distance)} m away`);

  // CCD: a bullet at 300 m/s against a 4 cm wall
  const wall = kit.rigid(null, { type: 'fixed', shape: 'box', half: [2, 2, 0.02], pos: [50, 2, 5] });
  const shoot = (x, ccd) => kit.rigid(null, { shape: 'ball', radius: 0.04, pos: [x, 1, 0], velocity: [0, 0, 300], ccd, gravityScale: 0 });
  const plain = shoot(49.5, false), swept = shoot(50.5, true);
  run(6);
  ok(plain.pos[2] > 5 && swept.pos[2] < 5, `a 300 m/s bullet: without ccd it is past the wall (z ${f(plain.pos[2])}), with ccd it stopped at it (z ${f(swept.pos[2])})`);
  void wall;

  // sensors and contact events
  const zone = kit.sensor({ shape: 'box', half: [1, 1, 1], pos: [60, 1, 0] }, { name: 'zone' });
  const log = []; let contact = null, ended = 0;
  kit.on('enter', (e) => log.push('in:' + e.sensor.name + ':' + (e.body === faller))); kit.on('exit', (e) => log.push('out:' + (e.body === faller)));
  const off = kit.on('contact', (e) => { if (e.a === faller || e.b === faller) contact ||= e; }); kit.on('contactEnd', () => ended++);
  const faller = kit.rigid(null, { shape: 'box', half: [0.2, 0.2, 0.2], pos: [60, 5, 0], mass: 2, events: true, canSleep: false, material: { restitution: 0 } });
  run(50);
  ok(log.length === 1 && log[0] === 'in:zone:true' && zone.count === 1 && zone.bodies()[0] === faller, 'sensor: one enter event, the body is inside');
  run(60);
  // 2 kg from 4.8 m: 9.7 m/s at the floor, so about 19.4 N s to stop it
  ok(contact && near(contact.speed, 9.6, 0.5) && contact.impulse > 5 && contact.impulse < 40 && contact.normal && contact.point[1] < 0.1,
    `contact event: closing at ${f(contact.speed)} m/s, impulse ${f(contact.impulse)} N s in the first step, at y ${f(contact.point[1])}`);
  faller.teleport([70, 3, 0]); run(3);
  ok(log.length === 2 && log[1] === 'out:true' && zone.count === 0 && ended > 0, 'sensor: exit after the body left; contactEnd fired');
  off();

  // fixed steps and interpolation
  const mover = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), M); mover.position.set(80, 5, 0); scene.add(mover);
  const mb = kit.rigid(mover, { velocity: [6, 0, 0], gravityScale: 0, damping: 0 });
  const s0 = kit.steps;
  const n1 = kit.advance(1 / 60), n2 = kit.advance(0.5 / 60);
  ok(n1 === 1 && n2 === 0 && near(kit.alpha, 0.5, 1e-6) && near(mb.pos[0], 80.1, 1e-4) && near(mover.position.x, 80.05, 1e-4), `interpolation: body at ${f(mb.pos[0])}, picture half a step behind at ${f(mover.position.x)}`);
  ok(kit.advance(1) === 5 && kit.steps - s0 === 6, 'a one-second frame takes maxSteps (5), not 60');

  // determinism: snapshot, run, restore, run again
  const snap = phys.snapshot();
  run(90); const h1 = kit.hash(), p1 = mb.pos;
  phys.restore(snap);
  ok(kit.hash() !== h1, 'restore went back (hash differs from the later state)');
  run(90); const h2 = kit.hash();
  ok(h1 === h2 && mb.pos[0] === p1[0], `restore + 90 steps reproduces the state hash (${h1})`);

  // debug draw
  const dbg = createPhysicsDebug(kit, scene);
  const wake = kit.rigid(null, { shape: 'box', half: [0.2, 0.2, 0.2], pos: [0, 0.2, 5], canSleep: false }); run(5); void wake;
  dbg.update();
  ok(dbg.counts.lines > 100 && dbg.counts.contacts > 0 && /bodies \d+/.test(dbg.text()), `debug draw: ${dbg.counts.lines} collider lines, ${dbg.counts.contacts} contact points; "${dbg.text()}"`);
  dbg.dispose();
  ok(!scene.getObjectByName('physics-debug'), 'debug draw disposed: nothing left in the scene');
  kit.dispose();
  ok(!phys.ext.queue && phys.ext.pre.length === 0, 'kit disposed: the event queue and the step hooks are gone');
}

// ---- joints
{
  const { scene, phys, kit, run } = await world();
  const J = createJoints(kit);
  const T = [0, 0.3826834, 0, 0.9238795];   // 45 degrees about y
  // a chain of four 5 kg links from the world: each joint carries what hangs below it
  const js = []; let prev = null;
  for (let i = 0; i < 4; i++) { const b = kit.rigid(null, { shape: 'ball', radius: 0.1, pos: [0, 6 - i * 0.5, 0], mass: 5, canSleep: false }); js.push(J.ball(prev, b, { anchor: [0, 6.25 - i * 0.5, 0], breakForce: 1e9 })); prev = b; }
  run(120);
  ok(js.every((j, i) => near(j.force, (4 - i) * 5 * 9.81, 3)), `joint force estimate on a hanging chain: ${js.map((j) => f(j.force))} N (expected 196, 147, 98, 49)`);
  ok(near(prev.pos[1], 4.5, 0.02), `the chain holds its length (last link at ${f(prev.pos[1])})`);

  // hinge: velocity motor to one limit, back to the other, then a position motor
  const door = kit.rigid(null, { shape: 'box', half: [0.5, 1, 0.05], pos: [20, 1.2, 0], mass: 10, quat: T, canSleep: false });
  const hj = J.hinge(null, door, { anchor: [20 - 0.5 * Math.SQRT1_2, 1.2, 0.5 * Math.SQRT1_2], axis: [0, 1, 0], limits: [-0.6, 0.9], motor: { speed: 1.5 } });
  run(30); const a1 = hj.angle; run(120); const a2 = hj.angle; hj.setMotor({ speed: -1.5 }); run(180); const a3 = hj.angle; hj.setMotor({ target: 0.3, stiffness: 300, damping: 30 }); run(240);
  ok(near(a1, 0.75, 0.1) && near(a2, 0.9, 0.03) && near(a3, -0.6, 0.03) && near(hj.angle, 0.3, 0.03), `hinge: ${f(a1)} rad after 0.5 s at 1.5 rad/s, limits ${f(a2)} / ${f(a3)}, position motor to ${f(hj.angle)}`);

  // slider: falls to its lower limit, sideways it does not move; a position motor lifts it
  const lift = kit.rigid(null, { shape: 'box', half: [0.3, 0.3, 0.3], pos: [25, 3, 0], mass: 4, canSleep: false });
  const sj = J.slider(null, lift, { axis: [0, 1, 0], limits: [-1.2, 0.5] });
  run(180); const t1 = sj.travel; lift.impulse([20, 0, 20]); run(30); sj.setMotor({ target: 0.2, stiffness: 600, damping: 60 }); run(300);
  ok(near(t1, -1.2, 0.03) && near(lift.pos[0], 25, 0.02) && near(lift.pos[2], 0, 0.02) && near(sj.travel, 0.2, 0.05), `slider: rests on its limit at ${f(t1)}, stays on its axis, motor holds ${f(sj.travel)}`);

  // spring: 2 kg on 200 N/m sags m g / k; rope: no longer than its length
  const bob = kit.rigid(null, { shape: 'ball', radius: 0.1, pos: [30, 3, 0], mass: 2, canSleep: false, damping: 0 });
  const sp = J.spring(null, bob, { anchorA: [30, 4, 0], anchorB: [30, 3, 0], rest: 1, stiffness: 200, damping: 10 });
  const rp = kit.rigid(null, { shape: 'ball', radius: 0.1, pos: [35, 3.5, 0], mass: 2, canSleep: false });
  const rj = J.rope(null, rp, { anchorA: [35, 4, 0], anchorB: [35, 3.5, 0], length: 1.5 });
  run(600);
  ok(near(sp.length, 1 + 2 * 9.81 / 200, 0.01), `spring: length ${f(sp.length)} (rest 1 + sag ${f(2 * 9.81 / 200)})`);
  ok(near(rj.length, 1.5, 0.02), `rope: hangs at ${f(rj.length)} of 1.5 m`);

  // six axes: y travel within -0.4..0.1, turning about z within -0.5..0.3, the rest locked
  const six = kit.rigid(null, { shape: 'box', half: [0.5, 0.1, 0.1], pos: [41, 3, 0], mass: 3, canSleep: false });
  J.sixDof(null, six, { anchor: [40.5, 3, 0], linear: { y: [-0.4, 0.1] }, angular: { z: [-0.5, 0.3] } });
  run(300); const q6 = six.quat, rz = 2 * Math.atan2(q6[2], q6[3]);
  ok(rz > -0.53 && rz < -0.3 && Math.abs(q6[0]) < 0.01 && Math.abs(q6[1]) < 0.01 && near(six.pos[2], 0, 0.01), `sixDof: sags to its limits (turn ${f(rz)} of -0.5), locked axes hold`);

  // fixed: a cantilever bar keeps its pose
  const bar = kit.rigid(null, { shape: 'box', half: [0.5, 0.1, 0.1], pos: [45, 3, 0], mass: 8, quat: T });
  const fx = J.fixed(null, bar, { anchor: [44.5, 3, 0], breakForce: 150 });
  run(60);
  ok(fx.alive && near(bar.pos[1], 3, 0.01), `fixed: the bar stays (y ${f(bar.pos[1])}), carrying ${f(fx.force)} N of a 150 N break force`);
  // break: a 20 kg weight lands on it
  let broke = null; kit.on('break', (e) => { broke = e; });
  const whole = phys.snapshot(), jointsThen = kit.stats().joints;
  kit.rigid(null, { shape: 'box', half: [0.2, 0.2, 0.2], pos: [45, 6, 0.35], mass: 20, ccd: true });
  run(150);
  ok(broke && broke.joint === fx && !fx.alive && broke.force > 150 && bar.pos[1] < 1, `breakable joint: broke at ${f(broke.force)} N, the bar fell (y ${f(bar.pos[1])})`);
  ok(kit.stats().joints === phys.world.impulseJoints.len() && phys.world.getImpulseJoint(fx.id)?.handle !== fx.id, 'the broken joint is out of the world');

  // cone: a bar hanging from a shoulder, swing 0.5 from straight out, twist 0.3
  const arm = kit.rigid(null, { shape: 'box', half: [0.5, 0.1, 0.1], pos: [51, 3, 0], mass: 3, canSleep: false });
  const cj = J.cone(null, arm, { anchor: [50.5, 3, 0], axis: [1, 0, 0], swing: 0.5, twist: 0.3 });
  let sw = 0; for (let i = 0; i < 240; i++) { phys.step(1 / 60); if (i > 60) sw = Math.max(sw, cj.swingAngle); }
  arm.twist([0.1, 0, 0]);   // 5 rad/s about its own axis
  let tw = 0; for (let i = 0; i < 60; i++) { phys.step(1 / 60); tw = Math.max(tw, Math.abs(cj.twistAngle)); }
  ok(sw > 0.45 && sw < 0.62 && tw < 0.45, `cone limit (soft): under gravity the swing settles at ${f(sw)} of 0.5 rad, a twist kick reaches ${f(tw)} of 0.3`);

  // ball limits on one axis
  const flap = kit.rigid(null, { shape: 'box', half: [0.5, 0.1, 0.1], pos: [56, 3, 0], mass: 3, canSleep: false });
  J.ball(null, flap, { anchor: [55.5, 3, 0], limits: { z: [-0.5, 0.5], y: [-0.2, 0.2], x: [-0.1, 0.1] } });
  run(300); const qf = flap.quat;
  ok(near(2 * Math.atan2(qf[2], qf[3]), -0.5, 0.05), `ball joint with per-axis limits: hangs at ${f(2 * Math.atan2(qf[2], qf[3]))} of -0.5 rad`);

  // one-axis joints between bodies turned differently are refused, with a reason
  let msg = '';
  try { J.hinge(kit.rigid(null, { pos: [60, 3, 0], half: [0.1, 0.1, 0.1] }), kit.rigid(null, { pos: [61, 3, 0], half: [0.1, 0.1, 0.1], quat: T }), { axis: [1, 0, 0] }); } catch (e) { msg = e.message; }
  ok(/orientation/.test(msg), `a hinge between two differently turned bodies throws: "${msg.slice(0, 60)}..."`);

  // debug draw of joints, and the snapshot carries joints (the broken one stays broken, the motors keep running)
  const dbg = createPhysicsDebug(kit, scene, { colliders: false, contacts: false }); dbg.update();
  ok(dbg.counts.joints >= 10 && dbg.counts.lines === 0, `debug draw: ${dbg.counts.joints} joints`); dbg.dispose();
  const snap = phys.snapshot(); run(60); const h1 = kit.hash(); phys.restore(snap); run(60);
  ok(kit.hash() === h1 && !fx.alive && hj.alive, `joints: restore + 60 steps reproduces the hash (${h1})`);
  phys.restore(whole); run(30);
  ok(fx.alive && near(bar.pos[1], 3, 0.01) && kit.stats().joints === jointsThen && !cj.alive, 'a snapshot from before the break brings the joint back; joints made after it are gone');
}

// ---- forces: water, explosion, platforms
{
  const { phys, kit, run } = await world();
  const F = createForces(kit);
  const pool = F.water({ min: [100, -1, -5], max: [110, 2, 5] });
  const wood = kit.rigid(null, { shape: 'box', half: [0.5, 0.5, 0.5], pos: [105, 3, 0], material: 'wood', quat: [0.2, 0, 0.1, 0.97] });
  const stone = kit.rigid(null, { shape: 'box', half: [0.3, 0.3, 0.3], pos: [103, 3, 0], material: 'stone' });
  run(60); const wet = pool.inside; run(540);
  // wood is 600 kg/m3: 60 % of a 1 m cube under water, so its centre sits 0.1 m under the surface at y 2
  ok(near(wood.pos[1], 1.9, 0.06) && Math.abs(wood.velocity[1]) < 0.05, `buoyancy: the wooden cube floats with its centre at ${f(wood.pos[1])} (expected 1.9)`);
  ok(near(stone.pos[1], 0.3, 0.02), `the stone sank to the bottom (${f(stone.pos[1])})`);
  ok(wet === 2 && pool.inside === 0, `${wet} bodies moving in the water after a second, none once they sleep`);

  const boxes = []; for (let i = 0; i < 5; i++) boxes.push(kit.rigid(null, { shape: 'box', half: [0.25, 0.25, 0.25], pos: [-50 + i * 1.5, 0.25, 0], mass: 5 }));
  const shield = kit.rigid(null, { type: 'fixed', shape: 'box', half: [0.1, 1, 1], pos: [-52, 1, 0] }); void shield;
  const hidden = kit.rigid(null, { shape: 'box', half: [0.25, 0.25, 0.25], pos: [-53, 0.25, 0], mass: 5 });
  run(30);
  const hits = F.explosion([-51, 0.25, 0], { radius: 5, impulse: 50, upward: 0.5, occlude: true });
  ok(hits.length === 3 && hits.every((h, i) => i === 0 || h.impulse <= hits[i - 1].impulse + 1e-6) && hits[0].body === boxes[0], `explosion: ${hits.length} bodies in 5 m, impulses ${hits.map((h) => f(h.impulse))} N s falling with distance`);
  ok(boxes[0].velocity[0] > 3 && boxes[0].velocity[1] > 0 && Math.hypot(...hidden.velocity) < 1e-3, `the nearest box leaves at ${f(boxes[0].velocity[0])} m/s; the one behind the wall is shielded`);
  ok(!hits.some((h) => h.body === boxes[3]) && Math.hypot(...boxes[3].velocity) < 1e-3, 'the box 5.5 m away is out of range');

  const plat = F.platform(null, { half: [2, 0.2, 2], path: [[-100, 1, 0], [-90, 1, 0], [-90, 4, 0]], speed: 2 });
  const rider = kit.rigid(null, { shape: 'box', half: [0.3, 0.3, 0.3], pos: [-100.5, 1.5, 0], mass: 5, material: { friction: 1 } });
  run(10);
  const ch = phys.character({ pos: [-99, 1.25, 0.5] }); F.carry(ch);
  for (let i = 0; i < 360; i++) { ch.update(1 / 60, {}); phys.step(1 / 60); }
  ok(near(plat.pos[0], -90, 0.01) && plat.pos[1] > 2, `platform: along its path to ${plat.pos.map(f)}`);
  ok(near(rider.pos[0] - plat.pos[0], -0.5, 0.4) && near(rider.pos[1] - plat.pos[1], 0.5, 0.03), `a box on it was carried 10 m along and up (it started at -0.5, 0.5 from the centre; now ${f(rider.pos[0] - plat.pos[0])}, ${f(rider.pos[1] - plat.pos[1])})`);
  ok(near(ch.pos[0] - plat.pos[0], 1, 0.4) && ch.onGround, `the character rode it too (offset ${f(ch.pos[0] - plat.pos[0])}, on ground ${ch.onGround})`);
  const snap = phys.snapshot(); run(120); const h1 = kit.hash(); phys.restore(snap); run(120);
  ok(kit.hash() === h1, `forces: restore + 120 steps reproduces the hash (${h1})`);
}

// ---- vehicle
{
  const { phys, kit, run } = await world({}, 4000);
  const car = createVehicle(kit, null, { pos: [0, 1, 0] });
  run(120);
  const load = car.wheels.reduce((s, w) => s + w.load, 0);
  ok(car.grounded === 4 && near(load, 1200 * 9.81, 200), `vehicle: stands on four wheels, springs carry ${f(load)} N of ${f(1200 * 9.81)}`);
  car.controls.throttle = 1; run(180);
  const v3 = car.speed;
  ok(v3 > 8 && v3 < 30 && car.body.pos[2] > 10, `3 s of full throttle: ${f(v3)} m/s, ${f(car.body.pos[2])} m down the road`);
  run(1200);
  ok(car.speed <= car.topSpeed + 0.5 && car.speed > car.topSpeed * 0.8, `top speed: ${f(car.speed)} of ${car.topSpeed} m/s`);
  car.controls.throttle = 0; car.controls.brake = 1; let t = 0; const z0 = car.body.pos[2];
  while (car.speed > 0.1 && t < 1200) { phys.step(1 / 60); t++; }
  ok(t < 600, `brakes: to a stop in ${f(t / 60)} s over ${f(car.body.pos[2] - z0)} m`);
  car.place([20, 0.8, 0]); car.controls.brake = 0; car.controls.throttle = 0.5; car.controls.steer = 1; run(240);
  const q = car.body.quat, upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
  ok(car.body.pos[0] < 19 && upY > 0.9, `steering right turns it towards -x (x ${f(car.body.pos[0])}), upright ${f(upY)}`);
  car.controls.steer = 0; car.controls.throttle = 0; car.controls.handbrake = true; run(600);
  ok(Math.abs(car.speed) < 0.05, `handbrake holds (${f(car.speed)} m/s)`);
  const snap = phys.snapshot(); car.controls.handbrake = false; car.controls.throttle = 1; run(200); const h1 = kit.hash();
  phys.restore(snap); car.controls.handbrake = false; car.controls.throttle = 1; run(200);
  ok(kit.hash() === h1, `vehicle: restore + 200 steps reproduces the hash (${h1})`);
}

// ---- ragdoll
{
  const { scene, phys, kit } = await world();
  const rig = createRigModel(); scene.add(rig.root); rig.root.position.set(2, 0, 1); rig.root.rotation.y = 0.7;
  const anim = createAnimator(rig.root, rig.clips, { rootMotion: { bone: 'Root' }, parameters: { speed: 1.5 }, layers: [{ name: 'base', start: 'move', states: { move: { blend1d: { param: 'speed', points: [[0, 'idle'], [1.5, 'walk'], [4.2, 'run']] } } } }] });
  const rag = createRagdoll(kit, rig.root, { settle: {} });
  const wp = (n) => rig.bones[n].getWorldPosition(new THREE.Vector3());
  // the clips' travel is taken off the root bone and walked by the figure itself, as a game would
  const walk = (mv) => { const c = Math.cos(rig.root.rotation.y), s = Math.sin(rig.root.rotation.y); rig.root.position.x += mv.x * c + mv.z * s; rig.root.position.z += -mv.x * s + mv.z * c; };
  let walking = true;
  const frame = (n, fn) => { for (let i = 0; i < n; i++) { const mv = anim.update(1 / 60); if (walking) walk(mv); kit.advance(1 / 60); rag.update(1 / 60); fn?.(i); } };
  const mass = rag.list.reduce((s, p) => s + p.body.mass, 0);
  ok(rag.list.length === 14 && near(mass, 75, 0.01) && kit.stats().joints === 13, `ragdoll: ${rag.list.length} parts, ${f(mass)} kg, ${kit.stats().joints} joints`);
  frame(30);
  const gap = new THREE.Vector3(...rag.parts.LeftForeArm.body.pos).distanceTo(wp('LeftForeArm'));
  ok(rag.mode === 'animated' && gap < 0.08, `animated: the bodies follow the bones (forearm ${f(gap)} m behind)`);
  const cp = rag.parts.Chest.body.pos, hb = kit.ray([cp[0], cp[1], cp[2] + 5], [0, 0, -1], 20);
  ok(hb && rag.partOf(hb.body), `hit boxes: a ray at the walking figure hits "${hb && rag.partOf(hb.body)}"`);
  rag.ragdoll(); walking = false;
  const v = rag.parts.Hips.body.velocity;
  ok(rag.mode === 'ragdoll' && Math.hypot(v[0], v[2]) > 0.3, `ragdoll(): keeps the animation's speed (hips ${v.map(f)})`);
  let stretch = 0;
  frame(360, () => { for (const p of rag.list) if (p.parent) stretch = Math.max(stretch, p.bone.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...p.body.pos))); });
  const pose = rag.pose();
  ok(rag.atRest && kit.stats().awake === 0 && pose.lying && wp('Head').y < 0.4, `after 6 s it lies still: every part asleep, head at ${f(wp('Head').y)} m, face ${pose.faceUp ? 'up' : 'down'}`);
  ok(Math.min(...rag.list.map((p) => p.body.pos[1])) > 0 && stretch < 0.2, `no part under the floor; the bones never left their bodies by more than ${f(stretch)} m`);
  const knee = rag.parts.LeftLeg.joint.angle, elbow = rag.parts.LeftForeArm.joint.angle;
  ok(knee > -0.2 && knee < 2.5 && elbow > -2.5 && elbow < 0.2, `knee ${f(knee)} within 0..2.3, elbow ${f(elbow)} within -2.3..0 (give 0.2)`);
  const snap = phys.snapshot(); rag.impulse('Chest', [0, 200, 0]); frame(60); const h1 = kit.hash();
  phys.restore(snap); rag.impulse('Chest', [0, 200, 0]); frame(60);
  ok(kit.hash() === h1, `ragdoll: restore + the same kick + 60 steps reproduces the hash (${h1})`);
  frame(300);
  // get up: put the character where the body lies, blend back to the animation
  const at = rag.pose(); rig.root.position.set(at.pos[0], 0, at.pos[2]);
  rag.animate({ blend: 0.5 }); frame(15); const mid = wp('Head').y; frame(25);
  ok(rag.mode === 'animated' && mid > 0.2 && mid < 1.45 && wp('Head').y > 1.4, `blend back: head ${f(mid)} m half way, ${f(wp('Head').y)} m standing, mode ${rag.mode}`);
  // partial: one arm limp on a walking body
  const yR0 = wp('RightHand').y;
  rag.partial(['LeftArm']); frame(120);
  const sh = new THREE.Vector3(...rag.parts.LeftArm.body.pos).distanceTo(wp('LeftArm'));
  ok(rag.mode === 'partial' && sh < 0.08 && Math.abs(wp('RightHand').y - yR0) < 0.25 && rag.parts.LeftArm.dynamic && !rag.parts.Chest.dynamic, `partial: the left arm hangs from an animated chest (shoulder gap ${f(sh)} m)`);
  rag.partial(['LeftArm'], false); frame(40);
  ok(rag.mode === 'animated', 'partial off: animated again');
  // active: every part dynamic and pulled to the animation; it stays up, takes a push and comes back
  rag.ragdoll(); rag.drive(0.8, 0.5); frame(90);
  const up = wp('Head').y;
  rag.impulse('Chest', [150, 0, 0]); frame(6); const pushed = new THREE.Vector3(...rag.parts.Chest.body.pos).distanceTo(rag.parts.Chest.ap); frame(120);
  const back = new THREE.Vector3(...rag.parts.Chest.body.pos).distanceTo(rag.parts.Chest.ap);
  ok(up > 1.3 && pushed > back && back < 0.15, `active ragdoll: head stays at ${f(up)} m; a 150 N s push moves the chest ${f(pushed)} m off the animation, then it is back within ${f(back)}`);
  rag.drive(0, 0); frame(360);
  ok(wp('Head').y < 0.5 && rag.atRest, `drive(0): it falls (head ${f(wp('Head').y)} m) and rests`);
  // a teleported character is placed, not swept
  rag.animate({ blend: 0 }); frame(5);
  rig.root.position.x += 30; frame(2);
  ok(Math.abs(rag.parts.Hips.body.pos[0] - wp('Hips').x) < 0.1 && Math.hypot(...rag.parts.Hips.body.velocity) < 20, 'a figure moved 30 m in one frame: the bodies are placed there');
  rag.dispose();
  ok(kit.stats().joints === 0 && kit.bodies.size === 0, 'ragdoll disposed: its bodies and joints are gone');
}
console.log('physics check: ok');
