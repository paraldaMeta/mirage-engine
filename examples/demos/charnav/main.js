// Demo: the character mover and the navigation stack of @mirage/play on one yard.
// A lift up to a deck (with a ladder on its south face), a turntable, a sliding door in a long wall, three crates
// Rapier owns, a crowd that avoids itself and you, and a guard that patrols, sees you, and comes over the fence by
// an off-mesh jump link when you stand in the fenced yard.
// Keys: WASD move · Shift sprint · C crouch · Space jump (hold: higher; against a ledge: mantle) · arrows or mouse
//       drag turn the camera · V first / third person · E door · G debug draw
// URL: ?agents=240 (crowd size)   ?physics=0 (no Rapier: crates stay where they are, kinematic solids still work)
//      ?debug=1 (grid, links, paths, velocities, the guard's tree)   ?cam=first   ?door=manual (default: every 12 s)
//      ?w=&h=  ?ui=0  ?grain=0  ?spp=N  ?quality=
import * as THREE from 'three';
import { createWorldRenderer } from '@mirage/core';
import { buildWorld, definePlan } from '@mirage/world';
import { bakeWalkGrid, createCharacter, createSolids, createMover, createFollowCamera, linkSolids, createNavGrid, carveSolids,
  createCrowd, createSenses, createBehaviorTree, guard, createNavDebug, smoothPath } from '@mirage/play';
import { createPhysics } from '@mirage/game';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas'), hud = document.querySelector('#hud'), treeEl = document.querySelector('#tree');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const world = createWorldRenderer({ canvas, width: W, height: H, place: { lat: 51.5, lon: -0.1, height: 30, tzHours: 0 }, time: new Date(Date.UTC(2026, 5, 21, 15, 30)), preserveDrawingBuffer: true,
  quality: Q.get('quality') || 'high', shadow: { center: [0, 1, 0], radius: 26 }, envProbe: [0, 1.6, 4], fog: { groundDensity: 0.002, height: 30 }, post: { grain: Q.get('grain') === '0' ? 0 : 0.01 } });

const BOUNDS = [-20, -20, 20, 20], YARD = [6, 6, 14, 14], DECK = [-14.6, 2, -9.6, 6], DECK_TOP = 2.6, WALL_X = 3, DOOR_Z = -10.2;
const plan = definePlan({
  name: 'charnav', seed: 'charnav', bounds: BOUNDS, walk: { yMin: -1, yMax: 6 },
  spawn: { eye: [0, 1.62, 10], look: [0, 1, 0], mode: 'game' },
  viewpoints: [{ name: 'yard', eye: [0, 9, 20], look: [0, 0.5, 0] }],
});
// a small generator of our own: the same layout and the same crowd on every load
let seed = 0x9e3779b9;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pillars = [];
for (let i = 0; i < 14; i++) pillars.push([-17 + rnd() * 18, -17 + rnd() * 9, 0.35 + rnd() * 0.3]);

const modules = [{
  name: 'yard',
  build(ctx) {
    const mesh = (geo, color, x, y, z) => { const m = new THREE.Mesh(geo, ctx.mat.std({ color, roughness: 0.9 })); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; ctx.root.add(m); return m; };
    const box = (x0, z0, x1, z1, y0, y1, color) => mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), 0x6f6a58, 0, 0, 0).name = 'ground';
    box(DECK[0], DECK[1], DECK[2], DECK[3], 0, DECK_TOP, 0x8d8676).name = 'deck';
    // the long wall with a doorway 1.6 m wide
    box(WALL_X - 0.15, -16, WALL_X + 0.15, DOOR_Z - 0.8, 0, 2.4, 0x9a9382);
    box(WALL_X - 0.15, DOOR_Z + 0.8, WALL_X + 0.15, -5, 0, 2.4, 0x9a9382);
    box(WALL_X - 0.15, DOOR_Z - 0.8, WALL_X + 0.15, DOOR_Z + 0.8, 2.2, 2.4, 0x9a9382);
    // the fenced yard: 0.6 m, too high to step over, low enough to jump and to see over
    const [x0, z0, x1, z1] = YARD, f = 0.1;
    box(x0 - f, z0 - f, x1 + f, z0 + f, 0, 0.6, 0x7a5a3a); box(x0 - f, z1 - f, x1 + f, z1 + f, 0, 0.6, 0x7a5a3a);
    box(x0 - f, z0 - f, x0 + f, z1 + f, 0, 0.6, 0x7a5a3a); box(x1 - f, z0 - f, x1 + f, z1 + f, 0, 0.6, 0x7a5a3a);
    for (const [x, z, r] of pillars) mesh(new THREE.CylinderGeometry(r, r, 2.2, 20), 0x8a8474, x, 1.1, z);
    // the ladder is a picture: the volume below is what climbs
    const rail = mesh(new THREE.BoxGeometry(0.7, DECK_TOP, 0.05), 0x4a3a2a, -13, DECK_TOP / 2, 1.96); rail.userData.collide = false;
  },
}];
await buildWorld(world, { plan, modules, shared: {} });
const { camera, scene } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 2000; camera.updateProjectionMatrix();
await world.prepare();

// --- collision: the static bake, then the moving shapes composed over it
const grid = bakeWalkGrid(world, { bounds: plan.bounds, ...plan.walk });
const usePhysics = Q.get('physics') !== '0';
const phys = usePhysics ? await createPhysics(scene) : null;
if (phys) phys.addStatic(scene);   // before anything that moves is in the scene
const space = createSolids(grid);
const std = (color) => world.mat.std({ color, roughness: 0.8 });
const show = (solid, geo, color) => { const m = new THREE.Mesh(geo, std(color)); m.castShadow = m.receiveShadow = true; m.userData.collide = false; scene.add(m); solid.data = { ...solid.data, mesh: m }; return solid; };
const lift = show(space.add({ box: [1.2, 0.1, 1.2], pos: [-8.3, 0.1, 4], kind: 'kinematic', name: 'lift', data: { carve: false } }), new THREE.BoxGeometry(2.4, 0.2, 2.4), 0xb08a3c);
const table = show(space.add({ cylinder: [2.2, 0.1], pos: [-8, 0.1, -7], kind: 'kinematic', name: 'turntable' }), new THREE.CylinderGeometry(2.2, 2.2, 0.2, 40).translate(0, 0, 0), 0x5f7f8f);
table.data.mesh.add(new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.22, 0.12), std(0xd8d0b8)));   // a stripe, so the turn shows
table.data.mesh.children[0].userData.collide = false;
const door = show(space.add({ box: [0.08, 1.1, 0.8], pos: [WALL_X, 1.1, DOOR_Z], kind: 'kinematic', name: 'door' }), new THREE.BoxGeometry(0.16, 2.2, 1.6), 0x6a4a2e);
const crates = [[1, 0.4, 6], [0, 0.4, 7.5], [-1.5, 0.4, 6.5]].map((pos, i) => show(space.add({ box: [0.4, 0.4, 0.4], pos, kind: phys ? 'dynamic' : 'static', mass: 30, name: 'crate' + i }), new THREE.BoxGeometry(0.8, 0.8, 0.8), 0x8a6a45));
space.addVolume({ type: 'ladder', box: [-13.5, 0, 1.6, -12.5, DECK_TOP + 0.1, 2], facing: [0, 1] });
const link = phys ? linkSolids(space, phys) : null;

// --- the player
const mover = createMover(space, { pos: [0, 0, 10] });
if (link) link.addMover(mover);
const cam = createFollowCamera(space, { mode: Q.get('cam') === 'first' ? 'first' : 'third', distance: 4.5, pitch: 0.28 });
const avatar = createCharacter(world), figure = avatar.root; scene.add(figure);
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyV') cam.mode = cam.mode === 'first' ? 'third' : 'first'; if (e.code === 'KeyE') doorOpen = !doorOpen; if (e.code === 'KeyG') setDebug(!debugOn); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
let drag = false;
canvas.addEventListener('pointerdown', () => { drag = true; }); addEventListener('pointerup', () => { drag = false; });
addEventListener('pointermove', (e) => { if (drag) cam.turn(-e.movementX * 0.005, e.movementY * 0.004); });

// --- navigation: areas, the jump link over the fence, moving solids carved in
const nav = createNavGrid(grid);
nav.block({ box: [-9.6, -0.5, 2.7, -7, 3, 5.3] });   // under the lift: nobody waits in the shaft
const jump = nav.link({ from: [10, 0, 5.2], to: [10, 0, 6.8], type: 'jump', bidirectional: true, time: 0.7 });
const carve = carveSolids(nav, space);
carve.update();
const N = Math.max(0, Math.min(2000, Q.get('agents') == null ? 240 : +Q.get('agents')));
const crowd = createCrowd(nav, { max: N + 8 });
const inYard = (x, z) => x > YARD[0] - 0.6 && x < YARD[2] + 0.6 && z > YARD[1] - 0.6 && z < YARD[3] + 0.6;
const spot = () => {   // one radius for every probe: the navigation bakes a fit profile per radius asked
  for (let k = 0; k < 200; k++) { const x = -19 + rnd() * 38, z = -19 + rnd() * 38; if (!inYard(x, z) && nav.fits(x, 0, z, 0.45)) return [x, 0, z]; } return [0, 0, 0]; };
const noLinks = () => false;   // the crowd keeps to the ground: the link is the guard's
for (let i = 0; i < N; i++) { const r = 0.22 + rnd() * 0.16, id = crowd.add({ pos: spot(r), radius: r, speed: 1.1 + rnd() * 0.7, canUse: noLinks }); crowd.setGoal(id, spot(r)); }
crowd.onNoPath = (i) => { if (i < N) crowd.setGoal(i, spot(crowd.radius[i])); };
const me = crowd.add({ pos: mover.pos, radius: 0.3, fixed: true });
const gi = crowd.add({ pos: [8, 0, 2], radius: 0.3, speed: 1.6 });
const stats = { steps: 0, catches: 0, linkEvents: [], moverMs: 0, crowdMs: 0, carveMs: 0, carveMoved: 0, physMs: 0, frames: 0 };
crowd.onLink = (i, l, phase) => { if (i === gi) stats.linkEvents.push(phase); };
const senses = createSenses(space);
const brain = createBehaviorTree(guard({ points: [[5, 0, 3], [13, 0, 3], [16, 0, -2], [6, 0, -1]], chaseSpeed: 3.4, onCatch: () => { stats.catches++; } }),
  { actor: crowd.actor(gi), nav, senses, perception: { targets: () => [mover], range: 16, fov: 120, memory: 2 } });

// --- pictures of the agents: one instanced capsule, the guard its own
const capsule = new THREE.CapsuleGeometry(0.3, 1.1, 4, 10).translate(0, 0.85, 0);
const people = new THREE.InstancedMesh(capsule, std(0xc9c2b0), Math.max(1, N)); people.count = N; people.castShadow = true; people.frustumCulled = false; people.userData.collide = false; scene.add(people);
const guardMesh = new THREE.Mesh(capsule, std(0xb23a2a)); guardMesh.castShadow = true; guardMesh.userData.collide = false; scene.add(guardMesh);
const M4 = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3(), QI = new THREE.Quaternion();
const debug = createNavDebug(nav, { radius: 0.28 }); debug.group.visible = false; scene.add(debug.group);
let debugOn = false;
function setDebug(v) { debugOn = v; debug.group.visible = v; treeEl.textContent = ''; if (v) { debug.grid(); debug.links(); } }

// --- one fixed step: kinematic solids, physics, carve, the player, the brains, the crowd
const DT = 1 / 60, auto = Q.get('door') !== 'manual';
let T = 0, doorOpen = false, doorAt = 0, held = null;
const ease = (x) => x * x * (3 - 2 * x);
function step(input) {
  T += DT; stats.steps++;
  // the lift: 4 s up, 2 s there, 4 s down, 2 s there. The door: slides along the wall in a second.
  const ph = T % 12, up = ph < 4 ? ease(ph / 4) : ph < 6 ? 1 : ph < 10 ? 1 - ease((ph - 6) / 4) : 0;
  lift.set({ pos: [-8.3, 0.1 + up * (DECK_TOP - 0.2), 4] });
  table.set({ pos: [-8, 0.1, -7], yaw: T * 0.6 });
  if (auto) doorOpen = Math.floor(T / 12) % 2 === 1;
  doorAt = Math.max(0, Math.min(1, doorAt + (doorOpen ? DT : -DT)));
  door.set({ pos: [WALL_X + 0.25 * Math.min(1, doorAt * 4), 1.1, DOOR_Z - 1.6 * ease(doorAt)] });
  let t = performance.now();
  if (link) { link.pre(); phys.step(DT); link.post(); }
  let t1 = performance.now(); stats.physMs += t1 - t;
  carve.update(); stats.carveMs += carve.stats.ms; stats.carveMoved += carve.stats.moved;
  t = performance.now();
  mover.update(DT, input);
  t1 = performance.now(); stats.moverMs += t1 - t;
  crowd.move(me, mover.pos[0], mover.pos[1], mover.pos[2], DT);
  senses.update(DT); brain.tick(DT);
  for (let i = 0; i < N; i++) if (crowd.arrived(i)) crowd.setGoal(i, spot(crowd.radius[i]));
  t = performance.now();
  crowd.update(DT);
  stats.crowdMs += performance.now() - t;
}
function readInput() {
  const f = cam.forward(), fw = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), rt = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let x = f[0] * fw - f[1] * rt, z = f[1] * fw + f[0] * rt; const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
  return { x, z, run: true, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), crouch: keys.has('KeyC'), jump: keys.has('Space') };
}
let heading = Math.PI, lastPos = mover.pos.slice();
function present(dt) {
  for (const s of space.solids.values()) { const m = s.data && s.data.mesh; if (m) { m.position.set(s.pos[0], s.pos[1], s.pos[2]); m.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]); } }
  for (let i = 0; i < N; i++) { const r = crowd.radius[i] / 0.3; M4.compose(P.set(crowd.x[i], crowd.y[i], crowd.z[i]), QI, S.set(r, 0.85 + r * 0.15, r)); people.setMatrixAt(i, M4); }
  people.instanceMatrix.needsUpdate = true;
  guardMesh.position.set(crowd.x[gi], crowd.y[gi], crowd.z[gi]);
  const dx = mover.pos[0] - lastPos[0], dz = mover.pos[2] - lastPos[2], d = Math.hypot(dx, dz);
  if (d > 1e-4 && mover.mode !== 'climb') heading = Math.atan2(dx, dz);
  figure.position.set(mover.pos[0], mover.pos[1], mover.pos[2]); figure.rotation.y = heading; figure.scale.y = mover.crouched ? 0.68 : 1;
  avatar.update(dt, { distance: d, run: mover.speed > 2.5, onGround: mover.onGround || mover.mode === 'climb', verticalSpeed: mover.vy });
  lastPos = mover.pos.slice();
  figure.visible = cam.mode !== 'first' && !cam.close;
  cam.update(dt, mover); cam.apply(camera); camera.updateMatrixWorld(true);
  if (debugOn) { if (debug.gridVersion !== nav.version) debug.grid(); debug.crowd(crowd); const p = crowd.pathOf(gi); debug.paths(p ? [smoothPath(nav, p, { radius: 0.3 })] : []); debug.tree(brain, treeEl); }
}
const spp = +Q.get('spp') || 4;
function render(opts) { world.renderFrame(T, opts || { taa: true, dt: DT }); }
let running = true, acc = 0, last = null, fps = 0;
function frame(now) {
  if (!running) return;
  const dt = last === null ? DT : Math.min((now - last) / 1000, 0.1); last = now; acc += dt; fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (keys.has('ArrowLeft')) cam.turn(dt * 1.8); if (keys.has('ArrowRight')) cam.turn(-dt * 1.8);
  if (keys.has('ArrowUp')) cam.turn(0, dt); if (keys.has('ArrowDown')) cam.turn(0, -dt);
  let n = 0; held = readInput();
  while (acc >= DT && n++ < 4) { step(held); acc -= DT; }
  if (n > 4) acc = 0;
  present(dt); render(); stats.frames++;
  requestAnimationFrame(frame);
}
if (Q.get('ui') !== '0') setInterval(() => {
  const s = stats, n = Math.max(1, s.steps);
  hud.textContent = `${mover.mode}  ${mover.speed.toFixed(1)} m/s${mover.ground ? '  on ' + mover.ground.name : ''}   camera ${cam.mode} (boom ${cam.arm.toFixed(2)} m)   ${fps.toFixed(0)} fps\n`
    + `crowd ${N} + guard: ${(s.crowdMs / n).toFixed(3)} ms/step   mover ${(s.moverMs / n * 1000).toFixed(1)} us   physics ${(s.physMs / n).toFixed(3)} ms   carve ${(s.carveMs / n).toFixed(4)} ms (${s.carveMoved} re-blocks)\n`
    + `guard: ${brain.active().join(', ') || '-'}   caught you ${s.catches}x   door ${doorOpen ? 'open' : 'shut'}\n`
    + 'WASD · Shift sprint · C crouch · Space jump / mantle · arrows or drag: camera · V view · E door · G debug';
}, 250);
if (Q.get('debug') === '1') setDebug(true);
present(DT); render({ spp, frameIndex: 1 });

window.__mirage = { world, THREE, grid, space, phys, link, mover, cam, nav, carve, crowd, brain, senses, jump, lift, table, door, crates, stats, keys, people, guardMesh, debug, me, gi, N,
  step: (n = 1, input = {}) => { for (let i = 0; i < n; i++) step(input); }, present, setDebug,
  render: (o) => { present(DT); render(o || { spp, frameIndex: 1 }); }, stop: () => { running = false; }, setDoor: (v) => { doorOpen = v; }, get time() { return T; }, get doorAt() { return doorAt; } };
window.__READY = true;
requestAnimationFrame(frame);
