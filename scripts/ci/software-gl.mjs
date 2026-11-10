#!/usr/bin/env node
// Mirage original code. The hosted CI job that draws frames: headless Chrome with SwiftShader (MIRAGE_GL=software,
// see packages/tools/src/chrome.mjs), so a runner without a GPU still loads two worlds, walks them and compares stills.
//   npm run build -w examples/hello-courtyard -w examples/snow-hut && node scripts/ci/software-gl.mjs
//   node scripts/ci/software-gl.mjs --only playtest:snow-hut      one part (names are printed by a run)
// What it runs (each a child process; all of them run, the exit code is 1 when any failed):
//   playtest:<example>      scripts/ci/<example>.json at 480 x 300: walking, collision, the game loop, one perf step
//   determinism:<example>   mirage-snap --determinism on two views: redrawn after another view and after a reload,
//                           bit-identical (the same machine and rasteriser, so bits are a fair test here)
//   stills                  compared by region SSIM with scripts/ci/baseline/<example>/ (committed, drawn by this
//                           script on SwiftShader; a missing file is written, so delete one to refresh it): three in
//                           hello-courtyard's playtest, two in snow-hut's snap (SNAP_BASELINE below says why)
// What it does NOT gate: time. SwiftShader is 20-100 x slower than a GPU, so frameMs / p95Ms / fps expectations are
// printed as "not gated: software GL" (playtest.mjs) and the perf step is 3 runs of 12 frames, only to prove it runs.
// The GPU job (docs/GPU-CI.md) stays the place for timing, the full scenarios and the full-size stills.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const tools = path.join(root, 'packages/tools/src'), out = path.join(root, 'out/ci');
const EXAMPLES = ['hello-courtyard', 'snow-hut'];
// where the stills are compared: in the playtest when the page's pictures depend only on the view (the scene clock
// restarts at a viewpoint); in the snap when a game keeps its own time (snow-hut's snow and fire: measured, the same
// view after the same walk scored mean SSIM 0.79 between two runs), since mirage-snap draws the world without the game
const SNAP_BASELINE = ['snow-hut'];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const env = { ...process.env, MIRAGE_GL: 'software' };

const parts = [];
for (const ex of EXAMPLES) {
  const dist = path.join(root, 'examples', ex, 'dist');
  parts.push({ name: `playtest:${ex}`, dist, args: [path.join(tools, 'playtest.mjs'), path.join(here, ex + '.json'), dist, '--out', path.join(out, 'playtest-' + ex)] });
  parts.push({ name: `determinism:${ex}`, dist, args: [path.join(tools, 'snap.mjs'), dist, '--determinism', '--views', '0,2', '--w', '480', '--h', '300', '--spp', '4', '--out', path.join(out, 'determinism-' + ex), ...(SNAP_BASELINE.includes(ex) ? ['--baseline', path.join(here, 'baseline', ex)] : [])] });
}
const rows = [];
for (const p of parts) {
  if (only && p.name !== only) continue;
  if (!fs.existsSync(path.join(p.dist, 'index.html'))) { rows.push({ name: p.name, ok: false, s: 0, why: `${path.relative(root, p.dist)} is not built (npm run build -w examples/${path.basename(path.dirname(p.dist))})` }); continue; }
  const t0 = Date.now(), r = spawnSync(process.execPath, p.args, { env, encoding: 'utf8', maxBuffer: 64 << 20 });
  const text = (r.stdout || '') + (r.stderr || '');
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, p.name.replace(':', '-') + '.log'), text);
  rows.push({ name: p.name, ok: r.status === 0, s: +((Date.now() - t0) / 1000).toFixed(1), why: r.status === 0 ? '' : text.trim().split('\n').slice(-12).join('\n     ') });
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${p.name.padEnd(28)} ${rows.at(-1).s} s${rows.at(-1).why ? '\n     ' + rows.at(-1).why : ''}`);
}
for (const r of rows.filter((x) => !x.s && !x.ok)) console.log(`FAIL ${r.name.padEnd(28)} ${r.why}`);
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `software GL: ${failed.length} of ${rows.length} parts failed (logs and images in out/ci)` : `software GL: ${rows.length} parts ok in ${rows.reduce((s, r) => s + r.s, 0).toFixed(0)} s`);
process.exit(failed.length || !rows.length ? 1 : 0);
