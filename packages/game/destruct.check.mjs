// Mirage original code. The destructibles (src/destruct.js) without a GPU: `node packages/game/destruct.check.mjs`
// (part of the game package's `npm test`). What a screen shows (shards, lamps really going dark, frame time in a page)
// is checked by examples/demos/destruct/destruct-check.mjs in Chrome. First the system alone (its built-in class);
// then, for the rest, with the library's classes registered (packages/assets/src/destruct, a test-time import: the
// classes' own data is checked by packages/assets/destruct.check.mjs).
import assert from '../../scripts/soft-assert.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

// heap numbers need a collector we can call: run again with --expose-gc
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { createDestructibles, registerDestructData, destructData, DAMAGE_KINDS, BROKEN_STATES } = await import('./src/destruct.js');
const game = await import('./src/index.js');

// ---- 0. alone: nothing registered, one plain class; a game's own class starts from it; no sounds are added
{
  assert.deepEqual(Object.keys(destructData().materials), ['generic', 'actor'], 'the built-in table: generic, actor');
  const added = [], d = createDestructibles({ root: new THREE.Group(), audio: { add: (n) => added.push(n) } }, { floor: 0, materials: { door: { health: 80 } } });
  const it = d.add({ id: 'box', box: { center: [0, 0.5, 0], half: [0.3, 0.3, 0.3] } }), door = d.add({ id: 'door', material: 'door', box: { center: [3, 1, 0], half: [0.5, 1, 0.05] } });
  d.damage(it, 29, 'bullet'); const whole = !it.broken; d.damage(it, 2, 'bullet');
  d.damage(door, 79, 'bullet'); const doorWhole = !door.broken; d.damage(door, 2, 'bullet');
  assert.ok(whole && it.broken && doorWhole && door.broken && added.length === 0, 'alone: breaks at its health, a class of the game\'s own, no sounds');
  assert.throws(() => registerDestructData({ materials: { a: {} }, fallback: 'b' }), Error);
}
const { DESTRUCT_MATERIALS } = await import('../assets/src/destruct/index.js');
const { createLampPool, lampPoolConfig } = await import('../core/src/lamppool.js');
const { createInjector } = await import('../core/src/inject.js');
const { createGame } = await import('./src/game.js');

const lines = [];
const mk = (o = {}) => { const root = new THREE.Group(); return { root, d: createDestructibles({ root }, { seed: 'check', floor: 0, ...o }) }; };
const box = (c, h = [0.3, 0.3, 0.3]) => ({ center: c, half: h });
const run = (d, sec) => { for (let i = 0; i < Math.round(sec * 60); i++) d.update(1 / 60); };
assert.equal(typeof game.createDestructibles, 'function', 'exported from @miragekit/game');

// ---- 1. every class breaks at its health (through its armour), not a point before
{
  const { d } = mk();
  const rows = [];
  for (const [cls, m] of Object.entries(DESTRUCT_MATERIALS)) {
    const kind = DAMAGE_KINDS.reduce((a, k) => ((m.armour[k] ?? 1) > (m.armour[a] ?? 1) ? k : a), 'bullet'), a = m.armour[kind] ?? 1;
    const it = d.add({ id: cls, material: cls, box: box([rows.length * 3, 0.5, 0]) });
    d.damage(it, m.health / a * 0.98, kind);
    const before = it.broken;
    d.damage(it, m.health / a * 0.03, kind);
    rows.push(cls);
    assert.ok(!before && it.broken, `${cls}: whole at 98 % of ${m.health} (${kind}), broken past it`);
    if (cls === 'heavyMetal') { const h = d.add({ id: 'hm2', material: cls, box: box([99, 0.5, 0]) }); for (let i = 0; i < 40; i++) d.damage(h, 21, 'bullet'); assert.ok(!h.broken, 'heavy metal shrugs off 40 bullets'); }
  }
  for (const k of ['glass', 'paper', 'wood', 'cardboard', 'plastic', 'thinMetal', 'heavyMetal', 'ceramic', 'liquid', 'electronics', 'fabric']) assert.ok(DESTRUCT_MATERIALS[k], 'class ' + k);
  // a pistol round through a pane: the crate behind takes the pane's pierce share
  const { d: d2 } = mk();
  d2.add({ id: 'pane', material: 'glass', box: box([0, 1, -2], [1, 1, 0.01]), health: 100 });
  const c = d2.add({ id: 'crate', material: 'wood', box: box([0, 1, -4], [0.4, 0.4, 0.4]), health: 100 });
  const r = d2.hit({ ray: { origin: [0, 1, 0], dir: [0, 0, -1], max: 20 }, kind: 'bullet', damage: 20 });
  assert.ok(r.count === 2 && r.hits[0].id === 'pane' && r.hits[1].id === 'crate', 'the bullet goes through the pane into the crate');
  assert.ok(Math.abs(c.health - (100 - 20 * 0.85 * 0.8)) < 1e-6, `the crate took 20 x 0.85 (pierce) x 0.8 (wood armour): ${c.health}`);
  const r2 = d2.hit({ ray: { origin: [0, 1, 0], dir: [0, 0, -1], max: 20 }, kind: 'blast', damage: 20 });
  assert.ok(r2.count === 1 && r2.stopped === 'item', 'a blast fragment does not pierce');
  const r3 = d2.hit({ ray: { origin: [0, 1, 0], dir: [0, 0, -1], max: 3 }, kind: 'bullet', damage: 1 });
  assert.ok(r3.count === 1, 'max: the world wall in front of the crate stops the ray');
  lines.push(`${rows.length} classes break at their health`);
}

// ---- 2. protected props never break
{
  const { d } = mk();
  const sign = d.add({ id: 'owner-sign', material: 'glass', box: box([0, 3, -2], [1, 0.4, 0.05]), protected: true, tags: ['owner'] });
  let hits = 0; d.on('hit', (e) => { if (e.item === sign) hits++; });
  for (let i = 0; i < 200; i++) d.hit({ ray: { origin: [0, 3, 0], dir: [0, 0, -1] }, kind: 'pellet', damage: 50 });
  for (let i = 0; i < 20; i++) d.blast({ point: [0, 3, -1.5], radius: 5, damage: 1000 });
  assert.equal(d.break('owner-sign'), false, 'break() refuses a protected prop');
  run(d, 1);
  assert.ok(!sign.broken && sign.health === sign.max && hits > 200, `protected: whole after 200 hits and 20 blasts (hit events ${hits})`);
  assert.equal(d.tally.count, 0, 'nothing tallied');
  lines.push('protected: 0 of 220 hits break it');
}

// ---- 3. blast occlusion: behind solid world, nothing; behind a heavy prop, a quarter
{
  const wall = (from, dir, max) => { if (dir[0] <= 0) return null; const t = (1 - from[0]) / dir[0]; return t >= 0 && t <= max ? { distance: t, point: [1, from[1] + dir[1] * t, from[2] + dir[2] * t], normal: [-1, 0, 0] } : null; };
  const { d } = mk({ occluder: wall });
  const open = d.add({ id: 'open', material: 'wood', box: box([-2, 0.5, 0]), health: 1000 });
  const hid = d.add({ id: 'hidden', material: 'wood', box: box([2, 0.5, 0]), health: 1000 });
  const shield = d.add({ id: 'shield', material: 'heavyMetal', box: box([0, 0.5, 2], [1, 1, 0.1]), health: 1e6 });
  const back = d.add({ id: 'behind-metal', material: 'wood', box: box([0, 0.5, 4]), health: 1000 });
  const side = d.add({ id: 'side', material: 'wood', box: box([-2.65, 0.5, 2.65]), health: 1000 });
  const res = d.blast({ point: [0, 0.5, 0], radius: 6, damage: 100, falloff: 'linear' });
  const got = Object.fromEntries(res.map((x) => [x.item.id, x]));
  const dOpen = 1000 - open.health, dHid = 1000 - hid.health, dBack = 1000 - back.health, dSide = 1000 - side.health;
  assert.ok(dOpen > 50 && dHid === 0 && got.hidden.cover === 0, `occlusion: open ${dOpen.toFixed(1)}, behind the wall ${dHid}`);
  assert.ok(Math.abs(got['behind-metal'].cover - 0.25) < 1e-9 && dBack > 0 && dBack < dSide * 0.5, `behind heavy metal a quarter (${dBack.toFixed(1)} vs ${dSide.toFixed(1)} in the open at the same distance)`);
  assert.ok(shield.health < 1e6, 'the shield itself is hit');
  const nob = d.blast({ point: [0, 0.5, 0], radius: 6, damage: 100, occlusion: false });
  assert.ok(nob.find((x) => x.item.id === 'hidden').damage > 0, 'occlusion: false reaches behind the wall');
  assert.ok(d.cover([0, 0.5, 0], [2, 0.5, 0]) === 0 && d.cover([0, 0.5, 0], [-2, 0.5, 0]) === 1, 'cover() for game entities agrees');
  lines.push(`blast cover: open ${dOpen.toFixed(0)}, behind wall 0, behind metal x0.25`);
}

// ---- 4. chain and explosive behaviours, in order
{
  const { d } = mk();
  const order = [];
  d.on('break', (e) => order.push([e.id, +d.time.toFixed(3)]));
  for (let i = 0; i < 6; i++) d.add({ id: 'bulb' + i, material: 'glass', group: 'string-a', sphere: { center: [i * 0.4, 3, 0], radius: 0.05 }, health: 5, behave: { chain: { delay: 0.1 } }, value: 3 });
  d.hit({ ray: { origin: [0.8, 3, 2], dir: [0, 0, -1] }, damage: 10 });   // bulb2
  run(d, 0.6);
  const ids = order.map((o) => o[0]);
  assert.deepEqual(ids, ['bulb2', 'bulb1', 'bulb3', 'bulb0', 'bulb4', 'bulb5'], 'chain: the shot bulb, then outwards one by one: ' + ids.join(' '));
  const ts = order.map((o) => o[1]);
  assert.ok(ts[1] - ts[0] > 0.08 && ts[3] - ts[1] > 0.08 && ts[5] - ts[3] > 0.08, 'chain: one delay per step outwards ' + ts.join(' '));
  // fuel can: a delayed blast that breaks the crate beside it and a second can, which goes off in turn
  const { d: e } = mk();
  const ev = [];
  for (const t of ['break', 'blast']) e.on(t, (x) => ev.push(t + ':' + (x.id || x.source?.id) + '@' + e.time.toFixed(2)));
  e.add({ id: 'can1', material: 'thinMetal', health: 10, box: box([0, 0.3, 0]), behave: { explosive: { delay: 0.5, radius: 3, damage: 200 } } });
  e.add({ id: 'crate', material: 'wood', box: box([1.2, 0.4, 0]) });
  e.add({ id: 'can2', material: 'thinMetal', health: 10, box: box([-2, 0.3, 0]), behave: { explosive: { delay: 0.3, radius: 3, damage: 200 } } });
  const blasts = []; e.on('blast', (b) => blasts.push(b));
  e.damage('can1', 50, 'bullet');
  run(e, 2);
  const want = ['break:can1@0.00', 'break:crate@0.50', 'break:can2@0.50', 'blast:can1@0.50', 'break:', 'blast:can2@0.80'];
  assert.ok(ev[0] === want[0] && ev.includes('break:crate@0.50') && ev.includes('break:can2@0.50') && ev.indexOf('blast:can1@0.50') > ev.indexOf('break:can2@0.50') && ev[ev.length - 1] === 'blast:can2@0.80', 'explosive: can1 -> its blast breaks crate and can2 -> can2 goes 0.3 s later: ' + ev.join(', '));
  assert.ok(blasts.length === 2 && typeof blasts[0].cover === 'function', "'blast' events for the game's own entities, with cover()");
  lines.push(`chain ${ids.join('>')}; explosive ${ev.length} events in order`);
}

// ---- 5. lamps: a broken lamp prop switches its pool lamps off (the real lamp pool, stand-in renderer)
{
  const scene = new THREE.Scene(), inj = createInjector();
  const pool = createLampPool({ scene, G: { uLampGain: { value: 1 }, uLamp: { value: 1 } }, injector: inj }, lampPoolConfig(true));
  pool.set(Array.from({ length: 40 }, (_, i) => ({ pos: [i % 8 - 4, 2.5, -2 - Math.floor(i / 8)], power: 2 })));
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 400); cam.position.set(0, 1.6, 4); cam.lookAt(0, 2, -4); cam.updateMatrixWorld();
  const r = { getCurrentViewport: (v) => v.set(0, 0, 800, 800) };
  scene.onBeforeRender(r, scene, cam, null);
  const active0 = pool.info.active, lit0 = pool.lit;
  const pl = new THREE.PointLight(0xffffff, 3), mat = new THREE.MeshStandardMaterial({ emissive: 0xffaa55, emissiveIntensity: 4 });
  const { d } = mk({ lamps: pool });
  d.add({ id: 'neon', material: 'glass', box: box([0, 2.5, -2], [1.2, 0.05, 0.05]), lamps: [0, 1, 2, 3], lights: [pl], emissive: mat, health: 10 });
  d.add({ id: 'panel', material: 'electronics', box: box([0, 1, -5]), lamps: [10, 11], lampMode: 'flicker', health: 40 });
  d.hit({ ray: { origin: [0, 2.5, 0], dir: [0, 0, -1] }, damage: 30 });
  run(d, 0.05);
  scene.onBeforeRender(r, scene, cam, null);
  assert.ok(pool.lit === lit0 - 4 && pool.info.active === active0 - 4 && pl.intensity === 0 && mat.emissiveIntensity === 0, `neon tube: 4 pool lamps, its light and its glow go dark (lit ${lit0} -> ${pool.lit}, active ${active0} -> ${pool.info.active})`);
  d.damage('panel', 20, 'bullet');   // electronics at 50 %: its lamps stutter, then come back
  let dips = 0; for (let i = 0; i < 50; i++) { d.update(1 / 60); if (pool.scaleOf(10) < 0.5) dips++; }
  assert.ok(dips > 2 && pool.scaleOf(10) === 1, `a hurt panel flickers (${dips} dark steps) and comes back`);
  d.damage('panel', 30, 'bullet');
  run(d, 1.2);
  scene.onBeforeRender(r, scene, cam, null);
  assert.ok(pool.lit === lit0 - 6, `broken panel: flicker, then out (lit ${pool.lit})`);
  d.reset(); scene.onBeforeRender(r, scene, cam, null);
  assert.ok(pool.lit === lit0 && pl.intensity === 3 && mat.emissiveIntensity === 4 && pool.info.active === active0, 'reset: every lamp back');
  // a function adapter (a game that keeps its own lamp list)
  const seen = []; const { d: d2 } = mk({ lamps: (i, k) => seen.push([i, k]) });
  d2.add({ id: 'l', material: 'glass', box: box([0, 1, 0]), lamps: [7], health: 1 }); d2.damage('l', 5);
  assert.deepEqual(seen, [[7, 0]], 'lamps: (index, k) => void');
  pool.dispose();
  lines.push(`lamps: pool lit ${lit0} -> ${lit0 - 6} -> ${lit0} after reset`);
}

// ---- 6. stress: 1000 hits in a second; caps, time, memory
{
  const { d } = mk({ maxDebris: 600, maxDecals: 96 });
  for (let i = 0; i < 900; i++) {
    const x = (i % 30) - 15, z = -3 - Math.floor(i / 30) * 1.2, cls = ['glass', 'wood', 'cardboard', 'ceramic', 'plastic', 'liquid'][i % 6];
    d.add({ id: 's' + i, material: cls, box: box([x, 1, z], cls === 'glass' ? [0.45, 0.6, 0.01] : [0.3, 0.3, 0.3]) });
  }
  d.prewarm();
  const R = (() => { let s = 7; return () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296); })();
  const pass = () => {
    let maxDebris = 0, maxMarks = 0, maxMs = 0, total = 0;
    for (let f = 0; f < 60; f++) {
      const t0 = performance.now();
      for (let k = 0; k < 17; k++) d.hit({ ray: { origin: [R() * 30 - 15, 1 + (R() - 0.5) * 0.8, 2], dir: [(R() - 0.5) * 0.1, 0, -1], max: 60 }, kind: k % 3 ? 'bullet' : 'pellet', damage: 22 });
      if (f % 20 === 0) d.blast({ point: [R() * 20 - 10, 1, -8], radius: 4, damage: 150 });
      d.update(1 / 60);
      const ms = performance.now() - t0; maxMs = Math.max(maxMs, ms); total += ms;
      maxDebris = Math.max(maxDebris, d.debris.live); maxMarks = Math.max(maxMarks, d.marks.count);
    }
    run(d, 2);
    return { maxDebris, maxMarks, maxMs, mean: total / 60, broken: d.tally.count, spawned: d.debris.stats.spawned };
  };
  const a = pass(); d.reset(); globalThis.gc(); const h1 = process.memoryUsage().heapUsed;
  const b = pass(); d.reset(); globalThis.gc(); const b2 = pass(); d.reset(); globalThis.gc(); const h2 = process.memoryUsage().heapUsed;
  void b2;
  assert.ok(a.maxDebris <= 600 && a.maxDebris > 300, `debris cap holds: at most ${a.maxDebris} of 600 live`);
  assert.ok(a.maxMarks <= 96 && a.maxMarks > 40, `decal cap holds: at most ${a.maxMarks} of 96`);
  assert.ok(a.broken > 300, `the stress breaks things (${a.broken})`);
  // the bound: 17 hits + their breaks + the step, per 1/60 s frame, on one CPU core (Node)
  assert.ok(a.mean < 2.5 && b.mean < 2.5, `frame cost under stress: mean ${a.mean.toFixed(2)} / ${b.mean.toFixed(2)} ms (bound 2.5 ms), worst ${Math.max(a.maxMs, b.maxMs).toFixed(1)} ms`);
  const grow = (h2 - h1) / 1024;
  assert.ok(grow < 512, `no heap growth across two more stress seconds: ${grow.toFixed(0)} KB (bound 512 KB)`);
  lines.push(`stress 1000 hits/s on 900 props: debris <= ${a.maxDebris}/600, marks <= ${a.maxMarks}/96, ${a.broken} broken, mean ${a.mean.toFixed(2)} ms, worst ${a.maxMs.toFixed(1)} ms per frame, heap ${grow >= 0 ? '+' : ''}${grow.toFixed(0)} KB`);
}

// ---- 7. snapshot -> restore reproduces the broken set; reset; saves through createGame
{
  const build = () => {
    const { root, d } = mk();
    const meshes = [];
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial()); m.position.set(i - 6, 0.3, -3); root.add(m); meshes.push(m); d.add({ id: 'c' + i, draw: m, material: i % 2 ? 'wood' : 'cardboard', tags: i < 6 ? ['left'] : ['right'], value: 10 + i }); }
    d.add({ id: 'tank', material: 'liquid', box: box([0, 0.4, -6]), health: 10 });
    return { root, d, meshes };
  };
  const A = build();
  for (let i = 0; i < 12; i += 3) A.d.damage('c' + i, 100);
  A.d.damage('c1', 10); A.d.damage('tank', 50);
  run(A.d, 3);
  const snap = JSON.parse(JSON.stringify(A.d.snapshot())), tally = JSON.stringify(A.d.tally);
  const B = build();
  B.d.restore(snap);
  assert.deepEqual(B.d.snapshot().broken, snap.broken, 'restore: the same broken set');
  assert.ok(B.meshes.every((m, i) => m.visible === A.meshes[i].visible), 'restore: the same props hidden');
  assert.equal(JSON.stringify(B.d.tally), tally, 'restore: the same tally (by class and tag)');
  assert.ok(B.d.get('c1').health === A.d.get('c1').health, 'restore: hurt props keep their health');
  assert.ok(B.d.surfaceAt([0, 0, -6]) && B.d.debris.live === 0, 'restore: the spill is there at full size, no debris flies');
  assert.ok(JSON.stringify(snap).length < 300, `compact: ${JSON.stringify(snap).length} bytes`);
  B.d.reset();
  assert.ok(B.meshes.every((m) => m.visible) && B.d.tally.count === 0 && !B.d.surfaceAt([0, 0, -6]), 'reset: all whole again');
  // through a game's save: the registry is an entity of the game
  const g = createGame({ id: 'dx', storage: { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } } });
  const root = new THREE.Group(), gd = createDestructibles({ game: g, root }, { seed: 'g', floor: 0 });
  gd.add({ id: 'w', material: 'glass', box: box([0, 1, -2], [1, 1, 0.01]) });
  gd.damage('w', 100); g.save(1);
  gd.reset(); assert.ok(!gd.get('w').broken, 'reset');
  g.load(1); assert.ok(gd.get('w').broken, 'game.load(1) brings the broken pane back (entity "destructibles")');
  for (let i = 0; i < 30; i++) g.tick(1 / 60);
  assert.ok(gd.steps === 30, `stepped by the game's systems (${gd.steps})`);
  lines.push(`snapshot ${JSON.stringify(snap).length} B restores ${snap.broken.length} broken`);
}

// ---- 8. two seeded runs are identical; another seed differs
{
  const scenario = (seed) => {
    const { d } = mk({ seed });
    for (let i = 0; i < 40; i++) d.add({ id: 'p' + i, material: ['glass', 'wood', 'ceramic', 'plastic'][i % 4], box: box([i % 8 - 4, 1, -3 - Math.floor(i / 8)], [0.3, 0.3, 0.3]), mover: i % 7 === 0 ? { shape: 'cylinder', breakable: false } : undefined });
    const out = [];
    for (let f = 0; f < 120; f++) {
      if (f % 4 === 0) d.hit({ ray: { origin: [(f % 9) - 4, 1, 2], dir: [0, 0, -1] }, damage: 30 });
      if (f === 60) d.blast({ point: [0, 1, -5], radius: 3, damage: 80 });
      d.update(1 / 60);
      if (f % 30 === 29) out.push(d.hash());
    }
    return out.join(' ');
  };
  const a = scenario('s1'), b = scenario('s1'), c = scenario('s2');
  assert.equal(a, b, 'two runs with one seed agree step for step');
  assert.notEqual(a, c, 'another seed throws other debris');
  lines.push(`determinism: ${a.split(' ').pop()}`);
}

// ---- 9. zero cost when nothing is registered
{
  const root = new THREE.Group(), g = createGame({ id: 'z' });
  const d = createDestructibles({ game: g, root }, {});
  for (let i = 0; i < 60; i++) { g.tick(1 / 60); d.update(1 / 60); }
  assert.ok(root.children.length === 0 && d.steps === 0 && !g.dirty, 'nothing added to the scene, nothing stepped, no redraw asked');
  const t0 = performance.now(); for (let i = 0; i < 1e5; i++) d.update(1 / 60); const us = (performance.now() - t0) * 10;
  assert.ok(us < 50, `an empty update costs ${us.toFixed(2)} ns`);
  lines.push('empty registry: no objects, no steps');
}

// ---- 10. draw handles: an instance, a BatchedMesh id, a merged range, an object; broken states
{
  const root = new THREE.Group(), d = createDestructibles({ root }, { floor: 0 });
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), new THREE.MeshStandardMaterial(), 1000);
  for (let i = 0; i < 1000; i++) im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i % 40 * 0.3, 1, -2 - Math.floor(i / 40) * 0.3));
  root.add(im); root.updateMatrixWorld(true);
  for (let i = 0; i < 1000; i++) d.add({ id: 'bottle' + i, draw: { mesh: im, index: i }, material: 'glass', health: 5 });
  const before = im.instanceMatrix.array.slice(517 * 16, 518 * 16);
  const r = d.hit({ ray: { origin: [17 * 0.3, 1, 0], dir: [0, 0, -1] }, damage: 10 });
  assert.ok(r.item?.id === 'bottle17' && im.instanceMatrix.array[17 * 16] === 0, 'an instance: found by the ray from its own bounds and hidden (scale 0)');
  d.damage('bottle517', 10);
  d.reset();
  assert.deepEqual([...im.instanceMatrix.array.slice(517 * 16, 518 * 16)], [...before], 'reset: the instance matrix back');
  const bm = new THREE.BatchedMesh(4, 200, 400, new THREE.MeshStandardMaterial()), gid = bm.addGeometry(new THREE.BoxGeometry(0.5, 1.6, 0.4));
  const ids = [0, 1].map((k) => { const id = bm.addInstance(gid); bm.setMatrixAt(id, new THREE.Matrix4().makeTranslation(k * 2, 0.8, -6)); return id; });
  root.add(bm); root.updateMatrixWorld(true);
  const mg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), new THREE.MeshStandardMaterial()); mg.position.set(10, 0.5, -3); root.add(mg); root.updateMatrixWorld(true);
  const rng0 = mg.geometry.attributes.position.array.slice(0, 18);
  d.add({ id: 'side', draw: { mesh: mg, range: [0, 6] }, material: 'cardboard', health: 1, box: box([10.5, 0.5, -3], [0.05, 0.5, 0.5]) });
  d.damage('side', 5);
  const p = mg.geometry.attributes.position.array;
  assert.ok(p[0] === p[3] && p[3] === p[15] && p[1] === p[16], 'a merged range collapses onto one point');
  const casualties = [], panics = [];
  d.on('casualty', (e) => casualties.push(e.id)); d.on('panic', (e) => panics.push(e.id));
  d.actor({ id: 'bot0', draw: [{ mesh: bm, id: ids[0] }], pos: [0, 0, -6] });
  d.actor({ id: 'bot1', draw: [{ mesh: bm, id: ids[1] }], pos: [2, 0, -6] });
  d.hit({ ray: { origin: [0, 0.6, 0], dir: [0, 0, -1] }, damage: 60 });
  run(d, 1);
  const m0 = new THREE.Matrix4(); bm.getMatrixAt(ids[0], m0);
  const upY = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m0)).y;
  assert.ok(casualties.join() === 'bot0' && panics.join() === 'bot1' && upY < 0.4, `actor: slumps (up ${upY.toFixed(2)}), 'casualty' bot0, 'panic' bot1 (${casualties} / ${panics})`);
  assert.ok(d.tally.casualties === 1, 'tally.casualties');
  d.reset(); bm.getMatrixAt(ids[0], m0);
  assert.ok(Math.abs(m0.elements[5] - 1) < 1e-6 && p[0] === rng0[0] && p[3] === rng0[3], 'reset: the actor stands, the range is back');
  for (const k of Object.keys(BROKEN_STATES)) { const g = BROKEN_STATES[k](); g.computeBoundingBox(); const s = g.boundingBox.getSize(new THREE.Vector3()); assert.ok(g.attributes.position.count > 12 && s.x <= 1.8 && s.y <= 1.3, `broken state ${k}: ${g.attributes.position.count} vertices in about a unit box`); }
  lines.push('handles: instance, batched, range, object; actor casualty + panic');
}

// ---- 11. movers, spills, steam, fall, burn, loot, alarm
{
  const root = new THREE.Group(), d = createDestructibles({ root }, { floor: 0, seed: 'm' });
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 10), new THREE.MeshStandardMaterial(), 8);
  for (let i = 0; i < 8; i++) im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 0.15, 0.06, -2));
  root.add(im); root.updateMatrixWorld(true);
  for (let i = 0; i < 8; i++) d.add({ id: 'can' + i, draw: { mesh: im, index: i }, material: 'thinMetal', mover: { shape: 'cylinder', breakable: false, mass: 0.35 } });
  d.hit({ ray: { origin: [0.3, 0.09, 0], dir: [0, 0, -1] }, damage: 22 });
  const moved = d.moving.length;
  run(d, 0.3);
  const can = d.get('can2'), y = can.vol.c[1], z = can.vol.c[2];
  run(d, 6);
  assert.ok(moved === 1 && !can.broken && z < -2.2, `a can knocked off its spot (moving ${moved}, z ${z.toFixed(2)}, y ${y.toFixed(2)})`);
  assert.ok(d.moving.length === 0 && im.instanceMatrix.array[2 * 16] !== 0 && Math.abs(im.instanceMatrix.array[2 * 16 + 14] + 2) > 0.2, 'asleep: back in its instance, where it came to rest');
  d.reset(); assert.ok(Math.abs(im.instanceMatrix.array[2 * 16 + 14] + 2) < 1e-6, 'reset: back on its spot');
  { // a per-instance attribute (a label) goes with the moving copy: its own, the right length, the instance's value
    const g = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 6), lab = new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0.25, 0.5, 0.75, 0.125]), 2);
    g.setAttribute('lab', lab);
    const m2 = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial(), 3);
    for (let i = 0; i < 3; i++) m2.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 0.15, 0.06, -6));
    root.add(m2); root.updateMatrixWorld(true);
    for (let i = 0; i < 3; i++) d.add({ id: 'lab' + i, draw: { mesh: m2, index: i }, material: 'thinMetal', mover: { shape: 'cylinder', breakable: false } });
    d.hit({ ray: { origin: [0.3, 0.09, -4], dir: [0, 0, -1] }, damage: 22 });
    const L = [...root.children].find((o) => o.name.endsWith(':moving') && o.geometry.attributes.lab);
    const a = L?.geometry.attributes.lab;
    assert.ok(a && a !== lab && a.count >= 3 && a.array[0] === 0.75 && a.array[1] === 0.125, `a moving copy keeps its instance's own attributes (lab ${a ? [a.array[0], a.array[1]] : 'none'})`);
    d.reset();
  }
  // spill and steam
  d.add({ id: 'jug', material: 'liquid', box: box([3, 0.3, -2]), behave: { spillLiquid: { conductive: true } } });
  d.add({ id: 'pipe', material: 'thinMetal', health: 20, box: box([5, 1.5, -2], [1, 0.05, 0.05]), behave: { ventSteam: { duration: 3 } } });
  d.damage('jug', 50); d.hit({ ray: { origin: [5, 1.5, 0], dir: [0, 0, -1] }, damage: 40 });
  run(d, 1.6);
  const s = d.surfaceAt([3, 0, -2]);
  assert.ok(s && s.slippery && s.conductive && !d.surfaceAt([6, 0, -2]), 'spillLiquid: a slippery, conductive puddle there and nowhere else');
  const v = d.visibility([5, 2.2, 2], [5, 2.2, -6]);
  assert.ok(v < 0.35 && d.blocksSight([5, 2.2, 2], [5, 2.2, -6]) && d.visibility([8, 2.2, 2], [8, 2.2, -6]) === 1, `ventSteam: sight through the steam ${v.toFixed(3)}, beside it 1`);
  run(d, 3); assert.ok(d.visibility([5, 2.2, 2], [5, 2.2, -6]) === 1, 'the vent stops after its duration');
  // a hung sign cut loose lands on a crate
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.06), new THREE.MeshStandardMaterial()); sign.position.set(10, 3, -2); root.add(sign); root.updateMatrixWorld(true);
  const crushed = []; d.on('crush', (e) => crushed.push(e));
  d.add({ id: 'sign', draw: sign, material: 'thinMetal', health: 15, behave: { fall: { damage: 80, radius: 1 } } });
  const crate = d.add({ id: 'crate', material: 'cardboard', box: box([10, 0.25, -2], [0.25, 0.25, 0.25]) });
  d.damage('sign', 40);
  run(d, 2);
  assert.ok(crushed.length === 1 && crate.broken && sign.position.y < 1 && sign.visible, `fall: the sign drops (${sign.position.y.toFixed(2)} m), crushes the crate, stays where it lands`);
  // burn: a blast sets the stall's gas can on fire; it burns, then goes off
  const fires = [], loot = [], noise = [];
  d.on('fire', (e) => fires.push(e)); d.on('loot', (e) => loot.push(e)); d.on('noise', (e) => noise.push(e));
  d.add({ id: 'gas', material: 'thinMetal', health: 200, box: box([14, 0.3, -2]), behave: { burn: { duration: 2, then: 'explode' } } });
  d.add({ id: 'box', material: 'cardboard', box: box([16, 0.3, -2]), behave: { dropLoot: { table: [{ id: 'ammo', weight: 1 }] } } });
  d.add({ id: 'car', material: 'thinMetal', health: 400, box: box([20, 0.7, -2], [2, 0.7, 1]), behave: { alarm: { radius: 30, duration: 2 } } });
  d.blast({ point: [14.8, 0.3, -2], radius: 1, damage: 30 });
  const t0 = d.time; run(d, 1); const midBroken = d.get('gas').broken; run(d, 1.5);
  assert.ok(fires.length === 1 && !midBroken && d.get('gas').broken && d.get('box').broken, `burn: catches, burns ~2 s (${(d.time - t0).toFixed(1)}), goes off and takes the box`);
  assert.ok(loot.length === 1 && loot[0].loot.id === 'ammo', 'dropLoot: an event with the table pick');
  d.hit({ ray: { origin: [20, 0.7, 4], dir: [0, 0, -1] }, damage: 10 });
  assert.ok(noise.some((n) => n.kind === 'alarm' && n.radius === 30), 'alarm: a noise event for AI on the first hit');
  lines.push('movers, spill, steam, fall, burn, loot, alarm');
}

console.log('destruct check: ' + lines.join('; '));
