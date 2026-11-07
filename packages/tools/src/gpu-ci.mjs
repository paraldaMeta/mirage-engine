#!/usr/bin/env node
// GitHub Actions adapter around the existing serial acceptance entry point.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectEvidence } from './gpu-ci-evidence.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const command = process.argv[2];
const evidence = process.env.CI_EVIDENCE;
if (!['run', 'collect'].includes(command) || !evidence || !path.isAbsolute(evidence)) {
  throw new Error('Set absolute CI_EVIDENCE and use gpu-ci.mjs run | collect on the GPU runner.');
}
const output = path.join(fs.realpathSync(path.dirname(evidence)), path.basename(evidence));
const checkout = fs.realpathSync(root);
if (output === checkout || output.startsWith(checkout + path.sep)) throw new Error('Evidence must be outside checkout');

if (command === 'collect') {
  fs.mkdirSync(output, { recursive: true });
  const { index, markdown } = collectEvidence(output);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (index.status !== 'machine-pass-pending-review') process.exitCode = 1;
} else {
  fs.mkdirSync(output, { recursive: true });
  if (fs.existsSync(path.join(output, 'ci.json'))) throw new Error('This attempt already ran; use a new run-attempt directory');
  const result = { status: 'preparing', started: new Date().toISOString(), releaseReady: false,
    commit: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY, runner: process.env.RUNNER_NAME,
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    workflowRef: process.env.GITHUB_WORKFLOW_REF, workflowSha: process.env.GITHUB_WORKFLOW_SHA,
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` };
  const save = () => {
    fs.writeFileSync(path.join(output, 'ci.json.tmp'), JSON.stringify(result, null, 2) + '\n');
    fs.renameSync(path.join(output, 'ci.json.tmp'), path.join(output, 'ci.json'));
  };
  save();
  const fd = fs.openSync(path.join(output, 'ci.log'), 'wx');
  let child, deadline, force, interrupted;
  function interrupt(signal) {
    interrupted = signal;
    child?.kill('SIGTERM'); // acceptance handles the active detached process group
    if (!force) force = setTimeout(() => child?.kill('SIGKILL'), 10_000);
  }
  const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (commit !== result.commit) throw new Error('Checkout SHA differs from the requested Actions commit');
    if (/\s/.test(output)) throw new Error('Use a runner temp path without whitespace for the existing scene tools');
    if (!process.env.CHROME || !path.isAbsolute(process.env.CHROME)) throw new Error('Set repository variable MIRAGE_GPU_CHROME to the runner Chrome executable');
    const machine = JSON.parse(process.env.MIRAGE_GPU_MACHINE_JSON || 'null');
    if (!machine || typeof machine !== 'object') throw new Error('Fill repository variable MIRAGE_GPU_MACHINE_JSON');
    const machineFile = path.join(output, 'machine.json');
    fs.writeFileSync(machineFile, JSON.stringify(machine, null, 2) + '\n');
    result.status = 'running'; save();
    child = spawn(process.execPath, ['packages/tools/src/acceptance.mjs', '--run', '--machine', machineFile,
      '--out', path.join(output, 'acceptance')], { cwd: root, env: process.env, stdio: ['ignore', fd, fd] });
    deadline = setTimeout(() => interrupt('budget-exceeded'), 300 * 60_000);
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    Object.assign(result, exit);
    if (interrupted || exit.code !== 0) throw new Error(interrupted || 'Acceptance exited with ' + exit.code + ' / ' + exit.signal);
    result.status = 'completed';
  } catch (error) {
    result.status = interrupted ? 'interrupted' : 'failed';
    result.error = error.stack || String(error);
    fs.writeSync(fd, result.error + '\n');
    console.error('[gpu-ci] ' + error.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline); clearTimeout(force);
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
    fs.closeSync(fd);
    result.finished = new Date().toISOString(); save();
    console.log('[gpu-ci] ' + result.status + ' → ' + output);
  }
}
