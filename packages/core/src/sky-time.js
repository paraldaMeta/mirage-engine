// Mirage — adapted from the author's own project.
// ---------------------------------------------------------------------------
// The real sky over any place for any instant: the Sun, the Moon (position, phase, distance) and the rotation
// of the starry sky (local sidereal time), in the engine's frame (+x east, +y up, +z south).
//
// Pure JavaScript, no three.js: the same functions run in the page, in node and in
// a host program.
//
//   skyAt(date, { lat, lon, height })   -> {
//       sun:  { dir: [x, y, z], elevation, azimuth, elevationTrue, ra, dec, distanceAU, lambda }
//       moon: { dir, elevation, azimuth, elevationTrue, ra, dec, distanceKm, lambda, beta,
//               phaseAngle, illumination (0..1 lit fraction), waxing, elongation, angularRadius }
//       lst:  local sidereal time (degrees),
//       eqToWorld: 3x3 row-major (Float64Array 9) taking an equatorial unit vector (J2000-ish; x toward
//                  RA 0 / Dec 0, y toward RA 90°, z the north celestial pole) into the engine frame
//     }
//   placeDate('2026-10-24', '17:30', 9) -> Date for a local wall-clock time at a fixed UTC offset (hours)
//   placeClock(date, 9)                 -> { day, time, hours } of that local clock
//
// Elevations and azimuths are in degrees; azimuth is a compass bearing (0 north, 90 east). `elevation` is the
// apparent one (refraction added, topocentric for the Moon), `elevationTrue` the geometric one. `dir` points
// toward the body along the apparent direction.
//
// Algorithms: Sun after NOAA / Meeus ch. 25 (low precision, about 0.01°); Moon after Meeus ch. 47 with the
// largest periodic terms (about 0.02° in longitude), topocentric parallax after Meeus ch. 40; sidereal time
// Meeus ch. 12; refraction Saemundsson / Bennett. ΔT is taken as 69 s.
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const DELTA_T = 69.2; // seconds, TT - UTC (2020s)
const norm360 = (a) => ((a % 360) + 360) % 360;
const sind = (a) => Math.sin(a * RAD), cosd = (a) => Math.cos(a * RAD);

export function julianDay(date) { return date.getTime() / 86400000 + 2440587.5; }

/** Greenwich mean sidereal time (degrees), Meeus 12.4. */
export function gmst(date) {
  const jd = julianDay(date);
  const T = (jd - 2451545.0) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000);
}

// nutation in longitude and obliquity (degrees), the four largest terms (Meeus ch. 22)
function nutation(T) {
  const om = 125.04452 - 1934.136261 * T, L = 280.4665 + 36000.7698 * T, Lp = 218.3165 + 481267.8813 * T;
  const dpsi = (-17.2 * sind(om) - 1.32 * sind(2 * L) - 0.23 * sind(2 * Lp) + 0.21 * sind(2 * om)) / 3600;
  const deps = (9.2 * cosd(om) + 0.57 * cosd(2 * L) + 0.1 * cosd(2 * Lp) - 0.09 * cosd(2 * om)) / 3600;
  const eps0 = 23 + 26 / 60 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 3600;
  return { dpsi, eps: eps0 + deps };
}

function eclToEq(lambda, beta, eps) {
  const l = lambda * RAD, b = beta * RAD, e = eps * RAD;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra: norm360(ra * DEG), dec: dec * DEG };
}

/** Apparent geocentric Sun (Meeus ch. 25, low precision): lambda, ra, dec (degrees), distance (AU). */
export function sunEquatorial(date) {
  const T = (julianDay(date) + DELTA_T / 86400 - 2451545.0) / 36525;
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - T * 0.0001537);
  const e = 0.016708634 - T * (0.000042037 + T * 0.0000001267);
  const C = sind(M) * (1.914602 - T * (0.004817 + T * 0.000014)) + sind(2 * M) * (0.019993 - T * 0.000101) + sind(3 * M) * 0.000289;
  const trueLon = L0 + C, v = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cosd(v));
  const om = 125.04 - 1934.136 * T;
  const lambda = norm360(trueLon - 0.00569 - 0.00478 * sind(om));
  const eps = nutation(T).eps; // mean obliquity + Δε (NOAA: ε0 + 0.00256° cos Ω)
  const { ra, dec } = eclToEq(lambda, 0, eps);
  return { lambda, ra, dec, distanceAU: R, eps };
}

// Meeus table 47.A (largest terms): [D, M, M', F, Σl (1e-6 deg), Σr (1e-3 km)]
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
// Meeus table 47.B (largest terms): [D, M, M', F, Σb (1e-6 deg)]
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833], [0, 0, 1, -3, 777], [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607], [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421], [2, 1, -1, 1, -366],
];

/** Apparent geocentric Moon (Meeus ch. 47): lambda, beta, ra, dec (degrees), distance (km). */
export function moonEquatorial(date) {
  const T = (julianDay(date) + DELTA_T / 86400 - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
  const F = norm360(93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += l * e * sind(arg); sr += r * e * cosd(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += b * e * sind(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * sind(A1) + 1962 * sind(Lp - F) + 318 * sind(A2);
  sb += -2235 * sind(Lp) + 382 * sind(A3) + 175 * sind(A1 - F) + 175 * sind(A1 + F) + 127 * sind(Lp - Mp) - 115 * sind(Lp + Mp);
  const nu = nutation(T);
  const lambda = norm360(Lp + sl / 1e6 + nu.dpsi), beta = sb / 1e6;
  const distanceKm = 385000.56 + sr / 1000;
  const { ra, dec } = eclToEq(lambda, beta, nu.eps);
  return { lambda, beta, ra, dec, distanceKm, eps: nu.eps };
}

// atmospheric refraction (degrees) to add to a geometric altitude (Saemundsson, with Bennett's form below)
export function refraction(alt) {
  if (alt < -2) return 0;
  const a = Math.max(alt, -1.9);
  return 1.02 / Math.tan((a + 10.3 / (a + 5.11)) * RAD) / 60;
}

function horizontal(ra, dec, lst, lat) {
  const H = (lst - ra) * RAD, d = dec * RAD, p = lat * RAD;
  const up = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H);
  const north = Math.cos(p) * Math.sin(d) - Math.sin(p) * Math.cos(d) * Math.cos(H);
  const east = -Math.cos(d) * Math.sin(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, up))) * DEG;
  const az = norm360(Math.atan2(east, north) * DEG);
  return { alt, az };
}

/** Engine-frame unit vector (+x east, +y up, +z south) from an altitude and a compass azimuth (degrees). */
export function dirFromAltAz(alt, az) {
  const ca = cosd(alt);
  return [ca * sind(az), sind(alt), -ca * cosd(az)];
}

/** Equatorial -> engine frame rotation (row-major 3x3) for a local sidereal time and latitude (degrees). */
export function equatorialToWorld(lstDeg, latDeg) {
  const st = sind(lstDeg), ct = cosd(lstDeg), sp = sind(latDeg), cp = cosd(latDeg);
  return new Float64Array([
    -st, ct, 0,
    cp * ct, cp * st, sp,
    sp * ct, sp * st, -cp,
  ]);
}

/** Sun, Moon and sidereal rotation for `date` at `place` = { lat, lon (degrees, east +), height (m) }. */
export function skyAt(date, place) {
  const lat = place.lat, lon = place.lon, hM = place.height ?? 0;
  const lst = norm360(gmst(date) + lon);

  const S = sunEquatorial(date);
  const sh = horizontal(S.ra, S.dec, lst, lat);
  // the Sun's parallax (8.8") is far below this model's precision; refraction lifts it near the horizon
  const sunEl = sh.alt + refraction(sh.alt);
  const sun = { ...S, elevationTrue: sh.alt, elevation: sunEl, azimuth: sh.az, dir: dirFromAltAz(sunEl, sh.az) };

  const Mo = moonEquatorial(date);
  // topocentric place (Meeus ch. 40): the Moon stands up to ~1° lower than its geocentric place
  const u = Math.atan(0.99664719 * Math.tan(lat * RAD));
  const rs = 0.99664719 * Math.sin(u) + (hM / 6378140) * Math.sin(lat * RAD);
  const rc = Math.cos(u) + (hM / 6378140) * Math.cos(lat * RAD);
  const sinPi = 6378.14 / Mo.distanceKm;
  const H = (lst - Mo.ra) * RAD, d = Mo.dec * RAD;
  const dA = Math.atan2(-rc * sinPi * Math.sin(H), Math.cos(d) - rc * sinPi * Math.cos(H));
  const decT = Math.atan2((Math.sin(d) - rs * sinPi) * Math.cos(dA), Math.cos(d) - rc * sinPi * Math.cos(H)) * DEG;
  const raT = norm360(Mo.ra + dA * DEG);
  const mh = horizontal(raT, decT, lst, lat);
  const moonEl = mh.alt + refraction(mh.alt);
  // phase (Meeus ch. 48): elongation from the Sun, phase angle, lit fraction
  const cosPsi = Math.cos(Mo.beta * RAD) * Math.cos((Mo.lambda - S.lambda) * RAD);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const Rkm = S.distanceAU * 149597870.7;
  const i = Math.atan2(Rkm * Math.sin(psi), Mo.distanceKm - Rkm * Math.cos(psi));
  const moon = {
    ...Mo, ra: raT, dec: decT, raGeo: Mo.ra, decGeo: Mo.dec,
    elevationTrue: mh.alt, elevation: moonEl, azimuth: mh.az, dir: dirFromAltAz(moonEl, mh.az),
    elongation: psi * DEG, phaseAngle: i * DEG, illumination: (1 + Math.cos(i)) / 2,
    waxing: norm360(Mo.lambda - S.lambda) < 180,
    angularRadius: Math.asin(1737.4 / Mo.distanceKm) * DEG,
  };
  return { date: new Date(date.getTime()), place: { lat, lon, height: hM }, sun, moon, lst, eqToWorld: equatorialToWorld(lst, lat) };
}

/** A Date for a local wall-clock time at a fixed UTC offset. `day` 'YYYY-MM-DD', `time` 'HH:MM[:SS]'.
 *  ponytail: fixed offset, no daylight-saving rules; pass the offset that applies on that day. */
export function placeDate(day, time = '12:00', tzHours = 0) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0) - tzHours * 3600000);
}

/** Local wall-clock parts of a Date at a fixed UTC offset: { day: 'YYYY-MM-DD', time: 'HH:MM', hours }. */
export function placeClock(date, tzHours = 0) {
  const t = new Date(date.getTime() + tzHours * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  const day = `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
  return { day, time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`, hours: t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600 };
}
