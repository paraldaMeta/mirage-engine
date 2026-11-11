#!/usr/bin/env node
// What a page actually fetches: serve a built folder, load it once, add up every response by kind.
//   node tools/loadsize.mjs <dist dir> "<query>" [--label name]
// Prints files and bytes per kind (js: raw and gzip; textures: .ktx2 / .webp; wasm; other) and the time to __READY.
import path from 'node:path';
import zlib from 'node:zlib';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const [dir, query = ''] = process.argv.slice(2);
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : path.basename(path.resolve(dir));
const srv = await serve(path.resolve(dir));
const browser = await launch({ w: 1280, h: 720 });
const kinds = {};
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[page:error] ' + e.message));
  const pending = [];
  page.on('response', (r) => pending.push((async () => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    let buf; try { buf = await r.buffer(); } catch { return; }
    const ext = path.extname(u.pathname).slice(1) || 'html';
    const kind = ext === 'js' || ext === 'mjs' ? 'js' : ext === 'ktx2' || ext === 'webp' || ext === 'png' || ext === 'jpg' ? 'textures' : ext === 'wasm' ? 'wasm' : 'other';
    const k = (kinds[kind] ||= { files: 0, bytes: 0, gzip: 0 });
    k.files++; k.bytes += buf.length; if (kind === 'js') k.gzip += zlib.gzipSync(buf).length;
  })()));
  const t0 = Date.now();
  await page.goto(srv.url + '?' + query, { waitUntil: 'load', timeout: 0 });
  await page.waitForFunction('window.__READY === true', { timeout: 900000, polling: 200 });
  const readyS = (Date.now() - t0) / 1000;
  await Promise.all(pending);
  const total = Object.values(kinds).reduce((a, k) => a + k.bytes, 0);
  const mb = (b) => +(b / 1048576).toFixed(2);
  console.log(JSON.stringify({ label, query, readyS: +readyS.toFixed(1), totalMB: mb(total), ...Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, { files: v.files, MB: mb(v.bytes), ...(v.gzip ? { gzipMB: mb(v.gzip) } : {}) }])) }));
} finally { await browser.close(); srv.close?.(); }
process.exit(0);
