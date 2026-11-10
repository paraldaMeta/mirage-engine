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
import { ranFlags, measure } from '../coverage.mjs';
import { apiRows, classify } from '../api-stability.mjs';
import { links, missingFromIndex } from '../check-docs.mjs';

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

// ---- the coverage arithmetic: inner ranges win, comments and blanks are not lines
{
  const src = '// note\nfunction a() { return 1; }\n\nfunction b(x) { if (x) { return 2; } return 3; }\n/* block\n   more */\nconst k = 1;\n';
  const at = (t, from = 0) => src.indexOf(t, from);
  const fns = [
    { functionName: '', ranges: [{ startOffset: 0, endOffset: src.length, count: 1 }] },
    { functionName: 'a', ranges: [{ startOffset: at('function a'), endOffset: at('}') + 1, count: 0 }] },
    { functionName: 'b', ranges: [{ startOffset: at('function b'), endOffset: at('return 3; }') + 11, count: 2 }, { startOffset: at('{ return 2'), endOffset: at('return 2; }') + 11, count: 0 }] },
  ];
  const ran = ranFlags(fns, src.length), m = measure(src, ran);
  assert.equal(ran[at('return 1')], 0, 'a never ran');
  assert.equal(ran[at('return 2')], 0, 'the inner block of b did not run although b did');
  assert.equal(ran[at('return 3')], 1);
  assert.equal(ran[at('const k')], 1, 'top level ran');
  assert.deepEqual([m.lines, m.linesRun], [3, 2], 'three code lines (comments, blank and block comment skipped), a is the one not run');
  assert.ok(m.charsRun < m.chars && m.charsRun > 0);
  const none = measure(src, null);
  assert.deepEqual([none.lines, none.linesRun, none.charsRun], [3, 0, 0], 'a file nothing loaded counts as zero');
}

// ---- the stability report reads rows, own package first
{
  const rows = apiRows('## @mirage/core\n| `geom` | stable | meshes; `wall`, `openingProblem` |\n| `createThing(world, { fast })` | experimental | a thing |\nprose about `loose`\n## @mirage/play\n| `createThing` | stable | another |\n## Notes\n| `x` | stable | not a package |\n');
  assert.deepEqual(Object.keys(rows), ['@mirage/core', '@mirage/play']);
  assert.equal(classify('geom', '@mirage/core', rows), 'stable');
  assert.equal(classify('createThing', '@mirage/core', rows), 'experimental', 'the own package row wins');
  assert.equal(classify('createThing', '@mirage/play', rows), 'stable');
  assert.equal(classify('openingProblem', '@mirage/core', rows), 'stable', 'a name in the description takes the row');
  assert.equal(classify('create', '@mirage/core', rows), null, 'a prefix of a name is not the name');
  assert.equal(classify('loose', '@mirage/core', rows), null, 'prose is not a row');
}

// ---- the docs index check
{
  assert.deepEqual(links('see [a](a.md#x), [web](https://x.y/z.md), `[code](no.md)` and [up](../B.md "t")\n```\n[fenced](f.md)\n```\n').map((l) => l.href), ['a.md', '../B.md']);
  assert.deepEqual(missingFromIndex('[a](a.md) [b](./b.md)', ['a.md', 'b.md', 'c.md', 'README.md']), ['c.md']);
}
console.log(`tooling check: ${assert.failures.length ? 'FAILED' : 'ok'} (${assert.count} assertions)`);
