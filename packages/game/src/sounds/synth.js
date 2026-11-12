// Mirage original code. The synthesis kit of the sound library (@miragekit/game/sounds): sounds are rendered from
// code into sample buffers (Float32Array at any sample rate), with no files and no DOM, so the same functions run in a
// page, a worker and Node (packages/game/sounds.check.mjs renders and measures every one). The pieces, the way a
// recorded sound is made of parts:
//   noiseLayer   filtered noise with an attack / decay envelope (a crack, a hiss, a body, a whoosh)
//   thumpLayer   a sine that falls in pitch (a kick, the weight of a blast, a step's thud)
//   modesLayer   struck resonances [[freq, decay, amp]] excited by a click (metal, glass, a casing, a key)
//   toneLayer    a tone with an envelope, vibrato and harmonics (beeps, chimes, alarms, motors)
//   room         early reflections and a diffuse tail per space: ROOMS.alley | open | indoor | hall | small
//   master       saturation, a look-ahead peak limiter and a fade: the summed layers never clip
//   one / fold   a one-shot rendered with its own seed; a loop folded so its end runs into its start
// Every random choice comes from makeRng(hash(name / variant)): a sound is the same on every machine and every run.
//   const o = new Float32Array(SR * 0.3), R = makeRng(hash('door'));
//   thumpLayer(o, SR, 0, 120, 60, 0.02, 0.001, 0.08, 1); noiseLayer(o, SR, R, 0, 0.2, biquad('lp', 900, 0.7, SR), 0.002, 0.05, 0.5);
//   const pcm = master(o, SR);
export const TAU = Math.PI * 2;

export function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

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
export const chain = (...fs) => (x) => { for (const f of fs) x = f(x); return x; };
export const env = (t, at, dec) => (t < 0 ? 0 : t < at ? t / at : Math.exp(-(t - at) / dec));

// ---- layers: each adds into `out` from time t0 (s) ------------------------------------------------------------
export function noiseLayer(out, SR, R, t0, len, filter, at, dec, gain) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), n = Math.min(out.length, i0 + Math.ceil(len * SR));
  for (let i = i0; i < n; i++) { const t = (i - i0) / SR; out[i] += filter(R() * 2 - 1) * env(t, at, dec) * gain; }
}
export function thumpLayer(out, SR, t0, f0, f1, tf, at, dec, gain, len = dec * 7) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), n = Math.min(out.length, i0 + Math.ceil(len * SR));
  let ph = 0;
  for (let i = i0; i < n; i++) { const t = (i - i0) / SR, f = f1 + (f0 - f1) * Math.exp(-t / tf); ph += TAU * f / SR; out[i] += Math.sin(ph) * env(t, at, dec) * gain; }
}
/** short metallic resonances: modes [[freq, decay, amp]], excited by a click */
export function modesLayer(out, SR, R, t0, modes, gain, click = 0.4) {
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
export function room(dry, SR, name, R) {
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

/** a tone added into `out` from t0: frequency f (or a function of t), envelope (attack, decay), harmonics [[k, amp]],
 *  vibrato [rate Hz, depth as a ratio] */
export function toneLayer(out, SR, t0, len, f, at, dec, gain, { harm = [[1, 1]], vib = null, hold = 0 } = {}) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), n = Math.min(out.length, i0 + Math.ceil(len * SR));
  let ph = 0;
  for (let i = i0; i < n; i++) {
    const t = (i - i0) / SR, fr = (typeof f === 'function' ? f(t) : f) * (vib ? 1 + vib[1] * Math.sin(TAU * vib[0] * t) : 1);
    ph += TAU * fr / SR;
    let s = 0; for (const [k, a] of harm) s += a * Math.sin(ph * k);
    const e = t < at ? t / at : t < at + hold ? 1 : Math.exp(-(t - at - hold) / dec);
    out[i] += s * e * gain;
  }
}
/** a one-shot: `sec` seconds rendered by fn(out, SR, R, v) with the seed of `key` and the variant, then mastered */
export const one = (key, sec, fn, opts = { drive: 1.1, pre: 1.0, ceiling: 0.9 }) => (SR, v = 0) => {
  const R = makeRng(hash(key + '/' + v)), o = new Float32Array(Math.ceil(sec * SR));
  fn(o, SR, R, v);
  return master(o, SR, opts);
};
/** a seamless loop: fn renders `sec + over` seconds; what runs past `sec` is cross-faded over the start */
export const fold = (key, sec, fn, { over = 0.5, level = 0.7 } = {}) => (SR, v = 0) => {
  const n = Math.round(sec * SR), m = n + Math.round(over * SR), o = new Float32Array(m), R = makeRng(hash(key + '/' + v));
  fn(o, SR, R, v);
  const y = new Float32Array(n), f = m - n;
  for (let i = 0; i < n; i++) y[i] = o[i];
  for (let i = 0; i < f; i++) { const k = i / f; y[i] = o[i] * k + o[n + i] * (1 - k); }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(y[i]));
  if (pk > 0) for (let i = 0; i < n; i++) y[i] *= level / pk;
  return y;
};
/** a small struck click (three modes) and a scrape (band noise), the mechanics' two gestures */
export const click = (o, SR, R, t0, f, g, dec = 0.01) => modesLayer(o, SR, R, t0, [[f, dec, 1], [f * 1.47, dec * 0.6, 0.6], [f * 2.31, dec * 0.4, 0.35]], g, 0.8);
export const scrape = (o, SR, R, t0, len, fc, g) => noiseLayer(o, SR, R, t0, len, biquad('bp', fc, 1.4, SR), len * 0.4, len * 0.5, g);
