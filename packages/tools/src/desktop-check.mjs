#!/usr/bin/env node
// Mirage original code. Launches a desktop build made by `mirage-ship --target desktop-electron` for real and
// drives it over the DevTools protocol: the check the scaffold never had, because nothing here can tell from the
// files alone that the window opens, the GPU is used, the bridge is there and the saves survive a restart.
//
// usage: node packages/tools/src/desktop-check.mjs <scaffold folder> [--exe <packaged binary>] [--seconds 4] [--json]
//        npm run test:desktop [-- <scaffold folder> ...]   (no folder and no MIRAGE_DESKTOP_APP: skipped, exit 0)
//   <scaffold folder>   the folder mirage-ship wrote, after `npm install` in it (that fetches Electron)
//   --exe               check a packaged app instead of `electron .`, e.g.
//                       "dist/mac-arm64/Garden Quest.app/Contents/MacOS/Garden Quest" (relative to the folder)
//   --seconds           how long to sample frame intervals after the game starts (default 4)
// It runs the app with a throwaway profile folder (its own saves and window state, deleted afterwards) and a local
// DevTools port; it opens no browser and sends nothing anywhere. Without Electron in the folder it says so and
// exits 0 (skipped): Electron is not a dependency of this repository.
//
// Checks, in order: starts (window.__READY, the time it took) / GPU renderer, not a software one / no console
// error / the page has no Node (require, process, module) and one bridge object / crossOriginIsolated / saves
// written as files inside <profile>/saves, a key that tries to leave the folder stays in it / a foreign fetch, a
// pop-up and a navigation away are refused, device permissions denied / frame intervals while walking / blur opens
// the pause menu (when the page mounts the platform layer, ?platform=1) / a crashed page is reloaded / a second
// copy hands over to the first and exits / quit through the bridge writes the window state, then a second launch
// finds the save and opens the window where it was left.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROBE = 'http://127.0.0.1:9/mirage-check';   // a closed local port: nothing answers, nothing leaves the machine
const BINARY = { darwin: 'Electron.app/Contents/MacOS/Electron', win32: 'electron.exe', linux: 'electron' };

/** the Electron binary a scaffold's `npm install` put in node_modules, or null */
export function electronIn(dir, platform = process.platform) {
  const p = path.join(dir, 'node_modules', 'electron', 'dist', BINARY[platform] || 'electron');
  return fs.existsSync(p) ? p : null;
}
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

/** start the app; resolves once its game page is ready (or throws with the app's output) */
async function launch({ exe, appDir, profile, timeout = 90000 }) {
  const port = await freePort(), t0 = Date.now();
  const args = [...(appDir ? [appDir] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
  const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', exited = null;
  proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  const gone = new Promise((r) => proc.on('exit', (code) => { exited = code; r(code); }));
  let browser;
  while (!browser) {
    if (exited !== null) throw new Error(`the app exited (${exited}) before it opened a window:\n${out.slice(-2000)}`);
    if (Date.now() - t0 > timeout) throw new Error(`no DevTools endpoint after ${timeout} ms:\n${out.slice(-2000)}`);
    try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }); } catch { await sleep(150); }
  }
  const target = await browser.waitForTarget((t) => t.type() === 'page' && t.url().startsWith('app://game/'), { timeout });
  const page = await target.page();
  const errors = [];
  // the refusals this check provokes on purpose (a fetch and a navigation to PROBE) are logged as errors; not counted
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes(PROBE)) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.waitForFunction('window.__READY === true', { timeout, polling: 100 });
  return { proc, browser, page, errors, gone, readyMs: Date.now() - t0, output: () => out };
}

async function main() {
  let o;
  try {
    o = parseArgs({ allowPositionals: true, options: { exe: { type: 'string' }, seconds: { type: 'string', default: '4' }, json: { type: 'boolean' }, help: { type: 'boolean' } } });
    if (o.values.help) { console.log('usage: desktop-check.mjs <scaffold folder> [--exe packaged-binary] [--seconds 4] [--json]'); return 0; }
    if (o.positionals.length > 1) throw new Error('one scaffold folder');
  } catch (e) { console.error(`[desktop-check] ${e.message}`); return 2; }
  // `npm run test:desktop` with no folder: the folder from MIRAGE_DESKTOP_APP, or a skip (Electron is not a dependency
  // of this repository; a scaffold with Electron installed is made by hand, see docs/platforms.md)
  const folder = o.positionals[0] || process.env.MIRAGE_DESKTOP_APP;
  if (!folder) { console.log('[desktop-check] skipped: no scaffold folder (pass one, or set MIRAGE_DESKTOP_APP); see docs/platforms.md'); return 0; }
  const dir = path.resolve(folder), json = o.values.json, say = json ? () => {} : console.log;
  if (!fs.existsSync(path.join(dir, 'main.cjs')) || !fs.existsSync(path.join(dir, 'www', 'index.html'))) { console.error(`[desktop-check] ${dir} is not a desktop-electron scaffold (no main.cjs / www/index.html)`); return 2; }
  const exe = o.values.exe ? path.resolve(dir, o.values.exe) : electronIn(dir);
  if (!exe || !fs.existsSync(exe)) {
    const why = o.values.exe ? `no file at ${exe}` : `no Electron in ${dir}/node_modules: run \`npm install\` there first (it downloads Electron, about 100 MB)`;
    if (json) console.log(JSON.stringify({ skipped: why })); else console.log(`[desktop-check] skipped: ${why}`);
    return 0;
  }
  const appDir = o.values.exe ? null : dir, packaged = !!o.values.exe;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-desktop-check-'));
  // window state: Electron has no DevTools call that moves its window, so the check writes the state file the app
  // reads at start (a place no default would pick, plus a marker), expects the window there, and expects the app to
  // have rewritten the file (marker gone) when it quits
  const STATE = { x: 64, y: 80, width: 1100, height: 660 }, stateFile = path.join(profile, 'window-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...STATE, writtenBy: 'desktop-check' }));
  const geometry = (page) => page.evaluate(() => ({ x: screenX, y: screenY, width: outerWidth, height: outerHeight }));
  const sameBox = (b) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(b[k] - STATE[k]) <= 2);
  const boxText = (b) => `${b.x},${b.y} ${b.width}x${b.height}`;
  const results = [], notes = { exe: path.relative(dir, exe), packaged, platform: `${process.platform}-${process.arch}` };
  let failed = 0;
  const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); say(`  ok    ${name}${detail ? '  ' + detail : ''}`); };
  const fail = (name, detail = '') => { failed++; results.push({ name, ok: false, detail }); say(`  FAIL  ${name}${detail ? '  ' + detail : ''}`); };
  const check = (name, cond, detail) => (cond ? pass(name, detail) : fail(name, detail));
  say(`[desktop-check] ${packaged ? 'packaged app' : 'electron .'}: ${exe}`);

  let run;
  try {
    // ---------------------------------------------------------------- first launch
    run = await launch({ exe, appDir, profile });
    const { page } = run;
    notes.readyMs = run.readyMs;
    pass('starts', `ready in ${run.readyMs} ms (process start to window.__READY)`);
    const env = await page.evaluate(() => {
      const c = document.querySelector('canvas'), gl = c?.getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info');
      return { url: location.href, renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, isolated: self.crossOriginIsolated,
        node: ['require', 'process', 'module', 'Buffer', 'global'].filter((k) => k in window), bridge: Object.keys(window.mirageNative || {}).sort(),
        platform: window.mirageNative?.platform, frozen: (() => { try { window.mirageNative.save = null; return window.mirageNative.save !== null; } catch { return true; } })(),
        size: [innerWidth, innerHeight, devicePixelRatio], platformLayer: !!window.__platform };
    });
    notes.renderer = env.renderer; notes.viewport = env.size;
    const g1 = await geometry(page);
    check('window opens where it was left', sameBox(g1), `${boxText(g1)} (state file says ${boxText(STATE)})`);
    check('GPU renderer', env.renderer && !/swiftshader|llvmpipe|software|basic render/i.test(env.renderer), String(env.renderer));
    check('no Node in the page', env.node.length === 0, env.node.length ? `found ${env.node.join(', ')}` : 'require, process, module, Buffer, global: absent');
    check('one bridge object', env.platform === 'electron' && env.frozen && env.bridge.includes('save'), `window.mirageNative { ${env.bridge.join(', ')} }, not writable from the page`);
    check('cross-origin isolated', env.isolated === true);

    // ---------------------------------------------------------------- saves: files inside <profile>/saves
    const value = JSON.stringify({ check: 'desktop', at: 1 });
    const sv = await page.evaluate(async (v) => {
      const n = window.mirageNative.save;
      await n.set('desktop-check', v); await n.set('../escape', 'x'); await n.set('a/b\\c', 'y');
      return { got: await n.get('desktop-check'), keys: await n.keys(), missing: await n.get('never-written') };
    }, value);
    const saveDir = path.join(profile, 'saves'), onDisk = fs.existsSync(saveDir) ? fs.readdirSync(saveDir).sort() : [];
    const escaped = fs.existsSync(path.join(profile, 'escape.json')) || fs.existsSync(path.join(profile, 'escape'));
    check('saves round-trip', sv.got === value && sv.missing === null && sv.keys.includes('desktop-check'), `keys ${JSON.stringify(sv.keys)}`);
    check('saves are files in the profile', onDisk.includes('desktop-check.json') && !escaped && onDisk.length === 3, `saves/ holds ${onDisk.join(', ')}; '../escape' stayed inside`);

    // ---------------------------------------------------------------- refused: foreign fetch, pop-up, navigation, permissions
    // (an http:// URL on a closed local port: the window-open handler hands only https links to the system browser,
    // so nothing opens on the machine running the check)
    const sec = await page.evaluate(async (probe) => {
      const r = {};
      try { await fetch(probe); r.fetch = 'allowed'; } catch { r.fetch = 'refused'; }
      r.popup = window.open(probe) === null ? 'refused' : 'opened';
      for (const name of ['geolocation', 'camera', 'microphone', 'notifications']) { try { r[name] = (await navigator.permissions.query({ name })).state; } catch { r[name] = 'n/a'; } }
      return r;
    }, PROBE);
    await page.evaluate((probe) => { location.href = probe; }, PROBE).catch(() => {});
    await sleep(800);
    // page.url() is empty for a target that loaded before puppeteer attached: ask the page
    const where = await page.evaluate(() => location.href).catch((e) => `unreachable: ${e.message}`);
    check('foreign fetch refused (CSP)', sec.fetch === 'refused');
    check('pop-up refused', sec.popup === 'refused');
    check('navigation away refused', where.startsWith('app://game/'), where);
    const P = ['geolocation', 'camera', 'microphone', 'notifications'];
    check('device permissions denied', P.every((k) => sec[k] === 'denied' || sec[k] === 'n/a'), P.map((k) => `${k} ${sec[k]}`).join(', '));

    // ---------------------------------------------------------------- play: start, walk, sample frame intervals
    await page.bringToFront();
    await page.keyboard.press('Enter'); await sleep(400);
    await page.evaluate(() => window.__mirage?.g?.ui?.begin?.());
    await page.keyboard.down('KeyW');
    const seconds = Math.max(1, +o.values.seconds || 4);
    const frames = await page.evaluate((ms) => new Promise((res) => { const t = []; const f = (now) => { t.push(now); if (now - t[0] < ms) requestAnimationFrame(f); else res(t); }; requestAnimationFrame(f); }), seconds * 1000);
    await page.keyboard.up('KeyW');
    const iv = frames.slice(1).map((t, i) => t - frames[i]);
    notes.frames = { n: iv.length, medianMs: +median(iv).toFixed(2), p95Ms: +pct(iv, 0.95).toFixed(2), maxMs: +Math.max(...iv).toFixed(2) };
    check('frames while walking', iv.length > seconds * 20, `${iv.length} frames in ${seconds} s: median ${notes.frames.medianMs} ms, p95 ${notes.frames.p95Ms} ms, worst ${notes.frames.maxMs} ms (vsync-paced window)`);

    // ---------------------------------------------------------------- blur: the pause menu (only with the platform layer mounted)
    if (env.platformLayer) {
      const b = await page.evaluate(async () => {
        const g = window.__mirage?.g; window.dispatchEvent(new Event('blur')); await new Promise((r) => setTimeout(r, 100));
        return { paused: !!g?.game?.paused, menu: !!g?.ui?.open, log: window.__platform.log.filter((e) => e.type === 'pause').map((e) => e.reason) };
      });
      check('blur pauses and opens the menu', b.paused && b.menu && b.log.includes('blur'), JSON.stringify(b));
    } else say('  --    blur: the page does not mount the platform layer (build the scaffold with --query platform=1 to check it)');

    // ---------------------------------------------------------------- a crashed page is reloaded
    const cdp = await page.createCDPSession();
    const t1 = Date.now();
    cdp.send('Page.crash').catch(() => {});
    await sleep(500);
    const again = await (await run.browser.waitForTarget((t) => t.type() === 'page' && t.url().startsWith('app://game/'), { timeout: 30000 })).page();
    await again.waitForFunction('window.__READY === true', { timeout: 90000, polling: 100 }).then(
      () => pass('crashed page reloaded', `ready again ${Date.now() - t1} ms after the crash`),
      (e) => fail('crashed page reloaded', e.message));
    run.page = again;

    // ---------------------------------------------------------------- single instance
    const second = spawn(exe, [...(appDir ? [appDir] : []), `--user-data-dir=${profile}`], { stdio: 'ignore' });
    const code = await Promise.race([new Promise((r) => second.on('exit', r)), sleep(15000).then(() => 'still running')]);
    if (code === 'still running') second.kill();
    check('a second copy exits', code === 0, `exit ${code}`);

    // ---------------------------------------------------------------- quit through the bridge
    const tq = Date.now();
    again.evaluate(() => window.mirageNative.quit()).catch(() => {});
    const qc = await Promise.race([run.gone, sleep(15000).then(() => 'still running')]);
    check('quit through the bridge', qc === 0, `exit ${qc} after ${Date.now() - tq} ms`);
    if (qc === 'still running') run.proc.kill();
    const firstErrors = [...run.errors];
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* checked below */ }
    check('window state written on quit', !saved.writtenBy && sameBox(saved), JSON.stringify(saved));
    await run.browser.disconnect().catch(() => {});
    run = null;

    // ---------------------------------------------------------------- second launch: the save and the window come back
    run = await launch({ exe, appDir, profile });
    notes.secondReadyMs = run.readyMs;
    const back = await run.page.evaluate(() => window.mirageNative.save.get('desktop-check'));
    check('save survives a restart', back === value, `second start ready in ${run.readyMs} ms`);
    const g2 = await geometry(run.page);
    check('window comes back where it was', sameBox(g2), boxText(g2));
    const errs = [...firstErrors, ...run.errors];
    run.page.evaluate(() => window.mirageNative.quit()).catch(() => {});
    await Promise.race([run.gone, sleep(10000)]);
    check('no console error', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    fail('run', e.message.split('\n').slice(0, 6).join('\n'));
  } finally {
    if (run) { run.proc.kill(); await run.browser?.disconnect().catch(() => {}); }
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (json) console.log(JSON.stringify({ ok: failed === 0, notes, results }));
  else say(`\n[desktop-check] ${failed ? `${failed} failed` : `all ${results.length} passed`}  ${JSON.stringify(notes)}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
