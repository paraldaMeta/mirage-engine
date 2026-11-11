#!/usr/bin/env node
// Mirage original code. Headless check of the opt-in post chain (packages/core/src/postfx.js) on a built example.
//
// usage: node packages/tools/src/postfx-check.mjs <dist> [more dists]     (needs Chrome with a GPU: not in npm test)
// One page per dist. With every option off the pipeline must not have created its effects object at all (the
// existing path is the old code). Then each option alone, and all together, draws moving frames: no page or GL
// error, a frame that is not flat, and the option's own passes ran. The reprojecting TAA must be at least as
// close to a 16-sample still as the old blend while the camera pans (the reason it exists). Last, the lens effects
// (lensDirt, streak) on a still: each changes the frame, and set back to 0 the still is bit-identical to before.
import { launch, serve, open } from './chrome.mjs';
import { readPNG } from './imgcmp.mjs';

const CASES = [['taa2', { taa2: 1 }], ['upscale', { taa2: 1, upscale: 0.67 }], ['motionBlur', { motionBlur: 0.5 }], ['bokeh', { bokeh: 1, dof: 0.03, focus: 6 }],
  ['bloomPyramid', { bloom: 0.15, bloomPyramid: 1 }], ['chroma', { chroma: 0.6 }], ['lut', { lut: 'warm' }],
  ['lensDirt', { lensDirt: 1, lensDirtThreshold: 0.3 }], ['streak', { streak: 1, streakThreshold: 0.5 }],
  ['all', { taa2: 1, upscale: 0.67, motionBlur: 0.5, bokeh: 1, dof: 0.03, focus: 6, bloom: 0.15, bloomPyramid: 1, chroma: 0.6, lut: 'warm', lensDirt: 0.6, streak: 0.6 }]];
// the lens effects on a still: each changes the frame (thresholds low enough that any view has light above them), and
// the frame with them back at 0 is bit-identical to the one before them
const LENS = [['lensDirt', { lensDirt: 1, lensDirtThreshold: 0.3 }], ['streak', { streak: 1, streakThreshold: 0.5 }]];
const dists = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!dists.length) { console.error('usage: postfx-check.mjs <dist> [more dists]'); process.exit(2); }
const png = (url) => readPNG(Buffer.from(url.split(',')[1], 'base64'));
const psnr = (a, b) => { let se = 0, n = 0; for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; se += d * d; n++; } return 10 * Math.log10(65025 / Math.max(se / n, 1e-9)); };
const spread = (I) => { let lo = 255, hi = 0; for (let i = 1; i < I.data.length; i += 4 * 97) { lo = Math.min(lo, I.data[i]); hi = Math.max(hi, I.data[i]); } return hi - lo; };

let bad = 0;
const fail = (m) => { bad++; console.error('  FAIL ' + m); };
const browser = await launch({ w: 960, h: 540 });
try {
  for (const dist of dists) {
    const srv = await serve(dist);
    try {
      // the second page starts with ?lut=warm: the page's own postFromQuery builds the texture the lut cases use
      const errors = [], r = { cases: {} };
      for (const pass of [0, 1]) {
      const o = await open(browser, srv.url + '?mode=walk&ui=0&w=960&h=540&grain=0' + (pass ? '&lut=warm' : ''));
      errors.push(...o.errors);
      const part = await o.page.evaluate(async (cases, pass, lens) => {
        const M = window.__mirage, { play, world } = M, cam = world.camera, gl = world.renderer.getContext(), px = new Uint8Array(4);
        play.stop(); play.viewpoint(0); for (let k = 0; k < 40; k++) play.step(1 / 30);
        world.post.grain = 0;
        const LUT = world.post.lut; world.post.lut = null;
        const p0 = cam.position.clone(), q0 = cam.quaternion.clone(), base = { ...world.post };
        let T = 0, n = 0;
        const run = (frames) => { for (let i = 0; i < frames; i++) { n++; T += 1 / 60; cam.position.copy(p0); cam.quaternion.copy(q0); cam.rotateY(Math.sin(n * 0.12) * 0.06); cam.updateMatrixWorld(); world.renderFrame(T, { taa: true }); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return document.querySelector('canvas').toDataURL('image/png'); };
        const out = { cases: {} };
        if (!pass) {
          n = 0; out.legacy = run(24); out.lazy = !world.pipeline.fx;
          out.ref = (world.renderFrame(T, { spp: 16, frameIndex: 1, shutter: 0 }), gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px), document.querySelector('canvas').toDataURL('image/png'));
        }
        for (const [name, on] of cases) {
          if (!!on.lut !== !!pass) continue;
          Object.assign(world.post, base, on, { lut: on.lut ? LUT : null });
          if (on.lut && !LUT) { out.cases[name] = { skip: 'the page does not read ?lut= (postFromQuery)' }; continue; }
          n = 0; const img = run(24);   // the same 24 camera poses as the legacy run: the last frame is comparable
          out.cases[name] = { img, gl: gl.getError(), fx: !!world.pipeline.fx };
        }
        if (!pass) {
          const still = (cfg) => { Object.assign(world.post, base, { lut: null }, cfg); cam.position.copy(p0); cam.quaternion.copy(q0); cam.updateMatrixWorld(); world.renderFrame(T, { spp: 4, frameIndex: 1, shutter: 0 }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return document.querySelector('canvas').toDataURL('image/png'); };
          out.lens = { off: still({}) };
          for (const [name, on] of lens) { out.lens[name] = still(on); out.lens[name + 'Gl'] = gl.getError(); out.lens[name + 'Off'] = still({}); }
        }
        Object.assign(world.post, base);
        return out;
      }, CASES, pass, LENS);
      Object.assign(r.cases, part.cases); if (!pass) Object.assign(r, { legacy: part.legacy, ref: part.ref, lazy: part.lazy, lens: part.lens });
      await o.page.close();
      }
      console.log(dist);
      if (!r.lazy) fail('the effects object exists although every option is off');
      const ref = png(r.ref), legacy = psnr(png(r.legacy), ref);
      for (const [name] of CASES) {
        const c = r.cases[name];
        if (c.skip) { console.log(`  ${name}: skipped (${c.skip})`); continue; }
        const I = png(c.img), p = psnr(I, ref);
        if (c.gl) fail(`${name}: GL error ${c.gl}`);
        if (!c.fx) fail(`${name}: the effects object was not created`);
        if (spread(I) < 24) fail(`${name}: the frame is flat`);
        console.log(`  ${name}: ${p.toFixed(2)} dB to the 16-sample still`);
        if (name === 'taa2' && p < legacy - 0.25) fail(`taa2 is further from the still (${p.toFixed(2)} dB) than the old TAA (${legacy.toFixed(2)} dB) under a pan`);
      }
      console.log(`  old TAA: ${legacy.toFixed(2)} dB`);
      // the lens effects on a still: on changes pixels, back off is bit-identical to before
      const L = r.lens, off = png(L.off);
      for (const [name] of LENS) {
        const on = png(L[name]), back = png(L[name + 'Off']);
        let changed = 0, same = true;
        for (let i = 0; i < off.data.length; i += 4) {
          if (off.data[i] !== on.data[i] || off.data[i + 1] !== on.data[i + 1] || off.data[i + 2] !== on.data[i + 2]) changed++;
          if (off.data[i] !== back.data[i] || off.data[i + 1] !== back.data[i + 1] || off.data[i + 2] !== back.data[i + 2]) same = false;
        }
        const pc = (100 * changed) / (off.data.length / 4);
        console.log(`  ${name} (still): ${pc.toFixed(1)} % of the pixels change; off again ${same ? 'bit-identical' : 'DIFFERS'}`);
        if (L[name + 'Gl']) fail(`${name}: GL error ${L[name + 'Gl']} on a still`);
        if (pc < 0.5) fail(`${name}: the still hardly changes (${pc.toFixed(2)} % of the pixels)`);
        if (!same) fail(`${name}: the still with it back at 0 is not bit-identical to the one before`);
      }
      const errs = [...new Set(errors)];
      if (errs.length) fail('page errors:\n    ' + errs.slice(0, 8).join('\n    ').slice(0, 2000));
    } finally { srv.close(); }
  }
} finally { await browser.close(); }
console.log(bad ? `postfx check: ${bad} failure(s)` : 'postfx check: ok');
process.exit(bad ? 1 : 0);
