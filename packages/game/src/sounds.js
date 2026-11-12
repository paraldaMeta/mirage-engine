// Mirage original code. Sounds made in code: the synthesis kit and a table-free API for any sound definition. A
// definition is { n (variants), loop?, render(sampleRate, variant) -> Float32Array }: rendered into sample buffers at
// any sample rate, in the page, a worker or Node. The kit builds them from layers (noise bursts, pitch-dropping
// thumps, resonant modes, tones), rooms (early reflections and a diffuse tail), a look-ahead limiter, and the
// one-shot / loop wrappers `one` and `fold` (seeded by a key and the variant: deterministic).
//
//   import { one, noiseLayer, biquad, addSoundDefs } from '@miragekit/game/sounds';
//   const beep = { n: 2, render: one('beep', 0.2, (o, SR, R, v) => noiseLayer(o, SR, R, 0, 0.2, biquad('bp', 2000 + v * 300, 4, SR), 0.002, 0.05, 0.8)) };
//   addSoundDefs(audio, { beep });                      // @miragekit/game/audio's createAudio: made at unlock
//
// A library of 125 ready sounds (weapons, interface, footsteps, ambience, machines, vehicles, nature) is
// @miragekit/assets/sounds (Business Source License 1.1), built on this kit.
export { TAU, makeRng, hash, biquad, chain, env, noiseLayer, thumpLayer, modesLayer, toneLayer, ROOMS, room, master, one, fold, click, scrape } from './sounds/synth.js';

const check = (def, who) => { if (!def || typeof def.render !== 'function' || !(def.n >= 1)) throw new TypeError(`${who}: a sound definition is { n, render(sampleRate, variant) }`); };
/** one variant of a definition as a Float32Array at `sampleRate` (the variant wraps) */
export function renderSoundDef(def, sampleRate = 48000, variant = 0) {
  check(def, 'renderSoundDef');
  if (!(sampleRate >= 8000 && sampleRate <= 192000)) throw new RangeError('renderSoundDef: sampleRate must be 8000..192000');
  return def.render(sampleRate, ((variant % def.n) + def.n) % def.n);
}
/** every variant of a definition as AudioBuffers of a context (one channel each) */
export function soundBuffers(ctx, def) {
  check(def, 'soundBuffers');
  return Array.from({ length: def.n }, (_, v) => { const d = def.render(ctx.sampleRate, v), b = ctx.createBuffer(1, d.length, ctx.sampleRate); b.copyToChannel(d, 0); return b; });
}
/** give definitions ({ name: def }) to a mixer that takes audio.add(name, (ctx) => buffers) (@miragekit/game/audio's
 *  createAudio): each is made when the mixer has its context (at unlock), all variants. `prefix` names them apart. */
export function addSoundDefs(audio, defs, { prefix = '' } = {}) {
  for (const [n, def] of Object.entries(defs)) {
    check(def, 'addSoundDefs');
    audio.add(prefix + n, (ctx) => { const list = soundBuffers(ctx, def); return list.length > 1 ? list : list[0]; });
  }
  return audio;
}
