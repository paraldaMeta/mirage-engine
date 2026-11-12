// Mirage original code. Footsteps of the sound library (@miragekit/game/sounds), for the surfaces the engine's own
// audio (stone, gravel, grass, wood) does not have: concrete, sheet metal, a steel grate, wet pavement, a puddle,
// sand, snow, carpet, tiles, and a ladder rung. A step is a heel (a low thud), the sole rolling (a scuff of noise
// shaped by the surface) and what the surface adds (a ring, a splash, a crunch). Four variants each, so a walk
// does not repeat; the game picks one per step and may vary the rate a little.
import { biquad, chain, noiseLayer, thumpLayer, modesLayer, one } from './synth.js';

const heel = (o, SR, v, f = 110, g = 0.7) => thumpLayer(o, SR, 0, f * (1 + v * 0.04), f * 0.55, 0.012, 0.001, 0.022, g);
function concrete(o, SR, R, v) {
  heel(o, SR, v);
  noiseLayer(o, SR, R, 0.002, 0.06, biquad('bp', 2400 + v * 150, 0.9, SR), 0.001, 0.012, 0.6);
  noiseLayer(o, SR, R, 0.05, 0.08, biquad('bp', 3200, 1.2, SR), 0.02, 0.02, 0.2);   // the sole's roll
}
function metal(o, SR, R, v) {
  heel(o, SR, v, 130, 0.5);
  const f = 520 + v * 37;
  modesLayer(o, SR, R, 0, [[f, 0.09, 1], [f * 2.31, 0.05, 0.5], [f * 3.9, 0.03, 0.3], [f * 0.68, 0.14, 0.35]], 0.45, 0.8);
}
function grate(o, SR, R, v) {
  heel(o, SR, v, 140, 0.45);
  for (let k = 0; k < 3; k++) { const f = 900 + R() * 900; modesLayer(o, SR, R, k * 0.006, [[f, 0.04, 1], [f * 1.9, 0.02, 0.5]], 0.25, 0.5); }   // bars rattling in their frame
  noiseLayer(o, SR, R, 0.004, 0.05, biquad('hp', 3500, 0.7, SR), 0.001, 0.01, 0.35);
}
function wet(o, SR, R, v) {
  heel(o, SR, v, 100, 0.55);
  noiseLayer(o, SR, R, 0.003, 0.12, chain(biquad('hp', 1800, 0.7, SR), biquad('peak', 5500, 1, SR, 6)), 0.002, 0.03, 0.75);   // the film squelching
  noiseLayer(o, SR, R, 0.09, 0.08, biquad('bp', 4500, 1.5, SR), 0.01, 0.015, 0.25);       // lifting off
}
function puddle(o, SR, R, v) {
  heel(o, SR, v, 95, 0.4);
  noiseLayer(o, SR, R, 0.004, 0.25, chain(biquad('bp', 1200 + v * 120, 0.6, SR), biquad('peak', 3500, 1, SR, 4)), 0.004, 0.06, 1.0);
  for (let k = 0; k < 6; k++) { const f = 900 + R() * 1600, t0 = 0.03 + R() * 0.15; modesLayer(o, SR, R, t0, [[f, 0.012, 1]], 0.15, 0.1); }   // drops falling back (bloops)
}
function sand(o, SR, R, v) {
  heel(o, SR, v, 90, 0.35);
  for (let k = 0; k < 4; k++) noiseLayer(o, SR, R, k * 0.018 + R() * 0.006, 0.05, biquad('bp', 2800 + R() * 1500, 0.9, SR), 0.004, 0.012, 0.35);   // grains giving way
}
function snow(o, SR, R, v) {
  heel(o, SR, v, 85, 0.3);
  let t = 0;
  while (t < 0.16) { const len = 0.004 + R() * 0.01; noiseLayer(o, SR, R, t, len * 3, biquad('bp', 1500 + R() * 2500, 1.2, SR), 0.0005, len, 0.3 + R() * 0.3); t += len * (0.6 + R()); }   // the crunch: many small collapses
}
function carpet(o, SR, R, v) { heel(o, SR, v, 80, 0.45); noiseLayer(o, SR, R, 0.004, 0.08, biquad('lp', 900, 0.7, SR), 0.006, 0.02, 0.4); }
function tile(o, SR, R, v) {
  heel(o, SR, v, 150, 0.5);
  click(o, SR, R, v);
  noiseLayer(o, SR, R, 0.002, 0.05, biquad('hp', 2500, 0.7, SR), 0.0008, 0.008, 0.4);
}
function click(o, SR, R, v) { modesLayer(o, SR, R, 0.001, [[3100 + v * 160, 0.012, 1], [4700 + v * 230, 0.008, 0.5]], 0.3, 0.4); }   // a hard heel on glazed tile
function rung(o, SR, R, v) {   // a hand or a boot on a steel ladder rung: a clank with a long, pure ring
  const f = 740 + v * 45;
  modesLayer(o, SR, R, 0, [[f, 0.22, 1], [f * 2.7, 0.1, 0.4], [f * 5.2, 0.05, 0.2]], 0.5, 1);
  thumpLayer(o, SR, 0, 180, 110, 0.01, 0.0005, 0.02, 0.3);
}

/** name -> { cat, n, render, desc } */
export const STEP_SOUNDS = {};
const add = (name, sec, fn, desc) => { STEP_SOUNDS[name] = { cat: 'step', n: 4, desc, render: one(name, sec, fn) }; };
add('step_concrete', 0.16, concrete, 'a footstep on concrete');
add('step_metal', 0.5, metal, 'a footstep on sheet metal (a ringing deck)');
add('step_grate', 0.25, grate, 'a footstep on a steel grate');
add('step_wet', 0.22, wet, 'a footstep on wet pavement');
add('step_puddle', 0.32, puddle, 'a footstep in a puddle');
add('step_sand', 0.18, sand, 'a footstep in sand');
add('step_snow', 0.22, snow, 'a footstep in snow');
add('step_carpet', 0.14, carpet, 'a footstep on carpet');
add('step_tile', 0.14, tile, 'a footstep on tiles');
add('step_ladder', 0.9, rung, 'a ladder rung');
