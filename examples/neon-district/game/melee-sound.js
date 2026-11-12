// The sounds of close combat, made in code like the rest (sfx.js renders each once, at the first gesture):
// the draw's quiet click and the breath after it, the blade leaving the scabbard, a swing, a cut landing, the slow
// return ending in a bright click, a parry, a punch, the ground struck, the air drawn in, and a short shout (a robot's
// voice: a pulse train through vowel resonances, ring-modulated; no recordings).
// name: [seconds, fill(d, SR, noise, lp)], or a list of those (variants)
const TAU = Math.PI * 2;
/** a two-pole resonator at f Hz, bandwidth bw */
const reson = (f, bw, SR) => { const r = Math.exp(-Math.PI * bw / SR), a1 = -2 * r * Math.cos(TAU * f / SR), a2 = r * r, g = 1 - r; let y1 = 0, y2 = 0; return (x) => { const y = g * x - a1 * y1 - a2 * y2; y2 = y1; y1 = y; return y; }; };
const ring = (d, SR, t0, parts, amp, dec) => { for (let i = Math.floor(t0 * SR); i < d.length; i++) { const t = i / SR - t0; let s = 0; for (const [f, a] of parts) s += a * Math.sin(TAU * f * t); d[i] += amp * s * Math.exp(-t / dec); } };
const shout = (f0, f1) => [0.62, (d, SR, noise) => {
  const F = [[780, 90, 1], [1220, 110, 0.6], [2600, 180, 0.25]].map(([f, bw, a]) => [reson(f, bw, SR), a]);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR, u = t / 0.62, f = f0 + (f1 - f0) * Math.min(1, u * 1.6);
    ph += f / SR; const pulse = ph % 1 < 0.08 ? 1 : 0;
    const env = Math.min(1, t / 0.025) * (t < 0.3 ? 1 : Math.exp(-(t - 0.3) / 0.09));
    let s = 0; const x = pulse * 2 + noise() * 0.25 * Math.exp(-t / 0.05);
    for (const [r, a] of F) s += r(x) * a;
    d[i] = Math.tanh(s * 9 * (0.75 + 0.25 * Math.sin(TAU * 55 * t))) * env * 0.7;
  }
}];
export const MELEE_SOUNDS = {
  md_click: [0.2, (d, SR, noise) => { ring(d, SR, 0, [[2650, 1], [4100, 0.4]], 0.25, 0.008); ring(d, SR, 0.045, [[1800, 1], [3300, 0.5]], 0.2, 0.012); for (let i = 0; i < 0.004 * SR; i++) d[i] += noise() * 0.3; }],
  md_breath: [0.45, (d, SR, noise) => { const b = reson(1300, 900, SR); for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = b(noise()) * 1.6 * Math.sin(Math.PI * Math.min(1, t / 0.45)) ** 1.5; } }],
  md_draw: [0.55, (d, SR, noise, lp) => { const l = lp(0.5); for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); d[i] = (x - l(x)) * 0.5 * Math.exp(-t / 0.06); } ring(d, SR, 0.01, [[3150, 1], [4720, 0.7], [6900, 0.35]], 0.22, 0.18); }],
  md_swish: [0.3, (d, SR, noise) => { for (let i = 0, b = null; i < d.length; i++) { const t = i / SR; if (i % 64 === 0) b = reson(500 + 3000 * (t / 0.3), 1400, SR); d[i] = b(noise()) * 2.2 * Math.sin(Math.PI * t / 0.3) ** 2; } }],
  md_slash: [0.4, (d, SR, noise, lp) => { const l = lp(0.08); for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); d[i] = Math.tanh((x * Math.exp(-t / 0.012) + l(x) * 3 * Math.exp(-t / 0.08) + Math.sin(TAU * (95 - 60 * t) * t) * Math.exp(-t / 0.07)) * 1.5) * 0.7; } }],
  md_chin: [0.6, (d, SR, noise) => { ring(d, SR, 0, [[5230, 1], [7810, 0.5], [3120, 0.3]], 0.3, 0.09); for (let i = 0; i < 0.003 * SR; i++) d[i] += noise() * 0.4; }],
  md_clang: [0.6, (d, SR, noise) => { ring(d, SR, 0, [[1870, 1], [2950, 0.8], [4410, 0.6], [6130, 0.4]], 0.22, 0.14); for (let i = 0; i < 0.01 * SR; i++) d[i] += noise() * 0.5 * (1 - i / (0.01 * SR)); }],
  md_thud: [0.25, (d, SR, noise, lp) => { const l = lp(0.1); for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = Math.tanh(Math.sin(TAU * (110 - 140 * t) * t) * 1.6 * Math.exp(-t / 0.05) + l(noise()) * 2 * Math.exp(-t / 0.03)) * 0.7; } }],
  md_rumble: [1.0, (d, SR, noise, lp) => { const l = lp(0.02), l2 = lp(0.2); for (let i = 0; i < d.length; i++) { const t = i / SR, x = noise(); d[i] = Math.tanh(l(x) * 9 * Math.exp(-t / 0.35) + l2(x) * 1.2 * Math.exp(-t / 0.04)) * 0.8; } }],
  md_wind: [0.7, (d, SR, noise) => { for (let i = 0, b = null; i < d.length; i++) { const t = i / SR; if (i % 64 === 0) b = reson(300 + 1400 * (t / 0.7) ** 2, 500, SR); d[i] = b(noise()) * 2.4 * Math.sin(Math.PI * t / 0.7); } }],
  md_shout: [shout(230, 160), shout(205, 140)],   // two voices: a list of variants
  md_roar: [shout(120, 82), shout(105, 74)],      // the heavy chassis' voice, an octave down
};
