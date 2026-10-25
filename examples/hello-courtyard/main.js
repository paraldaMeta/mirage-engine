// hello-courtyard: a walled courtyard with an arched gate, a basin, a pergola, jars, lanterns and a palm, built
// entirely in code by four modules on one site plan (plan.js, modules/), dressed with five CC0 texture sets.
// URL: ?mode=orbit (default) | walk | fly | game   ?time=golden | HH:MM [&date=YYYY-MM-DD] [&lat=..&lon=..&tz=..]
//      ?clock=N (N minutes per second)  ?spp=N  ?w=&h=  ?grain=0  ?dof=1  ?view=hero | corner | <viewpoint name>
//      ?broken=1 (adds a module that throws)  ?ui=0
import { createWorldRenderer, createTextures, placeDate } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { createPlay } from '@mirage/play';
import manifest from './tex/manifest.json';
import plan from './plan.js';
import modules from './modules/index.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const place = { lat: +(Q.get('lat') ?? 35.01), lon: +(Q.get('lon') ?? 135.77), height: 50, tzHours: +(Q.get('tz') ?? 9) };
const t = Q.get('time') || 'golden', rate = +Q.get('clock') || 0;
let date = t === 'golden' ? null : placeDate(Q.get('date') || '2026-10-25', t, place.tzHours);

const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const world = createWorldRenderer({
  canvas, width: W, height: H, place, time: date || 'golden', preserveDrawingBuffer: true,
  shadow: { center: [0, 2, 0], radius: 17 }, envProbe: [0, 2.2, 0],
  fog: { groundDensity: 0.0022, height: 30 },
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012, dof: Q.get('dof') ? 0.025 : 0, focus: 9 },
});
const urls = import.meta.glob('./tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['./tex/' + f] });
const built = await buildWorld(world, { plan, modules: modules({ broken: Q.has('broken') }), shared: { tex } });

const { camera } = world;
camera.aspect = W / H; camera.fov = 48; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
await world.prepare();
const spp = +Q.get('spp') || 6;
const mode = Q.get('mode') || 'orbit';
const play = createPlay(world, { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0' });
if (mode === 'orbit' || Q.has('view')) {
  const v = plan.viewpoints.find((p) => p.name === (Q.get('view') || 'hero')) || plan.viewpoints[0];
  play.place(v.eye, v.look, mode);
}
// a running clock (?clock=N): the core eases exposure and cross-fades the environment
let last = performance.now();
if (rate && date) (function clock(now) {
  date = new Date(date.getTime() + Math.min((now - last) / 1000, 0.1) * rate * 60000); last = now;
  world.setTime(date, { ease: true });
  requestAnimationFrame(clock);
})(last);
window.__mirage = { world, tex, built, play, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }) };
window.__READY = true;
