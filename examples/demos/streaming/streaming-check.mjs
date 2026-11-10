// Check and measurements of the streaming opt-ins (examples/demos/streaming), A/B against the defaults, interleaved.
// node examples/demos/streaming/streaming-check.mjs [--runs 3] [--only decode,warm,bake,slice,stream,ktx2] [--out file.json]
// Builds the demo into out/dist (vite), serves it, opens it in headless Chrome (GPU on) and, per part:
//   decode  default vs ?decode=bitmap: long tasks from navigation to ready + 1 s, textures ready, prepare, first frame;
//           the still frame must be identical
//   upload  six new 1024 px textures uploaded in one frame vs 8 MB a frame (createUploadBudget): the longest frame
//   warm    default vs ?warm=1 on the courtyard and the garden: the first frame (CPU, and until the GPU is done);
//           the still frame must be identical
//   bake    bakeWalkGrid vs bakeWalkGridAsync (tiles of 128 cells, and whole) on both worlds: floors and count arrays must be
//           bit-identical; a region re-bake (sync and async) into a scribbled copy must give the full bake back
//   slice   buildWorld of the garden's modules into a side scene while the page draws, without and with
//           { slice: true }: the longest frame interval during the build
//   stream  walking out of the gate to the kiosk and back twice: ?stream=sync (loaded in the frame it comes in range)
//           vs ?stream=1 (streamed): frame callback ms and frame interval, mean / p95 / max (MG502 is the p95)
//   ktx2    (if `basisu` is on PATH) the courtyard's sets as KTX2 (ETC1S): loads without errors; mean pixel
//           difference to the WebP still; texture bytes
// Exit 1 if an identity check fails or a page logs an error.
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const RUNS = +flag('runs', 3), ONLY = (flag('only', 'decode,upload,warm,bake,slice,stream,ktx2')).split(',');
const DIST = path.join(here, 'out/dist'), W = 960, H = 600;
const failures = [], results = { gpu: null, runs: RUNS };
const fail = (m) => { failures.push(m); console.log('FAIL ' + m); };

await build({ root: here, logLevel: 'warn', configFile: false, build: { outDir: DIST, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1e5 } });
const basis = path.join(root, 'node_modules/three/examples/jsm/libs/basis');
fs.mkdirSync(path.join(DIST, 'basis'), { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) fs.copyFileSync(path.join(basis, f), path.join(DIST, 'basis', f));
// KTX2 copies of the courtyard's sets: WebP -> PNG (sips on macOS), PNG -> KTX2 ETC1S with mipmaps, flipped so the
// bottom row is v = 0 as in the WebP path; normal maps linear
let ktx2 = false;
if (ONLY.includes('ktx2')) {
  try {
    execFileSync('basisu', ['-version'], { stdio: 'ignore' });
    const src = path.join(root, 'examples/hello-courtyard/tex'), dst = path.join(DIST, 'tex-ktx2'), tmp = path.join(here, 'out/png');
    fs.mkdirSync(dst, { recursive: true }); fs.mkdirSync(tmp, { recursive: true });
    for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.webp'))) {
      const png = path.join(tmp, f.replace('.webp', '.png')), out = path.join(dst, f.replace('.webp', '.ktx2'));
      if (!fs.existsSync(out)) {
        execFileSync('sips', ['-s', 'format', 'png', path.join(src, f), '--out', png], { stdio: 'ignore' });
        execFileSync('basisu', ['-ktx2', '-mipmap', '-y_flip', ...(f.includes('_n') ? ['-linear', '-normal_map'] : []), '-file', png, '-output_file', out], { stdio: 'ignore' });
      }
    }
    ktx2 = true;
  } catch (e) { console.log('ktx2: skipped (' + (e.code === 'ENOENT' ? 'basisu or sips not found' : e.message.split('\n')[0]) + ')'); }
}
const srv = await serve(DIST);

// every page in a browser of its own: a cold start each time (Chrome keeps linked programs for the browser's life,
// which would hand the second variant the first one's compiles)
async function open(query) {
  const browser = await launch({ w: W, h: H });
  const page = await browser.newPage(), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([+e.startTime.toFixed(1), +e.duration.toFixed(1)]); }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(`${srv.url}?w=${W}&h=${H}&${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 50 });
  return { page, errors, browser };
}
const close = async ({ errors, browser }, label) => { if (errors.length) fail(`${label}: console errors: ${errors.slice(0, 3).join(' | ')}`); await browser.close(); };
// load phase numbers: long tasks up to ready + 1 s, the page's own timings
async function loadStats(query) {
  const p = await open(query);
  await new Promise((r) => setTimeout(r, 1000));
  const s = await p.page.evaluate(() => {
    const ready = performance.now(), lt = window.__lt;
    return { timing: window.__mirage.timing, longTasks: { count: lt.length, totalMs: +lt.reduce((a, t) => a + t[1], 0).toFixed(1), maxMs: lt.reduce((a, t) => Math.max(a, t[1]), 0) }, gpu: (() => { const gl = window.__mirage.world.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })() };
  });
  results.gpu ??= s.gpu;
  return { p, s };
}
// a still of viewpoint i, as a PNG data URL
const still = (page, i = 0) => page.evaluate(async (i) => {
  const { play } = window.__mirage;
  play.stop(); play.viewpoint(i);
  for (let k = 0; k < 40; k++) play.step(1 / 30);
  play.render({ moving: false, spp: 4, frameIndex: 1 });
  return document.querySelector('canvas').toDataURL('image/png');
}, i);
const pixels = (page, a, b) => page.evaluate(async (a, b) => {
  const img = async (u) => { const i = new Image(); i.src = u; await i.decode(); const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
  const A = await img(a), B = await img(b); let s = 0, mx = 0, n = 0;
  for (let k = 0; k < A.length; k += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(A[k + c] - B[k + c]); s += d; mx = Math.max(mx, d); n++; }
  return { meanAbs: +(s / n).toFixed(4), max: mx };
}, a, b);
const stat = (v) => { const s = [...v].sort((a, b) => a - b); return { mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2), n: s.length }; };
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const summary = (rows, keys) => Object.fromEntries(keys.map((k) => [k, { median: med(rows.map((r) => k.split('.').reduce((o, p) => o?.[p], r))), all: rows.map((r) => k.split('.').reduce((o, p) => o?.[p], r)) }]));

// ---- A/B of load-phase options, interleaved; stills compared on the first run
async function ab(name, variants, keys) {
  const rows = Object.fromEntries(variants.map(([label]) => [label, []]));
  let ref = null;
  for (let r = 0; r < RUNS; r++) {
    for (const [label, query] of r % 2 ? [...variants].reverse() : variants) {   // alternate who goes first
      const { p, s } = await loadStats(query);
      rows[label].push(s);
      if (r < 2) {
        const png = await still(p.page);
        if (!ref || ref.label === label) ref = { png, label };
        else {
          const d = await pixels(p.page, ref.png, png);
          s.still = d;
          if (d.max !== 0) fail(`${name}: ${label} still differs from ${ref.label} (mean ${d.meanAbs}, max ${d.max})`);
        }
      }
      await close(p, `${name} ${label}`);
    }
  }
  results[name] = Object.fromEntries(Object.entries(rows).map(([label, list]) => [label, { ...summary(list, keys), still: list[0].still || 'reference' }]));
  console.log(name, JSON.stringify(Object.fromEntries(Object.entries(results[name]).map(([l, v]) => [l, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.median ?? x]))]))));
}
const LOADKEYS = ['longTasks.count', 'longTasks.totalMs', 'longTasks.maxMs', 'timing.texReadyMs', 'timing.prepareMs', 'timing.firstFrameMs', 'timing.firstFrameCpuMs', 'timing.readyMs'];

if (ONLY.includes('decode')) await ab('decode', [['image', 'world=courtyard'], ['bitmap', 'world=courtyard&decode=bitmap']], LOADKEYS);
// ---- uploads: six new 1024 px textures (24 MB with mipmaps) uploaded in one frame (what three does when one draw
// first samples them) vs through createUploadBudget at 8 MB a frame: the longest frame's upload ms and the frames used
if (ONLY.includes('upload')) {
  const rows = { oneFrame: [], budget8: [] };
  for (let r = 0; r < RUNS; r++) for (const mode of r % 2 ? ['budget8', 'oneFrame'] : ['oneFrame', 'budget8']) {
    const p = await open('world=courtyard');
    const s = await p.page.evaluate(async (mode) => {
      const { world, lib, play } = window.__mirage, THREE = world.ctx.THREE, gl = world.renderer.getContext();
      play.stop();
      const make = (k) => { const n = 1024, d = new Uint8Array(n * n * 4); for (let i = 0; i < d.length; i += 4) { d[i] = (i >> 4) & 255; d[i + 1] = k * 40; d[i + 2] = (i >> 12) & 255; d[i + 3] = 255; }
        const t = new THREE.DataTexture(d, n, n); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
      const tex = Array.from({ length: 6 }, (_, k) => make(k));
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      await frame(); sync();
      const ms = [];
      if (mode === 'oneFrame') { await frame(); const t = performance.now(); for (const x of tex) world.renderer.initTexture(x); sync(); ms.push(performance.now() - t); }
      else {
        const up = lib.createUploadBudget(world.renderer, { bytes: 8 * 1024 * 1024 }).add(tex);
        while (up.pending) { await frame(); const t = performance.now(); up.step(); sync(); ms.push(performance.now() - t); }
      }
      for (const x of tex) x.dispose();
      return { frames: ms.length, maxMs: +Math.max(...ms).toFixed(1), totalMs: +ms.reduce((a, b) => a + b, 0).toFixed(1) };
    }, mode);
    rows[mode].push(s);
    await close(p, 'upload ' + mode);
  }
  results.upload = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, summary(v, ['maxMs', 'totalMs', 'frames'])]));
  console.log('upload', JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v]))));
}
if (ONLY.includes('warm')) for (const w of ['courtyard', 'garden']) await ab('warm-' + w, [['off', `world=${w}`], ['warm', `world=${w}&warm=1`]], [...LOADKEYS, 'timing.warmMs']);

// ---- walk grid: async (tiled) and region re-bakes give the sync arrays bit for bit
if (ONLY.includes('bake')) {
  results.bake = {};
  for (const w of ['courtyard', 'garden']) {
    const p = await open(`world=${w}`);
    const r = await p.page.evaluate(async () => {
      const { world, plan, lib, play } = window.__mirage;
      play.stop();
      const o = { bounds: plan.bounds, ...plan.walk };
      const hash = (g) => { let h = 2166136261; for (const a of [g.floors, g.count]) { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619); } return h >>> 0; };
      const same = (a, b) => a.floors.length === b.floors.length && a.floors.every((v, i) => Object.is(v, b.floors[i])) && a.count.every((v, i) => v === b.count[i]);
      // frame gaps while the async bake runs (the page keeps drawing: a rAF loop counting)
      const gaps = []; let last = 0, on = true;
      const loop = (t) => { if (last) gaps.push(t - last); last = t; if (on) requestAnimationFrame(loop); };
      const syncs = []; let full;
      for (let k = 0; k < 3; k++) { const t = performance.now(); full = lib.bakeWalkGrid(world, o); syncs.push(performance.now() - t); }
      requestAnimationFrame(loop);
      const asy = await lib.bakeWalkGridAsync(world, { ...o, tile: 128 });
      const asyWhole = await lib.bakeWalkGridAsync(world, o);
      on = false;
      // a region: scribble a copy there, re-bake it (sync and async), compare to the full bake
      const [x0, z0, x1, z1] = plan.bounds, region = [x0 + (x1 - x0) * 0.3, z0 + (z1 - z0) * 0.3, x0 + (x1 - x0) * 0.62, z0 + (z1 - z0) * 0.55];
      const copy = (g) => Object.assign(lib.bakeWalkGrid(world, o), {});
      const c1 = copy(), c2 = copy();
      for (const c of [c1, c2]) for (let j = 0; j < c.nz; j++) for (let i = 0; i < c.nx; i++) {
        const x = c.x0 + (i + 0.5) * c.cell, z = c.z0 + (j + 0.5) * c.cell;
        if (x > region[0] && x < region[2] && z > region[1] && z < region[3]) { const k = j * c.nx + i; c.count[k] = 3; c.floors.fill(7.5, k * 8, k * 8 + 8); }
      }
      const scribbled = !same(c1, full);
      const tr = performance.now(); lib.bakeWalkGrid(world, { into: c1, region }); const regionSyncMs = performance.now() - tr;
      const ta = performance.now(); const ra = await lib.bakeWalkGridAsync(world, { into: c2, region, tile: 32 }); const regionAsyncMs = performance.now() - ta;
      // review regressions: a zero budget still finishes (one read a frame at least); overlapping region re-bakes into one
      // grid while the scene changes under them end equal to a fresh bake of the changed scene
      const zero = await lib.bakeWalkGridAsync(world, { ...o, budgetMs: 0 });
      const T3 = world.ctx.THREE, cx = (region[0] + region[2]) / 2, cz = (region[1] + region[3]) / 2;
      const block = new T3.Mesh(new T3.BoxGeometry(2, 1.5, 2), new T3.MeshBasicMaterial()); block.position.set(cx, plan.walk.yMax - 1.2, cz);   // a plate high above everything: a new floor
      const c3 = copy();
      const pA = lib.bakeWalkGridAsync(world, { into: c3, region, inflight: 1, budgetMs: 0 });   // one slab a frame: still running when the block comes
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      world.scene.add(block); block.updateMatrixWorld();
      const pB = lib.bakeWalkGridAsync(world, { into: c3, region });
      const [restartsA] = await Promise.all([pA.then((g) => g.stats.restarts), pB]);   // stats live on the grid: read A's before B ends
      const withBlock = lib.bakeWalkGrid(world, o);
      world.scene.remove(block); block.geometry.dispose();
      const overlap = { restartsA, same: same(c3, withBlock), blockSeen: !same(withBlock, full) };
      const gs = gaps.sort((a, b) => a - b);

      return { cells: full.nx * full.nz, slabs: full.stats.slabs, floors: full.stats.floors, syncMs: syncs.map((v) => +v.toFixed(1)), hash: hash(full),
        asyncTiled: { same: same(full, asy), hash: hash(asy), ms: asy.stats.ms, frames: asy.stats.frames, tiles: asy.stats.tiles, maxSliceMs: asy.stats.maxSliceMs },
        asyncWhole: { same: same(full, asyWhole), ms: asyWhole.stats.ms, frames: asyWhole.stats.frames, maxSliceMs: asyWhole.stats.maxSliceMs },
        frameGapsDuringAsync: { n: gs.length, p95: +(gs[Math.floor(gs.length * 0.95)] || 0).toFixed(1), max: +(gs.at(-1) || 0).toFixed(1) },
        zeroBudget: { same: same(zero, full), frames: zero.stats.frames }, overlap,
        region: { scribbled, syncSame: same(c1, full), asyncSame: same(c2, full), cells: ra.stats.region.w * ra.stats.region.h, syncMs: +regionSyncMs.toFixed(1), asyncMs: +regionAsyncMs.toFixed(1), asyncFrames: ra.stats.frames } };
    });
    results.bake[w] = r;
    console.log('bake', w, JSON.stringify(r));
    if (!r.asyncTiled.same || !r.asyncWhole.same) fail(`bake ${w}: the async bake differs from the sync bake`);
    if (!r.region.scribbled || !r.region.syncSame || !r.region.asyncSame) fail(`bake ${w}: a region re-bake does not give the full bake back`);
    if (!r.zeroBudget.same) fail(`bake ${w}: budgetMs 0 does not finish with the same arrays`);
    if (!r.overlap.blockSeen || !r.overlap.same || !r.overlap.restartsA) fail(`bake ${w}: overlapping region re-bakes with a scene change do not end equal to a fresh bake (${JSON.stringify(r.overlap)})`);
    await close(p, 'bake ' + w);
  }
}

// ---- time slicing: the garden's modules built into a side scene while the page draws
if (ONLY.includes('slice')) {
  const rows = { off: [], slice: [] };
  for (let r = 0; r < RUNS; r++) for (const mode of ['off', 'slice']) {
    const p = await open('world=garden');
    const s = await p.page.evaluate(async (mode) => {
      const { world, plan, lib, tex } = window.__mirage;
      const host = { scene: new world.ctx.THREE.Scene(), ctx: world.ctx };   // nothing is added to the live scene
      const gaps = []; let last = 0, on = true;
      const loop = (t) => { if (last) gaps.push(t - last); last = t; if (on) requestAnimationFrame(loop); };
      await new Promise((r) => requestAnimationFrame(r)); requestAnimationFrame(loop);
      await new Promise((r) => setTimeout(r, 300));
      const n0 = gaps.length, t = performance.now();
      const b = await lib.buildWorld(host, { plan, modules: lib.modules({}), shared: { tex }, log: { log() {}, error() {} }, ...(mode === 'slice' ? { slice: true } : {}) });
      const ms = performance.now() - t;
      await new Promise((r) => setTimeout(r, 100)); on = false;
      const g = gaps.slice(n0).sort((a, b) => a - b);
      return { buildMs: +ms.toFixed(1), modules: b.report.modules.length, maxModuleMs: Math.max(...b.report.modules.map((m) => m.ms)), maxGapMs: +g.at(-1).toFixed(1), framesDuring: g.length, slices: b.report.slices || null };
    }, mode);
    rows[mode].push(s);
    await close(p, 'slice ' + mode);
  }
  results.slice = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, summary(v, ['buildMs', 'maxGapMs', 'framesDuring', 'maxModuleMs'])]));
  results.slice.sample = rows.slice[0].slices;
  console.log('slice', JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.map((x) => `${x.buildMs}ms build, max gap ${x.maxGapMs}, ${x.framesDuring} frames`)]))));
}

// ---- streaming the kiosk in and out while walking, vs loading it in the frame it comes in range
if (ONLY.includes('stream')) {
  const rows = { sync: [], stream: [] };
  for (let r = 0; r < RUNS; r++) for (const mode of r % 2 ? ['stream', 'sync'] : ['sync', 'stream']) {
    // salt: the kiosk's shaders are new to the machine on every run (the driver keeps compiled programs across runs)
    const p = await open(`world=courtyard&stream=${mode === 'sync' ? 'sync' : '1'}&salt=${r + 1}${Date.now() % 100000}`);
    const s = await p.page.evaluate(async () => {
      const { world, play, streamer } = window.__mirage, gl = world.renderer.getContext(), cam = world.camera;
      play.stop();
      // the route: inside the court -> out of the gate -> by the kiosk -> back in; twice (the second visit is cached)
      const P = [[-5, -4], [0, 4], [0, 9], [2.5, 12.5], [2.5, 12.5], [0, 9], [0, 4], [-5, -4]];
      const seg = []; let L = 0;
      for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) || 3; seg.push([P[i - 1], P[i], L, l]); L += l; }
      const at = (d) => { d %= L; const [a, b, s0, l] = seg.find(([, , s0, l]) => d <= s0 + l) || seg.at(-1); const f = Math.min(1, (d - s0) / l); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
      const speed = 6, cb = [], gaps = [], marks = [];
      let d = 0, last = 0, T = 0;
      await new Promise((done) => {
        const frame = (now) => {
          const t0 = performance.now();
          if (last) gaps.push(now - last);
          const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60; last = now;
          d += speed * dt; T += dt;
          const [x, z] = at(d), [x2, z2] = at(d + 0.5);
          cam.position.set(x, 1.62, z); cam.lookAt(x2, 1.55, z2); cam.updateMatrixWorld();
          streamer.update(cam.position);
          world.renderFrame(T, { taa: true, camera: cam });
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
          cb.push(performance.now() - t0);
          const st = streamer.state().kiosk; if (marks.at(-1)?.[1] !== st) marks.push([cb.length, st]);
          if (d < 2 * L) requestAnimationFrame(frame); else done();
        };
        requestAnimationFrame(frame);
      });
      const S = (v) => { const s = [...v].sort((a, b) => a - b); return { mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s.at(-1).toFixed(2) }; };
      const buckets = []; for (let i = 0; i < cb.length; i += 50) { const b = cb.slice(i, i + 50); buckets.push(+(b.reduce((x, y) => x + y, 0) / b.length).toFixed(1)); }
      return { frames: cb.length, buckets, callback: S(cb), interval: { ...S(gaps), over33: gaps.filter((g) => g > 33.4).length }, states: marks.map(([f, s]) => `${f}:${s}`).join(' '), loads: streamer.stats.loads, builds: streamer.stats.builds.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v]))) };
    });
    rows[mode].push(s);
    console.log('stream', mode, JSON.stringify(s));
    await close(p, 'stream ' + mode);
  }
  results.stream = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { ...summary(v, ['callback.mean', 'callback.p95', 'callback.max', 'interval.p95', 'interval.max', 'interval.over33']), builds: v[0].builds, states: v[0].states }]));
}

// ---- KTX2 sets
if (ONLY.includes('ktx2') && ktx2) {
  const a = await open('world=courtyard'), b = await open('world=courtyard&ktx2=1');
  const bytes = (page) => page.evaluate(() => window.__mirage.tex.textures().reduce((s, t) => s + (t.isCompressedTexture ? t.mipmaps.reduce((q, m) => q + m.data.byteLength, 0) : t.image.width * t.image.height * 4 * 4 / 3), 0));
  const fmt = await b.page.evaluate(() => [...new Set(window.__mirage.tex.textures().map((t) => `${t.isCompressedTexture ? 'compressed' : 'plain'} ${t.format} ${t.colorSpace}`))]);
  const pa = await still(a.page), pb = await still(b.page);
  const d = await pixels(b.page, pa, pb);
  results.ktx2 = { formats: fmt, gpuBytes: { webp: Math.round(await bytes(a.page)), ktx2: Math.round(await bytes(b.page)) }, stillVsWebp: d,
    timing: { webp: await a.page.evaluate(() => window.__mirage.timing), ktx2: await b.page.evaluate(() => window.__mirage.timing) },
    files: { webp: fs.readdirSync(path.join(root, 'examples/hello-courtyard/tex')).filter((f) => f.endsWith('.webp')).reduce((s, f) => s + fs.statSync(path.join(root, 'examples/hello-courtyard/tex', f)).size, 0), ktx2: fs.readdirSync(path.join(DIST, 'tex-ktx2')).reduce((s, f) => s + fs.statSync(path.join(DIST, 'tex-ktx2', f)).size, 0) } };
  console.log('ktx2', JSON.stringify(results.ktx2));
  if (d.meanAbs > 6) fail(`ktx2: the KTX2 still is far from the WebP one (mean ${d.meanAbs})`);
  await close(a, 'ktx2 webp'); await close(b, 'ktx2');
}
// the demo's own bundle: KTX2Loader is a chunk of its own, loaded only with ?ktx2
const assets = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
results.demoChunks = Object.fromEntries(assets.map((f) => [f, zlib.gzipSync(fs.readFileSync(path.join(DIST, 'assets', f)), { level: 9 }).length]));
srv.close();
const out = flag('out', path.join(here, 'out/streaming-check.json'));
fs.writeFileSync(out, JSON.stringify({ ...results, failures }, null, 1));
console.log(`streaming check: ${failures.length ? 'FAIL (' + failures.length + ')' : 'ok'}; ${out}`);
process.exit(failures.length ? 1 : 0);
