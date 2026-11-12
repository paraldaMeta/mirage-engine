#!/usr/bin/env node
// Check: the installable web app (after `npm run build`). Serves dist/ on 127.0.0.1 in headless Chrome and fails unless
//   the manifest parses (Chrome's own parser, no errors) with the name, fullscreen, landscape, relative start_url and
//   scope, and a maskable icon; the service worker installs, controls the page and has every file of dist/sw.js's
//   FILES in its cache; and a reload with the network gone (server closed, page and worker offline) comes back READY
//   from the worker with no errors.
// With release/neon-district.html present (npm run package) it also opens that from file://: READY, no errors, no
// service worker.
// usage: node scripts/pwa-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), dist = path.join(root, 'dist');
const bad = [], ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) bad.push(msg); };
const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
const FILES = JSON.parse(sw.match(/const FILES = (\[.*\]);/)[1]), VERSION = sw.match(/const VERSION = '(\w+)'/)[1];
ok(VERSION !== 'dev' && FILES.length > 5, `dist/sw.js: version ${VERSION}, ${FILES.length} files to precache`);

const server = await serve(dist);
const browser = await launch({ w: 1280, h: 720 });
try {
  const { page, errors } = await open(browser, server.url);
  ok(!errors.length, `first load READY, ${errors.length} errors ${errors.slice(0, 3).join(' | ')}`);
  const cdp = await page.createCDPSession();
  const m = await cdp.send('Page.getAppManifest');
  const man = m.data ? JSON.parse(m.data) : {};
  ok(m.url.endsWith('/manifest.webmanifest') && !m.errors.length, `manifest ${m.url} parses (${m.errors.length} errors ${m.errors.map((e) => e.message).join('; ')})`);
  ok(man.name === 'NEON DISTRICT' && man.display === 'fullscreen' && man.orientation === 'landscape' && man.start_url === './' && man.scope === './',
    `manifest fields: ${man.name} · ${man.display} · ${man.orientation} · start_url ${man.start_url} · scope ${man.scope}`);
  ok(man.icons?.some((i) => i.purpose === 'maskable') && man.icons.every((i) => fs.existsSync(path.join(dist, i.src))), `icons: ${man.icons?.map((i) => `${i.src} ${i.sizes} ${i.purpose}`).join(', ')}`);
  const inst = await cdp.send('Page.getInstallabilityErrors').catch(() => null);
  if (inst) ok(!inst.installabilityErrors.length, `installable (${inst.installabilityErrors.map((e) => e.errorId).join(', ') || 'no errors'})`);

  await page.waitForFunction('navigator.serviceWorker.controller', { timeout: 60000 });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys(), c = await caches.open(keys.find((k) => k.startsWith('neon-district-')));
    return { keys, urls: (await c.keys()).map((r) => r.url), script: navigator.serviceWorker.controller.scriptURL };
  });
  const want = FILES.map((f) => new URL(f, server.url).href), missing = want.filter((u) => !cached.urls.includes(u));
  ok(cached.keys.includes('neon-district-' + VERSION) && !missing.length, `service worker ${cached.script} controls the page; cache ${cached.keys.join(', ')} holds ${cached.urls.length} / ${want.length} files${missing.length ? ' (missing ' + missing.join(', ') + ')' : ''}`);

  // the network gone: the server closed, the page and the worker offline
  server.close();
  await page.setOfflineMode(true);
  const wt = (await browser.targets()).find((t) => t.type() === 'service_worker');
  if (wt) { const ws = await wt.createCDPSession(); await ws.send('Network.enable').catch(() => {}); await ws.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {}); }
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  const res = await page.reload({ waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  ok(res.fromServiceWorker() && !errs.length, `offline reload: READY, page from the service worker ${res.fromServiceWorker()}, ${errs.length} errors ${errs.slice(0, 3).join(' | ')}`);
  await page.close();

  const single = path.join(root, 'release/neon-district.html');
  if (fs.existsSync(single)) {
    const f = await open(browser, pathToFileURL(single).href);
    const reg = await f.page.evaluate(() => ({ proto: location.protocol, sw: !!navigator.serviceWorker?.controller, manifest: !!document.querySelector('link[rel=manifest]') }));
    ok(!f.errors.length && !reg.sw, `${path.relative(root, single)} from ${reg.proto} READY, ${f.errors.length} errors, service worker ${reg.sw}, manifest link ${reg.manifest} ${f.errors.slice(0, 3).join(' | ')}`);
  }
} finally { server.close(); await browser.close(); }
console.log(bad.length ? `pwa-check: ${bad.length} failed` : 'pwa-check: ok');
process.exit(bad.length ? 1 : 0);
