// Node checks of @mirage/game: the character controller on a hand-made scene (floor, wall with a gap, stairs, a
// 0.6 m box, a hinged door, a crate), and the game state (inventory, flags, events, save / load, migration).
import * as THREE from 'three';
import { createPhysics } from './src/physics.js';
import { createGame } from './src/game.js';
import { createInput } from './src/input.js';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('  ok', m); };
const scene = new THREE.Scene(), M = new THREE.MeshBasicMaterial();
const box = (w, h, d, x, y, z, s) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.clone()); m.position.set(x, y, z); if (s) m.material.userData.surface = s; scene.add(m); return m; };
box(40, 1, 40, 0, -0.5, 0, 'stone');                                  // floor, top at 0
box(4, 0.02, 4, -6, 0.01, -6, 'grass');                               // a lawn patch
box(9, 3, 0.4, -5.5, 1.5, 3); box(9, 3, 0.4, 5.5, 1.5, 3);            // a wall along z = 3 with a 2 m gap at x 0
for (let i = 0; i < 9; i++) box(2, 0.178 * (i + 1), 0.36, 6, (0.178 * (i + 1)) / 2, -2 - i * 0.36);   // stairs climbing -z to 1.6
box(2, 1.602, 5, 6, 0.801, -7.56);                                     // the landing
box(1, 0.6, 1, -3, 0.3, -3);                                          // a box to jump onto
const phys = await createPhysics(scene);
phys.addStatic(scene);
ok(phys.stats.colliders === 15, `static colliders from meshes (${phys.stats.colliders}, ${phys.stats.triangles} tris)`);

const run = (w, secs, input) => { for (let t = 0; t < secs; t += 1 / 60) { w.update(1 / 60, input); phys.step(1 / 60); } return w; };
const steps = [];
let w = phys.character({ pos: [0, 0, -1] });
w.onStride = (s) => steps.push(s);
ok(Math.abs(w.pos[1]) < 0.05 && w.onGround, `placed on the floor (y ${w.pos[1].toFixed(3)})`);
run(w, 4, { z: 1 });
ok(w.pos[2] > 4, `walks through the gap (z ${w.pos[2].toFixed(2)})`);
ok(steps.length >= 6 && steps.every((s) => s === 'stone'), `footsteps on stone (${steps.length})`);
w.place([3, 0, 1]); run(w, 3, { z: 1 });
ok(w.pos[2] < 2.75 && w.pos[2] > 2.4 && w.blocked, `wall blocks (z ${w.pos[2].toFixed(2)})`);
w.place([6, 0, 0]); run(w, 6, { z: -1 });
ok(Math.abs(w.pos[1] - 1.602) < 0.06, `climbs the stairs (y ${w.pos[1].toFixed(2)})`);
run(w, 6, { z: 1 });
ok(Math.abs(w.pos[1]) < 0.05, `comes down (y ${w.pos[1].toFixed(2)})`);
w.place([-3, 0, -1]); run(w, 2, { z: -1 });
ok(w.pos[2] > -2.5 && w.pos[1] < 0.05, `0.6 m box blocks (z ${w.pos[2].toFixed(2)})`);
let apex = 0; w.update(1 / 60, { z: -1, jump: true });
for (let t = 0; t < 1.5; t += 1 / 60) { w.update(1 / 60, { z: t < 0.6 ? -1 : 0 }); phys.step(1 / 60); apex = Math.max(apex, w.pos[1]); }
ok(Math.abs(w.pos[1] - 0.6) < 0.06 && apex > 0.8, `jumps onto it (y ${w.pos[1].toFixed(2)}, apex ${apex.toFixed(2)})`);
steps.length = 0; w.place([-6, 0, -4.5]); run(w, 1.5, { z: -1 });
ok(steps.length && steps.every((s) => s === 'grass'), `footsteps on grass (${steps.length})`);

// a door leaf hinged at x = -1 in the gap: blocks closed, lets through open
const leaf = new THREE.Group(); leaf.position.set(-1, 1.2, 3); scene.add(leaf);
const door = phys.hinge(leaf, { half: [1, 1.2, 0.04], offset: [1, 0, 0], swing: 1.45 });
phys.step(1 / 60);
w.place([0, 0, 0]); run(w, 3, { z: 1 });
ok(w.pos[2] < 2.8, `closed door blocks (z ${w.pos[2].toFixed(2)})`);
w.place([0, 0, 0]); door.open(); run(w, 1.5, {});
ok(Math.abs(door.angle - 1.45) < 1e-6, `door turns open (${door.angle.toFixed(2)} rad)`);
run(w, 4, { z: 1 });
ok(w.pos[2] > 4, `open door lets through (z ${w.pos[2].toFixed(2)})`);

// a crate the character pushes
const crate = box(0.8, 0.8, 0.8, 0, 0.4, -6);
scene.remove(crate); const g = new THREE.Group(); scene.add(g); g.add(crate);
const cb = phys.body(crate, { mass: 8 });
run(w, 0.5, {});
w.place([0, 0, -4]); run(w, 3, { z: -1 });
ok(cb.pos[2] < -6.3, `pushes a crate (z ${cb.pos[2].toFixed(2)})`);
ok(phys.ray([0, 5, 10], [0, -1, 0], 10)?.distance > 4.9, 'ray down hits the floor');

// ---- game state without a renderer
const store = new Map();
const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const game = createGame({ id: 'check', version: 2, storage, migrate: { 1: (s) => ({ ...s, flags: { ...s.flags, migrated: true } }) } });
const seen = [];
game.on('flag', (e) => seen.push(e.key));
let used = 0;
const key = game.add({ id: 'key', pos: [1, 0, 1], interact: { label: 'Pick up', use: (g) => { g.inventory.add({ id: 'key', name: 'Key' }); g.remove(key); } } });
game.add({ id: 'door', pos: [3, 0, 1], interact: { label: () => (game.inventory.has('key') ? 'Open' : 'Locked'), use: () => { used++; game.set('door', true); } }, save: () => ({ open: !!game.flags.door }) });
ok(game.nearest([1, 0, 0], [0, 0, 1])?.id === 'key', 'nearest interactable in view');
game.interact(game.nearest([1, 0, 0], [0, 0, 1]));
ok(game.inventory.has('key') && !game.entities.has('key'), 'pick up moves the key to the inventory');
game.interact(game.nearest([3, 0, 0], [0, 0, 1]));
ok(used === 1 && game.flags.door && seen.includes('door'), 'use sets a flag and emits');
game.save(1, { player: { pos: [1, 2, 3] } });
const saved = JSON.parse(store.get('mirage:check:1'));
ok(saved.v === 2 && saved.inventory[0].id === 'key' && saved.entities.door.open, 'save writes versioned JSON');
game.reset();
ok(!game.inventory.has('key') && !game.flags.door, 'reset clears state');
const loaded = game.load(1);
ok(loaded.player.pos[2] === 3 && game.inventory.has('key') && game.flags.door && game.removed.has('key'), 'load restores flags, inventory, removed entities');
store.set('mirage:check:2', JSON.stringify({ ...saved, v: 1 }));
ok(game.load(2) && game.flags.migrated, 'an older save is migrated');
store.set('mirage:check:3', JSON.stringify({ ...saved, v: 9 }));
let threw = false; try { game.load(3); } catch { threw = true; }
ok(threw, 'a newer save is refused');
ok(game.importJSON(game.exportJSON()) && game.inventory.has('key'), 'export / import round trip');

// ---- input: a button or key held when input is switched on (the start screen, a dialog closing) does not act
const pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
const A = (on) => { pad.buttons[0] = { pressed: on, value: +on }; };
Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => [pad], configurable: true });
const keyTarget = new EventTarget(), press = (type, code) => keyTarget.dispatchEvent(Object.assign(new Event(type), { code }));
const input = createInput({ target: keyTarget });
input.enabled = false; input.poll();
A(true); input.poll(); input.enabled = true;          // A starts the game (ui.update runs after the frame's poll)
let jumps = 0; for (let f = 0; f < 30; f++) { input.poll(); jumps += input.down('jump'); }
ok(jumps === 0, `pad A held through the start screen does not jump (${jumps} frames)`);
A(false); input.poll(); A(true); input.poll();
ok(input.down('jump') && input.pressed('jump'), 'pad A pressed again jumps');
A(false); input.poll();
input.enabled = false; press('keydown', 'Space'); input.enabled = true; input.spend('Space');   // a key that starts it
jumps = 0; for (let f = 0; f < 30; f++) { input.poll(); jumps += input.down('jump'); }
ok(jumps === 0, `Space held through the start screen does not jump (${jumps} frames)`);
press('keyup', 'Space'); press('keydown', 'Space'); input.poll();
ok(input.down('jump'), 'Space pressed again jumps');
press('keyup', 'Space');
console.log('game check: ok');
