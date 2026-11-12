// Demo: the home and office props of @miragekit/assets. Five cut-away rooms in a row (living room, kitchen-diner,
// bedroom, bathroom, office), furnished by room() from the props and the building kit's walls, lit by a few lamps,
// and a shelf of every prop on its own. Everything is made in code. Walk it (WASD) or press 1-6 for the viewpoints.
// URL: ?view=living | kitchen | bedroom | bathroom | office | lineup   ?time=golden | HH:MM   ?seed=N   ?w=&h=
import * as THREE from 'three';
import { createWorldRenderer, placeDate } from '@miragekit/core';
import { buildWorld, definePlan } from '@miragekit/world';
import { createPlay } from '@miragekit/play';
import * as H from '@miragekit/assets/props-home';
import { buildingMaterials } from '@miragekit/assets/building';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, Hh = +Q.get('h') || innerHeight, seed = +Q.get('seed') || 2;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px';
const place = { lat: 51.5, lon: -0.1, height: 20, tzHours: 0 }, t = Q.get('time') || 'golden';
const world = createWorldRenderer({ canvas, width: W, height: Hh, place, time: t === 'golden' ? 'golden' : placeDate('2026-09-20', t, 0), preserveDrawingBuffer: true,
  quality: Q.get('quality') || 'high', shadow: { center: [0, 2, 0], radius: 30 }, envProbe: [0, 2, 8], fog: { groundDensity: 0.001, height: 20 }, post: { grain: Q.get('grain') === '0' ? 0 : 0.01 },
  lighting: { lights: { cluster: true } } });
const ROOMS = [['living', [5.2, 4.2]], ['kitchen', [4.6, 4.2]], ['bedroom', [4.2, 4.2]], ['bathroom', [3.0, 3.2]], ['office', [5.6, 4.6]]];
let x = -12;
const centres = ROOMS.map(([, [w]]) => { const c = x + w / 2; x += w + 0.6; return c; });
const plan = definePlan({
  name: 'home-props', seed: 'home', bounds: [-20, -12, 20, 12], walk: { yMin: -1, yMax: 4 },
  spawn: { eye: [centres[0], 1.62, 5], look: [centres[0], 1.0, 0], mode: 'walk' },
  viewpoints: [...ROOMS.map(([k, [w, d]], i) => ({ name: k, eye: [centres[i] + w * 0.22, 1.75, d / 2 + 1.6], look: [centres[i] - w * 0.08, 0.8, -d * 0.12] })), { name: 'lineup', eye: [-11, 1.6, 10.8], look: [-9.5, 0.6, 7] }],
});
const modules = [{
  name: 'rooms',
  build(ctx) {
    const { geom } = ctx, MH = H.homeMaterials(ctx), MB = buildingMaterials(ctx, 'stucco'), b = new geom.MeshBatch();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2).translate(0, -0.23, 0), ctx.mat.std({ color: 0x4a4740, roughness: 0.95 }));
    ground.receiveShadow = true; ground.name = 'ground'; ctx.root.add(ground);
    ROOMS.forEach(([kind, size], i) => {
      H.room(b, MH, MB, geom.compose([centres[i], 0, 0]), { kind, size, seed: seed + i });
      const l = new THREE.PointLight(0xffd9a8, 6, 6, 2); l.position.set(centres[i], 2.4, 0.2); ctx.root.add(l);   // a ceiling light in each room
      world.lighting?.addLight?.(l);
    });
    // the line-up: every prop on its own, in a row on a low plinth
    const names = Object.keys(H).filter((k) => typeof H[k] === 'function' && !['homeMaterials', 'room'].includes(k) && !['curtain', 'wallClock', 'picture', 'whiteboard', 'towelRail', 'rug'].includes(k));
    let px = -16;
    for (const n of names) {
      const bb = new geom.MeshBatch(); H[n](bb, MH, null, n === 'meetingTable' ? { chairs: false } : {});
      const g = bb.finish({ name: 'probe' }), box = new THREE.Box3().setFromObject(g), w = Math.max(0.3, box.max.x - box.min.x);
      H[n](b, MH, geom.compose([px + w / 2 - (box.min.x + box.max.x) / 2, 0, 7]), n === 'meetingTable' ? { chairs: false } : {});
      px += w + 0.25; g.traverse((o) => o.geometry?.dispose());
    }
    ctx.root.add(b.finish({ name: 'home', castShadow: true }));
  },
}];
const built = await buildWorld(world, { plan, modules });
const { camera } = world;
camera.aspect = W / Hh; camera.fov = 60; camera.near = 0.05; camera.far = 2000; camera.updateProjectionMatrix();
await world.prepare();
const play = createPlay(world, { plan: built.plan, canvas, mode: 'walk', spp: 6, ui: Q.get('ui') !== '0', fit: !Q.get('w') });
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, 'walk');
window.__mirage = { world, built, play, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp: 6, frameIndex: 1, ...o }) };
window.__READY = true;
