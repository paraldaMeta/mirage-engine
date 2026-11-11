#!/usr/bin/env node
// Checks a site plan without a browser: the schema (definePlan's message, unchanged) and then the same problems as
// diagnostics { code, severity, target, message, fix } (docs/diagnostics.md), plus the plan-only checks of where the
// spawn and the views are (MG110-MG112).
// usage: mirage-validate-plan <plan.js | plan.mjs | plan.json> [--json]
//   --json: print only the diagnostics, as a JSON array, on stdout. Exit 1 on any error diagnostic, 2 on bad usage.
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { definePlan } from '@miragekit/world/plan';
import { planIssues } from '@miragekit/world/plan-validation';
import { diag, fromPlanIssues, lintPlan, formatDiagnostic } from './diagnostics.mjs';

const json = process.argv.includes('--json');
const args = process.argv.slice(2).filter((a) => a !== '--json');
if (args.length !== 1) {
  console.error('Usage: mirage-validate-plan <plan.js | plan.mjs | plan.json> [--json]');
  process.exitCode = 2;
} else {
  const file = resolve(args[0]);
  let plan, diagnostics = [], message = null;
  try {
    switch (extname(file).toLowerCase()) {
      case '.json': plan = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')); break;
      case '.js':
      case '.mjs': plan = (await import(pathToFileURL(file).href)).default; break;
      default: throw new Error('expected a .js, .mjs or .json plan');
    }
  } catch (error) {
    diagnostics.push(diag('MG100', { target: file, message: `${file}: ${error.message}` }));
    message = error.message;
  }
  if (!message) {
    diagnostics = fromPlanIssues(planIssues(plan));
    try { definePlan(plan); } catch (error) { message = error.message; }
    if (!diagnostics.length) diagnostics = lintPlan(plan);
  }
  const failed = diagnostics.some((d) => d.severity === 'error');
  if (json) console.log(JSON.stringify(diagnostics, null, 1));
  else if (message) console.error(file + '\n' + message + '\n\n' + diagnostics.map(formatDiagnostic).join('\n'));
  else {
    console.log(file + ' — ' + plan.name + ' OK');
    for (const d of diagnostics) console.log(formatDiagnostic(d));
  }
  process.exitCode = failed || message ? 1 : 0;
}
