// Node checks of the diagnostics (no browser): the code table, the converters, and the walk-grid probes on hand-made
// grids (each check fires on a broken case and stays quiet on a good one). `npm test -w @mirage/tools`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CODES, diag, sortDiagnostics, fromPlanIssues, lintPlan, fromBuildReport, fromConsole, fromStep, fromWorldChecks,
  axisVerdict, srcLoc, narrowPlanFields, stuckWords, throughWords, budgetAtLoad, lightFix, markdownDiagnostics } from './src/diagnostics.mjs';
import { classifyEye, freeSpot } from './src/world-checks.mjs';
import { planIssues } from '@mirage/world/plan-validation';
import { makeGrid, MAXL } from '../play/src/walkgrid.js';

// ---- the code table: stable shape, a concrete fix each, documented in docs/diagnostics.md
const doc = fs.readFileSync(fileURLToPath(new URL('../../docs/diagnostics.md', import.meta.url)), 'utf8');
for (const [code, c] of Object.entries(CODES)) {
  assert.match(code, /^MG[1-7]\d\d$/, code);
  assert.ok(['error', 'warning', 'info'].includes(c.severity), code + ' severity');
  assert.ok(c.title && c.fix && c.fix.length > 30, code + ' needs a title and a concrete fix');
  assert.ok(doc.includes('| ' + code + ' |'), code + ' is missing from docs/diagnostics.md');
}
for (const [, code] of doc.matchAll(/\| (MG\d{3}) \|/g)) assert.ok(CODES[code], code + ' is documented but not in CODES');
assert.throws(() => diag('MG999', {}), /unknown diagnostic code/);
const d = diag('MG304', { target: 't', message: 'm', at: [1.234, 2, 3] });
assert.deepEqual(Object.keys(d), ['code', 'severity', 'target', 'message', 'fix', 'at']);
assert.deepEqual(d.at, [1.23, 2, 3]);
// errors first, found order kept, duplicates dropped
assert.deepEqual(sortDiagnostics([diag('MG320', { target: 'a' }), diag('MG310', { target: 'b' }), diag('MG303', { target: 'c' }), diag('MG310', { target: 'b' })]).map((x) => x.code), ['MG310', 'MG303', 'MG320']);
assert.match(markdownDiagnostics([d]), /\| MG304 \| \*\*error\*\* \| t \| m \(at 1.23, 2, 3\) \|/);

// ---- plan: every schema rule maps to a code; the plan-only lint fires on broken views and not on the examples
const issues = planIssues({ name: '', bounds: [2, 0, 1, 1], walk: { yMin: 5, yMax: 1 }, units: 'ft', regions: { r: {} }, footprints: { c: { circle: [0, 0, 0] } }, viewpoints: [{ eye: [1, 2] }] });
const codes = fromPlanIssues(issues).map((x) => x.code);
for (const c of ['MG101', 'MG103', 'MG104', 'MG105', 'MG106', 'MG107', 'MG108', 'MG109']) assert.ok(codes.includes(c), c + ' from ' + JSON.stringify(issues));
const lint = (p) => lintPlan({ name: 'p', bounds: [-10, -10, 10, 10], ...p }).map((x) => x.code);
assert.deepEqual(lint({ spawn: { eye: [20, 1.62, 0], look: [0, 1.6, 0] } }), ['MG110']);
assert.deepEqual(lint({ viewpoints: [{ eye: [1, 2, 3], look: [1, 2, 3] }] }), ['MG111']);
assert.deepEqual(lint({ walk: { yMin: -1, yMax: 3 }, spawn: { eye: [0, 9.62, 0], look: [0, 9, -5] } }), ['MG112']);
assert.deepEqual(lint({ spawn: { eye: [0, 1.62, 0], look: [0, 1.6, -5] }, viewpoints: [{ eye: [30, 30, 30], look: [0, 0, 0] }] }), []);
const examples = fileURLToPath(new URL('../../examples/', import.meta.url));
for (const e of fs.readdirSync(examples)) {
  if (!fs.existsSync(examples + e + '/plan.js')) continue;
  const plan = (await import(examples + e + '/plan.js')).default;
  assert.deepEqual(lintPlan(plan), [], e + ': the plan lint stays quiet on the examples');
}

// ---- build report: phases map to codes, the fix names the file and line from the console stack
const rep = { failed: [{ name: 'crate', phase: 'build', error: "Cannot read properties of undefined (reading '0')" }, { name: 'lamps', phase: 'consumes', error: 'missing required anchors: posts' }, { name: 'x', phase: 'build', error: 'a module needs a name and build(ctx)' }], modules: [] };
const err = ['error: [world] module "crate" failed in build and was skipped: TypeError: x\n    at Object.build (http://127.0.0.1:1/w/modules/crate.js:11:30)\n    at buildWorld (http://127.0.0.1:1/packages/world/src/loader.js:120:5)'];
const b = fromBuildReport(rep, { points: {} }, err);
assert.deepEqual(b.map((x) => x.code), ['MG201', 'MG203', 'MG204']);
assert.match(b[0].fix, /modules\/crate\.js line 11/);
assert.equal(srcLoc(err[0]), 'modules/crate.js:11');
assert.equal(srcLoc('no location'), null);
// console: module failures are not repeated; page errors get their file from the stack
const con = fromConsole([...err, 'pageerror: boom'], { stacks: ['Error: boom\n    at main (http://127.0.0.1:1/w/main.js:7:3)'] });
assert.deepEqual(con.map((x) => [x.code, x.target]), [['MG602', 'main.js:7']]);

// ---- budget at load: names the heaviest module and how much to cut; quiet under budget
const build = { modules: [{ name: 'lamps', tris: 300000 }, { name: 'walls', tris: 1000 }] };
assert.match(budgetAtLoad(build, { budget: { triangles: 150000 } })[0].fix, /modules\/lamps\.js by at least 51 %/);
assert.deepEqual(budgetAtLoad(build, { budget: { triangles: 1e6 } }), []);
assert.match(lightFix({ postExposure: 0.0004, sunElevation: 20 }), /plan\.render\.post\.exposure/);
assert.match(lightFix({ postExposure: 0.4, sunElevation: -20, lamp: 0 }), /plan\.render\.time/);

// ---- steps: which way a position check failed
assert.equal(axisVerdict('~ -6.52 0.15', -3, -7.6), 'through');
assert.equal(axisVerdict('~ -6.52 0.15', -3, -5), 'short');
assert.equal(axisVerdict('< 1.9', 5, 1.95), 'short');
assert.equal(axisVerdict('< 1.9', 0, 3), 'through');
assert.equal(axisVerdict('> 8.5', 4, 6.6), 'short');
const row = { step: 's', pass: false, from: [0, 0, -3], to: [0, 0, -7.6], checks: [{ k: 'z', e: '~ -6.52 0.15', v: -7.6, ok: false }], metrics: {} };
const through = fromStep(row, { idx: 1, step: { name: 's', place: {} }, probe: { through: throughWords({ crossed: [], gap: { axis: 'x', left: ['walls/a', -1], right: ['walls/b', 1], at: [0, 0, -6.9] } }) } });
assert.equal(through[0].code, 'MG304');
assert.match(through[0].fix, /Close the gap from x -1 to 1 in modules\/walls\.js/);
const thin = throughWords({ crossed: [{ label: 'rail/post', why: 'it is only 0.06 m thick along the walk', at: [0, 0.3, 3], box: [-5.5, 0, 2.97, -0.5, 1, 3.03] }] });
assert.match(thin.fix, /ctx\.collider\(new THREE\.Mesh\(new THREE\.BoxGeometry\(5, 1, 0\.2\)\)\) positioned at \[-3, 0\.5, 3\] in modules\/rail\.js/);
// stuck at a narrow opening: the plan field that sets it, not a path's width
const plan = { paths: { rail: { width: 0.2 } }, yard: { gate: 0.4, wallHeight: 2.6 } };
assert.deepEqual(narrowPlanFields(plan, 0.5), ['plan.yard.gate = 0.4']);
const stuck = stuckWords({ width: 0.5, widthAt: [0, 7], sides: ['walls/wall-s-a', 'walls/wall-s-b'] }, plan);
assert.match(stuck.fix, /Set plan\.yard\.gate \(now 0\.4\) to at least 0\.8/);
const st = fromStep({ step: 'w', pass: false, err: 'walkTo: stuck at 0, 0, 6.6 on the way to 0, 9 (no progress for 2.5 s)', from: [0, 0, 4], to: [0, 0, 6.6], checks: [{ k: 'z', e: '> 8.5', v: 6.6, ok: false }], metrics: {} }, { idx: 1, step: { name: 'w' }, probe: { stuck } });
assert.deepEqual(st.map((x) => x.code), ['MG301'], 'a stuck walk is one diagnostic, not also "stopped short"');
// a step at a viewpoint whose eye is inside a solid gets the eye's fix
const eyeDiag = diag('MG310', { target: 'viewpoints[2].eye', message: 'inside', fix: 'Set viewpoints[2].eye to [2, 1.62, 7.6].' });
const seen = fromStep({ step: 'v', pass: false, checks: [{ k: 'see.crate', e: '> 0.001', v: 0, ok: false, why: 'out of frame (nothing of it is in view even with everything else removed)' }], metrics: {} }, { idx: 0, step: { name: 'v', viewpoint: 2 }, probe: { see: { crate: { center: [3, 0.5, -2] } } }, loadDiags: [eyeDiag] });
assert.equal(seen[0].code, 'MG401');
assert.equal(seen[0].fix, eyeDiag.fix);
// a black screenshot without an expectation is a warning with the light's numbers
const black = fromStep({ step: 'v', pass: true, checks: [], metrics: {}, frame: { luma: 0.8, dark: 0.98, clipped: 0 } }, { idx: 0, step: {}, lightFix: lightFix({ postExposure: 0.0004 }) });
assert.deepEqual(black.map((x) => [x.code, x.severity]), [['MG440', 'warning']]);
assert.deepEqual(fromStep({ step: 'v', pass: true, checks: [], metrics: {}, frame: { luma: 90, dark: 0, clipped: 0 } }, { idx: 0, step: {} }), []);

// ---- the walk-grid probes on a hand-made grid: ground at 0 everywhere, a 1 m crate at x, z in [2, 3], a 2.6 m wall
// at z in [6.8, 7.2], a 1.2 m high ceiling (a table) at x, z in [-3, -2]
const cell = 0.125, nx = 160, nz = 160, x0 = -10, z0 = -10;
const floors = new Float32Array(nx * nz * MAXL * 2), count = new Uint8Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell, k = j * nx + i, L = [];
  if (x > 2 && x < 3 && z > 2 && z < 3) L.push([1, Infinity]);
  else if (z > 6.8 && z < 7.2) L.push([2.6, Infinity]);
  else if (x > -3 && x < -2 && z > -3 && z < -2) L.push([0, 1.2], [1.25, Infinity]);
  else L.push([0, Infinity]);
  L.forEach(([f, c], l) => { floors[(k * MAXL + l) * 2] = f; floors[(k * MAXL + l) * 2 + 1] = c; });
  count[k] = L.length;
}
const grid = makeGrid({ nx, nz, x0, z0, cell, floors, count });
assert.equal(classifyEye(grid, [0, 1.62, 0], true).state, 'ok', 'quiet on open ground');
assert.equal(classifyEye(grid, [2.5, 1.62, 2.5], true).state, 'inside', 'a body inside the crate');
assert.equal(classifyEye(grid, [0, 1.62, 7], true).state, 'inside', 'a body inside the wall');
assert.equal(classifyEye(grid, [-2.5, 1.62, -2.5], true).state, 'head', 'a head under the table');
assert.equal(classifyEye(grid, [0, 3.62, 0], true).state, 'floating', 'a spawn 2 m above the ground');
assert.equal(classifyEye(grid, [20, 1.62, 0], true).state, 'outside');
assert.equal(classifyEye(grid, [0, 1.62, 7], false).state, 'inside', 'a free camera inside the wall');
assert.equal(classifyEye(grid, [0, 5, 7], false).state, 'ok', 'a free camera above the wall');
assert.equal(classifyEye(grid, [0, 0.5, 2.5 + 0.3], false).state, 'ok');
const free = freeSpot(grid, [2.5, 1.62, 2.5], true);
assert.ok(free && classifyEye(grid, free, true).state === 'ok' && Math.hypot(free[0] - 2.5, free[2] - 2.5) < 1.5, 'the free spot is free and near: ' + free);
// the converter: the spawn's fix is the free spot
const w = fromWorldChecks({ eyes: [{ path: 'spawn', name: 'spawn', mode: 'walk', eye: [2.5, 1.62, 2.5], state: 'inside', floors: [1], inside: 'crate', free }], floating: [{ label: 'crate', module: 'crate', bottom: 0.5, floor: 0, gap: 0.5, center: [3, 0.5, -2] }], zfight: [{ a: 'paving/square', b: 'ground/slab', moduleA: 'paving', y: 0, at: [0, 0, 4] }], views: [{ path: 'viewpoints[1]', name: 'rail', empty: 0.4, top: ['walls', 0.5], ahead: ['walls', 5], subjects: false, shares: { rail: 0 }, centres: { rail: [-3, 0.5, 3] } }] });
assert.deepEqual(w.map((x) => x.code), ['MG310', 'MG320', 'MG450', 'MG412']);
assert.match(w[0].fix, new RegExp(`Set spawn.eye to \\[${free[0]}, ${free[1]}, ${free[2]}\\]`));
assert.match(w[1].fix, /Lower crate by 0\.5 m in modules\/crate\.js/);
assert.match(w[2].fix, /Raise paving\/square by 0\.01 m \(to y 0\.01\) in modules\/paving\.js/);
assert.match(w[3].fix, /Set viewpoints\[1\]\.look to \[-3, 0\.5, 3\]/);
console.log(`diagnostics check: ${Object.keys(CODES).length} codes, converters and grid probes ok`);
