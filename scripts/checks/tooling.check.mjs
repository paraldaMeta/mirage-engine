// Mirage original code. The checks that check the checks: the keep-going assert really fails a script and counts,
// the import check really refuses a subpath that is not exported, and the bug ESLint found in createLod().register
// stays fixed.   node scripts/checks/tooling.check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import assert from '../soft-assert.mjs';
import { readPackages, exported, scan, checkMaps } from '../check-imports.mjs';
import { createLod } from '../../packages/core/src/lod.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- soft-assert: all failures, a count, exit 1; MIRAGE_ASSERT=hard stops at the first
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-soft-'));
  const f = path.join(dir, 'three.check.mjs');
  fs.writeFileSync(f, `import assert, { ok } from ${JSON.stringify(pathToFileURL(path.join(here, '../soft-assert.mjs')).href)};
assert.equal(1, 2, 'first');
assert.ok(true);
assert.deepEqual({ a: 1 }, { a: 2 }, 'second');
await assert.rejects(Promise.resolve(1), 'third');
ok(false, 'fourth');
console.log('reached the end');
process.exit(0);
`);
  const env = { ...process.env }; delete env.MIRAGE_ASSERT;
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', env });
  assert.equal(r.status, 1, 'a failed assertion fails the script, even after process.exit(0)');
  assert.match(r.stdout, /reached the end/, 'the script ran to its end');
  assert.match(r.stderr, /three\.check\.mjs: 4 of 5 assertions FAILED/, 'the count: ' + r.stderr.slice(0, 300));
  for (const [i, word] of ['first', 'second', 'third', 'fourth'].entries()) assert.ok(r.stderr.includes(`${i + 1}. three.check.mjs:`) && r.stderr.includes(word), `failure ${i + 1} (${word}) is listed with its line`);
  const h = spawnSync(process.execPath, [f], { encoding: 'utf8', env: { ...env, MIRAGE_ASSERT: 'hard' } });
  assert.ok(h.status !== 0 && /first/.test(h.stderr) && !/reached the end/.test(h.stdout) && !/second/.test(h.stderr), 'MIRAGE_ASSERT=hard stops at the first failure');
  fs.writeFileSync(f, `import assert from ${JSON.stringify(pathToFileURL(path.join(here, '../soft-assert.mjs')).href)};\nassert.equal(1, 1);\n`);
  const p = spawnSync(process.execPath, [f], { encoding: 'utf8', env });
  assert.ok(p.status === 0 && p.stderr === '' && p.stdout === '', 'a passing script is silent and exits 0');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- the import check: a subpath outside the export map
{
  const pkgs = readPackages();
  assert.deepEqual(checkMaps(pkgs), [], 'the real export maps have no wildcard and no missing target');
  assert.ok(exported(pkgs.core, 'geom') && exported(pkgs.world, 'kits/water') && exported(pkgs.world, 'kits'));
  assert.ok(!exported(pkgs.core, 'particle-draw') && !exported(pkgs.core, 'no-such-file'), 'a file under src/ that is not listed is not importable');
  assert.ok(exported(pkgs.tools, 'src/chrome.mjs') && !exported(pkgs.tools, 'src/nope.mjs'), '@mirage/tools has no map: an existing file');
  const bad = scan("import { a } from '@mirage/core/particle-draw';\nimport { wall } from '@mirage/core/geom';\nconst b = await import('@mirage/play/secret');\n", 'examples/x/src/main.js', pkgs);
  assert.deepEqual(bad.map((b) => b.line), [1, 3]);
  assert.match(bad[0].text, /@mirage\/core\/particle-draw is not in the export map of @mirage\/core/);
  assert.deepEqual(scan("import { x } from '../../world/src/loader.js';\n", 'packages/core/src/a.js', pkgs).map((b) => b.text), ["relative import into packages/world/src: import '@mirage/world' instead"]);
  assert.deepEqual(scan("import { x } from '../../core/src/geom.js';\n", 'packages/core/checks/a.js', pkgs), [], 'a check script may reach into src');
  const wild = { name: '@mirage/x', dir: pkgs.core.dir, exports: { './*': './src/*.js', './gone': './src/gone.js', './geom': './src/geom.js' } };
  const m = checkMaps({ x: wild });
  assert.ok(m.some((t) => /wildcard/.test(t)) && m.some((t) => /"\.\/gone" -> \.\/src\/gone\.js does not exist/.test(t)) && m.some((t) => /"\.\/geom" has \.\/src\/geom\.d\.ts but no "types"/.test(t)), 'wildcard, missing target and missing types are each reported: ' + m.join(' | '));
  // and Node itself refuses it (the map, not the check, is what protects an installed package)
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('@mirage/core/particle-draw')"], { encoding: 'utf8', cwd: path.join(here, '../..') });
  assert.ok(r.status !== 0 && /ERR_PACKAGE_PATH_NOT_EXPORTED/.test(r.stderr), 'node: ERR_PACKAGE_PATH_NOT_EXPORTED for an unlisted file');
}

// ---- createLod().register: `unit` was declared in the traverse callback and read in the loop after it, so any mesh
// over minTris threw ReferenceError (found by no-undef). A scaled mesh must get its twins.
{
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial());
  mesh.scale.setScalar(5);
  const root = new THREE.Group(); root.add(mesh);
  const lod = createLod();
  let err = null;
  try { await lod.register(root, { minTris: 1000 }); } catch (e) { err = e; }
  assert.equal(err, null, 'register() runs on a mesh over minTris: ' + (err && err.message));
  assert.equal(lod.stats.meshes, 1);
  assert.ok(lod.stats.twinTris.length > 0 && lod.stats.twinTris[0] > 0 && lod.stats.twinTris[0] < lod.stats.tris, `the first twin has fewer triangles (${lod.stats.twinTris[0]} of ${lod.stats.tris})`);
}
console.log(`tooling check: ${assert.failures.length ? 'FAILED' : 'ok'} (${assert.count} assertions)`);
