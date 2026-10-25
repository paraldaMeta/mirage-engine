// Node checks of @mirage/game: the character controller on a hand-made scene (floor, wall with a gap, stairs, a
// 0.6 m box, a hinged door, a crate), and the game state (inventory, flags, events, save / load, migration).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createPhysics } from './src/physics.js';
import { createGame } from './src/game.js';

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

// ---- small risers (B16): 5-13 cm, alone or behind a 17 cm step, square / bevelled / one merged mesh, straight
// and at 22 degrees, at 60 / 20 / 10 fps: the character goes up without slowing below 80 % of its walk
{
  const lane = async ({ step = 0, riser, bevel = 0, merge = false, dir = [0, -1], dt = 1 / 60 }) => {
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
    let t = 0;
    for (; t < 6 && c.pos[2] > z0 - 2; t += dt) { c.update(dt, { x: dir[0] / n, z: dir[1] / n }); ph.step(dt); }
    const speed = Math.abs(c.pos[2]) / t / Math.abs(dir[1] / n) / c.body.walk;
    return { up: Math.abs(c.pos[1] - top) < 0.05 && c.pos[2] <= z0 - 2, y: c.pos[1], speed };
  };
  const cases = [];
  for (const riser of [0.05, 0.08, 0.13]) for (const dt of [1 / 60, 1 / 20, 1 / 10]) cases.push({ riser, dt });
  for (const o of [{}, { bevel: 0.03 }, { merge: true }, { bevel: 0.03, merge: true }, { dir: [0.4, -1] }]) cases.push({ step: 0.17, riser: 0.13, ...o }, { riser: 0.05, ...o });
  let worst = 1, fails = [];
  for (const k of cases) { const r = await lane(k); worst = Math.min(worst, r.speed); if (!r.up || r.speed < 0.8) fails.push({ ...k, ...r }); }
  ok(!fails.length, `small risers: ${cases.length - fails.length} / ${cases.length} lanes up, slowest at ${(worst * 100).toFixed(0)} % of the walk` + (fails.length ? ' ' + JSON.stringify(fails) : ''));
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
console.log('game check: ok');
