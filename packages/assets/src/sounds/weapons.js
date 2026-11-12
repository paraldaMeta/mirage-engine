// Mirage original code. The weapons of the sound library (@miragekit/assets/sounds): guns, their mechanics, casings,
// impacts and blasts, synthesised offline into sample buffers. A shot is built from layers, the way a recorded gunshot
// is made of parts:
//   transient  a few ms of broadband noise through a high band: the supersonic snap
//   crack      a band-passed noise burst with a fast decay: the muzzle blast's bark
//   thump      a sine that drops in pitch (about 150 -> 50 Hz): the weight in the chest
//   mech       short metallic resonances: the slide, the bolt, the pump
//   body       low-passed noise with a slower decay: the boom's mass
// then a tail by where the shooter stands: 'alley' a tight slapback off two close walls, 'open' a long diffuse tail
// with late reflections off far facades, 'indoor' a short boxy room. Light saturation, then a look-ahead peak
// limiter, so the summed layers never clip. Every sound has variants: about +-3 % pitch, +-1 dB and up to 1.5 ms of
// jitter between layers. Grown out of examples/neon-district.
import { TAU, makeRng, hash, biquad, chain, noiseLayer, thumpLayer, modesLayer, ROOMS as ROOM, room, master, one, click, scrape } from '@miragekit/game/sounds';

export const ENVS = ['alley', 'open', 'indoor'];
export const GUNS = ['pistol', 'carbine', 'shotgun'];

// ---- the guns ------------------------------------------------------------------------------------------------
// per gun: the layers' parameters (frequencies in Hz, times in s); `p` scales every frequency (the variant's pitch)
const SPEC = {
  // snappy: bright, short, a slide that slams back at 18 ms
  pistol: { dry: 0.32, drive: 1.2,
    layers: (o, SR, R, p, j) => {
      noiseLayer(o, SR, R, 0, 0.012, chain(biquad('hp', 3800 * p, 0.7, SR), biquad('hp', 3800 * p, 0.7, SR)), 0.0002, 0.0018, 1.1);
      noiseLayer(o, SR, R, j(), 0.08, chain(biquad('bp', 2300 * p, 0.9, SR), biquad('peak', 4200 * p, 1, SR, 4)), 0.0004, 0.009, 1.5);
      thumpLayer(o, SR, j(), 175 * p, 62 * p, 0.02, 0.0008, 0.045, 0.75);
      noiseLayer(o, SR, R, j(), 0.25, biquad('lp', 950 * p, 0.7, SR), 0.0012, 0.045, 0.9);
      modesLayer(o, SR, R, 0.018 + j(), [[2950 * p, 0.012, 0.32], [4380 * p, 0.008, 0.22], [1720 * p, 0.02, 0.16]], 0.55);
    } },
  // cracking: a harder, longer bark with a second, lower crack and the bolt's ring
  carbine: { dry: 0.4, drive: 1.5,
    layers: (o, SR, R, p, j) => {
      noiseLayer(o, SR, R, 0, 0.012, chain(biquad('hp', 4600 * p, 0.7, SR), biquad('hp', 4600 * p, 0.7, SR)), 0.0002, 0.0024, 1.3);
      noiseLayer(o, SR, R, j(), 0.12, chain(biquad('bp', 3100 * p, 0.7, SR), biquad('peak', 1800 * p, 1, SR, 3)), 0.0004, 0.014, 1.5);
      noiseLayer(o, SR, R, j(), 0.15, biquad('bp', 1350 * p, 1.0, SR), 0.0008, 0.02, 0.9);
      thumpLayer(o, SR, j(), 150 * p, 50 * p, 0.025, 0.0008, 0.07, 0.9);
      noiseLayer(o, SR, R, j(), 0.35, biquad('lp', 1150 * p, 0.7, SR), 0.0015, 0.08, 0.95);
      modesLayer(o, SR, R, 0.012 + j(), [[2310 * p, 0.015, 0.26], [3720 * p, 0.01, 0.18], [5230 * p, 0.006, 0.12]], 0.5);
    } },
  // a deep boom: a low bark, a heavy, slow thump and body
  shotgun: { dry: 0.62, drive: 1.6,
    layers: (o, SR, R, p, j) => {
      noiseLayer(o, SR, R, 0, 0.015, chain(biquad('hp', 2600 * p, 0.7, SR), biquad('hp', 2600 * p, 0.7, SR)), 0.0003, 0.003, 0.75);
      noiseLayer(o, SR, R, j(), 0.2, chain(biquad('bp', 880 * p, 0.7, SR), biquad('peak', 2200 * p, 1, SR, 2)), 0.0006, 0.026, 1.4);
      thumpLayer(o, SR, j(), 125 * p, 40 * p, 0.04, 0.001, 0.15, 1.4);
      noiseLayer(o, SR, R, j(), 0.55, biquad('lp', 520 * p, 0.7, SR), 0.002, 0.17, 1.35);
      modesLayer(o, SR, R, 0.006 + j(), [[1650 * p, 0.02, 0.18], [2480 * p, 0.012, 0.12]], 0.35);
    } },
  // one gatling round: short, so 25 of them a second overlap into a roar
  gatling: { dry: 0.13, drive: 1.6,
    layers: (o, SR, R, p, j) => {
      noiseLayer(o, SR, R, 0, 0.01, chain(biquad('hp', 4100 * p, 0.7, SR), biquad('hp', 4100 * p, 0.7, SR)), 0.0002, 0.0015, 1.0);
      noiseLayer(o, SR, R, j() * 0.5, 0.06, biquad('bp', 2600 * p, 0.8, SR), 0.0003, 0.008, 1.2);
      thumpLayer(o, SR, j() * 0.5, 140 * p, 55 * p, 0.015, 0.0006, 0.035, 0.75);
      noiseLayer(o, SR, R, j() * 0.5, 0.12, biquad('lp', 1000 * p, 0.7, SR), 0.001, 0.04, 0.6);
    } },
};

/** one shot of a gun in a room: Float32Array at SR */
export function renderShot(gun, roomName, SR, v = 0) {
  const S = SPEC[gun], R = makeRng(hash(`${gun}/${roomName}/${v}`));
  const p = 1 + (R() - 0.5) * 0.06, lvl = Math.pow(10, ((R() - 0.5) * 2) / 20), j = () => R() * 0.0015;
  const n = Math.ceil((S.dry + ROOM[roomName].tail) * SR), dry = new Float32Array(n);
  S.layers(dry, SR, R, p, j);
  const wet = room(dry, SR, roomName, R);
  for (let i = 0; i < n; i++) dry[i] = (dry[i] + wet[i]) * lvl;
  return master(dry, SR, { drive: S.drive, pre: 1.5 * lvl });
}
/** the gatling's roar: `sec` seconds of rounds every `gap` s in a room, folded into a seamless loop */
export function renderGatlingLoop(roomName, SR, sec = 1.6, gap = 0.04) {
  const R = makeRng(hash('gatloop/' + roomName)), S = SPEC.gatling, T = ROOM[roomName].tail;
  const n = Math.ceil(sec * SR), m = n + Math.ceil(T * SR) + Math.ceil(S.dry * SR), dry = new Float32Array(m);
  for (let t = 0; t < sec - 1e-6; t += gap) {
    const one = new Float32Array(Math.ceil(S.dry * SR)), p = 1 + (R() - 0.5) * 0.06, j = () => R() * 0.0015;
    S.layers(one, SR, R, p, j);
    const i0 = Math.round((t + (R() - 0.5) * 0.002) * SR), g = 0.8 + R() * 0.25;
    for (let i = 0; i < one.length && i0 + i < m; i++) dry[i0 + i] += one[i] * g;
  }
  // the motor's whir under it
  for (let i = 0; i < m; i++) { const t = i / SR; dry[i] += Math.sin(TAU * 310 * t) * 0.05 + Math.sin(TAU * 620 * t + 1) * 0.03; }
  const wet = room(dry, SR, roomName, R);
  for (let i = 0; i < m; i++) dry[i] += wet[i];
  const out = master(dry, SR, { drive: 1.3, pre: 1.4, fade: 0 });
  // fold what rang past the end over the start, so the loop does not jump
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = out[i] + (i + n < m ? out[i + n] : 0);
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(y[i]));
  if (pk > 0.93) for (let i = 0; i < n; i++) y[i] *= 0.93 / pk;
  return y;
}
/** the last rounds of a burst and the room ringing after them (played when the trigger is let go) */
export function renderGatlingTail(roomName, SR) {
  const R = makeRng(hash('gattail/' + roomName)), S = SPEC.gatling, n = Math.ceil((0.25 + ROOM[roomName].tail) * SR), dry = new Float32Array(n);
  for (let k = 0; k < 3; k++) { const one = new Float32Array(Math.ceil(S.dry * SR)); S.layers(one, SR, R, 1 + (R() - 0.5) * 0.06, () => R() * 0.0015); const i0 = Math.round(k * 0.04 * SR); for (let i = 0; i < one.length; i++) dry[i0 + i] += one[i] * (1 - k * 0.25); }
  const wet = room(dry, SR, roomName, R);
  for (let i = 0; i < n; i++) dry[i] += wet[i] * 1.3;
  return master(dry, SR, { drive: 1.3, pre: 1.1 });
}

// ---- the rocket ------------------------------------------------------------------------------------------------
export function renderRocketLaunch(roomName, SR, v = 0) {
  const R = makeRng(hash('rlaunch/' + roomName + v)), n = Math.ceil((1.35 + ROOM[roomName].tail * 0.6) * SR), dry = new Float32Array(n);
  // the ignition: a pop and a thump
  noiseLayer(dry, SR, R, 0, 0.02, biquad('hp', 2000, 0.7, SR), 0.0003, 0.004, 0.9);
  thumpLayer(dry, SR, 0.002, 110, 38, 0.05, 0.002, 0.12, 1.2);
  // the whoosh: noise through a band that sweeps up and away (four fixed bands faded across), a hiss that recedes
  const sweep = [];
  for (const fc of [700, 1300, 2300, 3600]) sweep.push(biquad('bp', fc, 1.3, SR));
  for (let i = 0; i < n; i++) {
    const t = i / SR; if (t > 1.3) break;
    const x = R() * 2 - 1, pos = Math.min(3, 3 * Math.sin(Math.PI * Math.min(1, t / 1.1)) ** 0.8);
    let s = 0; sweep.forEach((bpf, k) => { s += bpf(x) * Math.max(0, 1 - Math.abs(k - pos)); });
    dry[i] += s * Math.min(1, t / 0.04) * Math.exp(-t / 0.55) * 2.4;
  }
  const wet = room(dry, SR, roomName, R);
  for (let i = 0; i < n; i++) dry[i] += wet[i] * 0.8;
  return master(dry, SR, { drive: 1.3, pre: 1.3 });
}
/** a heavy explosion: a crack, a sub that drops from 55 to 28 Hz, a roaring body, debris falling for a second */
export function renderExplosion(roomName, SR, v = 0) {
  const R = makeRng(hash('boom/' + roomName + v)), p = 1 + (R() - 0.5) * 0.06, n = Math.ceil((2.1 + ROOM[roomName].tail) * SR), dry = new Float32Array(n);
  noiseLayer(dry, SR, R, 0, 0.03, chain(biquad('hp', 700 * p, 0.7, SR), biquad('lp', 5000, 0.7, SR)), 0.0003, 0.006, 2.0);
  noiseLayer(dry, SR, R, 0.001, 0.4, biquad('bp', 640 * p, 0.6, SR), 0.0008, 0.045, 1.6);
  thumpLayer(dry, SR, 0.001, 58 * p, 27 * p, 0.25, 0.0015, 0.55, 2.2, 3.2);
  noiseLayer(dry, SR, R, 0.003, 1.8, chain(biquad('lp', 360 * p, 0.7, SR), biquad('lp', 600 * p, 0.7, SR)), 0.003, 0.42, 2.6);
  noiseLayer(dry, SR, R, 0.01, 1.2, biquad('bp', 1600 * p, 0.8, SR), 0.02, 0.18, 0.5);   // the fireball's crackle
  // debris: small hard hits scattered over 1.5 s, fewer and softer as it settles
  for (let k = 0; k < 46; k++) {
    const t0 = 0.12 + Math.pow(R(), 1.6) * 1.6, f = 1800 + R() * 5200, a = 0.25 * Math.exp(-t0 / 0.7) * (0.4 + R());
    modesLayer(dry, SR, R, t0, [[f, 0.006 + R() * 0.012, 1], [f * 1.53, 0.004, 0.5]], a, 0.6);
  }
  const wet = room(dry, SR, roomName, R);
  for (let i = 0; i < n; i++) dry[i] += wet[i] * 1.25;
  return master(dry, SR, { drive: 1.8, pre: 1.7, release: 0.12 });
}

// ---- the mechanics, the casings, the impacts, the enemies' guns ----------------------------------------------
function dryLight(o, SR, R) { click(o, SR, R, 0, 3100, 0.5, 0.006); click(o, SR, R, 0.012, 1900, 0.25, 0.008); }
function dryHeavy(o, SR, R) { click(o, SR, R, 0, 1700, 0.55, 0.012); thumpLayer(o, SR, 0, 220, 120, 0.01, 0.0005, 0.02, 0.25); }
function magOut(o, SR, R) { click(o, SR, R, 0, 2600, 0.45, 0.008); scrape(o, SR, R, 0.02, 0.12, 1800, 0.35); click(o, SR, R, 0.15, 900, 0.3, 0.02); }
function magIn(o, SR, R) { scrape(o, SR, R, 0, 0.08, 2200, 0.25); click(o, SR, R, 0.085, 1400, 0.7, 0.018); thumpLayer(o, SR, 0.085, 190, 90, 0.01, 0.0005, 0.03, 0.4); click(o, SR, R, 0.1, 3300, 0.3, 0.006); }
function bolt(o, SR, R) { scrape(o, SR, R, 0, 0.05, 2500, 0.3); click(o, SR, R, 0.05, 2100, 0.6, 0.012); click(o, SR, R, 0.17, 1600, 0.75, 0.016); thumpLayer(o, SR, 0.17, 160, 80, 0.01, 0.0005, 0.03, 0.35); }
function slide(o, SR, R) { click(o, SR, R, 0, 2700, 0.55, 0.01); scrape(o, SR, R, 0.01, 0.04, 3000, 0.25); click(o, SR, R, 0.07, 2200, 0.65, 0.012); }
function pump(o, SR, R) { scrape(o, SR, R, 0, 0.07, 1200, 0.45); click(o, SR, R, 0.07, 1150, 0.8, 0.02); thumpLayer(o, SR, 0.07, 160, 70, 0.015, 0.0005, 0.04, 0.5); scrape(o, SR, R, 0.15, 0.06, 1500, 0.4); click(o, SR, R, 0.21, 1500, 0.9, 0.018); }
function shellIn(o, SR, R) { scrape(o, SR, R, 0, 0.05, 1600, 0.3); click(o, SR, R, 0.05, 1250, 0.6, 0.014); }
function rocketLoad(o, SR, R) { scrape(o, SR, R, 0, 0.25, 700, 0.4); thumpLayer(o, SR, 0.26, 120, 60, 0.02, 0.001, 0.08, 0.8); click(o, SR, R, 0.27, 1300, 0.6, 0.02); click(o, SR, R, 0.42, 2400, 0.55, 0.01); }
function brass(o, SR, R) {   // a casing bouncing on stone: three falling, ringing hits
  let t = 0, a = 0.8;
  for (let k = 0; k < 4; k++) { const f = 4200 + R() * 2600; modesLayer(o, SR, R, t, [[f, 0.03, 1], [f * 1.61, 0.02, 0.6], [f * 2.43, 0.012, 0.4]], a, 0.5); t += 0.09 * Math.pow(0.62, k) + R() * 0.02; a *= 0.55; }
}
function hull(o, SR, R) { let t = 0, a = 0.8; for (let k = 0; k < 3; k++) { noiseLayer(o, SR, R, t, 0.04, biquad('bp', 900 + R() * 300, 2, SR), 0.0005, 0.008, a); thumpLayer(o, SR, t, 340, 220, 0.01, 0.0005, 0.012, a * 0.5); t += 0.11 * Math.pow(0.6, k); a *= 0.5; } }
function impConcrete(o, SR, R) { noiseLayer(o, SR, R, 0, 0.05, biquad('hp', 2500, 0.7, SR), 0.0002, 0.004, 0.9); noiseLayer(o, SR, R, 0.002, 0.2, biquad('bp', 900, 0.8, SR), 0.001, 0.03, 0.8); thumpLayer(o, SR, 0, 160, 90, 0.01, 0.0005, 0.02, 0.4); noiseLayer(o, SR, R, 0.02, 0.3, biquad('lp', 2500, 0.7, SR), 0.04, 0.08, 0.15); }
function impMetal(o, SR, R) { const f = 1500 + R() * 900; modesLayer(o, SR, R, 0, [[f, 0.09, 1], [f * 2.76, 0.05, 0.5], [f * 5.4, 0.02, 0.3], [f * 0.63, 0.12, 0.4]], 0.6, 1); noiseLayer(o, SR, R, 0, 0.02, biquad('hp', 3000, 0.7, SR), 0.0002, 0.003, 0.6); }
function impGlass(o, SR, R) { noiseLayer(o, SR, R, 0, 0.03, biquad('hp', 5000, 0.7, SR), 0.0002, 0.006, 0.8); for (let k = 0; k < 9; k++) { const f = 3500 + R() * 6000; modesLayer(o, SR, R, R() * 0.18, [[f, 0.02 + R() * 0.03, 1]], 0.25 * (1 - k / 12), 0.2); } }
function impArmour(o, SR, R) { const f = 820 + R() * 300; modesLayer(o, SR, R, 0, [[f, 0.06, 1], [f * 1.87, 0.04, 0.6], [f * 3.1, 0.02, 0.4]], 0.7, 1.2); thumpLayer(o, SR, 0, 200, 110, 0.01, 0.0005, 0.03, 0.5); for (let i = Math.floor(0.01 * SR); i < Math.min(o.length, 0.12 * SR); i++) { const t = i / SR; o[i] += Math.sign(Math.sin(TAU * 120 * t)) * (R() < 0.4 ? 0.12 : 0.03) * Math.exp(-t / 0.05); } }
function whizz(o, SR, R) {   // a round past the ear: a band of noise sweeping down through the Doppler, loudest as it passes
  const bands = [4200, 2600, 1500].map((f) => biquad('bp', f, 2, SR)), tc = 0.07 + R() * 0.03;
  for (let i = 0; i < o.length; i++) { const t = i / SR, x = R() * 2 - 1, u = (t - tc) / 0.035, a = Math.exp(-u * u), pos = Math.max(0, Math.min(2, 1 + u * 0.8)); let s = 0; bands.forEach((b, k) => { s += b(x) * Math.max(0, 1 - Math.abs(k - pos)); }); o[i] += s * a * 3; }
}
function boltShot(o, SR, R, v, far) {   // a sentinel's rifle: an electric bolt over a real crack; far: duller, the crack gone
  let ph = 0; const lp = biquad('lp', far ? 1100 : 9000, 0.7, SR), lp2 = biquad('lp', far ? 900 : 9000, 0.7, SR);
  for (let i = 0; i < o.length; i++) {
    const t = i / SR, f = 1500 * Math.exp(-t / 0.05) + 260 + v * 30; ph += TAU * f / SR;
    const zap = Math.tanh((Math.sin(ph) + 0.5 * Math.sign(Math.sin(ph * 0.5))) * 1.5) * Math.exp(-t / 0.07) * 0.45;
    const crack = (R() * 2 - 1) * Math.exp(-t / 0.006) * 0.8 + Math.sin(TAU * (120 - 60 * t) * t) * Math.exp(-t / 0.04) * 0.35;
    o[i] += lp2(lp(zap + (far ? 0.25 : 1) * crack));
  }
  if (far) { const R2 = makeRng(7 + v), wet = room(o, SR, 'open', R2); for (let i = 0; i < o.length; i++) o[i] = o[i] * 0.6 + wet[i] * 0.9; }
}
function heart(o, SR) { thumpLayer(o, SR, 0, 70, 45, 0.03, 0.006, 0.06, 1); thumpLayer(o, SR, 0.2, 62, 40, 0.03, 0.006, 0.07, 0.75); }
function land(o, SR, R) { thumpLayer(o, SR, 0, 95, 45, 0.03, 0.002, 0.08, 1); noiseLayer(o, SR, R, 0, 0.15, biquad('lp', 700, 0.7, SR), 0.002, 0.03, 0.6); noiseLayer(o, SR, R, 0.01, 0.12, biquad('bp', 2400, 1, SR), 0.004, 0.025, 0.2); }
function unlock(o, SR, R) {
  scrape(o, SR, R, 0, 0.12, 1500, 0.4); click(o, SR, R, 0.12, 1300, 0.8, 0.02); click(o, SR, R, 0.3, 2200, 0.6, 0.012);
  [523.25, 783.99, 1046.5].forEach((f, k) => { const i0 = Math.floor((0.36 + k * 0.09) * SR); for (let i = i0; i < o.length; i++) { const t = (i - i0) / SR; o[i] += Math.sin(TAU * f * t) * Math.exp(-t / 0.35) * 0.25 * Math.min(1, t * 200); } });
}
function draw(o, SR, R) { noiseLayer(o, SR, R, 0, 0.18, biquad('bp', 1200, 0.8, SR), 0.06, 0.05, 0.35); click(o, SR, R, 0.16, 2400, 0.45, 0.008); }
function motor(o, SR) {   // the gatling's motor at full speed (the game sets the rate with the spin): a whine and a gear rattle
  const n = o.length;
  for (let i = 0; i < n; i++) { const t = i / SR; let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(TAU * 440 * h * t) / h; o[i] = s * 0.18 + Math.sign(Math.sin(TAU * 73.33 * t)) * 0.03 + Math.sin(TAU * 1760 * t) * 0.04; }
}
function spindown(o, SR) { let ph = 0; for (let i = 0; i < o.length; i++) { const t = i / SR, f = 440 * Math.exp(-t / 0.45); ph += TAU * f / SR; let s = 0; for (let h = 1; h <= 5; h++) s += Math.sin(ph * h) / h; o[i] = s * 0.22 * Math.exp(-t / 0.6); } }
function vent(o, SR, R) { noiseLayer(o, SR, R, 0, 1.4, chain(biquad('hp', 1800, 0.7, SR), biquad('peak', 5000, 1, SR, 5)), 0.05, 0.45, 0.8); click(o, SR, R, 0, 1900, 0.5, 0.01); }

/** name -> { cat, n (variants), render(SR, v), loop?, desc } */
export const WEAPON_SOUNDS = {};
const W = WEAPON_SOUNDS, DESC = { pistol: 'a pistol shot', carbine: 'a carbine shot', shotgun: 'a shotgun blast' };
for (const g of GUNS) for (const r of ENVS) W[`shot_${g}_${r}`] = { cat: 'weapon', n: 4, gun: g, room: r, desc: `${DESC[g]}, ${r}`, render: (SR, v) => renderShot(g, r, SR, v) };
for (const r of ENVS) {
  W[`gatling_loop_${r}`] = { cat: 'weapon', n: 1, loop: true, room: r, desc: `a gatling firing (loop), ${r}`, render: (SR) => renderGatlingLoop(r, SR) };
  W[`gatling_tail_${r}`] = { cat: 'weapon', n: 1, room: r, desc: `a gatling burst's last rounds, ${r}`, render: (SR) => renderGatlingTail(r, SR) };
  W[`rocket_launch_${r}`] = { cat: 'weapon', n: 2, room: r, desc: `a rocket launch, ${r}`, render: (SR, v) => renderRocketLaunch(r, SR, v) };
  W[`explosion_${r}`] = { cat: 'weapon', n: 2, room: r, desc: `a heavy explosion with debris, ${r}`, render: (SR, v) => renderExplosion(r, SR, v) };
}
const S1 = (name, n, sec, fn, desc) => { W[name] = { cat: 'weapon', n, desc, render: one(name, sec, fn) }; };
S1('dry_light', 1, 0.1, dryLight, 'a light gun dry-firing');
S1('dry_heavy', 1, 0.12, dryHeavy, 'a heavy gun dry-firing');
S1('mag_out', 1, 0.32, magOut, 'a magazine released and pulled');
S1('mag_in', 1, 0.3, magIn, 'a magazine seated');
S1('bolt_rack', 1, 0.32, bolt, 'a bolt racked');
S1('slide', 1, 0.18, slide, 'a pistol slide released');
S1('pump', 2, 0.32, pump, 'a shotgun pumped');
S1('shell_in', 2, 0.16, shellIn, 'a shell loaded');
S1('rocket_load', 1, 0.55, rocketLoad, 'a rocket loaded');
S1('brass', 3, 0.45, brass, 'a casing bouncing on stone');
S1('shell_hull', 2, 0.35, hull, 'a plastic shotgun hull landing');
S1('impact_concrete', 3, 0.32, impConcrete, 'a round hitting concrete');
S1('impact_metal', 3, 0.5, impMetal, 'a round hitting sheet metal');
S1('impact_glass', 3, 0.32, impGlass, 'a round through glass');
S1('impact_armour', 3, 0.32, impArmour, 'a round on armour plate');
S1('whizz', 3, 0.2, whizz, 'a round passing the ear');
S1('energy_bolt', 3, 0.3, (o, SR, R, v) => boltShot(o, SR, R, v, false), 'an energy rifle bolt');
S1('energy_bolt_far', 3, 0.9, (o, SR, R, v) => boltShot(o, SR, R, v, true), 'an energy rifle far off');
S1('heartbeat', 1, 0.5, heart, 'a heartbeat (low health)');
S1('land', 2, 0.25, land, 'landing from a jump');
S1('unlock', 1, 0.9, unlock, 'a weapon unlocked (a chime)');
S1('weapon_draw', 2, 0.28, draw, 'a weapon drawn');
W.gatling_motor = { cat: 'weapon', n: 1, loop: true, desc: 'a gatling motor at speed (loop)', render: (SR) => { const o = new Float32Array(Math.round(SR * 0.5)); motor(o, SR); return o; } };   // 0.5 s: whole periods of 440 / 73.33 Hz at 48 kHz
S1('gatling_spindown', 1, 1.4, spindown, 'a gatling spinning down');
S1('gatling_vent', 1, 1.5, vent, 'a gatling venting heat');
