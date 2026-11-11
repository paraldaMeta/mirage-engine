// Every sound of the audio demo and of its checks, made in code (nothing is downloaded): plain arithmetic on
// Float32Arrays, so Node writes the two .wav files in fx/ with the same functions the page plays from memory.
import { sfc32, hash32 } from '@miragekit/core/rng';

export const SR = 48000;
const TAU = Math.PI * 2;
const buf = (sec, sr = SR) => new Float32Array(Math.round(sec * sr));
/** attack / release envelope in seconds over n samples */
const env = (i, n, a, r, sr) => Math.min(1, i / (a * sr), (n - i) / (r * sr));

export function sine(freq, sec, amp = 1, sr = SR) { const d = buf(sec, sr); for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((TAU * freq * i) / sr); return d; }
export function noise(sec, amp = 1, seed = 'noise', sr = SR) { const d = buf(sec, sr), R = sfc32(hash32(seed)); for (let i = 0; i < d.length; i++) d[i] = amp * (R() * 2 - 1); return d; }
export function impulse(sec, at = 0, amp = 1, sr = SR) { const d = buf(sec, sr); d[Math.round(at * sr)] = amp; return d; }
/** value = position / length: a looping voice's place in its buffer can be read off the output */
export function rampUp(sec, sr = SR) { const d = buf(sec, sr); for (let i = 0; i < d.length; i++) d[i] = i / d.length; return d; }

/** a hum for machines: a few harmonics with a slow wobble; loops without a seam (whole periods) */
export function hum(freq = 110, sec = 2, sr = SR) {
  const d = buf(sec, sr), f = Math.round(freq * sec) / sec;
  for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = 0.35 * Math.sin(TAU * f * t) + 0.2 * Math.sin(TAU * 2 * f * t + 1) + 0.1 * Math.sin(TAU * 3 * f * t + 2) * (0.6 + 0.4 * Math.sin((TAU * t) / sec)); }
  return d;
}
/** a steady tone with bright harmonics, for the circling siren (Doppler is easy to hear on it) */
export function siren(freq = 880, sec = 1, sr = SR) {
  const d = buf(sec, sr), f = Math.round(freq * sec) / sec;
  for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = 0.3 * Math.sin(TAU * f * t) + 0.12 * Math.sin(TAU * 2 * f * t) + 0.06 * Math.sin(TAU * 3 * f * t); }
  return d;
}
/** a footstep: a low thump and a burst of filtered noise; `k` picks the variant */
export function step(k = 0, sr = SR) {
  const d = buf(0.16, sr), R = sfc32(hash32('step' + k));
  let lp = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr, e = Math.exp(-t * (34 + k * 5));
    lp += ((R() * 2 - 1) - lp) * (0.25 + 0.08 * k);
    d[i] = (0.7 * Math.sin(TAU * (78 + k * 9) * t) * Math.exp(-t * 40) + 0.6 * lp) * e * Math.min(1, i / 48);
  }
  return d;
}
/** a struck bell: inharmonic partials that die away */
export function chime(freq = 660, sec = 0.9, sr = SR) {
  const d = buf(sec, sr), P = [[1, 1, 4], [2.76, 0.5, 6], [5.4, 0.25, 9], [8.9, 0.12, 13]];
  for (let i = 0; i < d.length; i++) { const t = i / sr; let s = 0; for (const [m, a, k] of P) s += a * Math.sin(TAU * freq * m * t) * Math.exp(-t * k); d[i] = 0.45 * s * env(i, d.length, 0.002, 0.03, sr); }
  return d;
}
/** something like a voice: a buzz through two moving formants, in syllables */
export function speech(sec = 1.6, seed = 'voice', sr = SR) {
  const d = buf(sec, sr), R = sfc32(hash32(seed));
  let ph = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, syl = 0, f1 = 600, f2 = 1400, len = 0;
  for (let i = 0; i < d.length; i++) {
    if (i >= syl + len) { syl = i; len = Math.round((0.12 + 0.14 * R()) * sr); f1 = 350 + 500 * R(); f2 = 1000 + 1300 * R(); }
    const k = (i - syl) / len, e = Math.sin(Math.PI * Math.min(k * 1.15, 1)) ** 0.7;
    ph += (118 + 14 * Math.sin(k * 3)) / sr; ph -= Math.floor(ph);
    const x = (ph * 2 - 1) * e;
    // two resonators (state-variable band-passes)
    const g1 = (2 * Math.sin((Math.PI * f1) / sr)), g2 = (2 * Math.sin((Math.PI * f2) / sr));
    b1 += g1 * (x - c1 - 0.25 * b1); c1 += g1 * b1;
    b2 += g2 * (x - c2 - 0.2 * b2); c2 += g2 * b2;
    d[i] = 0.22 * (b1 + 0.7 * b2) * env(i, d.length, 0.01, 0.05, sr);
  }
  return d;
}
const note = (n) => 440 * 2 ** ((n - 69) / 12);
/** music stems, each exactly `bars` bars of 4 beats at `bpm`, so they loop together on the bar line */
export function stem(kind, { bpm = 100, bars = 2, root = 57, sr = SR } = {}) {
  const beat = 60 / bpm, d = buf(bars * 4 * beat, sr), R = sfc32(hash32('stem/' + kind));
  const add = (at, len, fn) => { const i0 = Math.round(at * sr), n = Math.min(Math.round(len * sr), d.length - i0); for (let i = 0; i < n; i++) d[i0 + i] += fn(i / sr, i, n); };
  if (kind === 'pad') {
    const chords = [[0, 7, 12, 15], [-4, 3, 8, 12]];
    for (let b = 0; b < bars; b++) for (const iv of chords[b % 2]) {
      const f = note(root + iv), det = 1 + (R() - 0.5) * 0.004;
      add(b * 4 * beat, 4 * beat, (t, i, n) => 0.09 * (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * det * 2 * t)) * env(i, n, 0.25, 0.3, sr));
    }
  } else if (kind === 'bass') {
    for (let q = 0; q < bars * 8; q++) if (q % 8 !== 7) {
      const f = note(root - 24 + (Math.floor(q / 8) % 2 ? -4 : 0) + (q % 4 === 3 ? 7 : 0));
      add(q * beat / 2, beat * 0.45, (t, i, n) => 0.3 * Math.tanh(2 * Math.sin(TAU * f * t)) * Math.exp(-t * 5) * env(i, n, 0.004, 0.02, sr));
    }
  } else if (kind === 'drums') {
    for (let q = 0; q < bars * 8; q++) {
      if (q % 4 === 0) add(q * beat / 2, 0.22, (t) => 0.8 * Math.sin(TAU * (48 + 90 * Math.exp(-t * 28)) * t) * Math.exp(-t * 14));       // kick
      if (q % 4 === 2) add(q * beat / 2, 0.16, (t) => 0.32 * (R() * 2 - 1) * Math.exp(-t * 26) + 0.25 * Math.sin(TAU * 190 * t) * Math.exp(-t * 30));   // snare
      add(q * beat / 2, 0.05, (t) => 0.1 * (R() * 2 - 1) * Math.exp(-t * 90));                                                              // hat
    }
  } else if (kind === 'lead') {
    const tune = [12, 15, 19, 15, 12, 10, 8, 10, 12, 15, 17, 19, 20, 19, 15, 12];
    for (let q = 0; q < bars * 8; q++) {
      const f = note(root + tune[q % tune.length]);
      add(q * beat / 2, beat * 0.5, (t, i, n) => 0.12 * (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 3 * f * t)) * Math.exp(-t * 4) * env(i, n, 0.005, 0.03, sr));
    }
  } else throw new Error('stem: ' + kind);
  return d;
}
/** the tune that is streamed from a file: pad + bass + lead, mixed down */
export function theme({ bpm = 100, bars = 4, sr = 16000 } = {}) {
  const a = stem('pad', { bpm, bars, sr }), b = stem('bass', { bpm, bars, sr }), c = stem('lead', { bpm, bars, sr });
  for (let i = 0; i < a.length; i++) a[i] = Math.tanh(1.2 * (a[i] + b[i] + c[i]));
  return a;
}
