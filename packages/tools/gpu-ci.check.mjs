// Deferred checks for partial CI evidence and software-renderer rejection.
import assert from '../../scripts/soft-assert.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectEvidence } from './src/gpu-ci-evidence.mjs';
import { assertHardwareGpu } from './src/hardware-gpu.mjs';

for (const gpu of [null, '?', 'WebKit WebGL', 'ANGLE (SwiftShader)', 'llvmpipe (LLVM)', 'Microsoft Basic Render Driver']) {
  assert.throws(() => assertHardwareGpu(gpu));
}
assertHardwareGpu('ANGLE (Apple, Apple M3, OpenGL 4.1)');
assertHardwareGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-ci-evidence-'));
try {
  const partial = path.join(temporary, 'partial');
  const write = (root, relative, contents) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  };
  write(partial, 'ci.json', { commit: 'candidate', status: 'failed', code: 1 });
  write(partial, 'acceptance/summary.json', { commit: 'candidate', status: 'failed' });
  write(partial, 'acceptance/logs/e2e.log', 'scene failed');
  write(partial, 'acceptance/types/node_modules/private/data.txt', 'must stay on runner');
  write(partial, 'acceptance/types/nodenext.log', 'type diagnostics');
  write(partial, 'acceptance/workspace/examples/river-ford/out/playtest/report.json', {
    pass: false, gpu: 'real GPU', steps: [{ step: 'frame-cost', metrics: { frameMs: 12, calls: 80 } }],
  });
  write(partial, 'acceptance/workspace/examples/river-ford/out/playtest/failure.png', 'image fixture');
  const outside = path.join(temporary, 'host-secret.txt');
  fs.writeFileSync(outside, 'host data');
  fs.symlinkSync(outside, path.join(partial, 'acceptance/logs/linked.txt'));
  const { index, upload } = collectEvidence(partial);
  assert.equal(index.status, 'failed');
  assert.equal(index.screenshots.length, 1);
  assert.ok(index.files.some(file => file.path.endsWith('e2e.log') && file.sha256.length === 64));
  assert.ok(index.files.some(file => file.path.endsWith('nodenext.log')));
  assert.ok(!index.files.some(file => file.path.includes('node_modules') || file.path.endsWith('linked.txt')));
  assert.deepEqual(index.omitted, ['acceptance/logs/linked.txt']);
  const metrics = JSON.parse(fs.readFileSync(path.join(upload, 'PERFORMANCE.json'), 'utf8'));
  assert.equal(metrics.scenes[0].measurements[0].metrics.frameMs, 12);
  assert.equal(metrics.scenes[0].pass, false);

  const incomplete = path.join(temporary, 'incomplete');
  write(incomplete, 'ci.json', { commit: 'candidate', status: 'completed', code: 0 });
  write(incomplete, 'acceptance/summary.json', { commit: 'candidate', status: 'machine-pass-pending-review' });
  assert.equal(collectEvidence(incomplete).index.status, 'collection-failed');
  const wrongCommit = path.join(temporary, 'wrong-commit');
  write(wrongCommit, 'ci.json', { commit: 'one', status: 'completed', code: 0 });
  write(wrongCommit, 'acceptance/summary.json', { commit: 'two', status: 'machine-pass-pending-review' });
  assert.equal(collectEvidence(wrongCommit).index.status, 'incomplete');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('GPU CI preserves partial evidence and rejects software GPUs, absent evidence and mixed commits.');
