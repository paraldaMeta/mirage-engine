// Node checks of the world protocol: plan validation, shapes, the loader's order, anchors, failure isolation, rng.
import * as THREE from 'three';
import { definePlan, contains, along, pathLength, buildWorld } from './src/index.js';
import { rng } from '@mirage/core';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
const plan = definePlan({ name: 't', bounds: [-10, -10, 10, 10], regions: { a: { rect: [0, 0, 2, 2] }, c: { circle: [0, 0, 1] }, p: { poly: [[0, 0], [4, 0], [0, 4]] } }, paths: { m: { points: [[0, 0], [3, 4], [3, 10]] } } });
ok(contains(plan.regions.a, 1, 1) && !contains(plan.regions.a, 3, 1), 'rect');
ok(contains(plan.regions.c, 0.5, 0.5) && !contains(plan.regions.c, 1, 1), 'circle');
ok(contains(plan.regions.p, 1, 1) && !contains(plan.regions.p, 3, 3), 'poly');
ok(pathLength(plan.paths.m) === 11 && Math.abs(along(plan.paths.m, 5).z - 4) < 1e-9, 'path');
let threw = false; try { definePlan({ name: 'x', bounds: [1, 1, 0, 0], regions: { r: {} } }); } catch (e) { threw = /bounds/.test(e.message) && /regions\.r/.test(e.message); } ok(threw, 'plan errors listed');
const custom = { variant: 3 };
const partial = definePlan({ name: 'partial', bounds: [0, 0, 1, 1], walk: { yMax: 5 }, custom });
ok(partial.seed === 'partial' && partial.walk.yMin === -1 && partial.custom === custom, 'defaults and custom fields');
for (const invalid of [null, [], 'text']) {
  let message = ''; try { definePlan(invalid); } catch (error) { message = error.message; }
  ok(message.includes('<plan>'), 'invalid root gets a field diagnostic');
}

const scene = new THREE.Scene(), updates = [];
const world = { scene, ctx: { THREE, onUpdate: (f) => updates.push(f) }, setAmbientVolumes: (v) => { world.vols = v; } };
const order = [];
const quiet = { log() {}, error() {} };
const modules = [
  { name: 'walls', build(ctx) { order.push('walls'); ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry())); return { r: ctx.R.float() }; }, anchors: (ctx, b) => ({ lamps: [{ pos: [1, 2, 3], rotY: 0 }] }) },
  { name: 'broken', build(ctx) { ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry())); ctx.onUpdate(() => {}); throw new Error('deliberate'); }, anchors: { lamps: [{ pos: [9, 9, 9] }] } },
  { name: 'props', build(ctx) { order.push('props'); }, finalize(ctx) { order.push('props:finalize'); for (const a of ctx.anchors.lamps) ctx.root.add(new THREE.PointLight()); } },
  { name: 'room', build() { return {}; }, ambientVolumes: [{ min: [0, 0, 0], max: [1, 1, 1] }] },
];
const out = await buildWorld(world, { plan, modules, log: quiet });
ok(order.join() === 'walls,props,props:finalize', 'order: ' + order.join());
ok(out.report.failed.length === 1 && out.report.failed[0].name === 'broken', 'failure recorded');
ok(!scene.children.some((c) => c.name === 'broken') && updates.length === 0, 'failed module dropped with its updates');
ok(out.anchors.lamps.length === 1 && out.anchors.lamps[0].from === 'walls', 'anchors merged (not from the failed module)');
ok(scene.getObjectByName('props:finalize').children.length === 1, 'finalize consumed anchors');
ok(world.vols.length === 1 && world.vols[0].from === 'room', 'ambient volumes');
ok(out.modules.walls.r === rng('t/walls').float(), 'per-module rng');

// A consumer may precede its producers. Failed or empty offers cannot satisfy it.
{
  const ctxWorld = { scene: new THREE.Scene(), ctx: { onUpdate() {} } };
  const ran = [], build = () => {};
  const consumer = (name, consumes) => ({ name, consumes, build, finalize() { ran.push(name); } });
  const modules = [
    consumer('lighting', { required: ['lamps'], optional: ['seats'] }),
    consumer('locked', { required: ['doors', 'ghost', 'toString'] }),
    consumer('plain', undefined),
    consumer('bad', { required: ['same'], optional: ['same'] }),
    { name: 'gate', build, anchors: { lamps: [{ pos: [1, 0, 2] }], doors: [] } },
    { name: 'wall', build, anchors: { lamps: [{ pos: [3, 0, 2] }] } },
    { name: 'partial', build, anchors: { ghost: [{}], invalid: 42 } },
  ];
  const { report, anchors, modules: outputs } = await buildWorld(ctxWorld, { plan, modules, log: quiet });
  const row = report.modules.find(m => m.name === 'lighting');
  ok(row.ok && row.consumes[0].count === 2 && row.consumes[1].count === 0, 'counts across later producers and absent optional key');
  ok(ran.join() === 'lighting,plain', 'unaffected finalizers still run in order');
  const failure = report.failed.find(f => f.name === 'locked');
  ok(failure?.phase === 'consumes' && failure.error.includes('doors, ghost, toString'), 'all empty or missing requirements reported');
  ok(Object.hasOwn(outputs, 'locked') && !ctxWorld.scene.getObjectByName('locked:finalize'), 'successful build kept when consumption fails');
  ok(!Object.hasOwn(anchors, 'ghost') && !Object.hasOwn(outputs, 'partial'), 'no partial offers escape a failed build');
  ok(report.failed.some(f => f.name === 'bad' && f.phase === 'build') && !Object.hasOwn(outputs, 'bad'), 'invalid declarations are isolated');
}
// isolation edge cases: a module failing half-way through its anchors offers none; a finalize that throws takes
// the module's build out of the scene and stops its callbacks; a second module with the same name is skipped
{
  const scene2 = new THREE.Scene(), calls = [];
  const w2 = { scene: scene2, ctx: { THREE, onUpdate: (f) => calls.push(f) } };
  let ticks = 0;
  const out2 = await buildWorld(w2, { plan, log: quiet, modules: [
    { name: 'half', build() {}, anchors: { lamps: [{ pos: [1, 1, 1] }], seats: 'not a list' } },
    { name: 'late', build(ctx) { ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry())); ctx.onUpdate(() => ticks++); }, finalize() { throw new Error('late fails'); } },
    { name: 'twin', build(ctx) { ctx.root.add(new THREE.Object3D()); } },
    { name: 'twin', build() {} },
    { name: 'reader', build() {}, finalize(ctx) { ctx.root.userData.lamps = (ctx.anchors.lamps || []).length; } },
  ] });
  for (const f of calls) f(0);
  const failed = out2.report.failed.map((f) => `${f.name}:${f.phase}`).sort().join();
  ok(failed === 'half:build,late:finalize,twin:build', 'failures: ' + failed);
  ok(!out2.anchors.lamps && scene2.getObjectByName('reader:finalize').userData.lamps === 0, 'a module that fails in its anchors offers none');
  ok(!scene2.getObjectByName('late') && ticks === 0 && !('late' in out2.modules), 'a failed finalize drops the module and stops its callbacks');
  ok(scene2.children.filter((c) => c.name === 'twin').length === 1, 'a second module with the same name is skipped');
}
// review 2026-11-09: one broken module must not take the build down with it, and the report counts what is drawn
{
  const scene3 = new THREE.Scene(), w3 = { scene: scene3, ctx: { THREE, onUpdate() {} }, setAmbientVolumes(v) { w3.vols = v; } };
  let error = null, out3 = null, disposed = 0;
  const geo = new THREE.BoxGeometry(); geo.addEventListener('dispose', () => disposed++);
  try {
    out3 = await buildWorld(w3, { plan, log: quiet, modules: [
      null,
      { name: 'empty', build(ctx) { ctx.root.add(new THREE.Mesh(new THREE.BufferGeometry())); } },
      { name: 'badvol', build() {}, ambientVolumes: [{ factor: 0.2 }] },
      { name: 'hut', build(ctx) { ctx.root.add(new THREE.Mesh(geo)); }, ambientVolumes: [{ min: [0, 0, 0], max: [1, 1, 1] }], finalize() { throw new Error('hut fails'); } },
      { name: 'box', build(ctx) { ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry())); ctx.collider(new THREE.Mesh(new THREE.BoxGeometry())); } },
      { name: 'box', build(ctx) { ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry())); } },
      { name: 'forks', build(ctx) { return { same: ctx.rng(0) === ctx.R, main: ctx.rng() === ctx.R }; } },
    ] });
  } catch (e) { error = e; }
  ok(!error, 'build survives a null module, an empty mesh and a malformed volume (' + (error && error.message) + ')');
  const failed = out3.report.failed.map((f) => `${f.name}:${f.phase}`).sort().join();
  ok(failed === 'badvol:build,box:build,hut:finalize,null:build', 'failures: ' + failed);
  ok(!(w3.vols || []).some((v) => v.from === 'hut'), "a dropped module's ambient volumes are not applied");
  ok(disposed === 1, "a dropped module's geometry is released");
  const rows = Object.fromEntries(out3.report.modules.map((r) => [r.name + (r.ok ? '' : '!'), r.tris]));
  ok(rows.box === 12 && rows['box!'] === 0 && rows.empty === 0, 'triangles: own roots only, colliders not drawn ' + JSON.stringify(rows));
  ok(!out3.modules.forks.same && out3.modules.forks.main, 'rng(0) is its own stream, rng() the module stream');
}
{
  const p = definePlan({ ...plan, seed: undefined, walk: { yMin: undefined, yMax: 5 } });
  ok(p.seed === plan.name && p.walk.yMin === -1 && p.walk.yMax === 5, 'optional fields set to undefined take the defaults');
  const a = along({ points: [[0, 0], [0, 0], [10, 0]] }, 0), b = along({ points: [[0, 0], [10, 0], [10, 0]] }, 20);
  ok(a.dx === 1 && a.dz === 0 && b.dx === 1 && b.x === 10, 'along() keeps a unit direction on repeated points');
}

// ---------------------------------------------------------------------------------------------------------------
// rain kit (kits/rain.js): one instanced draw, seeded, density on core's setRain, hidden from environment captures
// ---------------------------------------------------------------------------------------------------------------
{
  const { addRain } = await import('./src/kits/rain.js');
  const { createMaterials, createEnv, WET, setRain } = await import('@mirage/core');
  const rctx = () => ({ root: new THREE.Group(), mat: createMaterials(createEnv({}).G) });
  const before = WET.uRain.value;
  const r1 = addRain(rctx(), { count: 500 }), r2 = addRain(rctx(), { count: 500 });
  ok(WET.uRain.value === before, 'addRain without intensity leaves the rain level alone');
  ok(r1.geometry.instanceCount === 500 && r1.geometry.isInstancedBufferGeometry && r1.geometry.index.count === 6, 'one quad, 500 instances');
  ok(r1.geometry.attributes.aRain.array.every((v, i) => v === r2.geometry.attributes.aRain.array[i]), 'the same seed gives the same streaks');
  ok(!r1.frustumCulled && !r1.castShadow && r1.userData.collide === false && r1.material.transparent && !r1.material.depthWrite, 'not culled, no shadow, no collision, no depth');
  ok(r1.material.userData.hooks.uniforms.uRain === WET.uRain, 'density follows setRain');
  addRain(rctx(), { count: 1, intensity: 0.6 });
  ok(WET.uRain.value === 0.6, 'intensity sets the rain level');
  setRain(before);
  const u = r1.material.userData.hooks.uniforms, rd = { getRenderTarget: () => ({ height: 900 }) };
  ok(r1.userData.mgNoCapture === true, 'hidden from the environment capture (world.captureEnv skips mgNoCapture)');
  // the scene clock wraps to 64 s on the CPU: float32 stays exact after hours
  const rG = createEnv({}).G, r3 = addRain({ root: new THREE.Group(), mat: createMaterials(rG), G: rG }, { count: 1 });
  rG.uTime.value = 36000 + 5.25; r3.onBeforeRender(rd, null, new THREE.PerspectiveCamera(48, 1.6, 0.1, 100));
  ok(Math.abs(r3.material.userData.hooks.uniforms.uRainT.value - 37.25) < 1e-9, 'rain time wrapped to the 64 s period');
  const cam = new THREE.PerspectiveCamera(48, 1.6, 0.1, 100); cam.position.set(1, 2, 3); cam.updateMatrixWorld();
  r1.onBeforeRender(rd, null, cam);
  ok(u.uRainMinA.value === 0 && u.uRainView.value.x === 1 && Math.abs(u.uRainView.value.w - 2 / (cam.projectionMatrix.elements[5] * 900)) < 1e-12, 'follows the camera; pixel size per metre');
  let threw = 0;
  for (const o of [{ count: 0 }, { box: [1, 2] }, { speed: NaN }]) try { addRain(rctx(), o); } catch (e) { threw += e instanceof RangeError; }
  ok(threw === 3, 'bad rain options throw RangeError');
}
// rain under reduced motion (world.setReducedMotion writes ctx.motion): slower streaks; without it, the speed as given
{
  const { addRain } = await import('./src/kits/rain.js'), { createMaterials, createEnv } = await import('@mirage/core');
  const rG = createEnv({}).G, motion = { rain: 1 }, rd = { getRenderTarget: () => ({ height: 900 }) }, cam = new THREE.PerspectiveCamera(48, 1.6, 0.1, 100);
  const r = addRain({ root: new THREE.Group(), mat: createMaterials(rG), G: rG, motion }, { count: 4, speed: 8.5 });
  const sp = () => { r.onBeforeRender(rd, null, cam); return r.material.userData.hooks.uniforms.uRainShape.value.x; };
  ok(sp() === 8.5, 'rain speed as given at full motion');
  motion.rain = 0.4;
  ok(Math.abs(sp() - 3.4) < 1e-12, 'reduced motion slows the rain');
}
// fur kit: one mesh (instanced shells), options checked, seeded, fins on request
{
  const { addFur } = await import('./src/kits/fur.js'), { createMaterials, createEnv } = await import('@mirage/core');
  const fctx = (seed = 'f') => ({ root: new THREE.Group(), mat: createMaterials(createEnv({}).G), rng: (n) => rng(seed + '/' + n) });
  const c = fctx(), f = addFur(c, { rect: [0, 0, 4, 2], shells: 12, segments: [4, 2], heightAt: (x) => x * 0.1 });
  ok(c.root.children.length === 1 && f.fins === null && f.shells.geometry.isInstancedBufferGeometry && f.shells.geometry.instanceCount === 12, 'fur: one mesh, the shells as instances');
  ok(f.shells.userData.collide === false && !f.shells.castShadow && f.shells.receiveShadow, 'fur: no collision, receives shadows, casts none by default');
  ok(f.shells.geometry.index.count === 4 * 2 * 6, 'fur: the patch grid (segments) drawn once per shell');
  const p = f.shells.geometry.attributes.position;
  ok(Math.abs(p.getY(p.count - 1) - p.getX(p.count - 1) * 0.1) < 1e-6, 'fur: rect follows heightAt');
  const U = f.shells.material.userData.hooks.uniforms;
  ok(U.uFur.value.x === 12 && U.uFur.value.z === 1 && Math.abs(U.uFurBlade.value.x - 30) < 1e-9, 'fur: shells, no base layer, strands per metre');
  const seedOf = (s) => addFur(fctx(s), { rect: [0, 0, 4, 2] }).shells.material.userData.hooks.uniforms.uFurBlade.value.z;
  ok(seedOf('f') === seedOf('f') && seedOf('f') !== seedOf('g'), 'fur: strand layout seeded');
  const shadowed = addFur(fctx(), { rect: [0, 0, 1, 1], shadows: true, fins: 0.25 });
  ok(shadowed.shells.castShadow && shadowed.shells.customDepthMaterial.isMeshDepthMaterial && !!shadowed.fins.geometry.attributes.aFin, 'fur: shadows use a depth material with the same lift; fins');
  const rock = new THREE.IcosahedronGeometry(1, 1), moss = addFur(fctx(), { geometry: rock, hooks: { lighting: 'reflectedLight.indirectDiffuse *= 1.0;', uniforms: { uX: { value: 1 } } } });
  ok(moss.shells.geometry.attributes.position === rock.attributes.position, 'fur on a mesh shares its attributes');
  const H = moss.shells.material.userData.hooks;
  ok(H.lighting.includes('indirectDiffuse') && !!H.uniforms.uX && !!H.uniforms.uFur && H.albedo.includes('mgFurClip'), "fur: the caller's hooks after its own");
  let bad = 0;
  for (const o of [{}, { rect: [0, 0, 1, 1], geometry: rock }, { rect: [1, 0, 0, 1] }, { rect: [0, 0, 1, 1], shells: 1 }, { rect: [0, 0, 1, 1], length: 0 }, { geometry: new THREE.BufferGeometry() }]) try { addFur(fctx(), o); } catch (e) { bad += e instanceof RangeError; }
  ok(bad === 6, 'fur: bad options throw RangeError');
}

// opt-in time slicing: the same modules, the same report, plus yields between modules once the budget ran out
{
  const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };
  const mods = ['a', 'b', 'c', 'd'].map((name) => ({ name, build: (ctx) => { busy(3); ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry())); } }));
  const plain = await buildWorld({ scene: new THREE.Scene(), ctx: { THREE, onUpdate() {} } }, { plan: { name: 's', bounds: [0, 0, 1, 1] }, modules: mods, log: { log() {}, error() {} } });
  let yields = 0;
  const sliced = await buildWorld({ scene: new THREE.Scene(), ctx: { THREE, onUpdate() {} } }, { plan: { name: 's', bounds: [0, 0, 1, 1] }, modules: mods, log: { log() {}, error() {} },
    slice: { budgetMs: 5, yield: async () => { yields++; } } });
  ok(!plain.report.slices && sliced.report.slices, 'slices reported only when slicing');
  ok(JSON.stringify(plain.report.modules.map((r) => [r.name, r.ok, r.tris])) === JSON.stringify(sliced.report.modules.map((r) => [r.name, r.ok, r.tris])), 'the same build sliced');
  ok(yields === sliced.report.slices.yields && yields >= 1 && yields <= 4, 'yields once 5 ms of building ran: ' + yields);
  ok(sliced.report.slices.longestMs < 12 && sliced.report.slices.longModules.length === 0, 'no stretch much over the budget');
}
// streamer: in range -> built, compiled, uploaded, added; out of range -> removed and cached; back -> instant
{
  const { createStreamer, regionOf } = await import('./src/index.js');
  const scene = new THREE.Scene(), calls = [];
  const renderer = { initTexture() {}, compileAsync: async () => {}, getRenderTarget: () => null, setRenderTarget() {} };
  const w = { scene, renderer, camera: new THREE.PerspectiveCamera(), ctx: { THREE, onUpdate() {} } };
  const st = createStreamer(w, { plan: { name: 'st', bounds: [-50, -50, 50, 50] }, log: { log() {}, error() {} },
    modules: [{ name: 'hall', center: [20, 0], radius: 10, build: (ctx) => { ctx.root.add(new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4)).translateX(20)); } }],
    onChange: (n, inScene, region) => calls.push([n, inScene, region && region.map(Math.round)]) });
  const settle = async () => { for (let i = 0; i < 20; i++) { st.update(pos); await new Promise((r) => setTimeout(r, 5)); } };
  let pos = [0, 0, 0];
  await settle();
  ok(st.state().hall === 'out' && scene.children.length === 0, 'far: out');
  pos = [15, 0, 0]; await settle();
  ok(st.state().hall === 'in' && scene.getObjectByName('hall'), 'near: in the scene');
  ok(JSON.stringify(calls[0]) === JSON.stringify(['hall', true, [18, -2, 22, 2]]), 'onChange with its region: ' + JSON.stringify(calls[0]));
  pos = [21 - 10 * 1.2, 0, 0]; await settle();
  ok(st.state().hall === 'in', 'hysteresis: still in just past the radius');
  pos = [0, 0, 0]; await settle();
  ok(st.state().hall === 'cached' && !scene.getObjectByName('hall') && st.cache.has('hall'), 'far again: out of the scene, cached');
  pos = [15, 0, 0]; st.update(pos);
  ok(st.state().hall === 'in' && st.stats.builds.length === 1, 'back: shown at once from the cache, not rebuilt');
  ok(regionOf(new THREE.Group()) === null, 'an empty object has no region');
  st.dispose();
  ok(!scene.children.length && st.state().hall === 'out', 'dispose');
}
console.log('world check: ok');
