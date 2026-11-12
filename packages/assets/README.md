# @miragekit/assets

The content of Mirage: things made in code that plug into the engine's systems. The engine itself
(`@miragekit/core`, `world`, `play`, `game`, `net`, `editor`, `tools`) is MIT; this package is not.

## Licence, in plain words

`@miragekit/assets` is under the **Business Source License 1.1** (BUSL-1.1), the full text in [LICENSE](LICENSE).
The example `examples/neon-district` is under the same licence.

- You may read, copy, change and redistribute it, and use it for anything that is not production use.
- You may also use it **in production** if you are an individual using it for yourself, or your use is
  non-commercial, or you are an organisation of no more than three people in total (with its affiliates, counting
  employees, part-time staff and contractors).
- In no case may it be used to offer a product or service that competes with it: a game engine, an asset library, or
  a tool whose main purpose is to hand its content to others.
- Each version becomes Apache License 2.0 four years after it is first publicly released (this version, 1.0.0:
  2030-11-12).
- Anything else needs a commercial licence: open an issue titled "Commercial license" at
  https://github.com/paraldaMeta/mirage-engine or write to flytoheptameron@outlook.com.

Versions of this content that were published earlier on the public `main` branch under MIT (the first neon district,
its early props, cars, robots and gun sounds) stay MIT for those versions; this licence governs what is published from
here on.

## What is in it

| sub-path | what |
|---|---|
| `@miragekit/assets/surfaces` | the surface recipes: 35 kinds (concrete, asphalt, paving, brick, render, tile, corrugated, painted / powder-coated steel, stainless, galvanised, cast iron, aluminium, chrome, raw metals, car paint, glass, plastics, rubber, fabric, paper, wood, bamboo, leather, carbon fibre, ceramic, roofing; neon, fluorescent, LED panel, LCD, light box, paper lantern, water, oil), their measured reference ranges, the F0 of common metals and the weathering decals. `SURFACES`, `SURFACE_KINDS`, `METALS`, `createSurfaces` (core's framework with these recipes registered), `registerSurfaces(framework)` |
| `@miragekit/assets/kits/cyber` | the cyber kit: a dense neon city's street props (products and shop goods, light fixtures, street furniture), parked cars with rain, civilian robots, the robot parts kit and rig (bodies, gaits, leg IK, skinning), the per-world surface library wrapper, corrugated sheet, worn paint, shop interiors, text atlases |
| `@miragekit/assets/sounds` | 125 sounds made in code (weapons, interface, footsteps, ambience loops, machines, vehicles, nature): `SOUNDS`, `SOUND_CATEGORIES`, `SOUND_SPACES`, `GUNS`, `soundNames`, `renderSound`, `soundBuffers`, `addSounds`, the gun renderers |
| `@miragekit/assets/destruct` | the destructibles' material classes (stages, debris, particle effects, synthesised break sounds): `DESTRUCT_MATERIALS`, `DESTRUCT_EFFECTS`, `DESTRUCT_SOUNDS`, `addDestructSounds`, `registerDestruct()` |
| `@miragekit/assets/presets` | reserved (empty) |

The systems these plug into stay in the MIT packages: core's surface framework (`createSurfaces`, baking, mappings,
LOD, the runtime layer, `registerSurfaceKinds`), the world protocol, game's synthesis kit (`@miragekit/game/sounds`:
layers, rooms, the limiter, `addSoundDefs`) and the destructibles system (`createDestructibles`,
`registerDestructData`).

```js
import { createWorldRenderer } from '@miragekit/core';
import { SURFACES, createSurfaces } from '@miragekit/assets/surfaces';
import { addSounds, soundNames } from '@miragekit/assets/sounds';

const lib = createSurfaces(world);
const wall = lib.material(SURFACES.brick({ age: 0.6 }), { mapping: 'wall', wet: true });
addSounds(audio, soundNames('ui'));
```

Guides: [docs/surfaces.md](../../docs/surfaces.md), [docs/sounds.md](../../docs/sounds.md),
[docs/destructibles.md](../../docs/destructibles.md), the cyber kit in [docs/api.md](../../docs/api.md).
