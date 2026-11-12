// Mirage original code. The destructibles' material classes: glass, paper, wood, cardboard, plastic, thin and heavy
// metal, ceramic, liquid, electronics, fabric and a bystander actor, each with its stages, debris, particle effects
// and synthesised break and hit sounds (data.js), for @miragekit/game's createDestructibles.
//
//   import { createDestructibles } from '@miragekit/game';
//   import '@miragekit/assets/destruct';                 // registers the classes (registerDestruct() does it again)
//   const d = createDestructibles(session, { vfx });     // add({ material: 'glass', ... })
//
// Importing this module registers the table with the system (registerDestructData); registries made before keep the
// table they were made with.
import { registerDestructData } from '@miragekit/game/destruct';
import { DESTRUCT_MATERIALS, DESTRUCT_EFFECTS, addDestructSounds } from './data.js';

export { DESTRUCT_MATERIALS, DESTRUCT_EFFECTS, DESTRUCT_SOUNDS, destructSoundFactories, addDestructSounds } from './data.js';

/** register the library's classes, effects and sounds with the destructibles system (default: @miragekit/game's) */
export function registerDestruct(register = registerDestructData) {
  return register({ materials: DESTRUCT_MATERIALS, effects: DESTRUCT_EFFECTS, fallback: 'plastic', addSounds: addDestructSounds });
}
registerDestruct();
