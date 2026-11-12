// Mirage original code. Shared by the tools: launch the local Chrome headless with the GPU on, serve a folder.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// $CHROME, else the usual install places on macOS, Linux and Windows (the first that exists).
const CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  win32: ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].map((v) => `%${v}%\\Google\\Chrome\\Application\\chrome.exe`),
};
/** where Chrome is: $CHROME, else the first existing candidate for the platform; throws with the places tried */
export function findChrome({ env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  if (env.CHROME) return env.CHROME;
  const tried = (CANDIDATES[platform] || []).map((p) => p.replace(/%([^%]+)%/g, (_, v) => env[v] || ''));
  const hit = tried.find((p) => p && exists(p));
  if (hit) return hit;
  throw new Error(`mirage tools: no Chrome found; set CHROME=/path/to/chrome (tried: ${tried.join(', ') || 'nothing for ' + platform})`);
}
let chrome;
/** the Chrome the tools launch (found on first use, so importing this file never throws) */
export const chromePath = () => (chrome ??= findChrome());

// Headless capture flags on top of puppeteer's own defaults, which already carry --force-color-profile=srgb,
// --disable-renderer-backgrounding, --disable-background-timer-throttling, --disable-backgrounding-occluded-windows,
// --disable-extensions, --disable-sync, --mute-audio, --no-first-run (unit.mjs checks they still do). Added here: a
// page that is not in front keeps its timers and media (a leased browser holds several pages), no component updates
// or pings in the middle of a measurement. None of them changes a pixel (snap before / after: bit-identical).
export const CAPTURE_ARGS = ['--disable-background-media-suspend', '--disable-component-update', '--disable-domain-reliability', '--no-pings',
  '--disable-features=IntensiveWakeUpThrottling,BackForwardCache'];
/** the full Chrome command line launch() uses (without puppeteer's defaults) */
/** MIRAGE_GL=software: draw with SwiftShader through ANGLE (no GPU: a hosted CI runner). Slow and not bit-identical
 *  to a GPU, so timing expectations are reported but not gated (playtest) and stills compare by SSIM, never by bits. */
export const softwareGL = (env = process.env) => env.MIRAGE_GL === 'software';
export const SOFTWARE_GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const launchArgs = ({ w = 1440, h = 900, args = [], software = softwareGL() } = {}) =>
  // --disable-audio-output: Web Audio runs against a null sink, so the host's sound device cannot fail a test
  [...(software ? SOFTWARE_GL_ARGS : ['--enable-gpu', '--ignore-gpu-blocklist']), '--disable-gpu-watchdog', '--disable-audio-output', ...CAPTURE_ARGS, `--window-size=${w},${h}`, ...args];

export function launch({ w = 1440, h = 900, args = [] } = {}) {
  const other = process.env.MIRAGE_BROWSER;
  if (other) return launchPlaywright(other, { w, h });
  if (process.env.MIRAGE_POOL === '1') return lease({ w, h, args });
  return launchChrome({ w, h, args });
}
const launchChrome = ({ w, h, args }) => puppeteer.launch({
  executablePath: chromePath(), headless: true, defaultViewport: { width: w, height: h, deviceScaleFactor: 1 }, protocolTimeout: 900000,
  args: launchArgs({ w, h, args }),
});

// ---- the lease pool: one Chrome per command line for the whole tool run. lease() hands out a browser whose close()
// only gives it back; the next lease with the same size and arguments gets the same Chrome (a launch costs ~0.3-1 s
// and the GPU process' warm-up). Each lease gets its own browser context (an incognito-like profile: its own
// localStorage, so no quality pick, power-saver setting or game save, and its own HTTP cache), closed with its pages
// on release, so a page never sees another lease's state. A Chrome that crashes or disconnects leaves the pool. The
// browser closes POOL_IDLE_MS after its last release (or at drain()), so a tool exits.
// launch() leases when MIRAGE_POOL=1; tools that loop over many pages can call lease() directly.
const pool = new Map();   // key -> { browser: Promise, refs, timer }
export const POOL_IDLE_MS = 1500;
/** opts as launch(); launcher: how a Chrome starts (the checks pass a fake) */
export async function lease({ w = 1440, h = 900, args = [] } = {}, launcher = launchChrome) {
  const key = JSON.stringify([w, h, args]);
  let e = pool.get(key);
  if (!e) {
    e = { browser: Promise.resolve().then(() => launcher({ w, h, args })), refs: 0, timer: null };
    pool.set(key, e);
    const entry = e;
    // a crashed or closed Chrome must not be handed out again (only this entry: a newer one may hold the key)
    entry.browser.then((b) => b.on?.('disconnected', () => { if (pool.get(key) === entry) pool.delete(key); }), () => {});
  }
  e.refs++;
  clearTimeout(e.timer); e.timer = null;
  let browser;
  try { browser = await e.browser; } catch (err) { e.refs--; if (pool.get(key) === e) pool.delete(key); throw err; }
  const context = await browser.createBrowserContext();
  let released = false;
  return {
    pooled: true, browser, context, target: () => browser.target(), version: () => browser.version(),
    newPage: () => context.newPage(),
    async close() {
      if (released) return; released = true;
      await context.close().catch(() => {});   // its pages with it
      if (--e.refs > 0) return;
      e.timer = setTimeout(() => { if (e.refs === 0 && pool.get(key) === e) { pool.delete(key); browser.close().catch(() => {}); } }, POOL_IDLE_MS);
    },
  };
}
/** close every pooled browser now */
export async function drain() {
  const all = [...pool.values()]; pool.clear();
  await Promise.all(all.map(async (e) => { clearTimeout(e.timer); (await e.browser.catch(() => null))?.close().catch(() => {}); }));
}
/** how many browsers the pool holds (for the checks) */
export const poolSize = () => pool.size;

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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
/** a static server for a built folder; resolves to { url, close() } */
export function serve(dir, port = 0) {
  // the real folder: a root that is itself a symlink (macOS /tmp) compares equal to the real paths below
  const root = fs.existsSync(dir) ? fs.realpathSync(path.resolve(dir)) : path.resolve(dir);
  const inside = (p) => p === root || p.startsWith(root + path.sep);
  const server = http.createServer((req, res) => {
    let p;
    try { p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); }
    catch { res.writeHead(400).end(); return; }   // a malformed %-escape used to crash the test server
    if (p.includes('\0')) { res.writeHead(400).end(); return; }
    // inside root only: '/srv/dist-old' starts with '/srv/dist' but is not in it
    if (!inside(p)) { res.writeHead(403).end(); return; }
    // ...and after symlinks are followed: a link inside the folder that points out of it (dist/x -> ~/.ssh) is not
    // served. The name check above cannot see it; the file that would be read is what counts.
    let real;
    try { real = fs.realpathSync(p); if (fs.statSync(real).isDirectory()) real = fs.realpathSync(path.join(real, 'index.html')); }
    catch { res.writeHead(404).end(); return; }
    if (!inside(real)) { res.writeHead(403).end(); return; }
    if (!fs.statSync(real).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(real)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

/** open a page, collect console errors and page errors (errors), console warnings (warnings), wait for window.__READY.
 *  On failure the thrown error carries .errors / .warnings / .stacks (what the page said before it failed).
 *  viewport: set before loading (e.g. { width, height, hasTouch: true } for a touch screen) */
export async function open(browser, url, { timeout = 180000, viewport } = {}) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
  const errors = [], warnings = [], stacks = [];   // stacks: of page errors (file:line for the diagnostics)
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('error: ' + m.text());
    else if (m.type() === 'warn' || m.type() === 'warning') warnings.push('warning: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('pageerror', (e) => { if (e.stack) stacks.push(e.stack); });
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'load', timeout });
    await page.waitForFunction('window.__READY === true', { timeout, polling: 100 });
  } catch (e) {   // the caller can still report what the page said before it failed
    e.errors = errors; e.warnings = warnings; e.stacks = stacks; e.page = page;
    throw e;
  }
  return { page, errors, warnings, stacks, loadMs: Date.now() - t0 };
}
