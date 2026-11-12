// Mirage original code. Machines and science fiction in the sound library (@miragekit/assets/sounds): servos, robot
// beeps and chatter, sliding and pneumatic doors, a lift's bell, a terminal booting, a keypad, a lock, a vending
// machine dropping a can, power going down and up, an EMP, a shield taking a hit, a laser, a teleport, a scanner, a
// hack, an alarm and a drone (loops). Made with the same layers as the weapons (synth.js).
import { TAU, biquad, chain, noiseLayer, thumpLayer, modesLayer, toneLayer, one, fold, click, scrape } from '@miragekit/game/sounds';

function servo(o, SR, R, v) {   // a joint moving: a geared whine that rises and settles, a click at each end
  const f0 = 520 + v * 90, len = 0.28;
  toneLayer(o, SR, 0.01, len, (t) => f0 * (1 + 0.6 * Math.sin(Math.PI * Math.min(1, t / len))), 0.02, 0.04, 0.35, { harm: [[1, 1], [2, 0.5], [3, 0.3], [5, 0.15]], hold: len - 0.06 });
  noiseLayer(o, SR, R, 0.01, len, biquad('bp', 3000, 2, SR), 0.02, 0.1, 0.12);
  click(o, SR, R, 0, 3000, 0.25, 0.004); click(o, SR, R, len + 0.01, 1800, 0.3, 0.008);
}
function beep(o, SR, R, v) { const f = [880, 1175, 1568, 659][v % 4]; toneLayer(o, SR, 0, 0.12, f, 0.002, 0.03, 0.6, { harm: [[1, 1], [3, 0.2]], hold: 0.05 }); }
function chatter(o, SR, R) {   // a robot "talking": a run of pitched blips on a contour, like speech without words
  let t = 0, f = 600 + R() * 400;
  while (t < 0.75) { const d = 0.03 + R() * 0.06; f = Math.max(300, Math.min(1600, f * (0.8 + R() * 0.45))); toneLayer(o, SR, t, d + 0.02, f, 0.003, 0.012, 0.5, { harm: [[1, 1], [2, 0.4], [3, 0.25]], hold: d * 0.7 }); t += d + (R() < 0.2 ? 0.08 : 0.012); }
}
function doorSlide(o, SR, R) {   // a sliding door: a motor's whine, the leaf's whoosh, a soft thunk at the stop
  toneLayer(o, SR, 0, 0.55, (t) => 180 + 140 * Math.min(1, t / 0.15), 0.04, 0.12, 0.25, { harm: [[1, 1], [2, 0.6], [4, 0.3]], hold: 0.35 });
  noiseLayer(o, SR, R, 0.02, 0.5, chain(biquad('bp', 900, 0.7, SR), biquad('lp', 2500, 0.7, SR)), 0.15, 0.12, 0.6);
  thumpLayer(o, SR, 0.52, 140, 70, 0.01, 0.001, 0.05, 0.7); click(o, SR, R, 0.52, 900, 0.3, 0.02);
}
function doorHiss(o, SR, R) {   // a pneumatic door: the seal's pop, a hiss of air, the latch
  thumpLayer(o, SR, 0, 160, 80, 0.008, 0.0005, 0.02, 0.6);
  noiseLayer(o, SR, R, 0.005, 0.6, chain(biquad('hp', 2000, 0.7, SR), biquad('peak', 6000, 1, SR, 4)), 0.01, 0.18, 0.9);
  click(o, SR, R, 0.55, 2200, 0.4, 0.01);
}
function liftBell(o, SR) { toneLayer(o, SR, 0, 1.4, 1046.5, 0.002, 0.5, 0.55, { harm: [[1, 1], [2.76, 0.35], [5.4, 0.15]] }); toneLayer(o, SR, 0.0, 1.4, 1318.5, 0.002, 0.45, 0.25, { harm: [[1, 1], [2.76, 0.3]] }); }
function boot(o, SR, R) {   // a terminal waking: a relay, the fan spinning up, a POST beep, the disk seeking
  click(o, SR, R, 0, 1400, 0.6, 0.02); thumpLayer(o, SR, 0, 120, 60, 0.01, 0.001, 0.03, 0.4);
  toneLayer(o, SR, 0.05, 1.2, (t) => 60 + 140 * Math.min(1, t / 0.8), 0.2, 0.4, 0.15, { harm: [[1, 1], [2, 0.4]], hold: 0.6 });
  noiseLayer(o, SR, R, 0.05, 1.2, biquad('bp', 2200, 1, SR), 0.4, 0.4, 0.12);
  toneLayer(o, SR, 0.7, 0.2, 1000, 0.002, 0.05, 0.4, { harm: [[1, 1], [3, 0.25]], hold: 0.1 });
  for (let k = 0; k < 6; k++) noiseLayer(o, SR, R, 0.9 + R() * 0.4, 0.03, biquad('bp', 3200 + R() * 800, 3, SR), 0.001, 0.006, 0.25);
}
function keypad(o, SR, R, v) { const f = [697, 770, 852, 941][v % 4], g = [1209, 1336, 1477, 1633][(v * 3) % 4]; toneLayer(o, SR, 0, 0.12, f, 0.002, 0.03, 0.4, { hold: 0.06 }); toneLayer(o, SR, 0, 0.12, g, 0.002, 0.03, 0.35, { hold: 0.06 }); click(o, SR, R, 0, 4500, 0.2, 0.002); }   // a key and its two-tone (DTMF) beep
function lockOpen(o, SR, R) { scrape(o, SR, R, 0, 0.1, 1800, 0.3); click(o, SR, R, 0.1, 1300, 0.7, 0.02); thumpLayer(o, SR, 0.1, 200, 110, 0.01, 0.0005, 0.03, 0.4); toneLayer(o, SR, 0.16, 0.25, 1568, 0.002, 0.08, 0.25, { harm: [[1, 1], [2.76, 0.3]] }); }
function lockDenied(o, SR, R) { click(o, SR, R, 0, 1600, 0.6, 0.012); for (const t0 of [0.03, 0.17]) toneLayer(o, SR, t0, 0.1, 330, 0.003, 0.03, 0.4, { harm: [[1, 1], [3, 0.33], [5, 0.2]], hold: 0.05 }); }
function vendDrop(o, SR, R) {   // a can falling through a vending machine: a release clunk, two bounces off the chute, the flap
  click(o, SR, R, 0, 900, 0.6, 0.02);
  for (const [t0, g] of [[0.18, 1], [0.26, 0.55]]) { thumpLayer(o, SR, t0, 210, 120, 0.01, 0.0005, 0.04, g * 0.8); modesLayer(o, SR, R, t0, [[1450, 0.06, 1], [2900, 0.03, 0.5], [620, 0.08, 0.5]], g * 0.5, 0.8); }
  click(o, SR, R, 0.42, 1100, 0.35, 0.03);
}
function powerDown(o, SR, R) {   // a generator or a machine dying: the hum falls in pitch and level, relays clack
  let ph = 0; for (let i = 0; i < o.length; i++) { const t = i / SR, f = 50 + 70 * Math.exp(-t / 0.4); ph += TAU * f / SR; o[i] += (Math.sin(ph) + 0.4 * Math.sin(ph * 2) + 0.2 * Math.sign(Math.sin(ph))) * Math.exp(-t / 0.7) * 0.5; }
  click(o, SR, R, 0, 1200, 0.6, 0.02); click(o, SR, R, 0.06, 1700, 0.4, 0.015);
}
function powerUp(o, SR, R) {
  let ph = 0; for (let i = 0; i < o.length; i++) { const t = i / SR, f = 50 + 70 * (1 - Math.exp(-t / 0.35)); ph += TAU * f / SR; o[i] += (Math.sin(ph) + 0.4 * Math.sin(ph * 2) + 0.2 * Math.sign(Math.sin(ph))) * Math.min(1, t / 0.3) * Math.exp(-Math.max(0, t - 1.0) / 0.2) * 0.5; }
  click(o, SR, R, 0, 1500, 0.6, 0.02); noiseLayer(o, SR, R, 0.02, 0.4, biquad('bp', 6000, 2, SR), 0.05, 0.1, 0.15);
}
function emp(o, SR, R) {   // an electromagnetic pulse: a hard zap, a falling chirp, crackling discharge, a sub
  noiseLayer(o, SR, R, 0, 0.02, biquad('hp', 3000, 0.7, SR), 0.0002, 0.004, 1.2);
  toneLayer(o, SR, 0, 0.8, (t) => 2400 * Math.exp(-t / 0.08) + 70, 0.001, 0.25, 0.8, { harm: [[1, 1], [2, 0.5], [3, 0.35]] });
  thumpLayer(o, SR, 0, 90, 35, 0.12, 0.002, 0.3, 1.0);
  for (let k = 0; k < 30; k++) noiseLayer(o, SR, R, Math.pow(R(), 1.5) * 0.9, 0.015, biquad('hp', 4000, 0.7, SR), 0.0002, 0.002, 0.4 * (1 - k / 40));
}
function shieldHit(o, SR, R, v) {   // a round on an energy shield: a glassy ring that wobbles, a low hum flaring
  const f = 1100 + v * 140;
  toneLayer(o, SR, 0, 0.6, f, 0.001, 0.15, 0.5, { harm: [[1, 1], [1.52, 0.6], [2.37, 0.35]], vib: [22, 0.03] });
  toneLayer(o, SR, 0, 0.6, 110, 0.005, 0.2, 0.45, { harm: [[1, 1], [2, 0.5], [3, 0.3]] });
  noiseLayer(o, SR, R, 0, 0.05, biquad('hp', 5000, 0.7, SR), 0.0003, 0.006, 0.6);
}
function laser(o, SR, R, v) { toneLayer(o, SR, 0, 0.35, (t) => (1800 + v * 200) * Math.exp(-t / 0.06) + 180, 0.001, 0.09, 0.8, { harm: [[1, 1], [2, 0.3], [3, 0.4]] }); noiseLayer(o, SR, R, 0, 0.02, biquad('hp', 4000, 0.7, SR), 0.0003, 0.004, 0.3); }
function teleport(o, SR, R) {   // a rising shimmer of detuned partials, a whoosh, a pop at the top
  for (let k = 0; k < 6; k++) toneLayer(o, SR, 0, 1.0, (t) => (300 + k * 170) * Math.pow(4, Math.min(1, t / 0.9)), 0.3, 0.12, 0.2, { harm: [[1, 1], [2.01, 0.4]], vib: [9 + k, 0.01], hold: 0.55 });
  noiseLayer(o, SR, R, 0.1, 0.9, biquad('bp', 2500, 0.8, SR), 0.6, 0.1, 0.35);
  thumpLayer(o, SR, 0.92, 300, 120, 0.01, 0.0005, 0.04, 0.6); noiseLayer(o, SR, R, 0.92, 0.05, biquad('hp', 3000, 0.7, SR), 0.0003, 0.008, 0.5);
}
function scan(o, SR) { toneLayer(o, SR, 0, 0.9, (t) => 800 + 600 * Math.sin(TAU * t / 0.9), 0.05, 0.2, 0.35, { harm: [[1, 1], [2, 0.25]], vib: [30, 0.02], hold: 0.6 }); }   // a scanner sweeping
function hack(o, SR, R) {   // breaking in: a burst of fast data chirps over a rising tone, a success chime at the end
  for (let k = 0; k < 26; k++) toneLayer(o, SR, k * 0.03, 0.03, 900 + R() * 2600, 0.001, 0.008, 0.25, { harm: [[1, 1], [3, 0.3]], hold: 0.012 });
  toneLayer(o, SR, 0, 0.8, (t) => 220 * Math.pow(2, t / 0.8), 0.05, 0.1, 0.25, { harm: [[1, 1], [2, 0.5], [3, 0.3]], hold: 0.65 });
  for (const [t0, f] of [[0.82, 1318.5], [0.9, 1975.5]]) toneLayer(o, SR, t0, 0.5, f, 0.002, 0.15, 0.4, { harm: [[1, 1], [2.76, 0.3]] });
}
function alarm(o, SR) { let ph = 0; for (let i = 0; i < o.length; i++) { const u = (i / SR) % 1, f = 600 + 400 * (u < 0.5 ? u * 2 : 2 - u * 2); ph += TAU * f / SR; o[i] += Math.tanh(Math.sin(ph) * 2.5) * 0.6; } }   // a siren sweeping up and down once a second
function drone(o, SR, R) {   // a quadcopter hovering: four rotors at close speeds beating, blade noise, a wobble
  const sec = o.length / SR, rotors = [150, 153, 147.5, 151.2];
  for (let i = 0; i < o.length; i++) { const t = i / SR; let s = 0; for (const f of rotors) s += Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 2 * t) + 0.25 * Math.sin(TAU * f * 3 * t); o[i] += s * 0.12 * (1 + 0.1 * Math.sin(TAU * 0.6 * t)); }
  noiseLayer(o, SR, R, 0, sec, biquad('bp', 1200, 1.2, SR), 0.001, 1e4, 0.25);
}

/** name -> { cat, n, render, loop?, desc } */
export const MACHINE_SOUNDS = {};
const add = (name, n, sec, fn, desc) => { MACHINE_SOUNDS[name] = { cat: 'machine', n, desc, render: one(name, sec, fn) }; };
add('servo', 3, 0.36, servo, 'a robot joint moving');
add('robot_beep', 4, 0.15, beep, 'a robot beep (four pitches)');
add('robot_chatter', 3, 0.9, chatter, 'a robot "talking": pitched blips like speech');
add('door_slide', 1, 0.7, doorSlide, 'a powered sliding door');
add('door_hiss', 1, 0.75, doorHiss, 'a pneumatic door');
add('lift_bell', 1, 1.5, liftBell, "a lift's arrival bell");
add('terminal_boot', 1, 1.5, boot, 'a terminal booting');
add('keypad', 4, 0.14, keypad, 'a keypad key with its two-tone beep');
add('lock_open', 1, 0.45, lockOpen, 'a lock opening, a confirming tone');
add('lock_denied', 1, 0.3, lockDenied, 'a lock refusing');
add('vend_drop', 1, 0.5, vendDrop, 'a can dropping through a vending machine');
add('power_down', 1, 1.8, powerDown, 'power failing: a hum falling away');
add('power_up', 1, 1.4, powerUp, 'power returning: a hum rising');
add('emp', 1, 1.0, emp, 'an electromagnetic pulse');
add('shield_hit', 3, 0.7, shieldHit, 'a round on an energy shield');
add('laser', 3, 0.4, laser, 'a laser shot');
add('teleport', 1, 1.1, teleport, 'a teleport: a rising shimmer and a pop');
add('scanner', 1, 1.0, scan, 'a scanner sweeping');
add('hack', 1, 1.3, hack, 'a hack: data chirps, a rising tone, a chime');
MACHINE_SOUNDS.alarm = { cat: 'machine', n: 1, loop: true, desc: 'a siren sweeping up and down (loop)', render: fold('alarm', 4, alarm, { over: 0.001, level: 0.6 }) };
MACHINE_SOUNDS.drone_hover = { cat: 'machine', n: 1, loop: true, desc: 'a quadcopter drone hovering (loop)', render: fold('drone_hover', 4, drone) };
