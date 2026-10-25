// walled-garden: three terraces inside a plastered wall, stairs on the axis, a gate, a pavilion with a lit
// interior, lawns, hedges, pools and trees; six modules on one site plan (plan.js, modules/, NOTES.md).
// Textures: the courtyard's five CC0 sets (../hello-courtyard/tex).
// URL: ?mode=walk (default) | fly | game | orbit   ?view=<viewpoint name>   ?time=golden | HH:MM [&date=YYYY-MM-DD]
//      ?spp=N  ?w=&h=  ?grain=0  ?broken=1  ?ui=0
import { createWorldRenderer, createTextures, placeDate } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { createPlay } from '@mirage/play';
import manifest from '../hello-courtyard/tex/manifest.json';
import plan from './plan.js';
import modules from './modules/index.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const place = { lat: 37.18, lon: -3.59, height: 700, tzHours: 1 };   // a generic mid-latitude site, not a real garden
const t = Q.get('time') || 'golden';
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const world = createWorldRenderer({
  canvas, width: W, height: H, place, time: t === 'golden' ? 'golden' : placeDate(Q.get('date') || '2026-10-25', t, place.tzHours), preserveDrawingBuffer: true,
  shadow: { center: [0, 2, 0], radius: 42 }, envProbe: [0, 4, 6],
  fog: { groundDensity: 0.0018, height: 40 },
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012 },
});
const urls = import.meta.glob('../hello-courtyard/tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['../hello-courtyard/tex/' + f] });
const built = await buildWorld(world, { plan, modules: modules({ broken: Q.has('broken') }), shared: { tex } });
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
await world.prepare();
const spp = +Q.get('spp') || 6, mode = Q.get('mode') || 'walk';
const play = createPlay(world, { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', shadowRadius: 26, fit: !Q.get('w') });
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, mode);
window.__mirage = { world, tex, built, play, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }) };
window.__READY = true;
