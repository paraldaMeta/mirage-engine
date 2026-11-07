#!/usr/bin/env node
// Mirage original code. Explicit test-machine run only. No imports from browser tooling until child steps run.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditEvidence, discoverExamples } from './acceptance-evidence.mjs';

const usage = 'Test machine only: node packages/tools/src/acceptance.mjs --run --machine <filled.json> --out <new-directory>';
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) { console.log(usage); process.exit(0); }
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!['--run', '--machine', '--out'].includes(key) || Object.hasOwn(options, key)) throw new Error(usage);
  options[key] = key === '--run' ? true : args[++i];
  if (!options[key] || (typeof options[key] === 'string' && options[key].startsWith('--'))) throw new Error(usage);
}
if (!options['--run'] || !options['--machine'] || !options['--out']) throw new Error(usage);
if (!['darwin', 'linux'].includes(process.platform)) throw new Error('This runner uses POSIX process groups; use macOS or Linux.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 12) throw new Error('Use Node 22.12+ in the 22.x line for comparable acceptance runs.');
if (process.env.MIRAGE_BROWSER || process.env.ONLY || process.env.NODE_OPTIONS) {
  throw new Error('Unset MIRAGE_BROWSER, ONLY and NODE_OPTIONS for the complete Chrome run.');
}
const machine = JSON.parse(fs.readFileSync(path.resolve(options['--machine']), 'utf8'));
for (const key of ['label', 'model', 'cpu', 'gpu', 'os', 'powerMode']) {
  if (typeof machine[key] !== 'string' || !machine[key].trim()) throw new Error('Fill machine.' + key);
}
for (const key of ['memoryGB', 'displayHz']) {
  if (!Number.isFinite(machine[key]) || machine[key] <= 0) throw new Error('Fill machine.' + key);
}
const root = fileURLToPath(new URL('../../../', import.meta.url));
const git = (...argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit source changes before acceptance; the snapshot uses HEAD.');
const commit = git('rev-parse', 'HEAD');
// Resolve the existing parent so a symlink cannot place evidence inside the source checkout.
const requested = path.resolve(options['--out']);
const out = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
const source = fs.realpathSync(root);
if (out === source || out.startsWith(source + path.sep)) throw new Error('Keep acceptance evidence outside the source checkout.');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!path.isAbsolute(chrome)) throw new Error('CHROME must be an absolute path.');
fs.accessSync(chrome, fs.constants.X_OK);
fs.mkdirSync(out); // no overwrite, no automatic resume, no deletion of older results
fs.mkdirSync(path.join(out, 'logs'));
const workspace = path.join(out, 'workspace');
const childEnv = { ...process.env, CHROME: chrome };
// An outer `npm run acceptance` must not point nested npm commands back at the source checkout.
for (const key of Object.keys(childEnv)) {
  if (/^npm_(package_|lifecycle_)/.test(key) || ['npm_config_local_prefix', 'INIT_CWD'].includes(key)) delete childEnv[key];
}
const result = { schemaVersion: 1, status: 'running', releaseReady: false, commit, started: new Date().toISOString(),
  machine, host: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version },
  steps: [], pending: ['visual-review', 'real-phone', 'integrated-gpu', 'browser-matrix', 'A1', 'GPU-CI', 'API-types-packaging'] };
const save = () => {
  fs.writeFileSync(path.join(out, 'summary.json.tmp'), JSON.stringify(result, null, 2) + '\n');
  fs.renameSync(path.join(out, 'summary.json.tmp'), path.join(out, 'summary.json'));
};
save();
let active, interrupted, stopTimer;
const groupSignal = (pid, signal) => {
  try { process.kill(-pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
};
const interrupt = signal => {
  interrupted = signal;
  if (active?.pid) {
    groupSignal(active.pid, 'SIGTERM');
    if (!stopTimer) stopTimer = setTimeout(() => { if (active?.pid) groupSignal(active.pid, 'SIGKILL'); }, 3000);
  }
};
const onSigint = () => interrupt('SIGINT'), onSigterm = () => interrupt('SIGTERM');
process.on('SIGINT', onSigint); process.on('SIGTERM', onSigterm);
async function run(id, command, argv, { cwd = workspace, minutes = 30 } = {}) {
  if (interrupted) throw new Error('Interrupted: ' + interrupted);
  const row = { id, command, args: argv, cwd: path.relative(out, cwd), started: new Date().toISOString(), status: 'running', log: 'logs/' + id + '.log' };
  result.steps.push(row); save();
  console.log('[acceptance] ' + id + ' → ' + row.log);
  const fd = fs.openSync(path.join(out, row.log), 'wx');
  const start = Date.now();
  let timedOut = false, timer;
  try {
    const child = spawn(command, argv, { cwd, detached: true, stdio: ['ignore', fd, fd], env: childEnv });
    active = child;
    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) groupSignal(child.pid, 'SIGTERM');
      stopTimer = setTimeout(() => { if (child.pid) groupSignal(child.pid, 'SIGKILL'); }, 3000);
    }, minutes * 60_000);
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    Object.assign(row, exit);
    if (timedOut || interrupted || exit.code !== 0) throw new Error(`${id}: ${timedOut ? 'timeout' : interrupted || 'exit ' + exit.code + ' / ' + exit.signal}`);
    row.status = 'passed';
  } catch (e) { row.status = interrupted ? 'interrupted' : 'failed'; row.error = e.message; throw e; }
  finally {
    clearTimeout(timer); clearTimeout(stopTimer); stopTimer = undefined;
    // The group belongs to this step, including Vite / Chrome descendants. Never overlap it with the next step.
    if (active?.pid) groupSignal(active.pid, 'SIGKILL');
    active = undefined; fs.closeSync(fd);
    row.seconds = +((Date.now() - start) / 1000).toFixed(1); save();
  }
}
const node = (id, script, args = [], opts) => run(id, process.execPath, [script, ...args], opts);
try {
  await run('npm-version', 'npm', ['--version'], { cwd: root });
  await run('chrome-version', chrome, ['--version'], { cwd: root });
  result.host.npm = fs.readFileSync(path.join(out, 'logs/npm-version.log'), 'utf8').trim();
  result.host.chrome = fs.readFileSync(path.join(out, 'logs/chrome-version.log'), 'utf8').trim();
  const archive = path.join(out, 'source.tar');
  await run('archive', 'git', ['archive', '--format=tar', '-o', archive, commit], { cwd: root });
  result.sourceSha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.mkdirSync(workspace);
  await run('extract', 'tar', ['-xf', archive, '-C', workspace]);
  fs.copyFileSync(path.join(workspace, 'docs/acceptance/REVIEW.template.md'), path.join(out, 'REVIEW.md'));
  result.lockSha256 = createHash('sha256').update(fs.readFileSync(path.join(workspace, 'package-lock.json'))).digest('hex');
  result.examples = discoverExamples(workspace);
  await run('install', 'npm', ['ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund']);
  await node('gpu-preflight', 'packages/tools/src/gpu-preflight.mjs', [path.join(out, 'gpu.json')]);
  result.gpu = JSON.parse(fs.readFileSync(path.join(out, 'gpu.json'), 'utf8'));
  if (result.gpu.status !== 'passed') throw new Error('Hardware GPU preflight did not pass');
  await node('types-consumer', 'packages/tools/src/typecheck.mjs', ['--out', path.join(out, 'types')]);
  result.types = JSON.parse(fs.readFileSync(path.join(out, 'types/summary.json'), 'utf8'));
  if (result.types.status !== 'passed') throw new Error('Packed type consumer did not pass');
  await run('unit-and-protocol', 'npm', ['test']);
  // npm test includes real JS plans, inherited layouts, JSON and negative diagnostics.
  await node('e2e', 'packages/tools/src/e2e.mjs', [], { minutes: 90 });
  await node('fixed-step', 'packages/tools/src/fixed-step-check.mjs', ['examples/snow-hut/dist']);
  for (const task of ['touch', 'still-pop', 'gpu-load']) await run(task, 'npm', ['run', 'test:' + task]);
  await node('still-identity', 'scripts/verify.mjs', ['out/verify'], { cwd: path.join(workspace, 'examples/hello-courtyard') });
  for (const name of ['woodland-path', 'river-ford']) await run('metrics-' + name, 'npm', ['run', 'metrics', '-w', name]);
  await node('character-http', 'packages/tools/src/character-review.mjs', ['examples/river-ford/dist']);
  await node('character-file', 'packages/tools/src/character-review.mjs', ['examples/river-ford/release/river-ford.html']);
  if (interrupted) throw new Error('Interrupted: ' + interrupted);
  result.evidence = auditEvidence(workspace, result.examples);
  result.status = 'machine-pass-pending-review';
} catch (e) {
  result.status = interrupted ? 'interrupted' : 'failed'; result.error = e.message;
  console.error('[acceptance] ' + e.message); process.exitCode = 1;
} finally {
  clearTimeout(stopTimer);
  process.removeListener('SIGINT', onSigint); process.removeListener('SIGTERM', onSigterm);
  result.finished = new Date().toISOString(); save();
  console.log('[acceptance] ' + result.status + ' → ' + path.join(out, 'summary.json'));
}
