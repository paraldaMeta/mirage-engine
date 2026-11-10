# Documentation

Every guide in this folder, by what you came to do. `npm test` fails when a file here is not linked from this
page or a link in any Markdown file points at nothing (`scripts/check-docs.mjs`). Pages marked 中文 are written in
Chinese; the dated ones are records of what was done and are not kept current.

## Start

| page | read it to |
|---|---|
| [making-a-world.md](making-a-world.md) | make a first world by hand: plan, two modules, playtest, package; the usual pitfalls; escape hatches to plain three.js |
| [world-protocol.md](world-protocol.md) | know the contract: the plan, the module interface, anchors, notes, how agents build in parallel |
| [api.md](api.md) | look up a name: every public export, stable or experimental, and the importable subpaths |
| [diagnostics.md](diagnostics.md) | understand an `MGxxx` code in a playtest report and its fix |

## Features

| page | covers |
|---|---|
| [lighting.md](lighting.md) | cascaded shadows, probe GI, reflection probes, many lights |
| [post.md](post.md) | temporal AA, upscaling, lens, motion blur, bloom, grade, offline output |
| [vfx.md](vfx.md) | particles, trails, beams, decals, the effect library |
| [animation.md](animation.md) | the animation controller, IK, retargeting, timelines |
| [audio.md](audio.md) | the audio engine |
| [ui.md](ui.md) | the in-game UI toolkit |
| [big-worlds.md](big-worlds.md) | chunking, LOD, instancing, occlusion, streaming |
| [import.md](import.md) | glTF / GLB models, compressed formats, reference counting |
| [export.md](export.md) | GLB, USDZ and the other ways out |
| [multiplayer.md](multiplayer.md) | `@mirage/net`: rooms, the server, prediction |
| [xr.md](xr.md) | WebXR: a world in a headset |

## Engineering

| page | covers |
|---|---|
| [STABILITY.md](STABILITY.md) | how many exports are stable, how one is promoted, coverage of the Node checks |
| [ci.md](ci.md) | the hosted jobs, the software-GL job that draws frames, how to run each locally |
| [GPU-CI.md](GPU-CI.md) | 中文. the GPU acceptance workflow and its evidence |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 中文. the serial acceptance run on the test machine |
| [LIFECYCLE.md](LIFECYCLE.md) | 中文. who owns which resource, subscriptions and disposers, what `dispose()` releases |
| [TYPES.md](TYPES.md) | 中文. the declaration files and how they are checked |
| [releasing.md](releasing.md) | the release checklist, publishing with npm provenance |
| [../SECURITY.md](../SECURITY.md) | reporting a vulnerability, what is in scope, the supply chain |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | how to change the engine and what a change must pass |
| [../CHANGELOG.md](../CHANGELOG.md) | what changed, with measured numbers |

## Records

History: plans, reviews and milestone notes as they were written. Useful for why something is the way it is.

| page | what it is |
|---|---|
| [STATUS-1.0.md](STATUS-1.0.md) | 中文. the state of each 1.0 requirement, with evidence |
| [review-1.0.md](review-1.0.md) | 中文. the 1.0 review report |
| [API-CANDIDATE.md](API-CANDIDATE.md) | 中文. the API inventory that led to the stable / experimental split |
| [RELEASE.md](RELEASE.md) | 中文. the first-release checklist (historic; the current one is [releasing.md](releasing.md)) |
| [PLAN-0.2.0.md](PLAN-0.2.0.md), [PLAN-0.3.0.md](PLAN-0.3.0.md) | 中文. the 0.2.0 and 0.3.0 / 0.4.0 plans |
| [M1-notes.md](M1-notes.md), [M2-notes.md](M2-notes.md), [M2.5-notes.md](M2.5-notes.md), [M3-notes.md](M3-notes.md), [M5-notes.md](M5-notes.md) | milestone notes: the rendering core, the world protocol and tools, the game layer, the agent skills, the release prep |
| [TEST-REPORT.md](TEST-REPORT.md), [CURSOR-ROUND1.md](CURSOR-ROUND1.md), [CURSOR-TASKS.md](CURSOR-TASKS.md) | the first external test round: the report, and (中文) the brief and the task list |
| [FIRST-BATCH.md](FIRST-BATCH.md), [CHARACTER-REVIEW.md](CHARACTER-REVIEW.md) | 中文. acceptance on a second machine: the first batch, the traveller character |
