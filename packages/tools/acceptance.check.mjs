// Deferred CPU checks: missing evidence and nonzero pixels must never certify a run.
import assert from 'node:assert/strict';
import { checkE2E, checkStillFrames, discoverExamples } from './src/acceptance-evidence.mjs';
import { fileURLToPath } from 'node:url';

const names = discoverExamples(fileURLToPath(new URL('../../', import.meta.url)));
assert.ok(names.includes('woodland-path') && names.includes('river-ford'));
assert.ok(!names.includes('demos'), 'A demo folder without playtest is not a regression example');
const report = { failed: 0, rows: names.flatMap(example => {
  const steps = ['build', 'playtest dist', 'package', 'playtest file://'];
  if (example === 'garden-quest') steps.push('playthrough');
  return steps.map(step => ({ example, step, ok: true }));
}) };
checkE2E(report, names);
assert.throws(() => checkE2E({ failed: 0, rows: [] }, names));
for (const [example, step] of [['river-ford', 'playtest file://'], ['garden-quest', 'playthrough']]) {
  const missing = structuredClone(report);
  missing.rows = missing.rows.filter(r => r.example !== example || r.step !== step);
  assert.throws(() => checkE2E(missing, names), /missing or duplicate/);
}
const duplicate = structuredClone(report);
duplicate.rows.push(duplicate.rows[0]);
assert.throws(() => checkE2E(duplicate, names), /duplicate/);
const failed = structuredClone(report);
failed.rows[0].ok = false; // don't trust the top-level zero failure count
assert.throws(() => checkE2E(failed, names));

const still = { views: Object.fromEntries(['golden', 'noon', 'dusk-lanterns', 'night', 'golden-dof'].map(name =>
  [name, { sameFrameIndex: { max: 0, differing: 0 }, errors: [] }])) };
checkStillFrames(still);
for (const [key, value] of [['max', 1], ['differing', 1]]) {
  const changed = structuredClone(still);
  changed.views.night.sameFrameIndex[key] = value;
  assert.throws(() => checkStillFrames(changed), /Still pixels differ/);
}
const partial = structuredClone(still);
delete partial.views.noon;
assert.throws(() => checkStillFrames(partial), /Missing still view/);
const browserError = structuredClone(still);
browserError.views.golden.errors.push('pageerror: renderer failed');
assert.throws(() => checkStillFrames(browserError), /reported errors/);
console.log('Acceptance evidence rejects missing steps, duplicate rows, pixel differences and browser errors.');
