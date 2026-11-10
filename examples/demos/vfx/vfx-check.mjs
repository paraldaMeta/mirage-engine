// Check: the effect system on a real GPU (headless Chrome). What the Node check (packages/core/vfx.check.mjs) cannot
// see: the simulation's textures, the sort, collisions, budgets and the library actually producing particles.
// node examples/demos/vfx/vfx-check.mjs   (packages the demo into out/, opens it twice)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const html = path.join(here, 'out/vfx.html');
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', html], { stdio: ['ignore', 'ignore', 'inherit'] });

// runs in the page. A second, hand-clocked system (not the world's) so every test picks its own step count.
const IN_PAGE = async () => {
  const { world, createVfx, VFX_LIBRARY } = window.__mirage, R = {};
  const mk = (o) => createVfx({ renderer: world.renderer, scene: world.scene, camera: world.camera }, o);
  const run = (v, from, to, every = 1) => { for (let i = from; i <= to; i += every) v.update(i / 60); };
  const hash = (v) => { let h = 2166136261 >>> 0, n = 0; for (const p of v.pools()) { const s = p.read(); for (const k of ['P', 'V', 'X']) { const b = new Uint32Array(s[k].buffer); for (let i = 0; i < b.length; i++) { h = Math.imul(h ^ b[i], 16777619) >>> 0; } n += b.length; } } return h.toString(16) + ':' + n; };
  const live = (p) => { const { P, V } = p.read(), out = []; for (let i = 0; i < p.cap; i++) if (V[4 * i + 3] > 0 && P[4 * i + 3] < V[4 * i + 3]) out.push([P[4 * i], P[4 * i + 1], P[4 * i + 2], V[4 * i], V[4 * i + 1], V[4 * i + 2]]); return out; };

  // 1. determinism: the same steps give the same bits; and stepping two at a time lands on the same state
  const scene1 = (every) => {
    const v = mk({});
    v.spawn(VFX_LIBRARY.fire, { position: [0, 0, 0] }); v.spawn(VFX_LIBRARY.fireflies, { position: [3, 0, 0] }); v.burst(VFX_LIBRARY.explosion, [1, 0.5, 0]); v.burst(VFX_LIBRARY.magic, [-2, 0, 0]);
    run(v, 0, 150, every);
    const h = hash(v), alive = v.countAlive(); v.dispose();
    return { h, alive };
  };
  const a = scene1(1), b = scene1(1), c = scene1(2);
  R.determinism = { first: a.h, again: b.h, by2: c.h, alive: a.alive };

  // 2. every library effect puts particles in the air
  R.library = {};
  for (const name of Object.keys(VFX_LIBRARY)) {
    const v = mk({}); v.spawn(VFX_LIBRARY[name], { position: [0, 1, 0] }); run(v, 0, 45);
    R.library[name] = { alive: v.countAlive(), pools: v.pools().length }; v.dispose();
  }

  // 3. the sort: keys ascending (farthest first), slots a permutation of the pool
  {
    const v = mk({}); v.spawn({ name: 's', rate: 900, life: 2, shape: { type: 'box', size: [6, 3, 6] }, velocity: { random: [0, 1] }, render: { sort: 'distance' } }, { position: [0, 1.5, 0] }); run(v, 0, 120);
    const p = v.pools()[0], o = v.sorter.sort(p, world.camera), w = o.target.width, h = o.target.height, buf = new Float32Array(w * h * 4);
    world.renderer.readRenderTargetPixels(o.target, 0, 0, w, h, buf);
    let bad = 0, n = 0; const seen = new Set();
    for (let i = 0; i < w * h; i++) { if (i && buf[4 * i] < buf[4 * i - 4]) bad++; if (buf[4 * i] < 1e29) n++; seen.add(buf[4 * i + 1]); }
    // the order against the CPU's own depth for the same particles
    const e = world.camera.matrixWorldInverse.elements, { P } = p.read(); let wrong = 0, prev = Infinity;
    for (let i = 0; i < n; i++) { const s = buf[4 * i + 1], d = -(e[2] * P[4 * s] + e[6] * P[4 * s + 1] + e[10] * P[4 * s + 2] + e[14]); if (d > prev + 1e-3) wrong++; prev = d; }
    R.sort = { texels: w * h, live: n, alive: v.countAlive(), outOfOrder: bad, wrongDepth: wrong, distinct: seen.size, passes: v.sorter.passes / 121 }; v.dispose();
  }

  // 4. collisions: ground (kill / bounce / stick) and a plane
  {
    const base = { rate: 300, life: 3, shape: { type: 'box', size: [2, 0.2, 2] }, velocity: { dir: [0, -1, 0], speed: [1, 2], spread: 30 }, gravity: -9.8 };
    const go = (collision) => { const v = mk({}); v.setGround({ min: [-20, -20], size: [40, 40], res: [4, 4], heightAt: () => 0.5 }); v.spawn({ name: 'c', ...base, collision }, { position: [0, 3, 0] }); run(v, 0, 170);
      const L = live(v.pools()[0]); let minY = Infinity, slow = 0, low = 0; for (const q of L) { minY = Math.min(minY, q[1]); if (q[1] < 0.6) { low++; if (Math.hypot(q[3], q[4], q[5]) < 1e-3) slow++; } } v.dispose(); return { n: L.length, minY: +minY.toFixed(3), low, still: slow }; };
    R.collide = { none: go(undefined), kill: go({ ground: true, mode: 'kill' }), bounce: go({ ground: true, mode: 'bounce', bounce: 0.5 }), stick: go({ ground: true, mode: 'stick' }), plane: go({ planes: [[0, 1, 0, -1.5]], mode: 'bounce' }) };
  }
  return { R };
};

const IN_PAGE_2 = async () => {
  const { world, createVfx, VFX_LIBRARY, THREE } = window.__mirage, R = {};
  const mk = (o) => createVfx({ renderer: world.renderer, scene: world.scene, camera: world.camera }, o);
  const run = (v, from, to, every = 1) => { for (let i = from; i <= to; i += every) v.update(i / 60); };

  // 5. budgets: the per-emitter capacity, and the global cap pulling every rate down
  {
    const v = mk({ instances: 1 }); v.spawn({ name: 'cap', rate: 1000, life: 2, capacity: 500 }); run(v, 0, 200);
    R.capacity = { alive: v.countAlive(), cap: v.pools()[0].cap, dropped: v.stats.dropped }; v.dispose();
    const g = mk({ maxParticles: 3000 }); g.spawn({ name: 'big', rate: 5000, life: 2 }); run(g, 0, 600);
    R.global = { particles: g.stats.particles, budget: +g.stats.budget.toFixed(3), max: 3000 }; g.dispose();
  }
  // 6. one-shots reuse their pools: 200 bursts make no texture, no geometry, no pool and no source record
  {
    const v = mk({}); v.prewarm(VFX_LIBRARY.sparks, { instances: 8 }); for (let i = 0; i < 8; i++) v.burst(VFX_LIBRARY.sparks, [i, 1, 0]); run(v, 0, 240);
    const m0 = { ...world.renderer.info.memory }, pools0 = v.pools().length, free0 = v.pools().reduce((n, p) => n + p.free.length + p.sources.length, 0);
    let step = 241; for (let k = 0; k < 200; k++) { v.burst(VFX_LIBRARY.sparks, [k % 5, 1, 0]); run(v, step, step + 29); step += 30; }
    run(v, step, step + 240);
    const m1 = world.renderer.info.memory;
    R.pooling = { textures: m1.textures - m0.textures, geometries: m1.geometries - m0.geometries, pools: v.pools().length - pools0, records: v.pools().reduce((n, p) => n + p.free.length + p.sources.length, 0) - free0, spawned: v.stats.spawned };
    v.dispose();
  }
  // 7. LOD by distance, cull distance, and pause when off screen
  {
    const eye = new THREE.Vector3().setFromMatrixPosition(world.camera.matrixWorld), fwd = new THREE.Vector3(); world.camera.getWorldDirection(fwd);
    const at = (d) => eye.clone().addScaledVector(fwd, d).toArray();
    const fx = (extra) => ({ name: 'l' + JSON.stringify(extra), rate: 600, life: 1, lod: { near: 10, far: 50, min: 0.25, cull: 80 }, ...extra });
    const v = mk({}); v.spawn(fx({}), { position: at(5) }); v.spawn(fx({ seed: 2 }), { position: at(50) }); v.spawn(fx({ seed: 3 }), { position: at(100) });
    v.spawn(fx({ seed: 4, pauseOffscreen: true, bounds: 1 }), { position: at(-30) }); v.spawn(fx({ seed: 5, bounds: 1 }), { position: at(-30) });
    run(v, 0, 120);
    const p = v.pools();
    R.lod = { near: p[0].spawned, far: p[1].spawned, culled: p[2].spawned, pausedSteps: p[3].steps, behindSteps: p[4].steps, pausedSpawned: p[3].spawned };
    v.dispose();
  }
  // 8. sub-emitters: children born where parents die, and where they hit the ground
  {
    const v = mk({}); v.setGround({ min: [-20, -20], size: [40, 40], res: [4, 4], heightAt: () => 0 });
    v.spawn({ name: 'sub', rate: 60, life: 0.5, velocity: { speed: 2 }, sub: [{ on: 'death', count: 6, emitter: { life: 1, velocity: { random: [1, 2] } } }] }, { position: [0, 2, 0] });
    v.spawn({ name: 'hit', rate: 60, life: 4, gravity: -9.8, collision: { ground: true, mode: 'kill' }, sub: [{ on: 'collision', count: 4, emitter: { life: 1, velocity: { random: [0.2, 0.5] } } }] }, { position: [4, 2, 0] });
    run(v, 0, 150);
    const [pa, ca, pb, cb] = v.pools(), cnt = (p) => p.countAlive(), ys = (() => { const { P, V } = cb.read(); let m = 0, n = 0; for (let i = 0; i < cb.cap; i++) if (V[4 * i + 3] > 0 && P[4 * i + 3] < V[4 * i + 3]) { m = Math.max(m, Math.abs(P[4 * i + 1])); n++; } return { n, maxAbsY: +m.toFixed(2) }; })();
    R.sub = { parents: cnt(pa), deathChildren: cnt(ca), hitParents: cnt(pb), hitChildren: ys.n, hitChildMaxY: ys.maxAbsY }; v.dispose();
  }
  // 9. the world's own system: the depth copy is live, and the whole library runs with no GL error
  {
    const v = window.__mirage.vfx; window.__mirage.start('all'); await new Promise((r) => setTimeout(r, 3500));
    for (let i = 0; i < 3; i++) window.__mirage.vfx.beam({ from: [0, 8, 0], to: [i, 0, 0], jitter: 0.5, branches: 2, life: 2 }), window.__mirage.vfx.decal({ position: [i, 0, 2], size: 1, pattern: 'scorch', life: 5 });
    // frames come when the machine lets them: wait for a count of them, not for a time
    for (let t = 0; t < 100 && (v.depth.copies | 0) <= 12; t++) await new Promise((r) => setTimeout(r, 200));
    R.world = { depthCopies: v.depth.copies | 0, depthFailed: !!v.depth.failed, particles: v.stats.particles, alive: v.countAlive(), pools: v.stats.pools, glError: world.renderer.getContext().getError(), gain: +(1.5 * Math.pow(world.exposure, -0.9)).toFixed(3) };
  }
  return { R };
};

const b = await launch({ w: 640, h: 400 });
async function load(fns) {
  const page = await b.newPage(), errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || /WebGL|GL_INVALID|shader/i.test(m.text())) errors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(html) + '?fx=none&ui=0&time=15:00&w=640&h=400&dpr=1&spp=1');
  await page.waitForFunction('window.__READY === true', { timeout: 120000, polling: 100 });
  const R = {};
  for (const f of fns) Object.assign(R, (await page.evaluate(f)).R);
  await page.close();
  return { R, errors };
}
const one = await load([IN_PAGE, IN_PAGE_2]), two = await load([IN_PAGE]);
await b.close();
const R = one.R, errors = [...one.errors, ...two.errors], fails = [];
const want = (ok, msg) => { if (!ok) fails.push(msg); };
const d = R.determinism;
want(d.alive > 50 && d.first === d.again, `determinism: two runs in one page differ (${d.first} / ${d.again})`);
want(d.first === d.by2, `determinism: 60 updates/s and 30 updates/s differ (${d.first} / ${d.by2})`);
want(d.first === two.R.determinism.first, `determinism: two page loads differ (${d.first} / ${two.R.determinism.first})`);
for (const [n, v] of Object.entries(R.library)) want(v.alive > 0, `library: ${n} has no live particle after 0.75 s`);
want(R.sort.outOfOrder === 0 && R.sort.wrongDepth === 0 && R.sort.live === R.sort.alive && R.sort.distinct === R.sort.texels, `sort: ${JSON.stringify(R.sort)}`);
const c = R.collide;
want(c.none.minY < 0.3, `collide: the control never fell below the ground (${c.none.minY})`);
want(c.kill.minY > 0.45 && c.kill.n > 0, `collide kill: ${JSON.stringify(c.kill)}`);
want(c.bounce.minY > 0.45 && c.bounce.n > c.kill.n, `collide bounce: ${JSON.stringify(c.bounce)}`);
want(c.stick.minY > 0.45 && c.stick.still > 50 && c.stick.still > 0.95 * c.stick.low, `collide stick: ${JSON.stringify(c.stick)}`);
want(c.plane.minY > 1.45, `collide plane: ${JSON.stringify(c.plane)}`);
want(R.capacity.alive <= R.capacity.cap && R.capacity.cap === 500 && R.capacity.dropped > 0, `capacity: ${JSON.stringify(R.capacity)}`);
want(R.global.budget < 0.5 && R.global.budget > 0.15 && R.global.particles < R.global.max * 1.15 && R.global.particles > R.global.max * 0.7, `global cap: ${JSON.stringify(R.global)}`);
const p = R.pooling;
want(p.textures === 0 && p.geometries === 0 && p.pools === 0 && p.records === 0 && p.spawned > 0, `pooling: ${JSON.stringify(p)}`);
const l = R.lod;
want(l.far < l.near * 0.35 && l.far > l.near * 0.15 && l.culled === 0 && l.pausedSteps === 0 && l.pausedSpawned === 0 && l.behindSteps > 100, `lod: ${JSON.stringify(l)}`);
want(R.sub.deathChildren > 50 && R.sub.hitChildren > 20 && R.sub.hitChildMaxY < 0.8, `sub-emitters: ${JSON.stringify(R.sub)}`);
want(R.world.depthCopies > 10 && !R.world.depthFailed && R.world.alive > 500 && R.world.glError === 0, `world: ${JSON.stringify(R.world)}`);
want(errors.length === 0, `console: ${errors.slice(0, 3).join(' | ')}`);
if (process.argv.includes('--json')) console.log(JSON.stringify(R, null, 1));
console.log(`vfx: state ${d.first} on two loads and at 30 updates/s (${d.alive} alive), library ${Object.keys(R.library).length} effects live, sort ${R.sort.live} particles in ${R.sort.passes} passes, ` +
  `collide kill/bounce/stick/plane ok, cap ${R.capacity.alive}/${R.capacity.cap}, global budget ${R.global.budget}, 200 bursts +${p.textures} textures, lod ${l.near}/${l.far}/${l.culled}, ` +
  `sub ${R.sub.deathChildren}+${R.sub.hitChildren}, errors ${errors.length} -> ${fails.length ? 'FAIL' : 'ok'}`);
for (const f of fails) console.log('  ' + f);
process.exit(fails.length ? 1 : 0);
