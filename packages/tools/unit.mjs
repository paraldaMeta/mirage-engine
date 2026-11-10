// Node checks of the tools that need no browser: `npm test -w @mirage/tools`
import assert from 'node:assert/strict';
import { findChrome } from './src/chrome.mjs';

// $CHROME wins; otherwise the first install place that exists, per platform
assert.equal(findChrome({ env: { CHROME: '/x/chrome' }, platform: 'linux', exists: () => false }), '/x/chrome');
assert.equal(findChrome({ env: {}, platform: 'darwin', exists: (p) => p.includes('Google Chrome.app') }), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
assert.equal(findChrome({ env: {}, platform: 'linux', exists: (p) => p === '/usr/bin/chromium' }), '/usr/bin/chromium');
assert.equal(findChrome({ env: { LOCALAPPDATA: 'C:\\U\\Local' }, platform: 'win32', exists: (p) => p.startsWith('C:\\U') }), 'C:\\U\\Local\\Google\\Chrome\\Application\\chrome.exe');
// nothing found: the message says what to set and where it looked
assert.throws(() => findChrome({ env: {}, platform: 'linux', exists: () => false }), /set CHROME=.*\/usr\/bin\/google-chrome/);
assert.throws(() => findChrome({ env: {}, platform: 'aix', exists: () => true }), /nothing for aix/);
console.log('tools unit: ok');

// an output folder is emptied only when it is clearly the tool's own (mirage-deploy --out . once deleted the cwd)
import { checkOut } from './src/safe-out.mjs';
const fakeFs = (tree) => ({ existsSync: (p) => p in tree, statSync: (p) => ({ isDirectory: () => Array.isArray(tree[p]) }), readdirSync: (p) => tree[p] });
const env = { cwd: '/w/proj', home: '/home/u', fsx: fakeFs({ '/w/proj/deploy/a': ['.nojekyll', '.mirage-deploy', 'index.html'], '/w/pages': ['.nojekyll', '.git', 'CNAME', 'index.html'], '/w/other': ['notes.txt'], '/w/empty': [], '/w/file': 'x' }) };
const refuses = (out, extra = {}) => { try { checkOut(out, { ...env, marker: '.mirage-deploy', ...extra }); return null; } catch (e) { return e.message; } };
assert.match(refuses('/w/proj'), /is or contains \/w\/proj/, 'the current folder');
assert.match(refuses('/w'), /contains/, 'a parent of the current folder');
assert.match(refuses('/'), /filesystem root/, 'the root');
assert.match(refuses('/home/u'), /contains \/home\/u/, 'home');
assert.match(refuses('/x/ex', { keep: ['/x/ex/sub'] }), /contains \/x\/ex\/sub/, 'a folder holding the example');
assert.match(refuses('/w/other'), /not empty and has no \.mirage-deploy/, 'a non-empty folder from somewhere else');
assert.match(refuses('/w/pages'), /has no \.mirage-deploy/, 'a Pages folder with .nojekyll but not made by the tool (its .git would go)');
assert.match(refuses('/w/file'), /is a file/, 'a file');
assert.equal(refuses('/w/proj/deploy/a'), null, 'an earlier deploy folder');
assert.equal(refuses('/w/empty'), null, 'an empty folder');
assert.equal(refuses('/w/proj/deploy/new'), null, 'a new folder');
console.log('tools unit: safe output folders ok');

// the static test server: a malformed %-escape is a 400 (it crashed the server), a sibling folder sharing the
// root's prefix is out of bounds (review #22)
{
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), http = await import('node:http');
  const { serve } = await import('./src/chrome.mjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-serve-'));
  fs.mkdirSync(path.join(base, 'dist')); fs.mkdirSync(path.join(base, 'dist-old'));
  fs.writeFileSync(path.join(base, 'dist', 'index.html'), 'ok'); fs.writeFileSync(path.join(base, 'dist-old', 'secret.txt'), 'no');
  const srv = await serve(path.join(base, 'dist'));
  const get = (p) => new Promise((r) => http.get(srv.url.replace(/\/$/, '') + p, (res) => { res.resume(); r(res.statusCode); }).on('error', () => r('error')));
  assert.equal(await get('/%E0%A4%A'), 400, 'malformed escape');
  assert.equal(await get('/../dist-old/secret.txt'), 404, 'path climbing is normalised by the URL parser');
  assert.equal(await get('/..%2Fdist-old/secret.txt'), 403, 'an encoded climb into a same-prefix sibling (old code served it)');
  assert.equal(await get('/'), 200, 'the index still serves');
  srv.close(); fs.rmSync(base, { recursive: true, force: true });
  console.log('tools unit: static server ok');
}

// the single-file packager inlines a stylesheet index.html links (it passed with a dangling <link>, no CSS)
{
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const ex = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-css-'));
  fs.writeFileSync(path.join(ex, 'index.html'), '<!doctype html><script type="module" src="./main.js"></script>');
  fs.writeFileSync(path.join(ex, 'main.js'), "import './style.css'; document.body.append('hi');");
  fs.writeFileSync(path.join(ex, 'style.css'), 'body { color: rgb(1, 2, 3); }');
  const out = path.join(ex, 'out.html');
  execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/package.mjs'), ex, '--out', out], { stdio: 'ignore' });
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(/<style>[^<]*color:\s*(#010203|rgb\(1, ?2, ?3\))/.test(html) && !/rel="stylesheet"/.test(html), 'the stylesheet is inlined: ' + html.slice(0, 300));
  fs.rmSync(ex, { recursive: true, force: true });
  console.log('tools unit: packager inlines CSS ok');
}

// playtest "see": the reason a failed check gives, from the ID-pass numbers (share = seen, alone = with nothing in front)
import { seeWhy } from './src/see.mjs';
assert.match(seeWhy({ share: 0, alone: 0, occluders: [] }, 0.001), /^out of frame/);
assert.match(seeWhy({ share: 0, alone: 0.08, occluders: [['station/wall', 0.9], ['trail/post', 0.1]] }, 0.001), /^hidden: 8\.0 % .* covered by station\/wall 90\.0 %, trail\/post 10\.0 %/);
assert.match(seeWhy({ share: 0.01, alone: 0.05, occluders: [['verge/grass-tufts', 0.8]] }, 0.02), /^mostly hidden \(80\.0 % of it\) by verge\/grass-tufts/);
assert.match(seeWhy({ share: 0.004, alone: 0.004, occluders: [] }, 0.01), /^too small: 0\.40 % of the frame even with nothing in front/);
assert.equal(seeWhy(undefined), '');
console.log('see unit: ok');
