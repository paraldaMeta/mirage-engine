---
name: mirage-brief-to-plan
description: Turn a one-paragraph idea into a Mirage world's direction before any building ("先定方向再建设") - a brief (idea, mood, references, scale, target), a site plan plan.js (bounds, regions, footprints, paths, points, viewpoints, spawn, place, sun and time), a module list with build order, a brief per module, and the project scaffold. Use when starting a new Mirage world, when the user says "I want a scene of ...", "plan the world", "site plan", "layout", "brief", or when a world has no plan.js yet.
---

# Brief → plan

Direction first, building second. Nothing is modelled until the brief and the plan exist, because the plan is
what lets several agents build at once without asking each other where things are.

## 1. Brief (5 minutes) → `BRIEF.md`

Copy `references/brief-template.md`. Fill every field from the user's paragraph; where it says nothing, choose
and write the choice down (do not ask unless the choice changes the whole world). One line each:

| field | answers | becomes |
|---|---|---|
| idea | what the place is, what you do there | regions, the walk route, the interactable |
| mood | time of day, weather, palette, sound | `render.time`, fog, materials' tints, audio loops |
| references | 2–4 *kinds* of place or picture (no copyrighted designs, no real named sites) | proportions, materials |
| scale | metres across, how long a walk takes | `bounds`, path lengths (walking speed 1.5 m/s, run 4.2) |
| target | walk / game / stills; device; size budget | modes, `@mirage/game` or not, budgets |

## 2. Plan → `plan.js`

Start from `references/plan-template.js`. Work on paper first: draw the bounds, then the regions, then the
footprints, then the paths that connect them, then the points everyone shares.

- Axes: metres, +X east, +Y up, **+Z south** (north is −Z). Sun azimuth is compass: 90 east, 270 west.
- `bounds` is the walkable rectangle; keep it ≤ ~100 × 100 m (the walk grid is 0.125 m cells, baked at load).
  Scenery beyond it (sea, hills, skyline) is fine: it just is not walkable.
- `walk: { yMin, yMax }`: lowest and highest walkable floor, plus head room.
- Every number two modules share goes in the plan: deck heights, wall heights, a door's position and width,
  level heights, stair runs. Name them; modules read `plan.<thing>`, never measure each other.
- `points`: what the game or another module needs to find (a door, a lever, a bench, the end of a pier).
- `viewpoints`: 6–9 `{ name, eye, look }` covering every region at eye height (1.62 m above the floor) plus one
  aerial; they are the playtest's screenshots and keys 1–9. `spawn`: where a walk starts.
- `render`: `place` (`lat, lon, height, tzHours`: a generic site, not a named one), `time`
  (`'golden'` | `{ day, time }` | `{ elevation, azimuth }` for a fixed sun), `shadow: { center, radius }`
  (the area the sun's shadow map covers), `envProbe` (where image light is captured: open air, eye height),
  `fog`, `post`. Mood → time: dawn/dusk `{ elevation: 1..4, azimuth: 80..100 | 260..280 }`, golden `'golden'`,
  noon `{ day, time: '12:00' }`, night `{ day, time: '21:00' }` (moon and lamps; give the world lamps).
- `budget`: frame ms, triangles, single-file MB (defaults in the template). Modules share them.

Check it in node (no browser needed; `definePlan` throws listing every problem):
`node --input-type=module -e "import { definePlan } from '@mirage/world/plan'; import p from './plan.js'; console.log(definePlan(p).name)"`

## 3. Modules → `BRIEF.md` § Modules

Split by **what one agent can own end to end**, not by material: a module owns a footprint or a region and
everything in it. 3–8 modules for a small world. For each, write a module brief (template in the brief file):

- name (lower-case, one word), owns (plan fields / footprints), builds (one paragraph, with numbers),
- reads from the plan, anchors it offers (`key`: what `pos` is), anchors it consumes,
- collision notes (what is walkable, what blocks, open meshes needing proxies), budget share (triangles).

Order: ground / terrain first, structures next, dressing (props, vegetation, lamps) last; anything consuming
anchors in `finalize` can sit anywhere, but consumers last reads best.

## 4. Scaffold

`$SKILL_DIR` = the folder this file is in.

```bash
cp -R $SKILL_DIR/assets/skeleton $MIRAGE/examples/<name>   # package.json, index.html, vite.config.js, main.js,
                                                          # modules/index.js, NOTES.md, scenarios/playtest.json
cp $SKILL_DIR/references/plan-template.js $MIRAGE/examples/<name>/plan.js   # then fill it (step 2)
```

Then in the copy: replace `<name>` and `<one line>` everywhere (`grep -rn '<name>\|<one line>' .`), list the modules in `modules/index.js` (stub each one as
`export default { name: 'x', build() {} }` so the page runs before any module exists), add one `## <module>`
section header per module to `NOTES.md`. `cd $MIRAGE && npm install` once (links the workspace), then
`cd examples/<name> && npx vite build && npm run playtest` must pass on the empty world (the spawn step only).

Hand over: to **mirage-parallel-build** with BRIEF.md, plan.js and the stubs in place.
