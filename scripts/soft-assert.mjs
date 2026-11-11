// Mirage original code. node:assert/strict that keeps going: a check script that imports this instead of
// 'node:assert/strict' runs to its end and then reports EVERY failed assertion with a count, instead of stopping at
// the first one (one run used to show one failure; the next was found only after fixing it).
//   import assert from '../../scripts/soft-assert.mjs';     // the only line that changes in a check script
//   assert.equal(a, b, 'message');  assert.ok(x);  assert.throws(fn);  await assert.rejects(promise);  assert(x);
// What is tested does not change: every method is node's own, called with the same arguments; only the throw is
// caught and recorded (message, file:line of the assertion). At exit the process prints
//   `<script>: N of M assertions FAILED` and the list, and exits 1; with none failed it adds nothing to the output.
// Limits, on purpose:
//   - Code after a failed assertion still runs, so a later statement may crash on a value the assertion guarded
//     (a TypeError on undefined). That crash ends the script as before; the failures recorded so far are printed
//     first, then the crash, so the first cause is still on screen.
//   - `assert.strict`, `assert.AssertionError` and `assert.fail` behave the same way (fail is recorded, not thrown).
//   - MIRAGE_ASSERT=hard gives the original stop-at-first behaviour back (to get a stack trace at the failing line).
import hard from 'node:assert/strict';
import path from 'node:path';

const failures = [];
let total = 0;
const HARD = process.env.MIRAGE_ASSERT === 'hard';
const script = path.basename(process.argv[1] || 'check');

// file:line of the caller in the check script (first stack frame outside this file and node's internals)
function where(err) {
  const frame = String(err.stack || '').split('\n').find((l) => /^\s+at /.test(l) && !l.includes('soft-assert.mjs') && !l.includes('node:'));   // (a message may span lines)
  const m = frame && /((?:file:\/\/)?[^\s()]+):(\d+):\d+\)?$/.exec(frame.trim());
  return m ? `${path.basename(m[1])}:${m[2]}` : '';
}
function record(err) {
  if (HARD || !(err instanceof hard.AssertionError)) throw err;
  failures.push({ at: where(err), message: String(err.message).split('\n').slice(0, 6).join('\n      ') });
}
function soften(fn) {
  return function softened(...args) {
    total++;
    let r;
    try { r = fn.apply(hard, args); } catch (e) { record(e); return undefined; }
    // rejects / doesNotReject return a promise: record its assertion error the same way
    if (r && typeof r.then === 'function') return r.then((v) => v, (e) => { record(e); });
    return r;
  };
}

const assert = soften(hard);
for (const k of Object.keys(hard)) assert[k] = typeof hard[k] === 'function' && k !== 'AssertionError' && k !== 'CallTracker' ? soften(hard[k]) : hard[k];
assert.strict = assert;
/** failures recorded so far: [{ at, message }] (for a script that wants to print its own summary) */
assert.failures = failures;
/** how many assertions ran */
Object.defineProperty(assert, 'count', { get: () => total });

let reported = false;
function report() {
  if (!failures.length || reported) return;
  reported = true;
  console.error(`\n${script}: ${failures.length} of ${total} assertions FAILED`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f.at ? f.at + '  ' : ''}${f.message}`));
}
// a crash after a failed assertion: the recorded failures first (the cause), then node prints the crash
process.on('uncaughtExceptionMonitor', () => report());
process.on('exit', (code) => {
  if (!failures.length) return;
  report();
  if (code === 0) process.exitCode = 1;   // also after an explicit process.exit(0) at the end of a script
});

export default assert;
export { assert };
/** the `ok(condition, message)` of the print-as-you-go check scripts: prints `  ok message` or `FAIL message`, records
 *  the failure and goes on (it used to exit at the first one) */
export function ok(c, m) {
  total++;
  if (c) { console.log('  ok', m); return; }
  if (HARD) { console.error('FAIL', m); process.exit(1); }
  failures.push({ at: where(new Error('x')), message: String(m) }); console.error('FAIL', m);
}
/** the same, silent on success */
export function okQuiet(c, m) {
  total++;
  if (c) return;
  if (HARD) { console.error('FAIL', m); process.exit(1); }
  failures.push({ at: where(new Error('x')), message: String(m) }); console.error('FAIL', m);
}
