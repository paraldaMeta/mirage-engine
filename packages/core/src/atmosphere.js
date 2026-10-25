// Mirage original code. Techniques informed by Golden Temple by Leon Lin (MIT) — see NOTICE.
// ---------------------------------------------------------------------------
// The atmosphere model shared by the sky dome (GLSL) and the light computations on the CPU (JavaScript twin
// with the same constants and the same quadrature, so the light colours match what the sky shows).
//
// Model: a spherical planet (6360 km) under a 100 km atmosphere with Rayleigh and Mie scattering (exponential
// densities, scale heights 8 km / 1.2 km) and an ozone shell (tent profile at 25 km). Optical depth toward
// the light is analytic: Schüler's approximation of the Chapman grazing-incidence function for the two
// exponential layers, a slant-path factor for the ozone shell (no inner march). The view ray is marched in
// 16 exponentially spaced steps. Multiple scattering is approximated by an isotropic term proportional to the
// local single-scattering coefficient and the light reaching that point (tunable: `ms`).
//
// Units: metres; radiance in the renderer's linear HDR units (source "irradiance" = sunI).
// ---------------------------------------------------------------------------

export const ATMO = {
  Rg: 6360e3, Rt: 6460e3,
  betaR: [5.802e-6, 13.558e-6, 33.1e-6], HR: 8000,
  betaMs: 3.996e-6, betaMe: 4.44e-6, HM: 1200, g: 0.8,
  betaO: [0.65e-6, 1.881e-6, 0.085e-6], ozoneH: 25000, ozoneColumn: 15000,
  observer: 2,          // eye height above the ground for the sky dome (m)
  ms: 0.5,              // isotropic multiple-scattering factor
};

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = (a) => `vec3(${a.map((x) => x.toExponential(4)).join(', ')})`;

export const ATMOSPHERE_GLSL = /* glsl */ `
#ifndef MG_ATMOSPHERE
#define MG_ATMOSPHERE
const float MG_RG = ${f(ATMO.Rg)};
const float MG_RT = ${f(ATMO.Rt)};
const vec3  MG_BR = ${v3(ATMO.betaR)};
const float MG_HR = ${f(ATMO.HR)};
const float MG_BMS = ${ATMO.betaMs.toExponential(4)};
const float MG_BME = ${ATMO.betaMe.toExponential(4)};
const float MG_HM = ${f(ATMO.HM)};
const vec3  MG_BO = ${v3(ATMO.betaO)};
const float MG_OZH = ${f(ATMO.ozoneH)};
const float MG_OZC = ${f(ATMO.ozoneColumn)};
const float MG_PI = 3.14159265359;

// Chapman function times the density at the start: optical-depth factor (in scale heights) toward infinity
float mgChapman(float X, float h, float mu){
  float c = sqrt(X + h);
  if (mu >= 0.0) return c / (c * mu + 1.0) * exp(-h);
  float x0 = sqrt(1.0 - mu * mu) * (X + h);
  return 2.0 * sqrt(x0) * exp(min(X - x0, 60.0)) - c / (1.0 - c * mu) * exp(-h);
}
// transmittance from radius r toward a light at cosine mu from the local zenith; k scales the optical depth
vec3 mgTransmit(float r, float mu, float k){
  float muH = -sqrt(max(1.0 - (MG_RG * MG_RG) / (r * r), 0.0));
  float vis = smoothstep(muH - 0.006, muH + 0.006, mu);
  if (vis <= 0.0) return vec3(0.0);
  float h = max(r - MG_RG, 0.0);
  float odR = MG_HR * mgChapman(MG_RG / MG_HR, h / MG_HR, mu);
  float odM = MG_HM * mgChapman(MG_RG / MG_HM, h / MG_HM, mu);
  float rO = MG_RG + MG_OZH;
  float s2 = (r / rO) * (r / rO) * (1.0 - mu * mu);
  float odO = r < rO ? MG_OZC / sqrt(max(1.0 - s2, 0.0025)) : (mu > 0.0 ? 0.0 : MG_OZC);
  return exp(-k * (MG_BR * odR + MG_BME * odM + MG_BO * odO)) * vis;
}
float mgPhaseR(float nu){ return 3.0 / (16.0 * MG_PI) * (1.0 + nu * nu); }
float mgPhaseM(float nu, float g){ float g2 = g * g; return 3.0 / (8.0 * MG_PI) * (1.0 - g2) * (1.0 + nu * nu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * nu, 1e-4), 1.5)); }
// distance along a unit ray from o (|o| = r) to the sphere of radius R (far root), < 0 if missed
float mgSphereFar(vec3 o, vec3 d, float R){ float b = dot(o, d), c = dot(o, o) - R * R, q = b * b - c; return q < 0.0 ? -1.0 : -b + sqrt(q); }
float mgSphereNear(vec3 o, vec3 d, float R){ float b = dot(o, d), c = dot(o, o) - R * R, q = b * b - c; return q < 0.0 ? -1.0 : -b - sqrt(q); }

// In-scattered radiance along the view ray d from the observer for a light of strength I in direction L.
// Returns the radiance; trans = transmittance of the whole ray; hit = 1 when the ray ends on the ground.
vec3 mgScatter(vec3 d, vec3 L, float I, float ms, out vec3 trans, out float hit){
  vec3 o = vec3(0.0, MG_RG + ${f(ATMO.observer)}, 0.0);
  float tEnd = mgSphereFar(o, d, MG_RT);
  float tg = mgSphereNear(o, d, MG_RG);
  hit = tg > 0.0 ? 1.0 : 0.0;
  if (tg > 0.0) tEnd = tg;
  const int N = 16;
  const float K = 5.0;
  float nu = dot(d, L);
  float pR = mgPhaseR(nu), pM = mgPhaseM(nu, ${f(ATMO.g)});
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
    float rhoR = exp(-h / MG_HR), rhoM = exp(-h / MG_HM);
    float rhoO = max(0.0, 1.0 - abs(h - MG_OZH) / 15000.0);
    vec3 ext = MG_BR * rhoR + MG_BME * rhoM + MG_BO * rhoO;
    vec3 tv = exp(-(od + ext * 0.5 * dt));
    od += ext * dt;
    float muL = dot(p, L) / r;
    vec3 tl = mgTransmit(r, muL, 1.0);
    vec3 sc = MG_BR * rhoR * pR + MG_BMS * rhoM * pM;
    vec3 iso = (MG_BR * rhoR + MG_BMS * rhoM) * (1.0 / (4.0 * MG_PI));
    vec3 tms = mgTransmit(r, max(muL, 0.0) * 0.7 + 0.3, 1.0) * smoothstep(-0.2, 0.15, muL);
    sum += tv * (tl * sc + tms * iso * ms) * dt;
  }
  trans = exp(-od);
  return sum * I;
}
#endif
`;

// ------------------------------------------------------------------ JavaScript twin
const A = ATMO;
function chapman(X, h, mu) {
  const c = Math.sqrt(X + h);
  if (mu >= 0) return (c / (c * mu + 1)) * Math.exp(-h);
  const x0 = Math.sqrt(1 - mu * mu) * (X + h);
  return 2 * Math.sqrt(x0) * Math.exp(Math.min(X - x0, 60)) - (c / (1 - c * mu)) * Math.exp(-h);
}
const sstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/** Transmittance (RGB) from radius r toward a light at cosine mu from the zenith; k scales the optical depth. */
export function transmit(r, mu, k = 1) {
  const muH = -Math.sqrt(Math.max(1 - (A.Rg * A.Rg) / (r * r), 0));
  const vis = sstep(muH - 0.006, muH + 0.006, mu);
  if (vis <= 0) return [0, 0, 0];
  const h = Math.max(r - A.Rg, 0);
  const odR = A.HR * chapman(A.Rg / A.HR, h / A.HR, mu), odM = A.HM * chapman(A.Rg / A.HM, h / A.HM, mu);
  const rO = A.Rg + A.ozoneH, s2 = (r / rO) ** 2 * (1 - mu * mu);
  const odO = r < rO ? A.ozoneColumn / Math.sqrt(Math.max(1 - s2, 0.0025)) : mu > 0 ? 0 : A.ozoneColumn;
  return [0, 1, 2].map((i) => Math.exp(-k * (A.betaR[i] * odR + A.betaMe * odM + A.betaO[i] * odO)) * vis);
}
/** Transmittance of sunlight at the ground for a body at `elevation` degrees. */
export function transmitAtGround(elevationDeg, k = 1) {
  return transmit(A.Rg + A.observer, Math.sin((elevationDeg * Math.PI) / 180), k);
}

const phaseR = (nu) => (3 / (16 * Math.PI)) * (1 + nu * nu);
const phaseM = (nu, g) => { const g2 = g * g; return ((3 / (8 * Math.PI)) * (1 - g2) * (1 + nu * nu)) / ((2 + g2) * Math.pow(Math.max(1 + g2 - 2 * g * nu, 1e-4), 1.5)); };
function sphere(o, d, R, near) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - R * R, q = b * b - c;
  if (q < 0) return -1;
  return near ? -b - Math.sqrt(q) : -b + Math.sqrt(q);
}

/** Sky radiance (RGB) toward unit direction d for a light of strength I at unit direction L (same as the shader). */
export function scatter(d, L, I, ms = A.ms) {
  const o = [0, A.Rg + A.observer, 0];
  let tEnd = sphere(o, d, A.Rt, false);
  const tg = sphere(o, d, A.Rg, true);
  if (tg > 0) tEnd = tg;
  const N = 16, K = 5, nu = d[0] * L[0] + d[1] * L[1] + d[2] * L[2];
  const pR = phaseR(nu), pM = phaseM(nu, A.g);
  const sum = [0, 0, 0], od = [0, 0, 0];
  let tPrev = 0;
  for (let i = 0; i < N; i++) {
    const s = (i + 1) / N, t = (tEnd * (Math.exp(s * K) - 1)) / (Math.exp(K) - 1), dt = t - tPrev, tm = tPrev + 0.5 * dt;
    tPrev = t;
    const p = [o[0] + d[0] * tm, o[1] + d[1] * tm, o[2] + d[2] * tm];
    const r = Math.hypot(p[0], p[1], p[2]), h = Math.max(r - A.Rg, 0);
    const rhoR = Math.exp(-h / A.HR), rhoM = Math.exp(-h / A.HM), rhoO = Math.max(0, 1 - Math.abs(h - A.ozoneH) / 15000);
    const muL = (p[0] * L[0] + p[1] * L[1] + p[2] * L[2]) / r;
    const tl = transmit(r, muL), tms = transmit(r, Math.max(muL, 0) * 0.7 + 0.3), w = sstep(-0.2, 0.15, muL);
    for (let k = 0; k < 3; k++) {
      const ext = A.betaR[k] * rhoR + A.betaMe * rhoM + A.betaO[k] * rhoO;
      const tv = Math.exp(-(od[k] + ext * 0.5 * dt));
      od[k] += ext * dt;
      const sc = A.betaR[k] * rhoR * pR + A.betaMs * rhoM * pM;
      const iso = (A.betaR[k] * rhoR + A.betaMs * rhoM) / (4 * Math.PI);
      sum[k] += tv * (tl[k] * sc + tms[k] * w * iso * ms) * dt;
    }
  }
  return sum.map((v) => v * I);
}

/** Horizontal irradiance from the sky dome (RGB) and the mean horizon radiance, for a light at elevation e
 *  (degrees, azimuth irrelevant for the irradiance) of strength I. Cached per 0.25°. */
const CACHE = new Map();
export function skyLightAt(elevationDeg, I = 1) {
  const key = Math.round(elevationDeg * 4);
  let v = CACHE.get(key);
  if (!v) {
    const e = (key / 4) * (Math.PI / 180);
    const L = [0, Math.sin(e), -Math.cos(e)];
    const E = [0, 0, 0], hz = [0, 0, 0], hzToward = scatter([0, 0.035, -0.9994], L, 1), hzAway = scatter([0, 0.035, 0.9994], L, 1);
    const rings = [5, 15, 27, 40, 55, 72, 86];
    for (let ri = 0; ri < rings.length; ri++) {
      const a = (rings[ri] * Math.PI) / 180;
      const a0 = ri === 0 ? 0 : ((rings[ri - 1] + rings[ri]) / 2) * (Math.PI / 180);
      const a1 = ri === rings.length - 1 ? Math.PI / 2 : ((rings[ri] + rings[ri + 1]) / 2) * (Math.PI / 180);
      // solid-angle weight of the ring times cos(zenith): integral of sin(alt) cos(alt) d alt d az
      const w = ((Math.sin(a1) ** 2 - Math.sin(a0) ** 2) / 2) * ((2 * Math.PI) / 8);
      for (let k = 0; k < 8; k++) {
        const az = ((k + 0.5) / 8) * Math.PI * 2;
        const d = [Math.cos(a) * Math.sin(az), Math.sin(a), -Math.cos(a) * Math.cos(az)];
        const c = scatter(d, L, 1);
        for (let i = 0; i < 3; i++) E[i] += c[i] * w;
      }
    }
    for (let k = 0; k < 8; k++) { const az = ((k + 0.5) / 8) * Math.PI * 2; const c = scatter([0.999 * Math.sin(az), 0.035, -0.999 * Math.cos(az)], L, 1); for (let i = 0; i < 3; i++) hz[i] += c[i] / 8; }
    v = { E, hz, hzToward, hzAway, zenith: scatter([0, 1, 0], L, 1) };
    CACHE.set(key, v);
  }
  const m = (a) => a.map((x) => x * I);
  return { E: m(v.E), hz: m(v.hz), hzToward: m(v.hzToward), hzAway: m(v.hzAway), zenith: m(v.zenith) };
}
