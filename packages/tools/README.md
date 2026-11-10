# @mirage/tools

Quality and packaging tools; they drive the local Chrome (`/Applications/Google Chrome.app`, or `$CHROME`) headless
with the GPU on through puppeteer-core. Targets are a built `dist/` folder (served on 127.0.0.1) or a packaged
`.html` (opened from file://).

| tool | |
|---|---|
| `src/gpu-ci.mjs run` / `collect` | GPU runner adapter for serial acceptance, hardware preflight, partial evidence and Actions artifacts. [Runner setup](../../docs/GPU-CI.md). |
| `src/typecheck.mjs --out <new-dir>` (`npm run test:types -- ...`) | Test machine only: pack core/world/play/game, install the tarballs and a pinned compiler in a separate consumer, compare the Rapier declarations, then compile TypeScript and checked JavaScript with NodeNext and Bundler. Keeps package contents, hashes, lock and logs; no rendering. [Type handoff](../../docs/TYPES.md). |
| `src/acceptance.mjs --run --machine <json> --out <new-dir>` (`npm run acceptance -- ...` at the root) | Test-machine-only serial acceptance of a clean HEAD archive: install, CPU checks, every example, physics, touch, stillness, GPU load, five still views, kit metrics and character review. Keeps logs, screenshots, source hashes and a pending human review; never certifies 1.0. See [the handoff](../../docs/ACCEPTANCE.md). |
| `mirage-validate-plan <file> [--json]` | Validate a local JS module's default export or a JSON plan with the same rules used by the loader. Prints all invalid field paths, then the same problems as [diagnostics](../../docs/diagnostics.md) (`--json`: only those, as a JSON array). Exits 0 for a valid plan, 1 for an invalid or unreadable file and 2 for incorrect usage. |
| `mirage-check <dist \| page.html \| url> [--json]` (`src/check-world.mjs`) | the world check: load once, list every [diagnostic](../../docs/diagnostics.md) that needs no scenario (plan, failed modules, spawn and viewpoints inside solids, floating objects, coplanar surfaces, what each viewpoint shows, triangle budget, black frame, console errors); exit 1 on any error |
| `src/package.mjs <example> [--out f.html]` | one standalone HTML file: Vite build, every asset inlined, no code splitting, workers as Blob URLs started classic (file:// cannot start module workers from Blobs) |
| `src/playtest.mjs <scenario.json> <target> [--out dir]` | the agent self-test loop: a JSON scenario of placements, held keys, taps, `walkTo` routes, `lookAt` (points or game entities), `flicker` along a path, `perf` (frame cost), `see` (what share of the final view named objects cover, from an ID pass, with the reason when too little: out of frame, hidden by what, too small); expectations on position, collision, game state (`near prompt inventory flags.*`), flicker, frame time, screenshot exposure (`luma dark clipped`), console errors; every problem also as a coded [diagnostic](../../docs/diagnostics.md) with a concrete fix (`report.json` `diagnostics`, the top of `report.md`), plus load-time world checks; writes `report.md`, `report.json`, one screenshot per step, `sheet.png` (contact sheet) and the worst flicker triple (`-worst.png`, `-worst-diff.png`); exit 1 on any failure |
| `src/walktest.mjs` | M2's walk tests: an alias of playtest (same scenario format) |
| `src/gpu-load.mjs <dist...> [--idle s]` | GPU load per built example: frames drawn when still (after the idle time, 10 s), with the tab hidden (0 frames, 0 callbacks, audio suspended), while walking (at most the display rate and 60) and in power saver (at most 30); exit 1 on any failure |
| `src/touch-check.mjs <dist...> [--frames 40]` (`npm run test:touch`) | a phone-sized page with touch emulation and real touch events: plain play walks, runs and looks by finger (from an orbit view through the touch bar's Walk button); a game starts on a tap and its stick walks and, pushed past the rim, runs; exit 1 on any failure |
| `src/snap.mjs <target> [--out dir] [--views all] [--spp 16] [--game]` | every plan viewpoint as a still (the core's still path), plus `sheet.png` (a contact sheet) and `snap.json` |
| `src/perf.mjs <target> [--w 1440 --h 900]` (`mirage-perf`) | synchronous frame cost: walk, game view, fly (moving, TAA) and the still path at spp 6 / 16; draw calls, triangles |
| `src/e2e.mjs [--only a,b] [--no-file]` (`npm run test:e2e` at the root) | every example with a `playtest` script, in sequence: build, playtest of `dist/`, the example's extra scripts (garden-quest's playthrough), package, playtest of the single file from file://; keeps going after a failure, prints a summary, writes `out/e2e/summary.json`; exit 1 if any step failed |
| `src/deploy.mjs <example> [--out dir] [--multi]` | a folder any static host can serve (single file or Vite's dist, `.nojekyll`, `_headers`); checks it, prints how to publish. **Uploads nothing.** |
| `tex/pack.py` | fetch CC0 texture sets from Poly Haven and pack them (M1b) |

Scenario step: `{ name, place: { eye, look, mode }, viewpoint, mode, walkTo: [[x, z]], lookAt, tap: 'Space', keys: ['KeyW'], ms,
flicker: { path }, perf: { frames }, expect: { z: '> 8.6', y: '~ 1.6 0.05', 'flags.lit': '== true', flicker: '< 8' }, shot }`; full
reference in the header of `src/playtest.mjs`; how agents use it: `agent/mirage-playtest/SKILL.md`. Scenarios:
`examples/*/scenarios/*.json`.
