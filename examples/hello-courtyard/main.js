// hello-courtyard: a walled courtyard with an arched gate, a basin, a pergola, jars, lanterns and a palm, built
// entirely in code by four modules on one site plan (plan.js, modules/), dressed with five CC0 texture sets.
// URL: ?mode=orbit (default) | walk | fly | game   ?time=golden | HH:MM [&date=YYYY-MM-DD] [&lat=..&lon=..&tz=..]
//      ?clock=N (N minutes per second)  ?spp=N  ?w=&h=  ?grain=0  ?dof=1  ?view=hero | corner | <viewpoint name>
//      ?broken=1 (adds a module that throws)  ?ui=0  ?nodetail (no close-range relief, soft edges or soot: A/B)
//      ?light2=1 lamp shadows, reflections, volumetric light, mixed bloom (@miragekit/core light2.js);
//      &l2=nols,nossr,novol,nobloom switches single parts off
//      ?aolit=1 AO on ambient light only  ?ae=1 auto exposure  ?dynres=1 | <fps> dynamic resolution (moving frames)
//      ?soft=1 contact-hardening soft sun shadows (@miragekit/core softshadow.js); &sunAngle=deg (0.53 = the real sun)
//      ?wet=0..1 wet ground and masonry, puddles (@miragekit/core wet.js)  &rain=0..1 ripples on the puddles and falling
//      streaks (@miragekit/world/kits/rain); without ?wet / ?rain nothing of either is built
//      Enter VR / Enter AR appear in a WebXR browser: docs/xr.md
import { createWorldRenderer, createTextures, placeDate, pickQuality, setRelief, setWetness, setRain, postFromQuery } from '@miragekit/core';
import { buildWorld } from '@miragekit/world';
import { addRain } from '@miragekit/world/kits/rain';
import { createPlay, createXR, xrSupport } from '@miragekit/play';
import manifest from './tex/manifest.json';
import plan from './plan.js';
import modules from './modules/index.js';
import { addLamps } from '../walled-garden/lamps.js';
import { editable } from '@miragekit/editor/runtime';
import edits from './plan.edits.json';   // written by `npx mirage-editor examples/hello-courtyard --write` (docs/editor.md); {} = no edits

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const place = { lat: +(Q.get('lat') ?? 35.01), lon: +(Q.get('lon') ?? 135.77), height: 50, tzHours: +(Q.get('tz') ?? 9) };
const t = Q.get('time') || 'golden', rate = +Q.get('clock') || 0;
let date = t === 'golden' ? null : placeDate(Q.get('date') || '2026-10-25', t, place.tzHours);

const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const PF = Q.get('platform') === '1' ? await import('./platform.js') : null;   // ?platform=1: device probe, context-loss recovery, quality governor, page lifecycle (docs/platforms.md)
const caps = PF && await PF.probe();
const quality = Q.get('quality') || (caps || await pickQuality()).quality, hud = Q.get('hud') !== '0';   // ?quality=low|medium|high
const xrs = await xrSupport();   // a headset browser: an MSAA context for the headset, and the Enter VR / AR buttons
setRelief({ low: 0, medium: 0.7, high: 1 }[quality] ?? 1);   // the relief's reach: off on low, 5.6 m on medium, 8 m on high
// light2 (opt-in): ?light2=1, parts off with &l2=nols,nossr,novol,nobloom
const light2 = Q.get('light2') === '1' && Object.fromEntries((Q.get('l2') || '').split(',').filter(Boolean).map((k) => [k.replace(/^no/, ''), false]));
// soft sun shadows (opt-in): ?soft=1 [&sunAngle=deg]
const softShadows = Q.get('soft') === '1' && (Q.get('sunAngle') ? { sunAngle: +Q.get('sunAngle') } : true);
// realtime lighting (opt-in, docs/lighting.md): ?csm=1 cascaded sun shadows, ?gi=1 irradiance probe volume,
// ?probes=1 a box reflection probe,
// ?lights=N clustered lamps (&cluster=0 plain loop, &lshadows=K shadowed, &stock=1 three's own lights instead)
const LF = (k) => Q.get(k) === '1';
const NL = +Q.get('lights') || 0, stock = LF('stock');
const SCR = ['ssr', 'ssgi', 'contact'].some((k) => +Q.get(k) > 0);   // ?ssr=1&ssgi=1&contact=1: screen-space lighting (docs/lighting.md)
const lighting = ['csm', 'gi', 'probes'].some(LF) || (NL && !stock) || SCR ? {
  screen: SCR,
  csm: LF('csm') && { cascades: +Q.get('cascades') || 4, stagger: LF('stagger') },   // &stagger=1: far cascades redrawn less often
  gi: LF('gi') && { min: [-9, 0.15, -9], max: [9, 5.4, 9], spacing: +Q.get('gispacing') || 2 },
  probes: LF('probes') && [{ min: [-7.2, 0, -7.2], max: [7.2, 6, 7.2], position: [0, 2.6, 0], fade: 1.5 }],
  lights: NL > 0 && !stock && { cluster: Q.get('cluster') !== '0', perCell: +Q.get('percell') || 0 },   // exact lists (&percell=64: the capped ones)
} : undefined;
const ed = editable(plan, edits);   // with an empty layer: the plan itself, and every ed. call below does nothing
const world = createWorldRenderer({ quality, byteTargets: Q.get('bytetargets') === '1', xr: xrs.vr || xrs.ar, light2, softShadows, lighting: ed.lighting(lighting), dynamicRes: Q.get('dynres') ? (Q.get('dynres') === '1' || { target: +Q.get('dynres') }) : (caps?.settings.dynamicRes ?? false),
  canvas, width: W, height: H, place, time: date || 'golden', preserveDrawingBuffer: true,
  shadow: { center: [0, 2, 0], radius: 17 }, envProbe: [0, 2.2, 0],
  fog: { groundDensity: 0.0022, height: 30 },
  post: { grain: Q.get('grain') === '0' ? 0 : 0.012, dof: Q.get('dof') ? 0.025 : 0, focus: 9,
    ...(Q.get('aolit') === '1' ? { aoLit: 1 } : {}), ...(Q.get('ae') === '1' ? { autoExposure: 0.5 } : {}),
    ...postFromQuery(Q) },   // ?taa2=1&upscale=0.67&mb=0.5&bokeh=1&lens=0.03&bloom2=1&lut=warm&chroma=0.6 (docs/post.md)
});
const urls = import.meta.glob('./tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['./tex/' + f] });
// wetness (opt-in): ?wet=0.8 re-patches the ground and masonry materials, ?rain=1 adds the streaks
const wet = Q.has('wet') || Q.has('rain');
if (wet) { setWetness(+(Q.get('wet') ?? 0)); setRain(+(Q.get('rain') ?? 0)); }
const buildOpts = (p) => ({ plan: p, modules: modules({ broken: Q.has('broken') }), shared: { tex, detail: !Q.has('nodetail'), ...(wet ? { wet: true } : {}) } });
const built = await buildWorld(world, buildOpts(ed.plan));
const rain = Q.has('rain') ? addRain({ ...world.ctx, root: world.scene }) : null;

if (NL) addLamps(world, { n: NL, min: [-8, 0.6, -8], max: [8, 2.6, 8], first: [[0, 1.8, 0], [4, 1.4, 3], [-4, 1.4, -3]], shadows: +Q.get('lshadows') || 0, stock });
const { camera } = world;
camera.aspect = W / H; camera.fov = 48; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
if (Q.get('perf')) window.__big = (await import('@miragekit/core/bigworld')).applyBigWorld(world, world.scene, Q.get('perf'));   // ?perf=chunk,lod,occ (docs/big-worlds.md)
await ed.apply(world, built);
await world.prepare();
const spp = +Q.get('spp') || 6;
const mode = Q.get('mode') || 'orbit';
const playOpts = { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', fit: !Q.get('w'), quality, hud };
const play = createPlay(world, playOpts);
if (mode === 'orbit' || Q.has('view')) {
  const v = ed.plan.viewpoints.find((p) => p.name === (Q.get('view') || 'hero')) || ed.plan.viewpoints[0];
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
if (PF) window.__platform = PF.mount({ world, play, canvas, caps });
window.__mirage = { world, tex, built, play, xr, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }), wet: { setWetness, setRain, rain } };
ed.attach({ world, built, play, rebuild: buildOpts, makePlay: (o) => createPlay(world, { ...playOpts, mode: 'walk', fit: true, ...o }) });
window.__READY = true;
