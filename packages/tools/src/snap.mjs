#!/usr/bin/env node
// Mirage original code. Multi-view snapshots of a world and a contact sheet of them.
//
// usage: mirage-snap <dist dir | page.html> [--out dir] [--views all | 0,2,5] [--query "time=12:00"] [--w 1440 --h 900]
//        [--spp 16] [--cols 3] [--game] (adds a game-view shot at the spawn)
//        [--phone]                 shoot at 375 x 812 (a phone held upright); the sheet is one phone wide per tile
//        [--baseline dir] [--ssim 0.92,0.85,0.75]   compare every view with dir/<same file> by region SSIM (grain 0);
//                                  a missing baseline file is written there (the first run makes the baseline)
//        [--determinism]           draw every view again after another view, and again after a reload: all bit-identical
//        [--variants "time=dusk;post.bloom=0.2;quality=low"]   one labelled grid per view (<= 16 variants, 4 columns)
//        [--adaptive [levels]]     adaptive spp: stop once the still converges (renderFrame converge; default 0.25
//                                  display levels); [--adaptive-check] also draws the full spp and measures the difference
// For each of the plan's viewpoints: place the viewer there (play.viewpoint), render the still path at `spp`,
// save <out>/vNN-name.png; then <out>/sheet.png (thumbnails with labels, composed in the page's 2D canvas)
// and <out>/snap.json (load time, per-view render ms, console errors, diagnostics). Exit 1 when a baseline or
// determinism check fails.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, serve, open } from './chrome.mjs';
import { sheetInPage, PHONE } from './sheet.mjs';
import { adaptiveOption, redrawOrder } from './snap-args.mjs';
import { readPNG, encodePNG, regionSSIM, ssimVerdict, parseThresholds, pixelDiff, boxed, sideBySide } from './imgcmp.mjs';
import { diag, sortDiagnostics, formatDiagnostic } from './diagnostics.mjs';

const args = process.argv.slice(2);
const BOOL = ['--game', '--phone', '--determinism', '--adaptive-check'];
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !BOOL.includes(args[i - 1]) && !(args[i - 1] === '--adaptive' && !/^[\d.]+$/.test(a))));
if (!target) { console.error('usage: mirage-snap <dist dir | page.html> [--out dir] [--views all|0,1] [--query q] [--spp N] [--phone] [--baseline dir] [--determinism] [--variants "a=1;b=2"] [--adaptive]'); process.exit(2); }
const phone = !!flag('phone');
const W = phone ? PHONE.w : +flag('w', 1440), H = phone ? PHONE.h : +flag('h', 900), SPP = +flag('spp', 16), COLS = +flag('cols', phone ? 4 : 3);
const OUT = path.resolve(flag('out', 'out/snap'));
const BASE = flag('baseline') ? path.resolve(flag('baseline')) : null;
const adaptive = adaptiveOption(args);
const grain0 = !!(BASE || flag('determinism'));   // the comparisons use the deterministic still: grain off, frameIndex 1
fs.mkdirSync(OUT, { recursive: true });
const isFile = target.endsWith('.html');
const srv = isFile ? null : await serve(target);
const url = (isFile ? pathToFileURL(path.resolve(target)).href : srv.url) + `?mode=walk&ui=0&w=${W}&h=${H}` + (flag('query') ? '&' + flag('query') : '');
const browser = await launch({ w: W, h: H });
const report = { url, w: W, h: H, views: [] }, diagnostics = [];
const png64 = (d) => Buffer.from(d.split(',')[1], 'base64');

/** Runs in the page: place the view, settle, draw the still path once; returns the canvas as PNG and the timing.
 *  o.set: runtime settings for a variant ({ 'post.bloom': 0.2, time: 'dusk' }), put back afterwards. */
async function stillInPage(s, spp, o) {
  const { play, built } = window.__mirage, w = play.world;
  play.stop();                                         // no animation frames in between: this task renders
  const undo = [];
  for (const [k, v] of Object.entries(o.set || {})) {
    if (k === 'time') {
      const st = w.state, was = st && st.date ? st.date : st ? { elevation: st.sun.elevation, azimuth: st.sun.azimuth } : 'golden';
      const presets = { dawn: [3, 95], morning: [20, 120], noon: [60, 180], afternoon: [35, 230], dusk: [-2, 265], night: [-18, 300] };
      const t = presets[v] ? { elevation: presets[v][0], azimuth: presets[v][1] } : /^\d\d?:\d\d$/.test(v) ? { day: (st && st.date ? st.date : new Date()).toISOString().slice(0, 10), time: v }
        : /^-?[\d.]+,-?[\d.]+$/.test(v) ? { elevation: +v.split(',')[0], azimuth: +v.split(',')[1] } : v;
      w.setTime(t); undo.push(() => w.setTime(was));
    } else {
      const keys = k.split('.'), last = keys.pop(), obj = keys.reduce((a, p) => (a == null ? a : a[p]), w);
      if (obj == null || !(last in obj)) throw new Error(`variant: world.${k} does not exist`);
      const was = obj[last]; obj[last] = v; undo.push(() => { obj[last] = was; });
    }
  }
  if (s.i >= 0) play.viewpoint(s.i);
  else { const p = built.plan, sp = p.gameView || p.spawn; play.place(sp.eye, sp.look, 'game'); }
  for (let k = 0; k < 40; k++) play.step(1 / 30);      // settle: ground, eased eye, game camera follow
  const grain = w.post.grain;
  if (o.grain0) w.post.grain = 0;
  const gl = w.renderer.getContext(), px = new Uint8Array(4);
  const t = performance.now();
  const r = play.render({ moving: false, spp, frameIndex: 1, ...(o.converge ? { converge: o.converge } : {}) });
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const ms = +(performance.now() - t).toFixed(1);
  const png = document.querySelector('canvas').toDataURL('image/png');
  w.post.grain = grain;
  for (const f of undo.reverse()) f();
  return { ms, png, mode: play.mode, ...(r ? { used: r.spp, diffs: r.diffs } : {}) };
}

try {
  // --determinism: Chrome draws the first page it loads up to 1 level apart (in < 0.1 % of the pixels, seen through
  // the SSAO pass's depth tests) from every later load in the same browser; neither the HTTP cache, storage, the
  // shader program cache, the quality pick, MSAA nor a warm-up WebGL context explains it, so the check loads the
  // page once first and compares warm loads with each other (a plain snap is unchanged)
  if (flag('determinism')) { const warm = await open(browser, url); await warm.page.close(); }
  let { page, errors, loadMs } = await open(browser, url);
  report.loadMs = loadMs;
  const vps = await page.evaluate(() => window.__mirage.built.plan.viewpoints.map((v) => v.name));
  const pick = flag('views', 'all') === 'all' ? vps.map((_, i) => i) : String(flag('views')).split(',').map(Number);
  const shots = pick.map((i) => ({ i, name: vps[i] }));
  if (flag('game')) shots.push({ i: -1, name: 'game view' });
  const files = [];
  const still = (s, spp = SPP, o = {}) => page.evaluate(stillInPage, s, spp, { grain0, ...o });
  const shotOpts = adaptive !== null ? { converge: adaptive } : {};   // every drawing of a view the same way
  for (const s of shots) {
    const r = await still(s, SPP, shotOpts);
    const f = `v${String(files.length).padStart(2, '0')}-${s.name.replace(/\W+/g, '-')}.png`;
    fs.writeFileSync(path.join(OUT, f), png64(r.png));
    files.push({ f, s, name: s.name, data: r.png });
    const row = { name: s.name, file: f, mode: r.mode, renderMs: r.ms };
    if (adaptive !== null) {
      Object.assign(row, { spp: r.used, diffs: r.diffs });
      if (flag('adaptive-check')) {   // the same view at the full spp: the difference, and the time (5 interleaved
        // pairs after the first, medians: the GPU is shared and the first drawing of a view pays its compiles)
        const full = await still(s, SPP), a = [], f = [];
        for (let k = 0; k < 5; k++) { a.push((await still(s, SPP, { converge: adaptive })).ms); f.push((await still(s, SPP)).ms); }
        const med = (v) => v.sort((x, y) => x - y)[v.length >> 1];
        Object.assign(row, { adaptiveMs: med(a), fullMs: med(f), vsFull: pixelDiff(readPNG(r.png), readPNG(full.png)) });
      }
    }
    report.views.push(row);
    console.log(JSON.stringify(row));
  }
  // the contact sheet
  const sheet = await page.evaluate(sheetInPage, files.map(({ name, data }) => ({ label: name, data })), { cols: COLS, tw: phone ? PHONE.w : 480 });
  fs.writeFileSync(path.join(OUT, 'sheet.png'), png64(sheet));

  // ---- baseline: region SSIM of each view against dir/<file>
  if (BASE) {
    fs.mkdirSync(BASE, { recursive: true });
    const T = parseThresholds(flag('ssim'));
    report.baseline = { dir: BASE, views: [] };
    for (const { f, name, data } of files) {
      const bf = path.join(BASE, f);
      if (!fs.existsSync(bf)) { fs.writeFileSync(bf, png64(data)); report.baseline.views.push({ name, file: f, new: true }); console.log(`baseline: ${f} written (new)`); continue; }
      const a = readPNG(fs.readFileSync(bf)), b = readPNG(data);
      if (a.w !== b.w || a.h !== b.h) {
        diagnostics.push(diag('MG460', { target: `view "${name}"`, message: `baseline ${bf} is ${a.w} x ${a.h}, this shot ${b.w} x ${b.h}`, fix: 'Shoot at the baseline\'s size (--w / --h / --phone) or delete the baseline file to make a new one.' }));
        continue;
      }
      const sc = regionSSIM(a, b), v = ssimVerdict(sc, T), row = { name, file: f, mean: sc.mean, p05: sc.p05, cell: sc.cell, worst: sc.worst, pass: v.pass };
      if (!v.pass) {
        const dfile = `baseline-diff-${f}`;
        fs.writeFileSync(path.join(OUT, dfile), encodePNG(sideBySide(boxed(a, sc.worst.roi), boxed(b, sc.worst.roi))));
        row.diff = dfile;
        const [x0, y0, x1, y1] = sc.worst.roi;
        diagnostics.push(diag('MG460', { target: `view "${name}"`, message: `${f} differs from the baseline: ${v.fails.join(', ')}; worst cell ${sc.worst.i} (x ${x0}-${x1}, y ${y0}-${y1} px from the top left) SSIM ${sc.worst.ssim}; see ${dfile} (baseline | now)` }));
      }
      report.baseline.views.push(row);
      console.log('baseline ' + JSON.stringify({ ...row, worst: sc.worst.i }));
    }
  }

  // ---- determinism: every view again after a different view than the one before it the first time (the reverse
  // order, rotated so the last view drawn is not redrawn right after itself), then after a reload
  if (flag('determinism')) {
    report.determinism = [];
    const again = async (phase, order) => {
      for (const k of order) {
        const { s, f, data } = files[k], r = await still(s, SPP, shotOpts);
        const d = pixelDiff(readPNG(data), readPNG(r.png));
        report.determinism.push({ phase, name: s.name, ...d });
        if (!d.same) {
          fs.writeFileSync(path.join(OUT, `nondet-${phase.replace(/\W+/g, '-')}-${f}`), png64(r.png));
          diagnostics.push(diag('MG461', { target: `view "${s.name}"`, message: `${f} ${phase}: ${d.differing} pixels differ (max ${d.max} levels, mean ${d.mean}); the second drawing is nondet-${phase.replace(/\W+/g, '-')}-${f}` }));
        }
        console.log('determinism ' + JSON.stringify({ phase, name: s.name, same: d.same, differing: d.differing, max: d.max }));
      }
    };
    const order = redrawOrder(files.length);
    // with one view the jump goes to the game view (or the spawn) and back
    if (files.length === 1) await still({ i: -1, name: 'jump' });
    await again('after another view', order);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
    await again('after a reload', files.map((_, k) => k));
  }

  // ---- variants: one grid per view, a variant per tile
  if (flag('variants')) {
    const list = String(flag('variants')).split(';').map((v) => v.trim()).filter(Boolean);
    if (list.length > 16) throw new Error(`--variants: ${list.length} variants, at most 16`);
    const value = (v) => (v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(+v) ? +v : v);
    report.variants = [];
    for (const { s, f } of files) {
      const tiles = [];
      for (const [n, spec] of list.entries()) {
        const set = {}, query = [];
        for (const kv of spec.split('&')) { const [k, v = ''] = kv.split('='); if (k === 'time' || k.includes('.')) set[k] = value(v); else query.push(kv); }
        let r, other = null;
        try {
          if (query.length) { other = await open(browser, url + '&' + query.join('&')); r = await other.page.evaluate(stillInPage, s, SPP, { grain0, set }); }
          else r = await still(s, SPP, { set });
        } finally { if (other) await other.page.close(); }
        const vf = `variant-${String(n).padStart(2, '0')}-${f}`;
        fs.writeFileSync(path.join(OUT, vf), png64(r.png));
        tiles.push({ label: spec, data: r.png });
        report.variants.push({ view: s.name, variant: spec, file: vf, renderMs: r.ms });
      }
      const grid = await page.evaluate(sheetInPage, tiles, { cols: Math.min(4, tiles.length), tw: phone ? PHONE.w : 360, title: `${s.name}: ${tiles.length} variants` });
      const gf = `variants-${f}`;
      fs.writeFileSync(path.join(OUT, gf), png64(grid));
      console.log(`variants: ${path.join(OUT, gf)}`);
    }
  }
  report.errors = errors;
} finally {
  await browser.close();
  if (srv) srv.close();
}
report.diagnostics = sortDiagnostics(diagnostics);
fs.writeFileSync(path.join(OUT, 'snap.json'), JSON.stringify(report, null, 1));
for (const d of report.diagnostics) console.log(formatDiagnostic(d));
const failed = report.diagnostics.filter((d) => d.severity === 'error').length;
console.log(`snap: ${report.views.length} views, sheet ${path.join(OUT, 'sheet.png')}, errors ${report.errors?.length ?? '?'}` + (failed ? `, ${failed} failing checks` : ''));
process.exit(failed ? 1 : 0);
