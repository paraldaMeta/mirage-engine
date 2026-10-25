# Notes between modules — hello-courtyard

Convention: `docs/world-protocol.md`. Build order: ground, walls, vegetation, props.

## ground
Land (hills beyond 40 m), paving (15 × 15 m), the basin (rim 0.6 m) and spout at `plan.footprints.basin`.

## walls
Four walls (`plan.court`: half 7.5 m, 3.8 m, 0.6 m), pointed gate south (2.4 × 2.3 m), west arcade (4 round
arches 1.9 m), windows N / E, plinth, coping, the bench and the pergola.

| anchor | pos is | extra | count |
|---|---|---|---|
| `lamps` | the lantern's ring: two on the pergola posts' south faces, the west arcade pier, the gate wall | `rotY` out of the surface | 4 |

## vegetation
The palm at `plan.points.palm` (trunk proxy r 0.27 m × 2.4 m; fronds and the trunk tube do not collide) and the
cypresses in `plan.cypresses`.

## props
Nine seeded jars at `plan.points.jarsNorthWest` / `jarsGate`; in finalize a lantern with a warm point light on
every `lamps` anchor.
