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

## The cyber kit (`@miragekit/assets/kits/cyber`)

```js
import { propKit, paperLantern, streetLamp, bin, crate, parkedCars, buildMachines } from '@miragekit/assets/kits/cyber';

export default {
  name: 'alley',
  build(ctx) {
    const { geom } = ctx, P = propKit(ctx), b = new geom.MeshBatch();
    paperLantern(P, b, geom, [0, 3.2, 0], { print: 1 });                 // hangs from a point
    streetLamp(P, b, geom, [4, 0, 0], 5.5, Math.PI);                      // foot, height, the arm's direction
    bin(P, b, geom, geom.compose([1.5, 0, 0.8], [0, 0.3, 0]));            // the rest: a matrix at its foot, front +z
    crate(P, b, geom, geom.compose([2.4, 0, 0.6]), 0.7, undefined, 1);
    parkedCars(ctx, P, b, [[-4, 2, 0.1]], undefined, { lamp: (c, l) => myLamp(c, l) });   // your light for its glow
    ctx.root.add(b.finish({ name: 'alley-props' }));
  },
};
```

Street props for a dense, rain-wet neon city, made entirely in code: three.js geometry for every shape, and every
printed thing (drink labels, price tags, stickers, warnings, stencils, number plates, menus, lantern paper, tyre
walls) drawn into one canvas atlas at start-up. No model, texture or image files. All brands are invented; labels mix
English, Traditional Chinese and Japanese (system fonts).

- **The props kit** `propKit(ctx)`: the atlas and six materials (`paint`, `metal`, `glow` whose vertex colour is its
  intensity, `lantern`, `clear`, `product`). `P.put(batch, geometry, material, matrix, color, rect)` fits the
  geometry's uv into an atlas cell and tints it, so everything a module builds merges into one draw per material;
  `P.instanced(geometry, base, items)` draws many products in one instanced mesh, each with its own label.
- **Products** (`canGeo`, `bottleGeo`, `cupGeo`, `boxGeo`, `packGeo`, `capsuleGeo`, `spiralGeo`, `wineGeo`,
  `glassGeo`, `bowlGeo`, `jarGeo`), **goods** (`spiritBottle`, `tumbler`, `bowls`, `pot`, `noodleBasket`,
  `riceCooker`, `chopsticks`, `skewers`, `stool`, `goodsBox`, `jar`, `goodsRack`), **light fixtures**
  (`paperLantern`, `bulbString`, `streetLamp`, `bulkhead`, `tubeFixture`, `floodlight`, `beacon`, `signalHead`) and
  **street furniture** (`bin`, `crate`, `bag`, `cardboard`, `acUnit`, `junctionBox`, `bollard`, `jersey`, `newsBox`,
  `bench`), each modelled for a look from half a metre.
- **Cars** `parkedCars(ctx, P, batch, [[x, z, rotY]], proxyBox, { lamp })`: three designs (an angular brushed-steel
  pickup, a low pearlescent wedge, an autonomous cab) with lofted bodies, real wheel openings, interiors, rain beads
  and running water. The kit draws only the glowing strips: `lamp` is how your world lights them, `proxyBox` your
  collision volume per car.
- **Robots** `buildMachines(ctx, spec)`: civilian domestic humanoids (standing ones talk in pairs, walkers stroll a
  loop with a real gait, some carry an umbrella while it rains), rail and pedestal vendors, a robot-dog courier, a
  floor scrubber, a notice totem, a broken one slumped on a wall. Four batched draws for all of them, distance LOD;
  call `update(t)` each frame; `machineUnits(group)` lists each unit's instances.
- **The robot kit**: `humanoid(style, lod)` / `quadruped(style, lod)` bodies as parts per bone at three levels of
  detail, `part`, `mergeParts`, `cover`, `drum`, `decal`, `robotMaterials(world)`, gaits (`GAITS`, `bipedLegs`,
  `trotLegs`, `legIK`); the rig (`humanoidMeshes` skinned to @miragekit/play's bones, `robotClips`, `createHound`); borrowed motion capture for it (`motionClips`, `samplePose`: Quaternius, CC0).
- **Destructibles' recording**: `recorder(ctx)`, `track(batch, fn)`, `trackLamps(ctx, fn)`: the vertex ranges and
  lamps each prop adds, for @miragekit/game's destructibles.
- **Surfaces**: `surfaceLib(ctx)` (the surface library per world, bake sizes by quality), `corrugated` sheet as geometry, `canopy`, `worn(base)` hooks for chipped, rusting painted metal,
  `interiorMaterial` (a lit shop seen through its window by ray-casting a box: depth without geometry),
  `textAtlas` / `atlasQuad` for many neon or light-box labels in one texture, `rainBeads(hooks)` for drops on smooth
  surfaces.

examples/neon-district builds its whole district from this kit. Limits: the builders need a DOM canvas (the atlas);
the fonts are the system's, so labels look a little different on Windows; a prop's collision is not built (add your
own boxes or let the walk grid read the props you leave `collide`).


Guides: [docs/surfaces.md](../../docs/surfaces.md), [docs/sounds.md](../../docs/sounds.md),
[docs/destructibles.md](../../docs/destructibles.md), the cyber kit in [docs/api.md](../../docs/api.md).
