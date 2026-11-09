// Run only on the test machine in an isolated, offline reviewer account with a warmed npm cache.
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, prepare } from './prepare.mjs';
import { scenario } from './scenario.mjs';
import { inspectOffline } from './offline.mjs';

if (process.argv.length !== 4) throw new Error('Usage: node replay.mjs <submitted-rain-post-directory> <new-evidence-directory>');
const src = path.resolve(process.argv[2]), evidence = path.resolve(process.argv[3]);
if (src === evidence || evidence.startsWith(src + path.sep)) throw new Error('Keep evidence outside the submission');
mkdirSync(evidence); // never overwrite an earlier attempt
const root = path.join(evidence, 'workspace'), scene = path.join(root, 'examples/rain-post');
const hash = data => createHash('sha256').update(data).digest('hex');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const save = (name, value) => writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const result = { status: 'infrastructure', baseline: BASE, started: new Date().toISOString(), node: process.version,
  platform: os.platform() + '/' + os.arch(), steps: [], files: {}, targets: {} };
const tools = path.join(root, 'packages/tools/src');
const ignored = new Set(['node_modules', 'dist', 'release', 'out', 'deploy', '.git', '.DS_Store', '.gitignore', '.gitattributes']);
function copySource(from, to, prefix = '') {
  if (!lstatSync(from).isDirectory()) throw new Error('Expected a source directory: ' + prefix);
  mkdirSync(to);
  for (const name of readdirSync(from).sort()) {
    if (ignored.has(name)) continue;
    const file = path.join(from, name), dest = path.join(to, name), rel = prefix + name, info = lstatSync(file);
    if (info.isDirectory()) copySource(file, dest, rel + '/');
    else if (info.isFile() && (/\.(?:[cm]?[jt]s|html|css|json|md|glsl|vert|frag|svg|txt)$/i.test(name) || ['LICENSE','NOTICE','CREDITS'].includes(name))) {
      copyFileSync(file, dest);
      result.files[rel] = hash(readFileSync(dest));
    } else throw new Error('Unsupported submission file: ' + rel);
  }
}
function run(label, bin, args, cwd) {
  const fd = openSync(path.join(evidence, label + '.log'), 'wx');
  let r;
  try {
    r = spawnSync(bin, args, { cwd, timeout: 20 * 60 * 1000, stdio: ['ignore', fd, fd],
      env: { ...process.env, MIRAGE_BROWSER: '' } });
  } finally { closeSync(fd); }
  result.steps.push({ label, code: r.status, error: r.error?.message, signal: r.signal });
  return r.status === 0;
}
function required(ok, message) { if (!ok) throw new Error(message); }
try {
  if (process.env.MIRAGE_BROWSER) throw new Error('Unset MIRAGE_BROWSER; use the same desktop Chrome for both runs');
  result.controller = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }).trim();
  prepare(root);
  result.taskSha256 = hash(readFileSync(path.join(root, 'TASK.md')));
  result.npm = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
  required(run('install', 'npm', ['ci', '--offline', '--no-audit', '--no-fund'], root), 'npm cache or installation unavailable');
  result.status = 'incomplete';
  copySource(src, scene);
  for (const name of ['index.html','package.json','plan.js','BRIEF.md','NOTES.md','TRIAL-LOG.md','handoff.json','scenarios/playtest.json']) {
    required(existsSync(path.join(scene, name)) && statSync(path.join(scene, name)).size > 0, 'Missing ' + name);
  }
  const handoff = read(path.join(scene, 'handoff.json')), script = scenario(handoff);
  save('proctor-scenario.json', script);
  result.status = 'failed';
  required(run('validate', process.execPath, [path.join(tools, 'validate-plan.mjs'), 'plan.js'], scene), 'Invalid scene plan');
  const built = run('build', process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], scene);
  const packed = run('package', process.execPath, [path.join(tools, 'package.mjs'), '.', '--out', 'release/rain-post.html'], scene);
  if (packed) {
    const html = readFileSync(path.join(scene, 'release/rain-post.html'));
    result.bytes = html.length; result.htmlSha256 = hash(html);
  }
  for (const [transport, ready, target, protocol] of [['http',built,'dist','http:'], ['file',packed,'release/rain-post.html','file:']]) {
    if (!ready) continue;
    const dir = path.join(evidence, transport);
    const exitOK = run(transport, process.execPath, [path.join(tools, 'playtest.mjs'), path.join(evidence,'proctor-scenario.json'),target,'--out',dir], scene);
    if (!existsSync(path.join(dir,'report.json'))) { result.targets[transport] = { pass: false, reason: 'no report' }; continue; }
    const report = read(path.join(dir,'report.json')), modules = report.build?.modules ?? [];
    const perf = report.steps.find(s => s.step === 'frame-cost')?.metrics;
    const flicker = report.steps.find(s => s.step === 'route-shimmer')?.metrics;
    const allShots = script.steps.every((s,i) => {
      const row = report.steps[i];
      return row?.pass && row.step === s.name && row.shot && existsSync(path.join(dir,row.shot));
    });
    const pass = exitOK && report.pass === true && !report.errors.length && new URL(report.url).protocol === protocol &&
      report.build?.failed?.length === 0 && modules.length >= 3 && modules.every(m => m.ok) &&
      modules.some(m => m.consumes?.some(a => a.key === handoff.signalAnchor && a.count >= 1)) &&
      allShots && report.steps.length === script.steps.length && existsSync(path.join(dir,'sheet.png'));
    result.targets[transport] = { pass: Boolean(pass), gpu: report.gpu, warnings: report.warnings, perf, flicker };
  }
  required(result.bytes > 0 && result.bytes <= 5_000_000, 'Offline file missing or larger than 5,000,000 bytes');
  required(result.targets.http?.pass && result.targets.file?.pass, 'Inspect HTTP and file reports');
  result.offline = await inspectOffline(root, path.join(scene, 'release/rain-post.html'), handoff);
  required(result.offline.pass, 'Inspect cold offline start, camera names, anchor provenance and rail geometry');
  result.status = 'machine-pass';
} catch (error) { result.reason = error.message; process.exitCode = 1; }
finally {
  result.finished = new Date().toISOString();
  save('machine.json', result);
  console.log(result.status, result.reason || 'pending independent human review', evidence);
}
