# @miragekit/game

A minimal game layer over a world built with `@miragekit/world` and played with `@miragekit/play`: Rapier physics
(the WASM loads lazily, so pages without a game stay small), a kinematic character controller, hinged doors,
dynamic props, an action map over keyboard / mouse / gamepad / touch, a Web Audio mixer with procedural sounds,
entities and systems, interactables, an inventory, flags, events, save / load and pause, and an accessible
HTML overlay. Example: `examples/garden-quest`.

```js
import { buildWorld } from '@miragekit/world';
import { startGame } from '@miragekit/game';

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
// g = { game, physics, input, audio, ui, play, character, root, save(slot), load(slot | json), stats, dispose() }
// await g.dispose(): the whole session goes (docs/LIFECYCLE.md); world.dispose() stays the host's
```

`startGame` does, in order: Rapier colliders from the modules' geometry, a `game` group for entities
(`collide = false`: the baked walk grid leaves moving things out), your `setup`, `world.prepare()`, the character,
the overlay, then `createPlay` with the character and action map.
`animate`, `fov` and `maxFps` go to `createPlay` as they are: `animate: true` keeps the scene clock (wind, water,
`ctx.onUpdate`, particles) on real time while the player stands still, `fov` sets the walk view's field of view
(default 62), `maxFps` caps the frame rate (default 60).

The game advances the character, Rapier and trigger zones together at 60 Hz. The camera interpolates between the
previous and current feet positions. `character.pos`, `play.state().pos` in walk mode and saved coordinates
remain physical positions. UI, interaction and audio update once per display frame. A short jump press survives
a frame with no physics tick. Pausing, returning to a tab, placing the player and loading a save reset interpolation.
Hosts using `createPhysics` directly can still drive `character.update(dt, input)` and `physics.step(dt)` explicitly.

## Parts

| file | | |
|---|---|---|
| `physics.js` | `createPhysics(scene)` | `addStatic(root)` one trimesh per solid mesh (the walk grid's rule: visible layer-0 meshes that write depth, minus `collide = false`, plus collider proxies); `body(obj, { shape, mass })`; `hinge(obj, { half, offset, swing, speed })` with `open / close / toggle / set(open)`; `character({ pos })`; `step(dt)` → moved?; `ray(from, dir, max, exclude)` → `{ point, distance, surface, object, normal }` (`normal`: the surface's unit normal at the hit, `[x, y, z]`) |
| | character | a flat-bottomed cylinder (r 0.28, 1.8 m) on Rapier's kinematic character controller: autostep 0.4 m, snap to ground 0.3 m, climbs ≤ 46°, slides ≥ 40°, pushes dynamic bodies (70 kg), jump 4.2 m/s; same interface as the walk-grid walker; `onStride(surface, run)` every 0.75 m (1 m running) |
| `game.js` | `createGame({ id, version, migrate })` | `add / remove / spawn(anchors, make) / system(fn) / tick(dt)`, `on / emit`, `set(flag)`, `inventory.add / has / remove`, `nearest(eye, dir)`, `interact(e)`, `zone({ id, box \| sphere, enter, exit, once })` (fires as `game.player`, the character's feet, crosses it; emits `'zone'`; saves keep who is inside, so loading does not fire again), `pause()`, `save(slot) / load(slot) / slots() / exportJSON() / importJSON()`, settings. No three.js, no DOM (tested in node) |
| `input.js` | `createInput()` | actions `forward back left right run jump interact inventory menu`; `poll()`, `down(a)`, `pressed(a)`, `move()`, `look(dt)`, `source`, `glyph(a)`, `rebind(a, code)`, `capture()`; gamepad = standard mapping; touch via `stick / hold / tap / addLook` |
| `audio.js` | `createAudio()` | buses `master → music, sfx, ambience`; `unlock()` (a user gesture), `play(name, { at })`, `loop(name, { at })`, `add(name, sound)` (an `AudioBuffer`, a list of variants, or a factory `(ctx) => buffer or list`: your own sounds; a factory added before the first gesture runs at `unlock()`), `footstep(surface)`, `listen(camera)`, `volume(bus, v)` |
| `ui.js` | `createUI(...)` | HUD, prompt, toasts, start screen, pause menu (save slots, load, export / import, controls with rebinding, volumes, restart), inventory panel, message dialog (`await ui.message(title, body, button)`: the promise resolves when it closes), touch controls |
| `destruct.js` | `createDestructibles(g, opts)` | props that break when shot ([docs/destructibles.md](../../docs/destructibles.md)): `add({ draw, material, health, lamps, broken, behave, mover })` over a mesh, an instance, a batched id or a merged range; `hit({ ray, kind, damage })` with penetration, `blast({ point, radius, damage, occlusion })`, `actor()`, `on('break' \| 'casualty' \| 'panic' \| 'noise' \| 'blast')`, `tally`, `snapshot / restore / reset`; steps with the game and saves as its entity |
| `ui.js` | `createUI(...)` | HUD, prompt, toasts, start screen, pause menu (save slots, load, export / import, controls with rebinding, volumes, restart), inventory panel, message dialog (`await ui.message(title, body, button)`: the promise resolves when it closes), touch controls. Its text is a table, English by default (`UI_STRINGS`, the keys): `startGame(world, { ui: { strings } })` or `createUI({ ..., strings })` replace some or all of it, `ui.setStrings(table)` switches at run time (labels and an open menu follow; `docs/ui.md`) |

Surfaces for footsteps: `userData.surface` on a mesh or its material (`stone`, `gravel`, `grass`, `wood`).
Sounds (all generated in code at `unlock`, ~0.3 s): `step_stone|gravel|grass|wood` (4 variants each), `pickup`,
`locked`, `door`, `ignite`, `done`, loops `wind` (with birds), `water`, `pad`.

## Saves

Versioned JSON in `localStorage` (`mirage:<id>:<slot>`), also exported to / imported from a file:
`{ v, id, at, time, flags, inventory, removed, entities: { id: e.save() }, zones, player: { pos, yaw, pitch }, summary }`.
An older `v` runs through `migrate[v]` step by step; a newer one, another game's save or a malformed one is refused
without changing anything. Settings (key bindings, volumes) belong to the player, not to a save: they are kept on
their own (`mirage:<id>:settings`) and loading a save leaves them alone (saves before 1.0 carried a copy, now
ignored). Loading an earlier save brings back entities removed since (a picked-up key returns to its bench); so
does `reset()`. Without `localStorage` (node, a sandboxed iframe) saves are kept in memory.

## Controls (defaults)

| | keyboard / mouse | gamepad | touch |
|---|---|---|---|
| move, look | WASD / arrows, mouse (click captures the pointer) | left stick, right stick | stick bottom-left, drag elsewhere |
| run, jump | Shift, Space | LB or L3, A | stick pushed out past its rim, Jump |
| interact, bag, menu | E or Enter, I, Esc or P | X, Y, Start (menus: d-pad, A, B) | Use, Bag, ☰ |

Licence and size: Rapier is Apache-2.0; `@dimforge/rapier3d-compat` 0.19.3 inlines its 1.57 MB WASM as base64
(2.24 MB JS, 0.84 MB gzip), loaded by a dynamic `import()` only when `createPhysics` runs. Add
`rapierWasm()` from `@miragekit/tools/src/vite-rapier.mjs` to the page's Vite plugins to ship the wasm as its own file
(0.59 MB gzip in all, compiled while it downloads); the game examples do. `npm test -w @miragekit/game`
runs `check.mjs` (the character on a hand-made scene, doors, a crate, game state, saves) in node.

## Type declarations (candidate)

The root and current JS subpaths ship adjacent declarations; compilation is pending on the test machine.
See [consumer checks](../../docs/TYPES.md) and [lifecycle / ownership](../../docs/LIFECYCLE.md).
Use `await session.dispose()` before mounting another game on the same world. Register setup-owned resources with `ctx.onDispose(fn)`.
NodeNext resolves the bundled, unchanged Rapier 0.19.3 declarations through the game package. Bundler uses the installed Rapier declarations. Both compiler results are pending.
