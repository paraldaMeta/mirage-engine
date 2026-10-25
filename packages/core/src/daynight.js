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

export function skyState(time, place) {
  if (time === 'golden' || time == null) time = GOLDEN;
  if (time instanceof Date || typeof time === 'number') {
    const s = skyAt(new Date(time), place);
    return { date: s.date, sun: s.sun, moon: s.moon, eqToWorld: s.eqToWorld };
  }
  if (time.day || (typeof time.time === 'string')) {
    const s = skyAt(placeDate(time.day, time.time, place.tzHours ?? 0), place);
    return { date: s.date, sun: s.sun, moon: s.moon, eqToWorld: s.eqToWorld };
  }
  // a fixed sun position: no Moon, no stars
  const { elevation, azimuth } = time;
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
