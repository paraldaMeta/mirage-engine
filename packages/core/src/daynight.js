// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
// Uses sky-time.js (adapted from the author's own project) for the Sun and Moon.
import { skyAt, placeDate } from './sky-time.js';
import { transmitAtGround, skyLightAt } from './atmosphere.js';
import { GOLDEN, dirFromElevAz } from './env.js';

// ---------------------------------------------------------------------------
// Day and night, pure functions (no three.js objects touched; the world renderer applies the result).
//
//   skyState(time, place)  time: Date | 'golden' | { elevation, azimuth } | { day: 'YYYY-MM-DD', time: 'HH:MM' }
//                          -> { sun: { elevation, azimuth, dir }, moon: {...} | null, eqToWorld | null }
//   lightAt(state)         -> every light value the world needs (key light, sky, haze, exposure, lamps, stars)
//
// The key light is one shadowed light: the Sun, and the Moon once the Sun is 1.5° below the horizon (both are
// dark at the switch, so the shadow never jumps). Exposure is a simple eye adaptation against the golden
// hour, so 'golden' renders at exposure 1.
// ---------------------------------------------------------------------------

const LIGHT_K = 10.2;     // sunlight above the atmosphere, in renderer units
const CLARITY = 0.55;     // optical-depth scale for the direct light: the eye's white point is warmer than a
                          // spectrally exact sun; 0.55 keeps the golden hour golden instead of red
const SKY_I = 20;         // the sky dome's source strength
const MOON_K = 0.25;      // a full Moon high in the sky, as a key light (night-adapted eye, not photometric)
const MOON_TINT = [0.62, 0.75, 1.0];
const NIGHT_GLOW = [0.004, 0.005, 0.008];
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const scale = (c, k) => c.map((v) => v * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const toArr = (d) => [d.x, d.y, d.z];

const TIME_FORMS = "'golden', a Date, an ISO date string, { day: 'YYYY-MM-DD', time: 'HH:MM' } or { elevation, azimuth }";
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// A wrong time or place used to light the world with NaN (a black frame, no error): say what is wrong instead.
function checkPlace(place) {
  if (!place || !finite(place.lat) || !finite(place.lon)) {
    throw new TypeError(`place: a clock time needs { lat, lon } in degrees, got ${JSON.stringify(place)}`);
  }
  if (place.tzHours != null && !finite(place.tzHours)) throw new TypeError(`place.tzHours: a number of hours, got ${JSON.stringify(place.tzHours)}`);
}
const dated = (date, place) => {
  checkPlace(place);
  const s = skyAt(date, place);
  return { date: s.date, sun: s.sun, moon: s.moon, eqToWorld: s.eqToWorld };
};

export function skyState(time, place) {
  if (time === 'golden' || time == null) time = GOLDEN;
  if (typeof time === 'string') {
    const d = new Date(time);
    if (!/^\d{4}-\d{2}-\d{2}/.test(time) || Number.isNaN(d.getTime())) throw new TypeError(`time: expected ${TIME_FORMS}, got ${JSON.stringify(time)}`);
    return dated(d, place);
  }
  if (time instanceof Date || typeof time === 'number') {
    const d = new Date(time);
    if (Number.isNaN(d.getTime())) throw new TypeError(`time: an invalid date (${String(time)})`);
    return dated(d, place);
  }
  if (typeof time !== 'object') throw new TypeError(`time: expected ${TIME_FORMS}, got ${JSON.stringify(time)}`);
  if (time.day != null || time.time != null) {
    if (typeof time.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(time.day)) throw new TypeError(`time.day: 'YYYY-MM-DD', got ${JSON.stringify(time.day)}`);
    if (time.time != null && (typeof time.time !== 'string' || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(time.time))) throw new TypeError(`time.time: 'HH:MM' or 'HH:MM:SS', got ${JSON.stringify(time.time)}`);
    checkPlace(place);
    return dated(placeDate(time.day, time.time, place.tzHours ?? 0), place);
  }
  // a fixed sun position: no Moon, no stars
  const { elevation, azimuth } = time;
  if (!finite(elevation) || !finite(azimuth)) throw new TypeError(`time: a fixed sun needs numbers { elevation, azimuth } in degrees, got ${JSON.stringify(time)}`);
  return { sun: { elevation, azimuth, dir: toArr(dirFromElevAz(elevation, azimuth)) }, moon: null, eqToWorld: null };
}

// brightness of the Moon against its phase angle (magnitude law, Allen), 1 at full
const moonPhase = (a) => Math.pow(10, -0.4 * (0.026 * Math.abs(a) + 4e-9 * a ** 4));

function base(state) {
  const h = state.sun.elevation;
  const sunRGB = scale(transmitAtGround(Math.max(h, -0.9), CLARITY), LIGHT_K * sm(-1.5, 1.0, h));
  const sky = skyLightAt(Math.max(h, -18), h > -18 ? SKY_I : 0);
  let moonRGB = [0, 0, 0], moonSkyI = 0, moonSky = null;
  const m = state.moon;
  if (m && m.elevation > -2) {
    const k = moonPhase(m.phaseAngle) * sm(-1, 3, m.elevation);
    moonRGB = transmitAtGround(Math.max(m.elevation, -0.9), CLARITY).map((v, i) => v * MOON_TINT[i] * MOON_K * k);
    moonSkyI = (SKY_I * MOON_K * moonPhase(m.phaseAngle) * 2.5) / LIGHT_K;
    moonSky = skyLightAt(m.elevation, moonSkyI);
  }
  return { h, sunRGB, sky, moonRGB, moonSkyI, moonSky };
}

let REF = null;   // the golden-hour reference for exposure
const adaptLum = (b, keyRGB, keyElev) => lum(keyRGB) * (0.2 + 0.8 * Math.max(Math.sin((keyElev * Math.PI) / 180), 0)) + lum(b.sky.E) + (b.moonSky ? lum(b.moonSky.E) : 0) + 0.004;

export function lightAt(state) {
  if (!REF) { const g = base(skyState('golden')); REF = adaptLum(g, g.sunRGB, GOLDEN.elevation); }
  const b = base(state), h = b.h, m = state.moon;
  const moonKey = h < -1.5 && m && lum(b.moonRGB) > 0;
  const keyRGB = moonKey ? scale(b.moonRGB, 1 - sm(-8, -2, h)) : b.sunRGB;
  const keyDir = moonKey ? m.dir : state.sun.dir;
  const keyElev = moonKey ? m.elevation : h;
  const Y = adaptLum(b, keyRGB, keyElev);
  const r = Y / REF;
  const exposure = Math.min(Math.max(r > 1 ? r ** -0.62 : r ** -0.6, 0.3), 40);
  // haze: the horizon sky is what the haze scatters; its glow is the part that leans toward the light
  const hz = add(b.sky.hz, b.moonSky ? b.moonSky.hz : [0, 0, 0]);
  const night = 1 - sm(-10, -2, h);
  const fog = add(scale(hz, 0.5), scale(NIGHT_GLOW, 0.9));
  const lean = (s) => s.hzToward.map((v, i) => Math.max(v - s.hzAway[i], 0));
  const glowDir = h > -6 || !m ? state.sun.dir : m.dir;
  const glow = scale(h > -6 || !b.moonSky ? lean(b.sky) : lean(b.moonSky), 0.35);
  const starVis = state.eqToWorld ? (1 - sm(-15, -7, h)) * (m ? 1 - 0.5 * m.illumination * sm(0, 15, m.elevation) : 1) : 0;
  return {
    keyDir, keyRGB, keyIsMoon: !!moonKey, keyOn: lum(keyRGB) > 1e-5,
    sunSkyI: h > -18 ? SKY_I : 0, moonSkyI: b.moonSkyI,
    moonDisc: m && m.elevation > -1 ? 0.5 : 0, moonR: m ? (m.angularRadius * Math.PI) / 180 : 0.0045,
    nightGlow: NIGHT_GLOW, starVis, eqToWorld: state.eqToWorld,
    exposure, fog, glowDir, glow,
    // grade: a warmer white balance around the golden hour, a cooler one at night (the eye's adaptation)
    warmth: 0.3 * sm(-3, 2, h) * (1 - sm(8, 25, h)) - 0.2 * (1 - sm(-8, -2, h)),
    lamp: 1 - sm(-4, 6, h), night, skyLight: lum(b.sky.E) / Math.max(lum(skyLightAt(GOLDEN.elevation, SKY_I).E), 1e-6),
  };
}

// ---------------------------------------------------------------------------
// The time-of-day grade (opt-in: createWorldRenderer({ grade: true | {...} }); off, nothing below runs). Techniques
// ported from the Nizwa Golden Hour project's day-night grade (the author's own code): per-hour looks keyed by the
// Sun's elevation, display-referred split toning, a black point and an S-curve on luma, an ACES / AgX blend, and a
// darker night (the eye adapts less than the exposure model says, so night stays night while lamps keep their glow).
//
//   gradeConfig(option)              true | { strength, nightAdapt, lampTint, noon, golden, dusk, night } -> settings | null
//   gradeAt(light, state, settings)  -> the look of this hour (a GradeLook: what post.js's grade variant applies)
//
// A look: exposure (EV), temperature / tint (added to the white balance), saturation / contrast (x), tonemapMix (AgX
// share of an ACES / AgX blend; null keeps post.tonemap), shadowTint / hiTint (display-referred split toning, normalised
// to luma 1), black (sRGB black point), curve (S-curve on luma, 0 = off), punch (0..1: the AgX branch of the blend
// steeper and more saturated, Nizwa's AgX-punchy), clarity (local contrast), highlightWarmth (the bright end warmer),
// lift (display-referred RGB lift of the darks), gamma (display gamma; > 1 opens the darks).
// ---------------------------------------------------------------------------

const ID_LOOK = Object.freeze({
  exposure: 0, temperature: 0, tint: 0, saturation: 1, contrast: 1, tonemapMix: null,
  shadowTint: [1, 1, 1], hiTint: [1, 1, 1], black: 0, curve: 0, punch: 0, clarity: 0, highlightWarmth: 0, lift: [0, 0, 0], gamma: 1,
});
/** The four hours a grade is keyed on. Partial overrides go in the grade option ({ golden: { saturation: 1.3 } }). */
export const GRADE_PRESETS = Object.freeze({
  noon: Object.freeze({ ...ID_LOOK, exposure: 0.4, temperature: 0.2, tint: 0.06, saturation: 1.12, contrast: 1.03, tonemapMix: 0.2, shadowTint: [0.98, 1, 1.03], hiTint: [1.02, 1, 0.97], black: 0.008, curve: 0.12, punch: 0.4, clarity: 0.1, highlightWarmth: 0 }),
  golden: Object.freeze({ ...ID_LOOK, exposure: 0.45, temperature: 0.4, tint: 0.22, saturation: 1.25, contrast: 1.03, tonemapMix: 0.25, shadowTint: [1, 1, 1.02], hiTint: [1.1, 0.99, 0.88], black: 0.012, curve: 0.2, punch: 0.4, clarity: 0.15, highlightWarmth: 0.3 }),
  dusk: Object.freeze({ ...ID_LOOK, temperature: 0.05, tint: 0.15, saturation: 1.05, tonemapMix: 0.35, shadowTint: [0.97, 1, 1.05], hiTint: [1.05, 1, 0.92], black: 0.006, curve: 0.16, punch: 0.4, clarity: 0.15, highlightWarmth: 0.1 }),
  night: Object.freeze({ ...ID_LOOK, temperature: 0.2, tint: 0.25, saturation: 0.95, tonemapMix: 0.4, shadowTint: [0.99, 1, 1.03], hiTint: [1.04, 1, 0.94], black: 0.003, curve: 0.15, punch: 0.4, clarity: 0.1, highlightWarmth: 0, lift: [0.0011, 0.0014, 0.0028], gamma: 1.05 }),
});
// the elevations (degrees) the looks hold at; between two keys the look eases (smoothstep)
const GRADE_KEYS = [[-12, 'night'], [-4, 'dusk'], [2, 'golden'], [10, 'golden'], [25, 'noon']];
const GRADE_FIELDS = Object.keys(ID_LOOK);

/** The grade option -> settings, or null when off. true = the presets as they are. */
export function gradeConfig(option) {
  if (!option) return null;
  const o = option === true ? {} : option;
  const n = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const look = (name) => {
    const over = o[name] || {}, L = { ...GRADE_PRESETS[name] };
    for (const k of GRADE_FIELDS) {
      const v = over[k];
      if (v === undefined) continue;
      if (Array.isArray(L[k])) { if (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) L[k] = v.slice(); }
      else if (k === 'tonemapMix') L[k] = v === null ? null : n(v, L[k], 0, 1);
      else if (Number.isFinite(v)) L[k] = v;
    }
    return L;
  };
  return {
    strength: n(o.strength, 1, 0, 1),
    // how much of the eye's dark adaptation (lightAt's exposure above 1) the grade takes back: 0 = none (as without
    // the grade), 1 = all of it (night renders at the golden hour's exposure)
    nightAdapt: n(o.nightAdapt, 0.45, 0, 1),
    // the highlights' tint as the lamps come on (light.lamp), on top of the look's hiTint
    lampTint: Array.isArray(o.lampTint) && o.lampTint.length === 3 && o.lampTint.every(Number.isFinite) ? o.lampTint.slice() : [1.04, 1, 0.92],
    noon: look('noon'), golden: look('golden'), dusk: look('dusk'), night: look('night'),
  };
}

const lumaNorm = (c) => { const l = lum(c); return l > 1e-6 ? c.map((v) => v / l) : [1, 1, 1]; };
/** The look for a light (lightAt) and its sky state (skyState), under grade settings (gradeConfig). Pure. Fields as in
 *  GRADE_PRESETS, except exposure: a multiplier here (2^EV, times the night adaptation), and tints normalised to luma 1. */
export function gradeAt(light, state, settings) {
  const S = settings || gradeConfig(true), h = state.sun.elevation, s = S.strength;
  let i = 0;
  while (i < GRADE_KEYS.length - 1 && h > GRADE_KEYS[i + 1][0]) i++;
  const [ea, na] = GRADE_KEYS[i], [eb, nb] = GRADE_KEYS[Math.min(i + 1, GRADE_KEYS.length - 1)];
  const t = eb > ea ? sm(ea, eb, h) : 0, A = S[na], B = S[nb];
  const mixv = (a, b) => (Array.isArray(a) ? a.map((v, k) => v + (b[k] - v) * t) : a + (b - a) * t);
  const toward = (v, id) => (Array.isArray(v) ? v.map((x, k) => id[k] + (x - id[k]) * s) : id + (v - id) * s);
  const o = {};
  for (const k of GRADE_FIELDS) {
    if (k === 'tonemapMix') {
      // null on one side: the other side's value, toward ACES (0) on the null side
      o[k] = A[k] === null && B[k] === null ? null : mixv(A[k] ?? 0, B[k] ?? 0) * s;
      continue;
    }
    o[k] = toward(mixv(A[k], B[k]), ID_LOOK[k]);
  }
  const lt = S.lampTint.map((v) => 1 + (v - 1) * Math.min(1, Math.max(0, light.lamp)) * s);
  o.shadowTint = lumaNorm(o.shadowTint);
  o.hiTint = lumaNorm(o.hiTint.map((v, k) => v * lt[k]));
  o.exposure = Math.pow(2, o.exposure) * Math.pow(Math.max(light.exposure, 1), -S.nightAdapt * s);
  return o;
}
