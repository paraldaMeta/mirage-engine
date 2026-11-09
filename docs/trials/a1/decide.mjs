import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BASE } from './prepare.mjs';

if (process.argv.length !== 5) throw new Error('Usage: node decide.mjs <evidence-A> <evidence-B> <completed-review.json>');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const reviews = read(process.argv[4]);
const criteria = Object.keys(read(new URL('review-template.json', import.meta.url)).A).filter(k => k !== 'evidenceNotes');
const dirs = process.argv.slice(2,4).map(p => path.resolve(p));
if (dirs[0] === dirs[1]) throw new Error('Two independent evidence directories required');
const machines = dirs.map(dir => read(path.join(dir, 'machine.json')));
const [a,b] = machines;
const sameSetup = machines.every(m => m.baseline === BASE) && a.controller === b.controller && a.taskSha256 === b.taskSha256 &&
  a.node === b.node && a.npm === b.npm && a.platform === b.platform;
const pairMeasured = machines.every(m => m.status === 'machine-pass');
const comparable = sameSetup && (!pairMeasured || (a.offline.browser === b.offline.browser &&
  a.targets.http.gpu === b.targets.http.gpu && a.targets.file.gpu === b.targets.file.gpu));
const pairs = machines.map((m, i) => {
  const id = ['A','B'][i], r = reviews[id] ?? {};
  let verdict;
  if (m.baseline !== BASE || r.isolated === false || r.unassisted === false || m.status === 'infrastructure') verdict = 'invalid';
  else if (m.status !== 'machine-pass') verdict = m.status === 'incomplete' ? 'incomplete' : 'failed';
  else if (criteria.some(key => r[key] === false)) verdict = 'failed';
  else if (!criteria.every(key => r[key] === true) || !r.evidenceNotes?.trim()) verdict = 'pending-human';
  else verdict = 'pass';
  return { id, verdict, machine: m.status, reason: m.reason, bytes: m.bytes, targets: m.targets, evidenceNotes: r.evidenceNotes };
});
const passed = comparable && pairs.every(p => p.verdict === 'pass');
console.log(JSON.stringify({ gate: 'A1', baseline: BASE, comparable, results: pairs, passed }, null, 2));
if (!passed) process.exitCode = 1;
