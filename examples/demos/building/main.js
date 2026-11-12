// Demo: the building kit of @miragekit/assets. A street of five houses, one per material style (stucco, stone,
// brick, timber, concrete) with gable, hip and flat roofs, and a row of the kit's parts on their own: walls with a
// door and arched windows, columns, an archway, stairs, a spiral stair, railings, a ramp, a ladder, fences, a gate,
// a balcony, an awning. Everything is made in code. Walk it (WASD) or press 1-5 for the viewpoints.
// URL: ?view=street | parts | house | stairs | aerial   ?time=golden | HH:MM   ?seed=N   ?w=&h=
import * as THREE from 'three';
import { createWorldRenderer, placeDate } from '@miragekit/core';
import { buildWorld, definePlan } from '@miragekit/world';
import { createPlay } from '@miragekit/play';
import * as B from '../../../packages/assets/src/building/index.js';   // @miragekit/assets/building once the package exists

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight, seed = +Q.get('seed') || 3;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const place = { lat: 43.7, lon: 7.3, height: 40, tzHours: 1 }, t = Q.get('time') || 'golden';
const world = createWorldRenderer({ canvas, width: W, height: H, place, time: t === 'golden' ? 'golden' : placeDate('2026-09-20', t, 1), preserveDrawingBuffer: true,
  quality: Q.get('quality') || 'high', shadow: { center: [0, 4, 0], radius: 40 }, envProbe: [0, 3, 14], fog: { groundDensity: 0.002, height: 40 }, post: { grain: Q.get('grain') === '0' ? 0 : 0.01 } });

const plan = definePlan({
  name: 'building-kit', seed: 'building', bounds: [-40, -30, 40, 30], walk: { yMin: -1, yMax: 12 },
  spawn: { eye: [0, 1.62, 16], look: [0, 3, 0], mode: 'walk' },
  viewpoints: [
    { name: 'street', eye: [-6, 1.7, 15], look: [4, 4, -2] }, { name: 'parts', eye: [-14, 3.2, 24], look: [-10, 1.6, 13] },
    { name: 'house', eye: [5, 3, 9], look: [0, 4, -3] }, { name: 'stairs', eye: [14, 2.2, 21], look: [11, 1.8, 13] },
    { name: 'aerial', eye: [-20, 22, 34], look: [0, 2, 0] },
  ],
});
const STYLES = ['stucco', 'stone', 'brick', 'timber', 'concrete'], ROOFS = ['gable', 'hip', 'gable', 'gable', 'flat'];
const modules = [{
  name: 'street',
  build(ctx) {
    const { geom } = ctx, std = (c, r = 0.9) => ctx.mat.std({ color: c, roughness: r });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), ctx.mat.std({ color: 0xffffff, roughness: 0.95 }, ctx.mat.PROC.stone('vec3(0.42, 0.40, 0.36)', { course: 0.5, block: 0.5 })));
    ground.receiveShadow = true; ground.name = 'ground'; ctx.root.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 6).rotateX(-Math.PI / 2).translate(0, 0.01, 8), std(0x2a2a2c, 0.8)); road.receiveShadow = true; road.userData.collide = false; ctx.root.add(road);
    // the houses, side by side behind the road
    let x = -30;
    STYLES.forEach((style, i) => {
      const M = B.buildingMaterials(ctx, style), b = new geom.MeshBatch(), bays = [[3, 2], [2, 2], [4, 3], [3, 2], [3, 3]][i];
      const info = B.house(b, M, geom.compose([x + bays[0] * 1.5, 0, -2]), { bays, storeys: i === 2 ? 3 : 2, roof: ROOFS[i], seed: seed + i });
      ctx.root.add(b.finish({ name: 'house-' + style, castShadow: true }));
      x += info.width + 3;
    });
    // the parts on their own, in a row in front of the road
    const M = B.buildingMaterials(ctx, 'stucco'), MS = B.buildingMaterials(ctx, 'stone'), b = new geom.MeshBatch(), P = (x, z = 13, r = 0) => geom.compose([x, 0, z], [0, r, 0]);
    B.wallOpenings(b, M, P(-24), { width: 6, height: 3.5, openings: [{ x: -1.6, width: 1.1, height: 2.4, arch: 'round', kind: 'door' }, { x: 1.2, width: 1, height: 1.5, sill: 1, arch: 'round', kind: 'window' }, { x: 2.4, width: 0.6, height: 1.2, sill: 1.3, kind: 'window' }] });
    B.shutters(b, M, P(-22.8, 13.12), { width: 1, height: 1.5 });
    for (let i = 0; i < 3; i++) B.column(b, MS, P(-18 + i * 1.6), { height: 3.4, style: i === 1 ? 'square' : 'round' });
    B.beam(b, M, P(-18), { a: [-0.3, 3.4, 0], b: [3.5, 3.4, 0] });
    B.archway(b, MS, P(-11), { width: 2.2, height: 3 });
    B.stairs(b, M, P(-6, 15), { width: 1.1, rise: 2, rails: [true, false] });
    B.floorSlab(b, M, P(-6, 15 - 2 / 0.175 * 0.28 - 1), { width: 1.6, depth: 2 });
    B.spiralStairs(b, M, P(-1.5, 14), { rise: 3 });
    B.railing(b, M, P(2, 14), { length: 2.4, style: 'bars' }); B.railing(b, M, P(2, 15), { length: 2.4, style: 'glass' }); B.railing(b, M, P(2, 16), { length: 2.4, style: 'cable' }); B.railing(b, M, P(2, 17), { length: 2.4, style: 'solid' });
    B.ramp(b, MS, P(8, 16), { width: 1.4, rise: 0.6, run: 4 });
    B.ladder(b, M, P(11, 13), { height: 4.5, cage: true });
    B.fence(b, M, P(13, 13), { length: 4 }); B.fence(b, M, P(13, 14.5), { length: 4, style: 'wire' }); B.fence(b, M, P(13, 16), { length: 4, style: 'panel' });
    B.gate(b, MS, P(21, 14), { width: 3, open: 0.4 });
    const wall = P(27, 13); B.wallPanel(b, M, wall, { width: 4, height: 4 }); B.balcony(b, M, geom.compose([27, 2.6, 13.125]), { width: 2.2 }); B.awning(b, M, geom.compose([27, 2.2, 13.125]), { width: 3 });
    B.wallPanel(b, M, P(27, 12.75), { width: 4, height: 4.2 }); B.chimney(b, MS, geom.compose([27, 4.2, 12.75]), { height: 1.2 });
    ctx.root.add(b.finish({ name: 'parts', castShadow: true }));
  },
}];
const built = await buildWorld(world, { plan, modules });
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 2000; camera.updateProjectionMatrix();
await world.prepare();
const play = createPlay(world, { plan: built.plan, canvas, mode: 'walk', spp: 6, ui: Q.get('ui') !== '0', fit: !Q.get('w') });
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, 'walk');
window.__mirage = { world, built, play, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp: 6, frameIndex: 1, ...o }) };
window.__READY = true;
