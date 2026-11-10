# Brief — <name>

> The user's paragraph, quoted as given.

| field | choice |
|---|---|
| idea | what the place is, what a visitor does there (one or two sentences) |
| mood | time of day and sun, weather / haze, palette (3–5 colours in words), sound |
| references | kinds of place or picture (not named real sites, not copyrighted designs) |
| scale | bounds in metres; the main walk in metres and seconds (1.5 m/s walking) |
| target | walk / game / stills · desktop / phone · single file ≤ 5 MB · frame ≤ 8 ms (M-series walk) |

Every adjective as numbers: <"warm dusk" = sun elevation 4°, azimuth 255, exposure 0.45; "narrow lane" = 2.2 m
between walls 5 m high; "worn" = 3 stone tints ±8 % and 1 in 5 blocks chipped>. An adjective left as a word is
a gap the default look fills.

BANNED (defaults this world does not use unless the user's references do; the list grows after every review):
an empty plain to the horizon around a small built patch; noon sun straight down; uniform grey fog as mood; bloom
or glowing orbs as decoration; one material on every wall; objects in a grid or all centred on the axes; floating
props; every tree the same size and turn; <yours, from the first sheet>.

Decisions made without asking: <list, one line each, so the user can overrule them>.

## Route

The walk a visitor (and the playtest) takes, as plan names: spawn → … → the interactable → … (metres).

## Modules

Build order: <a>, <b>, <c>. Lead owns `plan.js`, `main.js`, `modules/index.js`, `modules/materials.js` (shared
materials), `scenarios/playtest.json`. Each module owns `modules/<name>.js`, `scenarios/<name>.json` and its
`## <name>` section of NOTES.md.

### <module name>

- **Owns**: plan fields / footprints / regions (only this module builds inside them).
- **Builds**: one paragraph with numbers (heights, widths, counts, spacing).
- **Reads**: `plan.…`
- **Offers anchors**: `key` — what `pos` is exactly, extra fields, count.
- **Consumes anchors**: `key` from <module> (in finalize), or none.
- **Collision**: walkable floors (heights), what blocks, open meshes that need `ctx.collider` proxies, anything
  thinner than 0.125 m that must block (give it a proxy).
- **Budget**: ≤ N k triangles, ≤ N draw calls (materials), no textures unless the brief says so.
- **Done when**: `scenarios/<name>.json` passes on `?modules=<producers>,<name>` with 0 console errors.
