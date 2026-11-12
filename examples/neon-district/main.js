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
//      ?grade=0|1 (the hour's look) ?dusk=0|1 (the dusk sky) ?flash=0|1 (the lightning lighting every wet surface, the storm sky) ?pool=0|1 (the lamp pool) ?bounce=0|1 ?godrays=0|1 ?flare=0|1
//      ?moon=0|1 (the moon casts shadows by night) ?percell=N (the lamp pool's lamps per view cell, 32; 16 darkens the street)
//      ?mirrorall=1 (the close-up props and the view model in the mirror too)
//      ?time=night | dusk | day | dawn | HH:MM (in the game: T steps through them, the options panel has a slider)
//      ?detail=0..1 (how much optional dressing: low 0.4, medium 0.8, high 1)   ?skip=module,module (leave modules out)
//      ?wet=0..1 ?rain=0..1   ?big=chunk,occ,lod (docs/big-worlds.md)   ?lamps=N (N extra lamps: the cluster test)
import * as THREE from 'three';
import { createWorldRenderer, pickQuality, setWetness, setRain, addLampSource, makeLut, lutTexture, createVfx, skyState, FOG, WET } from '@miragekit/core';
import { applyBigWorld } from '@miragekit/core/bigworld';
import { buildWorld } from '@miragekit/world';
import { addRain } from '@miragekit/world/kits/rain';
import { createPlay } from '@miragekit/play';
import { startGame } from '@miragekit/game';
import plan from './plan.js';
import modules from './modules/index.js';
import { setupGame, objective, summary, VERSION, T } from './game/index.js';
import { mirrorLayer, distanceCull, MIRROR_LAYER } from './perf.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const picked = await pickQuality();
const quality = Q.get('quality') || picked.quality;

// ---- clarity (options panel, reloads): how many canvas pixels per CSS pixel. A phone's screen is 2.6-3.5x; drawing
// 1x is why it looked soft. 'sharp' (a phone's default unless its GPU is weak) draws 1.5x and sharpens, 'max' 2x;
// on a phone either lets the resolution drop while frames run late. A desktop stays at 1x unless chosen.
const CLARITY_KEY = 'nd.clarity', CLARITY = ['standard', 'sharp', 'max'];
const phone = !!globalThis.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const clarity = (() => {
  const q = Q.get('clarity'); if (CLARITY.includes(q)) return q;
  try { const s = localStorage.getItem(CLARITY_KEY); if (CLARITY.includes(s)) return s; } catch { /* no storage */ }
  return phone && !/gpu/.test(picked.why) ? 'sharp' : 'standard';
})();
document.documentElement.dataset.clarity = clarity;
const pixelRatio = Math.min(devicePixelRatio || 1, { standard: 1, sharp: 1.5, max: 2 }[clarity]);

// ---- what each quality level turns on; a URL flag overrides one feature
const TIER = {
  low: { flash: 1, grade: 1, dusk: 1, pool: 1, bounce: 0, godrays: 0, flare: 0, ssr: 0, ssgi: 0, contact: 0, gi: 0, probes: 1, csm: 0, shadows: 0, vol: 0, taa2: 0, mb: 0, bloom2: 1, lut: 1, chroma: 0, upscale: 0.75, rain: 0.6, big: 0, moon: 0, percell: 20, planar: 0, dirt: 0, streak: 0, sharp: 0 },
  medium: { flash: 1, grade: 1, dusk: 1, pool: 1, bounce: 1, godrays: 1, flare: 1, ssr: 0, ssgi: 0, contact: 0, gi: 1, probes: 1, csm: 0, shadows: 1, vol: 1, taa2: 1, mb: 0, bloom2: 1, lut: 1, chroma: 0.06, upscale: 1, rain: 1, big: 0, moon: 1, percell: 26, planar: 3, dirt: 0.12, streak: 0.08, sharp: 0.5 },
  high: { flash: 1, grade: 1, dusk: 1, pool: 1, bounce: 1, godrays: 1, flare: 1, ssr: 1, ssgi: 1, contact: 1, gi: 1, probes: 1, csm: 1, shadows: 1, vol: 1, taa2: 1, mb: 0.12, bloom2: 1, lut: 1, chroma: 0.08, upscale: 1, rain: 1, big: 0, moon: 1, percell: 32, planar: 3, dirt: 0.15, streak: 0.1, sharp: 0.55 },
}[quality] || {};
const F = (k) => (Q.has(k) ? (isNaN(+Q.get(k)) ? Q.get(k) : +Q.get(k)) : TIER[k]);
const on = (k) => !!F(k);

// ---- the grade: cool shadows, warm highlights, a little more colour in the neon (a LUT made in code)
const lut = makeLut(([r, g, b]) => {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, sh = (1 - l) ** 2, hi = l * l;
  const sat = (c) => l + (c - l) * 1.12;
  return [sat(r) * (1 - 0.05 * sh) + 0.02 * hi, sat(g) * (1 + 0.01 * sh), sat(b) * (1 + 0.07 * sh) - 0.015 * hi].map((v) => Math.min(1, Math.max(0, v)));
}, 24);

// ?time=night | dusk | day | dawn | HH:MM (night and dusk: 26 October, a full Moon high over the roofs by night). Day
// is the golden hour of 10 September (17:44, the Sun 5.6 degrees up at bearing 272: due west, straight down Kestrel
// Street's axis), so from the street's east end and from the plaza the sun stands low in the street's open west end
// (plan.js: a low deck between the two west towers), backlighting the canyon: long shadows down the street, the
// floor lit along its length, the facades in cool shade with warm light bounced off the sunlit ones. A clock time
// (the slider) is a time of 10 September.
const TIMES = { night: { day: '2026-10-26', time: '23:10' }, dawn: { day: '2026-10-26', time: '06:20' }, day: { day: '2026-09-10', time: '17:44' }, dusk: { day: '2026-10-26', time: '17:04' } };
const timeOf = (t) => TIMES[t] || (/^\d{1,2}:\d{2}$/.test(t || '') ? { day: '2026-09-10', time: t } : null);
const bar = plan.bar.rect, room = plan.relay.room;
const lighting = {
  bounce: on('bounce') && { spacing: 2 },                                                          // by day: light off the sunlit side of the street into the shade
  lights: { perCell: 0, perFrame: 1 },                                                            // clustered lamps, exact lists; one shadow tile redrawn a frame (sentinels walking past lamps)
  screen: on('ssr') || on('ssgi') || on('contact'),
  // the wet street mirrors the signs above it, off screen or not (?planar=N: the mirror is redrawn every Nth frame)
  // (it draws one layer: everything but the view model and the close-up props, perf.js)
  planar: on('planar') && { y: 0, scale: 0.5, roughMax: 0.4, every: Math.max(1, Math.round(F('planar'))), ...(Q.get('mirrorall') === '1' ? {} : { layers: [MIRROR_LAYER] }) },
  csm: on('csm') && { cascades: 3, stagger: true },
  gi: on('gi') && { min: [bar[0], 0, bar[1]], max: [bar[2], plan.bar.height, bar[3]], spacing: 1.3, fade: 0.5 },
  probes: on('probes') && [
    { min: [bar[0], 0, bar[1]], max: [bar[2], plan.bar.height, bar[3]], fade: 0.5 },
    { min: [room[0], 0, room[1]], max: [room[2], plan.relay.height, room[3]], fade: 0.5 },
    // the steel truck at the alley mouth (?truckprobe=1): its own capture of the signs round it. Off by default: every
    // probe is a texture unit in every lit material, and a lit material has 16 (13 go to the lighting on high); the
    // baked surfaces need three of the rest and their weathering decals a fourth (NOTES.md "Surfaces")
    ...(Q.get('truckprobe') === '1' ? [{ min: [plan.cars[0][0] - 3.4, 0, plan.cars[0][1] - 2.6], max: [plan.cars[0][0] + 3.4, 3.2, plan.cars[0][1] + 2.4], fade: 0.6 }] : []),
  ],
};
// ---- the hour's weather, in one place. Keyed by the Sun's elevation h (degrees), so the time slider (setHour) carries
// the weather with it: night rains (wet streets, low cloud lit from below, a rain haze), dusk is the moment after the
// rain stopped (still wet, drying in patches, the cloud breaking, puddles holding the sky), the afternoon is dry and
// clear (a few puddles left in the ruts and gutters, thin haze for depth). Keys at h = -12, -4, 2, 8, 16; between two
// keys the value eases (smoothstep). rain: x the tier's rain; wet: setWetness; clouds: cloud cover; fog / air / glow:
// x the ground haze, the air's haze and its glow toward the Sun or Moon; env: x the image-based light, the sky's fill in
// the shade (the capture is taken down in the street, between dark walls: by day the open sky's share of the shade
// is restored with x12; by night x1.8 is the glow of a lit city under low cloud, so no shadow is black). ?rain= / ?wet=
// pin those two.
const WX_H = [-12, -4, 2, 8, 16];
const WX = {
  rain: [1, 0.6, 0, 0, 0],
  wet: [0.9, 0.8, 0.55, 0.22, 0.12],
  clouds: [0.85, 0.75, 0.5, 0.45, 0.35],
  fog: [1, 1, 0.75, 0.4, 0.3],
  air: [1, 1, 0.8, 0.5, 0.4],
  glow: [1, 0.9, 0.55, 0.3, 0.22],
  env: [1.8, 2, 4, 12, 12],
};
function weatherAt(h) {
  let i = 0;
  while (i < WX_H.length - 2 && h > WX_H[i + 1]) i++;
  const t0 = Math.min(1, Math.max(0, (h - WX_H[i]) / (WX_H[i + 1] - WX_H[i]))), t = t0 * t0 * (3 - 2 * t0);
  return Object.fromEntries(Object.entries(WX).map(([k, v]) => [k, v[i] + (v[i + 1] - v[i]) * t]));
}
// wetness before the world exists (set later, the world recaptures its light and re-bakes every probe): the hour's
const startState = (() => { const v = timeOf(Q.get('time')) || TIMES.night; try { return skyState(v, { lat: 34, lon: 135, height: 20, tzHours: 9 }); } catch { return null; } })();
const wx0 = weatherAt(startState ? startState.sun.elevation : -60);
const wetQ = (v) => Math.round(v * 20) / 20;   // in steps of 0.05: a wetness change recaptures the light
setWetness(Q.has('wet') ? +Q.get('wet') : wetQ(wx0.wet));
setRain(Q.has('rain') ? +Q.get('rain') : (TIER.rain ?? 1) * wx0.rain);
const world = createWorldRenderer({
  quality, canvas, width: W, height: H, preserveDrawingBuffer: true, pixelRatio,
  ...(phone && clarity !== 'standard' ? { dynamicRes: { target: 60, min: 0.6 } } : {}),
  place: { lat: 34, lon: 135, height: 20, tzHours: 9 },                                           // a generic mid-latitude coast, not a real city
  time: timeOf(Q.get('time')) || TIMES.night,
  // the hour's look, photographic: a neutral night (white street and shop light, coloured accents; the darks lifted
  // a touch toward the sodium-grey of a cloud lit from below; highlights roll off to white through the AgX share),
  // a dusk of warm light against cool shade, and a golden afternoon (warm highlights, cool open shade, a firm curve).
  // Exposure (EV, on top of the world's own adaptation and post.exposure 0.5) is set so a mid-grey card in the
  // street reads mid-grey: NOTES.md "Light by the hour" has the numbers measured
  grade: on('grade') && { nightAdapt: 0.42, lampTint: [1.02, 1, 0.97],
    night: { exposure: -0.65, temperature: 0.05, tint: 0.05, saturation: 0.88, contrast: 1.02, tonemapMix: 0.55, shadowTint: [0.98, 1, 1.03], hiTint: [1.02, 1, 0.97],
      black: 0, curve: 0.1, punch: 0.15, clarity: 0.08, highlightWarmth: 0, lift: [0.0065, 0.006, 0.0056], gamma: 1.08 },
    dusk: { exposure: 0.15, temperature: 0.05, tint: 0.08, saturation: 0.98, contrast: 1.0, tonemapMix: 0.45, shadowTint: [0.95, 1, 1.07], hiTint: [1.08, 1, 0.9],
      black: 0.003, curve: 0.12, punch: 0.3, clarity: 0.12, highlightWarmth: 0.15, lift: [0.0015, 0.0015, 0.002] },
    // the golden hour: Nizwa's grade at 3-8 degrees of sun (its daynight GRADE_KEYS: white balance neutral, the
    // warmth is the light's own; saturation 1.12, AgX share 0.3, curve 0.22, cool shade [0.95, 1, 1.08], a trace of
    // warm highlight [1.03, 1, 0.96]), no tint (a +tint is magenta)
    golden: { exposure: 0.0, temperature: 0.0, tint: 0, saturation: 1.12, contrast: 1.0, tonemapMix: 0.3, shadowTint: [0.95, 1, 1.08], hiTint: [1.03, 1, 0.96],
      black: 0.01, curve: 0.22, punch: 0.4, clarity: 0.14, highlightWarmth: 0.1 },
    noon: { exposure: 0.6, temperature: 0.12, tint: 0.03, saturation: 1.0, contrast: 1.05, tonemapMix: 0.35, shadowTint: [0.97, 1, 1.04], hiTint: [1.04, 1, 0.95],
      black: 0.008, curve: 0.16, punch: 0.3, clarity: 0.1, highlightWarmth: 0.1 } },
  // the lightning (core weather.js) lights every wet surface; the storm sky (a torn deck, a bright horizon band, lit by
  // the flash) is blended in by the rain's weight (below), so dusk and day are the sky as they were
  flash: on('flash') ? { intensity: 6 } : undefined,
  sky: on('dusk') || on('flash') ? { ...(on('dusk') ? { dusk: { haze: 2.2, night: 0.45 } } : {}), ...(on('flash') ? { storm: true } : {}) } : undefined,
  lampPool: on('pool') ? { perCell: F('percell'), ...(Q.has('captures') ? { captures: Q.get('captures') !== '0' } : {}) } : undefined,
  clouds: wx0.clouds, shadow: { center: [0, 2, -6], radius: 46 }, envProbe: [-2, 5, 6], envIntensity: 0.6 * wx0.env,
  // the haze: by night a rain haze round the lamps; by day only distance (weatherAt scales it per hour). Its colour
  // is the sky's (x1, not brighter: a brighter fog than the sky is what washed the day out)
  fog: { groundDensity: 0.0045, height: 14, air: 0.0003, color: 1.0, glow: 1 },
  lighting,
  light2: on('vol') ? { ssr: false, bloom: false, ls: { slots: 4 }, vol: { lamps: 1.5, dustOut: 0.008, golden: 0.3, height: 9, lampDust: 0.05, haloR: 1.3, lampReach: 7, noise: 0.7 } } : undefined,
  post: {
    // a neutral base (the grade does the hour's look): no extra contrast or colour; bloom only off true emitters, tight
    exposure: 0.5, contrast: 1.0, saturation: 0.97, vignette: 0.26, grain: Q.get('grain') === '0' ? 0 : 0.014, bloom: 0.11, bloomRadius: 0.32, ao: 0.9,
    taa2: F('taa2') ? 1 : 0, motionBlur: F('mb') || 0, bloomPyramid: F('bloom2') ? 1 : 0, chroma: F('chroma') || 0, ...(F('upscale') && F('upscale') < 1 ? { upscale: F('upscale') } : {}),
    ...(F('lut') && !on('grade') ? { lut: lutTexture(lut), lutStrength: 1 } : {}),                    // the code-made LUT stands in when the grade is off
    godrays: on('godrays') ? 0.9 : 0, flare: on('flare') ? 0.8 : 0,
    // a dirty lens and anamorphic streaks off the signs; the threshold keeps sunlit ground out of both by day
    lensDirt: F('dirt') || 0, lensDirtThreshold: 8, streak: F('streak') || 0, streakThreshold: 10, streakLength: 0.6, rcas: F('sharp') || (clarity === 'standard' ? 0 : 0.45),
    ssr2: on('ssr') ? 1 : 0, ssrRough: 0.5, ssgi: on('ssgi') ? 0.7 : 0, ssgiRange: 3, contact: on('contact') ? 1 : 0,
  },
});

// detail: how much optional dressing the modules build (crowds, traffic, balcony life, the far skyline): phones stay light
const shared = { quality: on('shadows') ? quality : 'low', tier: quality, gi: !!lighting.gi, detail: Q.has('detail') ? +Q.get('detail') : { low: 0.4, medium: 0.8, high: 1 }[quality] ?? 1 };
const skip = (Q.get('skip') || '').split(',');                                                     // ?skip=aerial,grime: build without those modules (A/B timing)
const built = await buildWorld(world, { plan, modules: modules.filter((m) => !skip.includes(m.name)), shared });
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
// the weather follows the hour (weatherAt): eased each frame toward the Sun's elevation now; the fog's numbers are
// scaled after the world writes them (onUpdate runs after writeFog), the wetness moves in 0.05 steps (each one
// recaptures the image-based light), the rain and the cloud cover are uniforms
const wxNow = { ...wx0 };
const cloudU = world.sky.material.uniforms.uCloudCover, stormU = world.sky.material.uniforms.uStorm;
world.ctx.onUpdate(() => {
  const h = world.state ? world.state.sun.elevation : -60, want = weatherAt(h);
  for (const k in want) wxNow[k] += (want[k] - wxNow[k]) * 0.08;
  if (!Q.has('rain')) setRain((TIER.rain ?? 1) * (wxNow.rain < 0.01 ? 0 : wxNow.rain));
  if (!Q.has('wet')) { const w = wetQ(wxNow.wet); if (Math.abs(w - WET.uWet.value) > 0.01) setWetness(w); }
  cloudU.value = wxNow.clouds;
  if (stormU) stormU.value.x = THREE.MathUtils.smoothstep(wxNow.rain, 0.25, 0.9);   // the storm sky by the rain's weight
  world.scene.environmentIntensity = 0.6 * wxNow.env;
  FOG.params[0] *= wxNow.fog; FOG.params[2] *= wxNow.air;
  for (let i = 0; i < 3; i++) FOG.glow[i] *= wxNow.glow;
  // the golden hour's haze, as Nizwa's (its daynight fogHue at 6.8 degrees, [0.32, 0.35, 0.44]: a cool blue-grey air
  // away from the sun, at the brightness of the world's own haze) and its glow toward the sun (Nizwa: the sunlight x
  // [1, 0.886, 0.7], a gold, not the red of the low sky's lean): a sun haze that glows, not a pink-white veil
  const d = THREE.MathUtils.smoothstep(h, 0.5, 4) * (1 - THREE.MathUtils.smoothstep(h, 18, 30));
  if (d > 0) {
    const fc = world.scene.fog.color, y = 0.2126 * fc.r + 0.7152 * fc.g + 0.0722 * fc.b, k = y / 0.3445;   // 0.3445: the luma of Nizwa's hue
    fc.setRGB(fc.r + (0.32 * k - fc.r) * d, fc.g + (0.35 * k - fc.g) * d, fc.b + (0.44 * k - fc.b) * d);
    const g = FOG.glow, gy = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2], kc = world.G.uKeyColor.value, ky = 0.2126 * kc.x + 0.7152 * kc.y * 0.886 + 0.0722 * kc.z * 0.7;
    if (ky > 1e-5) { const s = (gy / ky) * 1.4; g[0] += (kc.x * s - g[0]) * d; g[1] += (kc.y * 0.886 * s - g[1]) * d; g[2] += (kc.z * 0.7 * s - g[2]) * d; }
  }
});
const volLamps = (shared.lamps || []).filter((l) => l.vol).map(({ light }, i) => ({ id: 'nd' + i, light, x: light.position.x, y: light.position.y, z: light.position.z, range: light.distance, power: 0, near: 0.5, col: [0, 0, 0] }));
// (the rain-lit cones are kept near neutral: 65 % of each lamp's colour goes to its grey, so a coloured lamp's cone
// reads as lit rain, not as coloured smoke)
if (world.light2) addLampSource(world.scene, () => { for (const v of volLamps) { const l = v.light, k = l.intensity, g = (l.color.r + l.color.g + l.color.b) / 3; v.power = k; v.col[0] = (g + (l.color.r - g) * 0.35) * k; v.col[1] = (g + (l.color.g - g) * 0.35) * k; v.col[2] = (g + (l.color.b - g) * 0.35) * k; } return volLamps; });

const rain = F('rain') > 0 ? addRain({ ...world.ctx, root: world.scene }, { count: quality === 'low' ? 3000 : 9000, box: [26, 16, 26], speed: 11, streak: 0.045, width: 0.0016, gain: 2.6 }) : null;
const vfx = createVfx(world, { maxParticles: quality === 'low' ? 30000 : 90000 });
// moon shadows (?moon=0|1): at low (phones) the moon casts none once the lamps are on (by night the street lamps
// make the shadows that read; by day and at dusk the sun still casts). It saves the shadow map's draw (89 calls).
if (!on('moon')) world.ctx.onUpdate(() => { world.sun.castShadow = world.G.uLampGain.value < 0.5; });
const big = F('big') ? applyBigWorld(world, world.scene, String(F('big'))) : null;                // ?big=chunk,occ,lod: off by default, it does not pay in a block this small (NOTES.md)

const { camera } = world;
// depth: near 0.1 (the view model at the sight still clears it) and far 1600 (the sky dome is 1000 m round the eye; the
// farthest towers and traffic lanes are within 250 m): more depth resolution on the far facades than 0.08 / 3000
camera.aspect = W / H; camera.fov = 62; camera.near = 0.1; camera.far = 1600; camera.updateProjectionMatrix();
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
  // the rooms' shafts of light (modules/shafts.js) shine only when the sun, the moon or the lamp outside really reaches
  // the opening: a ray through the physics world toward it
  shared.shafts?.setSee((from, dir, max) => !!g.physics.ray(from, dir, max));
  game.start(g);
  if (Q.has('start')) g.ui.begin();
}
// the frame budget (perf.js, NOTES.md "Frame budget"): the close-up props (modelled for a look from a metre: cans,
// bottles, keys, bolts, goods) stay out of the wet street's mirror, with the view model (?mirrorall=1 puts them back);
// the goods of each row of vending machines are drawn within 30 m (userData.ndFar); the robots' metal parts (joints, hubs, rods: robot-m) and their rifles are
// left out of the mirror too (a puddle shows the shell's silhouette and the lit visor, not a 4 cm hub)
const NO_MIRROR = /^(viewmodel|vending-(can|bottle|cup|box|pack|cap|spirals)|bar-props|relay-props|stall-goods|grime-props|clutter-props|shop-props|robot-m|robot-gun|shaft|shaft-motes)$/;
{ const far = new Map(); world.scene.traverse((o) => { if (o.userData.ndFar) { if (!far.has(o.userData.ndFar)) far.set(o.userData.ndFar, []); far.get(o.userData.ndFar).push(o); } });
  for (const [d, list] of far) { const cull = distanceCull(list, d); world.ctx.onUpdate((t) => cull(camera, t)); } }
// the pickups (ammunition and med kits: small boxes that spin and bob all over the district) are drawn within 45 m:
// each was four draws a frame wherever it was (the scene, the velocity buffer as it spins, the mirror, the moon's map)
if (g) {
  const near = [];
  for (const p of plan.pickups) g.game.entities.get(p.id)?.object?.traverse((m) => { if (m.isMesh) near.push(m); });
  if (near.length) { const cull = distanceCull(near, 45); world.ctx.onUpdate((t) => cull(camera, t)); }
}
if (lighting.planar && Q.get('mirrorall') !== '1') mirrorLayer(world.scene, (o) => o.userData.mgClustered || NO_MIRROR.test(o.name));
const v = plan.viewpoints.find((p) => p.name === Q.get('view'));
if (v) play.place(v.eye, v.look, v.mode || (Q.has('world') ? Q.get('mode') || 'walk' : 'walk'));
if (Q.has('world')) world.ctx.onUpdate(relight);
window.__mirage = { world, built, play, g, game, vfx, rain, big, shared, setHour, relight, weather: { WX, WX_H, now: wxNow, at: weatherAt }, features: Object.fromEntries(Object.keys(TIER).map((k) => [k, F(k)])) };
window.__READY = true;
