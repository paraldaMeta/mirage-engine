// Demo: the destructibles of @miragekit/game in a small shooting range at night. A glass wall, a shelf of bottles and
// cans, crates and cardboard, a string of bulbs and a neon tube that light the room (lamp pool lamps) and go out, a
// hung sign, a fuel can, a fire extinguisher, a vending cabinet that spills, a tyre, a dummy, and one sign of the
// owner's that never breaks. Click to shoot; the tally is on the right.
// URL: ?dx=0 (the room with no destructibles at all) | ?dx=empty (createDestructibles, nothing registered)
//      ?w=&h=  ?ui=0  ?dpr=1  ?detail=0..1  ?spp=N (stills)  ?seed=...
// Keys: click pistol · S or shift-click shotgun · B blast where you aim · R reset · K snapshot · L restore · D detail
//       drag to look round
import * as THREE from 'three';
import { createWorldRenderer, placeDate, createVfx } from '@miragekit/core';
import { buildWorld, definePlan } from '@miragekit/world';
import { createPhysics, createAudio, createDestructibles } from '@miragekit/game';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight, mode = Q.get('dx') ?? 'on';
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const world = createWorldRenderer({ canvas, width: W, height: H, place: { lat: 51.5, lon: -0.1, height: 30, tzHours: 0 }, time: placeDate('2026-01-15', '23:30', 0), preserveDrawingBuffer: true,
  pixelRatio: +Q.get('dpr') || undefined, quality: Q.get('quality') || 'high', lampPool: { perCell: 32 }, shadow: { center: [0, 1.5, -6], radius: 12 }, envProbe: [0, 1.6, -5], post: { grain: 0 } });

// ---- the room (static: Rapier colliders) and the props (drawn here, registered below)
const P = {};
const plan = definePlan({ name: 'destruct', seed: 'destruct', bounds: [-8, -14, 8, 6], walk: { yMin: -1, yMax: 4 }, spawn: { eye: [0, 1.6, 1.6], look: [0, 1.25, -6], mode: 'orbit' },
  viewpoints: [{ name: 'range', eye: [0, 1.6, 1.6], look: [0, 1.25, -6] }] });
const statics = new THREE.Group(); statics.name = 'statics';
const props = new THREE.Group(); props.name = 'props'; props.userData.collide = false;
const lamps = [];   // the pool: index = place in this list
const lamp = (pos, o = {}) => { lamps.push({ pos, range: 4, power: 0.9, color: [1, 0.62, 0.3], ...o }); return lamps.length - 1; };
await buildWorld(world, { plan, shared: {}, modules: [{ name: 'range', build(ctx) {
  const std = (o) => ctx.mat.std({ roughness: 0.85, ...o });
  const box = (parent, w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const concrete = std({ color: 0x8a867e }), wall = std({ color: 0x6e6a64 }), wood = std({ color: 0x7a5636, roughness: 0.8 }), dark = std({ color: 0x2a2826, roughness: 0.6 }), steel = std({ color: 0x8a8e92, metalness: 0.8, roughness: 0.35 });
  box(statics, 12, 0.2, 18, concrete, 0, -0.1, -4);
  box(statics, 12, 0.2, 18, wall, 0, 3.7, -4);
  box(statics, 12, 3.6, 0.3, wall, 0, 1.8, -12.15);
  box(statics, 0.3, 3.6, 18, wall, -6.15, 1.8, -4); box(statics, 0.3, 3.6, 18, wall, 6.15, 1.8, -4);
  // the glass wall's frame (the panes are props)
  for (const x of [-4.4, -2.9, -1.4]) box(statics, 0.08, 2.4, 0.12, steel, x, 1.2, -3);
  box(statics, 3.1, 0.1, 0.14, steel, -2.9, 2.4, -3);
  // the shelf
  box(statics, 1.8, 0.04, 0.4, wood, 3.6, 0.9, -5.2); box(statics, 1.8, 0.04, 0.4, wood, 3.6, 1.5, -5.2);
  for (const x of [2.72, 4.48]) box(statics, 0.04, 1.6, 0.4, wood, x, 0.8, -5.2);
  // the vending cabinet's body and the sign's rods
  box(statics, 0.9, 1.9, 0.7, std({ color: 0x324a5e, metalness: 0.4, roughness: 0.45 }), -5.5, 0.95, -9);
  ctx.root.add(statics, props);

  // ---- props
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe4ea, roughness: 0.04, metalness: 0, transmission: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  glassMat.name = 'range:glass';
  P.panes = [-3.65, -2.15].map((x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.42, 2.28, 0.012), glassMat); m.position.set(x, 1.16, -3); props.add(m); return m; });
  const bottleGeo = new THREE.LatheGeometry([[0, 0], [0.036, 0], [0.038, 0.01], [0.038, 0.17], [0.03, 0.2], [0.013, 0.235], [0.013, 0.28], [0, 0.28]].map(([x, y]) => new THREE.Vector2(x, y)), 14).translate(0, -0.14, 0);
  P.bottles = new THREE.InstancedMesh(bottleGeo, std({ color: 0xffffff, roughness: 0.12, metalness: 0.1 }), 10);
  const bcol = [0x2f6b3a, 0x6b4a1f, 0x7aa8b0, 0x2f6b3a, 0x8a2a2a];
  for (let i = 0; i < 10; i++) { P.bottles.setMatrixAt(i, new THREE.Matrix4().makeTranslation(2.95 + (i % 5) * 0.3, 1.66, -5.2)); P.bottles.setColorAt(i, new THREE.Color(bcol[i % 5])); }
  for (let i = 0; i < 5; i++) P.bottles.setMatrixAt(i, new THREE.Matrix4().makeTranslation(2.95 + i * 0.3, 1.06, -5.12));
  P.bottles.castShadow = true; props.add(P.bottles);
  P.cans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.033, 0.033, 0.122, 14), std({ color: 0xffffff, metalness: 0.75, roughness: 0.3 }), 8);
  const ccol = [0xc8302a, 0x2a6ac8, 0xd8c040, 0x3a9a4a];
  for (let i = 0; i < 8; i++) { P.cans.setMatrixAt(i, new THREE.Matrix4().makeTranslation(3.0 + (i % 4) * 0.42 + (i < 4 ? 0.15 : 0), i < 4 ? 0.981 : 1.581, -5.32)); P.cans.setColorAt(i, new THREE.Color(ccol[i % 4])); }
  P.cans.castShadow = true; props.add(P.cans);
  P.crates = [[-0.6, -7], [0.2, -7.2], [-0.2, -6.4]].map(([x, z], i) => { const m = box(props, 0.62, 0.62, 0.62, std({ color: 0x8a6440, roughness: 0.9 }), x, 0.31 + (i === 2 ? 0 : 0), z); m.rotation.y = i * 0.4; return m; });
  P.boxes = [[1.8, 0.2, -7.5], [2.25, 0.2, -7.4], [2.0, 0.6, -7.45], [1.9, 0.2, -6.9]].map(([x, y, z], i) => { const m = box(props, 0.42, 0.4, 0.42, std({ color: 0xa8875a, roughness: 0.95 }), x, y, z); m.rotation.y = i * 0.3; return m; });
  // the bulb string: bulbs on a sagging wire across the room, each a pool lamp
  const bulbGlow = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffc070, emissiveIntensity: 6 });
  P.bulbs = [];
  for (let i = 0; i < 10; i++) {
    const x = -4.5 + i, y = 3.25 - 0.35 * (1 - ((x / 4.5) ** 2)), m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), bulbGlow.clone());
    m.position.set(x, y, -6); props.add(m);
    P.bulbs.push({ mesh: m, lamp: lamp([x, y - 0.1, -6], { range: 4, power: 1.0, color: [1, 0.66, 0.32] }) });
  }
  const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P.bulbs.map((b) => b.mesh.position.clone().add(new THREE.Vector3(0, 0.06, 0)))), 40, 0.006, 4), dark); props.add(wire);
  // the neon tube on the back wall: three pool lamps along it
  P.neon = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x220a18, emissive: 0xff3aa0, emissiveIntensity: 9 }));
  P.neon.position.set(-0.6, 2.7, -11.9); props.add(P.neon);
  P.neonLamps = [-1.6, -0.6, 0.4].map((x) => lamp([x, 2.7, -11.75], { range: 5, power: 2.4, color: [1, 0.25, 0.65], normal: [0, 0, 1], back: 0.2 }));
  // the hung sign over a box
  P.sign = box(props, 1.2, 0.45, 0.05, std({ color: 0xc8b048, metalness: 0.6, roughness: 0.4 }), -2.6, 2.3, -8.6);
  P.signRods = [-3.1, -2.1].map((x) => box(props, 0.015, 1.15, 0.015, steel, x, 3.1, -8.6));
  P.under = box(props, 0.5, 0.45, 0.5, std({ color: 0xa8875a, roughness: 0.95 }), -2.6, 0.225, -8.6);
  // fuel can by the crates, an extinguisher, a tyre, the vending cabinet's lit front, the dummy
  P.fuel = box(props, 0.26, 0.36, 0.16, std({ color: 0xb8241c, metalness: 0.5, roughness: 0.4 }), 0.75, 0.18, -7.6);
  P.ext = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.52, 16), std({ color: 0xc81e1e, metalness: 0.4, roughness: 0.35 })); P.ext.position.set(5.6, 0.26, -9.2); P.ext.castShadow = true; props.add(P.ext);
  P.tyre = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 12, 28).rotateY(Math.PI / 2.4), std({ color: 0x18181a, roughness: 0.9 })); P.tyre.position.set(3.4, 0.42, -9.6); P.tyre.castShadow = true; props.add(P.tyre);
  P.vendFront = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.4), new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x6ad8ff, emissiveIntensity: 2.2 }));
  P.vendFront.position.set(-5.04, 1.15, -9); P.vendFront.rotation.y = Math.PI / 2; props.add(P.vendFront);
  P.vendLamp = lamp([-4.7, 1.2, -9], { range: 3.6, power: 1.4, color: [0.45, 0.8, 1] });
  const skin = std({ color: 0xd8c8a0, roughness: 0.7 });
  P.dummy = [[0.36, 0.86, 0.22, 0.43], [0.46, 0.62, 0.26, 1.18], [0.24, 0.26, 0.24, 1.64]].map(([w, h, d, y]) => box(props, w, h, d, skin, -2.2, y, -10.6));
  // the owner's sign: protected, it never breaks
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#081018'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#7af0c8'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('OWNER SIGN', 128, 43);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  P.owner = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.6 }));
  P.owner.position.set(3.4, 2.5, -11.98); props.add(P.owner);
  lamp([3.4, 2.5, -11.8], { range: 3, power: 0.5, color: [0.4, 1, 0.8], normal: [0, 0, 1], back: 0.2 });
  lamp([0, 3.4, -1.5], { range: 7, power: 1.2, color: [1, 0.9, 0.8] });   // work lights (not breakable)
  lamp([0, 3.4, -9], { range: 7, power: 0.9, color: [1, 0.9, 0.8] });
} }] });
world.lampPool.set(lamps);
const { camera, scene } = world;
camera.aspect = W / H; camera.fov = 58; camera.near = 0.05; camera.far = 200; camera.updateProjectionMatrix();
camera.position.set(0, 1.6, 1.6); camera.lookAt(0, 1.25, -6);

// ---- physics (the room's colliders: the occluder for blasts and the floor for debris), effects, sound
const physics = await createPhysics(scene); physics.addStatic(statics);
const vfx = createVfx(world, { maxParticles: 200000 });
const audio = createAudio({ volumes: { sfx: 0.9 } });
let d = null;
if (mode !== '0') {
  d = createDestructibles({ physics, audio, world, root: props }, { seed: Q.get('seed') || 'range', vfx, detail: Q.get('detail') == null ? 1 : +Q.get('detail') });
  if (mode !== 'empty') register(d);
  physics.step(1 / 60);   // the solid panes' colliders, for the queries
  d.prewarm();
}
function register(d) {
  P.panes.forEach((m, i) => d.add({ id: 'pane' + i, draw: m, material: 'glass', solid: true, health: 60, value: 120, tags: ['window'] }));
  for (let i = 0; i < 10; i++) d.add({ id: 'bottle' + i, draw: { mesh: P.bottles, index: i }, material: 'glass', health: 6, value: 9, tags: ['bar'], debris: { count: 18, size: [0.012, 0.06] } });
  for (let i = 0; i < 8; i++) d.add({ id: 'can' + i, draw: { mesh: P.cans, index: i }, material: 'thinMetal', mover: { shape: 'cylinder', breakable: false, mass: 0.33 }, value: 0, tags: ['bar'] });
  P.crates.forEach((m, i) => d.add({ id: 'crate' + i, draw: m, material: 'wood', broken: 'crate', health: 70, value: 25 }));
  P.boxes.forEach((m, i) => d.add({ id: 'box' + i, draw: m, material: 'cardboard', value: 4, behave: i === 3 ? { dropLoot: { table: [{ id: 'ammo' }] } } : undefined }));
  P.bulbs.forEach((b, i) => d.add({ id: 'bulb' + i, draw: b.mesh, material: 'glass', health: 4, group: 'bulbs', sphere: { center: b.mesh.position.toArray(), radius: 0.07 }, lamps: [b.lamp], emissive: b.mesh.material,
    behave: { chain: { delay: 0.11 } }, value: 2, tags: ['lights'], debris: { count: 10, size: [0.008, 0.03] } }));
  d.add({ id: 'neon', draw: P.neon, material: 'glass', health: 12, lamps: P.neonLamps, emissive: P.neon.material, lampMode: 'flicker', value: 300, tags: ['lights'], sound: 'glass', debris: { count: 26, size: [0.01, 0.07] } });
  d.add({ id: 'sign', draw: [P.sign, ...P.signRods], material: 'thinMetal', health: 20, value: 80, box: { center: [-2.6, 2.3, -8.6], half: [0.6, 0.225, 0.04] }, behave: { fall: { damage: 90, radius: 0.8 } } });
  d.add({ id: 'under-sign', draw: P.under, material: 'cardboard', value: 4 });
  d.add({ id: 'fuel', draw: P.fuel, material: 'thinMetal', health: 20, value: 30, behave: { explosive: { delay: 0.55, radius: 3.4, damage: 220 } }, tags: ['hazard'] });
  d.add({ id: 'extinguisher', draw: P.ext, material: 'thinMetal', health: 26, value: 60, broken: 'dent', behave: { ventSteam: { duration: 7, radius: 0.9, height: 2.4 } } });
  d.add({ id: 'tyre', draw: P.tyre, material: 'plastic', health: 40, armour: { bullet: 0.7 }, broken: 'tyre', value: 90, sound: 'fabric', debris: { count: 5, colors: ['#18181a'] } });
  d.add({ id: 'vending', draw: P.vendFront, material: 'electronics', health: 60, value: 1500, box: { center: [-5.5, 0.95, -9], half: [0.46, 0.95, 0.36] }, lamps: [P.vendLamp], emissive: P.vendFront.material,
    lampMode: 'flicker', behave: { spillLiquid: { radius: 1.1, conductive: true } }, tags: ['vending'] });
  d.actor({ id: 'dummy', parts: P.dummy.map((m, i) => ({ draw: m, lag: i * 0.12 })), pos: [-2.2, 0, -10.6], height: 1.8, radius: 0.3, health: 60, tags: ['civilian'] });
  d.add({ id: 'owner-sign', draw: P.owner, material: 'glass', protected: true, box: { center: [3.4, 2.5, -11.98], half: [0.8, 0.2, 0.02] }, tags: ['owner'] });
}

// ---- shooting
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3();
const S = { weapon: 'pistol', shots: 0, T: 0, saved: null, frames: 0, ms: 0, dt: 0 };
const PRNG = (() => { let s = 99; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); })();
function aim(x, y) { ndc.set(x, y); ray.setFromCamera(ndc, camera); return ray.ray.direction.toArray(); }
/** one shot from the camera through screen point (x, y) in -1..1 */
function shoot(x = 0, y = 0, weapon = S.weapon) {
  audio.unlock(); S.shots++;
  const o = camera.position.toArray(), base = aim(x, y);
  const pellets = weapon === 'shotgun' ? 9 : 1, spread = weapon === 'shotgun' ? 0.045 : 0;
  fwd.fromArray(base); right.crossVectors(fwd, upv.set(0, 1, 0)).normalize(); upv.crossVectors(right, fwd);
  for (let k = 0; k < pellets; k++) {
    const a = PRNG() * 6.283, r = Math.sqrt(PRNG()) * spread, dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).normalize().toArray();
    const res = d ? d.hit({ ray: { origin: o, dir, max: 60 }, kind: pellets > 1 ? 'pellet' : 'bullet', damage: pellets > 1 ? 12 : 22, source: 'player' }) : null;
    // the world behind: a puff where the round ends (props make their own impacts)
    const w = res?.world || physics.ray(o, dir, 60);
    if (w && (!res || res.stopped === 'world')) vfx.burst(d ? d.effects.dust : { name: 'x', bursts: [{ time: 0, count: 6 }], duration: 0.1, life: [0.3, 0.6], size: [0.1, 0.2], color: '#999', alpha: [[0, 0.4], [1, 0]] }, w.point, { direction: w.normal, scale: 0.4 });
  }
}
/** a blast where the aim meets the room (or a prop) */
function rocket(x = 0, y = 0) {
  audio.unlock();
  const o = camera.position.toArray(), dir = aim(x, y);
  const w = physics.ray(o, dir, 60), pr = d?.ray(o, dir, 60);
  const t = Math.min(w ? w.distance : 60, pr ? pr.t : 60) - 0.15, p = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
  vfx.burst(d ? d.effects.blast : {}, p);
  audio.play('dx_boom', { at: p, gain: 1.2 });
  d?.blast({ point: p, radius: 3.2, damage: 200, falloff: 'linear', source: 'player' });
}
let down = null, yaw = 0, pitch = 0;
const look = () => { camera.position.set(0, 1.6, 1.6); camera.rotation.set(0, 0, 0, 'YXZ'); camera.rotation.order = 'YXZ'; camera.lookAt(0, 1.25, -6); camera.rotation.y += yaw; camera.rotation.x += pitch; camera.updateMatrixWorld(); };
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; });
canvas.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.hypot(dx, dy) > 5) down.moved = true; if (down.moved) { yaw = down.yaw - dx * 0.004; pitch = Math.max(-0.7, Math.min(0.7, down.pitch - dy * 0.004)); look(); } });
canvas.addEventListener('pointerup', (e) => {
  if (down && !down.moved) { const r = canvas.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -((e.clientY - r.top) / r.height) * 2 + 1; shoot(x, y, e.shiftKey ? 'shotgun' : S.weapon); }
  down = null;
});
let mouse = [0, 0];
canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); mouse = [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1]; });
const $ = (id) => document.getElementById(id);
const pick = (w) => { S.weapon = w; $('pistol').classList.toggle('on', w === 'pistol'); $('shotgun').classList.toggle('on', w === 'shotgun'); };
const act = {
  pistol: () => pick('pistol'), shotgun: () => pick(S.weapon === 'shotgun' ? 'pistol' : 'shotgun'), rocket: () => rocket(...mouse),
  reset: () => d?.reset(), save: () => { if (d) S.saved = d.snapshot(); }, load: () => { if (d && S.saved) d.restore(S.saved); },
  detail: () => { if (!d) return; const v = d.cfg.detail > 0.6 ? 0.35 : 1; d.setDetail(v); $('detail').textContent = 'D: detail ' + v; },
};
for (const k of Object.keys(act)) $(k).onclick = act[k];
addEventListener('keydown', (e) => { const k = { s: 'shotgun', b: 'rocket', r: 'reset', k: 'save', l: 'load', d: 'detail' }[e.key.toLowerCase()]; if (k) act[k](); });
if (Q.get('ui') === '0') for (const id of ['bar', 'tally', 'stats', 'cross']) $(id).style.display = 'none';

// ---- the loop: fixed steps for the props, a moving (TAA) frame per display frame
await world.prepare();
look();
function frame(dt) {
  const t0 = performance.now();
  S.T += dt;
  physics.step(dt);
  d?.update(dt);
  world.renderFrame(S.T, { taa: true, dt });
  S.ms = performance.now() - t0; S.dt = dt;
}
let last = performance.now(), paused = Q.get('paused') === '1';
(function loop() {
  requestAnimationFrame(loop);
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (paused) return;
  frame(dt); S.frames++;
  if (S.frames % 15 === 0) hud();
})();
function hud() {
  if (Q.get('ui') === '0' || !d) return;
  const t = d.tally, cls = Object.entries(t.byClass).map(([k, v]) => `  ${k.padEnd(12)} ${String(v.count).padStart(3)}  $${v.value}`).join('\n');
  $('tally').textContent = `PROPERTY DAMAGE  $${t.value}\nbroken ${t.count}   casualties ${t.casualties}\n${cls}\nlamps lit ${world.lampPool.lit} of ${world.lampPool.count}`;
  const s = d.stats;
  $('stats').textContent = `frame ${S.ms.toFixed(2)} ms (CPU)   step ${s.stepMs.toFixed(3)} ms   debris ${s.debris}/${d.cfg.maxDebris}   marks ${s.marks}/${d.cfg.maxDecals}   movers ${s.movers}   emitters ${s.emitters}   particles ${vfx.stats.particles}`;
}
window.__mirage = { world, d, vfx, physics, P, THREE, shoot, rocket, frame, S, camera, look,
  /** freeze the real-time loop (checks drive frame() themselves) */
  pause(on = true) { paused = on; last = performance.now(); },
  /** a still of the current state */
  still: (spp = +Q.get('spp') || 4) => world.renderFrame(S.T, { spp, frameIndex: 1 }) };
window.__READY = true;
