# @mirage/game

A minimal game layer over a world built with `@mirage/world` and played with `@mirage/play`: Rapier physics
(the WASM loads lazily, so pages without a game stay small), a kinematic character controller, hinged doors,
dynamic props, an action map over keyboard / mouse / gamepad / touch, a Web Audio mixer with procedural sounds,
entities and systems, interactables, an inventory, flags, events, save / load and pause, and an accessible
HTML overlay. Example: `examples/garden-quest`.

```js
import { buildWorld } from '@mirage/world';
import { startGame } from '@mirage/game';

const built = await buildWorld(world, { plan, modules, shared });
const g = await startGame(world, {
  built, canvas, id: 'my-game', version: 1, title: 'My game',
  setup({ game, physics, audio, root, anchors }) {            // before the shaders compile
    for (const [i, a] of (anchors.lamps || []).entries()) {   // entities from a module's anchors
      const mesh = makeLantern(); mesh.position.set(...a.pos); root.add(mesh);
      game.add({ id: 'lamp' + i, object: mesh, interact: { label: 'Light', use: (game) => game.set('lit' + i) },
        save: () => ({ lit: !!game.flags['lit' + i] }), load: (s) => setLit(mesh, s.lit) });
    }
  },
  objective: (game) => ['Light the lamps', `${Object.keys(game.flags).length} lit`],
});
// g = { game, physics, input, audio, ui, play, character, root, save(slot), load(slot | json), stats }
```

`startGame` does, in order: Rapier colliders from the modules' geometry, a `game` group for entities
(`collide = false`: the baked walk grid leaves moving things out), your `setup`, `world.prepare()`, the character,
the overlay, then `createPlay` with the character as its walker, the action map as its input and the game tick as
its `onStep` (interaction prompt, `game.tick`, `physics.step`, the audio listener).

## Parts

| file | | |
|---|---|---|
| `physics.js` | `createPhysics(scene)` | `addStatic(root)` one trimesh per solid mesh (the walk grid's rule: visible layer-0 meshes that write depth, minus `collide = false`, plus collider proxies); `body(obj, { shape, mass })`; `hinge(obj, { half, offset, swing, speed })` with `open / close / toggle / set(open)`; `character({ pos })`; `step(dt)` → moved?; `ray(from, dir, max)` → `{ point, distance, surface, object }` |
| | character | a flat-bottomed cylinder (r 0.28, 1.8 m) on Rapier's kinematic character controller: autostep 0.4 m, snap to ground 0.3 m, climbs ≤ 46°, slides ≥ 40°, pushes dynamic bodies (70 kg), jump 4.2 m/s; same interface as the walk-grid walker; `onStride(surface, run)` every 0.75 m (1 m running) |
| `game.js` | `createGame({ id, version, migrate })` | `add / remove / spawn(anchors, make) / system(fn) / tick(dt)`, `on / emit`, `set(flag)`, `inventory.add / has / remove`, `nearest(eye, dir)`, `interact(e)`, `pause()`, `save(slot) / load(slot) / slots() / exportJSON() / importJSON()`, settings. No three.js, no DOM (tested in node) |
| `input.js` | `createInput()` | actions `forward back left right run jump interact inventory menu`; `poll()`, `down(a)`, `pressed(a)`, `move()`, `look(dt)`, `source`, `glyph(a)`, `rebind(a, code)`, `capture()`; gamepad = standard mapping; touch via `stick / hold / tap / addLook` |
| `audio.js` | `createAudio()` | buses `master → music, sfx, ambience`; `unlock()` (a user gesture), `play(name, { at })`, `loop(name, { at })`, `footstep(surface)`, `listen(camera)`, `volume(bus, v)` |
| `ui.js` | `createUI(...)` | HUD, prompt, toasts, start screen, pause menu (save slots, load, export / import, controls with rebinding, volumes, restart), inventory panel, message dialog, touch controls |

Surfaces for footsteps: `userData.surface` on a mesh or its material (`stone`, `gravel`, `grass`, `wood`).
Sounds (all generated in code at `unlock`, ~0.3 s): `step_stone|gravel|grass|wood` (4 variants each), `pickup`,
`locked`, `door`, `ignite`, `done`, loops `wind` (with birds), `water`, `pad`.

## Saves

Versioned JSON in `localStorage` (`mirage:<id>:<slot>`), also exported to / imported from a file:
`{ v, id, at, time, flags, inventory, removed, entities: { id: e.save() }, settings: { bindings, volumes }, player: { pos, yaw, pitch }, summary }`.
An older `v` runs through `migrate[v]` step by step; a newer one is refused. Settings (key bindings, volumes) are
also kept on their own (`mirage:<id>:settings`). Loading an earlier save brings back entities removed since
(a picked-up key returns to its bench).

## Controls (defaults)

| | keyboard / mouse | gamepad | touch |
|---|---|---|---|
| move, look | WASD / arrows, mouse (click captures the pointer) | left stick, right stick | stick bottom-left, drag elsewhere |
| run, jump | Shift, Space | LB or L3, A | stick pushed out past its rim, Jump |
| interact, bag, menu | E or Enter, I, Esc or P | X, Y, Start (menus: d-pad, A, B) | Use, Bag, ☰ |

Licence and size: Rapier is Apache-2.0; `@dimforge/rapier3d-compat` 0.19.3 inlines its 1.57 MB WASM as base64
(2.24 MB JS, 0.84 MB gzip), loaded by a dynamic `import()` only when `createPhysics` runs. `npm test -w @mirage/game`
runs `check.mjs` (the character on a hand-made scene, doors, a crate, game state, saves) in node.
