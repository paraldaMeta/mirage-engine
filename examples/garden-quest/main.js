// garden-quest: a small game in walled-garden. Find the key on a bench in the lower garden, unlock the pavilion
// on the upper terrace, take the taper inside and light the four lanterns. Physics (Rapier), keyboard / mouse,
// gamepad and touch, procedural sound, save / load (Esc or P: the menu).
// URL: ?w=&h=  ?spp=N  ?grain=0  ?load=<slot> (load a save slot on start)  ?start=1 (skip the start screen)
import { createWorldRenderer, createTextures, pickQuality } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { startGame } from '@mirage/game';
import manifest from '../hello-courtyard/tex/manifest.json';
import plan from './plan.js';
import modules from './modules/index.js';
import { setupQuest, objective, summary, VERSION } from './quest.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const place = { lat: 37.18, lon: -3.59, height: 700, tzHours: 1 };   // a generic mid-latitude site, not a real garden
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const quality = Q.get('quality') || (await pickQuality()).quality, hud = Q.get('hud') !== '0';   // ?quality=low|medium|high
const world = createWorldRenderer({ quality,
  canvas, width: W, height: H, place, time: { elevation: 2.2, azimuth: 252 }, preserveDrawingBuffer: true,   // late, low sun: lamps begin to glow
  shadow: { center: [0, 2, 0], radius: 42 }, envProbe: [0, 4, 6],
  fog: { groundDensity: 0.0018, height: 40 },
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012 },
});
const urls = import.meta.glob('../hello-courtyard/tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['../hello-courtyard/tex/' + f] });
const shared = { tex };
const built = await buildWorld(world, { plan, modules, shared });
// surfaces for footsteps, by material
const S = { lawn: 'grass', hedge: 'grass', gravel: 'gravel', land: 'gravel', planks: 'wood' };
for (const [k, m] of Object.entries(shared.mats)) m.userData.surface = S[k] || 'stone';
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
let quest;
const g = await startGame(world, {
  built, canvas, id: 'garden-quest', version: VERSION, title: 'Garden Quest', subtitle: 'Find the key · open the pavilion · light the lanterns',
  spp: +Q.get('spp') || 6, shadowRadius: 26, quality, hud,
  setup: (ctx) => { quest = setupQuest(ctx, shared.mats); },
  objective: (game) => objective(game, quest.lamps.length), summary,
});
if (Q.get('load')) g.load(+Q.get('load'));
if (Q.has('start')) g.ui.begin();
window.__mirage = { world, built, play: g.play, g, quest, tex, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp: 6, frameIndex: 1, ...o }) };
window.__READY = true;
