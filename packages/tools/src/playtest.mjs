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
//   "perf": { "frames": 90 }  synchronous frame cost while the held keys act (step + render + 1-px readback)
//       -> frameMs (mean), p95Ms, calls, triangles
//   "expect": { "<value>": "<op> <operand> [tolerance]" }   ops: < > <= >= ~ == != has
//       values: x y z maxY dist onGround blocked mode fps | near prompt inventory paused flags.<name> (games)
//               | flicker meanAbsDiff flickerMax | frameMs p95Ms calls triangles | errors warnings (console errors / warnings so far)
//       dist = horizontal distance moved in the step; maxY = highest feet height seen in it; has = substring / member
//   "shot": false  (default true)
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, open } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [scenarioFile, target] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!scenarioFile || !target) { console.error('usage: mirage-playtest <scenario.json> <dist dir | page.html> [--out dir]'); process.exit(2); }
const sc = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
const OUT = path.resolve(flag('out', 'out/playtest'));
fs.mkdirSync(OUT, { recursive: true });
const W = sc.w || 1440, H = sc.h || 900;

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

const isFile = target.endsWith('.html');
const srv = isFile ? null : await serve(target);
const url = (isFile ? 'file://' + path.resolve(target) : srv.url) + '?' + (sc.query || 'mode=walk&ui=0') + `&w=${W}&h=${H}`;
const browser = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [], wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { title: sc.title || path.basename(scenarioFile), url, scenario: path.resolve(scenarioFile), at: new Date().toISOString(), w: W, h: H };
let failed = 0;
try {
  const { page, errors, warnings, loadMs } = await open(browser, url);
  Object.assign(report, { loadMs, ...(await page.evaluate(() => {
    const { play, built } = window.__mirage, gl = play.world.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '?', grid: play.grid.stats, build: built && built.report ? { ms: built.report.ms, failed: built.report.failed, modules: built.report.modules.map((m) => ({ name: m.name, ok: m.ok, ms: m.ms, tris: m.tris })), anchors: built.report.anchors } : null };
  })) });
  console.log(JSON.stringify({ step: 'load', loadMs, grid: report.grid, build: report.build }));
  const state = () => page.evaluate(() => {
    const m = window.__mirage, s = m.play.state(), g = m.g;
    if (g) Object.assign(s, { near: g.near ? g.near.id : null, prompt: g.near ? g.game.label(g.near) : null, flags: { ...g.game.flags }, inventory: g.game.inventory.items.map((i) => i.id), paused: g.game.paused });
    return s;
  });
  const keysDown = async (ks) => { for (const k of ks) await page.keyboard.down(k); };
  const keysUp = async (ks) => { for (const k of ks) await page.keyboard.up(k); };
  for (const [idx, s] of sc.steps.entries()) {
    const t0 = Date.now(), metrics = {};
    let err = null, maxY = -Infinity, start = null, frames = 0;
    try {
      if (s.place) await page.evaluate((p) => window.__mirage.play.place(p.eye, p.look, p.mode), s.place);
      if (s.mode) await page.evaluate((m) => window.__mirage.play.setMode(m), s.mode);
      if (s.viewpoint !== undefined) await page.evaluate((i) => window.__mirage.play.viewpoint(i), s.viewpoint);
      if (s.place || s.viewpoint !== undefined) await wait(150);   // settle onto the ground
      start = await state(); maxY = start.pos[1];
      const f0 = await page.evaluate(() => window.__mirage.play.stats.frames);
      const track = async (until, each) => { while (Date.now() < until) { await wait(40); const st = await state(); maxY = Math.max(maxY, st.pos[1]); if (each && (await each(st))) return true; } return false; };
      if (s.walkTo) {
        let run = !!s.run;
        await keysDown(run ? ['KeyW', 'ShiftLeft'] : ['KeyW']);
        try {
          for (const [k, [x, z]] of s.walkTo.entries()) {
            const last = k === s.walkTo.length - 1, tol = last ? s.tol || 0.35 : Math.max(s.tol || 0.35, 0.8);   // corners can be cut
            let mark = [start.pos, Date.now()];   // no progress for 2.5 s = stuck
            const ok = await track(Date.now() + (s.timeout || 30000), async (st) => {
              if (Math.hypot(st.pos[0] - mark[0][0], st.pos[2] - mark[0][2]) > 0.1) mark = [st.pos, Date.now()];
              else if (Date.now() - mark[1] > 2500) throw new Error(`walkTo: stuck at ${st.pos.join(', ')} on the way to ${x}, ${z} (no progress for 2.5 s)`);
              await page.evaluate((x, z) => { const { play } = window.__mirage; play.lookAt([x, play.state().eye[1], z]); }, x, z);
              const d = Math.hypot(st.pos[0] - x, st.pos[2] - z);
              if (d < 1.2 && run && last) { await page.keyboard.up('ShiftLeft'); run = false; }
              return d < tol;
            });
            if (!ok) throw new Error(`walkTo: timed out at ${(await state()).pos.join(', ')} on the way to ${x}, ${z} (moving; try "run": true or a longer "timeout")`);
          }
        } finally { await keysUp(['KeyW', 'ShiftLeft']); }
        await wait(250);
      }
      if (s.lookAt) {
        await page.evaluate((t) => {
          const { play, g } = window.__mirage;
          const p = typeof t === 'string' ? g.game.where(g.game.entities.get(t)) : t;
          if (!p) throw new Error('lookAt: no entity ' + t);
          play.lookAt(p);
        }, s.lookAt);
        await wait(300);
      }
      for (const k of [s.tap || []].flat()) { await page.keyboard.down(k); await wait(80); await page.keyboard.up(k); await wait(250); }
      if (s.keys && !s.perf) { await keysDown(s.keys); await track(Date.now() + (s.ms || 1000)); await keysUp(s.keys); }
      else if (s.ms && !s.perf) await track(Date.now() + s.ms);
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
        const base = `${String(idx).padStart(2, '0')}-${s.name}-worst`;
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
          const ms = [];
          for (let i = 0; i < N; i++) { const t = performance.now(); play.step(1 / 60); play.render({ moving: true }); sync(); ms.push(performance.now() - t); }
          const info = play.world.renderer.info; info.autoReset = false; info.reset();
          play.step(1 / 60); play.render({ moving: true }); sync();
          const c = { calls: info.render.calls, triangles: info.render.triangles }; info.autoReset = true;
          play.start();
          ms.sort((a, b) => a - b);
          return { frameMs: +(ms.reduce((a, b) => a + b, 0) / N).toFixed(2), p95Ms: +ms[Math.floor(N * 0.95)].toFixed(2), ...c };
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
      shot = `${String(idx).padStart(2, '0')}-${s.name}.png`;
      await page.screenshot({ path: path.join(OUT, shot) });
    }
    const vals = { ...st, x: st.pos[0], y: st.pos[1], z: st.pos[2], maxY, errors: errors.length, warnings: warnings.length, fps: +(frames / (heldMs / 1000)).toFixed(1),
      dist: start ? Math.hypot(st.pos[0] - start.pos[0], st.pos[2] - start.pos[2]) : NaN, ...metrics };
    const get = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), vals);
    const checks = Object.entries(s.expect || {}).map(([k, e]) => { const v = get(k); return { k, e, v: typeof v === 'number' ? +v.toFixed(3) : v, ok: check(e, v) }; });
    const pass = !err && checks.every((c) => c.ok);
    if (!pass) failed++;
    const row = { step: s.name, pass, ...(err ? { err } : {}), from: start && start.pos, to: st.pos, maxY: +maxY.toFixed(3), fps: vals.fps, metrics, checks, shot };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  const allowed = sc.errors || 0;
  report.errors = errors; report.warnings = warnings;
  if (errors.length > allowed) { console.log('console errors:', errors); failed++; }
  // the contact sheet: every step's screenshot with its name and verdict
  const items = results.filter((r) => r.shot).map((r) => ({ label: `${r.step}  ${r.pass ? 'pass' : 'FAIL'}`, ok: r.pass, data: 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, r.shot)).toString('base64') }));
  if (items.length) {
    const sheet = await page.evaluate(async (items) => {
      const cols = Math.min(4, items.length), tw = 400, th = Math.round((tw * innerHeight) / innerWidth), pad = 8, lab = 22;
      const c = document.createElement('canvas');
      c.width = cols * (tw + pad) + pad; c.height = Math.ceil(items.length / cols) * (th + lab + pad) + pad;
      const g = c.getContext('2d');
      g.fillStyle = '#16130f'; g.fillRect(0, 0, c.width, c.height);
      for (const [k, it] of items.entries()) {
        const img = new Image(); img.src = it.data; await img.decode();
        const x = pad + (k % cols) * (tw + pad), y = pad + Math.floor(k / cols) * (th + lab + pad);
        g.drawImage(img, x, y, tw, th);
        g.fillStyle = it.ok ? '#bfe3a8' : '#ff7a6a'; g.font = '13px system-ui, sans-serif'; g.fillText(`${k + 1}  ${it.label}`, x + 2, y + th + 16);
      }
      return c.toDataURL('image/png');
    }, items);
    fs.writeFileSync(path.join(OUT, 'sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
  }
} finally {
  await browser.close();
  if (srv) srv.close();
}
Object.assign(report, { failed, pass: !failed, steps: results });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(OUT, 'report.md'), markdown(report));
console.log(`playtest: ${failed ? failed + ' failing' : 'all pass'} -> ${path.join(OUT, 'report.md')}`);
process.exit(failed ? 1 : 0);

function markdown(r) {
  const fmt = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x.toFixed(2) : x)).join(', ') : v === undefined ? '' : String(v));
  const rows = r.steps.map((s, i) => `| ${i + 1} | ${s.step} | ${s.pass ? 'pass' : '**FAIL**'} | ${s.checks.map((c) => `${c.ok ? '' : '✗ '}${c.k} ${c.e} (${fmt(c.v)})`).join('<br>')}${s.err ? '<br>✗ ' + s.err : ''} | ${fmt(s.to)} | ${s.fps || ''} | ${s.shot ? `[png](${s.shot})` : ''} |`);
  const metrics = r.steps.filter((s) => Object.keys(s.metrics).length).map((s) => `- **${s.step}**: ` + Object.entries(s.metrics).map(([k, v]) => `${k} ${v}`).join(', '));
  return `# Playtest: ${r.title} — ${r.pass ? 'PASS' : 'FAIL'}

- target: \`${r.url}\` (${r.w} × ${r.h}), ${r.at}
- GPU: ${r.gpu}; load to ready ${r.loadMs} ms; world build ${r.build ? r.build.ms + ' ms, failed modules: ' + (r.build.failed.map((f) => f.name + ' (' + f.phase + ')').join(', ') || 'none') : '?'}
- modules (build order): ${r.build ? r.build.modules.map((m) => `${m.name} ${m.ok ? '' : '**failed** '}${(m.tris / 1000).toFixed(1)} k tris ${(+m.ms).toFixed(0)} ms`).join(' · ') : '?'}; anchors: ${r.build ? JSON.stringify(r.build.anchors) : '?'}
- walk grid: ${r.grid ? JSON.stringify(r.grid) : '?'}
- steps: ${r.steps.filter((s) => s.pass).length} / ${r.steps.length} pass; console errors: ${r.errors ? r.errors.length : '?'}, warnings: ${r.warnings ? r.warnings.length : '?'}

| # | step | result | checks (value) | feet at end | fps | shot |
|---|---|---|---|---|---|---|
${rows.join('\n')}
${metrics.length ? '\n## Metrics\n\n' + metrics.join('\n') + '\n' : ''}
## Console

${(r.errors || []).concat(r.warnings || []).map((e) => '- `' + e.replace(/`/g, "'") + '`').join('\n') || 'No errors or warnings.'}

Contact sheet: [sheet.png](sheet.png)
`;
}
