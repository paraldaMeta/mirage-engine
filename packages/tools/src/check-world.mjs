#!/usr/bin/env node
// Mirage original code. The world check: load a world once in the real Chrome and list every diagnostic the tools can
// find without a scenario: the plan (as mirage-validate-plan), modules that failed (the build report), the spawn and
// every viewpoint against the walk grid, floating objects, coplanar surfaces, what each viewpoint shows, the triangle
// budget, a black or blown-out frame at the spawn, console errors. Same shape as the playtest's report.json
// `diagnostics` (docs/diagnostics.md).
//
// usage: mirage-check <dist dir | page.html | http(s) url> [--json] [--query "mode=walk&ui=0"] [--w 960 --h 600] [--out dir]
//   exit 1 when any diagnostic is an error, 0 otherwise (warnings are listed)
import path from 'node:path';
import { playtest } from './playtest.mjs';
import { formatDiagnostic } from './diagnostics.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--json'));
if (!target) { console.error('usage: mirage-check <dist dir | page.html | http(s) url> [--json] [--query q] [--w 960 --h 600] [--out dir]'); process.exit(2); }
const sc = { title: 'world check', query: flag('query', 'mode=walk&ui=0&grain=0'), w: +flag('w', 960), h: +flag('h', 600), steps: [{ name: 'spawn', ms: 300 }] };
const report = await playtest(sc, target, { out: path.resolve(flag('out', 'out/check')), scenarioFile: 'world check', log: () => {} });
const list = report.diagnostics;
if (args.includes('--json')) console.log(JSON.stringify(list, null, 1));
else {
  for (const d of list) console.log(formatDiagnostic(d));
  console.log(`world check: ${['error', 'warning', 'info'].map((s) => list.filter((d) => d.severity === s).length + ' ' + s).join(', ')} (${report.url})`);
}
process.exit(list.some((d) => d.severity === 'error') ? 1 : 0);
