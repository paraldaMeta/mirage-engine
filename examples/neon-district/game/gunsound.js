// The guns' sounds, synthesised offline into sample buffers (no files, no DOM: scripts/sfx-check.mjs renders the
// same functions in headless Chrome and measures them). A shot is built from layers, the way a recorded gunshot is
// made of parts:
//   transient  a few ms of broadband noise through a high band: the supersonic snap
//   crack      a band-passed noise burst with a fast decay: the muzzle blast's bark
//   thump      a sine that drops in pitch (about 150 -> 50 Hz): the weight in the chest
//   mech       short metallic resonances: the slide, the bolt, the pump
//   body       low-passed noise with a slower decay: the boom's mass
// then a tail chosen by where the player stands (env): 'alley' a tight slapback off two close walls, 'open' (street,
// plaza) a long diffuse tail with late reflections off far facades, 'indoor' (the bar, the relay) a short boxy room.
// Light saturation, then a look-ahead peak limiter, so the summed layers never clip and the level sits near full
// scale. Every sound has 3-4 variants: about +-3 % pitch, +-1 dB level and up to 1.5 ms of jitter between layers.
// Exports: ENVS, GUNS, SOUNDS (name -> { n: variants, sec, render(SR, v) -> Float32Array, loop? }), renderSound().
const TAU = Math.PI * 2;
export const ENVS = ['alley', 'open', 'indoor'];
export const GUNS = ['pistol', 'carbine', 'shotgun'];

export function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** an RBJ biquad as a per-sample function: 'lp' | 'hp' | 'bp' (0 dB peak) | 'peak' (gain in dB) */
export function biquad(type, f, q, SR, gainDb = 0) {
  const w = TAU * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
  else if (type === 'bp') { b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
  else { b0 = 1 + a * A; b1 = -2 * c; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * c; a2 = 1 - a / A; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
const chain = (...fs) => (x) => { for (const f of fs) x = f(x); return x; };
const env = (t, at, dec) => (t < 0 ? 0 : t < at ? t / at : Math.exp(-(t - at) / dec));

// ---- layers: each adds into `out` from time t0 (s) ------------------------------------------------------------
function noiseLayer(out, SR, R, t0, len, filter, at, dec, gain) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), n = Math.min(out.length, i0 + Math.ceil(len * SR));
  for (let i = i0; i < n; i++) { const t = (i - i0) / SR; out[i] += filter(R() * 2 - 1) * env(t, at, dec) * gain; }
}
function thumpLayer(out, SR, t0, f0, f1, tf, at, dec, gain, len = dec * 7) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), n = Math.min(out.length, i0 + Math.ceil(len * SR));
  let ph = 0;
  for (let i = i0; i < n; i++) { const t = (i - i0) / SR, f = f1 + (f0 - f1) * Math.exp(-t / tf); ph += TAU * f / SR; out[i] += Math.sin(ph) * env(t, at, dec) * gain; }
}
/** short metallic resonances: modes [[freq, decay, amp]], excited by a click */
function modesLayer(out, SR, R, t0, modes, gain, click = 0.4) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), len = Math.max(...modes.map((m) => m[1])) * 7, n = Math.min(out.length, i0 + Math.ceil(len * SR));
  const hp = biquad('hp', 2500, 0.7, SR);
  for (let i = i0; i < n; i++) {
    const t = (i - i0) / SR; let s = 0;
    for (const [f, d, a] of modes) s += a * Math.sin(TAU * f * t + a) * Math.exp(-t / d);
    s += hp(R() * 2 - 1) * Math.exp(-t / 0.0015) * click;
    out[i] += s * gain * Math.min(1, t / 0.0002);
  }
}

// ---- the rooms -----------------------------------------------------------------------------------------------
// early reflections (delay ms, gain, low-pass Hz) and a Schroeder / Freeverb-style diffuse tail (rt60 s, size, damp)
const ROOM = {
  alley: { early: [[31, 0.55, 4200], [62, 0.42, 3400], [93, 0.3, 2800], [124, 0.2, 2300], [155, 0.13, 1900], [186, 0.08, 1600]], rt: 0.75, size: 0.85, damp: 0.35, wet: 0.2, pre: 4, tail: 0.9 },
  open: { early: [[88, 0.2, 2400], [157, 0.16, 1800], [236, 0.12, 1500], [341, 0.08, 1100]], rt: 1.8, size: 1.5, damp: 0.55, wet: 0.36, pre: 22, tail: 2.0 },
  indoor: { early: [[6, 0.42, 5000], [11, 0.36, 4500], [17, 0.3, 4000], [24, 0.22, 3500], [31, 0.16, 3000]], rt: 0.3, size: 0.5, damp: 0.3, wet: 0.36, pre: 2, tail: 0.4, box: [260, 4] },
};
export const ROOMS = ROOM;
function room(dry, SR, name, R) {
  const P = ROOM[name], n = dry.length, out = new Float32Array(n);
  for (const [ms, g, f] of P.early) {
    const d = Math.round(ms / 1000 * SR * (0.97 + R() * 0.06)), lp = biquad('lp', f, 0.7, SR);
    for (let i = d; i < n; i++) out[i] += lp(dry[i - d]) * g;
  }
  // the diffuse tail: six damped combs in parallel, two all-passes in series
  const combs = [25.31, 26.94, 28.96, 30.75, 32.24, 33.81].map((ms) => {
    const len = Math.max(8, Math.round(ms / 1000 * SR * P.size)), g = Math.pow(10, -3 * (len / SR) / P.rt);
    return { buf: new Float32Array(len), i: 0, g, f: 0 };
  });
  const aps = [5.0, 1.7].map((ms) => ({ buf: new Float32Array(Math.max(4, Math.round(ms / 1000 * SR * P.size))), i: 0 }));
  const pre = Math.round(P.pre / 1000 * SR), inLp = biquad('lp', name === 'open' ? 2600 : 4800, 0.7, SR), box = P.box ? biquad('peak', P.box[0], 1.2, SR, P.box[1]) : (x) => x;
  const k = 1 / combs.length;
  for (let i = 0; i < n; i++) {
    const x = i >= pre ? inLp(dry[i - pre]) : 0;
    let s = 0;
    for (const c of combs) { const y = c.buf[c.i]; c.f = y * (1 - P.damp) + c.f * P.damp; c.buf[c.i] = x + c.f * c.g; c.i = (c.i + 1) % c.buf.length; s += y; }
    s *= k;
    for (const a of aps) { const b = a.buf[a.i]; const y = -s + b; a.buf[a.i] = s + b * 0.5; a.i = (a.i + 1) % a.buf.length; s = y; }
    out[i] += box(s) * P.wet * 2.2;
  }
  return out;
}

// ---- the last stage: saturation, a look-ahead peak limiter, a fade at the end ---------------------------------
export function master(x, SR, { drive = 1.4, ceiling = 0.93, pre = 1.5, look = 0.0015, release = 0.06, fade = 0.03 } = {}) {
  const n = x.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  const norm = peak > 0 ? pre / peak : 1, td = Math.tanh(drive);
  for (let i = 0; i < n; i++) x[i] = Math.tanh(drive * x[i] * norm) / td * Math.max(1, pre * 0.75);
  // the gain each sample needs, the least of the next `look` seconds, eased up again over `release`
  const L = Math.max(1, Math.round(look * SR)), need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); need[i] = a > ceiling ? ceiling / a : 1; }
  const rc = Math.exp(-1 / (release * SR));
  let g = 1;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1; for (let j = i, e = Math.min(n, i + L); j < e; j++) if (need[j] < m) m = need[j];
    g = m < g ? g + (m - g) * 0.5 : m - (m - g) * rc;
    let v = x[i] * g;
    if (Math.abs(v) > ceiling) v = Math.sign(v) * ceiling;   // what the look-ahead still let through
    y[i] = v;
  }
  const f = Math.min(n, Math.round(fade * SR));
  for (let i = 0; i < f; i++) y[n - 1 - i] *= i / f;
  return y;
}

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
const one = (sec, fn) => (SR, v = 0) => { const R = makeRng(hash(fn.name + v + sec)), o = new Float32Array(Math.ceil(sec * SR)); fn(o, SR, R, v); return master(o, SR, { drive: 1.1, pre: 1.0, ceiling: 0.9 }); };
const click = (o, SR, R, t0, f, g, dec = 0.01) => modesLayer(o, SR, R, t0, [[f, dec, 1], [f * 1.47, dec * 0.6, 0.6], [f * 2.31, dec * 0.4, 0.35]], g, 0.8);
const scrape = (o, SR, R, t0, len, fc, g) => noiseLayer(o, SR, R, t0, len, biquad('bp', fc, 1.4, SR), len * 0.4, len * 0.5, g);
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

/** every sound the game adds: name -> { n (variants), render(SR, v) -> Float32Array, loop? } */
export const SOUNDS = {};
for (const g of GUNS) for (const r of ENVS) SOUNDS[`nd_shot_${g}_${r}`] = { n: 4, kind: 'shot', gun: g, room: r, render: (SR, v) => renderShot(g, r, SR, v) };
for (const r of ENVS) {
  SOUNDS[`nd_gat_loop_${r}`] = { n: 1, kind: 'loop', gun: 'gatling', room: r, loop: true, render: (SR) => renderGatlingLoop(r, SR) };
  SOUNDS[`nd_gat_tail_${r}`] = { n: 1, kind: 'shot', gun: 'gatling', room: r, render: (SR) => renderGatlingTail(r, SR) };
  SOUNDS[`nd_rkt_launch_${r}`] = { n: 2, kind: 'shot', gun: 'rocket', room: r, render: (SR, v) => renderRocketLaunch(r, SR, v) };
  SOUNDS[`nd_rkt_boom_${r}`] = { n: 2, kind: 'boom', gun: 'rocket', room: r, render: (SR, v) => renderExplosion(r, SR, v) };
}
Object.assign(SOUNDS, {
  nd_dry_light: { n: 1, render: one(0.1, dryLight) }, nd_dry_heavy: { n: 1, render: one(0.12, dryHeavy) },
  nd_mag_out: { n: 1, render: one(0.32, magOut) }, nd_mag_in: { n: 1, render: one(0.3, magIn) }, nd_bolt_rack: { n: 1, render: one(0.32, bolt) },
  nd_slide: { n: 1, render: one(0.18, slide) }, nd_pump: { n: 2, render: one(0.32, pump) }, nd_shell_in: { n: 2, render: one(0.16, shellIn) }, nd_rkt_load: { n: 1, render: one(0.55, rocketLoad) },
  nd_brass: { n: 3, render: one(0.45, brass) }, nd_hull: { n: 2, render: one(0.35, hull) },
  nd_imp_concrete: { n: 3, render: one(0.32, impConcrete) }, nd_imp_metal: { n: 3, render: one(0.5, impMetal) }, nd_imp_glass: { n: 3, render: one(0.32, impGlass) }, nd_imp_armour: { n: 3, render: one(0.32, impArmour) },
  nd_whizz: { n: 3, render: one(0.2, whizz) },
  nd_bolt: { n: 3, render: one(0.3, (o, SR, R, v) => boltShot(o, SR, R, v, false)) }, nd_bolt_far: { n: 3, render: one(0.9, (o, SR, R, v) => boltShot(o, SR, R, v, true)) },
  nd_heart: { n: 1, render: one(0.5, heart) }, nd_land: { n: 2, render: one(0.25, land) }, nd_unlock: { n: 1, render: one(0.9, unlock) }, nd_draw: { n: 2, render: one(0.28, draw) },
  nd_gat_motor: { n: 1, loop: true, render: (SR) => { const o = new Float32Array(Math.round(SR * 0.5)); motor(o, SR); return o; } },   // 0.5 s: whole periods of 440 / 73.33 Hz at 48 kHz
  nd_gat_spindown: { n: 1, render: one(1.4, spindown) }, nd_gat_vent: { n: 1, render: one(1.5, vent) },
});
/** the order the game makes them in: what is heard first comes first */
export const ORDER = Object.keys(SOUNDS).sort((a, b) => rank(a) - rank(b));
function rank(n) { return /carbine/.test(n) ? 0 : /pistol|shotgun_/.test(n) ? 1 : /bolt|imp_|dry|mag|brass|draw|whizz/.test(n) ? 2 : 3; }
/** render one variant of a named sound */
export const renderSound = (name, SR, v = 0) => SOUNDS[name].render(SR, v);
