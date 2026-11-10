// Demo: seamless loading on hello-courtyard (or walled-garden): every opt-in of the streaming work, one URL switch
// each, so streaming-check.mjs can measure them A/B against the defaults.
// URL: ?world=courtyard | garden   ?decode=bitmap (off-thread image decode)   ?warm=1 (prepare's warm-up frame)
//      ?ktx2=1 (the KTX2 copies in ./tex-ktx2, made by the check with basisu; transcoder in ./basis)
//      ?bake=async (the walk grid baked over frames)   ?stream=1 | sync (the kiosk outside the gate, kiosk.js, streamed in
//      and out by distance, or loaded in the frame it comes in range; &salt=N makes its shaders new to the driver)
//      ?w=&h=  ?mode=walk
// Measures, into window.__mirage.timing: textures ready, build, prepare (warm), bake, the first frame (its CPU time
// and the time until the GPU is done with it, through a 1-px readback).
import { createWorldRenderer, createTextures, createUploadBudget } from '@mirage/core';
import { createKTX2Loader } from '@mirage/core/ktx2';   // a subpath: bundles that never import it never contain KTX2Loader
import { buildWorld } from '@mirage/world';
import { createStreamer } from '@mirage/world';
import { createPlay, bakeWalkGrid, bakeWalkGridAsync } from '@mirage/play';
import manifest from '../../hello-courtyard/tex/manifest.json';
import courtPlan from '../../hello-courtyard/plan.js';
import courtModules from '../../hello-courtyard/modules/index.js';
import gardenPlan from '../../walled-garden/plan.js';
import gardenModules from '../../walled-garden/modules/index.js';
import kiosk from './kiosk.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const garden = Q.get('world') === 'garden';
const plan = garden ? gardenPlan : courtPlan;
const timing = {}, T0 = performance.now(), mark = (k, t) => { timing[k] = +(performance.now() - t).toFixed(1); };
const world = createWorldRenderer({ quality: 'high', canvas, width: W, height: H, preserveDrawingBuffer: true, ...(garden
  ? { place: { lat: 37.18, lon: -3.59, height: 700, tzHours: 1 }, shadow: { center: [0, 2, 0], radius: 42 }, envProbe: [0, 4, 6], fog: { groundDensity: 0.0018, height: 40 } }
  : { place: { lat: 35.01, lon: 135.77, height: 50, tzHours: 9 }, shadow: { center: [0, 2, 0], radius: 17 }, envProbe: [0, 2.2, 0], fog: { groundDensity: 0.0022, height: 30 } }),
  post: { grain: 0 } });
const urls = import.meta.glob('../../hello-courtyard/tex/*.webp', { eager: true, query: '?url', import: 'default' });
let t = performance.now();
const ktx2 = Q.has('ktx2') ? await createKTX2Loader(world.renderer, { transcoderPath: './basis/' }) : null;
const texManifest = ktx2 ? { sets: Object.fromEntries(Object.entries(manifest.sets).map(([k, s]) => [k, { ...s, files: { c: s.files.c.replace('.webp', '.ktx2'), n: s.files.n.replace('.webp', '.ktx2') } }])) } : manifest;
const tex = createTextures(world, { manifest: texManifest, url: ktx2 ? (f) => './tex-ktx2/' + f : (f) => urls['../../hello-courtyard/tex/' + f],
  ...(Q.has('decode') ? { decode: Q.get('decode') } : {}), ...(ktx2 ? { ktx2 } : {}) });
const built = await buildWorld(world, { plan, modules: garden ? gardenModules({}) : courtModules({}), shared: { tex, detail: true } });
mark('buildMs', t);
const { camera } = world;
camera.aspect = W / H; camera.fov = garden ? 55 : 48; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
t = performance.now(); await tex.ready(); mark('texReadyMs', t);
t = performance.now();
const prep = await world.prepare(Q.has('warm') ? { warm: true } : undefined);
mark('prepareMs', t); if (prep) timing.warmMs = prep.warmMs;
t = performance.now();
const grid = Q.get('bake') === 'async' ? await bakeWalkGridAsync(world, { bounds: plan.bounds, ...plan.walk }) : bakeWalkGrid(world, { bounds: plan.bounds, ...plan.walk });
mark('bakeMs', t); timing.bake = grid.stats;
// the first frame: its CPU time, and until the GPU finished it (1-px readback)
const gl = world.renderer.getContext(), rf = world.renderFrame;
world.renderFrame = (...a) => {
  world.renderFrame = rf;
  const t1 = performance.now();
  rf(...a);
  timing.firstFrameCpuMs = +(performance.now() - t1).toFixed(1);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  timing.firstFrameMs = +(performance.now() - t1).toFixed(1);
};
const play = createPlay(world, { plan: built.plan, canvas, grid, mode: Q.get('mode') || 'walk', spp: 6, ui: false, fit: !Q.get('w'), quality: 'high', hud: false });
// streaming: the kiosk comes in near the gate; the walk grid is re-baked where it came in or went
let streamer = null;
if (Q.has('stream') && !garden) {
  const sync = Q.get('stream') === 'sync';
  streamer = createStreamer(world, { plan, modules: [kiosk], shared: { tex, salt: +Q.get('salt') || 0 }, sync,
    onChange: (name, inScene, region) => { if (region) sync ? bakeWalkGrid(world, { into: grid, region }) : bakeWalkGridAsync(world, { into: grid, region }); } });
}
timing.readyMs = +(performance.now() - T0).toFixed(1);
// for the check: the bakes and the loader, to compare and time them in the page
const lib = { bakeWalkGrid, bakeWalkGridAsync, buildWorld, createUploadBudget, modules: garden ? gardenModules : courtModules };
window.__mirage = { world, tex, built, play, grid, streamer, timing, plan, lib };
window.__READY = true;
// per frame: the streamer (queues, shows, hides, uploads)
if (streamer) (function tick() { streamer.update(world.camera.position); requestAnimationFrame(tick); })();
