# Notes between modules — garden-quest

garden-quest builds walled-garden's six modules (their sections live in `examples/walled-garden/NOTES.md`) plus
`stands`, on walled-garden's plan with `pavilion.leaves: false` and `pavilion.lampKey: 'questLamps'`.
Build order: terraces, walls, paths, pavilion, stands, vegetation, props. The game (`quest.js`) consumes anchors
after the build: `seats` (the key's bench), `doors` (the moving leaves), `questLamps` (the four lanterns).

## stands

Two stone lantern stands (1.13 m) on the upper terrace either side of the pavilion's front steps, at
`plan.quest.stands`. Reads: `quest.stands`. Owns: `quest`.

### Anchors offered

| key | pos is | extra | count |
|---|---|---|---|
| `questLamps` | the top of a stand, where a lantern sits | `kind: 'stand'` | 2 |
