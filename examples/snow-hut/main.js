// snow-hut: a log hut on a snowy slope at blue hour; walk in out of the falling snow and light the stove.
// Three modules on one site plan (plan.js, modules/, NOTES.md); direction in BRIEF.md; the game in game.js.
// URL: ?view=<viewpoint name>  ?modules=a,b (build only these: a module owner's self-test; no game)
//      ?start=1 (skip the start screen)  ?spp=N  ?w=&h=  ?grain=0  ?ui=0 (play's help line; with ?modules only)
// Contract with the tools: window.__mirage = { world, built, play, g? } and window.__READY = true once playable.
import { createWorldRenderer } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { createPlay } from '@mirage/play';
import { startGame } from '@mirage/game';
import plan from './plan.js';
import modules from './modules/index.js';
import { setupGame, objective } from './game.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const { shadowRadius, ...render } = plan.render;
const world = createWorldRenderer({ canvas, width: W, height: H, preserveDrawingBuffer: true, ...render,
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012, ...render.post } });
const only = Q.get('modules') && Q.get('modules').split(',');
const shared = {};
const built = await buildWorld(world, { plan, modules: only ? modules.filter((m) => only.includes(m.name)) : modules, shared });
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
const spp = +Q.get('spp') || 6, mode = Q.get('mode') || 'walk';
let play, g = null;
if (only) {   // a module owner's self-test: the world alone, walk / fly / game / orbit
  await world.prepare();
  play = createPlay(world, { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', shadowRadius });
} else {
  const S = { log: 'wood', post: 'wood', snow: 'gravel' };   // footsteps by material (snow crunches like gravel)
  for (const [k, m] of Object.entries(shared.mats || {})) m.userData.surface = S[k] || 'stone';
  g = await startGame(world, {
    built, canvas, id: plan.name, version: 1, title: 'The Snow Hut', subtitle: 'Walk in out of the snow · light the stove',
    spp, shadowRadius, setup: (ctx) => setupGame(ctx, { built }), objective,
  });
  if (Q.has('start')) g.ui.begin();
  play = g.play;
}
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, only ? mode : 'walk');
window.__mirage = { world, built, play, g };
window.__READY = true;
