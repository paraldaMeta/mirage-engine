# Audio engine

`createAudioEngine` (in `@mirage/game`, experimental, opt-in) adds sound files, a mixer with effects, 3D placement,
reverb zones, occlusion, voice management, cues and adaptive music on top of Web Audio. `createAudio` (the three-bus
mixer with code-made sounds) is unchanged: a page that never calls `createAudioEngine` loads and runs none of this.

```js
import { startGame, createAudioEngine, createMusic, createAudioDebug, physicsOccluder } from '@mirage/game';

const g = await startGame(world, { ... });
const engine = createAudioEngine({
  audio: g.audio,                                   // share the game's context, buses, volumes and sounds
  voices: 32,
  buses: { dialogue: {}, music: { effects: [{ id: 'lp', type: 'lowpass', freq: 20000 }] } },
  snapshots: { underwater: { music: { gain: 0.5, lp: { freq: 600 } } } },
  ducks: [{ target: 'music', source: 'dialogue', amount: 0.25 }],
  zones: [{ name: 'hall', box: [x0, y0, z0, x1, y1, z1], fade: 2, reverb: 'hall', wet: 0.8 }],
  occlusion: { test: physicsOccluder(g.physics), budget: 8 },
});
await engine.preload('level1', { bark: barkUrl, hum: humUrl });
engine.play('bark', { at: [4, 1, 2] });
// each frame, after the camera has moved:
engine.update(dt, world.camera);
```

Given `audio`, the engine adopts that mixer's context and puts its own buses in front of the old ones, so
`audio.play`, `audio.loop`, `audio.footstep` and the volume settings keep working and now pass through the bus
effects, snapshots and meters. `engine.dispose()` puts the old mixer back as it was. Without `audio` the engine makes
its own context on `engine.unlock()` (call it from a click or key), or takes `context` (an `OfflineAudioContext`
in checks).

## Files

| | |
|---|---|
| `engine.load(url, { name, group })` | fetch and decode once; each call takes a reference; resolves to the `AudioBuffer` |
| `engine.release(name)` | give a reference back; at zero the buffer leaves the cache |
| `engine.preload(group, { name: url }, progress)` | load a set; `progress(done, total, name)`; `engine.unload(group)` releases it |
| `engine.add(name, buffer)` | a buffer made in code (`AudioBuffer`, `Float32Array`, `{ channels, sampleRate }`) |
| `engine.stream(url, { bus, loop, fadeIn })` | long music through a media element: not decoded into memory; `.pause() .seek(t) .fade(to, s) .stop(s)` |

In a bundler import sounds as URLs (`import bark from './bark.ogg?url'`). The single-file build
(`node packages/tools/src/package.mjs <dir> --out game.html`) inlines them as `data:` URLs, which the engine reads
without `fetch`, so the file plays from `file://`. WAV files that the browser will not decode fall back to the
engine's own reader (`decodeWav`); other formats are whatever the browser decodes. Decoding does not need a user
gesture; playing does.

## Mixer

`engine.mixer` (or `createMixer(ctx)` on its own) is a tree of buses under `master`.

```js
engine.bus('ui', { parent: 'master', gain: 0.8 });
engine.bus('reverb', { effects: [{ type: 'reverb', preset: 'hall', wet: 1, dry: 0 }] });
engine.bus('sfx', { sends: { reverb: 0.25 } });            // post-fader; { reverb: { gain: 0.25, pre: true } } before it
engine.bus('music').addEffect({ id: 'eq', type: 'eq', low: 3, high: -2 });
engine.bus('music').effect('eq').set({ low: -6 }, 0.5);    // over half a second
engine.mixer.snapshot('indoors', { ambience: { gain: 0.35 }, sfx: { sends: { reverb: 0.6 } } });
engine.mixer.transition('indoors', 1.5);                   // or a blend: transition({ indoors: 0.3, default: 0.7 }, 0.2)
engine.mixer.duck('music', 'dialogue', { amount: 0.25, attack: 0.05, release: 0.5 });
engine.meters();                                           // { bus: { peak, rms, peakDb, rmsDb } }
```

Effects: `eq` (low / mid / high in dB), `lowpass`, `highpass`, `bandpass`, `notch`, `peaking`, `lowshelf`,
`highshelf`, `compressor`, `limiter`, `delay`, `reverb`, `drive`, `pan`, `gain`. Each takes `wet`, `dry`, `mix` and
`bypass`. Reverb impulse responses are made in code from seeded noise (`REVERBS`: room, hall, cave, cathedral,
outdoor, plate; or your own `{ decay, damping, predelay, early, width, seed }`), normalised to unit energy. Ducking
runs inside the audio graph (rectifier, smoothing, gate, attack / release), so it follows the signal at audio rate.

## 3D

```js
const v = engine.play('hum', { at: mesh, loop: true,       // a point, an Object3D or a function
  model: 'inverse', ref: 2, max: 60, rolloff: 1,           // 'linear', 'exponential', or 'custom' with
  curve: [[0, 1], [10, 0.4], [40, 0]],                     //   a curve of [distance, gain] or a function
  dir: [0, 0, 1], inner: 60, outer: 180, outerGain: 0.2,   // cone
  spread: 0.3, blend: 1, doppler: 1, panning: 'HRTF' });
v.set({ gain: 0.5, at: [x, y, z] }, 0.2);  v.stop(0.5);
```

`panning` is `'HRTF'` or `'equalpower'` for the engine (`createAudioEngine({ panning })`, `engine.setPanning`) or
per voice. At most `hrtfVoices` (8) voices use HRTF at once; the others are equal-power. Distance, cone, occlusion
and Doppler are worked out in JavaScript once per update and smoothed over 30 ms.

## Reverb zones and occlusion

Zones are boxes or spheres: `{ name, box | sphere, fade, reverb, wet, priority, snapshot }`. A world plan may carry
them as `plan.audio.zones` (`engine.zones(zonesFromPlan(plan))`); each zone may also use `shape` with `min` / `max`
or `center` / `size` / `radius`. The weight of a zone is 1 inside and falls to 0 over `fade` metres outside; zones
share the listener by priority, and what is left goes to `zoneOptions.ambient`. A zone's `snapshot` is blended into
the mixer by the same weight.

Occlusion asks a test function how shut the path from a sound to the ears is: `gridOccluder(play.grid)` (the walk
grid, no physics), `physicsOccluder(g.physics)` (a Rapier ray) or `sceneOccluder(root, { raycaster })` (a three.js
raycast; give it a few large meshes). `budget` is the number of rays per update over all voices; each voice is
traced every `interval` seconds with `rays` rays (the direct one and offsets `radius` metres beside the source), so
a sound beside a doorway is partly heard. The answer drives a gain and a low-pass (`gain` 0.3, `freq` 700 Hz when
shut) over `smooth` seconds.

## Voices

`voices` is the cap on sounding voices. Each update ranks voices by priority, then audibility; the rest become
virtual: no audio nodes, but their time keeps running, and they come back where they would have been. A new sound
steals a voice only from a lower priority or a clearly quieter one. `virtual: 'stop'` ends a voice instead of
keeping it; `'restart'` brings it back from the start.

## Cues

```js
engine.cue('step', { sounds: ['step1', 'step2', 'step3'], mode: 'shuffle',   // 'random', 'sequence'
  gain: [0.7, 1], pitch: [-1, 1], cooldown: 0.1, instances: 4, then: 'scuff' });
engine.play('step', { at: feet });
```

Variants never repeat twice running; `gain`, `rate`, `pitch` (semitones) and `delay` take a value or a range.
Picks come from the engine's seeded generator (`seed`), never `Math.random`.

## Adaptive music

```js
const music = createMusic(engine, { bpm: 96, sections: {
  calm:   { bars: 4, stems: { pad: 'pad_a', pulse: { sound: 'pulse_a', gain: 0.6 } } },
  battle: { bars: 2, stems: { pad: 'pad_b', drums: 'drums_b' } } } });
music.play('calm');
music.to('battle', { quantize: 'bar', fade: 0.4, stinger: 'hit' });   // 'beat', 'end', 'now'
music.layer('drums', 0, 1.5);
music.onBeat = (beat, bar) => {};
```

Stems are loops of `bars` bars, started together on the audio clock, so a change lands on the sample.

## Debug and tests

`createAudioDebug(engine)` shows voices, virtual voices, steals, rays, zone weights and a meter per bus;
`audioStatsText(engine)` is the same block as a string, and `engine.stats` the numbers.

Everything the engine decides depends on the calls made and the `dt` given to `update`, so a check can render with
an `OfflineAudioContext` and compare samples: `ctx.suspend(t).then(() => { engine.update(dt, ears); ctx.resume(); })`
per block. `examples/demos/audio/tests.js` does this for every feature (`rms`, `peak`, `toneLevel`, `onset` are the
measuring helpers).

- `node packages/game/audio-check.mjs`: the parts without Web Audio (distance, cones, Doppler, zones, WAV, occluders).
- `node examples/demos/audio/audio-check.mjs`: packages the demo into one HTML file, opens it from `file://` in
  headless Chrome, runs 26 rendered checks and the live page.
- `node examples/garden-quest/scripts/audio-engine.mjs`: garden-quest with `?audio=engine`.

## Demo

`examples/demos/audio`: a top-down room with a wall, a hall zone, moving sources and music. Package it with
`node packages/tools/src/package.mjs examples/demos/audio --out examples/demos/audio/out/audio.html` and open the
file (double-click works: the two sound files are inlined). Keys: WASD move, Q / E turn, 1 / 2 / 3 music sections, L lead layer, T talk
(ducks the music), M streamed theme, C chime, U underwater snapshot, P panning, O occlusion, G overlay. Flags:
`?panning=equalpower`, `?voices=8`, `?occlusion=0`, `?zones=0`, `?swarm=64`, `?debug=0`, `?seed=x`, `?music=calm`,
`?auto=1` (start without a click, where the browser allows), `?test=1` (run the checks in the page).

garden-quest takes `?audio=engine`: the pavilion is a hall zone that also turns the wind down, a wind chime hangs
in it and is muffled by the walls, and the overlay is shown. Without the flag the game is as before.

## Measured (headless Chrome, Apple silicon, 48 kHz)

| | |
|---|---|
| bus gains down the tree | exact (0.2500, 0.3000) |
| low-pass 1 kHz | -0.0 / -3.0 / -37.8 dB at 125 Hz / 1 kHz / 8 kHz |
| compressor | 40 dB of input range comes out 13.1 dB apart |
| delay 250 ms | 0 samples off |
| reverb | energy -0.00 dB; RT60 0.55 s (asked 0.6), 1.99 s (asked 2.1) |
| snapshot over 1 s | 0.6252 half-way (0.625), 0.2500 at the end |
| ducking to 0.25 | 0.250 under dialogue; half-way down in 50 ms, half-way back in 325 ms |
| distance models | equal to the formula to 4 decimals |
| HRTF, source at the side, 1 kHz | far ear 6.4-6.6 dB down |
| Doppler at 34.3 m/s | 1111.1 Hz and 909.1 Hz from 1000 Hz |
| occlusion (shut) | x0.299 at 200 Hz, -41.1 dB at 4 kHz; a wall that appears is half-way in 130 ms |
| voice cap 4 of 12 loops | 4 sounding, 8 virtual; output equals the nearest four alone to 1.2e-7 |
| virtual voice, 1.28 s silent | resumes 0.00 samples from where it would be |
| cues, same seed | sample-identical; another seed differs |
| music transitions | bar, beat and end boundaries, first changed sample 1 after the boundary |
| `update()` with 64 moving loops (32 sounding), 9 rays | 0.070 ms median (0.053-0.075) |
| rendering 2 s offline, 32 voices | HRTF 345 ms (336-351), equal-power 311 ms (305-312); 4 runs each, interleaved |
| size | garden-quest's `?audio=engine` chunk (engine, mixer, DSP, occluder, overlay; no music): 37.4 KB, 15.8 KB gzip, loaded only with the flag |

## Limits

- Distance, cone, occlusion and Doppler change once per update, not per sample.
- Occlusion is shut or clear per ray: no diffraction, no transmission by material, no reflections traced from the
  geometry (zones are placed by hand).
- Reverb is convolution with noise-made responses, not measured rooms; changing a reverb's preset swaps the response
  in one step.
- Streams are not spatial and never virtual. No ambisonics, no surround beyond what the browser's output gives.
- Music tempo is fixed within a section; stems are decoded loops, not streams; music follows the audio clock, not
  the game's pause.
- No authoring tool: buses, cues and music are plain objects in code.
- HRTF is the browser's `PannerNode`; its data set cannot be changed.
