---
name: mirage-parallel-build
description: Lead several agents building one Mirage world at the same time, one module each - the coordination contract (site plan as single source of truth, file ownership, anchors, append-only NOTES.md requests, merge order, conflict rules), how to launch workers in Claude Code (background sub-agents), Codex or Cursor, and how to integrate and verify. Use when a Mirage world has three or more modules to write, or the user says "build in parallel", "use sub-agents", "split the world", "fan out", "team of agents".
---

# Parallel build (lead)

The lead plans, launches, integrates and verifies; workers each write one module (mirage-module). It works
because nobody needs anybody else's code: positions come from `plan.js`, connections are anchors, and talk goes
through NOTES.md.

## 0. Before launching (lead)

- `BRIEF.md` with one module brief per module (mirage-brief-to-plan), `plan.js` complete for this round.
- Anchor contract fixed in the briefs: every key, who offers it, what `pos` is exactly, who consumes it.
- Lead files exist: `main.js`, `modules/index.js` listing every module, a stub `modules/<name>.js` per module
  (`export default { name: '<name>', build() {} }`), `modules/materials.js`, NOTES.md with a `## <name>` header
  per module, `scenarios/playtest.json`. `npx vite build && npm run playtest` passes on the stubs.

## 1. The contract (paste into every worker prompt: `references/worker-prompt.md`)

| rule | |
|---|---|
| ownership | a worker writes only `modules/<name>.js`, `scenarios/<name>.json`, its `## <name>` NOTES section; it may add module-only files `modules/<name>-*.js`. Everything else is read-only. |
| plan | single source of positions; only the lead edits `plan.js`. Need a number changed or added → NOTES request to **lead**; work on with a local constant marked `// TODO plan` until answered. |
| anchors | offer exactly what the brief says (extra fields allowed, meanings fixed); consume only in `finalize`, tolerate a missing key. |
| NOTES.md | re-read, then one small insertion in your own section (an Edit, never a whole-file rewrite: others write the same file). Append-only, dated, addressed requests. |
| space | build only inside what you own (footprints / regions); the owner of a footprint wins any overlap. |
| builds | own output: `npx vite build --outDir out/dist-<name> --emptyOutDir`; no dev servers. |
| done | `scenarios/<name>.json` passes (0 console errors) on `?modules=<producers>,<name>`; hand back the report path. |

## 2. Launch

One worker per module, all at once, each with the filled `references/worker-prompt.md`.

- **Claude Code**: one `Agent` call per module **in a single message** (they run concurrently, in the
  background); `subagent_type: general-purpose`; the same checkout (files are disjoint, so no worktree is
  needed — worktrees would also need their own `npm install`). Wait for the completion notices; do not poll.
- **Codex / Cursor / others**: start one session per module in the same checkout (Codex: one `codex exec` or
  cloud task each; Cursor: one background agent or chat each) with the same prompt. Install this skill pack in
  `.agents/skills` so each session finds mirage-module (INSTALL.md).
- **No sub-agents**: run the same prompts yourself one after another; the contract still keeps modules apart.

While they work the lead answers NOTES requests: decide, edit `plan.js`, write the answer with a date in the
`## lead` section ("plan.deck.y 2.0 → 2.1, requested by pier"), and tell the affected workers (Claude Code:
`SendMessage` to the running agent).

## 3. Integrate (lead)

1. Read every hand-back and its `out/playtest-<name>/report.md` + `sheet.png`. Reject "done" without them.
2. Merge order = build order: producers first. `modules/index.js` already lists them; check it.
3. Build the whole world and run `scenarios/playtest.json` (mirage-playtest): the route end to end, every
   region, one flicker walk, frame cost; plus `snap.mjs` for every viewpoint.
4. Conflicts, in this order of authority: the plan (lead) > the footprint owner > the anchor producer > the
   consumer. Overlapping geometry: the non-owner moves. A seam between two modules (a gap, a step > 0.4 m, a
   double surface): the plan gets the shared number, both owners read it.
5. Fix round: send each failure to its owner with the report row and the screenshot; tiny fixes the lead may do
   itself, noted in NOTES under `## lead` ("fixed in pier: …"). Rerun the whole-world playtest until it passes.
6. Record: per module triangles and build ms (`report.md` header / `built.report.modules`), requests answered.
