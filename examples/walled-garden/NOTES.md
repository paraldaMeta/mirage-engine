# Notes between modules — walled-garden

Each module owns one section; only its owner writes there. Re-read the whole file before editing. Append dated
entries; never rewrite another section. Requests go in your own `### Requests` list, addressed by name.
Convention: `docs/world-protocol.md`. Build order: terraces, walls, paths, pavilion, vegetation, props.

## terraces

Land around the garden (flat to 3 m outside the walls, hills beyond 50 m), three terrace fills (gravel tops at
`plan.levels` 0 / 1.6 / 3.2), retaining walls on the terrace boundaries (`plan.stairs[i].z`, 0.6 thick) with
0.8 m parapets, and the two axis flights (9 risers of 0.178 m, treads 0.36 m, cheek walls 0.55 m above the steps).

Reads: `enclosure`, `terraces`, `levels`, `stairs`, `retaining`. Owns: `levels`, `terraces`, `stairs`, `retaining`.

### Anchors offered

| key | pos is | extra | count |
|---|---|---|---|
| `posts` | ground point of a lamp post at each stair head, 0.45 m behind the retaining wall | `rotY` faces down the stairs | 4 |
| `urns` | ground point beside each stair foot, 0.6 m out from the last step | | 4 |

### Keep clear

The stair footprints (`plan.footprints.stairsLower`, `stairsMiddle`) and 0.6 m either side.

## walls

Perimeter wall (3.6 m above the terrace it stands on, stepped with the terraces), stone plinth and coping,
buttresses every 9 m, and the gate: an 8 m segment, 5.0 m high, round arch 3.0 m wide springing at 2.8 m,
piers with caps and finials.

Reads: `enclosure`, `gate`, `terraces`, `levels`. Owns: `enclosure`, `gate`.

### Anchors offered

| key | pos is | extra | count |
|---|---|---|---|
| `lamps` | bracket plate on the gate segment's inner face, 3.0 m up, 0.9 m beside the opening | `kind: 'wall'`, `rotY` = π (into the garden) | 2 |

## paths

Paving (axis 4 m, cross paths 2.6 m, kerbs 0.12 m), the basin (rim 0.62 m, water proxy), the pools (kerb 0.45 m,
water proxy 1.6 m), lawn panels with 0.55 m hedges.

Reads: `paths`, `basin`, `pools`, `lawns`, `enclosure`. Owns: `paths`, `basin`, `pools`, `lawns`.

### Anchors offered

| key | pos is | extra | count |
|---|---|---|---|
| `seats` | ground point under a bench centre, between a cross path's kerb and the hedge behind | `rotY` faces the path | 24 |
| `urns` | ground point at each cross path's ends by the east and west walls | | 6 |

### Requests

- **vegetation** (2026-10-25): trees stand inside lawn panels; keep trunks ≥ 1 m from the hedge lines so the
  hedges stay unbroken. (Answered below.)

## pavilion

9 × 9 m on a 0.45 m plinth at `plan.pavilion.center`, 3 front steps, walls 3.9 m, an arched door south
(2.0 × 2.6 m), round-arched windows E / W / N (sill 0.9 m), pilasters, cornice, ceiling, two beams, a bench
inside, a four-sided tiled roof (3.2 m) with a finial.

Reads / owns: `pavilion`. Ambient volume: the interior box, factor 0.38 (sky light stays outside).

### Anchors offered

| key | pos is | extra | count |
|---|---|---|---|
| `lamps` | hook under each beam, 0.4 m below the ceiling | `kind: 'hanging'`, `drop` 1.1 m | 2 |
| `doors` | floor centre of the doorway on the wall's inner face | `width` 2.0, `height` 2.55, `leaves` 2, `swing` 1.45 rad (inward) | 1 |

- (2026-10-25, M2.5) `plan.pavilion.leaves: false` leaves the swung-in door leaves out (a game hangs moving ones in
  `doors`); `plan.pavilion.lampKey` renames the `lamps` anchor (garden-quest uses `questLamps`, so props does not
  hang its own lanterns there). Defaults are unchanged: walled-garden renders bit-identically.

## vegetation

Six shade trees (trunk + three limbs, ~90 leaf clumps each; trunk proxies r 0.28–0.34 m × 2.4 m), cypresses
along the east and west walls and outside. Crowns and trunk tubes have `collide = false`.

Reads: `trees`, `cypresses`, `terraces`, `enclosure`.

- (2026-10-25, to **paths**): all six trees are ≥ 2.5 m from every hedge line.

## props

Consumes in finalize: `lamps` (wall brackets or hanging lanterns), `posts` (stone base, iron post, lantern),
`seats` (stone slab benches), `urns` (terracotta urns on plinths). Every lantern gets a warm point light
(intensity follows `uLampGain`): 8 lights in all (2 gate, 4 posts, 2 pavilion).
