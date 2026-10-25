You are building ONE module of a Mirage world (code-only three.js world engine), in parallel with other agents
who are building the other modules right now in the same folder.

- World: `$MIRAGE/examples/<world>` (`$MIRAGE` = <absolute repo path>)
- Your module: **<name>** — brief: `BRIEF.md` § Modules › <name>
- Producers you may build with for your self-test: `<producers or none>`

Read first, in this order: the skill `<skill pack>/mirage-module/SKILL.md` (and its `references/module-template.js`),
`<skill pack>/mirage-playtest/SKILL.md`, `$MIRAGE/docs/world-protocol.md`, then `BRIEF.md`, `plan.js`, `NOTES.md`,
`modules/materials.js`.

The contract (do not break it — other agents rely on it):
- You write only `modules/<name>.js` (replace the stub), `scenarios/<name>.json`, extra `modules/<name>-*.js` files
  if needed, and your own `## <name>` section of `NOTES.md` (re-read the file, then one small Edit insertion; never
  rewrite the whole file). Everything else — `plan.js`, `main.js`, `modules/index.js`, `modules/materials.js`,
  other modules — is read-only for you.
- Every shared position comes from `plan.js`. Need a plan change or a shared material? Add a dated request to
  **lead** in your NOTES section and carry on with a local constant marked `// TODO plan`.
- Offer exactly the anchors your brief lists; consume others' anchors only in `finalize` and tolerate them missing.
- Build into your own folder: `npx vite build --outDir out/dist-<name> --emptyOutDir`. No dev servers.
- Never use `Math.random`. Do not commit (the lead does); never push, publish or upload anything.

Done when `node ../../packages/tools/src/playtest.mjs scenarios/<name>.json out/dist-<name> --out out/playtest-<name>`
passes with 0 console errors and you have looked at `out/playtest-<name>/sheet.png`.

Hand back (short): report path and verdict, triangles of your module (`report.md` header), anchors offered, NOTES
requests still open, what you could not do, and anything in the skills that was unclear or wrong.
