// Mirage original code. The arithmetic of the audio engine, with no Web Audio in it, so Node can check every formula:
// decibels, distance roll-off (the three Web Audio models plus custom curves), cone gain, Doppler ratio, the occlusion
// response, reverb impulse responses made from seeded noise, a WAV (PCM / float) encoder and decoder, and the
// measurements the checks use (RMS, a single-bin spectrum probe, onset time).
// ---------------------------------------------------------------------------
// distanceGain(d, { model: 'inverse' | 'linear' | 'exponential' | 'custom', ref, max, rolloff, curve: [[d, g], ...] })
// coneGain(sourceDir, sourceToListener, inner, outer, outerGain)       dopplerRatio(src, vSrc, lis, vLis, c, factor)
// impulseResponse({ sampleRate, seconds, decay, damping, predelay, early, width, seed }) -> [Float32Array, Float32Array]
// REVERBS.room | hall | cave | cathedral | outdoor | plate              encodeWav(channels, sampleRate) -> Uint8Array
// decodeWav(arrayBuffer) -> { sampleRate, channels: [Float32Array, ...] }
// ponytail: the impulse response is exponentially decaying noise with a darkening one-pole filter and a few early
// taps, not a room simulation; decodeWav reads PCM 8/16/24/32 and float 32 only (anything else goes to the browser).
// ---------------------------------------------------------------------------
import { sfc32, hash32 } from '@miragekit/core/rng';

export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => (g > 1e-10 ? 20 * Math.log10(g) : -200);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Gain of a source d metres away. inverse / linear / exponential are the Web Audio formulas; custom reads a curve. */
export function distanceGain(d, { model = 'inverse', ref = 1, max = 10000, rolloff = 1, curve } = {}) {
  if (model === 'custom' && curve) {
    if (typeof curve === 'function') return Math.max(0, curve(d));
    // [[distance, gain], ...] sorted by distance, linear between points, held flat outside them
    if (d <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      if (d <= curve[i][0]) { const [d0, g0] = curve[i - 1], [d1, g1] = curve[i]; return g0 + ((g1 - g0) * (d - d0)) / (d1 - d0 || 1); }
    }
    return curve[curve.length - 1][1];
  }
  if (model === 'linear') {
    const dd = clamp(d, ref, Math.max(max, ref));
    return max > ref ? 1 - (clamp(rolloff, 0, 1) * (dd - ref)) / (max - ref) : 1;
  }
  const dd = Math.max(d, ref);
  if (model === 'exponential') return ref > 0 ? (Math.min(dd, max) / ref) ** -rolloff : 1;
  return ref / (ref + rolloff * (Math.min(dd, max) - ref));   // inverse; past max it stops falling, as Web Audio's does
}

/** Web Audio's cone: 1 inside inner, outerGain outside outer, linear between. Angles in degrees (full widths). */
export function coneGain(dir, toListener, inner = 360, outer = 360, outerGain = 0) {
  if (inner >= 360 && outer >= 360) return 1;
  const l = Math.hypot(...toListener), m = Math.hypot(...dir);
  if (l < 1e-6 || m < 1e-6) return 1;
  const cos = (dir[0] * toListener[0] + dir[1] * toListener[1] + dir[2] * toListener[2]) / (l * m);
  const a = (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI, hi = inner / 2, ho = Math.max(outer / 2, hi);
  if (a <= hi) return 1;
  if (a >= ho) return outerGain;
  return 1 + ((outerGain - 1) * (a - hi)) / (ho - hi);
}

/** Playback-rate factor of a moving source heard by a moving listener. factor 0 switches it off; clamped to 0.5-2. */
export function dopplerRatio(src, vSrc, lis, vLis, c = 343, factor = 1) {
  if (!factor) return 1;
  const n = [lis[0] - src[0], lis[1] - src[1], lis[2] - src[2]], l = Math.hypot(...n);
  if (l < 1e-6) return 1;
  const vs = (vSrc[0] * n[0] + vSrc[1] * n[1] + vSrc[2] * n[2]) / l, vl = (vLis[0] * n[0] + vLis[1] * n[1] + vLis[2] * n[2]) / l;
  const lim = c * 0.9;   // supersonic motion would flip the sign; hold it just below
  const r = (c - clamp(vl, -lim, lim)) / (c - clamp(vs, -lim, lim));
  return clamp(1 + (r - 1) * factor, 0.5, 2);
}

/** Occlusion 0..1 to what the voice does about it: a gain and a low-pass cutoff (interpolated in octaves). */
export function occlusionResponse(o, { gain = 0.3, freq = 700, open = 20000 } = {}) {
  const k = clamp(o, 0, 1);
  return { gain: 1 + (gain - 1) * k, freq: open * (freq / open) ** k };
}

// decay: seconds to fall 60 dB (RT60). damping 0..1: how fast the tail loses its highs. early: level of the early taps.
export const REVERBS = {
  room: { seconds: 0.9, decay: 0.6, damping: 0.45, predelay: 0.004, early: 0.7, width: 0.8 },
  hall: { seconds: 2.6, decay: 2.1, damping: 0.35, predelay: 0.018, early: 0.5, width: 1 },
  cave: { seconds: 3.6, decay: 3.2, damping: 0.6, predelay: 0.03, early: 0.6, width: 1 },
  cathedral: { seconds: 5.5, decay: 5.0, damping: 0.3, predelay: 0.04, early: 0.35, width: 1 },
  outdoor: { seconds: 1.2, decay: 0.9, damping: 0.75, predelay: 0.05, early: 0.25, width: 1 },
  plate: { seconds: 1.8, decay: 1.5, damping: 0.1, predelay: 0, early: 0, width: 1 },
};
export const reverbParams = (r) => ({ ...REVERBS.room, ...(typeof r === 'string' ? REVERBS[r] : r && r.preset ? { ...REVERBS[r.preset], ...r } : r) });

/** A stereo impulse response as two Float32Arrays, the same samples for the same parameters and seed. Normalised so a
 *  steady signal comes out of the convolution at about its own power (the wet gain then means what it says). */
export function impulseResponse({ sampleRate = 48000, seconds = 1.5, decay = 1.2, damping = 0.4, predelay = 0.01, early = 0.5, width = 1, seed = 'mirage/ir' } = {}) {
  const n = Math.max(1, Math.ceil(seconds * sampleRate)), pre = Math.floor(predelay * sampleRate);
  const out = [new Float32Array(n), new Float32Array(n)];
  const k = Math.log(1000) / Math.max(decay, 0.01);   // amplitude falls 60 dB in `decay` seconds
  const R = sfc32(hash32(seed));
  const mid = new Float32Array(n);
  for (let c = 0; c < 3; c++) {   // 0: shared (mid), 1 and 2: per-ear; width mixes them
    const d = c ? out[c - 1] : mid;
    let y = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sampleRate;
      // the tail darkens: the one-pole's coefficient closes with time, faster for more damping
      const a = clamp(1 - damping * (0.25 + 0.75 * Math.min(1, (t / Math.max(decay, 0.01)) * 2.5)), 0.02, 1);
      y += a * (R() * 2 - 1 - y);
      d[i] = y * Math.exp(-k * t) * Math.min(1, t / 0.002 + 0.2);
    }
  }
  const w = clamp(width, 0, 1), m = Math.sqrt(1 - 0.5 * w * w), s = w * Math.SQRT1_2;
  for (let i = 0; i < n; i++) { const a = mid[i]; out[0][i] = a * m + out[0][i] * s; out[1][i] = a * m + out[1][i] * s; }
  if (early > 0) {   // a handful of discrete reflections in the first 60 ms, alternating ears
    const taps = 7;
    for (let j = 0; j < taps; j++) {
      const t = 0.004 + 0.056 * ((j + R() * 0.6) / taps), i = pre + Math.floor(t * sampleRate);
      if (i < n) out[j & 1][i] += early * (R() < 0.5 ? -1 : 1) * (1 - j / (taps + 2)) * 0.9, out[1 - (j & 1)][i + 7 < n ? i + 7 : i] += early * 0.35 * (1 - j / (taps + 2));
    }
  }
  let e = 0;
  for (const d of out) for (let i = 0; i < n; i++) e += d[i] * d[i];
  const g = 1 / Math.sqrt(e / 2 || 1);   // unit energy per channel: white noise in, the same power out
  for (const d of out) for (let i = 0; i < n; i++) d[i] *= g;
  return out;
}

/** channels: Float32Arrays of one length. bits 16 (PCM) or 32 (IEEE float). Returns the bytes of a RIFF/WAVE file. */
export function encodeWav(channels, sampleRate = 48000, bits = 16) {
  const ch = channels.length, n = channels[0].length, bps = bits / 8, size = n * ch * bps;
  const b = new ArrayBuffer(44 + size), v = new DataView(b);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + size, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, ch, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, size, true);
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += bps) {
    const x = channels[c][i];
    if (bits === 32) v.setFloat32(o, x, true); else v.setInt16(o, Math.round(clamp(x, -1, 1) * 32767), true);
  }
  return new Uint8Array(b);
}

/** The engine's fallback when the browser will not decode (and Node's reader in the checks). Throws on other formats. */
export function decodeWav(buffer) {
  const v = new DataView(buffer.buffer ? buffer.buffer : buffer, buffer.byteOffset || 0, buffer.byteLength);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (v.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('audio: not a RIFF/WAVE file');
  let fmt = null, o = 12;
  while (o + 8 <= v.byteLength) {
    const id = tag(o), len = v.getUint32(o + 4, true), at = o + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(at, true);
      if (format === 0xfffe && len >= 26) format = v.getUint16(at + 24, true);   // WAVE_FORMAT_EXTENSIBLE: the sub-format
      fmt = { format, ch: v.getUint16(at + 2, true), rate: v.getUint32(at + 4, true), bits: v.getUint16(at + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('audio: WAV data before fmt');
      const { format, ch, rate, bits } = fmt, bps = bits / 8;
      if (!((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && bits === 32)) || !ch) throw new Error(`audio: WAV format ${format} / ${bits} bit is not read here`);
      const n = Math.floor(Math.min(len, v.byteLength - at) / (bps * ch));
      const channels = Array.from({ length: ch }, () => new Float32Array(n));
      for (let i = 0, p = at; i < n; i++) for (let c = 0; c < ch; c++, p += bps) {
        channels[c][i] = format === 3 ? v.getFloat32(p, true)
          : bits === 8 ? (v.getUint8(p) - 128) / 128
          : bits === 16 ? v.getInt16(p, true) / 32768
          : bits === 24 ? ((v.getInt8(p + 2) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p)) / 8388608
          : v.getInt32(p, true) / 2147483648;
      }
      return { sampleRate: rate, channels };
    }
    o = at + len + (len & 1);
  }
  throw new Error('audio: WAV without a data chunk');
}

/** bytes of a `data:` URL (base64 or percent-encoded), so a single-file build opened from file:// needs no fetch */
export function dataUrlBytes(url) {
  const comma = url.indexOf(','), head = url.slice(5, comma), body = url.slice(comma + 1);
  if (/;base64/i.test(head)) {
    const s = atob(body), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}

// ---- measurements (the checks; the debug overlay uses rms / peak) ---------------------------------------
export function rms(d, from = 0, to = d.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
}
export function peak(d, from = 0, to = d.length) {
  let m = 0;
  for (let i = from; i < to; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  return m;
}
/** amplitude of the sine at `freq` in d[from..to) (one Goertzel bin; exact for whole periods in the window) */
export function toneLevel(d, sampleRate, freq, from = 0, to = d.length) {
  const w = (2 * Math.PI * freq) / sampleRate, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) { const s0 = d[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  const n = to - from, re = s1 - s2 * Math.cos(w), im = s2 * Math.sin(w);
  return (2 * Math.hypot(re, im)) / Math.max(1, n);
}
/** first sample index where |d| exceeds `level`, or -1 */
export function onset(d, level = 0.01, from = 0) {
  for (let i = from; i < d.length; i++) if (Math.abs(d[i]) > level) return i;
  return -1;
}
