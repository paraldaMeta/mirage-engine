// The audio engine, heard from above: a listener (you) on a floor plan with a hall (box reverb zone), a cave (sphere
// zone), a wall with a doorway (occlusion), a humming machine with a cone, a siren driving round (Doppler), a radio
// behind the wall, footsteps from a cue, layered music that changes on the bar, a voice that ducks the music, one
// decoded file (fx/chime.wav) and one streamed file (fx/theme.wav). Every other sound is made in sounds.js.
// Keys: WASD move, Q/E turn, 1/2/3 music section, L lead layer, T talk, M streamed theme, C chime, U underwater
// snapshot, P HRTF / equal-power, O occlusion, G debug overlay.
// URL flags: ?panning=equalpower  ?voices=8  ?occlusion=0  ?zones=0  ?swarm=64  ?debug=0  ?seed=x  ?auto=1 (no
// gesture: start at once and walk a loop)  ?test=1 (run the offline checks and list them).
import { createAudioEngine, createMusic, createAudioDebug, zonesFromPlan } from '@miragekit/game';
import { hum, siren, step, speech, stem, sine } from './sounds.js';
import { runTests } from './tests.js';
import chimeUrl from './fx/chime.wav?url';
import themeUrl from './fx/theme.wav?url';

const Q = new URLSearchParams(location.search), flag = (k, d) => (Q.has(k) ? Q.get(k) : d);
const hud = document.querySelector('#hud'), log = document.querySelector('#log'), canvas = document.querySelector('canvas'), g2 = canvas.getContext('2d');
const env = { chimeUrl, themeUrl };

// the world plan's audio block: what a level file would carry (zonesFromPlan reads plan.audio.zones)
const plan = { audio: { zones: [
  { name: 'hall', box: [-15, -2, -6, -5, 5, 6], fade: 2, reverb: 'hall', wet: 0.8 },
  { name: 'cave', sphere: [10, 0, 7, 4.5], fade: 2.5, reverb: 'cave', wet: 1, snapshot: 'cave' },
] } };
const WALLS = [[2, -9, 2, -1.2], [2, 1.2, 2, 3], [2, 3, 8, 3]];   // x0, z0, x1, z1: a wall with a doorway, and a return
const crosses = (ax, az, bx, bz, [cx, cz, dx, dz]) => {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx); if (!d) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
};
const wallTest = (a, b) => (WALLS.some((w) => crosses(a[0], a[2], b[0], b[2], w)) ? 1 : 0);
const OCC = { test: wallTest, rays: 3, radius: 0.4, budget: 8 };

const engine = createAudioEngine({
  voices: +flag('voices', 24), panning: flag('panning', 'HRTF'), seed: flag('seed', 'mirage/audio-demo'),
  buses: { dialogue: { gain: 1 }, music: { effects: [{ id: 'lp', type: 'lowpass', freq: 20000 }] }, sfx: { effects: [{ id: 'lp', type: 'lowpass', freq: 20000 }] } },
  snapshots: { cave: { music: { gain: 0.5 } }, underwater: { music: { lp: { freq: 500 } }, sfx: { gain: 0.6, lp: { freq: 700 } }, ambience: { gain: 0.5 } } },
  ducks: [{ target: 'music', source: 'dialogue', amount: 0.25, attack: 0.08, release: 0.6 }],
  zones: flag('zones') === '0' ? [] : zonesFromPlan(plan),
  occlusion: flag('occlusion') === '0' ? null : OCC,
});
const debug = createAudioDebug(engine, { visible: flag('debug') !== '0' });
const me = { x: -1, z: 5, a: 0 }, keys = new Set(), siren3 = [0, 0, 0], HUM = [-10, 0, 0], RADIO = [6, 0, -4], BELL = [10, 0, 7];
let music = null, theme = null, started = false, under = false, lead = true, strode = 0, t = 0, occl = flag('occlusion') !== '0';
const say = (s, c = '') => { const d = document.createElement('div'); d.className = c; d.textContent = s; log.append(d); };

function start() {
  if (started) return; started = true;
  engine.unlock();
  engine.add('hum', hum(110, 2)); engine.add('siren', siren(880, 1)); engine.add('radio', stem('lead', { bpm: 132, bars: 2, root: 64 })); engine.add('talk', speech(1.8));
  for (let k = 0; k < 4; k++) engine.add('step' + k, step(k));
  for (const k of ['pad', 'bass', 'drums', 'lead']) engine.add('m/' + k, stem(k));
  engine.cue('step', { sounds: ['step0', 'step1', 'step2', 'step3'], mode: 'shuffle', gain: [0.5, 0.8], pitch: [-2, 2], cooldown: 0.12 });
  engine.preload('level', { chime: chimeUrl }).catch((e) => say('chime.wav: ' + e.message, 'bad'));
  engine.play('hum', { at: HUM, loop: true, bus: 'ambience', gain: 0.8, ref: 2, dir: [1, 0, 0], inner: 90, outer: 240, outerGain: 0.25 });
  engine.play('siren', { at: () => siren3, loop: true, gain: 0.5, ref: 3, doppler: 1, priority: 160 });
  engine.play('radio', { at: RADIO, loop: true, gain: 0.7, ref: 2, spread: 0.2 });
  for (let i = 0, n = +flag('swarm', 0); i < n; i++) {   // many quiet loops: watch the voice cap and the virtual count
    engine.add('bee' + i, sine(180 + i * 23, 0.5, 0.06)); const r = 3 + (i % 16), ph = i * 2.4;
    engine.play('bee' + i, { at: () => [Math.cos(t * 0.3 + ph) * r, 0, Math.sin(t * 0.3 + ph) * r], loop: true, ref: 1.5, priority: 60 });
  }
  const full = { pad: 'm/pad', bass: 'm/bass', drums: 'm/drums', lead: 'm/lead' };
  music = createMusic(engine, { bpm: 100, bus: 'music', gain: 0.6, sections: { calm: { bars: 2, stems: { pad: full.pad, lead: full.lead } }, explore: { bars: 2, stems: { pad: full.pad, bass: full.bass, lead: full.lead } }, fight: { bars: 2, stems: full } } });
  music.play(flag('music', 'calm'));
  window.__audio.music = music;
}
const act = {
  1: () => music?.to('calm'), 2: () => music?.to('explore'), 3: () => music?.to('fight', { quantize: 'beat' }),
  l: () => { lead = !lead; music?.layer('lead', lead ? 1 : 0, 0.8); },
  t: () => engine.play('talk', { bus: 'dialogue', priority: 250, gain: 0.9 }),
  m: () => { if (theme) { theme.stop(0.5); theme = null; } else theme = engine.stream(themeUrl, { bus: 'music', loop: true, gain: 0.5, fadeIn: 0.5 }); },
  c: () => engine.has('chime') && engine.play('chime', { at: BELL, ref: 3, priority: 180 }),
  u: () => { under = !under; engine.mixer.transition(under ? 'underwater' : {}, 0.6); },
  p: () => engine.setPanning(engine.panning === 'HRTF' ? 'equalpower' : 'HRTF'),
  o: () => { occl = !occl; engine.occlusion(occl ? OCC : null); },
  g: () => debug.toggle(),
};
addEventListener('keydown', (e) => { start(); const k = e.key.toLowerCase(); keys.add(k); if (!e.repeat) act[k]?.(); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('pointerdown', start);

const S = 22;   // pixels per metre
function draw() {
  const w = canvas.width = innerWidth, h = canvas.height = innerHeight, X = (x) => w / 2 + x * S, Z = (z) => h / 2 + z * S;
  g2.fillStyle = '#0b0f14'; g2.fillRect(0, 0, w, h);
  g2.lineWidth = 1; g2.strokeStyle = '#3d6a8a'; g2.fillStyle = 'rgba(61,106,138,.14)';
  g2.fillRect(X(-15), Z(-6), 10 * S, 12 * S); g2.strokeRect(X(-15), Z(-6), 10 * S, 12 * S);
  g2.beginPath(); g2.arc(X(10), Z(7), 4.5 * S, 0, 7); g2.fill(); g2.stroke();
  g2.strokeStyle = '#d8d2c4'; g2.lineWidth = 4; g2.beginPath(); for (const [a, b, c, d] of WALLS) { g2.moveTo(X(a), Z(b)); g2.lineTo(X(c), Z(d)); } g2.stroke();
  g2.font = '12px ui-monospace, Menlo, monospace';
  const dot = (p, c, label) => { g2.fillStyle = c; g2.beginPath(); g2.arc(X(p[0]), Z(p[2]), 6, 0, 7); g2.fill(); g2.fillText(label, X(p[0]) + 9, Z(p[2]) + 4); };
  dot(HUM, '#e6b35a', 'machine (cone, hall)'); dot(siren3, '#ff7a6a', 'siren (Doppler)'); dot(RADIO, '#8fd3a0', 'radio (behind the wall)'); dot(BELL, '#b9a4ff', 'bell: C (cave)');
  g2.fillStyle = '#fff'; g2.beginPath(); g2.arc(X(me.x), Z(me.z), 7, 0, 7); g2.fill();
  g2.strokeStyle = '#fff'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(X(me.x), Z(me.z)); g2.lineTo(X(me.x + Math.sin(me.a) * 1.2), Z(me.z - Math.cos(me.a) * 1.2)); g2.stroke();
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; t += dt;
  const fx = Math.sin(me.a), fz = -Math.cos(me.a);
  let mx = 0, mz = 0;
  if (Q.has('auto')) { me.a = t * 0.25; mx = fx; mz = fz; } else {
    if (keys.has('q')) me.a -= dt * 2;
    if (keys.has('e')) me.a += dt * 2;
    const f = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0), r = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    mx = fx * f - fz * r; mz = fz * f + fx * r;
  }
  const nx = me.x + mx * 3.2 * dt, nz = me.z + mz * 3.2 * dt;
  if (!WALLS.some((wl) => crosses(me.x, me.z, nx + mx * 0.3, nz + mz * 0.3, wl))) { strode += Math.hypot(nx - me.x, nz - me.z); me.x = nx; me.z = nz; }
  if (started && strode > 1.5) { strode = 0; engine.play('step', { bus: 'sfx', gain: 0.6 }); }
  siren3[0] = Math.cos(t * 0.9) * 8; siren3[2] = Math.sin(t * 0.9) * 8;   // 7.2 m/s round a circle
  engine.update(dt, { pos: [me.x, 0, me.z], forward: [fx, 0, fz], up: [0, 1, 0] });
  draw();
  const p = music?.position;
  hud.textContent = started
    ? 'WASD move  Q/E turn  1 2 3 music  L lead  T talk  M stream  C chime  U underwater  P panning  O occlusion  G overlay\n'
      + `panning ${engine.panning}   occlusion ${occl ? 'on' : 'off'}   music ${music?.section || '-'}${music?.pending ? ' -> ' + music.pending : ''}  bar ${p ? p.bar + 1 : '-'} beat ${p ? p.beat + 1 : '-'}`
      + `   stream ${theme ? theme.state : 'off'}${under ? '   underwater' : ''}`
    : 'click or press a key to start the sound';
  requestAnimationFrame(frame);
}
window.__audio = { engine, music: null, debug, env, start, act, runTests: (only) => runTests(env, only) };
if (Q.has('auto')) start();
requestAnimationFrame(frame);
if (Q.has('test')) runTests(env, Q.get('test') === '1' ? '' : Q.get('test')).then((rows) => { for (const r of rows) say(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.note}`, r.ok ? 'ok' : 'bad'); window.__TESTS = rows; });
window.__READY = true;
