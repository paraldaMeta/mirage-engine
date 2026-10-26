#!/usr/bin/env node
// Mirage original code. Every example end to end, one command (`npm run test:e2e` at the root): build, the
// playtest of dist/, the single file, the playtest of the single file from file://, and each example's own extra
// scripts (garden-quest's playthrough). Steps run in sequence (they share the GPU); a failing step does not stop
// the rest. Writes out/e2e/summary.json and prints a table; exit 1 if any step failed.
//
// usage: mirage-e2e [--only hello-courtyard,snow-hut] [--no-file]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const TOOLS = path.join(ROOT, 'packages/tools/src');
const EXTRA = { 'garden-quest': [['playthrough', ['scripts/playthrough.mjs', 'dist']]] };

const examples = fs.readdirSync(path.join(ROOT, 'examples')).filter((n) => {
  const p = path.join(ROOT, 'examples', n, 'package.json');
  return fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8')).scripts?.playtest && (!only || only.includes(n));
});
if (only) for (const n of only) if (!examples.includes(n)) { console.error(`e2e: no example "${n}" with a playtest script`); process.exit(2); }

const rows = [];
function run(example, step, cmd, argv, cwd) {
  console.log(`\n[e2e] ${example}: ${step}`);
  const t0 = Date.now(), r = spawnSync(cmd, argv, { cwd, stdio: 'inherit' });
  const row = { example, step, ok: r.status === 0, code: r.status ?? r.signal, s: +((Date.now() - t0) / 1000).toFixed(1) };
  rows.push(row);
  return row.ok;
}
for (const name of examples) {
  const dir = path.join(ROOT, 'examples', name);
  const scenario = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts.playtest.split(/\s+/).find((a) => a.endsWith('.json'));
  if (!run(name, 'build', process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], dir)) continue;
  run(name, 'playtest dist', process.execPath, [path.join(TOOLS, 'playtest.mjs'), scenario, 'dist', '--out', 'out/playtest'], dir);
  for (const [step, argv] of EXTRA[name] || []) run(name, step, process.execPath, argv, dir);
  if (args.includes('--no-file')) continue;
  const file = path.join('release', name + '.html');
  if (run(name, 'package', process.execPath, [path.join(TOOLS, 'package.mjs'), '.', '--out', file], dir)) {
    run(name, 'playtest file://', process.execPath, [path.join(TOOLS, 'playtest.mjs'), scenario, file, '--out', 'out/playtest-file'], dir);
  }
}

const failed = rows.filter((r) => !r.ok);
fs.mkdirSync(path.join(ROOT, 'out/e2e'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out/e2e/summary.json'), JSON.stringify({ at: new Date().toISOString(), failed: failed.length, rows }, null, 1));
console.log('\n[e2e] summary');
for (const r of rows) console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.example.padEnd(16)} ${r.step.padEnd(17)} ${String(r.s).padStart(6)} s${r.ok ? '' : '  (exit ' + r.code + ')'}`);
console.log(`[e2e] ${rows.length - failed.length} / ${rows.length} steps pass -> out/e2e/summary.json`);
process.exit(failed.length ? 1 : 0);
