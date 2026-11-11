// Demo: Gaussian splats in a Mirage world (@miragekit/world/kits/splat). A hill with a rock and a tree, made of splats
// generated in code (hill.js), stands on a meadow next to a few ordinary meshes, in the world's light and air.
// URL: ?n=300000 (splats)  ?src=<url> (.splat | .ply | SOG meta.json instead of the generated hill)
//      ?fx=reveal | dissolve (animated)  ?light=0 (colours as captured)  ?mode=orbit | walk | fly  ?time=golden | HH:MM
//      ?depth=1 (the depth pass for SSAO / TAA)  ?w=&h=  ?ui=0  ?spp=N
import * as THREE from 'three';
import { createWorldRenderer, placeDate } from '@miragekit/core';
import { buildWorld, definePlan } from '@miragekit/world';
import { addSplats, loadSplats, splatEffects } from '@miragekit/world/kits/splat';
import { createPlay } from '@miragekit/play';
import { makeHill } from './hill.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const place = { lat: 51.5, lon: -0.1, height: 30, tzHours: 0 };
const t = Q.get('time') || 'golden';
const world = createWorldRenderer({ canvas, width: W, height: H, place, time: t === 'golden' ? 'golden' : placeDate('2026-06-21', t, 0), preserveDrawingBuffer: true,
  quality: Q.get('quality') || 'high', shadow: { center: [0, 1, 0], radius: 14 }, envProbe: [0, 1.6, 6], fog: { groundDensity: 0.002, height: 30 }, post: { grain: Q.get('grain') === '0' ? 0 : 0.01 } });

const plan = definePlan({
  name: 'splats', seed: 'splats', bounds: [-20, -20, 20, 20], walk: { yMin: -1, yMax: 3 },
  spawn: { eye: [0, 1.62, 11], look: [0, 1.2, 0], mode: 'walk' },
  viewpoints: [{ name: 'hero', eye: [5.5, 2.6, 9.5], look: [0, 1.3, 0] }, { name: 'tree', eye: [-4.2, 2.3, 3.2], look: [-1.2, 2.4, -0.6] }, { name: 'low', eye: [3.2, 0.7, 6.2], look: [0.5, 1, 0] }],
});
const fxName = Q.get('fx'), data = Q.get('src') ? await loadSplats(Q.get('src')) : makeHill({ count: +Q.get('n') || 300000 });
let splats = null;
const modules = [{
  name: 'meadow',
  build(ctx) {
    // a meadow to stand on, and three plain meshes for scale (they cast shadows; the splats do not)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), ctx.mat.std({ color: 0x4a5a2c, roughness: 0.95 }));
    ground.receiveShadow = true; ground.name = 'ground';
    const post = (x, z, h, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), ctx.mat.std({ color: c, roughness: 0.7 })); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; return m; };
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 48, 24), ctx.mat.std({ color: 0xb8b0a0, roughness: 0.85 }));
    ball.position.set(3.4, 0.45, 2.6); ball.castShadow = ball.receiveShadow = true; ball.name = 'ball';
    ctx.root.add(ground, post(-3.6, 3, 1.4, 0x6b4a2e), post(4.6, -1.5, 2, 0x6b4a2e), ball);
  },
}, {
  name: 'hill',
  build(ctx) {
    const effect = fxName === 'reveal' ? splatEffects.reveal({ origin: [0, 0, 0] }) : fxName === 'dissolve' ? splatEffects.dissolve() : null;
    splats = addSplats(ctx, data, { effect, light: Q.get('light') !== '0', depth: Q.get('depth') === '1' ? 0.5 : false, name: 'hill-splats' });
  },
}];
const built = await buildWorld(world, { plan, modules, shared: {} });
const { camera } = world;
camera.aspect = W / H; camera.fov = 50; camera.near = 0.1; camera.far = 2000; camera.updateProjectionMatrix();
await world.prepare();
const spp = +Q.get('spp') || 6, mode = Q.get('mode') || 'orbit';
let fxT = 0;
const play = createPlay(world, {
  plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', fit: !Q.get('w'), hud: false,
  // a sort that lands for a still view, or the effect's progress, draws again
  onStep(dt) {
    if (fxName && splats) { fxT = (fxT + dt / 4) % 1.25; splats.progress = Math.min(1, fxT); }
    return splats ? splats.changed() : false;
  },
});
if (mode === 'orbit') { const v = plan.viewpoints[0]; play.place(v.eye, v.look, 'orbit'); }
window.__mirage = { world, built, play, splats, data, kit: { addSplats, loadSplats, splatEffects, makeHill }, THREE, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }) };
window.__READY = true;
