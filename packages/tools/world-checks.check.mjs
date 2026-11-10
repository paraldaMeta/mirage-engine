// The load-time world checks stay quiet on the examples (the local headless Chrome; build them first:
// `npm run build -w <example>` or `npx vite build` in each). They fire on broken worlds in `node evals/check.mjs`.
// usage: node packages/tools/world-checks.check.mjs [example ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playtest } from './src/playtest.mjs';

const examples = fileURLToPath(new URL('../../examples/', import.meta.url));
const only = process.argv.slice(2);
const names = fs.readdirSync(examples).filter((e) => fs.existsSync(path.join(examples, e, 'plan.js')) && (!only.length || only.includes(e)));
const NEW = ['MG310', 'MG311', 'MG312', 'MG320', 'MG410', 'MG411', 'MG412', 'MG450', 'MG504', 'MG110', 'MG111', 'MG112'];
const bad = [];
let ran = 0;
for (const e of names) {
  const dist = path.join(examples, e, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.log(`  skip ${e} (not built)`); continue; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-world-checks-'));
  try {
    const r = await playtest({ title: 'world checks', query: 'mode=walk&ui=0&grain=0', w: 960, h: 600, steps: [{ name: 'spawn', ms: 300 }] }, dist, { out, log: () => {} });
    const loud = r.diagnostics.filter((d) => d.severity === 'error' || NEW.includes(d.code));
    if (!r.checks || !(r.checks.solids > 0)) bad.push(`${e}: the world checks did not run (${JSON.stringify(r.checks)})`);
    for (const d of loud) bad.push(`${e}: ${d.code} ${d.severity} ${d.target}: ${d.message}`);
    console.log(`  ${loud.length ? 'LOUD' : 'ok  '} ${e}: ${r.checks ? `${r.checks.solids} solids, ${r.checks.views} views, ${r.checks.ms} ms` : 'no checks'}; ${r.diagnostics.length} diagnostics${r.diagnostics.length ? ' (' + r.diagnostics.map((d) => d.code).join(', ') + ')' : ''}`);
    ran++;
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
}
if (!ran) bad.push('no example was built');
if (bad.length) { console.error('world checks:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`world checks: quiet on ${ran} examples`);
