# 2.5D: sprite actors, the iso camera, click to move

2D sprite characters standing in a lit 3D Mirage world, seen from a high camera, moved by clicking the ground.
Everything here is opt-in: nothing else in the engine imports it, and a world that does not use it renders exactly
as before. It came back from a game built on Mirage (2D figures in a 3D town), with the game's data taken out.

| piece | import | what it is |
|---|---|---|
| atlases | `@miragekit/play` (or `/sprites`) | the atlas format below: `parseAtlas`, `makeAtlas`, `loadAtlas`, `makePlaceholderAtlas` |
| directions | `@miragekit/play` | `spriteDirection(facing, yaw)`, `drawnDirection(dirs, dir)` |
| animation | `@miragekit/play` | `createSpriteAnim(atlas)`: frame, loop, the hit frame as an event |
| actor | `@miragekit/play` | `createSpriteActor(world, atlas, opts)`: the lit card, a blob shadow, outline, flash, fade, silhouette |
| camera | `@miragekit/play` (or `/iso-camera`) | `createIsoCamera(opts)`: fixed pitch, yaw, zoom limits, optional input |
| picking | `@miragekit/play` (or `/walk-pick`) | `pickWalkGrid(grid, ray, opts)`, `reachableGoal(nav, p, opts)` |
| cutaway | `@miragekit/world/kits/cutaway` | `createCutaway(opts)`: a see-through hole between the camera and the player |
| map edge | `@miragekit/world/kits/edge` | `addPerimeter(ctx, bounds)`, `addBarrier(ctx, polyline)`: invisible walls |

The example [examples/sprite-yard](../examples/sprite-yard/main.js) uses all of it on a yard between three houses,
with placeholder figures drawn in code.

## The atlas format

An atlas is a PNG (RGBA, transparent background) and a JSON beside it:

```json
{
  "id": "hero",
  "cell": [128, 192],
  "feet": [64, 184],
  "height": 1.75,
  "dirs": 5,
  "anims": {
    "idle":   { "fps": 4,  "loop": true,  "frames": [[[0, 0], [128, 0]], "... one list per drawn direction"] },
    "walk":   { "fps": 8,  "frames": ["..."] },
    "attack": { "fps": 10, "loop": false, "hit": 2, "frames": ["..."] }
  }
}
```

| field | meaning |
|---|---|
| `cell` | px of one frame; every frame has the same size |
| `feet` | px in a cell where the feet touch the ground: the pivot (default: bottom centre) |
| `height` | metres the cell's height spans in the world (1.75); the width follows the cell's proportions |
| `dirs` | 8: every direction drawn; 5: directions 0..4 drawn, 5, 6, 7 are 3, 2, 1 mirrored left-right; 1: one picture for every direction (default) |
| `anims.<name>.frames` | one list of cell top-left corners `[x, y]` (px) per drawn direction, in the order 0..dirs-1 |
| `fps`, `loop` | frames a second (8); `loop: false` holds the last frame and ends the run |
| `hit` | the frame the blow lands on: `onHit` fires there (a third of the way in without it) |
| `image` | the image's file name beside the JSON (`atlas.png`) |
| `pixelArt` | nearest-neighbour magnification |

A missing animation falls back to `idle` (else the first one). `parseAtlas(json, { width, height })` checks all of
it against the image size and throws one error listing every problem (a cell outside the image, a frame list per
direction missing, a `hit` past the last frame).

### Directions

World: metres, +X east, +Y up, +Z south. A facing angle is `a = atan2(dx, dz)` (0 = facing +Z). A camera at yaw
`y` sits south (+Z) of its target when `y = 0` (the convention of `createIsoCamera` and `createFollowCamera`). The
direction a sprite shows on screen:

```
dir = round((a - y) / 2π · 8) mod 8
0 facing the viewer   1 front-right   2 screen right   3 back-right
4 facing away         5 back-left     6 screen left    7 front-left
```

`spriteDirection(a, y)` is that line. The node check places a real camera with the iso camera and confirms that a
figure facing the camera is 0, one facing the camera's right axis is 2 and one facing away is 4.

### Loading, and placeholders until the art exists

```js
const atlas = await loadAtlas('/sprites/hero/atlas.json', { placeholder: { shape: 'humanoid' } });
```

`loadAtlas` fetches the JSON and its image and returns the atlas with its texture (sRGB, mipmapped). When the files
are missing or wrong and `placeholder` is given, it returns a placeholder in the same format instead
(`atlas.source === 'placeholder'`), so a game runs before its art exists and the art replaces it by adding two
files. `makePlaceholderAtlas(spec)` draws one directly: shapes `humanoid`, `blob`, `bird`, `crab`, `item`, the
animations idle, walk, attack (hit on frame 2), hurt and die, colours from the spec (CSS colours) or hashed from the
id. Each figure carries a chevron on its chest pointing where it faces on screen, so a wrong direction shows at a
glance. `makeAtlas(json, imageOrCanvasOrTexture)` wraps anything else.

## The sprite actor

```js
const hero = createSpriteActor(world, atlas, { silhouette: true, ground: (x, z) => grid.groundAt(x, z, feetY + 0.5) });
hero.play('attack', { onHit: () => strike(target), onEnd: () => hero.play('idle') });
// each frame, after the camera:
hero.group.position.set(x, y, z);
hero.setFacing(Math.atan2(dx, dz));
hero.update(dt, iso.yaw);
```

The card's material is a `world.mat.std` material (Mirage's `patch()` hooks), so the figure is lit by exactly what
lights the world: the sun and its (soft) shadow map, the sky's image-based light, PointLights and the lamp pool, the
fog and the time-of-day grade. A figure beside a lantern at night warms with no game code. Three things make a
flat card behave in a 3D world:

- **Screen shape from a camera-facing card, depth from a vertical one.** Where each corner shows on screen comes
  from a card facing the camera, so the art keeps its drawn proportions under a 52° pitch. Its depth comes from
  where the same eye ray meets a vertical plane through the feet: a card leaning back with the camera would cut
  into the walls and slopes behind the figure, the vertical one occludes like a standing body. z/w is affine in
  screen space for a plane, so the depth is that plane's exactly, and the texture maps as drawn.
- **Lighting at true height on the vertical card**, so shadows and lamps fall on the body, not on a point 1.4 m
  behind it.
- **A shading normal between up, the camera and the sun**, with wrapped direct light (35 % from straight behind):
  the art carries its own shading; a camera-facing normal would turn every back-lit figure black at golden hour.

No blending: the cell is alpha-tested at 0.5, so depth stays exact and nothing is sorted; `setFade(k)` fades by a
dither. `outline('hover' | 'enemy' | 'friend' | 'select' | [r, g, b])` draws an outline from the neighbouring texels'
alpha; `flash()` a hit flash. Both are emissive colours divided by the frame's exposure (post × auto exposure ×
grade, kept in step by one `ctx.onUpdate` per world), so they read the same at noon and at night. All per-sprite
state is uniforms: every sprite shares one program.

The blob shadow lies on the ground under the feet, tilted to the slope when `ground(x, z)` is given. The
silhouette (`silhouette: true | { color, opacity }`) is the same card drawn a second time with
`depthFunc: GreaterDepth`: it shows where something stands in front of the figure, so a high camera never has to
dodge walls. Every mesh is `userData.collide = false`: the walk grid ignores the actors.

Cards are placed in the vertex shader, so a CPU raycast cannot see them: `actor.screenRect(camera, w, h)` gives the
card's rectangle on screen in pixels with its depth, for hover and click picking (nearest depth wins).

`createSpriteAnim(atlas)` is the animation state on its own (no three): `play(name, { restart, speed, onHit,
onEnd })`, `update(dt, dir)` returns the frame and fires the callbacks. Playing the animation already playing
continues it; one started from inside `onHit` replaces the run, and the old run's `onEnd` never fires (a new order
cancels a swing after its blow).

## The iso camera

```js
const iso = createIsoCamera({ pitch: 52, yaw: 35, distance: 22, min: 10, max: 34 });
const unbind = iso.bind(canvas);        // optional; iso.dispose() removes every listener too
// each frame:
iso.follow(feet).update(dt).apply(world.camera);
```

A perspective camera at a fixed pitch above a target, turned around it in yaw, zoomed within `min`..`max`. The
target is smoothed on its own (`follow`, 8 / s), so path-following jitter never reaches the view; `snap()` jumps
after a teleport. `pitchMin` / `pitchMax` and `yawMin` / `yawMax` give the angles a range (by default the pitch is
fixed and the yaw free). `bind(dom, opts)` adds the input: right-drag turns (and tilts, if the pitch has a range),
the wheel zooms, Q / E turn while held (`keys`, `keyTarget`), two fingers twist and pinch. Without `bind` the
camera takes no input: drive `turn(dYaw, dPitch)` and `zoom(factor)` yourself. No three import: `position` and
`look` are numbers, `apply(camera)` writes a camera.

## Click to move

```js
ray.setFromCamera(ndc, world.camera);
const p = pickWalkGrid(grid, ray.ray, { nav, radius: 0.3, skip: (x, y, z) => cut.hides(x, y, z, world.camera.position) });
const goal = p && reachableGoal(nav, p, { radius: 0.3, from: agent.pos, tryGoal: (q) => agent.setGoal(q) });
```

`pickWalkGrid` marches the screen ray through the walk grid (0.25 m steps, then bisection to under a centimetre)
instead of raycasting meshes. It works on any world without a list of ground meshes; it ignores what does not
collide (foliage, props marked `collide = false`: the walker's own rule); only a floor's top counts, so the ray
passes through the bodies of walls; with `nav` it passes spots a body of `radius` does not fit (hard against a
wall, under a beam); `skip` drops hits the player cannot see (what the cutaway hides). The result is a point the nav
grid can path to.

`reachableGoal` turns a clicked point that cannot be reached into one that can: the point; else the lower floors of
its column (under a bridge); else rings round its foot at the walker's height (0.6 to 3.6 m, 8 points each,
snapped with `nav.nearest`): the ground beside the crate, the bench or the house that was clicked. `tryGoal` says
whether a point is reachable; `agent.setGoal` returns exactly that and starts walking.

## The cutaway and the map edge (`@miragekit/world`)

```js
const cut = createCutaway({ radius: 1.9 });
// building: mark the materials that may hide the player
const wall = ctx.mat.std({ color }, cut.hooks(ctx.mat.PROC.plaster('vec3(1.0)')));
cut.apply(ctx.mat, roofMaterial);                 // or one that exists already
// each frame:
cut.set(feet.x, feet.y + 1, feet.z);
```

A dithered round hole along the line of sight from the camera to the target, in the marked materials only: walls,
roofs and tree crowns open, the ground stays. The hole is narrower near the camera, starts and ends a little short
of either end (`near`, `far`) and keeps everything more than `below` (0.6 m) under the target. Depth materials are
untouched, so the cut walls still cast their shadows. Every cutaway compiles to one program (the target and shape
are uniforms). `cut.hides(x, y, z, eye)` is the same geometry on the CPU (at the full radius), for picking.

`addPerimeter(ctx, bounds)` puts collider walls just inside the walk bounds (the walk grid ends there whatever the
scenery does); `addBarrier(ctx, [[x, z], ...])` an invisible wall along a polyline (a stream bank, a cliff edge).
Each is ONE collider mesh (`ctx.collider`, layer 2): a wall of one mesh per segment costs the bake a draw each.

## Limits

- One mesh per actor (two draws, three with the silhouette). Tens of actors cost nothing measurable; crowds of
  hundreds want an instanced path (one draw per atlas, the uniforms as instance attributes). Not built yet.
- Sprites are drawn into environment captures like any mesh.
- Actors added after `world.prepare()` compile on their first frame; create them before it, or draw a frame
  behind a curtain.
- `loadAtlas` does not cache: keep the promise per atlas if several actors share one.
- The pick is a march: a floor thinner than a step along the ray, seen edge-on, can be stepped over.

## Checks

`packages/play/sprites.check.mjs` (in `npm test`): the direction convention against a real camera, atlas parsing
and frame maths, animation events, every placeholder shape, the sprite material's shader edits and shared program,
the actor, the iso camera's maths, limits and input bind / unbind, picking and the reachable fallback on a hand-made
walk grid. `packages/world/cutaway.check.mjs`: the cutaway's hooks, program sharing, re-patching, the CPU test,
the edge colliders. What the GPU draws: `examples/sprite-yard`.
