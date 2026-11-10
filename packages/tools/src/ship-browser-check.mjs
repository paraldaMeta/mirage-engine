#!/usr/bin/env node
// Mirage original code. What `mirage-ship` writes, in the real Chrome (docs/platforms.md):
//   node packages/tools/src/ship-browser-check.mjs [examples/garden-quest]
// 1 pwa, offline: first load with the network on; once the worker says the game is cached the server starts cutting
//   every connection; a reload (and a reload with a query string) must still reach window.__READY, served by the
//   worker, with nothing fetched from the network and no console error.
// 2 pwa, update: the server switches to a second build (version + 1); the open page finds it, holds it (updateReady),
//   applies it when told, reloads once and then runs the new version with the old cache gone.
// 3 the wrappers' content security policy: the Electron / Tauri build served with the policy as a header, and the
//   Capacitor build with its <meta> policy, must start with no securitypolicyviolation and no console error.
// No wrapper is started here (none is installed by this repo): this checks the web side of what they would load.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';
import { CSP } from './ship-gen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.resolve(process.argv[2] || path.join(here, '../../../examples/garden-quest'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-ship-browser-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm' };
const problems = [], notes = [];
const fail = (m) => { problems.push(m); console.log('  FAIL ' + m); }, pass = (m) => console.log('  ok   ' + m);

// a server whose folder can be swapped and whose line can be cut (a closed listener would still serve kept-alive sockets)
function server() {
  const st = { root: null, down: false, headers: {}, served: [], refused: 0 };
  const srv = http.createServer((req, res) => {
    if (st.down) { st.refused++; req.socket.destroy(); return; }
    let p = path.join(st.root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(st.root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404).end(); return; }
    st.served.push(path.relative(st.root, p));
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache', ...st.headers });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(Object.assign(st, { url: `http://127.0.0.1:${srv.address().port}/`, close: () => { srv.closeAllConnections?.(); srv.close(); } }))));
}
const ship = (target, out, extra = []) => JSON.parse(execFileSync(process.execPath, [path.join(here, 'ship.mjs'), example, '--target', target, '--out', out, '--dist', path.join(tmp, 'dist'), '--json', ...extra]).toString());
async function openPage(browser, url, { waitReady = true } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  if (waitReady) await page.waitForFunction('window.__READY === true', { timeout: 120000, polling: 100 });
  return { page, errors };
}
const swVersion = (page) => page.evaluate(() => new Promise((res) => {
  const c = navigator.serviceWorker.controller; if (!c) return res(null);
  const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(e.data.version); c.postMessage({ type: 'GET_VERSION' }, [ch.port2]); setTimeout(() => res('timeout'), 3000);
}));

let browser;
try {
  // one Vite build with relative URLs; every target below wraps the same files
  const vite = path.join(path.dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin/vite.js');
  execFileSync(process.execPath, [vite, 'build', '--base', './', '--outDir', path.join(tmp, 'dist'), '--emptyOutDir', '--logLevel', 'error'], { cwd: example, stdio: 'inherit' });
  const v1 = ship('pwa', path.join(tmp, 'pwa1'), ['--version', '1.0.0']), v2 = ship('pwa', path.join(tmp, 'pwa2'), ['--version', '1.0.1']);
  browser = await launch({ w: 960, h: 540 });

  console.log(`pwa (${path.basename(example)}, ${v1.files.length} files, ${(v1.bytes / 1e6).toFixed(2)} MB)`);
  const srv = await server(); srv.root = v1.out;
  const q = '?quality=low&hud=0&w=960&h=540';
  let t0 = Date.now();
  const { page, errors } = await openPage(browser, srv.url + q);
  const firstMs = Date.now() - t0;
  await page.waitForFunction('window.miragePWA && window.miragePWA.offlineReady && !!navigator.serviceWorker.controller', { timeout: 60000, polling: 100 });
  const cachedMs = Date.now() - t0;
  const ver1 = await swVersion(page);
  const cached = await page.evaluate(async () => { const k = (await caches.keys()).filter((n) => n.startsWith('mirage-')); return { caches: k, entries: k.length ? (await (await caches.open(k[0])).keys()).length : 0 }; });
  if (ver1 !== `1.0.0-${v1.swVersion}` && ver1 !== v1.swVersion) fail(`the worker says version ${ver1}, the build says ${v1.swVersion}`); else pass(`first load ${firstMs} ms, cached and controlled after ${cachedMs} ms: ${cached.entries} files in ${cached.caches[0]}`);
  // ---- offline
  srv.down = true; srv.served.length = 0;
  for (const [label, url] of [['reload', srv.url + q], ['another query string', srv.url + '?quality=low&hud=0&ui=0&w=960&h=540']]) {
    t0 = Date.now(); errors.length = 0;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction('window.__READY === true', { timeout: 120000, polling: 100 });
      const ms = Date.now() - t0, lit = await page.evaluate(() => { const c = document.querySelector('canvas'), d = document.createElement('canvas'); d.width = 64; d.height = 36; const g = d.getContext('2d'); g.drawImage(c, 0, 0, 64, 36); const p = g.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < p.length; i += 4) s += p[i] + p[i + 1] + p[i + 2]; return s / (p.length / 4) / 3; });
      if (errors.length) fail(`offline ${label}: console ${errors.slice(0, 3).join(' | ')}`);
      else if (srv.served.length) fail(`offline ${label}: the network was used (${srv.served.slice(0, 3).join(', ')})`);
      else if (lit < 4) fail(`offline ${label}: the canvas is black (mean ${lit.toFixed(1)})`);
      else { pass(`offline ${label}: ready in ${ms} ms with the server cutting every connection (${srv.refused} refused so far), canvas mean ${lit.toFixed(0)}/255`); notes.push({ offlineMs: ms }); }
    } catch (e) { fail(`offline ${label}: ${e.message.split('\n')[0]} ${errors.slice(0, 2).join(' | ')}`); }
  }
  // ---- update
  srv.down = false; srv.root = v2.out; errors.length = 0;
  try {
    await page.evaluate(() => window.miragePWA.check());
    await page.waitForFunction('window.miragePWA.updateReady === true', { timeout: 60000, polling: 100 });
    const held = await swVersion(page);
    if (held !== ver1) fail(`the new version took over before the page asked (${held})`); else pass('update: the new build is downloaded and waits; the page still runs the old one');
    const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => window.miragePWA.applyUpdate());
    await nav;
    await page.waitForFunction('window.__READY === true', { timeout: 120000, polling: 100 });
    const ver2 = await swVersion(page), left = await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('mirage-')));
    if (ver2 === ver1 || !String(ver2).includes(v2.swVersion)) fail(`after applyUpdate the worker is ${ver2}, expected ${v2.swVersion}`);
    else if (left.length !== 1) fail(`old caches were not removed: ${left.join(', ')}`);
    else pass(`update: applied on request, one reload, now ${ver2}; the old cache is gone`);
    if (errors.length) fail(`update: console ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) { fail(`update: ${e.message.split('\n')[0]}`); }
  await page.close(); srv.close();

  // ---- the wrappers' policy
  console.log('content security policy');
  for (const [target, headers] of [['desktop-electron', { 'content-security-policy': CSP, 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }], ['ios', {}]]) {
    const out = ship(target, path.join(tmp, target));
    const s = await server(); s.root = path.join(out.out, 'www'); s.headers = headers;
    try {
      const { page: p, errors: errs } = await openPage(browser, s.url + '?quality=low&hud=0&w=960&h=540&start');
      await new Promise((r) => setTimeout(r, 1500));
      const r = await p.evaluate(() => ({ csp: window.__csp, isolated: window.crossOriginIsolated, meta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'), native: typeof window.mirageNative }));
      const how = target === 'ios' ? 'the <meta> policy of the Capacitor builds' : 'the header policy of the Electron / Tauri builds';
      if (r.csp.length) fail(`${how}: violations ${[...new Set(r.csp)].slice(0, 4).join(' | ')}`);
      else if (errs.length) fail(`${how}: console ${errs.slice(0, 3).join(' | ')}`);
      else if (target === 'ios' && !r.meta) fail('the Capacitor page has no policy');
      else pass(`${how}: the game starts, no violation, no console error${target === 'ios' ? '' : `, crossOriginIsolated ${r.isolated}`}`);
      // the policy is not decoration: an inline script and a foreign fetch must be refused under the header
      if (target !== 'ios') {
        const blocked = await p.evaluate(async () => {
          const n = window.__csp.length; const sc = document.createElement('script'); sc.textContent = 'window.__inline = 1'; document.head.appendChild(sc);
          let fetched = false; try { await fetch('https://example.com/'); fetched = true; } catch { /* refused */ }
          await new Promise((res) => setTimeout(res, 100));
          return { inline: window.__inline === 1, fetched, seen: window.__csp.length - n };
        });
        if (blocked.inline || blocked.fetched) fail(`the policy let through: ${blocked.inline ? 'an inline script ' : ''}${blocked.fetched ? 'a fetch to another origin' : ''}`); else pass('the policy refuses an inline script and a fetch to another origin');
      }
      await p.close();
    } catch (e) { fail(`${target}: ${e.message.split('\n')[0]}`); }
    s.close();
  }
} finally {
  await browser?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(problems.length ? `ship-browser-check: ${problems.length} problem(s)` : 'ship-browser-check: all passed');
process.exit(problems.length ? 1 : 0);
