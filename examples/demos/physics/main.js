// Demo: the physics kit of @mirage/game in one yard. A box stack and three balls of different materials, a row
// of joints, a ragdoll, a car, a pool, a moving platform, a trigger gate; debug draw and stats on top.
// URL: ?show=stack,joints,ragdoll,vehicle,water,platform (default: all)   ?physics=0 (the yard alone: no Rapier at all)
//      ?boxes=N (stack, default 36)   ?ragdolls=N (default 1)   ?fall=T (ragdoll at T seconds)   ?boom=T (explosion at T)
//      ?cam=orbit | follow (behind the car)   ?auto=1 (the car drives a circle by itself)
//      ?debug=1 (colliders, joints, contacts)   ?hz=60   ?interp=0 (no render interpolation)   ?ccd=0 (bullets tunnel)
//      ?w=&h=  ?ui=0  ?grain=0  ?spp=N  ?time=golden
// Keys: WASD / arrows drive, Space handbrake · R ragdoll / get up · P limp arm · T active ragdoll · E explosion
//       B shoot a ball at the wall · C camera · G debug draw · drag to orbit, wheel to zoom
import * as THREE from 'three';
import { createWorldRenderer } from '@mirage/core';
import { buildWorld, definePlan } from '@mirage/world';
import { createRigModel, createAnimator } from '@mirage/play';
import { createPhysics, createPhysicsKit, createJoints, createForces, createVehicle, createRagdoll, createPhysicsDebug } from '@mirage/game';

const Q = new URLSearchParams(location.search), num = (k, d) => (Q.get(k) == null ? d : +Q.get(k));
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight, spp = num('spp', 2);
const canvas = document.querySelector('canvas'), hud = document.querySelector('#hud');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const world = createWorldRenderer({ canvas, width: W, height: H, place: { lat: 51.5, lon: -0.1, height: 30, tzHours: 0 }, time: Q.get('time') === 'golden' ? 'golden' : new Date(Date.UTC(2026, 5, 21, 15, 30)), preserveDrawingBuffer: true,
  quality: Q.get('quality') || 'high', shadow: { center: [0, 1, 0], radius: 26 }, envProbe: [0, 1.6, 4], fog: { groundDensity: 0.002, height: 30 }, post: { grain: Q.get('grain') === '0' ? 0 : 0.01 } });
const all = ['stack', 'joints', 'ragdoll', 'vehicle', 'water', 'platform'];
const show = new Set((Q.get('show') || 'all') === 'all' ? all : Q.get('show').split(','));
const usePhysics = Q.get('physics') !== '0';

// --- the yard: `statics` gets trimesh colliders, `dyn` holds what the kit moves (and is no part of the walk grid)
const statics = new THREE.Group(), dyn = new THREE.Group(); statics.name = 'statics'; dyn.name = 'dynamic'; dyn.userData.collide = false;
let std = null;
const mesh = (parent, geo, color, x, y, z, rough = 0.85) => { const m = new THREE.Mesh(geo, std({ color, roughness: rough })); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
const box = (parent, w, h, d, color, x, y, z) => mesh(parent, new THREE.BoxGeometry(w, h, d), color, x, y, z);
const plan = definePlan({ name: 'physics', seed: 'physics', bounds: [-60, -60, 60, 60], walk: { yMin: -1, yMax: 4 }, spawn: { eye: [0, 5, 16], look: [0, 1, 0], mode: 'orbit' },
  viewpoints: [{ name: 'yard', eye: [0, 5, 16], look: [0, 1, 0] }] });
const built = await buildWorld(world, { plan, shared: {}, modules: [{ name: 'yard', build(ctx) {
  std = (o) => ctx.mat.std(o);
  box(statics, 240, 1, 240, 0x6f6a58, 0, -0.5, 0).name = 'ground';
  box(statics, 6, 3, 0.04, 0x8d8676, -15.5, 1.5, -9).name = 'thin-wall';                          // 4 cm: what CCD is for
  const ramp = box(statics, 4, 0.3, 9, 0x7d7767, 18, 0.9, 6); ramp.rotation.x = -0.22; ramp.name = 'ramp';
  if (show.has('water')) for (const [w, d, x, z] of [[6.4, 0.2, 9, -6.1], [6.4, 0.2, 9, -11.9], [0.2, 6, 5.9, -9], [0.2, 6, 12.1, -9]]) box(statics, w, 1.2, d, 0x8d8676, x, 0.6, z);
  if (show.has('joints')) { box(statics, 9, 0.15, 0.15, 0x4d4a44, -8, 3.1, 3.4); box(statics, 0.15, 3, 0.15, 0x4d4a44, -12.4, 1.5, 3.4); box(statics, 0.15, 3, 0.15, 0x4d4a44, -3.6, 1.5, 3.4); }
  ctx.root.add(statics, dyn);
} }] });
const { camera, scene } = world;
camera.aspect = W / H; camera.fov = 50; camera.near = 0.1; camera.far = 2000; camera.updateProjectionMatrix();
await world.prepare();

const S = { kit: null, car: null, rags: [], dbg: null, gate: null, worst: 0, broke: 0, shots: 0, booms: 0, time: 0 };
let frame = () => {};
if (usePhysics) {
  const phys = await createPhysics(scene); phys.addStatic(statics);
  const kit = createPhysicsKit(phys, { hz: num('hz', 60), interpolate: Q.get('interp') !== '0', layers: ['default', 'ragdoll', 'debris'], profile: true });
  const joints = createJoints(kit), forces = createForces(kit);
  Object.assign(S, { phys, kit, joints, forces });
  kit.on('contact', (e) => { S.worst = Math.max(S.worst, e.impulse); });
  kit.on('break', () => { S.broke++; });
  const cube = (half, color, x, y, z, o = {}) => { const m = box(dyn, half[0] * 2, half[1] * 2, half[2] * 2, color, x, y, z); return kit.rigid(m, { shape: 'box', half, ...o }); };
  const ball = (r, color, x, y, z, o = {}) => { const m = mesh(dyn, new THREE.SphereGeometry(r, 24, 12), color, x, y, z, 0.5); return kit.rigid(m, { shape: 'ball', radius: r, ...o }); };

  if (show.has('stack')) {
    // a pyramid, and one ball of each of three materials dropped from the same height
    // pyramids of 36 (8 at the bottom), one behind the other
    const n = num('boxes', 36), slots = [];
    for (let row = 0; row < 8; row++) for (let i = 0; i < 8 - row; i++) slots.push([(i - (7 - row) / 2) * 0.62, 0.3 + row * 0.6]);
    for (let k = 0; k < n; k++) { const [x, y] = slots[k % 36]; cube([0.3, 0.3, 0.3], 0x9a7a52, -8 + x, y, -5 - Math.floor(k / 36) * 0.9, { material: 'wood', events: k < 36 }); }
    ball(0.25, 0xc23b3b, -12, 3, -3, { material: 'rubber' }); ball(0.25, 0x8a8f96, -11, 3, -3, { material: 'metal' }); ball(0.25, 0xbfe3f2, -10, 3, -3, { material: 'ice' });
    // a hull and a compound: a wedge and a dumbbell
    const wedge = mesh(dyn, new THREE.ConeGeometry(0.5, 1, 5), 0x7c8a5a, -5, 2, -3); kit.rigid(wedge, { shape: 'hull', material: 'stone' });
    const bar = new THREE.Group(); bar.position.set(-4, 3, -4); dyn.add(bar);
    box(bar, 1.2, 0.12, 0.12, 0x555a60, 0, 0, 0); mesh(bar, new THREE.SphereGeometry(0.25, 16, 8), 0x555a60, -0.6, 0, 0); mesh(bar, new THREE.SphereGeometry(0.25, 16, 8), 0x555a60, 0.6, 0, 0);
    kit.rigid(bar, { colliders: [{ shape: 'box', half: [0.6, 0.06, 0.06] }, { shape: 'ball', radius: 0.25, pos: [-0.6, 0, 0] }, { shape: 'ball', radius: 0.25, pos: [0.6, 0, 0] }], material: 'metal' });
  }
  if (show.has('joints')) {
    const z = 4;
    // a chain of ball joints under the beam
    let prev = null;
    for (let i = 0; i < 6; i++) { const b = cube([0.07, 0.2, 0.07], 0xb9a15a, -12, 2.75 - i * 0.42, z, { material: 'metal' }); joints.ball(prev, b, { anchor: [-12, 2.96 - i * 0.42, z] }); prev = b; }
    // a door on a limited hinge with a motor that swings it
    const door = cube([0.5, 0.9, 0.04], 0x7a5a3a, -10, 1, z); S.door = joints.hinge(null, door, { anchor: [-10.5, 1, z], axis: [0, 1, 0], limits: [-1.2, 1.2], motor: { speed: 1.2, strength: 40 } });
    // a slider with a position motor, a spring, a rope
    const sl = cube([0.25, 0.25, 0.25], 0x5a7a9a, -8.5, 0.6, z); S.slider = joints.slider(null, sl, { anchor: [-8.5, 0.6, z], axis: [0, 1, 0], limits: [0, 1.6], motor: { target: 1.2, stiffness: 400, damping: 40 } });
    const sp = ball(0.22, 0x9a5a8a, -7, 1.4, z); joints.spring(null, sp, { anchorA: [-7, 3, z], anchorB: [-7, 1.4, z], rest: 1.2, stiffness: 40, damping: 1.5 });
    const rp = ball(0.22, 0x5a9a6a, -5.6, 1.2, z + 0.8); joints.rope(null, rp, { anchorA: [-6, 3, z], anchorB: [-5.6, 1.2, z + 0.8], length: 2 });
    // a plank fixed to the world by a joint that breaks at 400 N: the weight above it falls on it after 2 s
    const plank = cube([0.8, 0.05, 0.2], 0xa98a5a, -3.4, 1.6, z, { material: 'wood', mass: 5 }); S.fuse = joints.fixed(null, plank, { anchor: [-4.2, 1.6, z], breakForce: 400, name: 'fuse' });
    S.weight = cube([0.25, 0.25, 0.25], 0x3d4046, -3.0, 2.2, z, { material: 'metal', mass: 60, gravityScale: 0 });
  }
  if (show.has('water')) {
    S.water = forces.water({ min: [6, 0, -12], max: [12, 1, -6] }, { flow: [0.3, 0, 0] });
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f6f8f, transparent: true, opacity: 0.55, roughness: 0.15, depthWrite: false }));
    surf.position.set(9, 1, -9); surf.userData.collide = false; dyn.add(surf);
    cube([0.3, 0.3, 0.3], 0x9a7a52, 8, 2.5, -9, { material: 'wood' }); cube([0.3, 0.3, 0.3], 0x77736b, 10, 2.5, -8, { material: 'stone' }); ball(0.3, 0xc23b3b, 9, 3, -10, { material: 'rubber', mass: 30 });
  }
  if (show.has('platform')) {
    const lift = box(dyn, 2.4, 0.2, 2.4, 0x566270, 2, 0.1, 6);
    S.lift = forces.platform(lift, { half: [1.2, 0.1, 1.2], path: [[2, 0.1, 6], [2, 2.6, 6], [7, 2.6, 6]], speed: 1.2 });
    cube([0.3, 0.3, 0.3], 0x9a7a52, 2, 0.6, 6, { material: 'wood' });
  }
  if (show.has('ragdoll')) {
    kit.layers.collide('ragdoll', 'ragdoll', true);
    for (let i = 0, n = num('ragdolls', 1); i < n; i++) {
      const rig = createRigModel(); rig.root.position.set(1.5 * (i % 5), i >= 5 ? 1 + Math.floor(i / 5) * 2 : 0, -1.2 * (i % 2)); rig.root.rotation.y = 0.4 + i; rig.root.userData.collide = false; scene.add(rig.root);
      const anim = createAnimator(rig.root, rig.clips, { layers: [{ name: 'base', start: 'idle', states: { idle: { clip: 'idle' } } }] });
      const rag = createRagdoll(kit, rig.root, { layer: 'ragdoll', settle: {} });
      S.rags.push({ rig, anim, rag });
    }
    // the trigger: a gate the bodies and the car pass through
    S.gate = kit.sensor({ shape: 'box', half: [3, 1.5, 0.3], pos: [0, 1.5, 9] }, { name: 'gate' });
  }
  if (show.has('vehicle')) {
    const chassis = new THREE.Group(); chassis.position.set(14, 1.2, -2); chassis.rotation.y = Math.PI; dyn.add(chassis);
    box(chassis, 1.7, 0.5, 3.8, 0xa33a2e, 0, 0, 0); box(chassis, 1.5, 0.45, 1.8, 0x2c2f33, 0, 0.45, -0.3);
    const wheels = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => {
      const w = mesh(chassis, new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20).rotateZ(Math.PI / 2), 0x1b1b1d, 0, 0, 0);
      return { pos: [sx * 0.85, -0.1, sz * 1.3], steer: sz > 0, drive: sz < 0, obj: w };
    });
    S.car = createVehicle(kit, chassis, { half: [0.85, 0.25, 1.9], wheels, events: true });
  }
  if (Q.get('debug') === '1') S.dbg = createPhysicsDebug(kit, scene);

  // --- actions
  const key = new Set();
  const act = {
    ragdoll() { for (const r of S.rags) { if (r.rag.mode === 'animated') r.rag.ragdoll({ velocity: [0, 0, 1.5] }); else { const p = r.rag.pose(); r.rig.root.position.set(p.pos[0], 0, p.pos[2]); r.rig.root.rotation.y = p.yaw; r.rag.drive(0, 0); r.rag.animate({ blend: 0.7 }); } } },
    limp() { for (const r of S.rags) r.rag.partial(['LeftArm'], r.rag.mode !== 'partial'); },
    active() { for (const r of S.rags) { r.rag.ragdoll(); r.rag.drive(0.8, 0.5); } },
    boom(at = [-8, 0.3, -4.2]) { S.booms++; return forces.explosion(at, { radius: 6, impulse: 260, upward: 0.4, occlude: true }); },
    shoot() { S.shots++; return ball(0.08, 0x222222, -15.8 + (S.shots % 3) * 0.3, 1.5, 7.3, { velocity: [0, 0, -150], ccd: Q.get('ccd') !== '0', mass: 0.5, layer: 'debris', name: 'bullet' }); },
    debug() { if (S.dbg) S.dbg.visible = !S.dbg.visible; else S.dbg = createPhysicsDebug(kit, scene); },
  };
  S.act = act;
  addEventListener('keydown', (e) => { key.add(e.code); ({ KeyR: act.ragdoll, KeyP: act.limp, KeyT: act.active, KeyE: () => act.boom(), KeyB: act.shoot, KeyG: act.debug, KeyC: () => { cam.follow = !cam.follow; } })[e.code]?.(); });
  addEventListener('keyup', (e) => key.delete(e.code));
  const fall = num('fall', -1), boom = num('boom', -1), auto = Q.get('auto') === '1';
  let fell = false, boomed = false, dropped = false;
  frame = (dt) => {
    S.time += dt;
    if (S.car) {
      const c = S.car.controls, d = (a, b) => (key.has(a) || key.has(b) ? 1 : 0);
      c.throttle = auto ? 0.6 : d('KeyW', 'ArrowUp') - d('KeyS', 'ArrowDown'); c.steer = auto ? 0.35 : d('KeyD', 'ArrowRight') - d('KeyA', 'ArrowLeft'); c.handbrake = key.has('Space');
    }
    if (S.door && Math.abs(S.door.angle) > 1.1) S.door.setMotor({ speed: S.door.angle > 0 ? -1.2 : 1.2, strength: 40 });
    if (S.weight && !dropped && S.time > 2) { dropped = true; S.weight.body.setGravityScale(1, true); S.weight.wake(); }
    if (fall >= 0 && !fell && S.time >= fall) { fell = true; act.ragdoll(); }
    if (boom >= 0 && !boomed && S.time >= boom) { boomed = true; act.boom(); }
    for (const r of S.rags) r.anim.update(dt);
    kit.advance(dt);
    for (const r of S.rags) r.rag.update(dt);
    S.dbg?.update();
  };
}

// --- camera: orbit by drag and wheel, or behind the car
const cam = { follow: Q.get('cam') === 'follow', yaw: 0, pitch: 0.3, dist: 17, target: new THREE.Vector3(0, 1, 0), pos: new THREE.Vector3() };
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (!drag) return; cam.yaw -= (e.clientX - drag[0]) * 0.005; cam.pitch = Math.min(1.5, Math.max(0.02, cam.pitch + (e.clientY - drag[1]) * 0.005)); drag = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { cam.dist = Math.min(80, Math.max(3, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); e.preventDefault(); }, { passive: false });
const _f = new THREE.Vector3(), _want = new THREE.Vector3();
function aim(dt) {
  if (cam.follow && S.car) {
    // behind and above the chassis' heading, eased so bumps and spins do not shake the picture
    const o = S.car.obj; _f.set(0, 0, 1).applyQuaternion(o.quaternion); _f.y = 0; _f.normalize();
    _want.copy(o.position).addScaledVector(_f, -7.5).add(_f.set(0, 3, 0));
    if (dt <= 0 || !cam.pos.lengthSq()) cam.pos.copy(_want); else cam.pos.lerp(_want, 1 - Math.exp(-dt * 4));
    cam.pos.y = Math.max(cam.pos.y, 0.6);
    camera.position.copy(cam.pos); camera.lookAt(o.position.x, o.position.y + 0.8, o.position.z);
  } else {
    camera.position.set(cam.target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist, cam.target.y + Math.sin(cam.pitch) * cam.dist, cam.target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
    camera.lookAt(cam.target);
  }
}
const text = () => {
  if (!S.kit) return 'physics off (?physics=0): the yard alone';
  const s = S.kit.stats(), r = S.rags[0], c = S.car;
  return `bodies ${s.bodies} (awake ${s.awake} of ${s.dynamic})  colliders ${s.colliders}  joints ${s.joints}  step ${s.stepMs.toFixed(2)} ms (avg ${s.stepMsAvg.toFixed(2)})  ${S.kit.hz} Hz\n`
    + `${c ? `car ${(c.speed * 3.6).toFixed(0)} km/h, ${c.grounded} wheels down   ` : ''}${r ? `ragdoll: ${r.rag.mode}${r.rag.atRest && r.rag.mode === 'ragdoll' ? ' (at rest)' : ''}   ` : ''}${S.gate ? `in the gate: ${S.gate.count}   ` : ''}`
    + `${S.water ? `in the water: ${S.water.inside}   ` : ''}hardest hit ${S.worst.toFixed(0)} N s   joints broken ${S.broke}\n`
    + 'WASD drive · Space handbrake · R ragdoll / get up · P limp arm · T active · E explosion · B shoot · C camera · G debug';
};
let T = 0, last = null, running = true;
const render = (o = {}) => { aim(o.dt ?? 0); world.renderFrame(o.T ?? T, { spp, frameIndex: 1, ...o }); };
requestAnimationFrame(function loop(now) {
  requestAnimationFrame(loop);
  if (!running) { last = null; return; }
  const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1); last = now; T += dt;
  frame(dt); render({ dt });
});
if (Q.get('ui') !== '0') setInterval(() => { hud.textContent = text(); }, 250);
// for checks: stop the clock, then step(n) advances n frames of dt with nothing depending on wall time
window.__mirage = { world, built, THREE, S, cam, text, render, stop() { running = false; }, start() { running = true; }, step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { T += dt; frame(dt); } } };
window.__READY = true;
