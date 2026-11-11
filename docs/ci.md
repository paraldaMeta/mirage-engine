# Continuous integration

Two workflows. `ci.yml` runs on GitHub's hosted runners on every push to `main` and every pull request;
`gpu-acceptance.yml` needs a runner with a GPU ([GPU-CI.md](GPU-CI.md)). Every action is pinned to a full commit
SHA and the token is read-only (`scripts/checks/workflows.check.mjs`).

**State of the evidence.** GitHub Actions cannot be run from a development machine. The YAML parses, and every
command of both hosted jobs was run locally on macOS with the same flags; the software-GL job has not yet run on
a hosted Linux runner. Its stills are compared with baselines drawn on macOS SwiftShader: SwiftShader is a CPU
rasteriser and the threshold is a region SSIM, not bits, but until the first hosted run that comparison is
unverified on Linux. If it fails there on stills alone, download the `software-gl` artifact, look at the sheets,
and commit the runner's own stills as the baselines (delete a file under `scripts/ci/baseline/` and the next run
writes it).

## Job `check` (ubuntu, macos)

| command | what it covers |
|---|---|
| `npm test` | every package's Node checks and the agent skill check; then `npm run test:static` (ESLint, export maps against every import, declarations against runtime exports with `tsc`, the docs index and links) and `npm run test:checks` (`scripts/checks/*.check.mjs`: server containment, the packager's worker scan, subscriptions, the newcomer diagnostics, the tooling's own negative tests, the workflows) |
| `npm run test:pack` | what each package would publish |
| `npm run build:examples` | every example builds |
| `node packages/tools/check.mjs` | the tools in headless Chrome, pages without WebGL |

Nothing is installed at test time: ESLint, TypeScript and the type packages are root development dependencies in
the lockfile, and `npm ci` is the only network step.

A check script reports every failed assertion with a count (`scripts/soft-assert.mjs`), not only the first:
`MIRAGE_ASSERT=hard` restores stop-at-first for a debugger.

## Job `software-gl` (ubuntu)

The job that draws frames. `MIRAGE_GL=software` makes the tools start Chrome with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` (`SOFTWARE_GL_ARGS` in
`packages/tools/src/chrome.mjs`); `scripts/ci/software-gl.mjs` then runs, at 480 x 300:

| part | what must hold |
|---|---|
| `playtest:hello-courtyard`, `playtest:snow-hut` | `scripts/ci/<example>.json`: the world loads with no errors, the walker walks its route and is stopped by walls, snow-hut's game loop reaches its goal (walk in, light the stove), a perf step runs |
| `determinism:hello-courtyard`, `determinism:snow-hut` | two views redrawn after another view and after a reload are bit-identical (same machine, same rasteriser) |
| stills | five 480 x 300 PNGs under `scripts/ci/baseline/` (174 to 229 kB each, 0.98 MB together), compared by region SSIM: three views in hello-courtyard's playtest, two in snow-hut's snap |

Why snow-hut's stills are compared in the snap and not in its playtest: the game keeps its own time for the
falling snow and the fire, so the same view after the same walk is a different picture each run (measured: mean
SSIM 0.79 between two runs, against a threshold of 0.92). `mirage-snap` draws the world without the game, where a
view is a function of the view alone.

Run it locally with the same commands as the job:

```sh
npm run build -w examples/hello-courtyard -w examples/snow-hut
npm run test:software-gl                              # all four parts
node scripts/ci/software-gl.mjs --only playtest:snow-hut
```

**Time is not gated here.** SwiftShader is many times slower than a GPU, so under `MIRAGE_GL=software` the
playtest prints `frameMs`, `p95Ms` and `fps` expectations as "not gated: software GL" and passes them. Frame cost
is the GPU job's question. On a GPU the perf step reports the median of three parts and their spread, and a spread
over 25 % is reported as a noisy machine rather than a slow world ([diagnostics.md](diagnostics.md), MG501).

## Coverage and the API report

`npm run coverage` runs `npm test` under V8's coverage (built into Node) and prints what the Node checks execute
of `packages/*/src`; `npm run stability` counts stable and experimental exports. Neither gates CI; the recorded
numbers and the promotion policy are in [STABILITY.md](STABILITY.md).
