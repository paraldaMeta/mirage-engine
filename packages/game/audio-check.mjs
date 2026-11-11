// Node checks of the audio engine's arithmetic and decisions (no Web Audio here: the graph itself is rendered and
// measured in headless Chrome by examples/demos/audio/audio-check.mjs). A stand-in context records nothing and plays
// nothing; what is checked is which voices the engine chooses to sound, and that a scripted run repeats exactly.
import { dbToGain, gainToDb, distanceGain, coneGain, dopplerRatio, occlusionResponse, impulseResponse, REVERBS, encodeWav, decodeWav, dataUrlBytes, rms, toneLevel, onset } from './src/audio-dsp.js';
import { createAudioEngine, normalizeZones, zoneWeights, zonesFromPlan } from './src/audio-engine.js';
import { gridOccluder, physicsOccluder } from './src/audio-occlusion.js';
import { audioStatsText } from './src/audio-debug.js';

import { ok } from '../../scripts/soft-assert.mjs';   // reports every failure with a count, not only the first
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---- formulas ----------------------------------------------------------------------------------------------
ok(near(dbToGain(-6), 0.501187, 1e-5) && near(gainToDb(0.5), -6.0206, 1e-3), 'decibels both ways');
ok(near(distanceGain(1, {}), 1) && near(distanceGain(3, { ref: 1, rolloff: 1 }), 1 / 3) && near(distanceGain(0.2, {}), 1), 'inverse: 1 at ref, 1/3 at 3 m, flat inside ref');
ok(near(distanceGain(5.5, { model: 'linear', ref: 1, max: 10 }), 0.5) && distanceGain(20, { model: 'linear', ref: 1, max: 10 }) === 0, 'linear: half way is 0.5, silent past max');
ok(near(distanceGain(4, { model: 'exponential', ref: 1, rolloff: 2 }), 1 / 16), 'exponential: (d / ref) ^ -rolloff');
const curve = [[0, 1], [10, 0.5], [20, 0]];
ok(near(distanceGain(5, { model: 'custom', curve }), 0.75) && near(distanceGain(15, { model: 'custom', curve }), 0.25) && distanceGain(99, { model: 'custom', curve }) === 0, 'custom curve: linear between points, held past the last');
ok(near(distanceGain(4, { model: 'custom', curve: (d) => 1 / (d * d) }), 1 / 16), 'custom curve as a function');
ok(coneGain([0, 0, 1], [0, 0, 5], 60, 120, 0.1) === 1 && near(coneGain([0, 0, 1], [0, 0, -5], 60, 120, 0.1), 0.1) && near(coneGain([0, 0, 1], [1, 0, 1], 60, 120, 0), 0.5, 1e-6), 'cone: 1 in front, outerGain behind, half way at 45 deg of 30..60');
const dA = dopplerRatio([0, 0, 0], [34.3, 0, 0], [100, 0, 0], [0, 0, 0]), dR = dopplerRatio([0, 0, 0], [-34.3, 0, 0], [100, 0, 0], [0, 0, 0]);
ok(near(dA, 1 / 0.9, 1e-9) && near(dR, 1 / 1.1, 1e-9) && dopplerRatio([0, 0, 0], [0, 50, 0], [100, 0, 0], [0, 0, 0]) === 1, `Doppler: approaching at 0.1 c is ${dA.toFixed(4)}, receding ${dR.toFixed(4)}, sideways 1`);
ok(dopplerRatio([0, 0, 0], [34.3, 0, 0], [100, 0, 0], [0, 0, 0], 343, 0) === 1 && dopplerRatio([0, 0, 0], [3000, 0, 0], [1, 0, 0], [0, 0, 0]) === 2, 'Doppler: factor 0 is off, supersonic is clamped to 2');
const o0 = occlusionResponse(0), o1 = occlusionResponse(1), oh = occlusionResponse(0.5);
ok(o0.gain === 1 && o0.freq === 20000 && near(o1.gain, 0.3) && near(o1.freq, 700, 1e-6) && oh.freq < 4000 && oh.freq > 3000 && oh.gain < 1, `occlusion response: open 20 kHz / 1, shut 700 Hz / 0.3, half ${oh.freq.toFixed(0)} Hz / ${oh.gain.toFixed(2)}`);

// ---- impulse responses and WAV -------------------------------------------------------------------------------
{
  const t0 = performance.now(), ir = impulseResponse({ ...REVERBS.hall, sampleRate: 48000 }), ms = performance.now() - t0;
  const again = impulseResponse({ ...REVERBS.hall, sampleRate: 48000 });
  let e = 0, same = true;
  for (let i = 0; i < ir[0].length; i++) { e += (ir[0][i] ** 2 + ir[1][i] ** 2) / 2; if (ir[0][i] !== again[0][i]) same = false; }
  const n = ir[0].length, head = rms(ir[0], 0, n >> 2), tail = rms(ir[0], n - (n >> 2), n);
  ok(near(e, 1, 1e-3) && same && tail < head * 0.05 && ir[0].some((v, i) => v !== ir[1][i]), `hall impulse response: unit energy per channel on average, seeded (identical twice), tail ${(20 * Math.log10(tail / head)).toFixed(0)} dB under the head, ${ms.toFixed(0)} ms for ${(n / 48000).toFixed(1)} s`);
  const sr = 8000, a = new Float32Array(sr), b = new Float32Array(sr);
  for (let i = 0; i < sr; i++) { a[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5; b[i] = i / sr - 0.5; }
  const w16 = decodeWav(encodeWav([a, b], sr).buffer), w32 = decodeWav(encodeWav([a, b], sr, 32).buffer);
  let e16 = 0, e32 = 0;
  for (let i = 0; i < sr; i++) { e16 = Math.max(e16, Math.abs(w16.channels[1][i] - b[i])); e32 = Math.max(e32, Math.abs(w32.channels[0][i] - a[i])); }
  ok(w16.sampleRate === sr && w16.channels.length === 2 && e16 < 1 / 32000 && e32 === 0, `WAV: 16-bit round trip within ${e16.toExponential(1)}, float 32 exact`);
  ok(near(toneLevel(a, sr, 440), 0.5, 1e-3) && toneLevel(a, sr, 1000) < 1e-3, 'tone probe: 0.5 at 440 Hz, nothing at 1 kHz');
  const late = new Float32Array(1000); late.fill(0.5, 300);
  ok(onset(late, 0.1) === 300, 'onset: the first sample over the level');
  const url = 'data:audio/wav;base64,' + Buffer.from(encodeWav([a], sr)).toString('base64');
  ok(decodeWav(dataUrlBytes(url).buffer).channels[0].length === sr, 'a data: URL decodes to the same WAV');
}

// ---- zones ---------------------------------------------------------------------------------------------------
{
  const z = normalizeZones([{ name: 'hall', box: [0, 0, 0, 10, 4, 10], fade: 2, reverb: 'hall' }, { name: 'cave', sphere: [20, 0, 0, 5], fade: 5, reverb: 'cave', priority: 1 },
    { name: 'nook', center: [5, 2, 5], size: 2, fade: 1, priority: 2 }]);
  const w = (p) => zoneWeights(z, p).map((x) => +x.toFixed(3));
  ok(String(w([2, 1, 2])) === '1,0,0,0', 'inside a box: that zone alone');
  ok(String(w([11, 1, 5])) === '0.5,0,0,0.5', 'one metre outside a 2 m fade: half zone, half ambient');
  ok(String(w([5, 2, 5])) === '0,0,1,0', 'a higher-priority zone inside another takes all of it');
  ok(String(w([12, 0, 0])) === '0,0.4,0,0.6' && w([13, 1, -40])[3] === 1, 'sphere fade; nothing far away');
  const both = w([11, 0, 0]);   // 1 m outside the hall, 4 m outside the cave's sphere
  ok(near(both[0] + both[1] + both[3], 1, 1e-9) && both[1] > 0 && both[0] > 0, `overlapping fades share: hall ${both[0]}, cave ${both[1]}, ambient ${both[3]}`);
  ok(zonesFromPlan({ audio: { zones: [{ shape: 'sphere', center: [0, 0, 0], radius: 3 }] } })[0].sphere[3] === 3 && zonesFromPlan({}).length === 0, 'zones from a world plan (plan.audio.zones)');
}

// ---- occluders -----------------------------------------------------------------------------------------------
{
  // a 16 x 16 m grid of 0.25 m cells, floor at 0 with a 3 m ceiling, and a wall (no floor) for x in 7.5..8.5 except a door at z 7..9
  const cell = 0.25, nx = 64, nz = 64, floors = new Float32Array(nx * nz * 8), count = new Uint8Array(nx * nz);
  for (let k = 0; k < nx * nz; k++) {
    const x = ((k % nx) + 0.5) * cell, z = (Math.floor(k / nx) + 0.5) * cell, wall = x > 7.5 && x < 8.5 && !(z > 7 && z < 9);
    if (!wall) { count[k] = 1; floors[k * 8] = 0; floors[k * 8 + 1] = 3; }
  }
  const grid = { nx, nz, x0: 0, z0: 0, cell, floors, count, idx: (x, z) => { const i = Math.floor(x / cell), j = Math.floor(z / cell); return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i; } };
  const t = gridOccluder(grid);
  ok(t([2, 1.6, 2], [14, 1.6, 2]) === 1 && t([2, 1.6, 8], [14, 1.6, 8]) === 0 && t([2, 1.6, 2], [6, 1.6, 12]) === 0, 'walk grid: through the wall 1, through the door 0, same room 0');
  ok(t([2, 5, 2], [6, 5, 2]) === 1 && t([-5, 1, -5], [-1, 1, -1]) === 0, 'walk grid: above the ceiling is solid, outside the grid is open');
  const thin = gridOccluder(grid, { thickness: 4 })([2, 1.6, 2], [14, 1.6, 2]);
  ok(thin > 0.2 && thin < 0.3, `walk grid: a 1 m wall against thickness 4 m is ${thin.toFixed(2)}`);
  const calls = [], phys = { ray: (from, dir, max) => { calls.push([from.slice(), dir.slice(), max]); return from[0] < 5 ? { distance: 1 } : null; } };
  const p = physicsOccluder(phys);
  ok(p([0, 0, 0], [10, 0, 0]) === 1 && p([6, 0, 0], [10, 0, 0]) === 0 && near(calls[0][2], 9.4) && near(calls[0][0][0], 0.3) && p([0, 0, 0], [0.5, 0, 0]) === 0 && calls.length === 2, 'physics ray: starts and ends 0.3 m in, hit is 1, nothing closer than 0.6 m is tested');
}

// ---- the engine's decisions, on a context that does nothing -----------------------------------------------
const param = (value = 0) => ({ value, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
function fakeContext() {
  const made = { sources: 0, started: [] };
  const node = (kind) => new Proxy({ kind, connect() {}, disconnect() {}, start(when, off) { made.started.push([+when.toFixed(4), +(off || 0).toFixed(4)]); }, stop() {}, getFloatTimeDomainData() {} },
    { get(t, k) { if (!(k in t) && typeof k === 'string') t[k] = param(); return t[k]; }, set(t, k, v) { t[k] = v; return true; } });
  const ctx = { sampleRate: 48000, currentTime: 0, state: 'running', destination: node('destination'), listener: node('listener'), made,
    createBuffer: (channels, length, sampleRate) => { const d = Array.from({ length: channels }, () => new Float32Array(length)); return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i) => d[i] }; } };
  for (const k of ['Gain', 'BiquadFilter', 'Panner', 'Convolver', 'Delay', 'WaveShaper', 'DynamicsCompressor', 'Analyser', 'StereoPanner']) ctx['create' + k] = () => node(k);
  ctx.createBufferSource = () => { made.sources++; return node('source'); };
  return ctx;
}
function run(seed) {
  const ctx = fakeContext(), log = [];
  const e = createAudioEngine({ context: ctx, voices: 4, hrtfVoices: 2, seed });
  const buf = (sec) => ctx.createBuffer(1, Math.round(sec * 48000), 48000);
  e.add('short', buf(0.5)); e.add('long', buf(4)); e.add('a', buf(0.2)); e.add('b', buf(0.2)); e.add('c', buf(0.2));
  e.cue('step', { sounds: ['a', 'b', 'c'], mode: 'shuffle', gain: [0.5, 1], pitch: [-2, 2], cooldown: 0.1 });
  e.cue('seq', { sounds: ['a', 'b', 'c'], mode: 'sequence' });
  e.cue('one', { sounds: ['long'], instances: 1 });
  const cam = { pos: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };
  const step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { ctx.currentTime += dt; e.update(dt, cam); } };
  return { e, ctx, log, step, cam };
}
{
  const { e, ctx, step, cam } = run('a');
  step();
  // six loops at growing distance and a cap of four: the nearest four sound
  const vs = [1, 2, 4, 8, 16, 32].map((d) => e.play('long', { at: [d, 0, 0], loop: true }));
  ok(e.stats.voices === 4 && e.stats.virtual === 2 && vs.slice(0, 4).every((v) => v.real) && !vs[4].real && !vs[5].real, 'cap 4: the four nearest of six sound, two are virtual');
  ok(e.stats.hrtf === 2 && ctx.made.sources === 4, 'HRTF budget 2: the other two real voices pan equal-power');
  step(60);
  ok(near(vs[5].time, 1, 1e-6) && near(vs[0].time, 1, 1e-6), 'a virtual voice keeps time: 1 s after 60 updates, same as a real one');
  // the listener walks to the far end: the far voices take over and resume where they would be
  cam.pos = [40, 0, 0]; step();
  ok(vs[5].real && vs[4].real && !vs[0].real && !vs[1].real && e.stats.voices === 4, 'after the listener moves, the far voices sound and the near ones are virtual');
  const resumed = ctx.made.started.at(-1);
  ok(near(resumed[1], vs[5].time, 0.02) && e.stats.resumed === 2, `the resumed voice starts ${resumed[1].toFixed(3)} s into its buffer`);
  // priority beats loudness
  const boss = e.play('long', { at: [0, 0, 0], priority: 200, loop: true, model: 'linear', max: 100 });
  ok(boss.real && e.stats.voices === 4 && e.stats.stolen >= 1, 'a high-priority voice far away steals a slot at once');
  const weak = e.play('long', { at: [-500, 0, 0], priority: 10, virtual: 'stop' });
  ok(weak === null && e.stats.dropped === 1, 'virtual: "stop" and no slot: not started at all');
  // silence
  const quiet = e.play('long', { gain: 0.0001, priority: 255 });
  ok(quiet && !quiet.real, 'a voice below the silence threshold is virtual whatever its priority');
  quiet.set({ gain: 1 }); step();
  ok(quiet.real && e.stats.voices === 4, 'and sounds once its gain comes up');
  // one-shots end on the engine clock
  let ended = 0;
  const s = e.play('short', { priority: 255, onEnd: (v, natural) => { ended += natural ? 1 : 10; } });
  step(29); ok(s.playing && ended === 0, 'a 0.5 s one-shot is alive after 29 updates');
  step(2); ok(!s.playing && ended === 1, 'and has ended (naturally) after 31');
  const f = e.play('long', { priority: 255 }); f.stop(0.5); step(20); ok(f.playing, 'stop(0.5) is still fading at 0.33 s'); step(12); ok(!f.playing, 'and gone after it');
  // delay, rate
  const d = e.play('short', { delay: 0.5, rate: 2, priority: 255 }); step(30);
  ok(near(d.time, 0, 1e-6), 'a delayed voice has not moved before its delay'); step(15); ok(!d.playing || near(d.time, 0.5, 1e-6), 'then runs at its rate (0.25 s at rate 2 is the whole 0.5 s)');
  // occlusion: budget and schedule
  let rays = 0;
  e.occlusion({ test: (a, b) => { rays++; return a[0] > 20 ? 1 : 0; }, rays: 1, budget: 2, interval: 0.1 });
  cam.pos = [0, 0, 0]; step();
  ok(e.stats.rays <= 2, `occlusion budget: ${e.stats.rays} rays in one update (budget 2)`);
  const before = rays; step(30);
  const per = (rays - before) / 30;
  ok(per <= 2 && per > 0.5, `occlusion: ${per.toFixed(2)} rays per update over 30 updates, every voice refreshed in turn`);
  ok(vs[5].occ > 0.9 && vs[0].occ === 0, 'a voice behind the test wall is occluded (smoothed to 1), a clear one is not');
  // zones
  e.zones([{ name: 'hall', box: [-5, -5, -5, 5, 5, 5], fade: 2, reverb: 'hall' }], { ambient: { reverb: 'outdoor', wet: 0.2 } });
  step(); ok(e.stats.zones.hall === 1, 'zone weight 1 inside'); cam.pos = [6, 0, 0]; step(); ok(e.stats.zones.hall === 0.5, 'and 0.5 one metre out of a 2 m fade');
  ok(audioStatsText(e).includes('voices 4 / 4') && audioStatsText(e).includes('zones hall 0.50'), 'the stat block names voices and zones');
  e.stopAll(); step(3);
  ok(e.stats.total === 0 && e.stats.voices === 0 && e.stats.hrtf === 0, 'stopAll: nothing left, HRTF budget returned');
  // references
  e.add('x', new Float32Array(100)); e.add('x', new Float32Array(100));
  ok(e.release('x') === 1 && e.has('x') && e.release('x') === 0 && !e.has('x'), 'buffers are reference counted: the second release drops it');
  e.dispose(); ok(e.play('long') === null, 'a disposed engine plays nothing');
}
{
  // determinism: the same script twice gives the same choices; another seed gives others
  const script = (seed) => {
    const { e, step } = run(seed), out = [];
    for (let i = 0; i < 40; i++) { const v = e.play('step', { at: [i % 5, 0, 0] }); out.push(v ? `${v.variant}:${v.gain.toFixed(4)}:${v.rate.toFixed(4)}` : '-'); step(i % 3 ? 2 : 9); }
    out.push(JSON.stringify({ ...e.stats, assets: 0 }));
    return out;
  };
  const a = script('s1'), b = script('s1'), c = script('s2');
  ok(a.join() === b.join(), 'the same script and seed twice: identical variants, gains, rates and stats');
  ok(a.join() !== c.join(), 'another seed: different choices');
  ok(a.filter((x) => x === '-').length > 5, `cooldown 0.1 s: ${a.filter((x) => x === '-').length} of 40 plays 2 updates apart were refused`);
  const { e, step } = run('s3');
  const picks = [];
  for (let i = 0; i < 12; i++) { picks.push(e.play('step').variant); step(9); }
  let fair = true, repeat = false;
  for (let i = 0; i < 12; i += 3) if (new Set(picks.slice(i, i + 3)).size !== 3) fair = false;
  for (let i = 1; i < 12; i++) if (picks[i] === picks[i - 1]) repeat = true;
  ok(fair && !repeat, `shuffle: every variant once per round, never the same twice running (${picks.join('')})`);
  ok([0, 1, 2, 3].map(() => e.play('seq').variant).join('') === '0120', 'sequence: in order, round again');
  const first = e.play('one'), second = e.play('one');
  ok(!first.playing && second.playing && e.voices.filter((v) => v.name === 'one').length === 1, 'instances 1: the second play replaces the first');
}
// ---- createAudio's add(): a sound of your own, made at unlock when added before the first gesture ----------------
{
  const had = globalThis.AudioContext, contexts = [];
  globalThis.AudioContext = function FakeAudioContext() {
    const c = fakeContext();
    c.addEventListener = () => {}; c.close = async () => { c.state = 'closed'; };
    const source = c.createBufferSource;
    c.createBufferSource = () => { const s = source(); s.addEventListener = () => {}; s.removeEventListener = () => {}; s.start = () => {}; return s; };
    contexts.push(c); return c;
  };
  try {
    const { createAudio } = await import('./src/audio.js');
    const audio = createAudio(), made = [];
    const shot = (ctx) => { made.push(ctx); return [ctx.createBuffer(1, 480, 48000), ctx.createBuffer(1, 960, 48000)]; };
    ok(audio.add('shot', shot) === audio && made.length === 0, 'add() before unlock keeps the factory for later');
    ok(audio.play('shot') === null && audio.stats.skipped === 1, 'a locked mixer still plays nothing');
    const hum = audio.loop('hum');
    audio.add('hum', (ctx) => ctx.createBuffer(1, 4800, 48000));
    audio.unlock();
    const ctx = contexts[0];
    ok(made.length === 1 && made[0] === ctx && audio.buffers.shot.length === 2, 'unlock() calls the factory once, with the context');
    const s = audio.play('shot');
    ok(s && audio.buffers.shot.includes(s.buffer) && audio.stats.played.shot === 1, 'play() finds the added sound and picks one of its variants');
    ok(hum.src && hum.src.buffer === audio.buffers.hum && hum.src.buffer.length === 4800, 'a loop queued before unlock starts with the added buffer');
    const late = ctx.createBuffer(1, 240, 48000);
    audio.add('click', late);
    ok(audio.buffers.click === late && audio.play('click').buffer === late, 'add() after unlock: a buffer is there at once');
    audio.add('pad', (c) => c.createBuffer(1, 10, 48000));
    ok(audio.buffers.pad.length === 10, 'add() under a built-in name replaces it');
    await audio.dispose();
    ok(audio.add('shot', shot) === audio && audio.buffers === null, 'add() on a disposed mixer does nothing');
  } finally { globalThis.AudioContext = had; }
}
console.log('audio: all checks passed');
