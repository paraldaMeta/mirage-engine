#!/usr/bin/env node
// Mirage original code. Test-machine-only package consumer checks. No browser, rendering or emitted JS.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
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
function run(id, command, argv, cwd = out, required = true) {
  const step = { id, command, args: argv, log: id + '.log', status: 'running' };
  result.steps.push(step); save();
  const t0 = Date.now();
  const r = spawnSync(command, argv, { cwd, env, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(out, step.log), (r.stdout || '') + '\n' + (r.stderr || ''));
  Object.assign(step, { code: r.status, signal: r.signal, seconds: +((Date.now() - t0) / 1000).toFixed(1),
    status: r.status === 0 ? 'passed' : 'failed', error: r.error?.message });
  save();
  if (r.status !== 0 && required) throw new Error(id + ' failed; see ' + step.log);
  return r.stdout;
}
try {
  if (process.env.NODE_OPTIONS) throw new Error('Unset NODE_OPTIONS before the compiler acceptance run.');
  result.npm = run('npm-version', 'npm', ['--version']).trim();
  const rapier = '@dimforge/rapier3d-compat';
  const pinnedRapier = read(path.join(root, 'packages/game/package.json')).dependencies[rapier];
  const dependencies = { three: result.toolchain.three, [rapier]: pinnedRapier };
  for (const name of ['core', 'world', 'play', 'game']) {
    const dir = path.join(root, 'packages', name), manifest = read(path.join(dir, 'package.json'));
    const packs = JSON.parse(run('pack-' + name, 'npm', ['pack', '.', '--workspaces=false', '--ignore-scripts', '--json',
      '--pack-destination', path.join(out, 'tarballs')], dir));
    if (packs.length !== 1) throw new Error('Expected exactly one tarball for ' + name);
    const pack = packs[0];
    // All current .js files are reachable through the wildcard exports. Derive the inventory from source
    // rather than maintaining a second registry whenever a module is added.
    const entries = fs.readdirSync(path.join(dir, 'src'), { recursive: true })
      .filter(file => file.endsWith('.js')).map(file => file.replaceAll(path.sep, '/').slice(0, -3)).sort();
    if (!entries.includes('index')) throw new Error(name + ': missing root entry');
    if (manifest.types !== './src/index.d.ts' || manifest.exports['.']?.types !== manifest.types) {
      throw new Error(name + ': root types condition does not match the declaration entry');
    }
    for (const entry of entries) {
      for (const extension of ['.js', '.d.ts']) {
        if (!pack.files.some(f => f.path === 'src/' + entry + extension)) throw new Error(name + ': missing shipped entry ' + entry + extension);
      }
    }
    dependencies[manifest.name] = 'file:./tarballs/' + pack.filename;
    result.packages.push({ name: manifest.name, version: manifest.version, file: 'tarballs/' + pack.filename,
      sha256: hash(path.join(out, 'tarballs', pack.filename)), files: pack.files.map(f => f.path) });
  }
  const fixtureDir = path.join(root, 'docs/types');
  for (const name of fs.readdirSync(fixtureDir).filter(name => /\.(mts|ts|js|json)$/.test(name)).sort()) {
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
  const gameDir = path.join(out, 'node_modules/@mirage/game');
  const requireFromGame = createRequire(path.join(gameDir, 'package.json'));
  const upstream = path.dirname(requireFromGame.resolve(rapier));
  const shipped = path.join(gameDir, 'types/rapier');
  assert.equal(read(path.join(upstream, 'package.json')).version, pinnedRapier);
  const declarationFiles = dir => fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.d.ts')).sort();
  const originals = declarationFiles(upstream);
  assert.ok(originals.includes('rapier.d.ts'));
  assert.deepEqual(declarationFiles(shipped), originals, 'Rapier declaration inventory differs from the installed runtime');
  for (const file of originals) assert.equal(hash(path.join(shipped, file)), hash(path.join(upstream, file)), file);
  result.rapier = { version: pinnedRapier, identicalDeclarations: originals.length };
  save();
  for (const mode of ['nodenext', 'bundler']) {
    // Collect both compiler logs before deciding the result.
    run(mode, process.execPath, [path.join(out, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.' + mode + '.json'], out, false);
  }
  const failed = result.steps.filter(step => step.status === 'failed');
  if (failed.length) throw new Error(failed.map(step => step.id + ' failed; see ' + step.log).join('; '));
  result.status = 'passed';
} catch (e) {
  result.status = 'failed'; result.error = e.message; process.exitCode = 1;
  console.error('[types] ' + e.message);
} finally {
  result.finished = new Date().toISOString(); save();
  console.log('[types] ' + result.status + ' → ' + path.join(out, 'summary.json'));
}
