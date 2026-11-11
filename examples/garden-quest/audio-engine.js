// ?audio=engine: the garden's sound through the audio engine (docs/audio.md). The game's own mixer keeps working
// (its buses become the engine's buses), and on top of it: the pavilion is a reverb zone that also turns the wind down
// indoors, a wind chime hangs in the pavilion (a cue of four code-made notes) and is muffled by the walls (Rapier
// rays), and the stat overlay shows voices and bus meters. Without the flag none of this is created.
import { createAudioEngine, createAudioDebug, physicsOccluder } from '@miragekit/game';

function bell(ctx, freq) {
  const sr = ctx.sampleRate, b = ctx.createBuffer(1, Math.round(sr * 1.6), sr), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = 0.3 * (Math.sin(6.283 * freq * t) * Math.exp(-t * 3) + 0.4 * Math.sin(6.283 * freq * 2.76 * t) * Math.exp(-t * 6)) * Math.min(1, i / 60); }
  return b;
}

export function mountAudioEngine(g, world, plan) {
  const [cx, cy, cz] = plan.pavilion.center, h = plan.pavilion.size / 2, chimeAt = [cx, cy + 2.6, cz];
  const engine = createAudioEngine({
    audio: g.audio, voices: 24,
    snapshots: { indoors: { ambience: { gain: 0.35 } } },
    zones: [{ name: 'pavilion', box: [cx - h, cy - 1, cz - h, cx + h, cy + 6, cz + h], fade: 2.5, reverb: 'hall', wet: 0.7, snapshot: 'indoors' }],
    zoneOptions: { ambient: { reverb: 'outdoor', wet: 0.15 } },
    occlusion: { test: physicsOccluder(g.physics, { near: 0.5 }), rays: 3, radius: 0.5, budget: 6 },
  });
  engine.whenReady(() => {
    [523.25, 587.33, 698.46, 783.99].forEach((f, i) => engine.add('chime' + i, bell(engine.ctx, f)));
    engine.cue('chime', { sounds: ['chime0', 'chime1', 'chime2', 'chime3'], mode: 'shuffle', gain: [0.35, 0.6], pitch: [-0.2, 0.2] });
  });
  const debug = createAudioDebug(engine);
  let last = performance.now(), next = 1, raf = 0;
  /** ears: { pos, forward, up } to listen from somewhere other than the camera (a cutscene; the check uses it) */
  const api = { engine, debug, chimeAt, ears: null, dispose() { cancelAnimationFrame(raf); engine.dispose(); } };
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    engine.update(dt, api.ears || world.camera);
    if (engine.ready && engine.time > next) { next = engine.time + 0.7 + engine.rng() * 2.2; engine.play('chime', { at: chimeAt, ref: 2.5 }); }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return api;
}
