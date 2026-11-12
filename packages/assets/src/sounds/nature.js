// Mirage original code. Nature in the sound library (@miragekit/assets/sounds): thunder near and far, a water drip, a
// splash, a stone dropped into water, a gust of wind, a bird's call, branches cracking, a body of debris settling,
// glass shattering, wood breaking, a heavy fall. One-shots; the loops of rain, wind, sea, crickets and fire are in
// the ambience.
import { biquad, chain, noiseLayer, thumpLayer, modesLayer, toneLayer, room, makeRng, hash, one } from '@miragekit/game/sounds';

function thunder(o, SR, R, v, far) {
  // the crack (near only), then a rolling rumble: many low bursts of noise strewn over two seconds, under a long body
  if (!far) { noiseLayer(o, SR, R, 0, 0.05, chain(biquad('hp', 800, 0.7, SR), biquad('lp', 6000, 0.7, SR)), 0.0005, 0.012, 1.4); thumpLayer(o, SR, 0, 70, 30, 0.2, 0.002, 0.4, 1.2, 2); }
  const body = chain(biquad('lp', far ? 140 : 260, 0.7, SR), biquad('lp', far ? 200 : 400, 0.7, SR));
  for (let i = 0; i < o.length; i++) { const t = i / SR, sw = Math.min(1, t / (far ? 0.6 : 0.15)) * Math.exp(-t / (far ? 1.8 : 1.4)); o[i] += body(R() * 2 - 1) * sw * 5; }
  for (let k = 0; k < 18; k++) { const t0 = (far ? 0.3 : 0.05) + R() * 2.2; noiseLayer(o, SR, R, t0, 0.5, biquad('lp', 200 + R() * 300, 0.7, SR), 0.03, 0.12, (far ? 1.2 : 2) * Math.exp(-t0 / 1.5)); }
}
function drip(o, SR, R, v) {   // a drop into a pool: a falling "plink" (a bubble's resonance rising in pitch), tiny
  const f = 900 + v * 250 + R() * 100;
  toneLayer(o, SR, 0.001, 0.08, (t) => f * (1 + 6 * t), 0.0005, 0.015, 0.8);
  noiseLayer(o, SR, R, 0, 0.01, biquad('hp', 3000, 0.7, SR), 0.0002, 0.002, 0.2);
}
function splash(o, SR, R) {   // something heavy into water: the hit, the crown of spray, drops falling back
  thumpLayer(o, SR, 0, 120, 55, 0.02, 0.001, 0.06, 0.9);
  noiseLayer(o, SR, R, 0.002, 0.6, chain(biquad('bp', 1100, 0.5, SR), biquad('peak', 3500, 1, SR, 5)), 0.005, 0.12, 1.3);
  for (let k = 0; k < 24; k++) { const t0 = 0.15 + R() * 0.7, f = 700 + R() * 1800; toneLayer(o, SR, t0, 0.05, (t) => f * (1 + 5 * t), 0.0005, 0.012, 0.12 * (1 - t0)); }
}
function stoneWater(o, SR, R) { toneLayer(o, SR, 0.002, 0.15, (t) => 500 * (1 + 4 * t), 0.001, 0.03, 0.8); noiseLayer(o, SR, R, 0, 0.12, biquad('bp', 1600, 1, SR), 0.002, 0.03, 0.45); }   // the "bloop" of a stone
function gust(o, SR, R) {
  const lp = biquad('lp', 700, 0.7, SR), bp = biquad('bp', 1300, 5, SR);
  for (let i = 0; i < o.length; i++) { const t = i / SR, e = Math.sin(Math.PI * Math.min(1, t / 2.2)) ** 2, x = R() * 2 - 1; o[i] += (lp(x) * 1.2 + bp(x) * 0.8 * e) * e; }
}
function bird(o, SR, R, v) {   // a small songbird's call: a few fast down-sweeping whistles, then a trill
  let t = 0;
  for (let k = 0; k < 3 + v; k++) { const f0 = 3800 + R() * 1200, d = 0.06 + R() * 0.04; toneLayer(o, SR, t, d + 0.01, (u) => f0 * (1 - 0.35 * u / d), 0.004, 0.012, 0.5, { harm: [[1, 1], [2, 0.08]], hold: d * 0.6 }); t += d + 0.04; }
  toneLayer(o, SR, t, 0.35, 3200 + v * 300, 0.01, 0.06, 0.35, { vib: [28, 0.08], hold: 0.25 });
}
function branch(o, SR, R) {   // wood cracking: a dry snap, splintering fibres, the piece falling
  noiseLayer(o, SR, R, 0, 0.03, biquad('bp', 2200, 1, SR), 0.0003, 0.006, 1.2);
  for (let k = 0; k < 10; k++) modesLayer(o, SR, R, 0.005 + R() * 0.12, [[600 + R() * 900, 0.01, 1]], 0.25, 1.2);
  thumpLayer(o, SR, 0.38, 130, 70, 0.02, 0.001, 0.05, 0.5); noiseLayer(o, SR, R, 0.38, 0.15, biquad('lp', 1500, 0.7, SR), 0.002, 0.04, 0.4);
}
function debris(o, SR, R) {   // rubble settling: stones and grit trickling, slower and sparser toward the end
  for (let k = 0; k < 60; k++) { const t0 = Math.pow(R(), 1.7) * 1.8, f = 900 + R() * 3500, a = 0.4 * Math.exp(-t0 / 0.8) * (0.4 + R()); modesLayer(o, SR, R, t0, [[f, 0.006 + R() * 0.012, 1], [f * 1.7, 0.004, 0.5]], a, 0.9); }
  noiseLayer(o, SR, R, 0, 1.5, biquad('lp', 1200, 0.7, SR), 0.01, 0.5, 0.35);
}
function glassBreak(o, SR, R) {   // a pane shattering: the break, many shards ringing as they hit, a tinkling tail
  noiseLayer(o, SR, R, 0, 0.05, biquad('hp', 2500, 0.7, SR), 0.0003, 0.012, 1.3);
  thumpLayer(o, SR, 0, 300, 140, 0.01, 0.0005, 0.03, 0.4);
  for (let k = 0; k < 70; k++) { const t0 = Math.pow(R(), 1.4) * 1.1, f = 2500 + R() * 7000; modesLayer(o, SR, R, t0, [[f, 0.01 + R() * 0.04, 1], [f * 1.41, 0.008, 0.4]], 0.3 * Math.exp(-t0 / 0.5), 0.3); }
}
function woodBreak(o, SR, R) { thumpLayer(o, SR, 0, 160, 80, 0.015, 0.001, 0.05, 0.9); noiseLayer(o, SR, R, 0, 0.08, biquad('bp', 1200, 0.8, SR), 0.0005, 0.02, 1.0); for (let k = 0; k < 8; k++) modesLayer(o, SR, R, 0.02 + R() * 0.25, [[350 + R() * 500, 0.03, 1], [900 + R() * 600, 0.015, 0.4]], 0.35, 1.0); }   // a crate or a door smashed
function fall(o, SR, R, v) {   // a heavy body or a sack hitting the floor: a deep thud, a slap of cloth, a settle
  thumpLayer(o, SR, 0, 85 - v * 8, 40, 0.03, 0.002, 0.1, 1.2);
  noiseLayer(o, SR, R, 0.002, 0.12, biquad('lp', 1200, 0.7, SR), 0.002, 0.03, 0.8);
  thumpLayer(o, SR, 0.16, 70, 40, 0.02, 0.002, 0.05, 0.35);
}
/** thunder in the open (a long room) */
const thunderRoom = (far) => (o, SR, R, v) => { thunder(o, SR, R, v, far); const wet = room(o, SR, 'open', makeRng(hash('thunder' + far + v))); for (let i = 0; i < o.length; i++) o[i] += wet[i] * 0.8; };

/** name -> { cat, n, render, desc } */
export const NATURE_SOUNDS = {};
const add = (name, n, sec, fn, desc) => { NATURE_SOUNDS[name] = { cat: 'nature', n, desc, render: one(name, sec, fn, { drive: 1.2, pre: 1.0, ceiling: 0.9, release: 0.1 }) }; };
add('thunder_near', 2, 3.6, thunderRoom(false), 'thunder close by: a crack and a long roll');
add('thunder_far', 2, 3.6, thunderRoom(true), 'thunder far off: a low roll');
add('drip', 4, 0.12, drip, 'a water drip into a pool');
add('splash', 1, 1.0, splash, 'something heavy into water');
add('stone_water', 2, 0.25, stoneWater, 'a small stone into water');
add('gust', 2, 2.6, gust, 'a gust of wind (one-shot)');
add('bird', 3, 0.9, bird, "a songbird's call");
add('branch_crack', 1, 0.6, branch, 'a branch cracking and falling');
add('debris', 1, 2.0, debris, 'rubble and grit settling');
add('glass_break', 1, 1.4, glassBreak, 'a pane of glass shattering');
add('wood_break', 1, 0.5, woodBreak, 'a crate or a door smashed');
add('body_fall', 2, 0.4, fall, 'a heavy body or a sack hitting the floor');
