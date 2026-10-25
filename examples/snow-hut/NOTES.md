# Notes between modules — snow-hut

Convention: `docs/world-protocol.md` §5. Build order: ground, hut, pines. One agent built all three in sequence.

## lead

Owns `plan.js`, `main.js`, `modules/index.js`, `modules/materials.js` (`snow`, `log`, `post`, `stone`, `iron`;
`snowHooks(lie)` and `withSnow(hooks)` put snow on any PROC hook set), `game.js` (the stove on `stoves`, the fire
light, the snowfall clock), `scenarios/playtest.json`.

- 2026-10-25: the Rapier character stuck twice at the doorway (a 0.13 m riser behind a 0.17 m step, then a 5 cm
  threshold). Fixed in hut by one plank slab that is both floor and porch (no seam) and one 0.17 m step. A first
  door leaf standing open into the room blocked the route; it now lies back against the wall.

## ground

2026-10-25 — built, 168 k triangles (terrain 115 k), 48 ms. Offers `heightAt(x, z)` and `snow` (uniform `{ value }`,
seconds). Fence proxies: one 2 m tall, 0.4 m thick box per side, from y − 0.5. Flakes `collide = false`.

## hut

2026-10-25 — built, 5.4 k triangles, 8 ms. Floor top 0.34 (= `plan.hut.floor`), porch z −0.5 … 0.4, step top 0.15
at z 0.35 … 0.85. Lights: porch lantern 3.2, room 4, window spill 1.2 (× the lamp level). Anchors:

| key | pos is | extra | count |
|---|---|---|---|
| `stoves` | centre of the stove's fire door, 0.3 m in front of the stove axis | `rotY` 0 (faces +Z) | 1 |

Returned: `fire` (the fire door's material, emissive 0 until lit), `room` (the room light).

## pines

2026-10-25 — built, 67 k triangles, 2 ms; 226 trees. Needles are `collide = false` with a matching depth material.
