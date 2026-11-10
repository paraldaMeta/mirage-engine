// yard: the small world every eval task starts from (a walled yard with a gate, a crate, a railing and lamps).
// URL: ?mode=walk (default) | fly | game | orbit   ?view=<viewpoint name>   ?w=&h=  ?grain=0  ?ui=0
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
const world = createWorldRenderer({ canvas, width: W, height: H, preserveDrawingBuffer: true, quality: Q.get('quality') || 'medium', ...render,
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012, ...render.post } });
const built = await buildWorld(world, { plan, modules, shared: {} });
const { camera } = world;
camera.aspect = W / H; camera.fov = 55; camera.near = 0.1; camera.far = 500; camera.updateProjectionMatrix();
await world.prepare();
const mode = Q.get('mode') || 'walk';
const play = createPlay(world, { plan: built.plan, canvas, mode, spp: +Q.get('spp') || 4, ui: Q.get('ui') !== '0', shadowRadius });
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, mode);
window.__mirage = { world, built, play };
window.__READY = true;
