// Mirage original code. The sound library: 125 sounds made in code (no audio files), rendered into sample
// buffers at any sample rate, in the page, a worker or Node, with @miragekit/game's synthesis kit. Categories:
//   weapon    guns in three spaces (pistol, carbine, shotgun; gatling loop, rocket, explosion), their mechanics
//             (magazines, bolts, slides, pumps, dry fire), casings, impacts on concrete / metal / glass / armour,
//             rounds passing, energy bolts, landing, a heartbeat
//   ui        clicks, hovers, confirm / deny, notifications, menus, keys, a coin, a level-up, an error, a reward
//   step      footsteps on concrete, sheet metal, a grate, wet pavement, a puddle, sand, snow, carpet, tiles, a ladder
//   ambience  loops: rain on a street and on a roof, a city, wind, a room, a neon hum, a vent, servers, a crowd, the sea,
//             crickets, fire
//   machine   servos, robot beeps and chatter, doors, a lift, a terminal, a keypad, locks, a vending machine, power down /
//             up, an EMP, a shield, a laser, a teleport, a scanner, a hack; loops: an alarm, a drone
//   vehicle   a car and a hover car passing (Doppler), an electric whine and an idling engine (loops), a horn, a car
//             alarm and a far siren (loops), a train, a skid
//   nature    thunder near and far, drips, splashes, a gust, a bird, a branch, debris, glass and wood breaking, a fall
//
//   import { addSounds, soundNames, renderSound } from '@miragekit/assets/sounds';
//   const audio = createAudio();                       // @miragekit/game/audio
//   addSounds(audio, soundNames('ui').concat(['step_metal', 'amb_rain']));   // made at unlock, with the device's rate
//   audio.play('ui_click'); audio.loop('amb_rain', { bus: 'ambience', gain: 0.4 });
//   const pcm = renderSound('explosion_open', 48000, 1);   // a Float32Array: variant 1, for your own mixer or a file
//
// Every sound has `n` variants (play picks one at random), is deterministic (seeded by its name and variant), and is
// mastered under 0.93 of full scale (one-shots to the same peak: set the level with the play gain). Loops (loop: true)
// are folded so their end runs into their start. Rendering everything takes about 4 s on a laptop core: add only the
// names a world uses. The synthesis pieces (layers, rooms, the limiter) are @miragekit/game/sounds, for sounds of your own.
import { renderSoundDef, soundBuffers as defBuffers, addSoundDefs } from '@miragekit/game/sounds';
import { WEAPON_SOUNDS, ENVS, GUNS } from './weapons.js';
import { UI_SOUNDS } from './ui.js';
import { STEP_SOUNDS } from './steps.js';
import { AMBIENCE_SOUNDS } from './ambience.js';
import { MACHINE_SOUNDS } from './machines.js';
import { VEHICLE_SOUNDS } from './vehicles.js';
import { NATURE_SOUNDS } from './nature.js';

export { ENVS as SOUND_SPACES, GUNS };
export { renderShot, renderGatlingLoop, renderGatlingTail, renderRocketLaunch, renderExplosion } from './weapons.js';

/** every sound: name -> { cat, n (variants), loop?, desc, render(sampleRate, variant) -> Float32Array } */
export const SOUNDS = Object.freeze({ ...WEAPON_SOUNDS, ...UI_SOUNDS, ...STEP_SOUNDS, ...AMBIENCE_SOUNDS, ...MACHINE_SOUNDS, ...VEHICLE_SOUNDS, ...NATURE_SOUNDS });
export const SOUND_CATEGORIES = Object.freeze(['weapon', 'ui', 'step', 'ambience', 'machine', 'vehicle', 'nature']);

/** the names in a category (or every name) */
export function soundNames(cat) {
  if (cat != null && !SOUND_CATEGORIES.includes(cat)) throw new RangeError(`soundNames: no category "${cat}" (${SOUND_CATEGORIES.join(', ')})`);
  return Object.keys(SOUNDS).filter((k) => cat == null || SOUNDS[k].cat === cat);
}
/** one variant of a sound as a Float32Array at `sampleRate` */
export function renderSound(name, sampleRate = 48000, variant = 0) {
  const s = SOUNDS[name];
  if (!s) throw new RangeError(`renderSound: no sound "${name}"`);
  if (!(sampleRate >= 8000 && sampleRate <= 192000)) throw new RangeError('renderSound: sampleRate must be 8000..192000');
  return renderSoundDef(s, sampleRate, variant);
}
/** every variant of a sound as AudioBuffers of a context (one channel each) */
export function soundBuffers(ctx, name) {
  const s = SOUNDS[name];
  if (!s) throw new RangeError(`soundBuffers: no sound "${name}"`);
  return defBuffers(ctx, s);
}
/** give sounds to a mixer that takes audio.add(name, (ctx) => buffers) (@miragekit/game/audio's createAudio): each is made
 *  when the mixer has its context (at unlock), all variants. `prefix` names them apart from the mixer's own. */
export function addSounds(audio, names = Object.keys(SOUNDS), { prefix = '' } = {}) {
  const defs = {};
  for (const n of names) {
    if (!SOUNDS[n]) throw new RangeError(`addSounds: no sound "${n}"`);
    defs[n] = SOUNDS[n];
  }
  return addSoundDefs(audio, defs, { prefix });
}
