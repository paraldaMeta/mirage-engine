# Security

## Reporting

Report a vulnerability privately: on GitHub, **Security → Report a vulnerability** on
`paraldaMeta/mirage-engine` (private vulnerability reporting; the owner has to switch it on in the repository
settings, and at the time of writing it is off: until then, ask for a private contact in an issue without details). Please do not open a public issue for it. Say what
you ran, what you expected and what happened; a failing check or a small page is the best report. There is no
bounty and no promised response time: this is a small project, reports are read by the owner.

Supported: the latest 1.x on `main`. Earlier versions (0.x) get no fixes.

## What is in scope

Mirage runs other people's content in three places, and those are where a bug is a security bug:

| surface | what it does | what it must never do | check |
|---|---|---|---|
| the tools' static server (`serve()` in `packages/tools/src/chrome.mjs`, used by playtest, snap, e2e) | serves one folder to a local headless Chrome on 127.0.0.1 | serve a file outside that folder: `..`, encoded separators, absolute paths, or a symlink inside the folder that points out of it (the real path is compared, not the requested one) | `scripts/checks/serve.check.mjs` |
| the multiplayer server (`@mirage/net/server`) | relays messages and, with `dir`, serves a build | the same containment for `dir`; a client message is data, never code or a path | `scripts/checks/serve.check.mjs`, `packages/net/server.check.mjs` |
| the packager (`mirage-package`) | inlines a build, its workers included, into one HTML file | inline a file from outside the build: worker URLs are found by parsing the bundle (not a regular expression), only literal `new URL('...', import.meta.url)` inside `new Worker(...)` counts, and the resolved path must stay inside the build folder | `scripts/checks/embed-workers.check.mjs` |

Out of scope: a world module is code its author runs; a module that reads the network or the DOM is doing what
JavaScript does. Loading a glTF from an untrusted URL hands its bytes to three's loaders and decoders: keep
three up to date. The dev tools drive a local Chrome with a throwaway profile and are not a sandbox for hostile
pages.

## Supply chain

- Runtime dependencies: `three` (peer, pinned to 0.186 in the examples), `@dimforge/rapier3d-compat` in
  `@mirage/game`, and `puppeteer-core` and `vite` in `@mirage/tools` (the command-line tools, not shipped in a
  world). three is a peer range (0.186.x); the other three are pinned to exact versions. The linter, TypeScript and the type packages are root
  development dependencies and are in no tarball
  (`npm run test:pack` lists what each tarball would contain).
- `package-lock.json` is committed; CI installs with `npm ci`. Tests install nothing at run time.
- GitHub Actions are pinned to full commit SHAs and the workflow token is read-only
  (`scripts/checks/workflows.check.mjs` fails otherwise).
- Nothing is published on npm yet. The plan is to publish with npm provenance from CI, never from a laptop: [docs/releasing.md](docs/releasing.md).
- No install scripts: no package here has `preinstall` / `install` / `postinstall`.
