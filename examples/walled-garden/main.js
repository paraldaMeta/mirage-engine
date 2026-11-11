// walled-garden: three terraces inside a plastered wall, stairs on the axis, a gate, a pavilion with a lit
// interior, lawns, hedges, pools and trees; six modules on one site plan (plan.js, modules/, NOTES.md).
// Textures: the courtyard's five CC0 sets (../hello-courtyard/tex).
// URL: ?mode=walk (default) | fly | game | orbit   ?view=<viewpoint name>   ?time=golden | HH:MM [&date=YYYY-MM-DD]
//      ?spp=N  ?w=&h=  ?grain=0  ?broken=1  ?ui=0  ?npc=N (N travellers wander the terraces: npc.js)
//      ?lawn=fur | fur-fins | tufts (turf on one lawn panel)
//      XR (all opt-in, xr-demo.js): ?xrpost=1 ?xrbudget=1 ?xrprofile=auto ?xrposture=seated ?xrbounds=1 ?xrsmooth=1 ?xrdemo=1 ?xrar=1
import { createWorldRenderer, createTextures, placeDate, pickQuality, postFromQuery } from '@miragekit/core';
import { buildWorld } from '@miragekit/world';
import { createPlay, createXR, xrSupport } from '@miragekit/play';
import manifest from '../hello-courtyard/tex/manifest.json';
import plan from './plan.js';
import modules from './modules/index.js';
import { npcDemo } from './npc.js';   // ?npc=N only (static: a dynamic import would split the bundle in two)
import { addLamps } from './lamps.js';
import { xrDemo } from './xr-demo.js';   // ?xrpost ?xrbudget ?xrprofile ?xrposture ?xrbounds ?xrdemo ?xrar (docs/xr.md)
import { editable } from '@miragekit/editor/runtime';
import edits from './plan.edits.json';   // written by `npx mirage-editor examples/walled-garden --write` (docs/editor.md); {} = no edits

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const place = { lat: 37.18, lon: -3.59, height: 700, tzHours: 1 };   // a generic mid-latitude site, not a real garden
const t = Q.get('time') || 'golden';
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const quality = Q.get('quality') || (await pickQuality()).quality, hud = Q.get('hud') !== '0';   // ?quality=low|medium|high
const xrs = await xrSupport();   // a headset browser: an MSAA context for the headset, and the Enter VR / AR buttons
// realtime lighting (opt-in, docs/lighting.md): ?csm=1 cascaded sun shadows, ?gi=1 irradiance probe volume,
// ?probes=1 a box reflection probe,
// ?lights=N clustered lamps (&cluster=0 plain loop, &lshadows=K shadowed, &stock=1 three's own lights instead)
const LF = (k) => Q.get(k) === '1';
const NL = +Q.get('lights') || 0, stock = LF('stock');
const SCR = ['ssr', 'ssgi', 'contact'].some((k) => +Q.get(k) > 0);   // ?ssr=1&ssgi=1&contact=1: screen-space lighting (docs/lighting.md)
const lighting = ['csm', 'gi', 'probes'].some(LF) || (NL && !stock) || SCR ? {
  screen: SCR,
  csm: LF('csm') && { cascades: +Q.get('cascades') || 4, stagger: LF('stagger') },   // &stagger=1: far cascades redrawn less often
  gi: LF('gi') && { min: [-4.08, 3.6, -29.08], max: [4.08, 7.4, -20.92], spacing: +Q.get('gispacing') || 1.4, fade: 0.4 },
  probes: LF('probes') && [{ min: [-4.08, 3.6, -29.08], max: [4.08, 7.4, -20.92], fade: 0.5 }],
  lights: NL > 0 && !stock && { cluster: Q.get('cluster') !== '0', perCell: +Q.get('percell') || 0 },   // exact lists (&percell=64: the capped ones)
} : undefined;
const ed = editable(plan, edits);   // with an empty layer: the plan itself, and every ed. call below does nothing
const world = createWorldRenderer({ quality, xr: xrs.vr || xrs.ar, lighting: ed.lighting(lighting), softShadows: Q.get('soft') === '1',
  canvas, width: W, height: H, place, time: t === 'golden' ? 'golden' : placeDate(Q.get('date') || '2026-10-25', t, place.tzHours), preserveDrawingBuffer: true,
  shadow: { center: [0, 2, 0], radius: 42 }, envProbe: [0, 4, 6],
  fog: { groundDensity: 0.0018, height: 40 },
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012, ...postFromQuery(Q) },   // ?taa2=1&upscale=0.67&mb=0.5... (docs/post.md)
});
const urls = import.meta.glob('../hello-courtyard/tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['../hello-courtyard/tex/' + f] });
const buildOpts = (p) => ({ plan: p, modules: modules({ broken: Q.has('broken'), lawn: Q.get('lawn') }), shared: { tex } });
const built = await buildWorld(world, buildOpts(ed.plan));
if (lighting?.gi) world.setAmbientVolumes([]);   // the probes light the pavilion: the module's dimming box would darken it twice
if (NL) addLamps(world, { n: NL, min: [-20, 0.8, -18], max: [20, 2.6, 22], first: [[0, 5.6, -25], [0, 1.6, 6], [-6, 1.4, 0], [6, 1.4, 0]], shadows: +Q.get('lshadows') || 0, stock });
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
if (Q.get('perf')) window.__big = (await import('@miragekit/core/bigworld')).applyBigWorld(world, world.scene, Q.get('perf'));   // ?perf=chunk,lod,occ (docs/big-worlds.md)
await ed.apply(world, built);
await world.prepare();
const spp = +Q.get('spp') || 6, mode = Q.get('mode') || 'walk';
let npc = null;   // ?npc=N: made below, stepped with the player
const playOpts = { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', shadowRadius: 26, fit: !Q.get('w'), quality, hud, onStep: (dt) => npc?.step(dt) };
const play = createPlay(world, playOpts);
const v = ed.plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, mode);
const xr = createXR(play, { support: xrs, ...xrDemo(Q, world, play, plan) });
if (Q.has('npc')) npc = npcDemo(world, play, plan, Q.get('npc') === '' ? 6 : +Q.get('npc'));
window.__mirage = { world, tex, built, play, xr, npc, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }) };
ed.attach({ world, built, play, rebuild: buildOpts, makePlay: (o) => createPlay(world, { ...playOpts, mode: 'walk', fit: true, ...o }) });
window.__READY = true;
