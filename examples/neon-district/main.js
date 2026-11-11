// neon-district: a small first-person shooter in one rain-wet block of a city at night. Fight from the alley to
// the street, take the relay pass from the noodle bar, cross the plaza, climb to the relay's roof, start the uplink
// and hold it. Seven modules on one site plan (plan.js, modules/, NOTES.md); the game is in game/.
//
// URL: ?quality=low|medium|high   ?start=1 (skip the title)   ?mode=mission|holdout   ?difficulty=standard|hard|brutal   ?assist=1 (an easy mode: an eighth of the damage, health comes back in full, the reserve never runs dry)
//      ?world=1 (no game: walk / fly the district; &mode=walk|fly|orbit, &view=<viewpoint name>)
//      ?lang=en|zh (default: the browser's)  ?fov=50..90  ?sens=N   ?w=&h=  ?spp=N  ?grain=0  ?hud=0
//      every rendering feature has a switch, for A/B stills and timing (default: what the quality level turns on):
//      ?ssr=0|1 ?ssgi=0|1 ?contact=0|1 (screen-space passes)  ?gi=0|1 ?probes=0|1 ?csm=0|1 ?shadows=0|1 (lamp tiles)
//      ?vol=0|1 (volumetric lamps, light2)  ?taa2=0|1 ?mb=0..1 ?bloom2=0|1 ?lut=0|1 ?chroma=N ?upscale=0.5..1
//      ?grade=0|1 (the hour's look) ?dusk=0|1 (the dusk sky) ?pool=0|1 (the lamp pool) ?bounce=0|1 ?godrays=0|1 ?flare=0|1
//      ?time=night | dusk | day | dawn | HH:MM (in the game: T steps through them, the options panel has a slider)
//      ?wet=0..1 ?rain=0..1   ?big=chunk,occ,lod (docs/big-worlds.md)   ?lamps=N (N extra lamps: the cluster test)
import * as THREE from 'three';
import { createWorldRenderer, pickQuality, setWetness, setRain, addLampSource, makeLut, lutTexture, createVfx } from '@miragekit/core';
import { applyBigWorld } from '@miragekit/core/bigworld';
import { buildWorld } from '@miragekit/world';
import { addRain } from '@miragekit/world/kits/rain';
import { createPlay } from '@miragekit/play';
import { startGame } from '@miragekit/game';
import plan from './plan.js';
import modules from './modules/index.js';
import { setupGame, objective, summary, VERSION, T } from './game/index.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const quality = Q.get('quality') || (await pickQuality()).quality;

// ---- what each quality level turns on; a URL flag overrides one feature
const TIER = {
  low: { grade: 1, dusk: 1, pool: 1, bounce: 0, godrays: 0, flare: 0, ssr: 0, ssgi: 0, contact: 0, gi: 0, probes: 1, csm: 0, shadows: 0, vol: 0, taa2: 0, mb: 0, bloom2: 1, lut: 1, chroma: 0, upscale: 0.75, rain: 0.6, big: 0 },
  medium: { grade: 1, dusk: 1, pool: 1, bounce: 1, godrays: 1, flare: 1, ssr: 1, ssgi: 0, contact: 0, gi: 1, probes: 1, csm: 0, shadows: 1, vol: 1, taa2: 1, mb: 0, bloom2: 1, lut: 1, chroma: 0.25, upscale: 1, rain: 1, big: 0 },
  high: { grade: 1, dusk: 1, pool: 1, bounce: 1, godrays: 1, flare: 1, ssr: 1, ssgi: 1, contact: 1, gi: 1, probes: 1, csm: 1, shadows: 1, vol: 1, taa2: 1, mb: 0.35, bloom2: 1, lut: 1, chroma: 0.3, upscale: 1, rain: 1, big: 0 },
}[quality] || {};
const F = (k) => (Q.has(k) ? (isNaN(+Q.get(k)) ? Q.get(k) : +Q.get(k)) : TIER[k]);
const on = (k) => !!F(k);

// ---- the grade: cool shadows, warm highlights, a little more colour in the neon (a LUT made in code)
const lut = makeLut(([r, g, b]) => {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, sh = (1 - l) ** 2, hi = l * l;
  const sat = (c) => l + (c - l) * 1.12;
  return [sat(r) * (1 - 0.05 * sh) + 0.02 * hi, sat(g) * (1 + 0.01 * sh), sat(b) * (1 + 0.07 * sh) - 0.015 * hi].map((v) => Math.min(1, Math.max(0, v)));
}, 24);

// ?time=night | dusk | day | dawn | HH:MM (26 October, a full Moon high over the roofs by night)
const TIMES = { night: { day: '2026-10-26', time: '23:10' }, dawn: { day: '2026-10-26', time: '06:20' }, day: { day: '2026-10-26', time: '13:30' }, dusk: { day: '2026-10-26', time: '17:04' } };
const timeOf = (t) => TIMES[t] || (/^\d{1,2}:\d{2}$/.test(t || '') ? { day: '2026-10-26', time: t } : null);
const bar = plan.bar.rect, room = plan.relay.room;
const lighting = {
  bounce: on('bounce') && { spacing: 2 },                                                          // by day: light off the sunlit side of the street into the shade
  lights: { perCell: 0, perFrame: 1 },                                                            // clustered lamps, exact lists; one shadow tile redrawn a frame (sentinels walking past lamps)
  screen: on('ssr') || on('ssgi') || on('contact'),
  csm: on('csm') && { cascades: 3, stagger: true },
  gi: on('gi') && { min: [bar[0], 0, bar[1]], max: [bar[2], plan.bar.height, bar[3]], spacing: 1.3, fade: 0.5 },
  probes: on('probes') && [
    { min: [bar[0], 0, bar[1]], max: [bar[2], plan.bar.height, bar[3]], fade: 0.5 },
    { min: [room[0], 0, room[1]], max: [room[2], plan.relay.height, room[3]], fade: 0.5 },
  ],
};
// wetness before the world exists: set later, the world sees a change, recaptures its light and re-bakes every probe
setWetness(Q.has('wet') ? +Q.get('wet') : 0.9);
setRain(Q.has('rain') ? +Q.get('rain') : TIER.rain ?? 1);
const world = createWorldRenderer({
  quality, canvas, width: W, height: H, preserveDrawingBuffer: true,
  place: { lat: 34, lon: 135, height: 20, tzHours: 9 },                                           // a generic mid-latitude coast, not a real city
  time: timeOf(Q.get('time')) || TIMES.night,
  // the hour's look: deep blue shadows and magenta-cyan lights by night, a warm smog by day
  grade: on('grade') && { nightAdapt: 0.4,
    night: { exposure: -0.75, saturation: 1.16, contrast: 1.05, shadowTint: [0.9, 0.99, 1.16], hiTint: [1.07, 0.97, 1.05], black: 0.002 },
    dusk: { exposure: 0.1, saturation: 1.12, shadowTint: [0.93, 0.98, 1.1], hiTint: [1.1, 0.98, 0.9] },
    golden: { exposure: 0.75, saturation: 1.15 },
    noon: { temperature: 0.8, tint: -0.04, saturation: 0.92, shadowTint: [1.0, 1.0, 0.95], hiTint: [1.08, 1.0, 0.84], exposure: 1.5 } },
  sky: on('dusk') ? { dusk: { haze: 3, night: 0.45 } } : undefined,
  // captures off: with them the pool bins its lamps again for every face of every lamp shadow tile that is redrawn
  // (a sentinel walking past a street lamp), which cost 5 ms a frame here
  lampPool: on('pool') ? { perCell: 32, captures: false } : undefined,
  clouds: 0.85, shadow: { center: [0, 2, -6], radius: 46 }, envProbe: [-2, 5, 6], envIntensity: 0.6,
  fog: { groundDensity: 0.0045, height: 14, air: 0.0003, color: 1.3, glow: 1 },
  lighting,
  light2: on('vol') ? { ssr: false, bloom: false, ls: { slots: 4 }, vol: { lamps: 1.5, dustOut: 0.008, height: 9, lampDust: 0.05, haloR: 1.3, lampReach: 7, noise: 0.7 } } : undefined,
  post: {
    exposure: 0.52, contrast: 1.06, saturation: 1.06, vignette: 0.32, grain: Q.get('grain') === '0' ? 0 : 0.014, bloom: 0.2, ao: 0.9,
    taa2: F('taa2') ? 1 : 0, motionBlur: F('mb') || 0, bloomPyramid: F('bloom2') ? 1 : 0, chroma: F('chroma') || 0, ...(F('upscale') && F('upscale') < 1 ? { upscale: F('upscale') } : {}),
    ...(F('lut') && !on('grade') ? { lut: lutTexture(lut), lutStrength: 1 } : {}),                    // the code-made LUT stands in when the grade is off
    godrays: on('godrays') ? 0.9 : 0, flare: on('flare') ? 0.8 : 0,
    ssr2: on('ssr') ? 1 : 0, ssrRough: 0.5, ssgi: on('ssgi') ? 0.7 : 0, ssgiRange: 3, contact: on('contact') ? 1 : 0,
  },
});

const shared = { quality: on('shadows') ? quality : 'low', gi: !!lighting.gi };
const built = await buildWorld(world, { plan, modules, shared });
for (let i = 0, n = +Q.get('lamps') || 0; i < n; i++) {                                           // ?lamps=N: the clustered-light test
  const l = new THREE.PointLight(new THREE.Color().setHSL((i * 0.618) % 1, 0.8, 0.55), 6 * world.G.uLampGain.value, 7, 2);
  l.position.set(-32 + ((i * 7.3) % 64), 1.2 + (i % 5) * 0.7, 2.5 + ((i * 3.1) % 7)); world.scene.add(l); world.lighting.addLight(l);
}
// the volumetric pass scatters the lamps the modules marked `vol` (they are clustered lights, so three's own loop
// and light2's scan never see them: this table is how light2 learns of them)
if (world.lampPool) world.lampPool.set(shared.pool || []);
// the clustered lamps' strength, from the hour: street lamps follow the world's lamp level (off by day), the rooms'
// own lamps stay on and only follow the exposure
const relight = () => {
  const look = world.gradeLook, room = Math.pow(Math.max(look ? world.exposure * look.exposure : world.exposure, 1e-4), -0.9), out = world.G.uLampGain.value;
  for (const { light } of shared.lamps || []) light.userData.base = light.intensity = light.userData.nd * (light.userData.indoor ? room : out);
  return { room, out };
};
relight();
/** the hour: 'night' | 'dawn' | 'day' | 'dusk' | 'HH:MM'; eased over about a second, the probes bake again */
let hour = TIMES[Q.get('time')] ? Q.get('time') : timeOf(Q.get('time')) ? Q.get('time') : 'night';
const setHour = (t) => { const v = timeOf(t); if (!v) return hour; hour = t; world.setTime(v, { ease: true }); return hour; };
const volLamps = (shared.lamps || []).filter((l) => l.vol).map(({ light }, i) => ({ id: 'nd' + i, light, x: light.position.x, y: light.position.y, z: light.position.z, range: light.distance, power: 0, near: 0.5, col: [0, 0, 0] }));
if (world.light2) addLampSource(world.scene, () => { for (const v of volLamps) { const l = v.light, k = l.intensity; v.power = k; v.col[0] = l.color.r * k; v.col[1] = l.color.g * k; v.col[2] = l.color.b * k; } return volLamps; });

const rain = F('rain') > 0 ? addRain({ ...world.ctx, root: world.scene }, { count: quality === 'low' ? 3000 : 9000, box: [26, 16, 26], speed: 11, streak: 0.045, width: 0.0016, gain: 2.6 }) : null;
const vfx = createVfx(world, { maxParticles: quality === 'low' ? 30000 : 90000 });
const big = F('big') ? applyBigWorld(world, world.scene, String(F('big'))) : null;                // ?big=chunk,occ,lod: off by default, it does not pay in a block this small (NOTES.md)

const { camera } = world;
camera.aspect = W / H; camera.fov = 62; camera.near = 0.08; camera.far = 3000; camera.updateProjectionMatrix();
const spp = +Q.get('spp') || 4, hud = Q.get('hud') !== '0';
let play, g = null, game = null;
if (Q.has('world')) {   // the district alone: walk, fly, orbit (stills, the world check)
  await world.prepare();
  play = createPlay(world, { plan: built.plan, canvas, mode: Q.get('mode') || 'walk', spp, ui: Q.get('ui') !== '0', shadowRadius: 34, fit: !Q.get('w'), quality, hud });
} else {
  g = await startGame(world, {
    built, canvas, id: plan.name, version: VERSION, title: T.title, subtitle: T.subtitle,
    spp, shadowRadius: 34, fit: !Q.get('w'), quality, hud, idle: 0,
    setup: (ctx) => { game = setupGame(ctx, { built, shared, vfx, Q, quality, relight, setHour, hour: () => hour }); },
    objective, summary,
  });
  play = g.play;
  game.start(g);
  if (Q.has('start')) g.ui.begin();
}
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, v.mode || (Q.has('world') ? Q.get('mode') || 'walk' : 'walk'));
if (Q.has('world')) world.ctx.onUpdate(relight);
window.__mirage = { world, built, play, g, game, vfx, rain, big, shared, setHour, relight, features: Object.fromEntries(Object.keys(TIER).map((k) => [k, F(k)])) };
window.__READY = true;
