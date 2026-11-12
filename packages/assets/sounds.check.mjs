// Mirage original code. Node check of the sound library (@miragekit/assets/sounds): every sound measured instead of heard.
//   - every variant renders finite, peaks between 0.3 and 0.93 (no clipping), and twice the same (deterministic)
//   - variants of one sound differ; loops' ends run into their starts (the seam steps no more than any two samples
//     inside the loop do, and the level holds across it)
//   - attack: the sounds that are a hit (clicks, keys, impacts, steps, shots) reach 90 % of their peak in under 8 ms
//     of their onset; swells (gusts, teleports, the menu sweeps) take longer than 30 ms
//   - spectrum: the share of the first 100 ms under 200 Hz (the weight): thunder, body falls, the heartbeat and
//     explosions mostly low; clicks, keys, glass and drips nearly none
//   - pitch: beeps, coins, keypads, the lift bell sound at the note they are written at (a Goertzel bin)
//   - Doppler: a passing car's engine is higher while it comes than while it goes
//   - the API: soundNames, renderSound's checks, addSounds on a stand-in mixer, soundBuffers on a stand-in context
// Also prints a table (name, variants, seconds, peak, attack ms, low %) for docs/sounds.md.
import { SOUNDS, SOUND_CATEGORIES, soundNames, renderSound, addSounds, soundBuffers } from './src/sounds/index.js';
import { rms, peak, toneLevel, onset } from '@miragekit/game/audio-dsp';

const SR = 48000;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('  FAIL ' + m); } };

function lowShare(x, from, ms = 100) {   // energy under 200 Hz / all, over `ms` from `from`: a one-pole split, good enough
  const n = Math.min(x.length, from + Math.round(ms / 1000 * SR)), a = 1 - Math.exp(-2 * Math.PI * 200 / SR);
  let y = 0, lo = 0, all = 0;
  for (let i = from; i < n; i++) { y += a * (x[i] - y); lo += y * y; all += x[i] * x[i]; }
  return all > 0 ? lo / all : 0;
}
function attackMs(x) { const pk = peak(x), on = onset(x, pk * 0.05); let at = on; while (at < x.length && Math.abs(x[at]) < pk * 0.9) at++; return (at - on) / SR * 1000; }

const rows = [];
for (const name of Object.keys(SOUNDS)) {
  const s = SOUNDS[name], v0 = s.render(SR, 0);
  for (let v = 0; v < s.n; v++) {
    const x = v ? s.render(SR, v) : v0, pk = peak(x);
    ok(x.length > 0 && x.every(Number.isFinite), `${name}/${v} renders finite samples`);
    ok(pk >= 0.3 && pk <= 0.931, `${name}/${v} peaks at ${pk.toFixed(3)} (0.3..0.93)`);
  }
  const again = s.render(SR, 0);
  ok(again.length === v0.length && again.every((a, i) => a === v0[i]), `${name} is deterministic`);
  if (s.n > 1) { const x1 = s.render(SR, 1); ok(x1.length !== v0.length || x1.some((a, i) => a !== v0[i]), `${name}: variants differ`); }
  if (s.loop) {
    const n = v0.length, w = Math.round(0.05 * SR);
    let jump = 0; for (let i = 1; i < n; i++) jump = Math.max(jump, Math.abs(v0[i] - v0[i - 1]));   // the largest step inside the loop
    const seam = Math.abs(v0[0] - v0[n - 1]);
    ok(seam <= jump * 1.05 + 1e-6, `${name}: the seam steps no more than the loop itself does (${seam.toFixed(3)} vs ${jump.toFixed(3)})`);
    const a = rms(v0, 0, w), b = rms(v0, n - w, n);
    ok(Math.abs(20 * Math.log10((a + 1e-9) / (b + 1e-9))) < 6, `${name}: the level holds across the seam (${(20 * Math.log10((a + 1e-9) / (b + 1e-9))).toFixed(1)} dB)`);
  }
  rows.push({ name, cat: s.cat, n: s.n, sec: v0.length / SR, peak: peak(v0), attack: attackMs(v0), low: lowShare(v0, Math.max(0, onset(v0, peak(v0) * 0.05))), loop: !!s.loop });
}
const R = Object.fromEntries(rows.map((r) => [r.name, r]));

const HIT = ['ui_click', 'ui_type', 'ui_slider', 'keypad', 'impact_concrete', 'impact_metal', 'impact_glass', 'step_concrete', 'step_tile', 'step_metal', 'shot_pistol_alley', 'shot_carbine_open', 'shot_shotgun_indoor', 'brass', 'vend_drop', 'glass_break', 'wood_break', 'drip'];
for (const n of HIT) ok(R[n].attack < 8, `${n} is a hit: 90 % of its peak ${R[n].attack.toFixed(1)} ms after its onset (< 8)`);
for (const n of ['gust', 'teleport', 'ui_open', 'thunder_far']) ok(R[n].attack > 30, `${n} swells: ${R[n].attack.toFixed(0)} ms to 90 % (> 30)`);
for (const n of ['thunder_near', 'thunder_far', 'body_fall', 'heartbeat', 'explosion_open']) ok(R[n].low > 0.5, `${n} is mostly low: ${(R[n].low * 100).toFixed(0)} % under 200 Hz (> 50 %)`);
for (const n of ['ui_click', 'ui_hover', 'ui_slider', 'impact_glass', 'drip', 'robot_beep']) ok(R[n].low < 0.05, `${n} has no weight: ${(R[n].low * 100).toFixed(1)} % under 200 Hz (< 5 %)`);
// pitch: the written note is the strongest of it, a semitone below and a semitone above
function pitchOk(name, v, f, from = 0, to) {
  const x = renderSound(name, SR, v), t = to ?? Math.min(x.length, from + Math.round(0.08 * SR)), at = (g) => toneLevel(x, SR, g, from, t);
  const s = 2 ** (1 / 12), a = at(f);
  ok(a > at(f / s) * 2 && a > at(f * s) * 2, `${name}/${v} sounds at ${f} Hz (${a.toFixed(3)} vs ${at(f / s).toFixed(3)} / ${at(f * s).toFixed(3)} a semitone off)`);
}
pitchOk('robot_beep', 0, 880); pitchOk('robot_beep', 1, 1175); pitchOk('ui_coin', 0, 987.8, 0, Math.round(0.07 * SR)); pitchOk('lift_bell', 0, 1046.5, 0, Math.round(0.3 * SR)); pitchOk('keypad', 0, 697);
// Doppler: the third engine harmonic (126 Hz at rest) is about 133 Hz coming and 120 Hz going at 18 m/s
{
  const x = renderSound('car_pass', SR, 0), mid = x.length / 2, w = Math.round(0.8 * SR);
  const come = (f) => toneLevel(x, SR, f, mid - w - Math.round(0.2 * SR), mid - Math.round(0.2 * SR)), go = (f) => toneLevel(x, SR, f, mid + Math.round(0.2 * SR), mid + w + Math.round(0.2 * SR));
  ok(come(133) > come(120) && go(120) > go(133), `car_pass: higher coming (133 Hz ${come(133).toFixed(4)} > 120 Hz ${come(120).toFixed(4)}) than going (120 ${go(120).toFixed(4)} > 133 ${go(133).toFixed(4)})`);
}
// the API
ok(SOUND_CATEGORIES.every((c) => soundNames(c).length > 0) && soundNames().length === Object.keys(SOUNDS).length, 'soundNames: every category has sounds, no category = all');
let threw = 0; try { soundNames('nope'); } catch { threw++; } try { renderSound('nope'); } catch { threw++; } try { renderSound('ui_click', 100); } catch { threw++; }
ok(threw === 3, 'an unknown category or name, or a sample rate out of range, throws');
ok(renderSound('ui_click', SR, 3).every((a, i) => a === renderSound('ui_click', SR, 0)[i]), 'renderSound wraps the variant (3 of 3 is 0)');
const added = {}; addSounds({ add: (n, f) => { added[n] = f; } }, ['ui_click', 'amb_rain'], { prefix: 'x_' });
const fake = { sampleRate: 44100, createBuffer: (ch, len, sr) => { const d = new Float32Array(len); return { length: len, sampleRate: sr, copyToChannel: (src) => d.set(src), data: d }; } };
const made = added.x_ui_click?.(fake);
ok(Array.isArray(made) && made.length === 3 && made[0].sampleRate === 44100 && made[0].data.some((a) => a !== 0), 'addSounds: each name made at unlock, all variants, at the device rate');
ok(!Array.isArray(added.x_amb_rain?.(fake)) && soundBuffers(fake, 'drip').length === 4, 'addSounds: one buffer for a one-variant sound; soundBuffers: every variant');

if (process.argv.includes('--table')) {
  console.log('| name | category | variants | seconds | attack ms | under 200 Hz |\n|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| \`${r.name}\` | ${r.cat}${r.loop ? ' (loop)' : ''} | ${r.n} | ${r.sec.toFixed(2)} | ${r.loop ? '-' : r.attack.toFixed(1)} | ${(r.low * 100).toFixed(0)} % |`);
}
const loops = rows.filter((r) => r.loop).length, variants = rows.reduce((a, r) => a + r.n, 0);
console.log(fails ? `sounds check: ${fails} failed` : `sounds check: ok (${rows.length} sounds, ${variants} variants, ${loops} loops, ${SOUND_CATEGORIES.length} categories)`);
process.exit(fails ? 1 : 0);
