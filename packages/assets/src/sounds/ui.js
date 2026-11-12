// Mirage original code. Interface sounds of the sound library (@miragekit/assets/sounds): clicks, hovers, confirm / deny,
// notifications, menus opening and closing, key taps, a coin, a level-up, an error. Short (under a second), bright and
// dry (no room), mastered to the same peak: set their level with the mixer's gain.
import { biquad, noiseLayer, thumpLayer, modesLayer, toneLayer, one, click } from '@miragekit/game/sounds';

const BELL = [[1, 1], [2.76, 0.32], [5.4, 0.12]];   // a small bell's inharmonic partials
const SQUARE = [[1, 1], [3, 0.33], [5, 0.2], [7, 0.14]];

function uiClick(o, SR, R, v) { click(o, SR, R, 0, 3600 + v * 220, 0.8, 0.004); click(o, SR, R, 0.011, 2100 + v * 150, 0.35, 0.005); }
function uiHover(o, SR, R, v) { toneLayer(o, SR, 0, 0.07, 1850 + v * 120, 0.002, 0.012, 0.5, { harm: [[1, 1], [2, 0.15]] }); }
function uiConfirm(o, SR) {
  toneLayer(o, SR, 0, 0.3, 659.3, 0.003, 0.08, 0.6, { harm: BELL });
  toneLayer(o, SR, 0.075, 0.45, 987.8, 0.003, 0.16, 0.7, { harm: BELL });
}
function uiDeny(o, SR) {
  for (const t0 of [0, 0.13]) toneLayer(o, SR, t0, 0.11, 185, 0.004, 0.05, 0.55, { harm: SQUARE, hold: 0.05 });
}
function uiNotify(o, SR) { [880, 1318.5, 1760].forEach((f, k) => toneLayer(o, SR, k * 0.07, 0.6, f, 0.002, 0.18 + k * 0.05, 0.5, { harm: BELL })); }
function sweep(o, SR, R, up) {   // a menu sliding open (up) or shut: noise through a band that moves, a soft click at the end
  const n = Math.min(o.length, Math.round(0.2 * SR)), bands = [700, 1400, 2800].map((f) => biquad('bp', f, 1.6, SR));
  for (let i = 0; i < n; i++) {
    const t = i / SR, u = t / 0.2, pos = (up ? u : 1 - u) * 2, x = R() * 2 - 1;
    let s = 0; bands.forEach((b, k) => { s += b(x) * Math.max(0, 1 - Math.abs(k - pos)); });
    o[i] += s * Math.sin(Math.PI * u) * 1.6;
  }
  click(o, SR, R, up ? 0.19 : 0.2, up ? 2600 : 1500, 0.4, 0.006);
}
function uiType(o, SR, R, v) {   // a mechanical key: the switch's click, the cap bottoming out
  click(o, SR, R, 0, 4200 + v * 300, 0.55, 0.003);
  noiseLayer(o, SR, R, 0.008, 0.03, biquad('bp', 1800 + v * 200, 1.2, SR), 0.0005, 0.006, 0.6);
  thumpLayer(o, SR, 0.009, 260, 160, 0.01, 0.0005, 0.012, 0.25);
}
function uiCoin(o, SR) { toneLayer(o, SR, 0, 0.09, 987.8, 0.001, 0.2, 0.5, { harm: SQUARE, hold: 0.06 }); toneLayer(o, SR, 0.08, 0.5, 1318.5, 0.001, 0.16, 0.5, { harm: SQUARE, hold: 0.04 }); }
function uiLevelUp(o, SR) {
  [523.3, 659.3, 784, 1046.5].forEach((f, k) => toneLayer(o, SR, k * 0.09, 0.9, f, 0.003, 0.3, 0.45, { harm: BELL, vib: [6, 0.004] }));
  toneLayer(o, SR, 0.36, 0.9, 2093, 0.02, 0.35, 0.18, { harm: [[1, 1]], vib: [7, 0.006] });   // a shimmer on top
}
function uiError(o, SR, R) {
  toneLayer(o, SR, 0, 0.32, (t) => 220 - 60 * t, 0.003, 0.08, 0.5, { harm: SQUARE, hold: 0.18 });
  noiseLayer(o, SR, R, 0, 0.3, biquad('bp', 3000, 0.8, SR), 0.003, 0.08, 0.12);
}
function uiToggle(o, SR, R, v) { modesLayer(o, SR, R, 0, [[v ? 1500 : 2200, 0.012, 1], [v ? 2600 : 3800, 0.006, 0.4]], 0.7, 0.6); }
function uiSlider(o, SR, R) { click(o, SR, R, 0, 5200, 0.4, 0.002); }
function uiBack(o, SR) { toneLayer(o, SR, 0, 0.18, 784, 0.003, 0.05, 0.5, { harm: BELL }); toneLayer(o, SR, 0.06, 0.25, 523.3, 0.003, 0.08, 0.5, { harm: BELL }); }
function uiReward(o, SR, R) {   // a chest of coins: a cascade of small bells and a warm chord under them
  for (let k = 0; k < 14; k++) toneLayer(o, SR, k * 0.035 + R() * 0.01, 0.4, 1400 + R() * 1800, 0.001, 0.08, 0.22, { harm: BELL });
  for (const f of [261.6, 329.6, 392]) toneLayer(o, SR, 0.05, 1.0, f, 0.04, 0.35, 0.22, { harm: [[1, 1], [2, 0.3]] });
}

/** name -> { cat, n, render, desc } */
export const UI_SOUNDS = {};
const add = (name, n, sec, fn, desc) => { UI_SOUNDS[name] = { cat: 'ui', n, desc, render: one(name, sec, fn) }; };
add('ui_click', 3, 0.06, uiClick, 'a button pressed');
add('ui_hover', 2, 0.08, uiHover, 'the pointer over a button (play it quiet)');
add('ui_confirm', 1, 0.5, uiConfirm, 'a choice confirmed: two rising bell tones');
add('ui_deny', 1, 0.3, uiDeny, 'not allowed: two low buzzes');
add('ui_notify', 1, 0.8, uiNotify, 'a notification: three rising bells');
add('ui_open', 1, 0.24, (o, SR, R) => sweep(o, SR, R, true), 'a menu or panel opening');
add('ui_close', 1, 0.24, (o, SR, R) => sweep(o, SR, R, false), 'a menu or panel closing');
add('ui_type', 4, 0.06, uiType, 'a mechanical key (typing, a terminal)');
add('ui_coin', 1, 0.6, uiCoin, 'a coin or a point collected');
add('ui_level_up', 1, 1.4, uiLevelUp, 'a level up: an arpeggio and a shimmer');
add('ui_error', 1, 0.36, uiError, 'an error: a falling buzz');
add('ui_toggle', 2, 0.06, uiToggle, 'a switch on (variant 0) or off (1)');
add('ui_slider', 1, 0.02, uiSlider, 'a slider stepping (one tick)');
add('ui_back', 1, 0.36, uiBack, 'back / cancel: two falling bell tones');
add('ui_reward', 1, 1.3, uiReward, 'a reward: a cascade of small bells over a chord');
