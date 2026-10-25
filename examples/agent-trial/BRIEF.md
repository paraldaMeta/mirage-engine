# Brief — agent-trial

> A small seaside pier with a lighthouse at dusk. You arrive on the promenade, walk out along the timber pier to
> the lighthouse at its end and light the lamp. Calm sea, the sun just down behind the lighthouse. Small: a
> two-minute walk at most. Walkable on a desktop, one file to share.

| field | choice |
|---|---|
| idea | a stone promenade on a seawall, a timber pier on piles running 56 m out to sea, a square pier head with a white lighthouse; at its door a lever lights the lamp and the pier lanterns |
| mood | dusk: sun 1.2° above the sea in the west (azimuth 262°), behind the lighthouse seen from the promenade; calm sea, light haze; palette: cold blue-grey sea, warm orange sky low, white tower with one red band, weathered grey-brown timber, warm lamp light; sound: wind, water, the ignite click |
| references | kinds of place: a harbour-town promenade with a cast-iron rail; a timber pleasure pier on piles; a small round masonry harbour light (no real named site) |
| scale | bounds 90 × 60 m; route spawn → pier head ≈ 70 m (47 s walking, 17 s running) |
| target | walk + one interactable (@mirage/game); desktop; single file ≤ 5 MB; frame ≤ 8 ms walking on an M-series; no photo textures (code-only materials) |

Decisions made without asking: sea to the west so the sunset is behind the lighthouse; high tide, no beach (the
seawall drops straight into the water, so nothing below the promenade is walkable); the deck and promenade at one
level (2.4 m above the sea) so there are no steps on the route; lamps unlit until the lever is pulled; the tower
has no interior (its door stays shut).

## Route

`spawn` (promenade, x 6, z 8) → `points.pierEntrance` (x −2, z 0) → along `paths.pier` → the pier head →
`points.lever` at the lighthouse door: ≈ 70 m. Then back to look at the lit pier from the head.

## Modules

Build order: shore, pier, lighthouse. Lead owns `plan.js`, `main.js`, `modules/index.js`, `modules/materials.js`
(shared materials), `game.js` (the lever, the lanterns, the beacon), `scenarios/playtest.json`. Each module owns
`modules/<name>.js`, `scenarios/<name>.json` and its `## <name>` section of NOTES.md.

### shore

- **Owns**: `plan.shore`, region `promenade`, everything at x > −2 (the seawall face and landward), and the sea.
- **Builds**: the sea (a large water plane at y 0, ~3 km, `collide = false`, a dark seabed a few metres below);
  the seawall (stone face from y −3 up to the promenade at `shore.y` 2.4, along x = −2 from z −30 to 30, with a
  coping); the promenade paving (x −2 … 10, z −30 … 30, top at 2.4); a sea-side parapet (`shore.parapet`: 0.9 m
  high, 0.4 m thick, on x −2 … −1.6) with the pier opening `shore.opening` (z −2.3 … 2.3) left open; a land-side
  retaining wall at x 10 … 10.6 rising 1.3 m above the promenade; land behind it at y 3.7 rising into low hills
  east (> 40 m, coarse); three benches against the land wall at `shore.benches`; two lamp posts either side of
  the pier entrance at `points.entranceLamps`; rocks along the shore north and south beyond the bounds
  (silhouette only).
- **Reads**: `shore`, `bounds`, `points.entranceLamps`.
- **Offers anchors**: `lamps` — 2, the lantern ring on top of each entrance lamp post, `kind: 'post'`.
  `seats` — 3, ground point under each bench centre, `rotY` faces west (−X).
- **Consumes**: none.
- **Collision**: the promenade is the floor (2.4); the parapet (0.9 m) and the land wall (1.3 m) block; the sea is
  never walkable (`collide = false`; nothing walkable below the parapet).
- **Budget**: ≤ 120 k triangles, ≤ 6 materials.
- **Done when**: `scenarios/shore.json` passes on `?modules=shore`.

### pier

- **Owns**: `plan.pier`, path `pier`, footprint `pierHead` (except the lighthouse footprint on it).
- **Builds**: the deck from x −2 to `pier.end` (−58), z −2 … 2 (`pier.width` 4), top at `pier.y` 2.4, planks
  across the run with 1 cm gaps; piles (r 0.18) every `pier.bay` 4 m on both sides from y −3 to the deck, with
  cross-bracing; a timber rail both sides (top `pier.rail` 1.05 m above the deck, posts every 2 m); the pier head
  (`footprints.pierHead`: x −70 … −58, z −6 … 6, same deck level, piles every 4 m, a rail around it, open where
  the pier joins it); lamp posts on alternating sides every `pier.lampEvery` 12 m.
- **Reads**: `pier`, `footprints.pierHead`, `footprints.lighthouse` (the tower stands on the head's deck).
- **Offers anchors**: `lamps` — the lantern ring on top of each pier lamp post (`kind: 'post'`), ≈ 5.
- **Consumes**: none.
- **Collision**: the deck is one floor at 2.4 (the plank gaps must never become holes: a closed slab under the
  planks or a proxy); rails must block (proxies ≥ 0.2 m thick, ≥ 1.1 m high); the pier must join the promenade
  at x −2 with no step and no gap.
- **Budget**: ≤ 200 k triangles, ≤ 5 materials.
- **Done when**: `scenarios/pier.json` passes on `?modules=pier`.

### lighthouse

- **Owns**: `plan.lighthouse`, footprint `lighthouse` (circle centre (−64, 0), r 2.8).
- **Builds**: a round tower standing on the pier head deck (base at `pier.y`): a stone plinth (`lighthouse.plinth`: 0.3 m, r 2.8: one step up), a
  tapering white plaster shaft (r 2.6 → 1.9) up to the gallery (`lighthouse.gallery` 14 m above the deck) with one
  red band, a corbelled gallery with an iron railing, the lantern room (r 1.3, 2.4 m of glazing between iron
  mullions, a dark dome and a vane), the lamp inside (a lens the game lights); a shut timber door (1.0 × 2.1 m)
  facing east toward the pier at `points.lighthouseDoor`; a lever plate beside it at `points.lever`; two small
  windows up the shaft.
- **Reads**: `lighthouse`, `pier.y`, `points.lighthouseDoor`, `points.lever`.
- **Offers anchors**: `levers` — 1, `pos` = the lever's pivot on the wall plate (`points.lever`, 1.1 m above the
  deck), `rotY` faces out (east, π/2). `beacon` — 1, `pos` = the lamp centre in the lantern room.
- **Consumes**: none.
- **Collision**: the tower and plinth are closed solids (they block); the gallery is above `walk.yMax`.
- **Budget**: ≤ 120 k triangles, ≤ 6 materials.
- **Done when**: `scenarios/lighthouse.json` passes on `?modules=pier,lighthouse`.
