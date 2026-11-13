// Node checks of @miragekit/game: the character controller on a hand-made scene (floor, wall with a gap, stairs, a
// 0.6 m box, a hinged door, a crate), and the game state (inventory, flags, events, save / load, migration).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createPhysics } from './src/physics.js';
import { startGame } from './src/start.js';
import { createSimulation } from './src/simulation.js';
import { createGame } from './src/game.js';
import { createInput } from './src/input.js';
import { createEnv, createMaterials } from '@miragekit/core';
import { addTerrain } from '@miragekit/world/kits/terrain';
import { addWater } from '@miragekit/world/kits/water';

import { ok } from '../../scripts/soft-assert.mjs';   // reports every failure with a count, not only the first
const scene = new THREE.Scene(), M = new THREE.MeshBasicMaterial();
const box = (w, h, d, x, y, z, s) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.clone()); m.position.set(x, y, z); if (s) m.material.userData.surface = s; scene.add(m); return m; };
box(40, 1, 40, 0, -0.5, 0, 'stone');                                  // floor, top at 0
box(4, 0.02, 4, -6, 0.01, -6, 'grass');                               // a lawn patch
box(9, 3, 0.4, -5.5, 1.5, 3); box(9, 3, 0.4, 5.5, 1.5, 3);            // a wall along z = 3 with a 2 m gap at x 0
for (let i = 0; i < 9; i++) box(2, 0.178 * (i + 1), 0.36, 6, (0.178 * (i + 1)) / 2, -2 - i * 0.36);   // stairs climbing -z to 1.6
box(2, 1.602, 5, 6, 0.801, -7.56);                                     // the landing
box(1, 0.6, 1, -3, 0.3, -3);                                          // a box to jump onto
// two callers at once: the second must not get Rapier before its init has finished
{
  const { loadRapier } = await import('./src/physics.js');
  await import('@dimforge/rapier3d-compat');               // cached: the next import resolves at once, init still takes time
  const first = loadRapier();
  await new Promise((r) => setTimeout(r));                 // the import is done, the WASM init is still running
  let early = null; try { early = await createPhysics(new THREE.Scene()); } catch (e) { early = e; }
  await first;
  ok(early && early.stats, `createPhysics while loadRapier is still initialising (${early?.message || 'ok'})`);
}
const phys = await createPhysics(scene);
// meshes with nothing to collide with are left out instead of throwing (and failing startGame)
const odd = new THREE.Group();
odd.add(new THREE.Mesh(new THREE.BufferGeometry(), M), new THREE.Mesh(undefined, M), new THREE.InstancedMesh(new THREE.BoxGeometry(), M, 0));
const batched = new THREE.BatchedMesh(1, 24, 36, M); batched.addInstance(batched.addGeometry(new THREE.BoxGeometry()));
odd.add(batched);
scene.add(odd);
const warned = [], warn = console.warn; console.warn = (m) => warned.push(String(m));
let oddError = null; try { phys.addStatic(scene); } catch (e) { oddError = e; } finally { console.warn = warn; }
scene.remove(odd);
ok(!oddError && phys.stats.colliders === 15, `empty, instance-less and batched meshes are skipped (${oddError?.message || phys.stats.colliders + ' colliders'})`);
ok(warned.some((m) => m.includes('BatchedMesh')), 'a BatchedMesh is named in a warning');

// Wading uses the actual bed triangle in Rapier, including under fully opaque water.
{
  const root = new THREE.Scene(), ctx = { root, mat: createMaterials(createEnv().G) };
  const bed = addTerrain(ctx, { bounds: [-3, -2, 3, 2], segments: [3, 2], sample: (x, z) => -1 + x * z * 0.05, surface: 'gravel' });
  addWater(ctx, { outline: [[-3,-2], [3,-2], [3,2], [-3,2]], level: 0.4, opacity: 1 });
  const riverPhysics = await createPhysics(root);
  riverPhysics.addStatic(root);
  const hit = riverPhysics.ray([0.37, 3, -0.6], [0, -1, 0]);
  ok(riverPhysics.stats.colliders === 1 && hit?.surface === 'gravel' &&
    Math.abs(hit.point[1] - bed.heightAt(0.37, -0.6)) < 1e-5, 'Rapier ray hits the sampled bed beneath water');
  riverPhysics.dispose(); riverPhysics.dispose();
}

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
// closing on the player (A5). In the open the controller steps out of the leaf's way; pinned against a block behind
// the doorway it cannot, and the leaf must stop instead of closing through the body
const inLeaf = () => {   // how deep the leaf (half thickness 0.04) is inside the body (r 0.28), metres
  const a = door.angle, px = w.pos[0] + 1, pz = w.pos[2] - 3, along = px * Math.cos(a) - pz * Math.sin(a);
  return along > -0.28 && along < 2.28 ? Math.max(0, 0.32 - Math.abs(px * Math.sin(a) + pz * Math.cos(a))) : 0;
};
w.place([0, 0, 3]); run(w, 0.3, {}); door.close(); run(w, 3, {});
ok(door.angle === 0 && w.pos[2] > 3.3 && inLeaf() < 0.005, `closing door pushes the player out of the doorway (z ${w.pos[2].toFixed(2)})`);
door.open(); run(w, 1.5, {});
phys.addStatic(box(3, 2, 0.3, 0, 1, 3.75));
w.place([0, 0, 3]); run(w, 0.3, {}); door.close();
let deepest = 0; for (let t = 0; t < 3; t += 1 / 60) { run(w, 1 / 60, {}); deepest = Math.max(deepest, inLeaf()); }
ok(door.angle > 0.02 && deepest < 0.005, `pinned against a block, the closing door stops at the player (${door.angle.toFixed(2)} rad, deepest ${(deepest * 100).toFixed(1)} cm)`);
door.open(); run(w, 1.5, {}); run(w, 2, { z: -1 }); door.close(); run(w, 2, {});
ok(door.angle === 0 && w.pos[2] < 2.5, `reopened, the player walks out and it closes (${door.angle.toFixed(2)} rad, z ${w.pos[2].toFixed(2)})`);
door.open(); run(w, 1.5, {});

// a crate the character pushes
const crate = box(0.8, 0.8, 0.8, 0, 0.4, -6);
scene.remove(crate); const g = new THREE.Group(); scene.add(g); g.add(crate);
const cb = phys.body(crate, { mass: 8 });
run(w, 0.5, {});
w.place([0, 0, -4]); run(w, 3, { z: -1 });
ok(cb.pos[2] < -6.3, `pushes a crate (z ${cb.pos[2].toFixed(2)})`);
ok(phys.ray([0, 5, 10], [0, -1, 0], 10)?.distance > 4.9, 'ray down hits the floor');
{
  // the hit's surface normal: the floor's top faces up, the wall along z = 3 (0.4 m thick) faces the ray from either side
  const near = (n, e) => n && n.length === 3 && n.every((v, k) => Math.abs(v - e[k]) < 1e-4);
  const down = phys.ray([0, 5, 10], [0, -1, 0], 10), front = phys.ray([-5, 1, 0], [0, 0, 1], 10), back = phys.ray([-5, 1, 6], [0, 0, -1], 10);
  const slant = phys.ray([-5, 1, 0], [0.6, 0, 0.8], 10);
  ok(near(down?.normal, [0, 1, 0]) && near(front?.normal, [0, 0, -1]) && near(back?.normal, [0, 0, 1]) && near(slant?.normal, [0, 0, -1]),
    `ray returns the surface normal (${[down, front, back, slant].map((h) => JSON.stringify(h?.normal?.map((v) => +v.toFixed(3)))).join(' ')})`);
}

// ---- small risers (B16): 5-13 cm, alone or behind a 17 cm step, square / bevelled / one merged mesh, straight
// and at 22 degrees, at 60 / 20 / 10 fps and on fast displays (120 / 144 / 240 fps: a step of a few millimetres
// used to stop at every riser, Firefox at 120 Hz in snow-hut's doorway): up without slowing below 80 % of the walk
{
  const lane = async ({ step = 0, riser, bevel = 0, merge = false, dir = [0, -1], dt = 1 / 60 }, fixed) => {
    const sc = new THREE.Scene(), geos = [];
    const put = (w, h, d, x, y, z) => {
      let gg = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
      if (bevel) { gg = gg.toNonIndexed(); const p = gg.attributes.position;   // chamfer the top front edge
        for (let i = 0; i < p.count; i++) if (p.getY(i) > y + h / 2 - 1e-6 && p.getZ(i) > z + d / 2 - 1e-6) p.setZ(i, p.getZ(i) - bevel); }
      if (merge) geos.push(gg.index ? gg.toNonIndexed() : gg); else sc.add(new THREE.Mesh(gg, M));
    };
    put(40, 1, 40, 0, -0.5, 0);
    if (step) put(8, step + 0.2, 0.5, 0, (step - 0.2) / 2, -2.25);
    const top = step + riser, z0 = step ? -2.5 : -2;
    put(8, top + 0.2, 6, 0, (top - 0.2) / 2, z0 - 3);
    if (merge) sc.add(new THREE.Mesh(mergeGeometries(geos.map((gg) => { gg.deleteAttribute('uv'); gg.deleteAttribute('normal'); return gg; })), M));
    const ph = await createPhysics(sc); ph.addStatic(sc);
    const c = ph.character({ pos: [0, 0, 0] }), n = Math.hypot(...dir);
    const motion = { x: dir[0] / n, z: dir[1] / n };
    const simulation = fixed && createSimulation(ph, c, createGame());
    let t = 0;
    for (; t < 6 && c.pos[2] > z0 - 2; t += dt) {
      if (simulation) simulation.advance(dt, motion);
      else { c.update(dt, motion); ph.step(dt); }
    }
    const speed = Math.abs(c.pos[2]) / t / Math.abs(dir[1] / n) / c.body.walk;
    ph.world.free();
    return { up: Math.abs(c.pos[1] - top) < 0.05 && c.pos[2] <= z0 - 2, y: c.pos[1], speed };
  };
  const cases = [];
  for (const riser of [0.05, 0.08, 0.13]) for (const dt of [1 / 60, 1 / 20, 1 / 10, 1 / 120, 1 / 144, 1 / 240]) cases.push({ riser, dt });
  for (const o of [{}, { bevel: 0.03 }, { merge: true }, { bevel: 0.03, merge: true }, { dir: [0.4, -1] }]) cases.push({ step: 0.17, riser: 0.13, ...o }, { riser: 0.05, ...o });
  // snow-hut's doorway: a 13.5 cm stone step (0.45 m tread) up to the 34 cm porch deck
  for (const dt of [1 / 60, 1 / 30, 1 / 120, 1 / 144, 1 / 240]) for (const bevel of [0, 0.03]) cases.push({ step: 0.135, riser: 0.205, bevel, dt });
  for (const fixed of [false, true]) {
    let worst = 1, fails = [];
    for (const k of cases) { const r = await lane(k, fixed); worst = Math.min(worst, r.speed); if (!r.up || r.speed < 0.8) fails.push({ ...k, ...r }); }
    ok(!fails.length, `small risers (${fixed ? 'game clock' : 'explicit step'}): ${cases.length - fails.length} / ${cases.length} lanes up, slowest at ${(worst * 100).toFixed(0)} %` + (fails.length ? ' ' + JSON.stringify(fails) : ''));
  }
}

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
const refused = (json) => { try { game.importJSON(json); return ''; } catch (e) { return e.message; } };
ok(/not of this game/.test(refused(JSON.stringify({ ...saved, id: 'another-game' }))), "another game's save is refused");
ok(/not a save/.test(refused(JSON.stringify({ ...saved, v: 0.5 }))) && /not a save/.test(refused(JSON.stringify({ ...saved, v: 0 }))), 'a save with a broken version is refused');

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
press('keydown', 'Space'); press('keyup', 'Space'); input.poll();
ok(input.pressed('jump') && !input.down('jump'), 'short keyboard tap survives until the next poll');

// ---- the pad's sticks: only a standard pad's right stick looks; a stick pinned since the pad appeared is not one
{
  const mk = (id, mapping, axes, index = 0) => ({ connected: true, index, id, mapping, axes, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
  let pads = [];
  Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => pads, configurable: true });
  const inp = createInput({ target: new EventTarget() }), look = () => { inp.poll(); return inp.look(1 / 60); };
  const std = mk('pad (standard)', 'standard', [0, 0, 0, 0]);
  pads = [std]; look(); std.axes = [0, 0, 0, -1];
  ok(look()[1] < -0.03, 'a standard pad: the right stick pushed up looks up');
  std.axes = [0, 0, 0, 0]; look();
  const hid = mk('USB Joystick (Vendor: 0079)', '', [0, 0, -1, -1]);
  pads = [hid];
  let sum = 0; for (let f = 0; f < 60; f++) sum += Math.abs(look()[1]) + Math.abs(look()[0]);
  ok(sum === 0, `a non-standard device: axes 2 / 3 resting at -1 do not look (${sum.toFixed(3)} rad in a second)`);
  pads = [hid, mk('pad (standard)', 'standard', [0, 0, 0, 0], 1)]; look(); pads[1].axes = [0, 0, 0.9, 0];
  ok(look()[0] > 0.02 && inp.pad === pads[1], 'with a HID device at index 0, the standard pad behind it is the one read');
  const broken = mk('broken pad (standard)', 'standard', [0, -1, 0, -1], 2);
  pads = [broken];
  sum = 0; for (let f = 0; f < 30; f++) sum += Math.abs(look()[1]);
  ok(sum === 0 && inp.move().z === 0, 'sticks pinned since the pad appeared neither look nor walk');
  broken.axes = [0, 0, 0, 0]; look(); broken.axes = [0, -1, 0, -1];
  ok(look()[1] < -0.03 && inp.move().z > 0.9, 'once seen at rest they count');
  broken.axes = [0, 0, NaN, NaN];
  ok(look().every(Number.isFinite), 'a NaN axis is no look');
  inp.dispose();
  Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => [pad], configurable: true });
}

// zones: enter / exit as the player crosses them, once-only zones, and a load that lands inside does not re-fire
{
  const store = new Map(), st = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const z = createGame({ id: 'zones', storage: st }), log = [];
  z.zone({ id: 'gate', box: [[0, 0, 0], [2, 3, 2]], enter: (g, e) => log.push('in ' + e.id), exit: (g, e) => log.push('out ' + e.id) });
  z.zone({ id: 'well', sphere: [[10, 0, 0], 1.5], once: true, enter: (g) => { log.push('well'); g.set('wellSeen'); } });
  const events = [];
  z.on('zone', (d) => events.push(`${d.id}:${d.inside}`));
  const walk = (...ps) => { for (const p of ps) { z.player = p; z.tick(1 / 60); } };
  walk([-1, 0, 1], [1, 0, 1], [1, 1, 1], [3, 0, 1]);
  ok(log.join() === 'in gate,out gate' && events.join() === 'gate:true,gate:false', `box zone enters and exits once each (${log.join()})`);
  walk([9, 0, 0.5], [12, 0, 0], [10, 0, 0]);
  ok(log.filter((l) => l === 'well').length === 1 && z.flags.wellSeen, `a once zone fires one time (${log.join()})`);
  ok(z.zones.get('gate').inside === false && z.zones.get('well').fired, 'zone state readable');
  walk([1, 0, 1]);
  z.save(1);
  z.player = [5, 0, 5]; z.tick(1 / 60);
  log.length = 0;
  z.load(1); z.player = [1, 0, 1]; z.tick(1 / 60);
  ok(log.length === 0, `loading a save made inside a zone does not fire it again (${log.join()})`);
  z.player = [5, 0, 5]; z.tick(1 / 60);
  ok(log.join() === 'out gate', `and leaving it afterwards still fires exit (${log.join()})`);
  const z2 = createGame({ id: 'zones', storage: st }), log2 = [];
  z2.zone({ id: 'well', sphere: [[10, 0, 0], 1.5], once: true, enter: () => log2.push('well') });
  z2.load(1); z2.player = [10, 0, 0]; z2.tick(1 / 60);
  ok(log2.length === 0, 'a once zone fired before the save stays spent after loading');
  z.player = [1, 0, 1]; z.paused = true; z.tick(1 / 60);
  ok(log.join() === 'out gate', 'a paused game fires no zones');
}

// A failed asynchronous setup releases exactly the resources acquired so far.
{
  const host = { scene: new THREE.Scene() }, plan = { name: 'rollback' };
  const reason = new Error('setup failed'), order = [];
  let ctx, capture, failure;
  try {
    await startGame(host, { canvas: {}, built: { plan }, setup: async context => {
      ctx = context;
      capture = ctx.input.capture();
      ctx.onDispose(() => order.push(1));
      ctx.onDispose(() => order.push(2));
      throw reason;
    } });
  } catch (error) { failure = error; }
  ok(failure === reason && order.join() === '2,1', 'startup error preserved and setup cleanup ran once in reverse');
  ok(!ctx.root.parent && ctx.audio.ctx === null && !ctx.input.enabled && await capture === null, 'failed startup detached root, audio and input');
}
// startGame hands animate, fov and maxFps to createPlay (a game kept its scene clock still and its lens at 62°)
{
  const { registerHooks } = await import('node:module');
  const stop = new Error('stub play'), stub = 'data:text/javascript,export const createPlay = (w, o) => globalThis.__stubPlay(w, o); export const bakeWalkGrid = () => null;';
  let seen = null;
  globalThis.__stubPlay = (w, o) => { seen = o; throw stop; };
  const hooks = registerHooks({ resolve: (spec, context, next) => spec === '@miragekit/play' && context.parentURL?.endsWith('?stub-play') ? { url: stub, shortCircuit: true } : next(spec, context) });
  try {
    const { startGame: start } = await import('./src/start.js?stub-play');
    const host = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), prepare: async () => {} };
    const plan = { name: 'lens', spawn: { eye: [0, 1.7, 0], look: [0, 1.7, -1] } };
    let failure = null;
    try { await start(host, { canvas: {}, ui: false, built: { plan, anchors: {} }, animate: true, fov: 75, maxFps: 120 }); } catch (e) { failure = e; }
    ok(failure === stop && seen?.animate === true && seen.fov === 75 && seen.maxFps === 120,
      `startGame forwards animate, fov and maxFps to createPlay (${seen ? JSON.stringify({ animate: seen.animate, fov: seen.fov, maxFps: seen.maxFps }) : failure?.message})`);
  } finally { hooks.deregister(); delete globalThis.__stubPlay; }
}
const capture = input.capture();
input.dispose(); input.dispose();
press('keydown', 'Space'); input.poll();
ok(await capture === null && !input.down('jump') && !input.pressed('jump'), 'disposed input releases capture and ignores events');
phys.dispose();
// dispose after the character has walked: the Rapier world is freed (it threw before) and stepping is a no-op
{
  const sc = new THREE.Scene(); sc.add(new THREE.Mesh(new THREE.BoxGeometry(10, 1, 10), M));
  const p = await createPhysics(sc); p.addStatic(sc);
  const c = p.character({ pos: [0, 0.5, 0] });
  for (let i = 0; i < 30; i++) { c.update(1 / 60, { x: 1, z: 0 }); p.step(1 / 60); }
  let err = null; try { p.dispose(); p.dispose(); } catch (e) { err = e; }
  ok(!err, `physics.dispose after walking (${err ? err.message : 'freed'})`);
}
// a last short step at a 14.5 cm plinth's edge: autostep could lift the character without carrying it onto the
// plinth, and the controller's 2 cm offset then held it hovering beside the lip (garden-quest's pavilion steps,
// acceptance run-003: a save made there loaded 14.5 cm lower). Wherever the step ends, the character stands on
// something under it: on the floor, or on the plinth.
{
  const sc = new THREE.Scene(), add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M); m.position.set(x, y, z); sc.add(m); };
  add(20, 1, 20, 0, -0.5, 0); add(6, 0.145, 4, 0, 0.0725, -2);     // floor top 0; plinth top 0.145, lip at z = 0
  const p = await createPhysics(sc); p.addStatic(sc);
  const c = p.character({ pos: [0, 0, 2] }), R = c.body.radius, hovering = [];
  let tried = 0;
  for (let z0 = R + 0.004; z0 <= R + 0.03; z0 += 0.002) for (const push of [0.1, 0.3, 0.5, 0.7, 0.85, 1]) {
    tried++;
    c.place([0, 0.3, z0]);
    for (let i = 0; i < 5; i++) { c.update(1 / 60, {}); p.step(1 / 60); }
    c.update(1 / 60, { z: -push }); p.step(1 / 60);
    for (let i = 0; i < 60; i++) { c.update(1 / 60, {}); p.step(1 / 60); }
    const [, y, z] = c.pos, onPlinth = z < R - 0.001, raised = y > 0.06;
    if (raised !== onPlinth || y < 0) hovering.push(`z0 ${z0.toFixed(3)} push ${push}: y ${y.toFixed(3)} z ${z.toFixed(3)}`);
  }
  ok(!hovering.length, `no hovering at a step's lip (${hovering.length} / ${tried}${hovering.length ? ': ' + hovering.slice(0, 3).join('; ') : ''})`);
  // place() with the centre over the floor but 10 cm of the cylinder over the plinth: on the plinth (the centre ray
  // alone put it 14.5 cm inside the plinth, and the next walking move lifted it, sometimes into that hover)
  c.place([0, 0, R - 0.1]);
  const placedY = c.pos[1];
  for (let i = 0; i < 30; i++) { c.update(1 / 60, {}); p.step(1 / 60); }
  ok(placedY > 0.16 && placedY < 0.19 && Math.abs(c.pos[1] - placedY) < 0.01, `place() beside a step stands on it (placed ${placedY.toFixed(3)}, then ${c.pos[1].toFixed(3)})`);
  c.place([0, 0, 1]);
  ok(Math.abs(c.pos[1] - 0.02) < 1e-6, `place() on open floor is as before (${c.pos[1].toFixed(4)})`);
  p.dispose();
}
// a prop turned 45° about y: its collider is the prop's own 2 x 0.5 x 0.5 box, turned with it (the world-aligned
// box, 1.77 x 0.5 x 1.77, used to be turned once more: larger and askew; review #14)
{
  const sc = new THREE.Scene(), p = await createPhysics(sc);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.5), M); plank.position.set(3, 1, 0); plank.rotation.y = Math.PI / 4; sc.add(plank);
  const pr = p.body(plank), he = pr.body.collider(0).halfExtents(), t = pr.body.collider(0).translation();
  ok(Math.abs(he.x - 1) < 1e-4 && Math.abs(he.y - 0.25) < 1e-4 && Math.abs(he.z - 0.25) < 1e-4 && Math.hypot(t.x - 3, t.y - 1, t.z) < 1e-4,
    `a turned prop keeps its own box (half ${[he.x, he.y, he.z].map((v) => v.toFixed(3)).join(' ')})`);
  p.dispose();
}
// review 2026-11-09 (game state): loading keeps the player's settings, a broken import changes nothing, removed ids
// a save never removed are cleared, reset() brings removed things back
{
  const mem = new Map(), st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const g = createGame({ id: 't', storage: st });
  const coin = () => ({ id: 'coin', pos: [0, 0, 0] });
  g.settings = {}; g.save(1);
  g.settings = { bindings: { jump: ['KeyJ'] } }; g.load(1);
  ok(g.settings.bindings?.jump?.[0] === 'KeyJ', "loading a save keeps the player's settings");
  g.add(coin()); g.remove('coin'); g.save(2);           // coin removed in slot 2
  const g2 = createGame({ id: 't', storage: st });      // a fresh session: coin not added yet
  g2.load(2); g2.save(3); g2.load(1);                    // slot 1 removed nothing
  ok(!g2.removed.has('coin'), 'a removed id the loaded save never removed is cleared');
  g2.add(coin()); ok(g2.entities.has('coin'), 'and the entity can be added again');
  g2.set('real', 1);
  let err = null; try { g2.importJSON('{"v":1,"id":"t","flags":{"hacked":1},"time":3,"inventory":{}}'); } catch (e) { err = e; }
  ok(err && !g2.flags.hacked && g2.flags.real === 1 && g2.time !== 3, 'a malformed import changes nothing (' + (err && err.message) + ')');
  g2.remove('coin'); g2.reset();
  ok(g2.entities.has('coin') && !g2.removed.size, 'reset() brings removed entities back');
}
// no storage (node, sandboxed iframes): saves live in memory instead of throwing
{
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  let err = null, back = null;
  try { const g = createGame({ id: 'memory' }); g.set('lit', 3); g.save('auto'); g.set('lit', 0); back = g.load('auto'); ok(g.flags.lit === 3, 'loaded flag'); }
  catch (e) { err = e; }
  if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  ok(!err && back, `save and load without localStorage (${err ? err.message : 'in memory'})`);
}
console.log('game check: ok');
