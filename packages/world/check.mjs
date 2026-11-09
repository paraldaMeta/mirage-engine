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
console.log('world check: ok');
