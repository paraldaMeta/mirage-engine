// Mirage original code. The single-file packager's worker step (packages/tools/src/embed-workers.mjs): what it
// rewrites, what it leaves alone and what it refuses; then one real package with a worker, and the rewritten bundle
// run in Node with a stand-in Worker to see the Blob source arrive.   node scripts/checks/embed-workers.check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'vite';
import assert from '../soft-assert.mjs';
import { embedWorkers, htmlSafe, scriptCloses, refersTo, classicProblem } from '../../packages/tools/src/embed-workers.mjs';

const W = (name, src = 'self.onmessage=(e)=>self.postMessage(e.data+1);') => ({ name, src });
const run = (js, workers, o) => embedWorkers(js, workers, parseAst, o);

// ---- what counts as a reference
assert.ok(refersTo('/assets/w-1.js', 'w-1.js') && refersTo('w-1.js', 'w-1.js') && refersTo('./assets/w-1.js?v=2#x', 'w-1.js'));
assert.ok(!refersTo('/assets/my-w-1.js', 'w-1.js'), 'a longer file name that ends the same way is another file');
assert.ok(!refersTo('see w-1.js for details', 'w-1.js') && !refersTo(3, 'w-1.js'));

// ---- the shapes Vite writes
{
  const r = run('const a=new Worker(new URL("/assets/w-1.js",import.meta.url),{type:"module"});', [W('w-1.js')]);
  assert.equal(r.js, 'const a=new Worker(new URL(__W0,import.meta.url));', 'new URL form: literal replaced, module type dropped');
  assert.match(r.pre, /^const __W0=URL\.createObjectURL\(new Blob\(\["self\.onmessage/);
  assert.deepEqual(r.embedded, [{ name: 'w-1.js', references: 1, bytes: W('w').src.length }]);
}
assert.equal(run('function f(o){return new Worker("/assets/w-1.js",{type:"module",name:o?.name})}', [W('w-1.js')]).js,
  'function f(o){return new Worker(__W0,{name:o?.name})}', '?worker wrapper: the name option stays');
assert.equal(run("new Worker('/assets/w-1.js',{name:'n',type:'module'})", [W('w-1.js')]).js, "new Worker(__W0,{name:'n'})", 'type last');
assert.equal(run('new Worker(`/assets/w-1.js`)', [W('w-1.js')]).js, 'new Worker(__W0)', 'a template without ${} is a literal');
assert.equal(run('new Worker("/assets/w-1.js",{type:"classic"})', [W('w-1.js')]).js, 'new Worker(__W0,{type:"classic"})', 'a classic worker keeps its options');
assert.equal(run('const u="/assets/w-1.js";const s="it\'s \\"quoted\\"";new Worker(u)', [W('w-1.js')]).js, 'const u=__W0;const s="it\'s \\"quoted\\"";new Worker(u)',
  'a reference held in a variable; strings with quotes inside are not confused');
// two workers, one name a suffix of the other: each gets its own variable (a text replace took the wrong one)
{
  const r = run('new Worker("/assets/w-1.js");new Worker("/assets/my-w-1.js");', [W('w-1.js', 'A()'), W('my-w-1.js', 'B()')]);
  assert.equal(r.js, 'new Worker(__W0);new Worker(__W1);');
  assert.ok(r.pre.includes('__W0=URL.createObjectURL(new Blob(["A()"]') && r.pre.includes('__W1=URL.createObjectURL(new Blob(["B()"]'));
}
// text that only mentions the file is left alone... and then refused, because the name is still in the bundle
assert.throws(() => run('new Worker("/assets/w-1.js");console.log("failed to load /assets/w-1.js, retrying")', [W('w-1.js')]), /left in the bundle/);
assert.throws(() => run('const base="/assets/";new Worker(`${base}w-1.js`)', [W('w-1.js')]), /could not find a reference|left in the bundle/, 'a reference built at run time');
assert.throws(() => run('new Worker("/assets/w-1.js",opts)', [W('w-1.js')]), /options the packager cannot read/);
assert.throws(() => run('new Worker("/assets/w-1.js",{...o,type:"module"})', [W('w-1.js')]), /options the packager cannot read/);
assert.throws(() => run('new Worker("/assets/w-1.js",{type:kind})', [W('w-1.js')]), /not a string literal/);
assert.throws(() => run('const __W0=1;new Worker("/assets/w-1.js")', [W('w-1.js')]), /already uses the name __W0/);
// workers that cannot run classic, found in the syntax (the old test was a line-start regular expression)
assert.equal(classicProblem('const a=1;import"./x.js";', parseAst), 'has a top-level import', 'an import in the middle of a minified line');
assert.equal(classicProblem('const a=1;export{a};', parseAst), 'has a top-level export');
assert.equal(classicProblem('fetch(new URL("x",import.meta.url))', parseAst), 'uses import.meta');
assert.equal(classicProblem('const s="import x from y";const t=`export default`;import("./late.js")', parseAst), null, 'the words in strings, and a dynamic import(), are fine');
assert.match(classicProblem('const = ;', parseAst), /^does not parse/);
assert.throws(() => run('new Worker("/assets/w-1.js")', [W('w-1.js', 'import{a}from"./a.js";a()')]), /top-level import; it cannot run as a classic worker/);
assert.throws(() => run('new Worker("/assets/w-1.js")', [W('w-1.js', 'fetch("/assets/data-9.bin")')], { otherFiles: ['data-9.bin'] }), /refers to data-9\.bin/);
assert.deepEqual(run('let x=1;', []), { js: 'let x=1;', pre: '', embedded: [] });

// ---- inside <script>
{
  const js = 'const a="</script><script>alert(1)</script>",b=`<!-- ${a} <script `,c=/<\\/script|\\<!--/,d=1</script/.test(a),e=a<script;';   // (in a module `<!--` in code is operators too; vm runs scripts, where it is a comment)
  const safe = htmlSafe(js, parseAst);
  assert.ok(!/<\/script|<script|<!--/i.test(safe), 'no closing tag, opening tag or comment opener is left: ' + safe);
  const ctx = { script: 'zz' }; vm.runInNewContext(js.replace('const ', 'var ') + ';globalThis.out=[a,b,String(c),d,e]', ctx);
  const ctx2 = { script: 'zz' }; vm.runInNewContext(safe.replace('const ', 'var ') + ';globalThis.out=[a,b,String(c),d,e]', ctx2);
  assert.deepEqual([ctx2.out[0], ctx2.out[1], ctx2.out[3], ctx2.out[4]], [ctx.out[0], ctx.out[1], ctx.out[3], ctx.out[4]], 'strings and the code around them have the same value after escaping');
  assert.ok(new RegExp(ctx2.out[2].slice(1, -1)).test('<!--') && new RegExp(ctx2.out[2].slice(1, -1)).test('</script'), 'the regular expression still matches the same text');
  assert.equal(htmlSafe('let x=1;', parseAst), 'let x=1;');
  // a worker source with the dangerous pair goes into the page as a string and must not hide the closing tag
  const r = run('new Worker("/assets/w-1.js")', [W('w-1.js', 'const h="<!-- <script>";')]);
  assert.ok(scriptCloses(r.pre + r.js) && !/<script|<!--/.test(r.pre), 'worker source escaped: ' + r.pre);
  const got = {}; vm.runInNewContext(r.pre.replace('URL.createObjectURL(new Blob([', 'globalThis.src=(([').replace('],{type:"text/javascript"}));', '])[0]);'), got);
  assert.equal(got.src, 'const h="<!-- <script>";', 'and is the same source when read back');
}
assert.equal(scriptCloses('var a=1'), true);
assert.equal(scriptCloses('var a="<!--";var b="<script>"'), false, '<!-- then <script: the closing tag would be swallowed');
assert.equal(scriptCloses('var a="<!--";var b="-->";var c="<script>"'), true);
assert.equal(scriptCloses('var a="</script>"'), false, 'a closing tag in the text ends the script early');

// ---- a real package: a page with a module worker, packed to one file, then the inline script run with a stand-in
// Worker (Node has Blob and URL.createObjectURL): the worker source arrives whole and no file is referenced
{
  const ex = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-worker-'));
  fs.writeFileSync(path.join(ex, 'index.html'), '<!doctype html><script type="module" src="./main.js"></script>');
  fs.writeFileSync(path.join(ex, 'main.js'), "const w = new Worker(new URL('./job.worker.js', import.meta.url), { type: 'module', name: 'job' });\nw.onmessage = (e) => { globalThis.answer = e.data; };\nw.postMessage(41);\n");
  fs.writeFileSync(path.join(ex, 'job.worker.js'), "self.onmessage = (e) => self.postMessage([e.data + 1, '</script><!-- <script>' + e.data]);\n");
  const out = path.join(ex, 'out.html');
  const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../packages/tools/src/package.mjs');
  let log = '';
  try { log = execFileSync(process.execPath, [pkg, ex, '--out', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { assert.fail('packaging a page with a worker failed: ' + String(e.stderr || e.message).slice(0, 600)); }
  if (fs.existsSync(out)) {
    const html = fs.readFileSync(out, 'utf8');
    assert.match(log, /worker job\.worker-[\w-]+\.js .* embedded, 1 reference/);
    const m = /<script type="module">\n([\s\S]*)\n<\/script>/.exec(html);
    assert.ok(m && !/assets\//.test(html), 'one inline script, no asset path left');
    assert.equal((html.match(/<\/script/gi) || []).length, 1, 'exactly one closing script tag in the file');
    assert.ok(scriptCloses(m[1]), 'the HTML parser finds the end of the script');
    const started = [];
    class FakeWorker { constructor(url, opts) { started.push({ url: String(url), opts }); } postMessage() {} }
    vm.runInNewContext(m[1].replaceAll('import.meta.url', '"file:///out.html"'), { URL, Blob, Worker: FakeWorker, globalThis: {} });
    assert.ok(started.length === 1 && started[0].url.startsWith('blob:'), 'the worker is started from a Blob URL: ' + JSON.stringify(started));
    assert.ok(started[0] && started[0].opts?.type !== 'module' && started[0].opts?.name === 'job', 'as a classic worker, its name kept');
    const { resolveObjectURL } = await import('node:buffer');
    const src = started[0] ? await resolveObjectURL(started[0].url)?.text() : '';
    assert.ok(src && src.includes('postMessage') && src.includes('<!-- <script>'), 'the Blob holds the worker source, byte for byte where it matters: ' + String(src).slice(0, 120));
  }
  fs.rmSync(ex, { recursive: true, force: true });
}
console.log(`embed-workers check: ${assert.failures.length ? 'FAILED' : 'ok'} (${assert.count} assertions)`);
