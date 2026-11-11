// Mirage original code. Vehicles in the sound library (@miragekit/game/sounds): a car and a hover car passing (with
// the Doppler shift and the swell of distance), an electric car's whine and a petrol engine idling (loops), a horn,
// a car alarm (loop), a far siren (loop), a train passing, tyres skidding. A pass is rendered from a path: the source
// goes by at `speed` m/s, `miss` m from the listener; its pitch is f * c / (c - v_r) and its level 1 / distance.
import { TAU, biquad, chain, noiseLayer, toneLayer, one, fold } from './synth.js';

const C = 343;
/** per sample: { k (Doppler ratio), g (level, 1 at the closest point) } of a source passing at `speed`, closest at t0 */
function pass(SR, n, speed, miss, t0) {
  const k = new Float32Array(n), g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = (t - t0) * speed, d = Math.hypot(x, miss), vr = -speed * x / d;   // closing speed (positive while it comes)
    k[i] = C / (C - vr); g[i] = miss / d;
  }
  return { k, g };
}
function carPass(o, SR, R, v) {
  const n = o.length, { k, g } = pass(SR, n, 18 + v * 6, 3, n / SR / 2), lp = biquad('lp', 900, 0.7, SR), road = chain(biquad('bp', 700, 0.5, SR), biquad('lp', 2200, 0.7, SR));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += TAU * 42 * k[i] / SR;   // the engine's firing, Doppler-shifted
    const eng = Math.sin(ph) + 0.6 * Math.sin(ph * 2) + 0.35 * Math.sin(ph * 3) + 0.2 * Math.sign(Math.sin(ph * 4)), x = R() * 2 - 1;
    o[i] += (lp(eng) * 0.6 + road(x) * 1.4) * g[i] ** 1.4;   // engine and tyre roar, louder as it nears
  }
}
function hoverPass(o, SR, R, v) {
  const n = o.length, { k, g } = pass(SR, n, 30 + v * 8, 4, n / SR / 2), air = biquad('bp', 1800, 0.8, SR);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    p1 += TAU * 320 * k[i] / SR; p2 += TAU * 487 * k[i] / SR;   // two turbines, a fifth apart-ish, beating
    o[i] += ((Math.sin(p1) + 0.4 * Math.sin(p1 * 2)) * 0.5 + Math.sin(p2) * 0.35 + air(R() * 2 - 1) * 1.2) * g[i] ** 1.6;
  }
}
function evWhine(o, SR, R) { for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] += Math.sin(TAU * 520 * t) * 0.3 + Math.sin(TAU * 1040 * t) * 0.15 + Math.sin(TAU * 1560 * t) * 0.06; } noiseLayer(o, SR, R, 0, o.length / SR, biquad('bp', 900, 0.6, SR), 0.001, 1e4, 0.3); }
function idle(o, SR, R) {   // a four-cylinder at about 800 rpm: 26.7 firings a second, each a damped thump with a little jitter
  const lp = biquad('lp', 600, 0.7, SR);
  for (let t = 0; t < o.length / SR; t += 1 / 26.67) { const i0 = Math.floor((t + (R() - 0.5) * 0.002) * SR), a = 0.8 + R() * 0.3; for (let i = 0; i < 0.03 * SR && i0 + i < o.length; i++) { const u = i / SR; o[i0 + i] += Math.sin(TAU * 90 * u) * Math.exp(-u / 0.008) * a; } }
  for (let i = 0; i < o.length; i++) o[i] = lp(o[i]) + (R() * 2 - 1) * 0.02;
}
function horn(o, SR) { for (const f of [415, 523]) toneLayer(o, SR, 0, 0.7, f, 0.01, 0.04, 0.5, { harm: [[1, 1], [2, 0.6], [3, 0.45], [4, 0.3], [5, 0.2]], hold: 0.55 }); }   // two reeds a major third apart
function carAlarm(o, SR) {   // a warble then a whoop, the classic two-part cycle
  let ph = 0;
  for (let i = 0; i < o.length; i++) { const t = i / SR, u = t % 2, f = u < 1 ? 1100 + 300 * Math.sign(Math.sin(TAU * 8 * u)) : 700 + 900 * ((u - 1) % 0.25) / 0.25; ph += TAU * f / SR; o[i] += Math.tanh(Math.sin(ph) * 3) * 0.5; }
}
function sirenFar(o, SR, R) {
  let ph = 0; const lp = biquad('lp', 1400, 0.7, SR);
  for (let i = 0; i < o.length; i++) { const t = i / SR, f = 700 + 350 * Math.sin(TAU * t / 3); ph += TAU * f / SR; o[i] += lp(Math.sin(ph) + 0.3 * Math.sin(ph * 2)) * 0.5 * (0.7 + 0.3 * Math.sin(TAU * t / 6)); }   // far: dull, slow, wavering
  noiseLayer(o, SR, R, 0, o.length / SR, biquad('lp', 300, 0.7, SR), 0.001, 1e4, 0.4);
}
function train(o, SR, R) {   // a train passing: a rumble that swells and fades, the wheels' clatter over rail joints in pairs
  const n = o.length, sec = n / SR, rumble = chain(biquad('lp', 160, 0.7, SR), biquad('lp', 250, 0.7, SR));
  for (let i = 0; i < n; i++) { const t = i / SR, sw = Math.sin(Math.PI * t / sec) ** 2; o[i] += rumble(R() * 2 - 1) * sw * 3 + (R() * 2 - 1) * 0.05 * sw; }
  for (let t = 0.2; t < sec - 0.2; t += 0.42) for (const d of [0, 0.09]) { const sw = Math.sin(Math.PI * (t + d) / sec) ** 2; noiseLayer(o, SR, R, t + d, 0.06, biquad('bp', 700 + R() * 300, 1.5, SR), 0.001, 0.015, 0.8 * sw); }
}
function skid(o, SR, R) {   // tyres losing grip: a squeal with a rough edge, sliding down in pitch
  toneLayer(o, SR, 0, 1.0, (t) => 1600 - 500 * t, 0.03, 0.12, 0.6, { harm: [[1, 1], [2, 0.3], [2.5, 0.25]], vib: [37, 0.02], hold: 0.75 });
  noiseLayer(o, SR, R, 0, 1.0, biquad('bp', 2200, 1, SR), 0.03, 0.2, 0.4);
}

/** name -> { cat, n, render, loop?, desc } */
export const VEHICLE_SOUNDS = {};
const add = (name, n, sec, fn, desc) => { VEHICLE_SOUNDS[name] = { cat: 'vehicle', n, desc, render: one(name, sec, fn) }; };
const loop = (name, sec, fn, desc, opts) => { VEHICLE_SOUNDS[name] = { cat: 'vehicle', n: 1, loop: true, desc, render: fold(name, sec, fn, opts) }; };
add('car_pass', 2, 5, carPass, 'a car passing at 65-85 km/h, 3 m away');
add('hover_pass', 2, 4, hoverPass, 'a hover car passing fast overhead');
loop('ev_whine', 2, evWhine, "an electric car's motor whine (loop)");
loop('engine_idle', 3, idle, 'a petrol engine idling (loop)');
add('horn', 1, 0.8, horn, 'a car horn');
loop('car_alarm', 4, carAlarm, 'a car alarm: warble and whoop (loop)', { over: 0.05, level: 0.6 });
loop('siren_far', 6, sirenFar, 'a siren far off (loop)');
add('train_pass', 2, 8, train, 'a train passing');
add('skid', 1, 1.2, skid, 'tyres skidding');
