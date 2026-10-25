// <name>: <one line>. Modules on one site plan (plan.js, modules/, NOTES.md); direction in BRIEF.md.
// URL: ?mode=walk (default) | fly | game | orbit   ?view=<viewpoint name>   ?modules=a,b (build only these: a module
//      owner's self-test)   ?spp=N  ?w=&h=  ?grain=0  ?ui=0
// Contract with the tools: window.__mirage = { world, built, play } and window.__READY = true once playable.
import { createWorldRenderer } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { createPlay } from '@mirage/play';
import plan from './plan.js';
import modules from './modules/index.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const { shadowRadius, ...render } = plan.render;
const world = createWorldRenderer({ canvas, width: W, height: H, preserveDrawingBuffer: true, ...render,
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012, ...render.post } });
const only = Q.get('modules') && Q.get('modules').split(',');
const built = await buildWorld(world, { plan, modules: only ? modules.filter((m) => only.includes(m.name)) : modules, shared: {} });
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await world.prepare();
const mode = Q.get('mode') || 'walk';
const play = createPlay(world, { plan: built.plan, canvas, mode, spp: +Q.get('spp') || 6, ui: Q.get('ui') !== '0', shadowRadius });
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, mode);
window.__mirage = { world, built, play };
window.__READY = true;
