# Credits

| What | Source | Licence |
|---|---|---|
| Physics (dependency, bundled into builds that use `@mirage/game`) | Rapier by Dimforge — https://rapier.rs, `@dimforge/rapier3d-compat` 0.19.3 | Apache-2.0 (licence text in the npm package) |
| Rendering core (origin) | Golden Temple by Leon Lin — https://github.com/Leonxlnx/golden-temple | MIT (see NOTICE) |
| Texture `plaster` (example only, `examples/hello-courtyard/tex/plaster_c.webp`, `plaster_n.webp`) | Poly Haven "beige_wall_002" by Dimitrios Savva, Rico Cilliers — https://polyhaven.com/a/beige_wall_002 | CC0 1.0 |
| Texture `ashlar` (example only, `examples/hello-courtyard/tex/ashlar_c.webp`, `ashlar_n.webp`) | Poly Haven "sandstone_blocks_08" by Rob Tuytel — https://polyhaven.com/a/sandstone_blocks_08 | CC0 1.0 |
| Texture `paving` (example only, `examples/hello-courtyard/tex/paving_c.webp`, `paving_n.webp`) | Poly Haven "cobblestone_floor_04" by Rob Tuytel — https://polyhaven.com/a/cobblestone_floor_04 | CC0 1.0 |
| Texture `planks` (example only, `examples/hello-courtyard/tex/planks_c.webp`, `planks_n.webp`) | Poly Haven "weathered_planks" by Dario Barresi, Dimitrios Savva — https://polyhaven.com/a/weathered_planks | CC0 1.0 |
| Texture `ground` (example only, `examples/hello-courtyard/tex/ground_c.webp`, `ground_n.webp`) | Poly Haven "dry_ground_01" by Rob Tuytel — https://polyhaven.com/a/dry_ground_01 | CC0 1.0 |
| Showcase stills (`docs/media/showcase/*.jpg`, README only) | screenshots of the author's own earlier project, cropped and compressed; no code, models or materials from it are in the repository | the author's own work, shown with permission |

`examples/walled-garden` uses the same five sets (imported from `examples/hello-courtyard/tex`); everything else in
it is procedural.

`examples/garden-quest` reuses walled-garden and those textures. Every sound (footsteps, door, chimes, wind and
birds, water, the music pad) is generated in code by `packages/game/src/audio.js`; no audio files are in the repository.

`examples/snow-hut` and both demos in `examples/demos` are code only (the assemble demo loads the courtyard's
five texture sets). `docs/media/hero.jpg` and `docs/media/examples/*.jpg` are stills rendered from the examples.

Every asset added to this repository (textures, models, animation, audio) gets a row here with its
author, URL and licence. Only CC0 or project-made assets are accepted.

The texture sets were downloaded from polyhaven.com (1k JPG) and repacked to WebP by
`packages/tools/tex/pack.py` (albedo with AO folded in; normal + height); `manifest.json` keeps the source of each.
