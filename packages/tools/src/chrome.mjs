// Mirage original code. Shared by the tools: launch the local Chrome headless with the GPU on, serve a folder.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export function launch({ w = 1440, h = 900, args = [] } = {}) {
  return puppeteer.launch({
    executablePath: CHROME, headless: true, defaultViewport: { width: w, height: h, deviceScaleFactor: 1 }, protocolTimeout: 900000,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', `--window-size=${w},${h}`, ...args],
  });
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
/** a static server for a built folder; resolves to { url, close() } */
export function serve(dir, port = 0) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

/** open a page, collect console errors / warnings and page errors, wait for window.__READY */
export async function open(browser, url, { timeout = 180000 } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction('window.__READY === true', { timeout, polling: 100 });
  return { page, errors, loadMs: Date.now() - t0 };
}
