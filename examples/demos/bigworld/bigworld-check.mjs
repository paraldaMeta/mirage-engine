// Check and measurements of the big-world work (examples/demos/bigworld): every switch against the plain baseline,
// interleaved, in headless Chrome with the GPU on.
// node examples/demos/bigworld/bigworld-check.mjs [--only smoke,stills,pop,ab,parts,slow] [--runs 3] [--frames 150] [--out file.json]
//   smoke   the page opens with everything on and with ?base=1 without errors; load timings, triangle counts
//   stills  four places on the test path: the still frame with occlusion on must equal the one with it off
//           (occlusion may only remove what cannot be seen); LOD, impostors and HLOD are compared to the full-detail
//           frame and their mean difference reported
//   pop     walking and flying the path with occlusion on: every 5th frame is drawn again with nothing hidden and
//           the two are compared pixel by pixel (what the previous frame's depth wrongly hid would show here)
//   ab      ?base=1 against everything on, `runs` times, interleaved: draw calls, triangles, CPU ms of the draw and
//           ms until the GPU finished the frame, over three stretches of the path (town, leaving it, hills)
//   parts   everything on against each switch off
//   slow    base and everything on at 4x CPU throttle (CDP Emulation.setCPUThrottlingRate) and at 640 x 400
// Exit 1 if a page logs an error, a still differs under occlusion, or popping exceeds the limits below.
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const RUNS = +flag('runs', 3), FRAMES = +flag('frames', 150), ONLY = flag('only', 'smoke,stills,pop,ab,parts,slow').split(',');
const DIST = path.join(here, 'out/dist'), W = 1280, H = 720;
const failures = [], results = { runs: RUNS, frames: FRAMES, size: [W, H] };
const fail = (m) => { failures.push(m); console.log('FAIL ' + m); };
const SEGMENTS = [['town', 0, 0.04], ['leaving', 0.045, 0.12], ['hills', 0.3, 0.36]];

if (!args.includes('--nobuild')) await build({ root: here, logLevel: 'warn', configFile: false, build: { outDir: DIST, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1e5 } });
const srv = await serve(DIST);

async function open(query, { w = W, h = H, throttle = 0 } = {}) {
  const browser = await launch({ w, h });
  const page = await browser.newPage(), errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  let cdp = null;
  if (throttle) { cdp = await page.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  await page.goto(`${srv.url}?w=${w}&h=${h}&${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 600000, polling: 100 });
  return { page, errors, browser, async close() { if (errors.length) fail(`${query}: ${errors.slice(0, 3).join(' | ')}`); await browser.close(); } };
}
// the canvas as RGBA bytes (bottom row first), in the page
const grab = (page) => page.evaluate(() => {
  const gl = window.__mirage.world.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let s = ''; for (let i = 0; i < px.length; i += 8192) s += String.fromCharCode.apply(null, px.subarray(i, i + 8192));
  return btoa(s);
}).then((b) => Buffer.from(b, 'base64'));
function diff(a, b) {
  let sum = 0, over = 0, max = 0;
  for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); sum += d; if (d > 8) over++; if (d > max) max = d; }
  return { mean: +(sum / (a.length / 4)).toFixed(4), over8: over, max };
}
const shot = async (page, name) => { fs.mkdirSync(path.join(here, 'out'), { recursive: true }); await page.screenshot({ path: path.join(here, 'out', name + '.png') }); };
const stat = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return { mean: +m.toFixed(2), min: +Math.min(...xs).toFixed(2), max: +Math.max(...xs).toFixed(2) }; };

async function measure(query, o) {
  const p = await open(query, o), out = {};
  for (const [name, a, b] of SEGMENTS) { await p.page.evaluate((a) => window.__mirage.still(a, 1), a); out[name] = await p.page.evaluate((f, a, b) => window.__mirage.run(f, a, b), FRAMES, a, b); }
  out.timing = await p.page.evaluate(() => window.__mirage.timing);
  await p.close();
  return out;
}
// variants interleaved, `runs` times each: per stretch and metric the mean of the runs' means, and their spread
async function compare(variants, o) {
  const acc = {};
  for (let r = 0; r < RUNS; r++) for (const [name, query] of variants) {
    const m = await measure(query, o);
    for (const [seg] of SEGMENTS) for (const k of ['calls', 'triangles', 'cpuMs', 'frameMs']) ((acc[name] ??= {})[seg + '.' + k] ??= []).push(m[seg][k].mean);
    for (const [seg] of SEGMENTS) ((acc[name])[seg + '.frameP95'] ??= []).push(m[seg].frameMs.p95);
    console.log(`  run ${r + 1} ${name}: ` + SEGMENTS.map(([seg]) => `${seg} ${m[seg].calls.mean} calls ${(m[seg].triangles.mean / 1e6).toFixed(2)} M tris cpu ${m[seg].cpuMs.mean} ms frame ${m[seg].frameMs.mean} ms`).join(' | '));
  }
  const out = {};
  for (const n in acc) { out[n] = {}; for (const k in acc[n]) out[n][k] = stat(acc[n][k]); }
  return out;
}

if (ONLY.includes('smoke')) {
  results.smoke = {};
  for (const [name, q] of [['all', ''], ['base', 'base=1']]) {
    const p = await open(q);
    const s = await p.page.evaluate(async () => ({ still: await window.__mirage.still(0.02), timing: window.__mirage.timing }));
    await shot(p.page, 'smoke-' + name);
    await p.page.evaluate(() => window.__mirage.still(0.09)); await shot(p.page, 'smoke-' + name + '-leaving');
    await p.page.evaluate(() => window.__mirage.still(0.33)); await shot(p.page, 'smoke-' + name + '-hills');
    results.smoke[name] = s; console.log('smoke ' + name + ': ' + JSON.stringify(s));
    await p.close();
  }
}

if (ONLY.includes('stills')) {
  results.stills = [];
  const places = [0.012, 0.03, 0.07, 0.33];
  const take = async (q) => { const p = await open(q), out = []; for (const u of places) { const s = await p.page.evaluate((u) => window.__mirage.still(u), u); out.push({ px: await grab(p.page), s }); } await p.close(); return out; };
  // the reference: everything loaded at full detail except what each row switches on
  const variants = { full: 'base=1&part=1&hlod=1&inst=1&load=700', occ: 'base=1&part=1&hlod=1&inst=1&load=700&occ=1', lod: 'base=1&part=1&hlod=1&inst=1&load=700&lod=1', imp: 'base=1&part=1&hlod=1&inst=1&load=700&imp=1', chunk: 'base=1&part=1&hlod=1&inst=1&load=700&chunk=1', full2: 'base=1&part=1&hlod=1&inst=1&load=700' };
  const got = {};
  for (const k in variants) got[k] = await take(variants[k]);
  places.forEach((u, i) => {
    const row = { u };
    for (const k of ['full2', 'occ', 'chunk', 'lod', 'imp']) row[k] = diff(got.full[i].px, got[k][i].px);
    row.hidden = got.occ[i].s.occ.hidden; row.hiddenTriangles = got.occ[i].s.occ.hiddenTriangles;
    results.stills.push(row); console.log('still ' + JSON.stringify(row));
    // the same page twice gives the noise floor (full2); occlusion and chunking must stay inside it
    for (const k of ['occ', 'chunk']) if (row[k].over8 > row.full2.over8 + 2) fail(`still at ${u}: ${k} changes ${row[k].over8} pixels (noise floor ${row.full2.over8})`);
  });
}

if (ONLY.includes('pop')) {
  results.pop = [];
  const p = await open('');
  for (const [name, a, b, speed] of [['walk the town 6 m/s', 0, 0.04, 6], ['run the town 12 m/s', 0, 0.04, 12], ['fly out 40 m/s', 0.045, 0.12, 40], ['fly the hills 60 m/s', 0.3, 0.36, 60]]) {
    await p.page.evaluate((a) => window.__mirage.still(a, 1), a);
    const r = await p.page.evaluate((a, b, speed) => window.__mirage.pop(a, b, speed, 5), a, b, speed);
    results.pop.push({ name, ...r }); console.log('pop ' + name + ': ' + JSON.stringify(r));
    if (r.worstFraction > 0.002) fail(`popping on "${name}": ${(r.worstFraction * 100).toFixed(3)} % of a frame's pixels differ`);
  }
  await p.close();
}

if (ONLY.includes('ab')) { console.log('ab: base against everything on'); results.ab = await compare([['base', 'base=1'], ['all', '']]); console.log(JSON.stringify(results.ab)); }
if (ONLY.includes('parts')) {
  console.log('parts: everything on against one switch off');
  results.parts = await compare([['all', ''], ['chunk=0', 'chunk=0'], ['lod=0', 'lod=0'], ['inst=0', 'inst=0'], ['imp=0', 'imp=0'], ['occ=0', 'occ=0'], ['hlod=0', 'hlod=0'], ['part=0', 'part=0']]);
  console.log(JSON.stringify(results.parts));
}
if (ONLY.includes('slow')) {
  console.log('slow: 4x CPU throttle'); results.throttle4 = await compare([['base', 'base=1'], ['all', '']], { throttle: 4 }); console.log(JSON.stringify(results.throttle4));
  console.log('slow: 640 x 400'); results.small = await compare([['base', 'base=1'], ['all', '']], { w: 640, h: 400 }); console.log(JSON.stringify(results.small));
  console.log('slow: 640 x 400 and 4x CPU throttle'); results.smallThrottle4 = await compare([['base', 'base=1'], ['all', '']], { w: 640, h: 400, throttle: 4 }); console.log(JSON.stringify(results.smallThrottle4));
}

await srv.close();
const out = flag('out', null);
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nbigworld check: ok');
process.exit(failures.length ? 1 : 0);
