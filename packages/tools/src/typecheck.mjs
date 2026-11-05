#!/usr/bin/env node
// Mirage original code. Test-machine-only package consumer checks. No browser, rendering or emitted JS.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out') throw new Error('Usage on the test machine: node packages/tools/src/typecheck.mjs --out <new-directory>');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const requested = path.resolve(args[1]);
const out = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
const source = fs.realpathSync(root);
if (out === source || out.startsWith(source + path.sep)) throw new Error('Use a new evidence directory outside the checkout.');
fs.mkdirSync(out);
fs.mkdirSync(path.join(out, 'tarballs'));
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^npm_(package_|lifecycle_)/.test(key) || ['npm_config_local_prefix', 'INIT_CWD'].includes(key)) delete env[key];
}
const result = { status: 'running', started: new Date().toISOString(), node: process.version,
  source, toolchain: { typescript: '5.9.3', '@types/three': '0.186.0', three: '0.186.1' }, packages: [], steps: [] };
const save = () => {
  fs.writeFileSync(path.join(out, 'summary.json.tmp'), JSON.stringify(result, null, 2) + '\n');
  fs.renameSync(path.join(out, 'summary.json.tmp'), path.join(out, 'summary.json'));
};
function run(id, command, argv, cwd = out) {
  const step = { id, command, args: argv, log: id + '.log', status: 'running' };
  result.steps.push(step); save();
  const t0 = Date.now();
  const r = spawnSync(command, argv, { cwd, env, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(out, step.log), (r.stdout || '') + '\n' + (r.stderr || ''));
  Object.assign(step, { code: r.status, signal: r.signal, seconds: +((Date.now() - t0) / 1000).toFixed(1),
    status: r.status === 0 ? 'passed' : 'failed', error: r.error?.message });
  save();
  if (r.status !== 0) throw new Error(id + ' failed; see ' + step.log);
  return r.stdout;
}
try {
  if (process.env.NODE_OPTIONS) throw new Error('Unset NODE_OPTIONS before the compiler acceptance run.');
  result.npm = run('npm-version', 'npm', ['--version']).trim();
  const dependencies = { three: result.toolchain.three };
  const expected = {
    core: ['env', 'geom', 'materials', 'rng'],
    world: ['index', 'plan', 'plan-validation', 'loader', 'kits/vegetation', 'kits/terrain', 'kits/water'],
  };
  for (const name of ['core', 'world']) {
    const dir = path.join(root, 'packages', name), manifest = read(path.join(dir, 'package.json'));
    const packs = JSON.parse(run('pack-' + name, 'npm', ['pack', '.', '--workspaces=false', '--ignore-scripts', '--json',
      '--pack-destination', path.join(out, 'tarballs')], dir));
    if (packs.length !== 1) throw new Error('Expected exactly one tarball for ' + name);
    const pack = packs[0];
    for (const entry of expected[name]) {
      for (const extension of ['.js', '.d.ts']) {
        if (!pack.files.some(f => f.path === 'src/' + entry + extension)) throw new Error(name + ': missing shipped entry ' + entry + extension);
      }
    }
    dependencies[manifest.name] = 'file:./tarballs/' + pack.filename;
    result.packages.push({ name: manifest.name, version: manifest.version, file: 'tarballs/' + pack.filename,
      sha256: hash(path.join(out, 'tarballs', pack.filename)), files: pack.files.map(f => f.path) });
  }
  const fixtureDir = path.join(root, 'docs/types');
  for (const name of ['world-authoring.mts', 'world-js.js', 'tsconfig.nodenext.json', 'tsconfig.bundler.json']) {
    fs.copyFileSync(path.join(fixtureDir, name), path.join(out, name));
  }
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'mirage-types-consumer', private: true, type: 'module',
    dependencies, devDependencies: { typescript: result.toolchain.typescript, '@types/three': result.toolchain['@types/three'] } }, null, 2) + '\n');
  // No repository symlinks or paths aliases: resolve exactly what the packed consumer receives.
  run('install', 'npm', ['install', '--include=dev', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund']);
  result.lockSha256 = hash(path.join(out, 'package-lock.json'));
  for (const [name, version] of Object.entries(result.toolchain)) {
    if (read(path.join(out, 'node_modules', name, 'package.json')).version !== version) throw new Error('Unexpected installed version: ' + name);
  }
  for (const mode of ['nodenext', 'bundler']) {
    run(mode, process.execPath, [path.join(out, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.' + mode + '.json']);
  }
  result.status = 'passed';
} catch (e) {
  result.status = 'failed'; result.error = e.message; process.exitCode = 1;
  console.error('[types] ' + e.message);
} finally {
  result.finished = new Date().toISOString(); save();
  console.log('[types] ' + result.status + ' → ' + path.join(out, 'summary.json'));
}
