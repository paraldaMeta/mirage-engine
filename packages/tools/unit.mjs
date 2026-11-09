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
const env = { cwd: '/w/proj', home: '/home/u', fsx: fakeFs({ '/w/proj/deploy/a': ['.nojekyll', 'index.html'], '/w/other': ['notes.txt'], '/w/empty': [], '/w/file': 'x' }) };
const refuses = (out, extra = {}) => { try { checkOut(out, { ...env, marker: '.nojekyll', ...extra }); return null; } catch (e) { return e.message; } };
assert.match(refuses('/w/proj'), /is or contains \/w\/proj/, 'the current folder');
assert.match(refuses('/w'), /contains/, 'a parent of the current folder');
assert.match(refuses('/'), /filesystem root/, 'the root');
assert.match(refuses('/home/u'), /contains \/home\/u/, 'home');
assert.match(refuses('/x/ex', { keep: ['/x/ex/sub'] }), /contains \/x\/ex\/sub/, 'a folder holding the example');
assert.match(refuses('/w/other'), /not empty and has no \.nojekyll/, 'a non-empty folder from somewhere else');
assert.match(refuses('/w/file'), /is a file/, 'a file');
assert.equal(refuses('/w/proj/deploy/a'), null, 'an earlier deploy folder');
assert.equal(refuses('/w/empty'), null, 'an empty folder');
assert.equal(refuses('/w/proj/deploy/new'), null, 'a new folder');
console.log('tools unit: safe output folders ok');
