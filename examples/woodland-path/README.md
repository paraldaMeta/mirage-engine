# Woodland Path

A short trail turns between a meadow and a stand of broadleaf trees. Walk with WASD, drag to look, and use
keys 1–4 for the trail entrance, grass at ground level, a side-lit canopy and the turn around the first trunk.
The tree at x = 2.5, z = 0 is the collision reference in the walk scenario.

The ground module builds the path from `plan.paths.trail`. The verge module reads that same path to clear
the grass and imports both generators from `@mirage/world/kits/vegetation`. All foreground and background
trees are placed in the plan. The seed controls crown and grass placement. The low tier reduces leaf and grass
instances while retaining the same tree positions and solid trunk dimensions.

On the test machine, `npm run dev -w woodland-path` opens the Vite development server. For acceptance,
run the [first-batch handoff](../../docs/FIRST-BATCH.md). It covers both the served scene and the offline file
and records the four camera views, frame timings, draw calls and exact byte count.
