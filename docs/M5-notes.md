# M5 notes — the contrast example, the README, demos, release prep (M4 merged in)

M5 adds `examples/snow-hut` (the style contrast: cold, night, snow), the public README in English and Chinese with
a hero image, a gallery of all five examples and a showcase of the author's earlier work (images only), two
single-file demos, version 0.1.0 everywhere, CHANGELOG / CONTRIBUTING / a release checklist, and a full regression.
All new code is Mirage original code; nothing comes from Golden Temple or from the author's earlier project.
Nothing was pushed, published or made public.

## What

- **snow-hut** (`examples/snow-hut`, 484 lines): a one-room log hut in a fenced yard on a snowy slope at blue hour
  (sun −6° at 300°, the moon up), falling snow, three lit windows, a porch lantern, 226 spruces; walk in and light the
  stove (E), saves, wind. Built by the skill pack's flow in sequential mode by one agent: `BRIEF.md` → `plan.js` →
  three modules (`ground`: 1400 m heightfield with a level yard, the slope rising north, ridges, split-rail fence with
  proxies, 7000 flakes in a camera-following box; `hut`: footing, one floor / porch slab, log walls with crossing
  corners, windows, gables, snowy roof, open door, table, bench, bunk, stove with pipe, woodpile, lights following the
  lamp level; `pines`: one drooping-tier lathe instanced with snow on upward faces and a noise wobble) → `game.js`
  (the stove on the `stoves` anchor) → `scenarios/playtest.json` (19 steps) → single file → contact sheets.
  Shared snow material helpers: `snowHooks(lie)` and `withSnow(hooks)` in `modules/materials.js`.
- **Demos** (`examples/demos`, packaged with `package.mjs`, output in `examples/demos/release/`, git-ignored):
  `day-night` (snow-hut's plan and modules unchanged, a running clock 06:30 → 22:30 at 40 min/s, looping, the camera
  circling inside the pines) and `assemble` (walled-garden's modules plus its broken one; each module's objects rise
  from the ground in build order while the loader's report scrolls by; the broken module is shown skipped). Each is
  one `main.js` (39 and 60 lines) and an `index.html`.
- **README.md / README.zh-CN.md**: positioning, why, a 60-second quick start (commands verified: `npm test`, build,
  `vite preview` serves 200, playtest, package), workflow table linking `agent/INSTALL.md`, packages, the gallery
  (`docs/media/examples/*.jpg`, rendered by `snap.mjs` at spp 24), demos, "Made with the Mirage approach" (six JPEGs
  in `docs/media/showcase/`, 47–135 KB, cropped from the earlier project's stills with all HUD and viewpoint labels
  removed, neutral caption, no place named), status and limits, relation to other projects, licence, credits.
- **Release prep**: root `package.json` 0.0.0 → 0.1.0 (every package and example was already 0.1.0);
  `CHANGELOG.md`; `CONTRIBUTING.md` (the shared rules of `docs/CURSOR-TASKS.md` in English); `docs/RELEASE.md`
  (Chinese checklist: squash history, flip to public, description and topics, contact Leon Lin, time-lapse video,
  demo links, and what blocks 1.0 — **none of it run**). `CREDITS.md` gained the showcase row and the code-only note.

## Numbers (Apple M4 Pro, ANGLE Metal, Chrome headless, 1440 × 900)

Final regression after the last change (`npm test`, then for every example: build, package, playtest of `dist/`,
playtest of the single file from file://, one still):

| example | steps (dist / file) | console errors | flicker mean / max | frame ms mean / p95 (dist) | calls, triangles | load to ready dist / file | single file |
|---|---|---|---|---|---|---|---|
| hello-courtyard | 14 / 14 pass | 0 | 4.84 / 7.6 | 3.84 / 5.1 | 50, 120 k | 4.4 s / 0.5 s | 2.13 MB (1.30 textures) |
| walled-garden | 18 / 18 pass | 0 | 4.25 / 7.0 | 3.58 / 3.8 | 60, 406 k | 3.6 s / 0.9 s | 2.14 MB (1.30 textures) |
| garden-quest | 9 / 9 pass | 0 | 1.84 / 10.7 | 4.05 / 4.3 | 90, 409 k | 7.9 s / 1.4 s | 4.32 MB (1.30 textures) |
| agent-trial | 17 / 17 pass | 0 | 2.56 / 50.1 | 3.82 / 4.1 | 103, 86 k | 4.8 s / 1.0 s | 3.00 MB |
| snow-hut | 19 / 19 pass | 0 | 2.11 / 18.5 | 4.53 / 5.2 | 56, 334 k | 5.7 s / 1.0 s | 3.00 MB |
| demo day-night | — | 0 | — | 61 fps (vsync) | — | 0.4 s (warm) | 0.80 MB |
| demo assemble | — | 1 (the deliberate broken module) | — | 39–61 fps | — | 4.4 s | 2.11 MB (1.30 textures) |

- `npm test`: core, world, play, game checks and 7 skills ok, exit 0. garden-quest scripted playthrough: all steps
  pass. Still-frame identity (hello-courtyard `verify.mjs`, golden): same frame index → max difference 0, 0 pixels
  differ. Snapshots: 0 console errors for all five.
- snow-hut: modules ground 168 k triangles / 51 ms (terrain 115 k), hut 5.4 k / 8 ms, pines 67 k / 2 ms; world build
  60 ms; walk grid 264 × 216 × 71 slabs, 112 ms. The flicker maximum (18.5) is at the doorway, where the view passes
  from blue snow into the orange room in one step; the mean is 2.1.
- Every single file ≤ 5 MB; garden-quest is the largest (4.32 MB: Rapier 2.24 MB + textures 1.30 MB).

## Open problems / not done

- **Built by one agent**, not in parallel; snow-hut has only the whole-world scenario, no per-module scenarios.
- **Rapier and small risers**: the character stuck on a 0.13 m riser behind a 0.17 m step, then on a 5 cm threshold,
  where the walk-grid walker passes. Worked around in the hut (one floor / porch slab, one step); the engine is
  unchanged (CURSOR-TASKS B16).
- **Snow keeps the view "moving"**: the flakes advance with game time and mark the scene dirty every frame, so the
  still-path refinement never runs while the game is open (B17). The still-frame identity check was run on the
  courtyard only, not on snow-hut.
  Since B21: after 10 s without input the snow stops drawing (it freezes) and the refinement runs to the final
  still frame; `npm run test:gpu-load` checks it for every example. Refining while the snow keeps falling would
  need the flakes drawn over the refined image (its depth kept): not done.
- **Lights**: no shadows from the interior lights (they reach ~1 m past the walls); window panes are a constant
  emissive, not light passing through (B18). The look is stylised: tiered cone pines, flat snow without sparkle or
  footprints, fog doing much of the depth.
- **Demos**: the day-night clock starts about ten minutes before `?from=` (not investigated); the assemble demo's
  rise is a y-scale of each module group (roofs squash while rising); a third demo (weather) was skipped (B19).
- **README**: no live demo links (nothing deployed); the preview was rendered with a small local Markdown converter
  and GitHub-like CSS, not by GitHub. The quick start was verified in this checkout, not in a fresh clone.
- **Release**: the checklist in `docs/RELEASE.md` is untouched — no squash, no visibility change, no tags, no
  contact, no video. Nice-to-haves skipped are listed in `docs/CURSOR-TASKS.md` ("M5 跳过的可选项").
