#!/usr/bin/env node
// Mirage original code. Proves the eval tasks are sound, with no model calls: for every task the broken start FAILS
// its machine check and shows the diagnostics the task expects (the checks fire), and the reference fix PASSES with
// none of them (the checks stay quiet). The base world (the control) must pass with no warnings at all.
//
// usage: node evals/check.mjs [task ...] [--verbose]      (the local Chrome, headless; ~10 s per world)
import path from 'node:path';
import { tasks, materialize, machineCheck, closeServer, WORK } from './lib.mjs';

const args = process.argv.slice(2), verbose = args.includes('--verbose');
const only = args.filter((a) => !a.startsWith('--'));
const bad = [], t0 = Date.now();
const show = (r) => r.report.diagnostics.filter((d) => d.severity !== 'info').map((d) => `      ${d.code} ${d.severity} ${d.target}: ${d.message}\n        fix: ${d.fix}`).join('\n');
try {
  if (!only.length) {
    const r = await machineCheck(null, materialize(null, 'base', path.join(WORK, 'check-base')));
    const loud = r.report.diagnostics.filter((d) => d.severity !== 'info');
    const ok = r.pass && !loud.length;
    console.log(`${ok ? 'ok  ' : 'FAIL'} base (control): ${r.pass ? 'passes' : 'fails: ' + r.why}${loud.length ? '; diagnostics: ' + loud.map((d) => d.code).join(', ') : ', quiet'}`);
    if (!ok) { bad.push('base'); console.log(show(r)); }
  }
  for (const task of tasks(only.length ? only : null)) {
    const start = await machineCheck(task, materialize(task, 'start', path.join(WORK, `check-${task.id}-start`)));
    const fix = await machineCheck(task, materialize(task, 'fix', path.join(WORK, `check-${task.id}-fix`)));
    const missing = task.expect.filter((c) => !start.codes.includes(c));
    const leftover = task.expect.filter((c) => fix.codes.includes(c));
    const problems = [];
    if (start.pass) problems.push('the broken start passes its check');
    if (missing.length) problems.push(`the start does not show ${missing.join(', ')}`);
    if (!fix.pass) problems.push(`the reference fix fails: ${fix.why}`);
    if (leftover.length) problems.push(`the fix still shows ${leftover.join(', ')}`);
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${task.id}: start fails (${start.why || 'passes!'}) with ${start.codes.join(', ') || 'no diagnostics'}; fix ${fix.pass ? 'passes' : 'FAILS'}${problems.length ? ' -- ' + problems.join('; ') : ''}`);
    if (problems.length || verbose) console.log('    start:\n' + show(start) + '\n    fix:\n' + (show(fix) || '      (none)'));
    if (problems.length) bad.push(task.id);
  }
} finally { closeServer(); }
console.log(`evals check: ${bad.length ? bad.length + ' failing (' + bad.join(', ') + ')' : 'all sound'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad.length ? 1 : 0);
