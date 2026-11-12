# Building kit

Part of the asset library (`@miragekit/assets/building`, BSL: see that package's licence): 29 parts that put
buildings together, five material styles, and `house()`, which builds a whole house from them. Everything is made in
code: no models, no textures (the surfaces are core's procedural ones).

```js
import { buildingMaterials, house, wallOpenings, stairs, roofGable } from '@miragekit/assets/building';   // @miragekit/assets/building once published

export default {
  name: 'square',
  build(ctx) {
    const { geom } = ctx, b = new geom.MeshBatch(), M = buildingMaterials(ctx, 'brick');
    house(b, M, geom.compose([0, 0, -6]), { bays: [3, 2], storeys: 2, roof: 'hip', seed: 4 });
    wallOpenings(b, M, geom.compose([8, 0, 0]), { width: 6, openings: [{ x: -1.5, width: 1.1, height: 2.4, arch: 'round', kind: 'door' }] });
    stairs(b, M, geom.compose([12, 0, 0]), { rise: 3, width: 1.2 });
    ctx.root.add(b.finish({ name: 'square', castShadow: true }));
  },
};
```

Conventions: metres, +y up; a part stands on y = 0 at its matrix, front toward +z, width along x. The usual grid is
3 m bays, 3 m storeys and 0.25 m walls. A part takes `(batch, M, matrix, options)`: `batch` is core's `MeshBatch`
(everything merges into one draw per material), `M` a material set with the slots `wall`, `trim`, `stone`, `wood`,
`roof`, `metal`, `glass`, `floor` (`buildingMaterials(ctx, style)` makes one; your own object with those slots works).

| part | what it is |
|---|---|
| `wallPanel`, `wallOpenings`, `wallDoor`, `wallWindow` | walls with doors and windows (flat or round heads), frames, sills, a plinth, glass and leaves |
| `corner` | a corner pilaster with a base and a cap |
| `doorLeaf`, `windowFrame`, `shutters` | panel, plank or glazed doors; windows with mullions; louvred shutters folded back |
| `floorSlab`, `column`, `beam`, `archway` | floors, round or square columns, beams between two points, a free-standing arch |
| `stairs`, `spiralStairs`, `railing`, `ramp`, `stoop`, `ladder` | straight flights with stringers, spiral stairs, railings (bars, glass, cable, solid), ramps, entrance steps, ladders with a cage |
| `roofGable`, `roofHip`, `roofFlat`, `dormer`, `chimney`, `gutter` | tiled gable and hip roofs, a flat roof with a parapet, dormers, chimney stacks, gutters with downpipes |
| `balcony`, `awning`, `fence`, `gate`, `moulding` | balconies on brackets, awnings, picket / wire / panel fences, a two-leaf gate, a profile swept along a wall |

`house(batch, M, matrix, { bays: [across, deep], storeys, roof: 'gable' | 'hip' | 'flat', seed })` lays out 3 m bays:
a door in the front's middle bay, windows elsewhere (round or flat heads, shutters, balconies upstairs), floors,
mouldings between storeys, a plinth, corner pilasters, entrance steps, the roof, a chimney, gutters. The same seed
gives the same house. It returns `{ width, depth, height, doors }`. A two-storey 3 x 2 bay house is about 12,500
triangles.

Styles (`BUILDING_STYLES`): `stucco`, `stone`, `brick`, `timber`, `concrete`.

To see it: `npx vite examples/demos/building` (`?view=street | parts | house | stairs | aerial`). Check:
`node packages/assets/building.check.mjs` (every part builds finite geometry where its header says, the stairs rise
what was asked, a window takes its area out of the wall, houses are deterministic).

Limits: doors in the kit are merged with the rest (build one you want to swing into a batch of its own); roofs are
for rectangular footprints (an L-shaped house is two houses); interiors are bare floors and walls; arches in
`wallOpenings` are round or flat (`archway` also takes pointed and segmental).
