---
name: mirage-router
description: Entry point for building 3D web worlds with the Mirage engine (code-only three.js worlds for AI agents). Use when the user says "Mirage", "build a world / scene / town / level in code", "site plan", "world module", "walkable 3D scene", or when the project has @mirage/* dependencies or a plan.js with regions/footprints/viewpoints. Detects the project state and routes to mirage-brief-to-plan, mirage-module, mirage-parallel-build, mirage-playtest, mirage-game or mirage-ship.
---

# Mirage router

Mirage builds whole 3D places as code: a **site plan** (`plan.js`, every shared position in metres) plus
**modules** (`modules/*.js`, one per part of the world) that the loader builds in order. No model files, no editor.
Agents build modules in parallel and verify the result with scripted playtests in the real Chrome.

## 1. Find the engine and the project

```bash
# the Mirage repo root: has packages/world and packages/tools
ls packages/world/src/loader.js packages/tools/src/playtest.mjs 2>/dev/null || ls node_modules/@mirage
# a Mirage project (a world): any of these
grep -l '"@mirage/' package.json; ls plan.js modules/index.js NOTES.md 2>/dev/null
```

Mirage is not on npm yet: a world lives in a clone of the repo as `examples/<name>` (npm workspaces link
`@mirage/*`). Below, `$MIRAGE` = the repo root. Read once per session: `$MIRAGE/docs/world-protocol.md` (100 lines).

## 2. Route

| state / request | skill |
|---|---|
| no plan yet, or "here is my idea", a brief, a mood, references | **mirage-brief-to-plan** (writes the brief, plan, module list, per-module briefs, scaffold) |
| write or fix one module; "add a pier / walls / trees" | **mirage-module** |
| more than ~2 modules to write, or "in parallel", "use sub-agents" | **mirage-parallel-build** (lead) + **mirage-module** (each worker) |
| "test it", "does it work", after any change, before saying done | **mirage-playtest** |
| pick-ups, doors, levers, quests, inventory, saves, sounds, HUD | **mirage-game** |
| "ship", "package", "single file", "deploy", "share a link" | **mirage-ship** |

Typical order: brief-to-plan → parallel-build (module × N) → playtest (loop until pass) → game (optional) →
playtest → ship.

## 3. Rules that hold everywhere

- The plan is the single source of positions. If two modules need a number, it is in `plan.js`.
- Never `Math.random()`: use `ctx.R` / `ctx.rng('name')` (seeded per module).
- Never say "done" without a playtest report that passes with 0 console errors (mirage-playtest).
- Never upload, publish or push. mirage-ship prepares a folder; the user publishes it.
- Neutral content only in the Mirage repo: no real named places, brands or copyrighted designs.
