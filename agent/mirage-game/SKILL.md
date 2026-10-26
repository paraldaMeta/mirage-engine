---
name: mirage-game
description: Make a Mirage world playable as a small game with @mirage/game - interactables (pick up, use, open, light), inventory, flags, events, hinged doors and pushable props (Rapier physics, lazy WASM), a character controller, keyboard / mouse / gamepad / touch input, procedural 3D sound, save / load and an accessible HTML overlay (objective, prompt, toasts, menu). Use when the user wants something to do in a world - "add a lever / key / door / quest", "make it a game", "pick up", "inventory", "save game", "sound", "HUD" - or a scenario needs near / prompt / flags.
---

# Game layer

Reference implementation: `$MIRAGE/examples/garden-quest` (`main.js`, `quest.js`); API: `packages/game/README.md`.
Modules stay pure world (geometry + anchors). The game is one lead-owned file, `game.js`, that spawns entities
**from anchors**, so module owners never touch game code and the game never hard-codes a position.

## 1. Switch main.js to startGame

```js
import { startGame } from '@mirage/game';                 // add "@mirage/game": "0.2.0" to package.json
import { setupGame, objective } from './game.js';
// ... createWorldRenderer, buildWorld, camera as before; remove world.prepare() and createPlay (startGame does both)
const g = await startGame(world, {
  built, canvas, id: plan.name, version: 1, title: 'Title', subtitle: 'one line: what to do',
  spp: +Q.get('spp') || 6, shadowRadius, setup: setupGame, objective,
});
if (Q.has('start')) g.ui.begin();                          // skip the start screen (tests: "query": "start=1")
window.__mirage = { world, built, play: g.play, g };
window.__READY = true;
```

`startGame` builds Rapier colliders from the modules' solid meshes (same rule as the walk grid, proxies
included), adds a `game` group (`collide = false`), runs `setup`, compiles, places the character at
`plan.spawn`, and starts play with the action map and the game tick.

## 2. game.js: entities from anchors

```js
import * as THREE from 'three';
export function setupGame({ game, physics, audio, root, plan, anchors, world }) {
  const [a] = anchors.levers || [];                       // offered by a module; tolerate it missing
  if (!a) return;
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), world.mat.std({ color: 0x222222, metalness: 0.8, roughness: 0.4 }));
  lever.position.set(...a.pos); root.add(lever);
  const light = new THREE.PointLight(0xff9a50, 0, 12, 2); light.position.set(a.pos[0], a.pos[1] + 2, a.pos[2]); root.add(light);
  const setLit = (on) => { light.intensity = on ? 3 : 0; game.dirty = true; };   // dirty: re-render the still frame
  game.add({
    id: 'lever', object: lever,
    interact: { label: (g) => (g.flags.lit ? 'Turn the light off' : 'Light the lamp'), reach: 2.4,
      use: (g) => { g.set('lit', !g.flags.lit); audio.play('ignite', { at: a.pos }); game.ui.toast(g.flags.lit ? 'Lit' : 'Dark'); } },
    save: () => ({ lit: !!game.flags.lit }), load: (s) => setLit(s.lit),
    update: (dt) => { /* animate; set game.dirty = true while something moves, or the frame counts as still */ },
  });
  game.on('flag', ({ key, value }) => { if (key === 'lit') setLit(value); });
  audio.loop('wind', { bus: 'ambience', gain: 0.8 });
}
export const objective = (game) => (game.flags.lit ? ['Done', 'The lamp is lit.'] : ['Light the lamp', 'Find the lever.']);
```

- **Interactables**: `interact: { label (string | fn), use(game, e), can?(game, e), reach? (2.4 m) }`. The
  nearest one inside the view cone gets the prompt; `E` / Enter / pad X / touch Use calls `use`. Put the entity
  where a hand would touch it (`pos` or `object`), at 0.8–1.6 m above the floor.
- **State**: `game.set(flag, v)`, `game.flags`, `game.inventory.add({ id, name, text }) / has(id) / remove(id)`,
  `game.remove(e)` (picked up), `game.on('flag' | 'inventory' | 'interact' | …)`, `game.system(fn)`.
- **Physics**: `physics.body(mesh, { mass, shape: 'box' | 'ball' })` pushable props;
  `physics.hinge(pivot, { half, offset, swing, speed })` doors with `open() / close() / set(open)` (a module
  offers a `doors` anchor with `pos, width, height, swing`; leave its own door leaves out).
- **Saves**: every entity with `save()` / `load(s)` is saved with the player, flags and inventory (menu: Esc / P).
  Bump `version` and add `migrate[v]` when the save shape changes.
- **Sound** (generated in code, no files): `audio.play('pickup' | 'locked' | 'door' | 'ignite' | 'done', { at })`,
  `audio.loop('wind' | 'water' | 'pad', { at, bus, gain })`; footsteps from `userData.surface` on a material
  (`stone | gravel | grass | wood`).
- **UI**: `game.ui.toast(text)`, `game.ui.message(title, body, button)`, the objective from `objective(game)`.
- **Size**: Rapier adds 2.24 MB to the single file (loaded lazily, only pages that start a game pay it).

## 3. Test it (mirage-playtest)

`"query": "start=1&grain=0"`; steps: `walkTo` the entity, `lookAt: "<entity id>"`, expect `near` and `prompt`,
`tap: "KeyE"`, expect `flags.<x>` / `inventory has <id>`. A full scripted playthrough with menus, gamepad and
touch: `examples/garden-quest/scripts/playthrough.mjs`.
