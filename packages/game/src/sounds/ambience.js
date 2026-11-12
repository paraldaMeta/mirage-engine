// Mirage original code. Ambience loops of the sound library (@miragekit/game/sounds): rain on a street and on a tin
// roof, a city's far traffic, wind with gusts, an empty room's tone, a neon sign's hum, a vent, a server room, a
// crowd's murmur, the sea, a night of crickets, fire. Each is a few seconds of stereo-free mono folded into a seamless
// loop (its end cross-faded into its start) at 0.7 of full scale: play them with audio.loop at a low gain, and layer
// two or three for a place. Nothing in them repeats on a short cycle except what the loop's length implies.
import { TAU, biquad, chain, noiseLayer, modesLayer, toneLayer, fold } from './synth.js';

/** band-limited noise for the whole buffer, its level shaped by gain(t) */
function bed(o, SR, R, filter, gain) { for (let i = 0; i < o.length; i++) o[i] += filter(R() * 2 - 1) * gain(i / SR); }
/** a slow random curve (smoothed noise), 0..1, for gusts and swells: k values a second */
function drift(R, sec, k = 1.5) { const n = Math.ceil(sec * k) + 3, p = Array.from({ length: n }, () => R()); return (t) => { const x = t * k, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return p[i % n] * (1 - s) + p[(i + 1) % n] * s; }; }

function rain(o, SR, R) {
  const sec = o.length / SR;
  bed(o, SR, R, chain(biquad('hp', 400, 0.7, SR), biquad('lp', 7000, 0.7, SR)), () => 0.35);   // the hiss of a thousand drops
  bed(o, SR, R, biquad('bp', 2500, 0.5, SR), () => 0.25);
  for (let k = 0, n = Math.round(sec * 70); k < n; k++) { const f = 2000 + R() * 6000; modesLayer(o, SR, R, R() * sec, [[f, 0.002 + R() * 0.004, 1]], 0.08 + R() * 0.12, 0.6); }   // near drops
  for (let k = 0, n = Math.round(sec * 3); k < n; k++) noiseLayer(o, SR, R, R() * sec, 0.25, biquad('bp', 900 + R() * 600, 1.5, SR), 0.02, 0.06, 0.12);   // a gutter's splatter
}
function rainRoof(o, SR, R) {
  const sec = o.length / SR;
  bed(o, SR, R, chain(biquad('hp', 800, 0.7, SR), biquad('lp', 9000, 0.7, SR)), () => 0.18);
  for (let k = 0, n = Math.round(sec * 220); k < n; k++) { const f = 1100 + R() * 2400; modesLayer(o, SR, R, R() * sec, [[f, 0.01 + R() * 0.02, 1], [f * 2.3, 0.006, 0.4]], 0.06 + R() * 0.1, 0.3); }   // drops on corrugated tin
}
function city(o, SR, R) {
  const sec = o.length / SR, swell = drift(R, sec, 0.4);
  bed(o, SR, R, chain(biquad('lp', 180, 0.7, SR), biquad('lp', 260, 0.7, SR)), (t) => 1.6 * (0.6 + 0.4 * swell(t)));   // the rumble of traffic, near and far
  bed(o, SR, R, biquad('bp', 700, 0.4, SR), (t) => 0.1 * (0.5 + swell(t + 3)));
  for (let k = 0, n = Math.round(sec / 2.5); k < n; k++) {   // a car passing somewhere: a band that swells and goes
    const t0 = R() * sec, f = 300 + R() * 300, bp = biquad('bp', f, 1.2, SR), i0 = Math.floor(t0 * SR), len = Math.floor(3 * SR);
    for (let i = 0; i < len && i0 + i < o.length; i++) { const u = i / len; o[i0 + i] += bp(R() * 2 - 1) * Math.sin(Math.PI * u) ** 2 * 0.25; }
  }
  for (let k = 0, n = Math.round(sec / 6); k < n; k++) toneLayer(o, SR, R() * sec, 0.6, 410 + R() * 80, 0.03, 0.15, 0.02, { harm: [[1, 1], [1.26, 0.8], [2, 0.3]], hold: 0.25 });   // a far horn
}
function wind(o, SR, R) {
  const sec = o.length / SR, gust = drift(R, sec, 0.6), whistle = drift(R, sec, 0.25);
  const lp = biquad('lp', 500, 0.7, SR), bp1 = biquad('bp', 900, 6, SR), bp2 = biquad('bp', 1350, 8, SR);
  for (let i = 0; i < o.length; i++) {
    const t = i / SR, g = 0.3 + 0.7 * gust(t) ** 2, x = R() * 2 - 1;
    o[i] += lp(x) * g * 1.4 + (bp1(x) * 0.6 + bp2(x) * 0.4) * g * whistle(t) * 1.2;   // a body and an edge that whistles in the gusts
  }
}
function roomTone(o, SR, R) {
  bed(o, SR, R, chain(biquad('lp', 300, 0.7, SR), biquad('hp', 40, 0.7, SR)), () => 0.7);
  for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] += Math.sin(TAU * 50 * t) * 0.03 + Math.sin(TAU * 100 * t) * 0.015; }   // mains under everything
}
function neonHum(o, SR, R) {
  const flick = drift(R, o.length / SR, 3);
  for (let i = 0; i < o.length; i++) {
    const t = i / SR, b = 0.85 + 0.15 * flick(t);
    o[i] += (Math.sin(TAU * 100 * t) * 0.5 + Math.sin(TAU * 200 * t) * 0.3 + Math.sin(TAU * 300 * t) * 0.15 + Math.sign(Math.sin(TAU * 100 * t)) * 0.05) * b;   // the ballast at twice the mains
  }
  bed(o, SR, R, biquad('bp', 7800, 4, SR), (t) => 0.06 * flick(t + 1));   // the gas's fizz
}
function vent(o, SR, R) {
  const wob = drift(R, o.length / SR, 0.8);
  bed(o, SR, R, chain(biquad('hp', 600, 0.7, SR), biquad('peak', 3000, 1, SR, 4)), (t) => 0.5 * (0.8 + 0.2 * wob(t)));
  for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] += Math.sin(TAU * 87 * t) * 0.08 + Math.sin(TAU * 174 * t) * 0.03; }   // the fan's motor
}
function servers(o, SR, R) {
  bed(o, SR, R, chain(biquad('hp', 300, 0.7, SR), biquad('lp', 5000, 0.7, SR)), () => 0.35);
  for (const f of [118, 236, 1840, 2960]) for (let i = 0; i < o.length; i++) o[i] += Math.sin(TAU * f * i / SR) * (f > 1000 ? 0.01 : 0.05);   // fans at speed
  const sec = o.length / SR;
  for (let k = 0, n = Math.round(sec * 6); k < n; k++) noiseLayer(o, SR, R, R() * sec, 0.03, biquad('bp', 3500, 3, SR), 0.001, 0.005, 0.08);   // drives seeking
}
function crowd(o, SR, R) {
  const sec = o.length / SR, F = [[500, 1500], [700, 1200], [350, 2300], [600, 1000], [300, 2700]];   // vowel formants (F1, F2)
  for (let v = 0; v < 14; v++) {   // fourteen voices, each a buzz through changing vowels, syllables at 4-6 a second
    const f0 = 100 + R() * 140, rate = 4 + R() * 2, gain = 0.05 + R() * 0.05, lag = R() * 10, talk = drift(R, sec, 0.5);
    const a1 = biquad('bp', F[v % 5][0], 3, SR), a2 = biquad('bp', F[v % 5][1], 4, SR); let ph = 0;
    for (let i = 0; i < o.length; i++) {
      const t = i / SR; ph += TAU * f0 * (1 + 0.04 * Math.sin(TAU * 0.7 * t + v)) / SR;
      const syl = Math.max(0, Math.sin(TAU * rate * t + lag)) ** 2 * (talk(t) > 0.45 ? 1 : 0.1), src = (ph / TAU % 1) * 2 - 1;
      o[i] += (a1(src) + a2(src) * 0.6) * syl * gain;
    }
  }
  bed(o, SR, R, biquad('bp', 800, 0.4, SR), () => 0.08);   // the room under them
}
function sea(o, SR, R) {
  const sec = o.length / SR, lp = biquad('lp', 1200, 0.7, SR), hp = biquad('hp', 2500, 0.7, SR);
  for (let i = 0; i < o.length; i++) {
    const t = i / SR, wave = (Math.sin(TAU * t / (sec / Math.round(sec / 6))) * 0.5 + 0.5) ** 3, x = R() * 2 - 1;   // a wave every ~6 s, whole waves in the loop
    o[i] += lp(x) * (0.35 + 0.9 * wave) + hp(x) * 0.5 * wave * wave;   // the swell, and the hiss as it breaks
  }
}
function crickets(o, SR, R) {
  const sec = o.length / SR;
  for (let c = 0; c < 7; c++) {   // seven crickets: a 4-5 kHz chirp of 3-4 pulses, every 0.5-1 s, each at its own distance
    const f = 4200 + R() * 900, every = 0.5 + R() * 0.5, g = 0.08 + R() * 0.12, off = R() * every;
    for (let t = off; t < sec; t += every * (0.95 + R() * 0.1)) for (let p = 0; p < 3 + (c % 2); p++) toneLayer(o, SR, t + p * 0.022, 0.02, f, 0.002, 0.004, g, { harm: [[1, 1], [2, 0.2]], hold: 0.008 });
  }
  bed(o, SR, R, biquad('lp', 400, 0.7, SR), () => 0.15);   // the night's air
}
function fire(o, SR, R) {
  const sec = o.length / SR, roar = drift(R, sec, 1.2);
  bed(o, SR, R, chain(biquad('lp', 600, 0.7, SR), biquad('hp', 60, 0.7, SR)), (t) => 0.9 * (0.6 + 0.4 * roar(t)));   // the flames' roar
  for (let k = 0, n = Math.round(sec * 14); k < n; k++) noiseLayer(o, SR, R, R() * sec, 0.02, biquad('hp', 1500 + R() * 3000, 0.7, SR), 0.0002, 0.002 + R() * 0.004, 0.4 + R() * 0.6);   // crackles
  for (let k = 0, n = Math.round(sec * 0.6); k < n; k++) modesLayer(o, SR, R, R() * sec, [[700 + R() * 400, 0.03, 1]], 0.3, 1.2);   // a log settling
}

/** name -> { cat, n, loop, render, desc } */
export const AMBIENCE_SOUNDS = {};
const add = (name, sec, fn, desc) => { AMBIENCE_SOUNDS[name] = { cat: 'ambience', n: 1, loop: true, desc, render: fold(name, sec, fn) }; };
add('amb_rain', 8, rain, 'rain on a street: hiss, near drops, a gutter (loop)');
add('amb_rain_roof', 6, rainRoof, 'rain on a tin roof (loop)');
add('amb_city', 12, city, "a city's far traffic and the odd horn (loop)");
add('amb_wind', 10, wind, 'wind with gusts and a whistle (loop)');
add('amb_room', 4, roomTone, "an empty room's tone (loop)");
add('amb_neon_hum', 4, neonHum, "a neon sign's hum and fizz (loop)");
add('amb_vent', 5, vent, 'a ventilation fan and its air (loop)');
add('amb_servers', 6, servers, 'a server room (loop)');
add('amb_crowd', 8, crowd, "a crowd's murmur, no words (loop)");
add('amb_sea', 12, sea, 'the sea, a wave every few seconds (loop)');
add('amb_crickets', 8, crickets, 'a night of crickets (loop)');
add('amb_fire', 6, fire, 'a fire: roar, crackles, a log settling (loop)');
