// walled-garden: three terraces inside a plastered wall, stairs on the axis, a gate, a pavilion with a lit
// interior, lawns, hedges, pools and trees; six modules on one site plan (plan.js, modules/, NOTES.md).
// Textures: the courtyard's five CC0 sets (../hello-courtyard/tex).
// URL: ?mode=walk (default) | fly | game | orbit   ?view=<viewpoint name>   ?time=golden | HH:MM [&date=YYYY-MM-DD]
//      ?spp=N  ?w=&h=  ?grain=0  ?broken=1  ?ui=0  ?npc=N (N travellers wander the terraces: npc.js)
//      ?lawn=fur | fur-fins | tufts (turf on one lawn panel)
import { createWorldRenderer, createTextures, placeDate, pickQuality, postFromQuery } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { createPlay, createXR, xrSupport } from '@mirage/play';
import manifest from '../hello-courtyard/tex/manifest.json';
import plan from './plan.js';
import modules from './modules/index.js';
import { npcDemo } from './npc.js';   // ?npc=N only (static: a dynamic import would split the bundle in two)

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const place = { lat: 37.18, lon: -3.59, height: 700, tzHours: 1 };   // a generic mid-latitude site, not a real garden
const t = Q.get('time') || 'golden';
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const quality = Q.get('quality') || (await pickQuality()).quality, hud = Q.get('hud') !== '0';   // ?quality=low|medium|high
const xrs = await xrSupport();   // a headset browser: an MSAA context for the headset, and the Enter VR / AR buttons
const world = createWorldRenderer({ quality, xr: xrs.vr || xrs.ar,
  canvas, width: W, height: H, place, time: t === 'golden' ? 'golden' : placeDate(Q.get('date') || '2026-10-25', t, place.tzHours), preserveDrawingBuffer: true,
  shadow: { center: [0, 2, 0], radius: 42 }, envProbe: [0, 4, 6],
  fog: { groundDensity: 0.0018, height: 40 },
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012, ...postFromQuery(Q) },   // ?taa2=1&upscale=0.67&mb=0.5... (docs/post.md)
});
const urls = import.meta.glob('../hello-courtyard/tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['../hello-courtyard/tex/' + f] });
const built = await buildWorld(world, { plan, modules: modules({ broken: Q.has('broken'), lawn: Q.get('lawn') }), shared: { tex } });
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
await world.prepare();
const spp = +Q.get('spp') || 6, mode = Q.get('mode') || 'walk';
let npc = null;   // ?npc=N: made below, stepped with the player
const play = createPlay(world, { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', shadowRadius: 26, fit: !Q.get('w'), quality, hud, onStep: (dt) => npc?.step(dt) });
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, mode);
const xr = createXR(play, { support: xrs });
if (Q.has('npc')) npc = npcDemo(world, play, plan, Q.get('npc') === '' ? 6 : +Q.get('npc'));
window.__mirage = { world, tex, built, play, xr, npc, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }) };
window.__READY = true;
