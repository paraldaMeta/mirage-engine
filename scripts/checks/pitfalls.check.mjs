// Mirage original code. The diagnostics for four things a newcomer walks into: a door arch taller than its wall
// (MG206), a list under plan.points (MG102), a slow perf step on a busy machine (MG501) and a room with nothing but
// dimmed sky light (MG442). Node only: the texts and when they fire.   node scripts/checks/pitfalls.check.mjs
import assert from '../soft-assert.mjs';
import { wall, openingProblem } from '../../packages/core/src/geom.js';
import { planIssues } from '../../packages/world/src/plan-validation.js';
import { fromPlanIssues, fromWarnings, fromStep, timingWords, insideVolume, CODES, SPREAD_SOFT } from '../../packages/tools/src/diagnostics.mjs';

// ---- MG206: an opening's height is the springing, the arch defaults to round
{
  const door = { x: 0, width: 1.2, height: 2.1 };
  const why = openingProblem(door, 2.4);
  assert.match(why, /door at x 0 \(width 1\.2, height 2\.1, no arch given, so 'round'\) tops out at 2\.7 m, above the 2\.4 m wall top/);
  assert.match(why, /Add arch: 'flat' for a straight lintel at 2\.1 m, or keep the round arch with height 1\.6\./, 'both ways out, with numbers: ' + why);
  assert.equal(openingProblem({ ...door, arch: 'flat' }, 2.4), null, 'a flat lintel under the wall top is fine');
  assert.equal(openingProblem({ ...door, height: 1.6 }, 2.4), null, 'so is a round arch that springs lower (top 2.2)');
  assert.equal(openingProblem(door, 3), null, 'and the same door in a taller wall');
  assert.match(openingProblem({ ...door, arch: 'flat', height: 2.4 }, 2.4), /at the 2\.4 m wall top.*Lower height below 2\.4\./, 'a flat opening as tall as the wall leaves no lintel');
  assert.match(openingProblem({ x: 1, width: 1, height: 2, sill: 0.9, arch: 'pointed' }, 2.4), /^wall: the window at x 1 .*arch 'pointed'/);
  // wall() says it once per distinct problem, with the code, and still builds
  const said = [], warn = console.warn; console.warn = (m) => said.push(String(m));
  let g;
  try { g = wall({ length: 4, height: 2.4, openings: [door] }); wall({ length: 4, height: 2.4, openings: [door] }); wall({ length: 4, height: 2.4, openings: [{ ...door, arch: 'flat' }] }); }
  finally { console.warn = warn; }
  assert.ok(g && g.attributes.position.count > 0, 'the wall is still built');
  assert.equal(said.length, 1, 'one warning for two identical walls, none for the flat one: ' + JSON.stringify(said));
  assert.ok(said[0]?.startsWith('[mirage/geom] MG206 wall: the door at x 0'));
  // the playtest turns that console line into a diagnostic
  const d = fromWarnings([...said, said[0], 'THREE.WebGLRenderer: something else', '[mirage/geom] MG999 not a code']);
  assert.equal(d.length, 1, 'one diagnostic: duplicates and other warnings dropped');
  assert.deepEqual([d[0]?.code, d[0]?.severity, d[0]?.target], ['MG206', 'warning', 'geom']);
  assert.match(d[0]?.message || '', /tops out at 2\.7 m.*not the top of the opening\.$/);
  assert.match(d[0]?.fix || '', /^Add arch: 'flat'/);
  assert.ok(CODES.MG206.fix.includes("arch: 'flat'"));
}

// ---- MG102: lists under plan.points
{
  const plan = { name: 'p', bounds: [0, 0, 10, 10], points: { lamps: [[1, 0, 2], [3, 0, 4]], trio: [[1, 0, 2], [3, 0, 4], [1, 2, 3]], ok: [1, 2, 3], flat: [1, 2] } };
  const ds = fromPlanIssues(planIssues(plan));
  const lamps = ds.filter((d) => /points\.lamps/.test(d.message)), trio = ds.filter((d) => /points\.trio/.test(d.message));
  assert.equal(lamps.length, 1, 'one diagnostic for the list, not one per element: ' + JSON.stringify(lamps.map((d) => d.message)));
  assert.equal(trio.length, 1);
  assert.match(lamps[0]?.message || '', /a list of spots, where plan\.points takes one \[x, y, z\] per name/);
  assert.match(lamps[0]?.fix || '', /lampsA: \[x, y, z\].*plan\.lamps = \[\[x, y, z\], \.\.\.\].*ctx\.plan/, 'the fix says both ways out');
  assert.ok(!ds.some((d) => /points\.ok/.test(d.message)), 'a proper point is not reported');
  const flat = ds.find((d) => /points\.flat/.test(d.message));
  assert.match(flat?.fix || '', /three numbers, \[x, y, z\]/);
}

// ---- MG501: what a time can say
{
  const quiet = { frameMs: 20, frameMsRuns: [19.8, 20, 20.3], frameMsSpread: 0.03, calls: 80, triangles: 120000 };
  const busy = { ...quiet, frameMsRuns: [14, 20, 31], frameMsSpread: 0.85 };
  const heavy = 'modules/props.js builds 81 % (97.2 k) of 120.0 k triangles';
  const q = timingWords(quiet, { budget: { triangles: 500000 } }, heavy);
  assert.equal(q.noisy, false);
  assert.match(q.message, /median of 3 runs: 19\.8, 20, 20\.3 ms; spread 3 %\)$/);
  assert.match(q.fix, /^The time says the frame is slow, not why: this view draws 80 calls and 120\.0 k triangles, inside plan\.budget/);
  assert.match(q.fix, /Largest by triangles, not necessarily the cause: modules\/props\.js/, 'the big module is named, not blamed');
  const b = timingWords(busy, { budget: { triangles: 500000 } }, heavy);
  assert.equal(b.noisy, true);
  assert.match(b.message, /spread 85 %, the runs disagree/);
  assert.match(b.fix, /^The runs differ by more than 25 %: another process had the CPU or GPU\. Close what is running and measure again/);
  const over = timingWords(quiet, { budget: { triangles: 100000 } }, heavy);
  assert.match(over.fix, /over plan\.budget \(triangles 100000\): start there \(modules\/props\.js/, 'triangles are blamed when they are over the budget');
  assert.ok(!/not why/.test(over.fix));
  assert.deepEqual(timingWords({ frameMs: 20 }, null).message, '', 'a single run adds nothing to the message');
  assert.equal(SPREAD_SOFT, 0.25);
  // through fromStep: a failed frameMs expectation carries the runs and the honest fix
  const ds = fromStep({ pass: false, checks: [{ k: 'frameMs', e: '< 16.7', v: 20, ok: false }], metrics: busy, to: [0, 0, 0] }, { idx: 3, step: { name: 'frame-cost' }, plan: {}, heavy });
  const d = ds.find((x) => x.code === 'MG501');
  assert.ok(d && /the runs disagree/.test(d.message) && /measure again/.test(d.fix), 'MG501 from a step: ' + JSON.stringify(d));
}

// ---- MG442: an interior with only dimmed sky light
{
  const volumes = [{ min: [-2, 0, -2], max: [2, 3, 2], factor: 0.35, from: 'hut' }];
  assert.equal(insideVolume([0, 1.6, 0], volumes), volumes[0]);
  assert.equal(insideVolume([5, 1.6, 0], volumes), null);
  assert.equal(insideVolume([0, 1.6, 0], undefined), null);
  const step = (to, luma, dark = 0.6) => fromStep({ pass: true, checks: [], metrics: {}, to, frame: { luma, dark, clipped: 0 } }, { idx: 1, step: { name: 'inside' }, plan: {}, volumes });
  const dim = step([0, 0, 0], 25).filter((d) => d.code === 'MG442');
  assert.equal(dim.length, 1);
  assert.match(dim[0]?.message || '', /inside modules\/hut\.js's ambient volume is nearly black \(mean luma 25 of 255/);
  assert.match(dim[0]?.fix || '', /factor \(here 0\.35\).*Add a lamp/);
  assert.equal(dim[0]?.severity, 'warning');
  assert.ok(!step([0, 0, 0], 75).some((d) => d.code === 'MG442'), 'a lit room is not reported');
  assert.ok(!step([8, 0, 0], 25).some((d) => d.code === 'MG442'), 'a dark view outside any volume is not this diagnostic');
  const black = step([0, 0, 0], 2, 0.99);
  assert.ok(black.some((d) => d.code === 'MG440') && !black.some((d) => d.code === 'MG442'), 'a black frame stays MG440');
}
console.log(`pitfalls check: ${assert.failures.length ? 'FAILED' : 'ok'} (${assert.count} assertions)`);
