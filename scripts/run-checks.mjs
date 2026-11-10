#!/usr/bin/env node
// Mirage original code. Runs every scripts/checks/*.check.mjs (the repository-level Node checks: the test server, the
// packager's worker step, update subscriptions, the newcomer diagnostics, the check tooling itself), all of them,
// and exits 1 when any failed.   node scripts/run-checks.mjs [name-fragment]      (part of `npm test`)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'checks');
const only = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.check.mjs') && (!only || f.includes(only))).sort();
const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}
if (failed.length || !files.length) { console.error(`repository checks: ${failed.length} of ${files.length} FAILED (${failed.join(', ') || 'no check found'})`); process.exit(1); }
console.log(`repository checks: ok (${files.length} scripts)`);
