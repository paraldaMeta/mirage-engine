#!/usr/bin/env node
// Mirage original code. A phone that is not there (docs/platforms.md): the example's dist in the real Chrome with
// a phone's screen (844 x 390 CSS px at 3x, touch, an Android user agent), a slowed CPU (CDP CPU throttling) and a
// WebGL2 context made to look like a phone's: smaller limits, no 32-bit float render targets, no float filtering,
// no desktop texture compression, a phone GPU's name. NO REAL PHONE IS USED: the GPU underneath is this machine's,
// so the numbers say how the CPU side scales and whether the reduced context breaks something, not what a phone's
// GPU does with the fill.
//   node packages/tools/src/mobile-check.mjs examples/hello-courtyard/dist examples/garden-quest/dist [--json file]
// 1 breaks: opened with ?platform=1 (the probe picks the quality) under two contexts, "phone" (as above) and
//   "no-float" (the same without half-float targets either): the page must start, draw something that is not
//   black, raise no GL error, log no console error, and ask for nothing above the limits it was told.
// 2 frame time: ?platform=1&quality=low under the "phone" context, CPU throttle 1x / 4x / 6x interleaved three
//   times, 60 moving frames each, timed through a readPixels so the GPU's work is inside the number.
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const targets = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!targets.length) { console.error('usage: mobile-check.mjs <dist dir>... [--json file] [--frames n] [--rounds n]'); process.exit(2); }
const W = 844, H = 390, DPR = 3, FRAMES = +flag('frames', 60), ROUNDS = +flag('rounds', 3), RATES = [1, 4, 6];
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP_ONLY = ['EXT_color_buffer_float', 'OES_texture_float_linear', 'EXT_float_blend', 'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb', 'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc'];
export const PROFILES = {
  phone: { maxTex: 4096, maxSamples: 4, renderer: 'Mali-G52', hide: DESKTOP_ONLY },
  'no-float': { maxTex: 4096, maxSamples: 4, renderer: 'Mali-G52', hide: [...DESKTOP_ONLY, 'EXT_color_buffer_half_float'] },
};

// runs in the page before anything else: the context answers like the profile and notes what goes over its limits
function reduceGL(p) {
  const P = WebGL2RenderingContext.prototype, hide = new Set(p.hide), seen = window.__gl = { big: [], hidden: [] };
  const ge = P.getExtension, gs = P.getSupportedExtensions, gp = P.getParameter;
  P.getExtension = function (n) { if (hide.has(n)) { if (!seen.hidden.includes(n)) seen.hidden.push(n); return null; } return ge.call(this, n); };
  P.getSupportedExtensions = function () { return (gs.call(this) || []).filter((n) => !hide.has(n)); };
  P.getParameter = function (k) {
    const v = gp.call(this, k);
    if (k === 0x0D33 || k === 0x84E8 || k === 0x851C) return Math.min(v, p.maxTex);   // MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE, MAX_CUBE_MAP_TEXTURE_SIZE
    if (k === 0x8D57) return Math.min(v, p.maxSamples);                               // MAX_SAMPLES
    if (k === 0x9246) return p.renderer;                                              // UNMASKED_RENDERER_WEBGL
    return v;
  };
  const size = { texStorage2D: [3, 4], texStorage3D: [3, 4], texImage3D: [3, 4], renderbufferStorage: [2, 3], renderbufferStorageMultisample: [3, 4] };
  const note = (fn, w, h) => { if ((w > p.maxTex || h > p.maxTex) && seen.big.length < 20) seen.big.push(`${fn} ${w}x${h}`); };
  for (const [fn, [a, b]] of Object.entries(size)) { const f = P[fn]; P[fn] = function (...x) { note(fn, x[a], x[b]); return f.apply(this, x); }; }
  const ti = P.texImage2D;
  P.texImage2D = function (...x) { if (x.length >= 9) note('texImage2D', x[3], x[4]); else if (x[5]) note('texImage2D', x[5].videoWidth || x[5].naturalWidth || x[5].width || 0, x[5].videoHeight || x[5].naturalHeight || x[5].height || 0); return ti.apply(this, x); };
}

async function openPhone(browser, url, profile) {
  const page = await browser.newPage(), errors = [], warnings = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push(t); else if (m.type() === 'warn' || m.type() === 'warning') warnings.push(t); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.setUserAgent(UA, { brands: [], fullVersion: '130.0.0.0', platform: 'Android', platformVersion: '14', architecture: '', model: 'Pixel 8', mobile: true });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, isLandscape: true });
  await page.evaluateOnNewDocument(reduceGL, PROFILES[profile]);
  const cdp = await page.createCDPSession();
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  return { page, errors, warnings, cdp };
}
const look = (page) => page.evaluate(() => {
  const { play, world } = window.__mirage, gl = world.renderer.getContext(), GLE = { 0x0500: 'INVALID_ENUM', 0x0501: 'INVALID_VALUE', 0x0502: 'INVALID_OPERATION', 0x0505: 'OUT_OF_MEMORY', 0x0506: 'INVALID_FRAMEBUFFER_OPERATION' };
  while (gl.getError()) { /* what the start left behind is reported by the console; here: what a frame raises */ }
  play.render({ moving: true }); play.render({ moving: false, spp: 4, frameIndex: 1 });
  const glErrors = []; for (let e; (e = gl.getError()) && glErrors.length < 8;) glErrors.push(GLE[e] || e);
  const c = document.querySelector('canvas'), d = document.createElement('canvas'); d.width = 64; d.height = 32;
  const g = d.getContext('2d'); g.drawImage(c, 0, 0, 64, 32);
  const px = g.getImageData(0, 0, 64, 32).data; let s = 0, lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) { const l = (px[i] + px[i + 1] + px[i + 2]) / 3; s += l; lo = Math.min(lo, l); hi = Math.max(hi, l); }
  const caps = window.__platform?.caps;
  return { glErrors, mean: s / (px.length / 4), range: hi - lo, buffer: [c.width, c.height], css: [innerWidth, innerHeight], dpr: devicePixelRatio, touch: navigator.maxTouchPoints, big: window.__gl.big, hidden: window.__gl.hidden,
    caps: caps && { mobile: caps.mobile, os: caps.os, gpu: caps.gpu, tier: caps.tier, quality: caps.quality, why: caps.why, maxTextureSize: caps.maxTextureSize, floatTargets: caps.floatTargets, halfFloatTargets: caps.halfFloatTargets } };
});
const time = (page, n) => page.evaluate((N) => {
  const { play } = window.__mirage, gl = play.world.renderer.getContext(), px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const was = play.running; play.stop();
  for (let i = 0; i < 5; i++) { play.step(1 / 60); play.render({ moving: true }); } sync();
  const ms = [];
  for (let i = 0; i < N; i++) { const t = performance.now(); play.step(1 / 60); play.render({ moving: true }); sync(); ms.push(performance.now() - t); }
  if (was) play.start();
  ms.sort((a, b) => a - b);
  return { median: ms[N >> 1], p95: ms[Math.floor(N * 0.95)] };
}, n);
const r2 = (v) => +v.toFixed(2), med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

let failed = 0; const report = { note: 'Chrome mobile emulation on this machine; no real phone', viewport: `${W}x${H}@${DPR}x`, examples: {} };
const browser = await launch({ w: W, h: H });
try {
  for (const dir of targets) {
    const name = path.basename(path.resolve(dir, '..')), srv = await serve(dir), problems = [], out = report.examples[name] = { breaks: {}, frame: {} };
    try {
      for (const profile of Object.keys(PROFILES)) {
        try {
          const { page, errors } = await openPhone(browser, `${srv.url}?platform=1&hud=0`, profile);
          const r = await look(page);
          out.breaks[profile] = { quality: r.caps?.quality, tier: r.caps?.tier, why: r.caps?.why, buffer: r.buffer, mean: r2(r.mean), glErrors: r.glErrors, overLimit: r.big, errors: errors.slice(0, 4) };
          if (!r.caps?.mobile) problems.push(`${profile}: the probe did not see a phone (${JSON.stringify(r.caps)})`);
          if (r.touch < 1) problems.push(`${profile}: no touch points`);
          if (r.mean < 6 || r.range < 12) problems.push(`${profile}: the canvas is black or flat (mean ${r.mean.toFixed(1)}, range ${r.range.toFixed(0)})`);
          if (r.glErrors.length) problems.push(`${profile}: a frame raised ${[...new Set(r.glErrors)].join(', ')}`);
          if (r.big.length) problems.push(`${profile}: asked for more than ${PROFILES[profile].maxTex} px: ${r.big.slice(0, 4).join(', ')}`);
          if (errors.length) problems.push(`${profile}: console ${errors.slice(0, 3).join(' | ')}`);
          console.log(`  ${name} [${profile}] probe: tier ${r.caps?.tier}, quality ${r.caps?.quality} (${r.caps?.why}), buffer ${r.buffer.join('x')}, canvas mean ${r.mean.toFixed(0)}/255`);
          await page.close();
        } catch (e) { problems.push(`${profile}: ${e.message.split('\n')[0]}`); }
      }
      // ---- frame time at low, the CPU slowed
      const { page, errors, cdp } = await openPhone(browser, `${srv.url}?platform=1&quality=low&hud=0`, 'phone');
      const runs = Object.fromEntries(RATES.map((r) => [r, []]));
      for (let round = 0; round < ROUNDS; round++) for (const rate of RATES) {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        runs[rate].push(await time(page, FRAMES));
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const buf = await page.evaluate(() => { const c = document.querySelector('canvas'); return [c.width, c.height]; });
      for (const rate of RATES) {
        const m = runs[rate].map((x) => x.median), p = runs[rate].map((x) => x.p95);
        out.frame[`${rate}x`] = { medianMs: r2(med(m)), min: r2(Math.min(...m)), max: r2(Math.max(...m)), p95Ms: r2(med(p)), rounds: ROUNDS, frames: FRAMES };
      }
      out.frame.buffer = buf;
      if (errors.length) problems.push(`low: console ${errors.slice(0, 3).join(' | ')}`);
      console.log(`  ${name} low, buffer ${buf.join('x')}: ` + RATES.map((r) => { const f = out.frame[`${r}x`]; return `${r}x CPU ${f.medianMs} ms (${f.min}-${f.max}, p95 ${f.p95Ms})`; }).join('; '));
      await page.close();
    } finally { srv.close(); }
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}`);
    for (const p of problems) console.log('     ' + p);
    out.problems = problems;
    if (problems.length) failed++;
  }
} finally { await browser.close(); }
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify(report, null, 1));
process.exit(failed ? 1 : 0);
