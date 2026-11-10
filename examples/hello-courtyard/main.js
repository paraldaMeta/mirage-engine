// hello-courtyard: a walled courtyard with an arched gate, a basin, a pergola, jars, lanterns and a palm, built
// entirely in code by four modules on one site plan (plan.js, modules/), dressed with five CC0 texture sets.
// URL: ?mode=orbit (default) | walk | fly | game   ?time=golden | HH:MM [&date=YYYY-MM-DD] [&lat=..&lon=..&tz=..]
//      ?clock=N (N minutes per second)  ?spp=N  ?w=&h=  ?grain=0  ?dof=1  ?view=hero | corner | <viewpoint name>
//      ?broken=1 (adds a module that throws)  ?ui=0  ?nodetail (no close-range relief, soft edges or soot: A/B)
//      ?light2=1 lamp shadows, reflections, volumetric light, mixed bloom (@mirage/core light2.js);
//      &l2=nols,nossr,novol,nobloom switches single parts off
//      ?aolit=1 AO on ambient light only  ?ae=1 auto exposure  ?dynres=1 | <fps> dynamic resolution (moving frames)
//      ?soft=1 contact-hardening soft sun shadows (@mirage/core softshadow.js); &sunAngle=deg (0.53 = the real sun)
//      ?wet=0..1 wet ground and masonry, puddles (@mirage/core wet.js)  &rain=0..1 ripples on the puddles and falling
//      streaks (@mirage/world/kits/rain); without ?wet / ?rain nothing of either is built
//      Enter VR / Enter AR appear in a WebXR browser: docs/xr.md
import { createWorldRenderer, createTextures, placeDate, pickQuality, setRelief, setWetness, setRain } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { addRain } from '@mirage/world/kits/rain';
import { createPlay, createXR, xrSupport } from '@mirage/play';
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
const quality = Q.get('quality') || (await pickQuality()).quality, hud = Q.get('hud') !== '0';   // ?quality=low|medium|high
const xrs = await xrSupport();   // a headset browser: an MSAA context for the headset, and the Enter VR / AR buttons
setRelief({ low: 0, medium: 0.7, high: 1 }[quality] ?? 1);   // the relief's reach: off on low, 5.6 m on medium, 8 m on high
// light2 (opt-in): ?light2=1, parts off with &l2=nols,nossr,novol,nobloom
const light2 = Q.get('light2') === '1' && Object.fromEntries((Q.get('l2') || '').split(',').filter(Boolean).map((k) => [k.replace(/^no/, ''), false]));
// soft sun shadows (opt-in): ?soft=1 [&sunAngle=deg]
const softShadows = Q.get('soft') === '1' && (Q.get('sunAngle') ? { sunAngle: +Q.get('sunAngle') } : true);
const world = createWorldRenderer({ quality, xr: xrs.vr || xrs.ar, light2, softShadows, dynamicRes: Q.get('dynres') ? (Q.get('dynres') === '1' || { target: +Q.get('dynres') }) : false,
  canvas, width: W, height: H, place, time: date || 'golden', preserveDrawingBuffer: true,
  shadow: { center: [0, 2, 0], radius: 17 }, envProbe: [0, 2.2, 0],
  fog: { groundDensity: 0.0022, height: 30 },
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012, dof: Q.get('dof') ? 0.025 : 0, focus: 9,
    ...(Q.get('aolit') === '1' ? { aoLit: 1 } : {}), ...(Q.get('ae') === '1' ? { autoExposure: 0.5 } : {}) },
});
const urls = import.meta.glob('./tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['./tex/' + f] });
// wetness (opt-in): ?wet=0.8 re-patches the ground and masonry materials, ?rain=1 adds the streaks
const wet = Q.has('wet') || Q.has('rain');
if (wet) { setWetness(+(Q.get('wet') ?? 0)); setRain(+(Q.get('rain') ?? 0)); }
const built = await buildWorld(world, { plan, modules: modules({ broken: Q.has('broken') }), shared: { tex, detail: !Q.has('nodetail'), ...(wet ? { wet: true } : {}) } });
const rain = Q.has('rain') ? addRain({ ...world.ctx, root: world.scene }) : null;

const { camera } = world;
camera.aspect = W / H; camera.fov = 48; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
await world.prepare();
const spp = +Q.get('spp') || 6;
const mode = Q.get('mode') || 'orbit';
const play = createPlay(world, { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', fit: !Q.get('w'), quality, hud });
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
const xr = createXR(play, { support: xrs });
window.__mirage = { world, tex, built, play, xr, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }), wet: { setWetness, setRain, rain } };
window.__READY = true;
