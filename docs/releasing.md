# Releasing

The checklist for a release of the `@miragekit/*` packages. 1.0.0 is tagged (`v1.0.0`, a GitHub release, 2026-11-11) and **not
published to npm**. The packages are named `@miragekit/*` (`@mirage` and `@mirage-engine` belong to others on npm); sections
2 to 4 have not been run yet. Every step that leaves this machine
(push, tag, publish, visibility) is the owner's, by hand or by approving the workflow; agents stop before it.
The historic first-release notes are in [RELEASE.md](RELEASE.md).

## 1. Before the tag

- [ ] `main` is green: `npm ci && npm test && npm run test:pack && npm run build:examples` (hosted CI runs the
      same, plus the software-GL job: [ci.md](ci.md)).
- [ ] On a machine with a GPU: `npm run test:e2e` and `npm run acceptance` ([ACCEPTANCE.md](ACCEPTANCE.md)); look
      at the contact sheets, not only the report.
- [ ] `npm run coverage` and `npm run stability -- --write`: update the numbers in [STABILITY.md](STABILITY.md) if
      they moved. A name that left *stable*, or a subpath that left an `exports` map, makes this a major release.
- [ ] One version everywhere (`npm run test:pack` checks the root, the seven packages and their peer ranges).
- [ ] CHANGELOG: the top section has the version and the date, with **New**, **Changes in behaviour**, **Fixes**.
- [ ] `npm audit --omit=dev` is clean, or every finding is written down with why it does not apply.
- [ ] No secrets and nothing local: `git grep -i -E 'token|secret|api[_-]?key'`, and no evals, results or research
      notes in the tree.

## 2. What would be published

`npm run test:pack` checks, per package, the files `npm pack` would put in the tarball and fails when a file an
export map points at is missing. To look at a tarball's contents without publishing:
`npm pack -w packages/core --dry-run`. Publishing order follows the peer dependencies: core, world, play, game,
net, editor, tools.

## 3. Publish with provenance

Publish from GitHub Actions, not from a laptop, so every tarball carries an npm provenance statement: a signed
link from the package version to the commit and the workflow run that built it. npm shows it on the package page
and `npm audit signatures` verifies it. It needs a public repository, a GitHub-hosted runner, and either npm
trusted publishing for the package (no token at all) or an `NPM_TOKEN` secret limited to publishing `@miragekit/*`.

The job is [`.github/workflows/release.yml`](../.github/workflows/release.yml). It runs when a GitHub release is
published (the tag must equal the packages' version), or by hand from the Actions tab as a dry run (`npm publish
--dry-run`, the default). It waits in the protected `npm` environment for the owner's approval, runs `npm test` and
`npm run test:pack`, then publishes the seven packages in peer-dependency order with `--provenance`.

What the owner sets up once (none of it can be done from the repository):
- [ ] On npmjs.com, create the organisation `miragekit` (free for public packages).
- [ ] In the GitHub repository settings, create the environment `npm` with yourself as required reviewer.
- [ ] First publish: npm can only link a trusted publisher to a package that exists, so add an `NPM_TOKEN` secret to
      the `npm` environment (a granular token: publish, `@miragekit` only, short expiry) and publish 1.0.x.
- [ ] Then, for each of the seven packages on npmjs.com: Settings -> Trusted publishing -> GitHub Actions,
      repository `paraldaMeta/mirage-engine`, workflow `release.yml`, environment `npm`; delete the token.


`scripts/checks/workflows.check.mjs` reports any job that asks for a write scope, so adding this file means
allowing exactly `id-token: write` there in the same commit, where a reviewer sees it.

- [ ] Tag `vX.Y.Z` on the commit CI passed on; create the GitHub release from the CHANGELOG section.
- [ ] Approve the `npm` environment; the job publishes.

## 4. After

- [ ] `npm view @miragekit/core@X.Y.Z dist.attestations` shows a provenance entry; in an empty folder,
      `npm i @miragekit/core three && npm audit signatures` passes.
- [ ] A world made from the published packages builds: copy the skeleton outside the repository, `npm i`,
      `npm run build`, `npm run playtest` ([making-a-world.md](making-a-world.md)).
- [ ] If something is wrong: `npm deprecate` the version with a message and publish a patch. Do not unpublish.
