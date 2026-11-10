// The audio engine's checks that need Web Audio: every graph is rendered by an OfflineAudioContext (no sound device,
// no real time) and the samples are measured: levels, spectra, onsets to the sample. The engine is ticked once per
// 1024 frames of the render, so its clock and the audio clock agree and every run gives the same samples.
// window.__audio.runTests() in the page; examples/demos/audio/audio-check.mjs runs them in headless Chrome.
import { createAudio, createAudioEngine, createMixer, createMusic, audioStatsText, encodeWav, gainToDb, rms, peak, toneLevel, onset } from '@mirage/game';
import { SR, sine, noise, impulse, rampUp, step } from './sounds.js';

const QN = 1024, DT = QN / SR;
const offline = (sec, ch = 2) => new OfflineAudioContext(ch, Math.ceil((sec * SR) / QN) * QN, SR);
/** render ctx, calling each(t) and engine.update(DT, cam(t)) every 1024 frames */
function render(ctx, engine, { cam, each } = {}) {
  const frames = ctx.length / QN;
  for (let k = 1; k < frames; k++) ctx.suspend(k * DT).then(() => { const t = k * DT; each?.(t, k); engine?.update(DT, cam ? cam(t) : undefined); ctx.resume(); });
  return ctx.startRendering();
}
const S = (t) => Math.round(t * SR);
const src = (ctx, data, to, { loop = false, at = 0 } = {}) => { const b = ctx.createBuffer(1, data.length, SR); b.getChannelData(0).set(data); const s = ctx.createBufferSource(); s.buffer = b; s.loop = loop; s.connect(to); s.start(at); return s; };
const lvl = (out, f, t0, t1, ch = 0) => toneLevel(out.getChannelData(ch), SR, f, S(t0), S(t1));
const both = (out, f, t0, t1) => Math.hypot(lvl(out, f, t0, t1, 0), lvl(out, f, t0, t1, 1));
const dB = (x) => gainToDb(x);
const near = (x, want, tol) => Math.abs(x - want) <= tol;
const EARS = { pos: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };
const engineOn = (ctx, o = {}) => createAudioEngine({ context: ctx, panning: 'equalpower', doppler: 0, ...o });

const tests = [];
const T = (name, fn) => tests.push({ name, fn });

// ---- mixer -------------------------------------------------------------------------------------------------
T('bus tree: gains multiply down the tree', async () => {
  const ctx = offline(0.5), m = createMixer(ctx);
  m.bus('group', { gain: 0.5 }); m.bus('a', { parent: 'group', gain: 0.5 }); m.bus('b', { gain: 0.3 });
  src(ctx, sine(1000, 0.5), m.bus('a').input); src(ctx, sine(3000, 0.5), m.bus('b').input);
  const out = await ctx.startRendering(), a = lvl(out, 1000, 0.1, 0.4), b = lvl(out, 3000, 0.1, 0.4);
  return { ok: near(a, 0.25, 1e-3) && near(b, 0.3, 1e-3), note: `a under group 0.5 x 0.5 -> ${a.toFixed(4)}, b 0.3 -> ${b.toFixed(4)}`, n: { busGainErr: Math.max(Math.abs(a - 0.25), Math.abs(b - 0.3)) } };
});
T('low-pass, high-pass and EQ: measured spectra', async () => {
  const run = async (fx, f) => { const ctx = offline(0.5), m = createMixer(ctx); m.bus('x', { effects: [fx] }); src(ctx, sine(f, 0.5), m.bus('x').input); return dB(lvl(await ctx.startRendering(), f, 0.2, 0.45)); };
  const lp = [await run({ type: 'lowpass', freq: 1000 }, 125), await run({ type: 'lowpass', freq: 1000 }, 1000), await run({ type: 'lowpass', freq: 1000 }, 8000)];
  const hp = [await run({ type: 'highpass', freq: 1000 }, 125), await run({ type: 'highpass', freq: 1000 }, 8000)];
  const eq = [await run({ type: 'eq', low: 6, high: -9 }, 60), await run({ type: 'eq', low: 6, high: -9 }, 1000), await run({ type: 'eq', low: 6, high: -9 }, 12000)];
  const ok = near(lp[0], 0, 0.1) && near(lp[1], -3, 0.3) && near(lp[2], -37, 2) && near(hp[0], -36, 1.5) && near(hp[1], 0, 0.1) && near(eq[0], 6, 0.5) && near(eq[1], 0, 1.2) && near(eq[2], -9, 0.5);
  return { ok, note: `low-pass 1 kHz: ${lp.map((x) => x.toFixed(1)).join(' / ')} dB at 125 / 1k / 8k; high-pass: ${hp.map((x) => x.toFixed(1)).join(' / ')} dB at 125 / 8k; eq +6 low -9 high: ${eq.map((x) => x.toFixed(1)).join(' / ')} dB at 60 / 1k / 12k`, n: { lowpass8k: lp[2], lowpassCorner: lp[1] } };
});
T('compressor: 40 dB of input range comes out narrower', async () => {
  const run = async (amp, fx) => { const ctx = offline(1), m = createMixer(ctx); m.bus('x', { effects: fx ? [fx] : [] }); src(ctx, sine(500, 1, amp), m.bus('x').input); return dB(lvl(await ctx.startRendering(), 500, 0.6, 0.95)); };
  const fx = { type: 'compressor', threshold: -30, ratio: 12, knee: 0, attack: 0.003, release: 0.1 };
  const loud = await run(1, fx), quiet = await run(0.01, fx), range = loud - quiet;
  return { ok: range < 22 && range > 2, note: `0 dB and -40 dB tones come out ${range.toFixed(1)} dB apart (40 dB in)`, n: { compressorRange: range } };
});
T('delay: the echo lands on time', async () => {
  const ctx = offline(1), m = createMixer(ctx);
  m.bus('x', { effects: [{ type: 'delay', time: 0.25, feedback: 0, wet: 0.5, dry: 1, damp: 20000 }] });
  src(ctx, impulse(0.2, 0.1), m.bus('x').input);
  const d = (await ctx.startRendering()).getChannelData(0), dry = onset(d, 0.5), echo = onset(d, 0.1, dry + 100);
  const err = echo - dry - S(0.25);
  return { ok: dry === S(0.1) && Math.abs(err) <= 2 && near(peak(d, echo - 4, echo + 40), 0.5, 0.06), note: `echo ${((echo - dry) / SR * 1000).toFixed(3)} ms after the click (asked 250), ${err} samples off, level ${peak(d, echo - 4, echo + 40).toFixed(3)} (wet 0.5)`, n: { delayErrSamples: err } };
});
T('reverb: code-made impulse responses keep the level and decay as asked', async () => {
  const run = async (preset) => {
    const ctx = offline(5), m = createMixer(ctx);
    m.bus('x', { effects: [{ type: 'reverb', preset, wet: 1, dry: 0 }] });
    src(ctx, impulse(0.1, 0.01), m.bus('x').input);
    const out = await ctx.startRendering(), L = out.getChannelData(0), R = out.getChannelData(1);
    let e = 0; const tail = new Float64Array(L.length + 1);
    for (let i = L.length - 1; i >= 0; i--) { e += (L[i] * L[i] + R[i] * R[i]) / 2; tail[i] = e; }   // Schroeder: energy still to come
    const at = (db) => { const x = e * 10 ** (db / 10); let i = 0; while (i < L.length && tail[i] > x) i++; return i / SR; };
    return { energy: e, rt60: (at(-35) - at(-5)) * 2 };
  };
  const room = await run('room'), hall = await run('hall');
  const ok = near(dB(Math.sqrt(room.energy)), 0, 0.5) && near(dB(Math.sqrt(hall.energy)), 0, 0.5) && near(room.rt60, 0.6, 0.15) && near(hall.rt60, 2.1, 0.45);
  return { ok, note: `impulse through room: ${dB(Math.sqrt(room.energy)).toFixed(2)} dB energy, RT60 ${room.rt60.toFixed(2)} s (decay 0.6); hall: ${dB(Math.sqrt(hall.energy)).toFixed(2)} dB, RT60 ${hall.rt60.toFixed(2)} s (decay 2.1)`, n: { rt60Room: room.rt60, rt60Hall: hall.rt60 } };
});
T('sends: post-fader follows the fader, pre-fader does not', async () => {
  const run = async (pre, fader) => {
    const ctx = offline(0.5), m = createMixer(ctx);
    m.bus('aux', { gain: 1 }); m.bus('x', { gain: fader, sends: { aux: { gain: 0.5, pre } } });
    src(ctx, sine(1000, 0.5), m.bus('x').input);
    return lvl(await ctx.startRendering(), 1000, 0.1, 0.4);
  };
  const a = await run(false, 1), b = await run(false, 0), c = await run(true, 0);
  return { ok: near(a, 1.5, 2e-3) && near(b, 0, 1e-4) && near(c, 0.5, 2e-3), note: `post, fader 1: ${a.toFixed(3)} (1 + 0.5); post, fader 0: ${b.toFixed(4)}; pre, fader 0: ${c.toFixed(3)}` };
});
T('snapshots: a timed transition is where it should be at every moment', async () => {
  const ctx = offline(2.5), m = createMixer(ctx);
  m.bus('music', { effects: [{ id: 'lp', type: 'lowpass', freq: 20000 }] });
  m.snapshot('quiet', { music: { gain: 0.25 } }); m.snapshot('muffled', { music: { lp: { freq: 500 } } });
  src(ctx, sine(250, 2.5), m.bus('music').input); src(ctx, sine(8000, 2.5, 0.5), m.bus('music').input);
  ctx.suspend(S(0.5) / SR - (S(0.5) % 128) / SR).then(() => { m.transition('quiet', 1); ctx.resume(); });
  ctx.suspend(1.75 - (S(1.75) % 128) / SR).then(() => { m.transition({ quiet: 0.5, muffled: 0.5 }, 0.25); ctx.resume(); });
  const out = await ctx.startRendering(), d = out.getChannelData(0), t0 = (S(0.5) - (S(0.5) % 128)) / SR;
  const at = (t) => toneLevel(d, SR, 250, S(t) - 480, S(t) + 480);   // 20 ms window: 5 whole periods of 250 Hz
  const mid = at(t0 + 0.5), end = at(1.6), blend = at(2.3), hi = dB(lvl(out, 8000, 2.2, 2.45) / 0.5 / blend);
  // half-way: 0.625; then 0.25; the blend of quiet and muffled: gain (0.25 + 1) / 2, low-pass (20000 + 500) / 2 Hz
  const ok = near(mid, 0.625, 0.006) && near(end, 0.25, 0.003) && near(blend, 0.625, 0.006) && near(hi, 0, 3.5);
  return { ok, note: `to 0.25 over 1 s: ${mid.toFixed(4)} half-way (0.625), ${end.toFixed(4)} after; blend 50/50 with a second snapshot: gain ${blend.toFixed(4)} (0.625), 8 kHz ${hi.toFixed(1)} dB under a 10.25 kHz low-pass`, n: { snapshotMidErr: Math.abs(mid - 0.625) } };
});
T('ducking: music goes down under dialogue and comes back', async () => {
  const ctx = offline(4), m = createMixer(ctx);
  m.bus('music', {}); m.bus('dialogue', {});
  m.duck('music', 'dialogue', { amount: 0.25, threshold: 0.02, attack: 0.05, release: 0.4 });
  src(ctx, sine(440, 4, 0.5), m.bus('music').input);
  src(ctx, sine(2000, 1, 0.3), m.bus('dialogue').input, { at: 1 });
  const out = await ctx.startRendering(), d = out.getChannelData(0);
  const at = (t) => toneLevel(d, SR, 440, S(t) - 1200, S(t) + 1200) / 0.5;
  const before = at(0.8), during = at(1.8), after = at(3.8);
  let down = -1, up = -1;
  for (let t = 1; t < 2 && down < 0; t += 0.005) if (at(t) < 0.625) down = t - 1;
  for (let t = 2; t < 4 && up < 0; t += 0.005) if (at(t) > 0.625) up = t - 2;
  const ok = near(before, 1, 0.005) && near(during, 0.25, 0.02) && near(after, 1, 0.03) && down > 0 && down < 0.2 && up > 0.1 && up < 1;
  return { ok, note: `music ${before.toFixed(3)} before, ${during.toFixed(3)} under dialogue (amount 0.25), ${after.toFixed(3)} 1.8 s after; half-way down in ${(down * 1000).toFixed(0)} ms, half-way back in ${(up * 1000).toFixed(0)} ms`, n: { duckDepth: during, duckDownMs: down * 1000, duckUpMs: up * 1000 } };
});

// ---- spatial -----------------------------------------------------------------------------------------------
async function spatial(o, { f = 1000, sec = 0.5, cam = () => EARS, panning = 'equalpower', eng = {} } = {}) {
  const ctx = offline(sec), e = engineOn(ctx, { panning, ...eng });
  e.add('tone', sine(f, 1)); e.listener(cam(0));
  e.play('tone', { loop: true, ...o });
  const out = await render(ctx, e, { cam });
  return { out, e, L: lvl(out, f, sec - 0.3, sec - 0.02, 0), R: lvl(out, f, sec - 0.3, sec - 0.02, 1), A: both(out, f, sec - 0.3, sec - 0.02) };
}
T('distance models and a custom roll-off curve', async () => {
  const cases = [
    ['inverse, 4 m', { at: [0, 0, -4] }, 0.25], ['inverse ref 2 rolloff 2, 6 m', { at: [0, 0, -6], ref: 2, rolloff: 2 }, 2 / (2 + 2 * 4)],
    ['linear 1..11, 6 m', { at: [0, 0, -6], model: 'linear', max: 11 }, 0.5], ['exponential rolloff 2, 4 m', { at: [0, 0, -4], model: 'exponential', rolloff: 2 }, 1 / 16],
    ['custom curve, 5 m', { at: [0, 0, -5], model: 'custom', curve: [[0, 1], [2, 0.8], [10, 0]] }, 0.5], ['custom function, 3 m', { at: [0, 0, -3], model: 'custom', curve: (d) => 1 / (1 + d * d) }, 0.1],
  ];
  let worst = 0; const parts = [];
  for (const [name, o, want] of cases) { const r = await spatial(o); worst = Math.max(worst, Math.abs(r.A - want)); parts.push(`${name}: ${r.A.toFixed(4)} (${want.toFixed(4)})`); }
  return { ok: worst < 2e-3, note: parts.join('; '), n: { distanceGainErr: worst } };
});
T('panning: equal-power and HRTF put the sound on the right side', async () => {
  const eqR = await spatial({ at: [5, 0, 0], model: 'linear', ref: 100 }), eqC = await spatial({ at: [0, 0, -5], model: 'linear', ref: 100 });
  const hR = await spatial({ at: [5, 0, 0], model: 'linear', ref: 100 }, { panning: 'HRTF' }), hL = await spatial({ at: [-5, 0, 0], model: 'linear', ref: 100 }, { panning: 'HRTF' });
  const ild = dB(hR.R / hR.L), ildL = dB(hL.L / hL.R);
  const ok = eqR.L < 1e-3 && near(eqR.R, 1, 0.01) && near(eqC.L, Math.SQRT1_2, 0.01) && near(eqC.R, Math.SQRT1_2, 0.01) && ild > 6 && ildL > 6 && hR.e.stats.hrtf === 1 && eqR.e.stats.hrtf === 0;
  return { ok, note: `equal-power: right ${eqR.L.toFixed(3)} / ${eqR.R.toFixed(3)}, ahead ${eqC.L.toFixed(3)} / ${eqC.R.toFixed(3)}; HRTF at 1 kHz: far ear ${ild.toFixed(1)} dB down on the right, ${ildL.toFixed(1)} dB on the left`, n: { hrtfILD: ild } };
});
T('cones: quieter behind the source', async () => {
  const cone = { at: [0, 0, -4], model: 'linear', ref: 100, inner: 60, outer: 180, outerGain: 0.1 };
  const front = await spatial({ ...cone, dir: [0, 0, 1] }), side = await spatial({ ...cone, dir: [Math.sin(Math.PI / 3), 0, Math.cos(Math.PI / 3)] }), back = await spatial({ ...cone, dir: [0, 0, -1] });
  // 60 degrees off axis is half-way between the inner (30) and outer (90) half-angles: gain (1 + 0.1) / 2
  return { ok: near(front.A, 1, 2e-3) && near(side.A, 0.55, 5e-3) && near(back.A, 0.1, 2e-3), note: `facing the listener ${front.A.toFixed(3)}, 60 degrees off ${side.A.toFixed(3)} (0.55), facing away ${back.A.toFixed(3)} (outerGain 0.1)` };
});
T('spread and blend: a wide or flat source loses its direction', async () => {
  const p = { at: [5, 0, 0], model: 'linear', ref: 100 };
  const point = await spatial(p), wide = await spatial({ ...p, spread: 1 }), half = await spatial({ ...p, spread: 0.5 }), flat = await spatial({ at: [5, 0, 0], blend: 0 });
  const ok = point.L < 1e-3 && near(wide.L, wide.R, 1e-3) && half.L > 0.2 && half.R > half.L && near(flat.L, 1, 2e-3) && near(flat.R, 1, 2e-3);
  return { ok, note: `at the right, left / right: spread 0 ${point.L.toFixed(3)} / ${point.R.toFixed(3)}, 0.5 ${half.L.toFixed(3)} / ${half.R.toFixed(3)}, 1 ${wide.L.toFixed(3)} / ${wide.R.toFixed(3)}; blend 0 at 5 m ${flat.L.toFixed(3)} / ${flat.R.toFixed(3)} (no distance, no pan)` };
});
T('Doppler: a source coming at 34.3 m/s is a tenth higher', async () => {
  const run = async (speed) => {
    const ctx = offline(1.2), e = engineOn(ctx, { doppler: 1 });
    e.add('tone', sine(1000, 1)); e.listener(EARS);
    let t = 0;
    e.play('tone', { loop: true, at: () => [0, 0, -(80 - speed * t)], model: 'linear', ref: 1000 });
    const out = await render(ctx, e, { cam: () => EARS, each: (now) => { t = now; } }), d = out.getChannelData(0);
    let n = 0, first = -1, last = -1;   // rising zero crossings in 0.4 .. 1.1 s, ends interpolated
    for (let i = S(0.4); i < S(1.1); i++) if (d[i - 1] < 0 && d[i] >= 0) { const x = i - d[i] / (d[i] - d[i - 1]); if (first < 0) first = x; last = x; n++; }
    return ((n - 1) * SR) / (last - first);
  };
  const toward = await run(34.3), away = await run(-34.3), still = await run(0);
  const ok = near(toward, 1000 / 0.9, 2) && near(away, 1000 / 1.1, 2) && near(still, 1000, 0.05);
  return { ok, note: `1000 Hz heard as ${toward.toFixed(1)} Hz approaching (1111.1), ${away.toFixed(1)} Hz leaving (909.1), ${still.toFixed(2)} Hz at rest`, n: { dopplerToward: toward, dopplerAway: away } };
});

// ---- environment -------------------------------------------------------------------------------------------
T('occlusion: a wall takes the level down and the highs away, over time', async () => {
  const run = async (f, shutAt) => {
    const ctx = offline(2), e = engineOn(ctx);
    let shut = shutAt === 0;
    e.occlusion({ test: () => (shut ? 1 : 0), rays: 3, gain: 0.3, freq: 700, interval: 0.1, smooth: 0.1 });
    e.add('tone', sine(f, 1)); e.listener(EARS);
    e.play('tone', { loop: true, at: [0, 0, -3], model: 'linear', ref: 100 });
    const out = await render(ctx, e, { cam: () => EARS, each: (t) => { if (shutAt > 0 && t >= shutAt) shut = true; } });
    return { out, e };
  };
  const open = await run(200, -1), low = await run(200, 0), high = await run(4000, 0), openHigh = await run(4000, -1), move = await run(200, 0.5);
  const lo = both(low.out, 200, 1.5, 1.9) / both(open.out, 200, 1.5, 1.9), hi = dB(both(high.out, 4000, 1.5, 1.9) / both(openHigh.out, 4000, 1.5, 1.9));
  let half = -1;
  const d = move.out.getChannelData(0);
  for (let t = 0.5; t < 1.9 && half < 0; t += 0.005) if (toneLevel(d, SR, 200, S(t) - 480, S(t) + 480) * Math.SQRT2 < 0.65) half = t - 0.5;
  const first = both(low.out, 200, 0.02, 0.12) / both(open.out, 200, 0.02, 0.12);
  // 200 Hz under a 700 Hz low-pass keeps its level, so only the gain (0.3) shows; 4 kHz is 2.5 octaves above the corner
  const ok = near(lo, 0.3, 0.02) && hi < -36 && half > 0.05 && half < 0.4 && near(first, 0.3, 0.03);
  return { ok, note: `behind a wall: 200 Hz x${lo.toFixed(3)} (gain 0.3), 4 kHz ${hi.toFixed(1)} dB; already x${first.toFixed(3)} in its first 100 ms; a wall that appears is half-way in ${(half * 1000).toFixed(0)} ms; ${low.e.stats.raysTotal} rays in 2 s for one voice`, n: { occlusionLow: lo, occlusionHighDb: hi, occlusionHalfMs: half * 1000 } };
});
T('reverb zones: wet by where the listener stands', async () => {
  const run = async (x) => {
    const ctx = offline(3.5), e = engineOn(ctx);
    e.zones([{ name: 'hall', box: [-5, -2, -5, 5, 4, 5], fade: 4, reverb: 'hall', wet: 1 }]);
    e.add('burst', noise(0.1, 0.5, 'zone')); const cam = () => ({ ...EARS, pos: [x, 0, 0] }); e.listener(cam());
    let fired = false;
    const out = await render(ctx, e, { cam, each: (t) => { if (!fired && t >= 0.8) { fired = true; e.play('burst', { at: [x, 0, -1], model: 'linear', ref: 100 }); } } });
    const d = out.getChannelData(0), at = S(0.8 + DT);
    return { dry: rms(d, at, at + S(0.1)), tail: rms(d, at + S(0.3), at + S(1.3)), w: e.stats.zones.hall };
  };
  const inside = await run(0), edge = await run(7), out = await run(20);
  const ratio = dB(edge.tail / inside.tail);
  const ok = inside.w === 1 && edge.w === 0.5 && out.w === 0 && inside.tail > 0.003 && near(ratio, -6, 0.6) && out.tail < 1e-6 && near(out.dry / inside.dry, 1, 0.3);
  return { ok, note: `tail after a burst: inside ${dB(inside.tail).toFixed(1)} dB, 2 m outside (weight ${edge.w}) ${ratio.toFixed(2)} dB lower, far outside ${out.tail < 1e-9 ? 'silent' : dB(out.tail).toFixed(1) + ' dB'}`, n: { zoneHalfDb: ratio } };
});

// ---- voices ------------------------------------------------------------------------------------------------
T('voice cap: the nearest sound, the rest keep time', async () => {
  const freqs = [300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2300, 2500];
  const run = async (count, cap) => {
    const ctx = offline(0.6), e = engineOn(ctx, { voices: cap });
    e.listener(EARS);
    for (let i = 0; i < count; i++) { e.add('t' + i, sine(freqs[i], 1)); e.play('t' + i, { loop: true, at: [0, 0, -(1 + i)] }); }
    const out = await render(ctx, e, { cam: () => EARS });
    return { out, s: { ...e.stats } };
  };
  const capped = await run(12, 4), four = await run(4, 32);
  const a = capped.out.getChannelData(0), b = four.out.getChannelData(0);
  let diff = 0; for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
  const ok = capped.s.voices === 4 && capped.s.virtual === 8 && capped.s.peak === 4 && diff < 1e-6;
  return { ok, note: `12 loops, cap 4: ${capped.s.voices} sounding, ${capped.s.virtual} virtual, peak ${capped.s.peak}; output differs from the nearest 4 alone by ${diff.toExponential(1)}`, n: { capDiff: diff } };
});
T('virtual voices: back in at the right place in the sound', async () => {
  const ctx = offline(3), e = engineOn(ctx);
  e.add('ramp', rampUp(2));
  const v = e.play('ramp', { loop: true });
  const seen = [];
  const out = await render(ctx, e, { each: (t, k) => { if (k === 30) v.set({ gain: 0 }); if (k === 31) seen.push(v.real); if (k === 90) v.set({ gain: 1 }); if (k === 92) seen.push(v.real); } });
  const d = out.getChannelData(0);
  // value = position / 2 s; read it 100 ms after the voice came back and compare with where an uninterrupted loop would be
  const i = S(90 * DT + 0.1), want = ((i / SR) % 2) / 2, err = (d[i] - want) * 2 * SR;
  const gap = rms(d, S(40 * DT), S(85 * DT));
  const ok = seen[0] === false && seen[1] === true && gap === 0 && Math.abs(err) <= 2 && e.stats.resumed === 1 && e.stats.culled === 1;
  return { ok, note: `silent for ${((90 - 30) * DT).toFixed(2)} s (no source node), then ${err.toFixed(2)} samples from where it would have been (${(err / SR * 1000).toFixed(3)} ms)`, n: { resumeErrSamples: err } };
});
T('priorities: an important sound takes a voice from the quietest', async () => {
  const ctx = offline(1), e = engineOn(ctx, { voices: 2 });
  e.add('a', sine(300, 1)); e.add('b', sine(500, 1)); e.add('c', sine(900, 1)); e.add('d', sine(1300, 1));
  e.play('a', { loop: true, gain: 0.5 }); e.play('b', { loop: true, gain: 0.2 });
  let c, d2;
  const out = await render(ctx, e, { each: (t, k) => { if (k === 20) { d2 = e.play('d', { loop: true, gain: 0.1, priority: 10, virtual: 'stop' }); c = e.play('c', { loop: true, gain: 0.1, priority: 200 }); } } });
  const l = (f, t0, t1) => lvl(out, f, t0, t1);
  const ok = near(l(300, 0.6, 0.9), 0.5, 1e-3) && l(500, 0.6, 0.9) < 1e-4 && near(l(500, 0.1, 0.4), 0.2, 1e-3) && near(l(900, 0.6, 0.9), 0.1, 1e-3) && l(1300, 0.5, 0.9) < 1e-4 && d2 === null && c.real && e.stats.stolen === 1 && e.stats.dropped === 1;
  return { ok, note: `cap 2: priority 200 at gain 0.1 plays (${l(900, 0.6, 0.9).toFixed(3)}), the quieter of the two old voices goes virtual (${l(500, 0.6, 0.9).toExponential(1)}), a priority 10 sound with virtual 'stop' is dropped` };
});
T('cues: the same seed gives the same samples', async () => {
  const run = async (seed) => {
    const ctx = offline(1.5), e = engineOn(ctx, { seed });
    for (let k = 0; k < 4; k++) e.add('s' + k, step(k));
    e.cue('step', { sounds: ['s0', 's1', 's2', 's3'], mode: 'random', gain: [0.6, 1], pitch: [-2, 2], cooldown: 0.05 });
    const picks = [];
    const out = await render(ctx, e, { cam: () => EARS, each: (t, k) => { if (k % 6 === 0) { const v = e.play('step', { at: [Math.sin(k), 0, -2] }); picks.push(v ? v.variant : -1); } if (k % 6 === 1) e.play('step'); } });
    return { d: out.getChannelData(0), r: out.getChannelData(1), picks, cooled: e.stats.cooled };
  };
  const a = await run('one'), b = await run('one'), c = await run('two');
  let same = 0, other = 0;
  for (let i = 0; i < a.d.length; i++) { same = Math.max(same, Math.abs(a.d[i] - b.d[i]), Math.abs(a.r[i] - b.r[i])); other = Math.max(other, Math.abs(a.d[i] - c.d[i])); }
  let rep = 0; for (let i = 1; i < a.picks.length; i++) if (a.picks[i] === a.picks[i - 1]) rep++;
  const ok = same === 0 && other > 0.01 && rep === 0 && a.cooled === a.picks.length && rms(a.d) > 0.005;
  return { ok, note: `${a.picks.length} steps (variants ${a.picks.join('')}), two runs differ by ${same} (sample-identical), another seed by ${other.toFixed(3)}; ${a.cooled} plays inside the cooldown refused`, n: { cueRepeatDiff: same } };
});

// ---- music -------------------------------------------------------------------------------------------------
T('adaptive music: section changes land on the beat and the bar, to the sample', async () => {
  const run = async (quantize, askAt) => {
    const ctx = offline(3.2), e = engineOn(ctx);
    e.add('a', sine(500, 1, 0.5)); e.add('b', sine(2000, 1, 0.5)); e.add('hit', impulse(0.05, 0, 1));
    const m = createMusic(e, { bpm: 240, beatsPerBar: 4, sections: { a: { bars: 1, stems: { tone: 'a' } }, b: { bars: 1, stems: { tone: 'b' } } } });   // beat 0.25 s, bar 1 s
    let at = 0, sec = [];
    m.onSection = (n) => sec.push(n);
    m.play('a');
    const out = await render(ctx, e, { each: (t, k) => { if (k === Math.round(askAt / DT)) at = m.to('b', { quantize, fade: 0 }); } });
    const d = out.getChannelData(0);
    // the first sample that is not section a's 500 Hz sine: where b's 2 kHz (or silence) begins
    let i = S(askAt); while (i < d.length && Math.abs(d[i] - 0.5 * Math.sin((2 * Math.PI * 500 * i) / SR)) < 1e-3) i++;
    return { at, first: i, a: lvl(out, 500, at + 0.1, at + 0.3), b: lvl(out, 2000, at + 0.1, at + 0.3), sec };
  };
  const bar = await run('bar', 1.3), beat = await run('beat', 1.3), end = await run('end', 0.4);
  // 500 Hz and 2 kHz both cross zero on the boundary, so the first sample that differs is the one after it
  const eb = bar.first - S(2), et = beat.first - S(1.5), ee = end.first - S(1);
  const ok = near(bar.at, 2, 1e-9) && near(beat.at, 1.5, 1e-9) && near(end.at, 1, 1e-9) && Math.abs(eb) <= 1 && Math.abs(et) <= 1 && Math.abs(ee) <= 1 && bar.a < 1e-3 && near(bar.b, 0.5, 1e-3) && bar.sec.join() === 'a,b';
  return { ok, note: `asked at 1.3 s (240 bpm, 4/4): next bar -> ${bar.at} s, ${eb} samples off; next beat -> ${beat.at} s, ${et} off; 'end' asked at 0.4 s -> ${end.at} s, ${ee} off; old section ${bar.a.toExponential(1)} after it`, n: { musicBarErrSamples: eb, musicBeatErrSamples: et } };
});
T('adaptive music: stems fade as layers, sections cross-fade', async () => {
  const ctx = offline(3), e = engineOn(ctx);
  e.add('pad', sine(500, 1, 0.5)); e.add('drums', sine(2000, 1, 0.5)); e.add('pad2', sine(1000, 1, 0.5));
  const m = createMusic(e, { bpm: 240, sections: { a: { bars: 1, stems: { pad: 'pad', drums: { sound: 'drums', level: 0 } } }, b: { bars: 1, stems: { pad: 'pad2', drums: 'drums' } } } });
  m.play('a');
  const out = await render(ctx, e, { each: (t, k) => { if (k === 24) m.layer('drums', 1, 0.5); if (k === 70) m.to('b', { quantize: 'bar', fade: 0.5 }); } });
  const d = out.getChannelData(0), at = (f, t) => toneLevel(d, SR, f, S(t) - 480, S(t) + 480) / 0.5;
  const t0 = 24 * DT, off = at(2000, 0.3), mid = at(2000, t0 + 0.25), on = at(2000, 1.3);
  const xa = at(500, 2.25), xb = at(1000, 2.25), kept = at(2000, 2.9);
  const ok = off < 1e-3 && near(mid, 0.5, 0.02) && near(on, 1, 0.01) && near(xa, 0.5, 0.02) && near(xb, 0.5, 0.02) && near(kept, 1, 0.02) && m.section === 'b';
  return { ok, note: `drums layer 0 -> 1 over 0.5 s: ${off.toFixed(3)}, ${mid.toFixed(3)} half-way, ${on.toFixed(3)}; cross-fade at the bar (2 s): old ${xa.toFixed(3)}, new ${xb.toFixed(3)} half-way; the layer's level carries over (${kept.toFixed(3)})` };
});

// ---- files -------------------------------------------------------------------------------------------------
T('files: decode, cache, reference counts, preload groups', async (env) => {
  const ctx = offline(0.2), e = engineOn(ctx);
  const data = sine(440, 0.25, 0.8), wav = encodeWav([data], SR, 16), blob = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  let bin = ''; for (const x of new Uint8Array(wav)) bin += String.fromCharCode(x);
  const dataUrl = 'data:audio/wav;base64,' + btoa(bin);
  const b1 = await e.load(dataUrl, { name: 'tone' }), b2 = await e.load(dataUrl, { name: 'tone' });
  let err = 0; const got = b1.getChannelData(0); for (let i = 0; i < data.length; i++) err = Math.max(err, Math.abs(got[i] - data[i]));
  const refs = [e.release('tone'), e.has('tone'), e.release('tone'), e.has('tone')];
  const seen = [];
  const items = { chime: env.chimeUrl, again: dataUrl };
  let blobOk = true;
  try { await e.load(blob, { name: 'blob' }); } catch { blobOk = false; }
  await e.preload('level', items, (done, total, name) => seen.push(`${done}/${total}`));
  const chime = e.buffer('chime'), count = e.stats.assets.count;
  e.unload('level');
  let bad = '';
  try { await e.load('data:audio/wav;base64,AAAA', { name: 'bad' }); } catch (x) { bad = x.message; }
  URL.revokeObjectURL(blob);
  const ok = b1 === b2 && b1.length === data.length && err < 1 / 16384 && refs.join() === '1,true,0,false' && seen.join() === '1/2,2/2' && near(chime.duration, 0.9, 0.001) && count === 2 + (blobOk ? 1 : 0)
    && !e.has('chime') && e.stats.assets.count === (blobOk ? 1 : 0) && bad.length > 0 && !e.has('bad');
  return { ok, note: `WAV decoded ${b1.length} frames, worst sample error ${err.toExponential(1)}; second load is the same buffer; released at 0 references; preload of 2 (${env.chimeUrl.slice(0, 5) === 'data:' ? 'inlined data: URLs' : 'one fetched file'}) reported ${seen.join(', ')}; chime.wav ${chime.duration.toFixed(2)} s at ${chime.sampleRate} Hz; blob: URL ${blobOk ? 'loads' : 'refused here'}; a broken file rejects`, n: { decodeMs: e.stats.assets.decodeMs } };
});
T('stream: a long file plays through a media element into the music bus', async (env) => {
  const e = createAudioEngine({ panning: 'equalpower' });
  e.unlock();
  if (!e.ctx) return { ok: false, note: 'no AudioContext' };
  const wait = (ok, ms = 8000) => new Promise((res) => { const t0 = performance.now(); (function poll() { if (ok() || performance.now() - t0 > ms) res(ok()); else setTimeout(poll, 20); })(); });
  const s = e.stream(env.themeUrl, { bus: 'music', loop: true, gain: 0.8 });
  const started = await wait(() => s.time > 0.25 && e.ctx.state === 'running');
  let level = 0;
  for (let i = 0; i < 20; i++) { level = Math.max(level, e.meters().music?.peak || 0); await new Promise((r) => setTimeout(r, 20)); }
  const dur = s.duration, state = e.ctx.state, direct = s.direct, st = s.state;
  s.seek(4); const t1 = s.time; s.pause(); const paused = s.paused;
  s.stop(); const n = e.stats.streams;
  e.dispose();
  const ok = started && state === 'running' && !direct && st === 'playing' && level > 0.01 && near(dur, 9.6, 0.05) && near(t1, 4, 0.2) && paused && n === 0;
  return { ok, note: `theme.wav (${dur.toFixed(2)} s) ${started ? 'playing' : 'NOT playing: ' + (s.error?.message || st)}, context ${state}, music bus peak ${level.toFixed(3)}${direct ? ' (past the mixer)' : ''}, seek to ${t1.toFixed(2)} s, pause, stop`, n: { streamPeak: level } };
});
T('existing API: createAudio plays through the engine buses, and alone again after dispose', async () => {
  const audio = createAudio({ volumes: { sfx: 0.5 } });
  audio.unlock();
  if (!audio.ctx) return { ok: false, note: 'no AudioContext' };
  const tap = audio.ctx.createAnalyser(); tap.fftSize = 2048; audio.buses.master.connect(tap);
  const buf = new Float32Array(2048);
  const hear = async (fn) => { let p = 0; fn(); for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 15)); tap.getFloatTimeDomainData(buf); p = Math.max(p, peak(buf)); } await new Promise((r) => setTimeout(r, 500)); return p; };
  for (let i = 0; i < 100 && audio.ctx.state !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
  const alone = await hear(() => audio.play('pickup'));
  const e = createAudioEngine({ audio, buses: { sfx: { effects: [{ id: 'cut', type: 'gain', gain: 1 }] } } });
  const through = await hear(() => audio.play('pickup')), meter = e.mixer.has('sfx');
  e.bus('sfx').effect('cut').set({ gain: 0 });
  await new Promise((r) => setTimeout(r, 60));
  const cut = await hear(() => audio.play('pickup'));
  e.bus('sfx').effect('cut').set({ gain: 1 });
  const viaEngine = await hear(() => e.play('pickup'));   // the legacy mixer's generated sound, by name, as an engine voice
  const loop = audio.loop('wind', { bus: 'ambience' }), stepped = await hear(() => audio.footstep('gravel'));
  e.dispose();
  const after = await hear(() => audio.play('pickup'));
  await audio.dispose();
  const ok = alone > 0.01 && near(through / alone, 1, 0.5) && cut < alone * 0.02 && viaEngine > 0.01 && stepped > 0.001 && after > 0.01 && !!loop;
  return { ok, note: `audio.play('pickup') peak ${alone.toFixed(3)} alone, ${through.toFixed(3)} through the engine's sfx bus, ${cut.toFixed(4)} with that bus's effect at 0, ${after.toFixed(3)} after engine.dispose(); engine.play('pickup') ${viaEngine.toFixed(3)}` };
});

// ---- cost ---------------------------------------------------------------------------------------------------
T('cost: update() per frame and offline render speed', async () => {
  // interleaved: A = HRTF, B = equal-power, 32 moving voices with occlusion and one zone, 2 s of audio each
  const run = async (panning) => {
    const ctx = offline(2), e = engineOn(ctx, { panning, hrtfVoices: 32, voices: 32, doppler: 1 });
    e.zones([{ name: 'hall', sphere: [0, 0, 0, 30], reverb: 'hall', wet: 0.5 }]);
    e.occlusion({ test: (a, b) => (a[0] * b[2] > 3 ? 1 : 0), rays: 3, budget: 9 });
    e.listener(EARS);
    let t = 0;
    for (let i = 0; i < 64; i++) { e.add('s' + i, sine(200 + i * 37, 0.5, 0.05)); e.play('s' + i, { loop: true, at: () => [Math.cos(t + i) * (2 + i * 0.3), 0, Math.sin(t + i) * (2 + i * 0.3)] }); }
    let upd = 0, n = 0;
    const frames = ctx.length / QN;
    for (let k = 1; k < frames; k++) ctx.suspend(k * DT).then(() => { t = k * DT; const t0 = performance.now(); e.update(DT, EARS); upd += performance.now() - t0; n++; ctx.resume(); });
    const t0 = performance.now(); await ctx.startRendering();
    return { ms: performance.now() - t0, upd: upd / n, s: { ...e.stats } };
  };
  const A = [], B = [];
  for (let i = 0; i < 4; i++) { A.push(await run('HRTF')); B.push(await run('equalpower')); }
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)], span = (a) => `${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)}`;
  const h = A.map((r) => r.ms), q = B.map((r) => r.ms), u = [...A, ...B].map((r) => r.upd);
  return { ok: A[0].s.voices === 32 && A[0].s.hrtf === 32 && B[0].s.hrtf === 0 && med(u) < 4,
    note: `64 moving loops (32 sounding, 32 virtual), occlusion 9 rays / update, one hall: update() ${med(u).toFixed(3)} ms median (${Math.min(...u).toFixed(3)}-${Math.max(...u).toFixed(3)}); rendering 2 s of audio: HRTF ${med(h).toFixed(0)} ms (${span(h)}), equal-power ${med(q).toFixed(0)} ms (${span(q)}), 4 runs each, interleaved`,
    n: { updateMs: med(u), renderHrtfMs: med(h), renderEqualMs: med(q) } };
});
T('stat block: the numbers the overlay prints', async () => {
  const ctx = offline(0.3), e = engineOn(ctx, { voices: 2 });
  e.listener(EARS);
  for (let i = 0; i < 5; i++) { e.add('t' + i, sine(300 + i * 100, 0.5)); e.play('t' + i, { loop: true, at: [0, 0, -1 - i] }); }
  await render(ctx, e, { cam: () => EARS });
  const text = audioStatsText(e);
  return { ok: /voices 2 \/ 2 {2}virtual 3/.test(text) && /started 5/.test(text), note: text.split('\n').slice(1, 3).join(' | ') };
});

/** run every check (or those whose name contains `only`); env: { chimeUrl, themeUrl } */
export async function runTests(env, only) {
  const out = [];
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    const t0 = performance.now();
    let r;
    try { r = await t.fn(env); } catch (e) { r = { ok: false, note: 'threw: ' + (e?.stack || e) }; }
    out.push({ name: t.name, ms: Math.round(performance.now() - t0), ...r });
  }
  return out;
}
