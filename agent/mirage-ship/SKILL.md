---
name: mirage-ship
description: Package and prepare a Mirage world for release - one standalone HTML file that opens from disk, size budgets, a static deploy folder for any host, a playtest of the shipped file, and the credits / licence checklist. Never uploads or publishes; the user does that after an explicit OK. Use when the user says "ship it", "package", "single file", "make a build", "deploy", "put it online", "share a link", "release", or a world is finished and needs a deliverable.
---

# Ship

Shipping = a file or folder the user can open, check and publish **themselves**. You never upload, push, publish
or log in anywhere, and you never paste keys or tokens. If the user asks you to publish, prepare everything, print
the exact command, and wait for an explicit "yes, publish it" in chat — even then only run what they named.

## 1. Single file (the default deliverable)

```bash
cd $MIRAGE/examples/<world>
node ../../packages/tools/src/package.mjs .        # -> release/<world>.html  (prints size: inlined assets + code)
node ../../packages/tools/src/playtest.mjs scenarios/playtest.json release/<world>.html --out out/playtest-release
```

The shipped file must pass the same scenario as `dist/` (it runs from file://, no server, no network).

## 2. Budgets (check the packager's printout)

| | budget | typical |
|---|---|---|
| single file, code-only world | ≤ 5 MB | 0.8–1 MB code (three.js + Mirage) |
| + `@mirage/game` | ≤ 5 MB | + 2.24 MB (Rapier WASM, inlined) |
| + photo textures | say so in the README | ~1.3 MB per five 1K WebP sets |
| frame cost, walk, M-series | `plan.budget.frameMs` (8 ms) | 3–5 ms |
| load to playable (warm) | ≤ 3 s | 1–2 s; a first load compiles shaders (5–8 s) |

Over budget: drop texture sets first, then lower lathe / terrain resolution, then split the world.

## 3. Deploy folder (optional)

```bash
node ../../packages/tools/src/deploy.mjs . --out deploy/<world>     # single file as index.html; --multi: Vite dist
```

It writes `index.html`, `.nojekyll`, `_headers`, checks references and prints how to publish with GitHub Pages,
Netlify, Cloudflare Pages or any static server. **It uploads nothing.** Hand the folder path and those commands to
the user.

## 4. Checklist before handing over

- [ ] Playtest of the shipped file passes, 0 console errors; contact sheet looked at.
- [ ] `CREDITS.md` (repo root) lists every asset that is not code: source URL, author, licence (CC0 or own
      work only). Code-only worlds add nothing.
- [ ] Licences of what is bundled: three.js (MIT), Mirage (MIT, `NOTICE` keeps the Golden Temple credit),
      Rapier (Apache-2.0) if the game layer is in.
- [ ] No real named places, brands, copyrighted characters or designs; no personal data; no keys or tokens in
      any file.
- [ ] `release/` and `deploy/` are build output (git-ignored): do not commit them unless the user asks.
- [ ] Tell the user: the file path, its size (code / assets), frame cost, the playtest verdict, and how to
      publish it themselves.
