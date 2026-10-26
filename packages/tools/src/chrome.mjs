// Mirage original code. Shared by the tools: launch the local Chrome headless with the GPU on, serve a folder.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export function launch({ w = 1440, h = 900, args = [] } = {}) {
  const other = process.env.MIRAGE_BROWSER;
  if (other) return launchPlaywright(other, { w, h });
  return puppeteer.launch({
    executablePath: CHROME, headless: true, defaultViewport: { width: w, height: h, deviceScaleFactor: 1 }, protocolTimeout: 900000,
    // --disable-audio-output: Web Audio runs against a null sink, so the host's sound device cannot fail a test
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-audio-output', `--window-size=${w},${h}`, ...args],
  });
}

// MIRAGE_BROWSER=webkit | firefox (Safari's and Firefox's engines through Playwright, not a dependency here:
// MIRAGE_PLAYWRIGHT=/path/to/node_modules/playwright/index.js). Pages get the few puppeteer calls the tools use.
// ponytail: enough for playtest.mjs and perf.mjs; the garden-quest playthrough's touch / gamepad parts are Chrome-only.
async function launchPlaywright(name, { w, h }) {
  const pw = await import(process.env.MIRAGE_PLAYWRIGHT || 'playwright');
  const browser = await (pw[name] || pw.default[name]).launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  return {
    async newPage() {
      const page = await context.newPage();
      const evaluate = page.evaluate.bind(page), wait = page.waitForFunction.bind(page);
      page.evaluate = (fn, ...a) => (typeof fn === 'function' ? evaluate(`(${fn})(...${JSON.stringify(a)})`) : evaluate(fn));
      page.waitForFunction = (fn, o = {}) => wait(fn, undefined, { timeout: o.timeout, polling: o.polling });
      page.setViewport = (v) => page.setViewportSize({ width: v.width, height: v.height });
      return page;
    },
    close: () => browser.close(),
  };
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

/** open a page, collect console errors and page errors (errors), console warnings (warnings), wait for window.__READY */
export async function open(browser, url, { timeout = 180000 } = {}) {
  const page = await browser.newPage();
  const errors = [], warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('error: ' + m.text());
    else if (m.type() === 'warn' || m.type() === 'warning') warnings.push('warning: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction('window.__READY === true', { timeout, polling: 100 });
  return { page, errors, warnings, loadMs: Date.now() - t0 };
}
