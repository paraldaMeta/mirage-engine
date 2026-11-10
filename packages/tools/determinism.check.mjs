// Mirage original code. Browser check (`npm run test:determinism` at the root, after `npm run build:examples`): every
// example's dist build draws each plan viewpoint as a still (grain 0, frameIndex 1), again after another view, and
// again after a reload; all three must be bit-identical (mirage-snap --determinism, MG461). Exit 1 on any difference.
//   node packages/tools/determinism.check.mjs [examples/<name>/dist ...] [--views 0,1]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const args = process.argv.slice(2), views = args.includes('--views') ? ['--views', args[args.indexOf('--views') + 1]] : [];
let dirs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--views');
if (!dirs.length) dirs = fs.readdirSync(path.join(root, 'examples')).map((n) => path.join(root, 'examples', n, 'dist')).filter((d) => fs.existsSync(path.join(d, 'index.html')));
const rows = [];
for (const dir of dirs) {
  const name = path.basename(path.dirname(path.resolve(dir))), out = path.join(root, 'out/determinism', name), t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, 'src/snap.mjs'), dir, '--determinism', '--out', out, ...views], { encoding: 'utf8' });
  let rep = null;
  try { rep = JSON.parse(fs.readFileSync(path.join(out, 'snap.json'), 'utf8')); } catch { /* the run failed before writing it */ }
  const det = rep?.determinism || [], bad = det.filter((d) => !d.same);
  rows.push({ name, ok: r.status === 0 && det.length > 0 && !bad.length, views: rep?.views.length ?? 0, checked: det.length, bad: bad.map((d) => `${d.name} ${d.phase}: ${d.differing} px, max ${d.max}`), s: +((Date.now() - t0) / 1000).toFixed(1) });
  if (r.status !== 0 && !det.length) rows.at(-1).bad.push((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | '));
  console.log(`${rows.at(-1).ok ? 'ok  ' : 'FAIL'} ${name.padEnd(16)} ${rows.at(-1).views} views, ${det.length} redraws, ${rows.at(-1).s} s${bad.length ? '\n     ' + rows.at(-1).bad.join('\n     ') : ''}`);
}
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `determinism: ${failed.length} of ${rows.length} examples differ` : `determinism: ${rows.length} examples bit-identical`);
process.exit(failed.length ? 1 : 0);
