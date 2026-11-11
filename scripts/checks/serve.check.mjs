// Mirage original code. The two static servers (the test server in packages/tools/src/chrome.mjs and the game
// server's page hosting in @miragekit/net/server) serve files inside their folder only, also when a symbolic link in the
// folder points out of it (the name check alone let `dist/leak -> /somewhere/else` through).
//   node scripts/checks/serve.check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ok } from '../soft-assert.mjs';
import { serve } from '../../packages/tools/src/chrome.mjs';
import { createServer } from '../../packages/net/src/server.js';
import { kitProtocol } from '../../packages/net/src/kit.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-serve-'));
const root = path.join(base, 'dist'), outside = path.join(base, 'outside');
fs.mkdirSync(path.join(root, 'sub'), { recursive: true }); fs.mkdirSync(outside);
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>home');
fs.writeFileSync(path.join(root, 'sub', 'a.js'), 'export default 1;');
fs.writeFileSync(path.join(root, 'sub', 'index.html'), 'sub home');
fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
fs.writeFileSync(path.join(outside, 'index.html'), 'SECRET INDEX');
fs.mkdirSync(path.join(base, 'dist-old')); fs.writeFileSync(path.join(base, 'dist-old', 'x.txt'), 'SIBLING');
let links = true;
try {
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));        // a file link out of the folder
  fs.symlinkSync(outside, path.join(root, 'leakdir'), 'dir');                            // a folder link out of it
  fs.symlinkSync(path.join(root, 'sub', 'a.js'), path.join(root, 'inside.js'));          // a link that stays inside: fine
  fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'dangling'));               // points at nothing
} catch { links = false; }   // (Windows without the privilege: the link cases are skipped, and said so)

// a raw request: fetch() and new URL() would normalise the '..' away before it reached the server
const get = (origin, rawPath) => new Promise((resolve) => {
  const u = new URL(origin);
  const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method: 'GET' }, (res) => { let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body })); });
  req.on('error', (e) => resolve({ status: 0, body: String(e) })); req.end();
});

async function suite(label, origin) {
  const t = async (p, status, body, what) => { const r = await get(origin, p); ok([].concat(status).includes(r.status) && (body === null || r.body.includes(body)) && !r.body.includes('SECRET') && !r.body.includes('SIBLING'), `${label}: ${what} (${p} -> ${r.status})`); };
  await t('/', 200, 'home', 'the folder index');
  await t('/sub/a.js', 200, 'export default', 'a file in a subfolder');
  await t('/sub/', 200, 'sub home', "a subfolder's index");
  await t('/nope.js', 404, null, 'a missing file is a 404');
  await t('/../outside/secret.txt', [403, 404], null, 'a raw ../ does not leave the folder');   // (the test server's URL parser folds it to /outside/...: 404)
  await t('/%2e%2e/outside/secret.txt', [403, 404], null, 'an encoded ../ does not leave the folder');
  await t('/..%2fdist-old/x.txt', 403, null, 'a sibling folder with the same prefix is refused');
  await t('/%E0%A4%A', 400, null, 'a malformed escape is a 400, not a crash');
  if (!links) { console.log(`  (${label}: symbolic links cannot be made here, link cases skipped)`); return; }
  await t('/leak.txt', 403, null, 'a file link that points out of the folder is refused');
  await t('/leakdir/secret.txt', 403, null, 'a file under a folder link that points out is refused');
  await t('/leakdir/', 403, null, "the index of a folder link that points out is refused");
  await t('/inside.js', 200, 'export default', 'a link that stays inside the folder is served');
  await t('/dangling', 404, null, 'a dangling link is a 404');
}

const a = await serve(root);
await suite('test server', a.url.replace(/\/$/, ''));
a.close();
// a root that is itself reached through a link still serves its own files
if (links) {
  fs.symlinkSync(root, path.join(base, 'dist-link'), 'dir');
  const b = await serve(path.join(base, 'dist-link'));
  const r = await get(b.url.replace(/\/$/, ''), '/sub/a.js'), r2 = await get(b.url.replace(/\/$/, ''), '/leak.txt');
  ok(r.status === 200 && r2.status === 403, `test server: a linked root serves its files (${r.status}) and still refuses the leak (${r2.status})`);
  b.close();
}
const net = createServer({ protocol: kitProtocol({ bounds: [-5, -5, 5, 5], y: [-2, 12] }), spawn: [0, 0, 0], dir: root });
const at = await net.listen();
await suite('net server', at.url);
await net.close();
fs.rmSync(base, { recursive: true, force: true });
console.log('serve check: done');
