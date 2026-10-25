# Contributing to Mirage

Thanks for helping. Mirage is pre-alpha; small, tested changes are the easiest to take. These rules apply to every
change, human or agent.

1. **Read first**: `PLAN.md` §2 (licence and provenance), [docs/world-protocol.md](docs/world-protocol.md), the README
   of the package you touch, and the "open problems" in `docs/M*-notes.md`.
2. **No Golden Temple code.** Its techniques may inform yours; the code must be your own. Do not put any real,
   named place, regional material set or content from the author's earlier projects into the engine or the
   examples: examples stay neutral.
3. **As little code as works** (the "ponytail" rule): use what three.js already has, add no abstraction nothing uses
   yet. Where you simplify on purpose, leave a `// ponytail:` comment saying the limit and how to upgrade.
4. **Run the checks** before you send a change: `npm test` (every package and the skill validator), plus the
   playtest of every example your change can affect (`npm run playtest` in the example; garden-quest also has
   `npm run playthrough`). Image comparisons need real Chrome.
5. **Still frames are a hard requirement**: the same camera and frame number must render bit-identical frames
   (difference 0).
6. **One branch and one commit per task.** The commit message says what changed, what you tested and the numbers.
   Do not push to `main` and do not change the repository's visibility.
7. **Assets**: only CC0 or your own work, each with a row in [CREDITS.md](CREDITS.md) (source URL, author, licence).

Questions and known issues: [docs/CURSOR-TASKS.md](docs/CURSOR-TASKS.md).
