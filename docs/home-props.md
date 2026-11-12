# Home and office props

Part of the asset library (`@miragekit/assets/props-home`, BSL: see that package's licence): 48 props made in code to
real sizes, their materials, and `room()`, which furnishes a whole room with the building kit's walls. No models, no
image files (a monitor's desktop is drawn into a canvas).

```js
import { homeMaterials, sofa, desk, officeChair, room } from '@miragekit/assets/props-home';
import { buildingMaterials } from '@miragekit/assets/building';

export default {
  name: 'flat',
  build(ctx) {
    const { geom } = ctx, b = new geom.MeshBatch(), M = homeMaterials(ctx);
    sofa(b, M, geom.compose([0, 0, -2]), { seats: 3, color: [0.25, 0.32, 0.4] });
    desk(b, M, geom.compose([3, 0, 0]), { seed: 4 });
    officeChair(b, M, geom.compose([3, 0, 0.65], [0, Math.PI, 0]));
    room(b, M, buildingMaterials(ctx, 'stucco'), geom.compose([10, 0, 0]), { kind: 'bedroom', size: [4, 4] });
    ctx.root.add(b.finish({ name: 'flat', castShadow: true }));
  },
};
```

A prop takes `(batch, M, matrix, options)` like the building kit: its foot on y = 0 at the matrix, its front toward +z,
centred on x. Wall things (a clock, a picture, a whiteboard, a towel rail) have their back at z = 0; a curtain hangs
from its rail at y = 0. Colours are linear RGB `[r, g, b]`, written as vertex colours, so one material serves every
colour of a fabric or a wood and a whole room merges into one draw per material.

| room | props |
|---|---|
| living | `sofa` (1-n seats, fabric or leather), `armchair`, `cushion`, `coffeeTable` (wood or glass), `sideTable`, `tvStand`, `television`, `bookshelf` (books from a seed), `rug`, `floorLamp`, `tableLamp`, `plant` (leafy, tall, grass), `wallClock` (set to a time), `picture` (an abstract from a seed), `curtain` (open 0..1) |
| kitchen, dining | `diningTable` (square or round), `chair`, `barStool`, `kitchenCounter` (cabinets, a sink and tap, a hob and oven, wall cabinets), `fridge`, `microwave`, `kettle`, `mug`, `placeSetting` |
| bedroom | `bed` (0.9 to 1.8 m, made or not), `nightstand`, `wardrobe`, `dresser` (with a mirror) |
| bathroom | `toilet`, `washbasin` (a vanity unit, a mixer tap, a mirror), `bathtub`, `towelRail` |
| office | `desk` (and what is on it, from a seed), `monitor`, `laptop`, `keyboard`, `computerMouse`, `deskLamp`, `papers`, `officeChair`, `filingCabinet`, `whiteboard`, `printer`, `waterCooler`, `wasteBin`, `partition`, `meetingTable` (with its chairs), `deskPhone` |

`homeMaterials(ctx)` has eleven slots: `wood`, `fabric` (a fine weave), `leather`, `metal`, `chrome`, `plastic`,
`ceramic`, `glass`, `paper`, `leaf` (two-sided), `screen` (unlit). Lights are the host's: a lamp is a fitting.

`room(batch, M, MB, matrix, { kind: 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'office', size: [w, d], seed,
closed, window })`: a floor, three walls (the front left open as a cut-away; `closed` adds it with a door), a window,
and the room furnished to its size. The same seed furnishes it the same way. A 5 x 4 m room is 4,800 (bathroom) to
12,700 (office) triangles.

To see it: `npx vite examples/demos/home` (`?view=living | kitchen | bedroom | bathroom | office | lineup`). Check:
`node packages/assets/props-home.check.mjs` (each prop's height, width and depth against common furniture sizes,
tinted, on the floor; rooms deterministic and inside their walls).

Limits: drawers and doors do not open; soft furnishings are shaped boxes, not cloth; a room's layout is fixed per kind
(it scales with the size, it does not plan around a door you add).
