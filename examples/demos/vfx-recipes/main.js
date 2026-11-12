// Demo: the effect recipes of @miragekit/assets, played by core's particle system. Every recipe that stays near its
// spawn point stands on a pad in a grid, named; one-shots replay every few seconds; the weather recipes take turns
// over the whole yard (W cycles them). Everything is made in code. Walk it (WASD) or press 1-7 for the viewpoints.
// URL: ?view=combat | fire | water | magic | celebration | ambience | yard   ?weather=rainHeavy | blizzard | ... | none
//      ?time=dusk | golden | HH:MM   ?every=3 (seconds between one-shots)   ?w=&h=
import * as THREE from 'three';
import { createWorldRenderer, placeDate, createVfx } from '@miragekit/core';
import { buildWorld, definePlan } from '@miragekit/world';
import { createPlay } from '@miragekit/play';
import { VFX_RECIPES, VFX_CATEGORIES, vfxNames } from '../../../packages/assets/src/vfx/index.js';   // @miragekit/assets/vfx once the package exists

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight, EVERY = +Q.get('every') || 3;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const place = { lat: 51.5, lon: -0.1, height: 30, tzHours: 0 }, t = Q.get('time') || 'dusk';
const world = createWorldRenderer({ canvas, width: W, height: H, place, time: t === 'golden' ? 'golden' : placeDate('2026-06-21', t === 'dusk' ? '20:20' : t, 0), preserveDrawingBuffer: true,
  quality: Q.get('quality') || 'high', shadow: { center: [0, 1, 0], radius: 40 }, envProbe: [0, 2, 10], fog: { groundDensity: 0.002, height: 30 }, post: { grain: Q.get('grain') === '0' ? 0 : 0.01, bloom: 0.25 } });

// the grid: one row per category (weather apart), 4 m between pads
const local = VFX_CATEGORIES.filter((c) => c !== 'weather');
const pads = [];
local.forEach((cat, row) => vfxNames(cat).forEach((name, i) => pads.push({ name, cat, x: (i - 6) * 4, z: -row * 5 })));
const WEATHER = vfxNames('weather');
const plan = definePlan({
  name: 'vfx-recipes', seed: 'vfx', bounds: [-40, -40, 40, 20], walk: { yMin: -1, yMax: 6 },
  spawn: { eye: [0, 1.7, 8], look: [0, 1, 0], mode: 'walk' },
  viewpoints: [...local.map((c, row) => ({ name: c, eye: [-6, 2.6, -row * 5 + 7], look: [-2, 0.9, -row * 5] })), { name: 'yard', eye: [-18, 9, 16], look: [0, 0, -12] }],
});
const modules = [{
  name: 'yard',
  build(ctx) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), ctx.mat.std({ color: 0xffffff, roughness: 0.92 }, ctx.mat.PROC.stone('vec3(0.32, 0.31, 0.30)', { course: 1, block: 1 })));
    ground.receiveShadow = true; ground.name = 'ground'; ctx.root.add(ground);
    const b = new ctx.geom.MeshBatch(), padMat = ctx.mat.std({ color: 0x2a2c30, roughness: 0.6 });
    for (const p of pads) b.cylinder(padMat, 0.8, 0.85, 0.06, [p.x, 0.03, p.z], [0, 0, 0], 24);
    ctx.root.add(b.finish({ name: 'pads' }));
    // a name plate in front of each pad, drawn into a canvas
    for (const p of pads) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 48; const g = c.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, 256, 48); g.fillStyle = '#e8e4dc'; g.font = '600 24px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.name, 128, 25);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.26), new THREE.MeshBasicMaterial({ map: tex })); m.position.set(p.x, 0.25, p.z + 1.05); m.rotation.x = -0.6; m.userData.collide = false; ctx.root.add(m);
    }
  },
}];
const built = await buildWorld(world, { plan, modules });
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 2000; camera.updateProjectionMatrix();
await world.prepare();
const vfx = createVfx(world);
vfx.setGround({ min: [-60, -60], size: [120, 120], res: [32, 32], heightAt: () => 0 });   // flat: where collision.ground lands
const loops = [], shots = [];
for (const p of pads) {
  const r = VFX_RECIPES[p.name], at = { position: [p.x, 0.06, p.z] };
  if (p.name === 'tracer' || p.name === 'fireworkRocket') at.direction = [0.3, 1, 0];
  if (/impact|shieldHit|muzzle/.test(p.name)) { at.position[1] = 1; at.direction = [0, 0.3, 1]; }
  if (p.name === 'fireworkBurst') at.position[1] = 6;
  if (r.loop) loops.push(vfx.spawn(r.effect, at)); else shots.push({ r, at, next: Math.random() * EVERY });
}
let wi = Math.max(0, WEATHER.indexOf(Q.get('weather') || 'rainHeavy')), weather = Q.get('weather') === 'none' ? null : vfx.spawn(VFX_RECIPES[WEATHER[wi]].effect, { position: [0, 0, -12] });
addEventListener('keydown', (e) => { if (e.code !== 'KeyW' || !e.shiftKey) return; weather?.stop(); wi = (wi + 1) % WEATHER.length; weather = vfx.spawn(VFX_RECIPES[WEATHER[wi]].effect, { position: [0, 0, -12] }); });
const play = createPlay(world, { plan: built.plan, canvas, mode: 'walk', spp: 4, ui: Q.get('ui') !== '0', fit: !Q.get('w'),
  onStep: (dt) => { for (const s of shots) { s.next -= dt; if (s.next <= 0) { vfx.burst(s.r.effect, s.at.position, s.at); s.next = EVERY; } } } });
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, 'walk');
window.__mirage = { world, built, play, vfx, recipes: VFX_RECIPES, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp: 4, frameIndex: 1, ...o }) };
window.__READY = true;
