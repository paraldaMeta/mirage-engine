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
console.log('world check: ok');
