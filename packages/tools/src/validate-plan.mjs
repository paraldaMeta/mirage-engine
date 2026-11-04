#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { definePlan } from '@mirage/world/plan';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: mirage-validate-plan <plan.js | plan.mjs | plan.json>');
  process.exitCode = 2;
} else {
  const file = resolve(args[0]);
  try {
    let plan;
    switch (extname(file).toLowerCase()) {
      case '.json': plan = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); break;
      case '.js':
      case '.mjs': plan = (await import(pathToFileURL(file).href)).default; break;
      default: throw new Error('expected a .js, .mjs or .json plan');
    }
    const checked = definePlan(plan);
    console.log(file + ' — ' + checked.name + ' OK');
  } catch (error) {
    console.error(file + '\n' + error.message);
    process.exitCode = 1;
  }
}
