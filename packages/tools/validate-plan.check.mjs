// Deferred CLI acceptance: exercise installed package exports, real JS imports, JSON and aggregate diagnostics.
import assert from '../../scripts/soft-assert.mjs';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import schema from '@mirage/world/plan.schema.json' with { type: 'json' };
import { definePlan } from '@mirage/world/plan';

const cli = fileURLToPath(new URL('./src/validate-plan.mjs', import.meta.url));
const examples = fileURLToPath(new URL('../../examples/', import.meta.url));
const run = (...files) => spawnSync(process.execPath, [cli, ...files], { encoding: 'utf8' });
const tmp = mkdtempSync(join(tmpdir(), 'mirage-plan-'));
try {
  assert.ok(schema.properties.bounds);
  const plans = readdirSync(examples, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(examples, e.name, 'package.json')));
  for (const entry of plans) {
    const result = run(join(examples, entry.name, 'plan.js'));
    assert.equal(result.status, 0, result.stderr);
  }
  const file = join(tmp, 'world with spaces.json');
  const valid = { name: 'fixture', bounds: [-2, -3, 2, 3], custom: { any: true } };
  writeFileSync(file, JSON.stringify(valid));
  assert.equal(run(file).status, 0);
  const invalid = {
    ...valid, bounds: [2, -3, -2, 3], walk: { yMin: 10, yMax: 5 },
    footprints: { tree: { circle: [1, 2, 0] } }, regions: { bad: {} },
    paths: { trail: { points: [[0, 0], [2, 'x']] } },
    viewpoints: [{ eye: [1, 2], look: ['x', 1, 0] }, null],
  };
  writeFileSync(file, JSON.stringify(invalid));
  const result = run(file);
  assert.equal(result.status, 1);
  let diagnostic;
  assert.throws(() => definePlan(invalid), error => { diagnostic = error.message; return true; });
  assert.ok(result.stderr.includes(diagnostic));
  for (const path of ['bounds[2]', 'walk.yMax', 'footprints.tree.circle[2]', 'regions.bad',
    'paths.trail.points[1][1]', 'viewpoints[0].eye', 'viewpoints[0].look[0]', 'viewpoints[1]']) {
    assert.ok(diagnostic.includes(path), path);
  }
  writeFileSync(file, '{');
  assert.equal(run(file).status, 1);
  assert.equal(run().status, 2);
  console.log('Plan CLI accepted ' + plans.length + ' example layouts and reported all invalid fixture fields.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
