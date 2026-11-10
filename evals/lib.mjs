// Mirage original code. Shared by evals/check.mjs and evals/run.mjs: the tasks, materialising a task's world into a
// folder (base + the task's start overlay [+ its fix overlay]), and the machine check (one playtest of the task's
// scenario against that folder).
// The worlds live outside the repository (WORK, default <tmp>/mirage-evals; MIRAGE_EVAL_WORK to move it), so an agent
// working in one does not find the reference fixes next door. WORK holds symlinks to the repository's packages/ and
// node_modules/, and the server serves WORK: the worlds load the packages from source through their import map.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve } from '../packages/tools/src/chrome.mjs';
import { playtest } from '../packages/tools/src/playtest.mjs';

export const EVALS = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(EVALS, '..');
export const WORK = path.resolve(process.env.MIRAGE_EVAL_WORK || path.join(os.tmpdir(), 'mirage-evals'));
for (const d of ['packages', 'node_modules']) {
  const link = path.join(WORK, d);
  fs.mkdirSync(WORK, { recursive: true });
  let target = null; try { target = fs.readlinkSync(link); } catch { /* none yet */ }
  if (target !== path.join(ROOT, d)) { fs.rmSync(link, { force: true }); fs.symlinkSync(path.join(ROOT, d), link, 'dir'); }
}

/** Every task: evals/tasks/<id>/task.json (+ scenario.json, start/, fix/). */
export function tasks(filter) {
  const dir = path.join(EVALS, 'tasks');
  const ids = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'task.json'))).sort();
  return ids.filter((id) => !filter || filter.includes(id)).map((id) => ({
    id, dir: path.join(dir, id), ...JSON.parse(fs.readFileSync(path.join(dir, id, 'task.json'), 'utf8')),
    scenario: JSON.parse(fs.readFileSync(path.join(dir, id, 'scenario.json'), 'utf8')),
  }));
}

const copyTree = (from, to) => { if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true }); };

/** Write the task's world into `dir`: 'start' = base + start/, 'fix' = base + start/ + fix/, 'base' = base alone.
 *  The scenario goes in as scenario.json and the task text as TASK.md (what an agent reads). */
export function materialize(task, variant, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  copyTree(path.join(EVALS, 'base'), dir);
  if (task && variant !== 'base') copyTree(path.join(task.dir, 'start'), dir);
  if (task && variant === 'fix') copyTree(path.join(task.dir, 'fix'), dir);
  if (task) {
    fs.writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(task.scenario, null, 1));
    fs.writeFileSync(path.join(dir, 'TASK.md'), `# ${task.title}\n\n${task.prompt}\n`);
  }
  return dir;
}

/** Hash of every file of the world under dir except what the agent may not change (scenario, task). */
export function worldHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'out' && e.name !== 'node_modules') walk(p); }
    else if (!['scenario.json', 'TASK.md', 'DIAGNOSTICS.md', 'REPORT.md'].includes(e.name)) { h.update(path.relative(dir, p)); h.update(fs.readFileSync(p)); }
  } };
  walk(dir);
  return h.digest('hex');
}

let server = null;
/** The static server at WORK (one per process). */
export async function rootServer() {
  if (!server) server = await serve(WORK);
  return server;
}
export const closeServer = () => { if (server) { server.close(); server = null; } };

/** The machine check of a task against a world folder (inside the repository): the task's own scenario (never the
 *  copy in the folder, which an agent could edit) must pass, with no error diagnostics and none of task.forbid.
 *  -> { pass, codes, report, why } */
export async function machineCheck(task, dir, { out } = {}) {
  const srv = await rootServer();
  const rel = path.relative(WORK, dir).split(path.sep).join('/');
  if (rel.startsWith('..')) throw new Error('the world folder must be inside ' + WORK + ': ' + dir);
  const report = await playtest(task ? task.scenario : BASE_SCENARIO, srv.url + rel + '/index.html', { out: out || path.join(dir, 'out', 'playtest'), scenarioFile: task ? path.join(task.dir, 'scenario.json') : 'base', log: () => {} });
  const codes = report.diagnostics.map((d) => d.code);
  const errors = report.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
  const forbidden = codes.filter((c) => (task?.forbid || []).includes(c));
  const why = [];
  if (!report.pass) why.push(`playtest failed (${report.failed})`);
  if (errors.length) why.push('error diagnostics: ' + [...new Set(errors)].join(', '));
  if (forbidden.length) why.push('forbidden diagnostics: ' + [...new Set(forbidden)].join(', '));
  return { pass: !why.length, codes: [...new Set(codes)], report, why: why.join('; ') };
}

/** The base world's own scenario: the control (every check quiet). */
export const BASE_SCENARIO = {
  title: 'yard: control', query: 'mode=walk&ui=0&grain=0', w: 640, h: 400,
  steps: [
    { name: 'spawn', ms: 300, expect: { onGround: '== true', y: '~ 0 0.05' } },
    { name: 'wall-blocks', place: { eye: [0, 1.62, -3], look: [0, 1.62, -12], mode: 'walk' }, keys: ['KeyW'], ms: 3000, expect: { z: '~ -6.52 0.15' } },
    { name: 'rail-blocks', place: { eye: [-3.5, 1.62, 5], look: [-3.5, 1.62, -5], mode: 'walk' }, keys: ['KeyW'], ms: 2000, expect: { z: '~ 3.38 0.15' } },
    { name: 'yard-view', viewpoint: 0, see: ['crate'] },
  ],
};
