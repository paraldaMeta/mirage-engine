// nizwa-probe: Nizwa Fort on the Mirage engine. A feasibility probe (REPORT.md), not a showcase: the fort is built
// by the Nizwa Golden Hour project's own module, read in place (vite.config.js), on createWorldRenderer +
// buildWorld + createPlay, with the look pack on.
// URL: ?mode=orbit (default) | walk | fly    ?view=approach | gate | wall | crown | above
//      ?time=HH:MM [&date=YYYY-MM-DD] | golden (default 17:00 on 2026-10-25, Nizwa local time)
//      ?cam=x,y,z&look=x,y,z&focal=mm   an explicit camera (as Nizwa's own stills)
//      ?w=&h=  ?spp=N  ?quality=low|medium|high  ?nodetail (Nizwa's relief switch)
//      look pack, all on by default; switch parts off with ?off=light2,soft,aolit,ae  (&l2=nols,nossr,novol,nobloom)
//      look tuning: ?env= (image-based light, 1) ?exp= (0.6) ?sat= ?con= ?temp= ?clouds=   ?maxfps=N (walk: no 60 fps cap)
//      ?grade=1 [&gradek=0..1 &nightadapt=0..1]  Mirage's time-of-day grade (gap 1), off by default
//      ?gi=1 [&gispacing=4]  Mirage's probe GI (bounce light), for the comparison with Nizwa's irradiance volume
//      ?wet=0..1 &rain=0..1 are accepted but only Mirage-made materials get wet (REPORT.md)
import * as THREE from 'three';
import { createWorldRenderer, placeDate, setWetness, setRain } from '@miragekit/core';
import { buildWorld } from '@miragekit/world';
import { createPlay } from '@miragekit/play';
import plan from './plan.js';
import modules from './modules/index.js';
import { nizwaContext } from './compat/ctx.js';
import { stats as bridge } from './compat/patch.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const off = new Set((Q.get('off') || '').split(',').filter(Boolean));
const t = Q.get('time') || '17:00';
const time = t === 'golden' ? 'golden' : placeDate(Q.get('date') || '2026-10-25', t, plan.place.tzHours);
const quality = Q.get('quality') || 'high';
const light2 = !off.has('light2') && Object.fromEntries((Q.get('l2') || '').split(',').filter(Boolean).map((k) => [k.replace(/^no/, ''), false]));
const T0 = performance.now();

// ---- gap 1 (REPORT.md): Mirage's time-of-day grade, opt-in. ?grade=1 the presets; ?grade=0 or absent: off (the
// probe's look as measured in the report). ?gradek=0..1 its strength, ?nightadapt=0..1 how much darker the night is.
const gradeOpt = Q.get('grade') === '1' && {
  ...(Q.has('gradek') ? { strength: +Q.get('gradek') } : {}), ...(Q.has('nightadapt') ? { nightAdapt: +Q.get('nightadapt') } : {}),
};
// ---- end of gap 1

const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const world = createWorldRenderer({
  canvas, width: W, height: H, quality, place: plan.place, time, preserveDrawingBuffer: true,
  light2, softShadows: !off.has('soft'), dynamicRes: Q.get('dynres') === '1', grade: gradeOpt,
  shadow: { center: [24, 6, 0], radius: 62 }, envProbe: [20, 9, 36], envIntensity: 1,   // Nizwa's ENV.envIntensity (Mirage's default is 0.5)
  shadowMapSize: +Q.get('smap') || 4096,
  // ?gi=1: Mirage's irradiance probe volume over the fort (docs/lighting.md); off by default (not part of the brief)
  ...(Q.get('gi') === '1' ? { lighting: { gi: { min: [-24, 0.5, -34], max: [78, 31, 34], spacing: +Q.get('gispacing') || 4 } } } : {}),
  ...(Q.has('env') ? { envIntensity: +Q.get('env') } : {}), ...(Q.has('clouds') ? { clouds: +Q.get('clouds') } : {}),
  post: { ...(off.has('aolit') ? {} : { aoLit: 1 }), ...(off.has('ae') ? {} : { autoExposure: 0.5 }), grain: 0, exposure: 0.6,   // 0.6: the sunlit plaster as bright as in Nizwa's stills (Mirage's default is 0.4)
    ...(Q.has('exp') ? { exposure: +Q.get('exp') } : {}), ...(Q.has('sat') ? { saturation: +Q.get('sat') } : {}), ...(Q.has('con') ? { contrast: +Q.get('con') } : {}), ...(Q.has('temp') ? { temperature: +Q.get('temp') } : {}) },
});
world.setTime(time);
if (Q.has('wet') || Q.has('rain')) { setWetness(+(Q.get('wet') ?? 0)); setRain(+(Q.get('rain') ?? 0)); }

let play = null;
const nz = nizwaContext(world, { walkers: () => (play && play.mode === 'walk' ? [{ x: play.walker.pos[0], y: play.walker.pos[1], z: play.walker.pos[2] }] : []) });
// Nizwa's decimated twins of the big plaster meshes, picked per frame while moving (its walk.js does the same)
world.ctx.onUpdate(() => { if (play && play.mode !== 'orbit' && !play.still) nz.lod.update(world.camera, { viewHalf: 0, heightPx: H }); });
const built = await buildWorld(world, { plan, modules, shared: { nz } });
const tBuilt = performance.now();

const focalToFov = (focal) => (2 * Math.atan(36 / (W / H) / (2 * focal)) * 180) / Math.PI;   // Nizwa's lens: a 36 mm wide sensor
const { camera } = world;
camera.aspect = W / H; camera.fov = focalToFov(24); camera.near = 0.12; camera.far = 6000; camera.updateProjectionMatrix();
await nz.tex.ready();
await world.prepare();
const tReady = performance.now();

const spp = +Q.get('spp') || 8, mode = Q.get('mode') || 'orbit';
play = createPlay(world, { plan: built.plan, canvas, mode, spp, ui: Q.get('ui') !== '0', fit: !Q.get('w'), quality, hud: Q.get('hud') === '1', ...(Q.has('maxfps') ? { maxFps: +Q.get('maxfps') } : {}) });
function place(v) {
  camera.fov = focalToFov(v.focal || 24); camera.updateProjectionMatrix();
  play.place(v.eye, v.look, mode === 'walk' || mode === 'fly' ? mode : 'orbit');
}
const explicit = Q.has('cam') && { eye: Q.get('cam').split(',').map(Number), look: (Q.get('look') || '0,0,0').split(',').map(Number), focal: +Q.get('focal') || 35 };
if (mode === 'orbit' || Q.has('view') || explicit) place(explicit || plan.viewpoints.find((p) => p.name === (Q.get('view') || 'approach')) || plan.viewpoints[0]);

let tris = 0, meshes = 0;
world.scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position) { meshes++; const g = o.geometry; tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); } });
const info = { buildMs: Math.round(tBuilt - T0), readyMs: Math.round(tReady - T0), meshes, tris: Math.round(tris), report: built.report, bridge, tex: nz.tex.stats(), light: world.light,
  lookPack: { light2: !!world.light2, softShadows: !!world.softShadows, aoLit: world.post.aoLit, autoExposure: world.post.autoExposure } };
console.log('[info] ' + JSON.stringify({ ...info, report: undefined, light: undefined, failed: built.report.failed }));

/** tools: a still of a view (eye, look, focal, time 'HH:MM', date) -> PNG data URL; and one moving (TAA) frame */
async function still(v = {}) {
  if (v.time) { world.setTime(v.time === 'golden' ? 'golden' : placeDate(v.date || '2026-10-25', v.time, plan.place.tzHours)); nz.sync(); }
  // the world's own camera: modules read it in their updates (the lamp pool lights the lamps nearest to it)
  camera.fov = focalToFov(v.focal || 24); camera.updateProjectionMatrix();
  camera.position.fromArray(v.eye); camera.up.set(0, 1, 0); camera.lookAt(new THREE.Vector3().fromArray(v.look)); camera.updateMatrixWorld();
  world.resetExposure(); nz.lod.reset();
  const t0 = performance.now();
  world.renderFrame(v.T ?? 0, { camera, spp: v.spp || spp, frameIndex: 1 });
  world.renderer.getContext().finish();
  return { ms: Math.round(performance.now() - t0), calls: world.renderer.info.render.calls, url: canvas.toDataURL('image/png') };
}
window.__mirage = { world, built, play, nz, info, still, plan, THREE };
window.__READY = true;
