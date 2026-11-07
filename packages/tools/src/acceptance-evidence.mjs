// Mirage original code. Read completed evidence; importing this module never launches a check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertHardwareGpu } from './hardware-gpu.mjs';

export function discoverExamples(root) {
  const dir = path.join(root, 'examples');
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).filter(name => {
    const file = path.join(dir, name, 'package.json');
    return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).scripts?.playtest;
  }).sort();
  assert.ok(names.length, 'No examples with a playtest script');
  return names;
}

export function checkStillFrames(report) {
  const views = ['golden', 'noon', 'dusk-lanterns', 'night', 'golden-dof'];
  for (const name of views) {
    const v = report.views?.[name];
    assert.ok(v, 'Missing still view: ' + name);
    assert.deepEqual(v.sameFrameIndex, { max: 0, differing: 0 }, 'Still pixels differ: ' + name);
    assert.deepEqual(v.errors, [], 'Still view reported errors: ' + name);
  }
  return views;
}

export function checkE2E(report, names) {
  assert.ok(names.length, 'Empty example list');
  assert.equal(report.failed, 0, 'E2E reported failures');
  assert.ok(Array.isArray(report.rows) && report.rows.length, 'Missing E2E rows');
  for (const row of report.rows) assert.equal(row.ok, true, `${row.example}: ${row.step}`);
  for (const name of names) {
    const steps = ['build', 'playtest dist', 'package', 'playtest file://'];
    if (name === 'garden-quest') steps.push('playthrough');
    for (const step of steps) {
      assert.equal(report.rows.filter(r => r.example === name && r.step === step).length, 1, `${name}: missing or duplicate ${step}`);
    }
  }
}

export function auditEvidence(root, names) {
  const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const nonempty = p => assert.ok(fs.statSync(path.join(root, p)).size > 0, 'Empty evidence: ' + p);
  checkE2E(read('out/e2e/summary.json'), names);
  const lifecycle = read('examples/garden-quest/out/playthrough/report.json').parts?.lifecycle;
  assert.ok(Array.isArray(lifecycle) && lifecycle.length === 3, 'Missing game remount evidence');
  for (const [i, sample] of lifecycle.entries()) {
    assert.equal(sample.cycle, i);
    assert.equal(sample.audio, i === 1 ? 'locked' : 'closed');
    assert.ok(Number.isInteger(sample.geometries) && Number.isInteger(sample.textures), 'Missing renderer memory counters');
  }
  const examples = [];
  for (const name of names) {
    const base = 'examples/' + name;
    const bytes = fs.statSync(path.join(root, base, 'release', name + '.html')).size;
    assert.ok(bytes > 0 && bytes <= 5_000_000, `${name}: single file is ${bytes} bytes (limit 5,000,000)`);
    const targets = [];
    for (const [dir, protocol] of [['out/playtest', 'http:'], ['out/playtest-file', 'file:']]) {
      const r = read(base + '/' + dir + '/report.json');
      assert.equal(r.pass, true, `${name}: ${dir} did not pass`);
      assert.equal(new URL(r.url).protocol, protocol);
      assert.ok(r.steps?.length && r.steps.every(s => s.pass === true), `${name}: missing or failed scenario steps`);
      assert.deepEqual(r.errors, [], `${name}: browser errors`);
      assert.deepEqual(r.build?.failed, [], `${name}: failed modules`);
      assertHardwareGpu(r.gpu);
      nonempty(base + '/' + dir + '/sheet.png');
      targets.push({ protocol, gpu: r.gpu, report: base + '/' + dir + '/report.json' });
    }
    examples.push({ name, bytes, targets });
  }
  const stillViews = checkStillFrames(read('examples/hello-courtyard/out/verify/report.json'));
  for (const name of stillViews) nonempty('examples/hello-courtyard/out/verify/' + name + '.png');
  const scenes = {};
  for (const name of ['woodland-path', 'river-ford']) {
    const r = read('examples/' + name + '/out/acceptance.json');
    assert.equal(r.pass, true, name + ': metrics did not pass');
    assert.equal(r.targets?.length, 2, name + ': both targets required');
    scenes[name] = r;
  }
  const character = {};
  for (const target of ['http', 'file']) {
    const base = 'examples/river-ford/out/character-' + target;
    const r = read(base + '/report.json');
    assert.deepEqual(r.errors, []);
    assert.equal(r.shots?.length, 8, 'Eight character poses required');
    for (const s of r.shots) { assert.equal(s.pass, true); nonempty(base + '/' + s.name + '.png'); }
    character[target] = { report: base + '/report.json', model: r.model, timing: r.timing };
  }
  return { examples, stillViews, scenes, character };
}
