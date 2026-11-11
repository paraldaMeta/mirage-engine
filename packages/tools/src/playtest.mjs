#!/usr/bin/env node
// Mirage original code. The agent self-test loop's runner: play one JSON scenario against any Mirage page in the
// real Chrome (headless, GPU on) and write a verdict an agent can read: report.md, report.json, one screenshot per
// step and sheet.png (a contact sheet). Exit 1 on any failed expectation or unexpected console error.
//
// usage: mirage-playtest <scenario.json> <dist dir | page.html> [--out dir]
// The page must set window.__READY = true and window.__mirage = { play, built, g? } (every example does; g is
// @mirage/game's startGame result, which adds near / prompt / flags / inventory to the state).
//
// scenario: { "title", "query": "mode=walk&ui=0", "w": 1440, "h": 900, "errors": 0 (allowed console / page errors; warnings are listed, never counted), "steps": [step] }
// step (fields run in this order; any combination):
//   "place": { "eye": [x,y,z], "look": [x,y,z], "mode": "walk|fly|game|orbit" }   "mode": "fly"   "viewpoint": 2
//   "walkTo": [[x,z], ...]  hold W and steer through the points (with "run": true, "tol": 0.35, "timeout": 30000);
//       fails "stuck" after 2.5 s without progress, "timed out" when still moving at the timeout
//   "lookAt": [x,y,z] | "<entity id>"     turn the view (an entity of the game: its interaction point)
//   "tap": "KeyE" | ["KeyE", "Space"]     one press each        "keys": ["KeyW", "ShiftLeft"], "ms": 3000   held together
//   "ms": 500 (alone: wait)
//   "flicker": { "path": [[x,z], ...] | "<plan.paths name>", "speed": 1.4, "frames": whole path, "eye": 1.62, "y": start height }
//       walk the camera along the path at walking speed, one temporal-AA frame per 1/60 s, grain off; measures
//       flicker = mean |f0 - 2 f1 + f2| (what is not smooth motion: shimmer, crawling edges, popping) and
//       meanAbsDiff = mean |f1 - f0| per RGB channel, 0..255, mean over the frames (flickerMax, flickerMaxAt [x, z]:
//       the worst triple and where it was, saved as NN-<step>-worst.png and -worst-diff.png (|f0 - 2 f1 + f2| x4);
//       frames default to the whole path, at most 600: 14 m at walking speed, use "speed": 4.2 for longer paths)
//   "perf": { "frames": 90, "runs": 3 }  synchronous frame cost while the held keys act (step + render + 1-px readback),
//       the `frames` timed as `runs` consecutive parts -> frameMs (the MEDIAN part's mean), p95Ms (median of the
//       parts' p95), frameMsRuns (each part's mean), frameMsSpread ((max - min) / median: over 0.25 the machine was
//       busy, or the view changed a lot along the way, and the number is soft), calls, triangles. The frames go
//       through play.step: in walk / game mode the held keys walk and collide as in play (frames / 60 s of it), in
//       fly mode nothing collides; a perf step measures a view, a walkTo / keys step tests the walls. With MIRAGE_GL=software (no GPU) frameMs / p95Ms / fps expectations are reported, not gated.
//   "expect": { "<value>": "<op> <operand> [tolerance]" }   ops: < > <= >= ~ == != has
//       values: x y z maxY dist onGround blocked mode fps | near prompt inventory paused flags.<name> (games)
//               | flicker meanAbsDiff flickerMax | frameMs p95Ms calls triangles | errors warnings (console errors / warnings so far)
//               | luma dark clipped (of the step's screenshot: mean luma 0..255, share of near-black / near-white pixels)
//       dist = horizontal distance moved in the step; maxY = highest feet height seen in it; has = substring / member
//   "see": { "<name>": "<op> <operand>" } | ["<name>", ...]   what the shot must show, checked on an ID pass of the
//       final view: see.<name> = share of the frame (0..1) where that object (or anything under a node of that name;
//       a module's root carries the module's name) is the nearest surface. A list means "> 0.001" each. A failed
//       check says why: out of frame, hidden (and by what) or too small. Transparent surfaces do not hide.
//   A screenshot that is black (98 % of pixels near black) or clipped (35 % near white) is listed as a warning.
//   "contrast": true | { "root": ".mg-ui" }   WCAG contrast of the page's visible text (prompts, HUD, dialogs) over
//       the scene at the end of the step, measured behind the glyphs: values contrast (the worst ratio) and
//       contrastFails; any text under 4.5:1 (3:1 large) fails the step with MG710
//   "shot": false  (default true)
//   walkTo also writes NN-<step>-route.png (after the walk, so the walk's timing is unchanged): the walk grid from
//   above, the planned route, the path taken, the stuck point; "onion": true adds the game entities that moved
//   meanwhile (sampled every 5th poll: a page call each, so it is not the default)
// scenario level: "baseline": "<dir>" (or --baseline dir): each step whose view the scenario fixed (the spawn, place or
//   viewpoint, and no walkTo / keys / tap since; "baseline": true on a step forces it, false skips it) is drawn once more on the deterministic
//   still path (grain 0, frameIndex 1, 16 spp) and compared with <dir>/<shot> by region SSIM ("ssim": [0.92, 0.85,
//   0.75] = mean, 5th percentile, worst 4 x 4 cell); a miss is MG460 with the boxed diff image; a missing file is
//   written (the first run makes the baseline). "phone": true (or --phone): 375 x 812, the sheet one phone wide per tile.
//   "checks": false (scenario level) skips the load-time world checks (spawn / viewpoints in solids, floating objects,
//   coplanar surfaces, what each viewpoint shows); they run by default and their errors fail the run.
// Every problem found is also listed as a diagnostic { code, severity, target, message, fix, at? } in report.json
// `diagnostics` and at the top of report.md (codes: docs/diagnostics.md). Read those first.
// The target may also be an http(s) URL (the query is appended).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, serve, open, softwareGL } from './chrome.mjs';
import { seeInPage, frameStatsInPage, seeWhy, DARK_SHARE, CLIPPED_SHARE } from './see.mjs';
import { worldChecks, probe } from './world-checks.mjs';
import { sheetInPage, PHONE } from './sheet.mjs';
import { contrastAudit } from './contrast.mjs';
import { routeMapInPage } from './route.mjs';
import { unknownFields } from './scenario-fields.mjs';
import { readPNG, encodePNG, regionSSIM, ssimVerdict, boxed, sideBySide } from './imgcmp.mjs';
import { diag, sortDiagnostics, markdownDiagnostics, fromBuildReport, fromConsole, fromWarnings, fromStep, fromWorldChecks, lintPlan, budgetAtLoad, heaviest, lightFix, stuckWords, throughWords, axisVerdict, parseExpect, formatDiagnostic } from './diagnostics.mjs';

const SOFTWARE = softwareGL();
function check(expr, v) {
  const [op, ...rest] = String(expr).trim().split(/\s+/);
  const a = rest[0], n = a === 'true' ? true : a === 'false' ? false : a === 'null' ? null : isNaN(+a) ? a : +a;
  switch (op) {
    case '<': return v < n; case '>': return v > n; case '<=': return v <= n; case '>=': return v >= n;
    case '~': return Math.abs(v - n) <= (+rest[1] || 0.05); case '==': return v === n; case '!=': return v !== n;
    case 'has': return Array.isArray(v) ? v.includes(rest.join(' ')) : String(v ?? '').includes(rest.join(' '));
    default: throw new Error('bad expectation ' + expr);
  }
}

const LOAD_FAILED = Symbol('load failed');
/** Run one scenario against a page (dist folder, .html file or http(s) URL); writes report.json, report.md, the
 *  shots and sheet.png into `out` and returns the report (report.pass, report.diagnostics). */
export async function playtest(sc, target, { out = 'out/playtest', scenarioFile = '(scenario)', log = console.log } = {}) {
const OUT = path.resolve(out);
fs.mkdirSync(OUT, { recursive: true });
const W = sc.phone ? PHONE.w : sc.w || 1440, H = sc.phone ? PHONE.h : sc.h || 900;
const BASE = sc.baseline ? path.resolve(path.dirname(path.resolve(scenarioFile)), sc.baseline) : null;
if (BASE) fs.mkdirSync(BASE, { recursive: true });
const T = Array.isArray(sc.ssim) ? { mean: sc.ssim[0], p05: sc.ssim[1], cell: sc.ssim[2] } : sc.ssim || {};
const isUrl = /^https?:\/\//.test(target), isFile = !isUrl && target.endsWith('.html');
const srv = isFile || isUrl ? null : await serve(target);
const base = isUrl ? target : isFile ? pathToFileURL(path.resolve(target)).href : srv.url;
const url = base + (base.includes('?') ? '&' : '?') + (sc.query || 'mode=walk&ui=0') + `&w=${W}&h=${H}`;
const browser = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [], wait = (ms) => new Promise((r) => setTimeout(r, ms));
// a step name in a file name: 'gate / prompt' or 'a:b' (Windows) made the screenshot throw and lost the report
const fileName = (s) => String(s).replace(/[^\w.-]+/g, '-');
const report = { title: sc.title || path.basename(scenarioFile), url, scenario: path.resolve(scenarioFile), at: new Date().toISOString(), w: W, h: H };
// a field the runner does not read (a typo, a field from a newer skill) does nothing: say so, do not fail
const unknown = unknownFields(sc);
if (unknown.length) { report.unknownFields = unknown; log('scenario fields playtest does not know (ignored): ' + unknown.join(', ')); }
let failed = 0, loadError = null, plan = null, light = null;
const diagnostics = [];
try {
  const opened = await open(browser, url).catch((e) => { loadError = e; return null; });
  if (!opened) throw LOAD_FAILED;
  const { page, errors, warnings, stacks, loadMs } = opened;
  Object.assign(report, { loadMs, ...(await page.evaluate(() => {
    const { play, built } = window.__mirage, gl = play.world.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '?', grid: play.grid.stats, build: built && built.report ? { ms: built.report.ms, failed: built.report.failed, modules: built.report.modules.map((m) => ({ name: m.name, ok: m.ok, ms: m.ms, tris: m.tris, consumes: m.consumes })), anchors: built.report.anchors, ambientVolumes: (built.report.ambientVolumes || []).map((v) => ({ min: v.min, max: v.max, factor: v.factor, from: v.from })) } : null };
  })) });
  log(JSON.stringify({ step: 'load', loadMs, grid: report.grid, build: report.build }));
  if (report.build?.failed.some(f => f.phase === 'consumes')) failed++;
  // the load-time diagnostics: the build report, the plan, the budget, the world checks
  ({ plan, light } = await page.evaluate(() => {
    const { built, play } = window.__mirage, w = play.world;
    let plan = null; try { plan = built && built.plan ? JSON.parse(JSON.stringify(built.plan)) : null; } catch { /* not JSON-able */ }
    return { plan, light: { postExposure: w.post && w.post.exposure, autoExposure: w.exposure, sunElevation: w.state && w.state.sun ? w.state.sun.elevation : undefined, lamp: w.light ? w.light.lamp : undefined } };
  }));
  diagnostics.push(...fromBuildReport(report.build, plan, errors), ...lintPlan(plan), ...budgetAtLoad(report.build, plan));
  if (sc.checks !== false) {
    const found = await worldChecks(page).catch((e) => ({ error: String(e.message || e) }));
    if (found.error) log('world checks failed: ' + found.error);
    else { report.checks = { ms: found.ms, ...found.counted }; diagnostics.push(...fromWorldChecks(found)); }
  }
  // module failures are governed by the allowed console errors (and consumes, above); the others fail the run
  if (diagnostics.some((d) => d.severity === 'error' && !d.code.startsWith('MG2'))) failed++;
  const heavy = heaviest(report.build), lightWords = lightFix(light), loadDiags = diagnostics.slice();
  let moved = false;   // every step so far started where the spawn put the walker
  let fixedView = true;   // the view is where the scenario put it (spawn, place, viewpoint), not where walking left it
  const state = () => page.evaluate(() => {
    const m = window.__mirage, s = m.play.state(), g = m.g;
    if (g) Object.assign(s, { near: g.near ? g.near.id : null, prompt: g.near ? g.game.label(g.near) : null, flags: { ...g.game.flags }, inventory: g.game.inventory.items.map((i) => i.id), paused: g.game.paused });
    return s;
  });
  // Software GL draws a frame in about a second and the walker's step is capped at 0.1 s, so wall time says nothing
  // about how far the world has moved: there every wait also lasts until that many 0.1 s frames have been drawn
  // (at most 40 times the wall time). On a GPU `paced` is false and the waits are the plain ones.
  const paced = SOFTWARE, frameNo = () => page.evaluate(() => window.__mirage.play.stats.frames);
  const settle = async (ms) => { const f = paced ? await frameNo() : 0, end = Date.now() + ms * 40; await wait(ms); while (paced && (await frameNo()) - f < Math.max(1, Math.round(ms / 100)) && Date.now() < end) await wait(40); };
  const keysDown = async (ks) => { for (const k of ks) await page.keyboard.down(k); };
  const keysUp = async (ks) => { for (const k of ks) await page.keyboard.up(k); };
  for (const [idx, s] of sc.steps.entries()) {
    const t0 = Date.now(), metrics = {};
    let err = null, maxY = -Infinity, start = null, frames = 0;
    try {
      if (s.place) await page.evaluate((p) => window.__mirage.play.place(p.eye, p.look, p.mode), s.place);
      if (s.mode) await page.evaluate((m) => window.__mirage.play.setMode(m), s.mode);
      if (s.viewpoint !== undefined) await page.evaluate((i) => window.__mirage.play.viewpoint(i), s.viewpoint);
      if (s.place || s.viewpoint !== undefined) await settle(150);   // settle onto the ground
      start = await state(); maxY = start.pos[1];
      const f0 = await page.evaluate(() => window.__mirage.play.stats.frames);
      const track = async (ms, each) => { const t0 = Date.now(), fr0 = paced ? await frameNo() : 0; while (Date.now() < t0 + ms || (paced && Date.now() < t0 + ms * 40 && (await frameNo()) - fr0 < ms / 100)) { await wait(40); const st = await state(); maxY = Math.max(maxY, st.pos[1]); if (each && (await each(st))) return true; } return false; };
      if (s.walkTo) {
        let run = !!s.run;
        // the route map's path comes from the polls the walk makes anyway; entity trails ("onion": true) cost a page
        // call every 5th poll, which changes the walk's timing, so they are asked for, not default
        const route = { name: `${idx} ${s.name ?? ''}`, plan: [[start.pos[0], start.pos[2]], ...s.walkTo], path: [start.pos], ents: {} };
        const entsAt = () => page.evaluate(() => { const g = window.__mirage.g; if (!g) return {}; const o = {}; for (const [id, e] of g.game.entities) { const p = g.game.where(e); if (p) o[id] = [+p[0].toFixed(3), +p[2].toFixed(3)]; } return o; }).catch(() => ({}));
        const ent0 = s.onion ? await entsAt() : null; let polls = 0;
        const sample = async (st) => { route.path.push(st.pos); if (ent0 && ++polls % 5 === 0) for (const [id, p] of Object.entries(await entsAt())) (route.ents[id] ??= [ent0[id] || p]).push(p); };
        await keysDown(run ? ['KeyW', 'ShiftLeft'] : ['KeyW']);
        try {
          for (const [k, [x, z]] of s.walkTo.entries()) {
            const last = k === s.walkTo.length - 1, tol = last ? s.tol || 0.35 : Math.max(s.tol || 0.35, 0.8);   // corners can be cut
            let mark = [start.pos, Date.now(), paced ? await frameNo() : 0];   // no progress for 2.5 s (and, on software GL, 25 frames) = stuck
            const ok = await track(s.timeout || 30000, async (st) => {
              await sample(st);
              if (Math.hypot(st.pos[0] - mark[0][0], st.pos[2] - mark[0][2]) > 0.1) mark = [st.pos, Date.now(), paced ? await frameNo() : 0];
              else if (Date.now() - mark[1] > 2500 && (!paced || (await frameNo()) - mark[2] >= 25)) route.stuck = [st.pos[0], st.pos[2]];
              if (route.stuck) throw new Error(`walkTo: stuck at ${st.pos.join(', ')} on the way to ${x}, ${z} (no progress for 2.5 s)`);
              await page.evaluate((x, z) => { const { play } = window.__mirage; play.lookAt([x, play.state().eye[1], z]); }, x, z);
              const d = Math.hypot(st.pos[0] - x, st.pos[2] - z);
              if (d < 1.2 && run && last) { await page.keyboard.up('ShiftLeft'); run = false; }
              return d < tol;
            });
            if (!ok) throw new Error(`walkTo: timed out at ${(await state()).pos.join(', ')} on the way to ${x}, ${z} (moving; try "run": true or a longer "timeout")`);
          }
        } finally {
          await keysUp(['KeyW', 'ShiftLeft']);
          // the route map: only entities that moved more than 2 cm stay in the onion skin
          for (const [id, t] of Object.entries(route.ents)) if (!t.some((p) => Math.hypot(p[0] - t[0][0], p[1] - t[0][1]) > 0.02)) delete route.ents[id];
          const rf = `${String(idx).padStart(2, '0')}-${fileName(s.name ?? idx)}-route.png`;
          await page.evaluate(routeMapInPage, route).then((png) => { fs.writeFileSync(path.join(OUT, rf), Buffer.from(png.split(',')[1], 'base64')); metrics.route = rf; }).catch((e) => log('route map failed: ' + (e.message || e)));
        }
        await settle(250);
      }
      if (s.lookAt) {
        await page.evaluate((t) => {
          const { play, g } = window.__mirage;
          const p = typeof t === 'string' ? g.game.where(g.game.entities.get(t)) : t;
          if (!p) throw new Error('lookAt: no entity ' + t);
          play.lookAt(p);
        }, s.lookAt);
        await settle(300);
      }
      for (const k of [s.tap || []].flat()) { await page.keyboard.down(k); await settle(80); await page.keyboard.up(k); await settle(250); }
      if (s.keys && !s.perf) { await keysDown(s.keys); await track(s.ms || 1000); await keysUp(s.keys); }
      else if (s.ms && !s.perf) await track(s.ms);
      if (s.flicker) Object.assign(metrics, await page.evaluate((o) => {
        const { play, built } = window.__mirage, w = play.world, gl = w.renderer.getContext();
        let pts = typeof o.path === 'string' ? built.plan.paths[o.path].points : o.path;
        const speed = o.speed || 1.4, warm = 8, step = speed / 60, eyeH = o.eye || 1.62;
        // points every `step` metres along the polyline
        const seg = []; let L = 0;
        for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push([L, l, pts[i - 1], pts[i]]); L += l; }
        // past the end the last segment runs straight on (the look-ahead point never swings round at the end)
        const at = (s) => { const [s0, l, a, b] = seg.find(([s0, l]) => s <= s0 + l) || seg.at(-1); const t = l ? (s - s0) / l : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
        let gy = o.y ?? 50;   // follow the ground: the highest floor at most 1 m above the last one (not roofs overhead)
        const eyeAt = (s, keep) => { const [x, z] = at(s), g = play.grid.groundAt(x, z, gy + 1); if (!keep && !Number.isNaN(g)) gy = g; return [x, (Number.isNaN(g) ? gy : g) + eyeH, z]; };
        const n = Math.min(o.frames || Math.floor(L / step), 600);   // default: the whole path
        const grab = () => { const a = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
        const grain = w.post.grain; w.post.grain = 0;
        play.stop();
        const f = [], flick = [], diff = [], where = [];
        let worstF = null;
        for (let i = 0; i < warm + n + 2; i++) {
          const e = eyeAt(i * step), ahead = eyeAt(i * step + 6, true);
          play.place(e, [ahead[0], e[1] - 0.15, ahead[2]], 'fly');
          play.step(1 / 60);
          play.render({ moving: true });
          if (i < warm) continue;
          f.push(grab()); if (f.length > 3) f.shift();
          if (f.length === 3) {
            let d1 = 0, d2 = 0;
            for (let k = 0; k < f[0].length; k += 4) for (let c = 0; c < 3; c++) { d1 += Math.abs(f[2][k + c] - f[1][k + c]); d2 += Math.abs(f[0][k + c] - 2 * f[1][k + c] + f[2][k + c]); }
            const m = (f[0].length / 4) * 3; flick.push(d2 / m); diff.push(d1 / m); where.push([+e[0].toFixed(1), +e[2].toFixed(1)]);
            if (d2 / m >= Math.max(...flick)) worstF = [f[0].slice(), f[1].slice(), f[2].slice()];
          }
        }
        w.post.grain = grain;
        play.start();
        const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const worst = flick.indexOf(Math.max(...flick));
        // the worst triple as a picture: its middle frame, and |f0 - 2 f1 + f2| x4 (what flickered, bright)
        const png = (fn) => {
          const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, c = document.createElement('canvas'); c.width = W; c.height = H;
          const cx = c.getContext('2d'), img = cx.createImageData(W, H);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4; for (let k = 0; k < 3; k++) img.data[o + k] = fn(i + k); img.data[o + 3] = 255; }
          cx.putImageData(img, 0, 0); return c.toDataURL('image/png');
        };
        const [a, b, c] = worstF;
        window.__flickerWorst = [png((i) => b[i]), png((i) => Math.min(255, 4 * Math.abs(a[i] - 2 * b[i] + c[i])))];
        return { flicker: +mean(flick).toFixed(3), flickerMax: +flick[worst].toFixed(3), flickerMaxAt: where[worst], meanAbsDiff: +mean(diff).toFixed(3), flickerFrames: flick.length, flickerMetres: +((warm + n + 2) * step).toFixed(1) };
      }, s.flicker));
      if (s.flicker) {
        const [mid, heat] = await page.evaluate(() => window.__flickerWorst);
        const base = `${String(idx).padStart(2, '0')}-${fileName(s.name ?? idx)}-worst`;
        fs.writeFileSync(path.join(OUT, base + '.png'), Buffer.from(mid.split(',')[1], 'base64'));
        fs.writeFileSync(path.join(OUT, base + '-diff.png'), Buffer.from(heat.split(',')[1], 'base64'));
        metrics.flickerWorst = base + '.png';
      }
      if (s.perf) {
        await keysDown(s.keys || []);
        Object.assign(metrics, await page.evaluate((o) => {
          const { play } = window.__mirage, gl = play.world.renderer.getContext(), px = new Uint8Array(4), N = o.frames || 90;
          const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          play.stop();
          for (let i = 0; i < 10; i++) { play.step(1 / 60); play.render({ moving: true }); } sync();
          // The N frames are timed as R consecutive runs of N / R (so the walker ends where it always did); the gate
          // reads the MEDIAN run, so one run that lost the CPU to another process does not fail the step, and the
          // spread between the runs says how far the number can be trusted
          const R = Math.max(1, Math.min(9, o.runs ?? 3, N)), means = [], p95s = [];
          for (let r = 0; r < R; r++) {
            const ms = [], n = Math.floor(((r + 1) * N) / R) - Math.floor((r * N) / R);
            for (let i = 0; i < n; i++) { const t = performance.now(); play.step(1 / 60); play.render({ moving: true }); sync(); ms.push(performance.now() - t); }
            ms.sort((a, b) => a - b); means.push(ms.reduce((a, b) => a + b, 0) / n); p95s.push(ms[Math.min(n - 1, Math.floor(n * 0.95))]);
          }
          const med = (a) => { const v = [...a].sort((x, y) => x - y), h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
          const info = play.world.renderer.info; info.autoReset = false; info.reset();
          play.step(1 / 60); play.render({ moving: true }); sync();
          const c = { calls: info.render.calls, triangles: info.render.triangles }; info.autoReset = true;
          play.start();
          const m = med(means);
          return { frameMs: +m.toFixed(2), p95Ms: +med(p95s).toFixed(2), frameMsRuns: means.map((v) => +v.toFixed(2)), frameMsSpread: +((Math.max(...means) - Math.min(...means)) / (m || 1)).toFixed(2), ...c };
        }, s.perf));
        await keysUp(s.keys || []);
      }
      frames = (await page.evaluate(() => window.__mirage.play.stats.frames)) - f0;
    } catch (e) { err = String(e.message || e); }
    const heldMs = Date.now() - t0;
    await wait(250);                                       // land, stop
    const st = await state().catch(() => ({ pos: [NaN, NaN, NaN] }));
    let shot = null;
    if (s.shot !== false) {
      await page.waitForFunction('window.__mirage.play.still >= 3', { timeout: 20000, polling: 50 }).catch(() => {});
      shot = `${String(idx).padStart(2, '0')}-${fileName(s.name ?? idx)}.png`;
      await page.screenshot({ path: path.join(OUT, shot) });
    }
    // what the final view shows: the ID pass right after the screenshot (no input in between, the view is the same)
    const seeSpec = s.see ? (Array.isArray(s.see) ? Object.fromEntries(s.see.map((n) => [n, '> 0.001'])) : s.see) : null;
    let seen = null;
    if (seeSpec && !err) {
      seen = await page.evaluate(seeInPage, Object.keys(seeSpec)).catch((e) => ({ error: 'see: ' + (e.message || e) }));
      if (seen.error) { err = seen.error; seen = null; }
      else Object.assign(metrics, Object.fromEntries(Object.entries(seen.names).map(([n, v]) => ['see.' + n, v.share])));
    }
    // the text over the scene: WCAG contrast behind the glyphs (after the shot and the ID pass: it repaints the overlay)
    let contrast = null;
    if (s.contrast && !err) {
      contrast = await contrastAudit(page, typeof s.contrast === 'object' ? s.contrast : {}).catch((e) => ({ error: e }));
      if (contrast.error) { err = 'contrast: ' + (contrast.error.message || contrast.error); contrast = null; }
      else Object.assign(metrics, { contrast: contrast.items.length ? Math.min(...contrast.items.map((i) => i.ratio)) : null, contrastFails: contrast.items.filter((i) => !i.pass).length });
    }
    // the baseline: the same view on the deterministic still path, against <baseline>/<shot>
    // only a view the scenario fixed (place / viewpoint, no walking or held keys since) is the same picture every run:
    // a walk ends anywhere within its tolerance. "baseline": true on a step compares it anyway.
    if (s.place || s.viewpoint !== undefined) fixedView = true;
    if (s.walkTo || s.keys || s.tap) fixedView = false;
    let still = null;
    if (BASE && shot && !err && (fixedView || s.baseline === true) && s.baseline !== false) {
      still = await page.evaluate(async () => {
        const { play } = window.__mirage, w = play.world, grain = w.post.grain;
        // was the loop running? (frames advance within three animation frames, even at the power saver's 30 fps)
        const f0 = play.stats.frames;
        for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
        const running = play.stats.frames > f0;
        play.stop(); w.post.grain = 0;
        try { play.render({ moving: false, spp: 16, frameIndex: 1 }); return document.querySelector('canvas').toDataURL('image/png'); }
        finally {
          w.post.grain = grain;
          // the canvas now holds this grain-free still: setMode(mode) restarts the still counter, so the loop draws
          // and refines the view again before a later screenshot; a loop the page had stopped stays stopped
          if (running) { play.setMode(play.mode); play.start(); }
        }
      }).catch((e) => { log('baseline still failed: ' + (e.message || e)); return null; });
    }
    const frame = shot ? await page.evaluate(frameStatsInPage, 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, shot)).toString('base64')) : {};
    const warn = [];
    if (frame.dark > DARK_SHARE) warn.push(`black frame: ${(100 * frame.dark).toFixed(0)} % of the pixels are near black`);
    if (frame.clipped > CLIPPED_SHARE) warn.push(`overexposed: ${(100 * frame.clipped).toFixed(0)} % of the pixels are near white`);
    const vals = { ...st, x: st.pos[0], y: st.pos[1], z: st.pos[2], maxY, errors: errors.length, warnings: warnings.length, fps: +(frames / (heldMs / 1000)).toFixed(1),
      dist: start ? Math.hypot(st.pos[0] - start.pos[0], st.pos[2] - start.pos[2]) : NaN, ...frame, ...metrics, see: seen ? Object.fromEntries(Object.entries(seen.names).map(([n, v]) => [n, v.share])) : undefined };
    const get = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), vals);
    // without a GPU a frame time says nothing about the scene: the number is reported, the expectation is not gated
    const ungated = (k) => SOFTWARE && (k === 'frameMs' || k === 'p95Ms' || k === 'fps');
    const checks = Object.entries(s.expect || {}).map(([k, e]) => { const v = get(k); return { k, e, v: typeof v === 'number' ? +v.toFixed(3) : v, ok: ungated(k) || check(e, v), ...(ungated(k) ? { why: 'not gated: software GL' } : {}) }; });
    if (contrast) for (const it of contrast.items.filter((i) => !i.pass)) checks.push({ k: 'contrast', e: `>= ${it.need}`, v: it.ratio, ok: false, why: `"${it.text}" (${it.selector}, ${it.size} px, ${it.color} over ~${it.backdrop})` });
    let baseRow = null;
    if (still) {
      const bf = path.join(BASE, shot), img = readPNG(still);
      if (!fs.existsSync(bf)) { fs.writeFileSync(bf, encodePNG(img)); baseRow = { file: shot, new: true }; }
      else {
        const b0 = readPNG(fs.readFileSync(bf));
        if (b0.w !== img.w || b0.h !== img.h) baseRow = { file: shot, pass: false, fails: [`size ${b0.w} x ${b0.h} vs ${img.w} x ${img.h}`] };
        else {
          const sc2 = regionSSIM(b0, img), v = ssimVerdict(sc2, T);
          baseRow = { file: shot, mean: sc2.mean, p05: sc2.p05, cell: sc2.cell, worst: sc2.worst, pass: v.pass, fails: v.fails };
          if (!v.pass) { baseRow.diff = shot.replace(/\.png$/, '-baseline-diff.png'); fs.writeFileSync(path.join(OUT, baseRow.diff), encodePNG(sideBySide(boxed(b0, sc2.worst.roi), boxed(img, sc2.worst.roi)))); }
        }
      }
      metrics.baseline = baseRow.new ? 'new' : baseRow.mean;
    }
    if (seen) for (const [n, e] of Object.entries(seeSpec)) {
      const r = seen.names[n], ok = check(e, r.share), need = +String(e).trim().split(/\s+/)[1];
      checks.push({ k: 'see.' + n, e, v: r.share, ok, ...(ok ? {} : { why: seeWhy(r, need) }) });
    }
    const pass = !err && checks.every((c) => c.ok) && !(baseRow && baseRow.pass === false);
    if (!pass) failed++;
    const row = { step: s.name, pass, ...(err ? { err } : {}), from: start && start.pos, to: st.pos, maxY: +maxY.toFixed(3), fps: vals.fps, metrics, checks, shot,
      ...(shot ? { frame } : {}), ...(seen ? { see: seen.names, seeMs: seen.ms } : {}), ...(warn.length ? { warn } : {}),
      ...(contrast ? { contrast: contrast.items } : {}), ...(baseRow ? { baseline: baseRow } : {}) };
    // why it failed: probes in the page (the view and the walker are as the checks saw them)
    const probes = {};
    if (!pass) {
      try {
        const yaw = typeof st.yaw === 'number' ? st.yaw : 0, ahead = [st.pos[0] + Math.cos(yaw), st.pos[2] + Math.sin(yaw)];
        const m = err && err.match(/walkTo: stuck at ([-\d., ]+) on the way to ([-\d.]+), ([-\d.]+)/);
        if (m) probes.stuck = stuckWords(await probe(page, { kind: 'stuck', from: m[1].split(',').map(Number), toward: [+m[2], +m[3]] }), plan);
        for (const c of checks.filter((c) => !c.ok && (c.k === 'x' || c.k === 'z' || c.k === 'dist'))) {
          const ax = c.k === 'z' ? 2 : 0, verdict = c.k === 'dist' ? 'short' : axisVerdict(c.e, start?.pos[ax], st.pos[ax]);
          if (verdict === 'through' && !probes.through) probes.through = throughWords(await probe(page, { kind: 'through', from: start.pos, to: st.pos, axis: ax, stop: parseExpect(c.e).n }));
          else if (verdict !== 'through' && !probes.stuck) probes.stuck = stuckWords(await probe(page, { kind: 'stuck', from: st.pos, to: st.pos, toward: ahead }), plan);
        }
        const seeFail = checks.filter((c) => !c.ok && c.k.startsWith('see.'));
        if (seeFail.length && seen) probes.see = await probe(page, { kind: 'see', names: Object.fromEntries(seeFail.map((c) => [c.k.slice(4), { alone: seen.names[c.k.slice(4)].alone, need: +String(c.e).trim().split(/\s+/)[1] || 0.001 }])) });
      } catch (e) { log('probe failed: ' + (e.message || e)); }
    }
    moved = moved || !!s.place || s.viewpoint !== undefined;
    const stepDiags = fromStep({ ...row, checks: checks.filter((c) => c.k !== 'contrast') }, { idx, step: moved ? s : { ...s, atSpawn: true }, plan, probe: probes, heavy, lightFix: lightWords, loadDiags, volumes: report.build?.ambientVolumes });
    const tgt = `step ${idx + 1} "${s.name ?? idx}"`;
    if (contrast) for (const it of contrast.items.filter((i) => !i.pass)) {
      stepDiags.push(diag('MG710', { target: tgt, message: `"${it.text}" (${it.selector}, ${it.size} px${it.bold ? ' bold' : ''}, colour ${it.color}) reads at ${it.ratio}:1 over a backdrop of ~${it.backdrop} (median ${it.median}:1); WCAG AA needs ${it.need}:1${it.shadow ? '; its text-shadow is not counted' : ''}` }));
    }
    if (baseRow && baseRow.pass === false) {
      const r = baseRow.worst ? baseRow.worst.roi : null;
      stepDiags.push(diag('MG460', { target: tgt, message: `${shot} differs from ${path.join(BASE, shot)}: ${baseRow.fails.join(', ')}` + (r ? `; worst cell ${baseRow.worst.i} (x ${r[0]}-${r[2]}, y ${r[1]}-${r[3]} px) SSIM ${baseRow.worst.ssim}; see ${baseRow.diff} (baseline | now)` : '') }));
    }
    if (stepDiags.length) row.diagnostics = stepDiags.map((d) => d.code);
    diagnostics.push(...stepDiags);
    results.push(row);
    log(JSON.stringify(row));
  }
  const allowed = sc.errors || 0;
  report.errors = errors; report.warnings = warnings;
  if (errors.length > allowed) { log('console errors: ' + JSON.stringify(errors)); failed++; }
  diagnostics.push(...fromConsole(errors, { allowed, stacks }));
  diagnostics.push(...fromWarnings(warnings));
  // the contact sheet: every step's screenshot with its name and verdict
  const items = results.filter((r) => r.shot).map((r) => ({ label: `${r.step}  ${r.pass ? 'pass' : 'FAIL'}`, ok: r.pass, data: 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, r.shot)).toString('base64') }));
  if (items.length) {
    const sheet = await page.evaluate(sheetInPage, items.map((it) => ({ ...it, color: it.ok ? '#bfe3a8' : '#ff7a6a' })), { cols: Math.min(4, items.length), tw: sc.phone ? PHONE.w : 400 });
    fs.writeFileSync(path.join(OUT, 'sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
  }
} catch (e) {
  if (e !== LOAD_FAILED) throw e;
  failed++;
  report.errors = loadError.errors || []; report.warnings = loadError.warnings || [];
  diagnostics.push(diag('MG603', { target: url, message: `the page did not become ready: ${loadError.message}` + (report.errors.length ? `; console: ${report.errors.slice(0, 5).join(' | ')}` : '') }));
  diagnostics.push(...fromConsole(report.errors, { stacks: loadError.stacks || [] }));
} finally {
  await browser.close();
  if (srv) srv.close();
}
Object.assign(report, { failed, pass: !failed, steps: results, diagnostics: sortDiagnostics(diagnostics) });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(OUT, 'report.md'), markdown(report));
return report;
}

// the CLI (also when run through the npm bin link)
const self = (() => { try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(new URL(import.meta.url).pathname); } catch { return false; } })();
/** The command line: mirage-playtest <scenario.json> <target> [--out dir]; exits 1 on failure. */
export async function main(args = process.argv.slice(2)) {
  const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const [scenarioFile, target] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--phone'));
  if (!scenarioFile || !target) { console.error('usage: mirage-playtest <scenario.json> <dist dir | page.html | http(s) url> [--out dir] [--baseline dir] [--phone]'); process.exit(2); }
  const sc = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
  if (flag('baseline')) sc.baseline = path.resolve(flag('baseline'));   // absolute: not relative to the scenario
  if (args.includes('--phone')) sc.phone = true;
  const out = path.resolve(flag('out', 'out/playtest'));
  const report = await playtest(sc, target, { out, scenarioFile });
  for (const d of report.diagnostics.filter((d) => d.severity !== "info")) console.log(formatDiagnostic(d));
  console.log(`playtest: ${report.failed ? report.failed + ' failing' : 'all pass'}; diagnostics: ${['error', 'warning', 'info'].map((s) => report.diagnostics.filter((d) => d.severity === s).length + ' ' + s).join(', ')} -> ${path.join(out, 'report.md')}`);
  process.exit(report.failed ? 1 : 0);
}

function markdown(r) {
  const fmt = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x.toFixed(2) : x)).join(', ') : v === undefined ? '' : String(v));
  const rows = r.steps.map((s, i) => `| ${i + 1} | ${s.step} | ${s.pass ? 'pass' : '**FAIL**'} | ${s.checks.map((c) => `${c.ok ? '' : '✗ '}${c.k} ${c.e} (${fmt(c.v)})${c.why ? ': ' + c.why : ''}`).join('<br>')}${s.err ? '<br>✗ ' + s.err : ''}${(s.warn || []).map((w) => '<br>⚠ ' + w).join('')} | ${fmt(s.to)} | ${s.fps || ''} | ${s.shot ? `[png](${s.shot})` : ''} |`);
  const metrics = r.steps.filter((s) => Object.keys(s.metrics).length).map((s) => `- **${s.step}**: ` + Object.entries(s.metrics).map(([k, v]) => `${k} ${v}`).join(', '));
  const contracts = (r.build?.modules || []).flatMap(m => (m.consumes || []).map(a =>
    `- ${m.name} · ${a.key} (${a.required ? 'required' : 'optional'}) · ${a.count} available`));
  return `# Playtest: ${r.title} — ${r.pass ? 'PASS' : 'FAIL'}

- target: \`${r.url}\` (${r.w} × ${r.h}), ${r.at}
- GPU: ${r.gpu}; load to ready ${r.loadMs} ms; world build ${r.build ? r.build.ms + ' ms, failed modules: ' + (r.build.failed.map((f) => f.name + ' (' + f.phase + ')').join(', ') || 'none') : '?'}
- modules (build order): ${r.build ? r.build.modules.map((m) => `${m.name} ${m.ok ? '' : '**failed** '}${(m.tris / 1000).toFixed(1)} k tris ${(+m.ms).toFixed(0)} ms`).join(' · ') : '?'}; anchors: ${r.build ? JSON.stringify(r.build.anchors) : '?'}
- walk grid: ${r.grid ? JSON.stringify(r.grid) : '?'}
- steps: ${r.steps.filter((s) => s.pass).length} / ${r.steps.length} pass; console errors: ${r.errors ? r.errors.length : '?'}, warnings: ${r.warnings ? r.warnings.length : '?'}

${markdownDiagnostics(r.diagnostics || [])}

| # | step | result | checks (value) | feet at end | fps | shot |
|---|---|---|---|---|---|---|
${rows.join('\n')}
${contracts.length ? '\n## Anchor consumption\n\n' + contracts.join('\n') + '\n' : ''}
${metrics.length ? '\n## Metrics\n\n' + metrics.join('\n') + '\n' : ''}
## Console

${(r.errors || []).concat(r.warnings || []).map((e) => '- `' + e.replace(/`/g, "'") + '`').join('\n') || 'No errors or warnings.'}

Contact sheet: [sheet.png](sheet.png)
`;
}
if (self) await main();
