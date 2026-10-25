# Mirage

**A code-only world engine for AI agents.**

![A log hut on a snowy slope at blue hour, built entirely in code (examples/snow-hut)](docs/media/hero.jpg)

Mirage builds whole places — courtyards, gardens, piers, mountain huts — in three.js **as code**: no Blender, no
model files, no editor. A world is a site plan plus a handful of modules; several agents can build those modules
in parallel, test what they built by walking it with scripted inputs, and ship the result as one HTML file of a
few megabytes that opens from disk.

[English](README.md) · [中文](README.zh-CN.md)

> **Status: pre-alpha (0.1.0).** It works for the five examples below on the author's (灰叔 Racso's) machine. APIs will change,
> nothing is published to npm, and it has only been tested in desktop Chrome on Apple silicon. See
> [Status and limits](#status-and-limits).

## Why

- **No asset pipeline.** Geometry, materials, sky, light and sound are generated from code, so an agent that can
  write JavaScript can build the whole place. Photo textures are optional (CC0; two examples use them).
- **Worlds in megabytes.** The examples ship as single files of 0.8–3.0 MB; 2.2 MB of the larger ones is the
  physics engine.
- **Agents build in parallel.** The world protocol gives every module its own file, its own plan fields and its
  own notes section; positions come only from the shared plan, so modules never measure each other.
- **Agents test themselves.** `mirage-playtest` runs a JSON scenario in real Chrome — walk routes, jumps at walls,
  interactions, flicker along a path, frame cost — and writes a pass / fail report and a contact sheet that the
  agent looks at before it hands back.

## Quick start (60 seconds)

Needs Node 22+ and Google Chrome (the tools drive the local Chrome headless).

```sh
git clone https://github.com/paraldaMeta/mirage-engine.git && cd mirage-engine
npm install && npm test                      # engine checks in node, no GPU
cd examples/snow-hut
npx vite build && npx vite preview           # open the printed URL: WASD + mouse, E to use, Esc for the menu
```

Then, from the same folder:

```sh
node ../../packages/tools/src/playtest.mjs scenarios/playtest.json dist   # scripted walk: out/playtest/report.md + sheet.png
node ../../packages/tools/src/package.mjs .                               # release/snow-hut.html, opens from disk
```

## The AI-native workflow

**brief → plan → parallel modules → playtest → ship.** Each step is a skill in [`agent/`](agent/) (the open Agent
Skills format; install for Claude Code, Codex or Cursor: [agent/INSTALL.md](agent/INSTALL.md)).

| step | skill | output |
|---|---|---|
| a paragraph from the user | `mirage-brief-to-plan` | `BRIEF.md` (idea, mood, scale, target), `plan.js` (every shared position), one brief per module, a scaffold |
| build | `mirage-parallel-build` + `mirage-module` | one worker agent per module, each owning its file, its scenario and its section of `NOTES.md` |
| check | `mirage-playtest` | a report and a contact sheet per module, then for the whole world |
| play | `mirage-game` | interactables, saves, sound and UI from the modules' anchors |
| ship | `mirage-ship` | one HTML file, budgets checked, a static deploy folder; **uploads nothing** |

`examples/agent-trial` was built this way: a lead agent wrote the plan, three fresh sub-agents built the shore,
the pier and the lighthouse in parallel (7–14 minutes each), and every module passed its own playtest before
integration ([TRIAL.md](examples/agent-trial/TRIAL.md)).

## Packages

| package | what it does |
|---|---|
| [`@mirage/core`](packages/core) | rendering: physical sky and aerial perspective inside every material, sun / moon key light with fitted soft shadows, image-based light captured from the built world, sub-frame accumulation (AA, soft shadows, clean SSAO, depth of field), temporal AA while moving, day / night for any place and time, the `patch()` material-hook system with a GLSL noise library, an optional CC0 texture layer, seeded randomness, geometry helpers, LOD |
| [`@mirage/world`](packages/world) | the world protocol: site plan validation, modules (`build` / `anchors` / `finalize` / `ambientVolumes`), build order, failure isolation (a throwing module is skipped, the world still loads), per-module randomness, a build report ([docs/world-protocol.md](docs/world-protocol.md)) |
| [`@mirage/play`](packages/play) | walk, fly, isometric game view, orbit; collision and ground from a walk grid baked from the real geometry; progressive refinement when the view stops; an embed API for host games |
| [`@mirage/game`](packages/game) | a minimal game layer: Rapier physics (lazy WASM), character controller, doors, an action map (keys, gamepad, touch), procedural Web Audio, entities and interactables, inventory, versioned save / load, an accessible HTML overlay |
| [`@mirage/tools`](packages/tools) | the playtest runner, single-file packager, still snapshots and contact sheets, frame cost, a static deploy folder (no upload) |
| [`agent/`](agent) | seven skills for agents, an install guide, a validator (run by `npm test`) |

## Examples

| | | |
|---|---|---|
| ![](docs/media/examples/hello-courtyard.jpg) **hello-courtyard** — a walled courtyard with a basin, a pergola and a palm; four modules, five CC0 texture sets, a running clock | ![](docs/media/examples/walled-garden.jpg) **walled-garden** — three terraces, stairs, pools, a pavilion; six modules (plus one that fails on purpose) | ![](docs/media/examples/garden-quest.jpg) **garden-quest** — the garden as a small game: find the key, open the pavilion, light the lanterns; saves, gamepad, touch |
| ![](docs/media/examples/agent-trial.jpg) **agent-trial** — a pier and a lighthouse at dusk, built by three agents in parallel from the skill pack | ![](docs/media/examples/snow-hut.jpg) **snow-hut** — a log hut on a snowy slope at blue hour, falling snow; walk in and light the stove | |

Each runs with `npx vite build && npx vite preview` in its folder; `npm run playtest` checks it; `npm run package`
makes the single file.

**Demos** (single files, [`examples/demos`](examples/demos)): `day-night` — the snow hut under a running clock
from dawn to night, lamps coming on at dusk (0.80 MB); `assemble` — the walled garden assembling itself module by
module while the loader's report scrolls by, including the module that fails and is skipped (2.11 MB). Build them
from the repository root with `node packages/tools/src/package.mjs examples/demos/<name> --out examples/demos/release/<name>.html`.

## Made with the Mirage approach

![](docs/media/showcase/01-valley.jpg)

| | |
|---|---|
| ![](docs/media/showcase/02-pottery-court.jpg) | ![](docs/media/showcase/03-palm-grove.jpg) |
| ![](docs/media/showcase/04-covered-lane.jpg) | ![](docs/media/showcase/05-round-tower.jpg) |
| ![](docs/media/showcase/06-castle-walls.jpg) | ![](docs/media/showcase/07-courtyard-lamps.jpg) |
| ![](docs/media/showcase/08-sunset-street.jpg) | ![](docs/media/showcase/09-water-channel.jpg) |
| ![](docs/media/showcase/10-town-aerial.jpg) | ![](docs/media/showcase/11-golden-palms.jpg) |
| ![](docs/media/showcase/12-night-roofs.jpg) | ![](docs/media/showcase/13-night-arcade.jpg) |

*An oasis town built by 灰叔 Racso with an earlier version of this approach (not included in this repository).*
Its code-only version was 1.6 MB; seven agents working in parallel produced the first version in under four
hours. None of its content, code or materials is part of Mirage.

## Status and limits

Pre-alpha. Honestly:

- Tested in desktop Chrome (headless and windowed) on an Apple M4 Pro only. Safari, Firefox and phones are untested.
- Frame cost is 3–6 ms per walking frame on that machine; there is no tuning for weaker GPUs beyond a `low` quality tier.
- The engine favours still frames: the clock and wind freeze while walking so still views are bit-identical;
  moving views use temporal AA, which smears fast-moving things a little.
- Collision comes from a walk grid baked at load (0.125 m cells) and, in games, Rapier trimeshes; very thin or
  sloped geometry needs proxy boxes, and small risers can still catch the character.
- Vegetation, terrain and water are written per world (no shared kits yet); characters are placeholders.
- The skill pack was validated by one trial (one lead, three workers, Claude Code). Codex and Cursor setups are
  documented, not run.
- Not on npm; package names and APIs will change. Open issues: [docs/CURSOR-TASKS.md](docs/CURSOR-TASKS.md).

## How Mirage relates to other projects

Mirage is a low-level piece meant to sit **next to** other tools, not replace them.

- **Studio-process skill packs** (teams of role agents for game development) organise *who does what*. Mirage
  gives their world-building and technical-art roles something concrete to build with; [agent/INSTALL.md](agent/INSTALL.md)
  maps roles to Mirage skills.
- **All-in-one apps** that design, generate assets, code, play-test and publish a game are end-to-end products.
  Mirage is a library and a set of conventions you run locally; its output is plain files.
- **Engine-knowledge skill packs** teach agents general game-engine practice. Mirage's skills cover only its own
  protocol and tools and can be used alongside them.
- **Godot, Unity and other engines** are complete, mature engines with editors, asset pipelines and native
  exports. Mirage covers a narrow slice — code-generated web worlds that agents build and test — and does not try
  to match their breadth.

## Licence and acknowledgements

MIT, see [LICENSE](LICENSE). Mirage's rendering techniques (physical sky, aerial perspective in materials,
sub-frame accumulation, the material patch system) were learnt from
[Golden Temple](https://github.com/Leonxlnx/golden-temple) by Leon Lin (MIT); no Golden Temple code is included,
and [NOTICE](NOTICE) reproduces its licence as an acknowledgement. Third-party code and assets: [CREDITS.md](CREDITS.md)
(three.js MIT, Rapier Apache-2.0, five CC0 texture sets from Poly Haven).

Credits: Mirage was written by 灰叔 Racso with AI coding agents (Claude Code, Cursor); thanks to Leon Lin for
Golden Temple, to the three.js and Rapier teams, and to Poly Haven's CC0 artists.

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · Changes: [CHANGELOG.md](CHANGELOG.md)
