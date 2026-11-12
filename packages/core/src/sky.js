// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';
import { ATMO, ATMOSPHERE_GLSL } from './atmosphere.js';
import { FOG } from './fog.js';
import { FLASH } from './weather.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ---------------------------------------------------------------------------
// The sky dome: the atmosphere of atmosphere.js lit by the Sun (and by the Moon at night), an HDR sun disc, the
// Moon's disc with its phase, a cloud layer at 2.5 km and a faint night glow. It follows whatever camera draws
// it (cube captures included) and sits at the far plane, drawn after the opaque world.
// All values live in `uniforms` (createSkyUniforms); daynight.js writes them.
//
// The dusk sky (opt-in: createWorldRenderer({ sky: { dusk: true } }), or createSkyUniforms({ dusk })) changes the
// same dome in four ways, and nothing at all when it is off (the code is compiled in only with MG_SKY_DUSK):
//  - hazier air: the aerosol x `haze` (a paler, softer horizon by day; a wide warm glow round a low Sun or Moon),
//    and multiple scattering that reddens and fades with the light at each point instead of staying day-blue, so
//    twilight gets its colours (the warm horizon under the set Sun, Earth's shadow and the pink band above it);
//  - airglow brighter toward the horizon (it shines from a shell ~90 km up), and a night sky seen darker than the
//    light it gives (`night`: the visible dome x this once the Sun is 10 deg down; environment captures keep it);
//  - below the horizon, where no ground reaches: the horizon's air, then what the world's haze makes of far ground
//    (fog.js's in-scatter at infinity), instead of a black band;
//  - altocumulus: puffy cells in coverage patches, self-shadowed toward the light, a fuller default cover (`cover`).
// The air parts are baked into the direction tables with the rest (no per-pixel cost); the clouds are per pixel.
//
// The storm sky (opt-in: { sky: { storm: true | { ... } } }, the define MG_SKY_STORM) lays a low torn rain deck over
// the dome by `uniforms.uStorm.value.x` (0 none: the dome as before; the caller eases it with the rain): dark masses
// and paler thin parts lit from below by the city (the world's haze colour), fast scud, rain curtains hanging at the
// horizon and a bright horizon band, and the lightning (weather.js FLASH) lighting the deck from inside, brightest
// round the strike and in the thin parts. The technique follows the owner's Nizwa project (src/maps/qulzum-sea.js,
// its dome), re-implemented on this sky's units.
// ---------------------------------------------------------------------------

/** The storm sky's settings: `glow` the deck's brightness x the haze colour, `band` the horizon band's, `flash` x the
 *  lightning's light in the deck, `speed` the scud's drift (x the cloud layer's). */
export const SKY_STORM_DEFAULTS = Object.freeze({ glow: 1.1, band: 1.7, flash: 0.35, speed: 6 });
/** config.sky ({ storm: true | { glow, band, flash, speed } }) -> the storm sky's settings, or null (off). */
export function skyStormConfig(c) {
  if (!c || !c.storm) return null;
  const o = c.storm === true ? {} : c.storm, D = SKY_STORM_DEFAULTS;
  const n = (v, d, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : d);
  return { glow: n(o.glow, D.glow, 20), band: n(o.band, D.band, 20), flash: n(o.flash, D.flash, 20), speed: n(o.speed, D.speed, 100) };
}

/** The dusk sky's settings: `haze` aerosol x the clear air's, `night` the night dome's brightness as seen (1 = as
 *  lit), `airglow` x the airglow's horizon brightening, `cover` the cloud cover when the world gives none. */
export const SKY_DUSK_DEFAULTS = Object.freeze({ haze: 2.5, night: 0.5, airglow: 1, cover: 0.5 });

/** config.sky ({ dusk: true | { haze, night, airglow, cover } }) -> the dusk sky's settings, or null (off). */
export function skyDuskConfig(c) {
  if (!c || !c.dusk) return null;
  const o = c.dusk === true ? {} : c.dusk, D = SKY_DUSK_DEFAULTS;
  const n = (v, d, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : d);
  return { haze: n(o.haze, D.haze, 10), night: n(o.night, D.night, 1), airglow: n(o.airglow, D.airglow, 10), cover: n(o.cover, D.cover, 1) };
}

export function createSkyUniforms({ dusk, storm } = {}) {
  const u = createBaseUniforms();
  const St = skyStormConfig({ storm });
  if (St) {
    Object.assign(u, {
      uStorm: { value: new THREE.Vector4(0, St.glow, St.band, St.flash) },   // x the weight (0 off .. 1), y glow, z band, w flash
      uStormSpeed: { value: St.speed },
      uStormBase: { value: new THREE.Color(0, 0, 0) },                        // the haze colour as the dome is drawn
      uFlash: FLASH.uFlash, uFlashDir: FLASH.uFlashDir,
    });
  }
  const D = skyDuskConfig({ dusk });
  if (D) {
    Object.assign(u, {
      uDusk: { value: new THREE.Vector4(D.haze, D.night, D.airglow, 0) },
      // the world's haze (fog.js): colour and density from scene.fog as the dome is drawn, light and glow by reference
      uHazeCol: { value: new THREE.Color(0, 0, 0) }, uHazeDen: { value: 0 }, uFogL: { value: FOG.light }, uFogGlow: { value: FOG.glow },
    });
  }
  return u;
}
function createBaseUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 20 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonI: { value: 0 }, uMoonDisc: { value: 0 }, uMoonR: { value: 0.0045 },
    uNightGlow: { value: new THREE.Vector3() },
    uCloudCover: { value: 0.35 }, uCloudOffset: { value: new THREE.Vector2() },
    uCapture: { value: 0 },                 // 1 while an environment map is captured: no discs
    // stars.js reads these three
    uEq: { value: new THREE.Matrix3() }, uStarVis: { value: 0 }, uStarGain: { value: 0.3 },
  };
}

// The air (scattering of Sun and Moon light, airglow, the ground below the horizon) depends only on the view
// direction and on uniforms that change in setTime, so createSkyLut bakes it once per setTime into two small
// direction tables (colour + ground flag, transmittance); the dome then reads them instead of marching 16 steps
// per pixel twice (1.4-1.5 ms of a 12-13 ms frame at 2880x1800, measured). Without a table it marches as before.
// Table layout: u = world azimuth (wraps), v = elevation, squeezed toward the horizon where the sky changes fastest.
const f1 = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const LUT_GLSL = /* glsl */ `
uniform sampler2D tSkyCol, tSkyTr;
vec2 mgSkyUV(vec3 d){
  float el = asin(clamp(d.y, -1.0, 1.0));
  return vec2(atan(d.z, d.x) / (2.0 * MG_PI) + 0.5, 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * MG_PI)));
}
vec3 mgSkyDir(vec2 uv){
  float az = (uv.x - 0.5) * 2.0 * MG_PI, t = 2.0 * uv.y - 1.0, el = sign(t) * t * t * 0.5 * MG_PI;
  return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
}
#ifdef MG_SKY_DUSK
uniform vec4 uDusk;   // x aerosol x the clear air's, y night dome as seen, z airglow horizon gain
// mgTransmit with the aerosol's optical depth x tM
vec3 mgTransmitDusk(float r, float mu, float tM){
  float muH = -sqrt(max(1.0 - (MG_RG * MG_RG) / (r * r), 0.0));
  float vis = smoothstep(muH - 0.006, muH + 0.006, mu);
  if (vis <= 0.0) return vec3(0.0);
  float h = max(r - MG_RG, 0.0);
  float odR = MG_HR * mgChapman(MG_RG / MG_HR, h / MG_HR, mu);
  float odM = MG_HM * mgChapman(MG_RG / MG_HM, h / MG_HM, mu);
  float rO = MG_RG + MG_OZH;
  float s2 = (r / rO) * (r / rO) * (1.0 - mu * mu);
  float odO = r < rO ? MG_OZC / sqrt(max(1.0 - s2, 0.0025)) : (mu > 0.0 ? 0.0 : MG_OZC);
  return exp(-(MG_BR * odR + MG_BME * tM * odM + MG_BO * odO)) * vis;
}
// mgScatter with tM x the aerosol, and a multiple-scattering term mostly lit by the light that reaches each point
// just above its own elevation (reddened at sunset, gone in Earth's shadow), with a quarter of mgScatter's
// day-blue one kept (the blue hour, a blue-grey Earth's shadow). Day skies change little; twilight gets its colours
// and is darker than mgScatter's (about a third from 2 deg below the horizon on, nearer to the real fall-off).
vec3 mgScatterDusk(vec3 d, vec3 L, float I, float tM, out vec3 trans){
  vec3 o = vec3(0.0, MG_RG + ${f1(ATMO.observer)}, 0.0);
  float tEnd = mgSphereFar(o, d, MG_RT);
  float tg = mgSphereNear(o, d, MG_RG);
  if (tg > 0.0) tEnd = tg;
  const int N = 16;
  const float K = 5.0;
  float nu = dot(d, L);
  float pR = mgPhaseR(nu), pM = mgPhaseM(nu, ${f1(ATMO.g)});
  vec3 sum = vec3(0.0), od = vec3(0.0);
  float tPrev = 0.0;
  for (int i = 0; i < N; i++){
    float s = (float(i) + 1.0) / float(N);
    float t = tEnd * (exp(s * K) - 1.0) / (exp(K) - 1.0);
    float dt = t - tPrev;
    float tm = tPrev + 0.5 * dt;
    tPrev = t;
    vec3 p = o + d * tm;
    float r = length(p);
    float h = max(r - MG_RG, 0.0);
    float rhoR = exp(-h / MG_HR), rhoM = exp(-h / MG_HM) * tM;
    float rhoO = max(0.0, 1.0 - abs(h - MG_OZH) / 15000.0);
    vec3 ext = MG_BR * rhoR + MG_BME * rhoM + MG_BO * rhoO;
    vec3 tv = exp(-(od + ext * 0.5 * dt));
    od += ext * dt;
    float muL = dot(p, L) / r;
    vec3 tl = mgTransmitDusk(r, muL, tM);
    vec3 sc = MG_BR * rhoR * pR + MG_BMS * rhoM * pM;
    vec3 iso = (MG_BR * rhoR + MG_BMS * rhoM) * (1.0 / (4.0 * MG_PI));
    vec3 tms = mgTransmitDusk(r, max(muL, 0.0) * 0.9 + 0.04, tM) * smoothstep(-0.08, 0.2, muL)
             + mgTransmitDusk(r, max(muL, 0.0) * 0.7 + 0.3, tM) * smoothstep(-0.2, 0.15, muL) * 0.25;
    sum += tv * (tl * sc + tms * iso * ${f1(ATMO.ms)}) * dt;
  }
  trans = exp(-od);
  return sum * I;
}
vec3 mgSkyAir(vec3 d, vec3 L, out vec3 tr, out float hit){
  hit = mgSphereNear(vec3(0.0, MG_RG + ${f1(ATMO.observer)}, 0.0), d, MG_RG) > 0.0 ? 1.0 : 0.0;
  // at and below the horizon: the horizon's own air (the haze), darker further down
  vec2 az = dot(d.xz, d.xz) > 1e-10 ? normalize(d.xz) : vec2(1.0, 0.0);
  vec3 v = d.y < 0.0015 ? normalize(vec3(az.x, 0.0015, az.y)) : d;
  vec3 col = mgScatterDusk(v, L, uSunI, uDusk.x, tr);
  if (uMoonI > 0.0) { vec3 t2; col += mgScatterDusk(v, normalize(uMoonDir), uMoonI, uDusk.x, t2); }
  // airglow: emitted in a shell ~90 km up, so seen through more of it toward the horizon (van Rhijn), dimmed there
  // by the air below it
  float vr = inversesqrt(max(1.0 - 0.9723 * (1.0 - v.y * v.y), 0.03));
  col += uNightGlow * (0.6 + 0.8 * pow(1.0 - v.y, 3.0) + uDusk.z * 0.3 * (vr - 1.0) * (0.3 + 0.7 * tr.g));
  col *= 1.0 - 0.45 * (1.0 - smoothstep(-0.3, 0.0, d.y));
  if (hit > 0.5) tr = vec3(0.0);
  return col;
}
#else
vec3 mgSkyAir(vec3 d, vec3 L, out vec3 tr, out float hit){
  vec3 col = mgScatter(d, L, uSunI, ${ATMO.ms}, tr, hit);
  if (uMoonI > 0.0) { vec3 t2; float h2; col += mgScatter(d, normalize(uMoonDir), uMoonI, ${ATMO.ms}, t2, h2); }
  col += uNightGlow * (0.6 + 0.8 * pow(1.0 - abs(d.y), 3.0));   // airglow: emitted inside the air, not behind it
  // the ground below the horizon: dark, lit by the light that reaches it
  col += hit * tr * vec3(0.05, 0.045, 0.04) * (uSunI * 0.05 * max(L.y, 0.0) + 0.002);
  return col;
}
#endif`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir, uMoonDir, uNightGlow;
uniform float uSunI, uMoonI, uMoonDisc, uMoonR, uCloudCover, uCapture;
uniform vec2 uCloudOffset;
varying vec3 vDir;
${NOISE_GLSL}
${ATMOSPHERE_GLSL}
${LUT_GLSL}
#ifdef MG_SKY_DUSK
uniform vec3 uHazeCol, uFogGlow;
uniform vec4 uFogL;
uniform float uHazeDen;
vec3 mgSkyZenith(vec3 L){
#ifdef MG_SKY_LUT
  return texture2D(tSkyCol, vec2(0.5, 0.999)).rgb;
#else
  vec3 t; float h; return mgSkyAir(vec3(0.0, 1.0, 0.0), L, t, h);
#endif
}
// altocumulus (p in km on the layer): coverage patches stretched along the wind, puffy cells of two cell-noise
// scales, a little fractal detail. 0 where the patches leave no room for a cell (the cell noise is skipped there).
float mgAcDensity(vec2 p){
  float cov = smoothstep(1.0 - uCloudCover - 0.12, 1.0 - uCloudCover + 0.28, mgFbm2(p * vec2(0.16, 0.28) + 2.0, 4) * 0.5 + 0.5);
  if (cov < 0.29) return 0.0;                       // cov * (puff + detail) <= 1.22 cov stays under 0.36
  vec2 w = vec2(mgGrad2(p * 0.8 + 5.2), mgGrad2(p * 0.8 + 1.3)) * 0.22;
  float puff = (1.0 - mgCell2(p * 2.4 + w * 2.0).x * 1.2) * 0.72 + (1.0 - mgCell2(p * 6.3 + w * 5.0 + 9.0).x) * 0.38;
  float detail = mgFbm2(p * 11.0 + w * 4.0, 2) * 0.12;
  return clamp((cov * (puff + detail) - 0.36) * 2.6, 0.0, 1.0);
}
#endif
#ifdef MG_SKY_STORM
uniform vec4 uStorm;
uniform float uStormSpeed;
uniform vec3 uStormBase, uFlash, uFlashDir;
// a low rain deck (500 m) over the dome: dark masses and paler thin parts lit from below by the city, scud drifting
// faster than the deck, curtains of rain at the horizon, a bright horizon band, the lightning inside it
vec3 mgStorm(vec3 d, vec3 col){
  float y = max(d.y, 0.0);
  vec2 p = d.xz / (y + 0.1) * 0.9 + uCloudOffset * uStormSpeed;
  float c1 = mgFbm2(p * 0.45, 5) * 0.5 + 0.5;
  float c2 = mgFbm2(p * 1.6 + uCloudOffset * uStormSpeed * 4.0 + c1 * 1.2, 4) * 0.5 + 0.5;
  float dens = smoothstep(0.3, 0.78, c1 * 0.75 + c2 * 0.4);
  // lit from below: the thin parts pale, the masses dark; the band at the horizon the brightest (the city's glow
  // seen through the most air)
  vec3 deck = uStormBase * uStorm.y * mix(1.25, 0.42, dens) * (0.85 + 0.3 * smoothstep(0.4, 0.8, c2));
  float hz = exp(-y * 9.0);
  deck = mix(deck, uStormBase * uStorm.z, hz * 0.85);
  float az = atan(d.z, d.x);
  float cur = smoothstep(0.4, 0.9, mgFbm2(vec2(az * 3.0, y * 2.0) + uCloudOffset * uStormSpeed * 2.0, 3) * 0.5 + 0.5);
  deck *= 1.0 - cur * 0.3 * exp(-y * 5.0);
  // the lightning lights the deck from inside: brightest round the strike, the thin parts glow the most
  float ang = max(dot(d, normalize(uFlashDir)), 0.0);
  float near = pow(ang, 24.0) * 2.2 + pow(ang, 4.0) * 0.45 + 0.08;
  deck += uFlash * uStorm.w * near * (0.35 + 0.8 * (1.0 - dens) + 0.3 * c2);
  // over the dome above the horizon (the ground's haze below it stays the world's)
  return mix(col, deck, uStorm.x * smoothstep(-0.02, 0.02, d.y));
}
#endif
void main(){
  vec3 d = normalize(vDir);
  vec3 L = normalize(uSunDir);
  vec3 tr; float hit;
#ifdef MG_SKY_LUT
  vec2 luv = mgSkyUV(d);
  vec4 S = texture2D(tSkyCol, luv);
  vec3 col = S.rgb; hit = S.a; tr = texture2D(tSkyTr, luv).rgb;
#else
  vec3 col = mgSkyAir(d, L, tr, hit);
#endif
  if (uCapture < 0.5 && hit < 0.5) {
    // sun disc (0.27 deg) with limb darkening
    float a = acos(clamp(dot(d, L), -1.0, 1.0)), R = 0.0047;
    float disc = 1.0 - smoothstep(R - fwidth(a), R, a);
    col += disc * tr * uSunI * 1500.0 * (0.4 + 0.6 * sqrt(max(1.0 - (a / R) * (a / R), 0.0)));
    // the Moon: a sphere lit from the Sun's direction (phase), mottled maria
    vec3 M = normalize(uMoonDir);
    float cm = dot(d, M);
    if (uMoonDisc > 0.0 && cm > cos(uMoonR * 1.2)) {
      vec3 q = (d - M * cm) / sin(uMoonR);
      float r2 = dot(q, q);
      float inside = 1.0 - smoothstep(1.0 - 2.0 * fwidth(r2), 1.0, r2);
      vec3 n = q - M * sqrt(max(1.0 - r2, 0.0));
      float lit = smoothstep(-0.03, 0.05, dot(n, L));
      float maria = 0.72 + 0.28 * smoothstep(-0.2, 0.4, mgFbm2(q.xy * 2.3 + 4.0, 4));
      col += inside * tr * uMoonDisc * maria * (lit + 0.004);
    }
  }
#ifdef MG_SKY_DUSK
  // altocumulus at 2.5 km, lit by the Sun (by the Moon once the Sun is 4 deg down) through the atmosphere,
  // self-shadowed by four taps toward the light, forward / back scattering, powder, a silver lining
  if (d.y > 0.003 && uCloudCover > 0.0) {
    float tc = 2.5 / d.y;                                   // km to the layer
    vec2 p = d.xz * tc + uCloudOffset;
    float den = mgAcDensity(p);
    if (den > 0.001) {
      bool sunLit = L.y > -0.07;
      vec3 CL = sunLit ? L : normalize(uMoonDir);
      float I = sunLit ? uSunI : uMoonI;
      vec2 sd = normalize(CL.xz + 1e-5);
      float od = mgAcDensity(p + sd * 0.06) * 0.6 + mgAcDensity(p + sd * 0.16) + mgAcDensity(p + sd * 0.34) + mgAcDensity(p + sd * 0.65) * 0.8;
      float shadow = exp(-od * 1.15);
      vec3 tl = mgTransmit(MG_RG + 2500.0, CL.y, 1.0) * vec3(1.0, 0.9, 0.78);
      float mu = dot(d, CL);
      float hg1 = 0.5775 / pow(1.4225 - 1.3 * mu, 1.5), hg2 = 0.96 / pow(1.04 + 0.4 * mu, 1.5);   // g = 0.65, -0.2
      float phase = (hg1 + hg2) * 0.5 / (4.0 * MG_PI);
      float powder = 1.0 - exp(-den * 3.0);
      vec3 lit = tl * I * 0.16 * (phase * 7.0 + 0.3) * (shadow * 0.9 + 0.1) * (0.4 + 0.6 * powder);
      lit += tl * I * 0.3 * pow(max(mu, 0.0), 10.0) * (1.0 - den);
      vec3 cc = lit + (mgSkyZenith(L) * 0.95 + col * 0.2) * (0.35 + 0.5 * (1.0 - den));
      float alpha = smoothstep(0.0, 0.55, den);
      // without sunlight the layer is seen against the night sky: lit by it, thinner
      float cn = 1.0 - smoothstep(-0.1, 0.035, L.y);
      cc = mix(cc, max(cc, col * 0.85), cn);
      alpha *= (1.0 - 0.55 * cn) * smoothstep(0.003, 0.06, d.y);
      col = mix(col, mix(col, cc, exp(-tc / 52.0)), alpha);
    }
  }
  // night: the dome as the night-adapted eye sees it, darker than the light it gives (captures keep it as lit)
  if (uCapture < 0.5) col *= mix(1.0, uDusk.y, 1.0 - smoothstep(-0.17, -0.035, L.y));
  // below the horizon, where no ground reaches: what the world's haze makes of far ground (fog.js at infinity)
  if (uHazeDen > 0.0 && d.y < 0.0) {
    float g = uFogL.w, hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * dot(d, uFogL.xyz), 1e-4), 1.5);
    col = mix(col, uHazeCol + uFogGlow * min(hg * 0.25, 6.0), smoothstep(0.0, 0.03, -d.y));
  }
#else
  // clouds: one layer at 2.5 km, coverage from fractal noise, lit through the atmosphere
  if (d.y > 0.01 && uCloudCover > 0.0) {
    vec2 p = d.xz / d.y * 2.5 + uCloudOffset;             // km on the layer
    float n = mgFbm2(p * 0.42, 5) * 0.5 + 0.5;
    float den = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, n);
    if (den > 0.001) {
      vec3 CL = uSunI > 0.0 ? L : normalize(uMoonDir);
      float I = uSunI > 0.0 ? uSunI : uMoonI;
      float toward = mgFbm2((p + CL.xz * 0.25) * 0.42, 4) * 0.5 + 0.5;
      float shade = exp(-2.2 * smoothstep(1.0 - uCloudCover, 1.0, toward));
      vec3 tl = mgTransmit(MG_RG + 2500.0, CL.y, 1.0);
      float nu = dot(d, CL);
      float ph = mix(mgPhaseM(nu, 0.6), 1.0 / (4.0 * MG_PI), 0.5);
      vec3 lit = tl * I * (0.25 * ph * (0.25 + 0.75 * shade) + 0.012 * shade);
      vec3 amb = col * 0.55 + uNightGlow * 0.5;
      vec3 cc = lit + amb;
      float alpha = den * smoothstep(0.01, 0.12, d.y) * 0.92;
      col = mix(col, mix(col, cc, exp(-length(d.xz / d.y) * 0.05)), alpha);
    }
  }
#endif
#ifdef MG_SKY_STORM
  if (uStorm.x > 0.0) col = mgStorm(d, col);
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.999999; }',
    fragmentShader: FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  if (uniforms.tSkyCol && uniforms.tSkyCol.value) mat.defines = { MG_SKY_LUT: '' };
  if (uniforms.uDusk) mat.defines = { ...mat.defines, MG_SKY_DUSK: '' };
  if (uniforms.uStorm) mat.defines = { ...mat.defines, MG_SKY_STORM: '' };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = 1000;   // after opaques: only uncovered pixels pay for the sky
  const haze = uniforms.uHazeCol ? uniforms : null, st = uniforms.uStormBase ? uniforms : null;
  sky.onBeforeRender = (r, s, cam) => {
    sky.position.setFromMatrixPosition(cam.matrixWorld); sky.updateMatrixWorld();
    if (st && s.fog && s.fog.color) st.uStormBase.value.copy(s.fog.color);
    if (haze) { const f = s.fog, on = !!(f && f.isFogExp2 && f.density > 0); haze.uHazeDen.value = on ? f.density : 0; if (on) haze.uHazeCol.value.copy(f.color); }
  };
  return sky;
}

/** Bake the air of the sky dome into two direction tables (see LUT_GLSL) and point `uniforms` at them. Call before
 *  createSky(uniforms); call bake() whenever the Sun, Moon or night glow uniforms change (world.setTime does). */
export function createSkyLut(renderer, uniforms, { width = 512, height = 256 } = {}) {
  const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping };
  const col = new THREE.WebGLRenderTarget(width, height, opts), tr = new THREE.WebGLRenderTarget(width, height, opts);
  uniforms.tSkyCol = { value: col.texture };
  uniforms.tSkyTr = { value: tr.texture };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uOut: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform vec3 uSunDir, uMoonDir, uNightGlow;
      uniform float uSunI, uMoonI, uOut;
      varying vec2 vUv;
      ${ATMOSPHERE_GLSL}
      ${LUT_GLSL}
      void main(){
        vec3 tr; float hit;
        vec3 c = mgSkyAir(mgSkyDir(vUv), normalize(uSunDir), tr, hit);
        gl_FragColor = uOut < 0.5 ? vec4(c, hit) : vec4(tr, 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
    ...(uniforms.uDusk ? { defines: { MG_SKY_DUSK: '' } } : {}),
  });
  const quad = new FullScreenQuad(mat);
  return {
    bake() {
      const saved = renderer.getRenderTarget(), xr = renderer.xr && renderer.xr.enabled;
      if (renderer.xr) renderer.xr.enabled = false;
      for (const [k, t] of [[0, col], [1, tr]]) { mat.uniforms.uOut.value = k; renderer.setRenderTarget(t); quad.render(renderer); }
      renderer.setRenderTarget(saved);
      if (renderer.xr) renderer.xr.enabled = xr;
    },
    dispose() { col.dispose(); tr.dispose(); mat.dispose(); quad.dispose(); },
  };
}
