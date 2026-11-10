#!/usr/bin/env node
// Mirage original code. Headless check of the screen-space lighting passes (packages/core/src/screen.js) on a built example.
//
// usage: node packages/tools/src/screen-check.mjs <dist> [more dists]     (needs Chrome with a GPU: not in npm test)
// The page is opened with ?ssr=1&ssgi=1&contact=1 (the examples then ask for lighting.screen). Checked:
//   - the lit programs carry the part; with the three strengths at 0 nothing is drawn for it;
//   - each pass alone and all three draw moving frames with no page or GL error, run their own passes and change the frame;
//   - a still is the same still when drawn again after another view (the reference mode has no memory);
//   - the reference converges: 16 sub-frames are closer to a 64-sub-frame still than 4 are;
//   - a moving frame with the passes on is closer to that reference than one with them off (what they are for).
import { launch, serve, open } from './chrome.mjs';
import { readPNG } from './imgcmp.mjs';

const dists = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!dists.length) { console.error('usage: screen-check.mjs <dist> [more dists]'); process.exit(2); }
const png = (url) => readPNG(Buffer.from(url.split(',')[1], 'base64'));
const psnr = (a, b) => { let se = 0, n = 0; for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; se += d * d; n++; } return 10 * Math.log10(65025 / Math.max(se / n, 1e-9)); };

let bad = 0;
const fail = (m) => { bad++; console.error('  FAIL ' + m); };
const browser = await launch({ w: 960, h: 600 });
try {
  for (const dist of dists) {
    const srv = await serve(dist);
    try {
      const o = await open(browser, srv.url + '?mode=walk&ui=0&hud=0&w=960&h=600&grain=0&wet=0.8&ssr=1&ssgi=1&contact=1');
      const r = await o.page.evaluate(async () => {
        const M = window.__mirage, { play, world } = M, cam = world.camera, gl = world.renderer.getContext(), px = new Uint8Array(4), S = world.lighting && world.lighting.screen;
        if (!S) return { none: true };
        play.stop(); play.viewpoint(0); for (let k = 0; k < 40; k++) play.step(1 / 30);
        world.post.grain = 0;
        const shot = () => (gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px), document.querySelector('canvas').toDataURL('image/png'));
        const OFF = { ssr2: 0, ssgi: 0, contact: 0 };
        let T = 0;
        const live = (set, n = 40) => { Object.assign(world.post, OFF, set); for (let i = 0; i < n; i++) { T += 1 / 60; world.renderFrame(T, { taa: true }); } return { img: shot(), on: S.info.on, passes: S.info.passes, gl: gl.getError() }; };
        const still = (set, spp) => { Object.assign(world.post, OFF, set); world.renderFrame(T, { spp, frameIndex: 1, shutter: 0 }); return shot(); };
        const ALL = { ssr2: 1, ssgi: 1, contact: 1 };
        const out = { marked: S.info.marked, programs: world.renderer.info.programs.filter((p) => p.fragmentShader && String(world.renderer.getContext().getShaderSource(p.fragmentShader)).includes('mgScrTap(')).length };
        out.off = live({});
        out.cases = { ssr2: live({ ssr2: 1 }), ssgi: live({ ssgi: 1 }), contact: live({ contact: 1 }), all: live(ALL) };
        out.ref = still(ALL, 64); out.s4 = still(ALL, 4); out.s16 = still(ALL, 16);
        const p0 = cam.position.clone(), q0 = cam.quaternion.clone();
        const again = (set) => {
          const T0 = T, a = still(set, 8);
          cam.rotateY(1.1); cam.position.y += 0.4; cam.updateMatrixWorld(); still(set, 8); live(set, 6);
          cam.position.copy(p0); cam.quaternion.copy(q0); cam.updateMatrixWorld(); T = T0;
          return a === still(set, 8);
        };
        out.sameOff = again({}); out.same = again(ALL); out.mode = S.info.mode;
        return out;
      });
      console.log(dist);
      if (r.none) { fail('the page has no lighting.screen (does it read ?ssr= ?)'); continue; }
      if (!r.programs) fail('no lit program carries the screen part');
      if (!r.marked) fail('nothing was marked for the G-buffer');
      if (r.off.on || r.off.passes) fail('passes were drawn with every strength at 0');
      const off = png(r.off.img), ref = png(r.ref);
      for (const [name, c] of Object.entries(r.cases)) {
        if (c.gl) fail(`${name}: GL error ${c.gl}`);
        const want = name === 'all' ? 6 : 2;
        if (!c.on || c.passes !== want) fail(`${name}: ${c.passes} passes, expected ${want}`);
        const d = psnr(png(c.img), off);
        if (!(d < 60)) fail(`${name}: the frame did not change (${d.toFixed(1)} dB to the frame without it)`);
        console.log(`  ${name}: ${c.passes} passes, ${d.toFixed(2)} dB from the frame without it`);
      }
      if (!r.sameOff) console.log('  (stills of this page are not repeatable even without the passes: not compared)');
      else if (!r.same) fail('a still differs when drawn again after another view');
      if (r.mode !== 'ref') fail('stills did not use the reference mode');
      const p4 = psnr(png(r.s4), ref), p16 = psnr(png(r.s16), ref), pOn = psnr(png(r.cases.all.img), ref), pOff = psnr(off, ref);
      console.log(`  to the 64-sample reference: 4 spp ${p4.toFixed(2)} dB, 16 spp ${p16.toFixed(2)} dB; moving frame on ${pOn.toFixed(2)} dB, off ${pOff.toFixed(2)} dB`);
      if (!(p16 > p4)) fail('the reference does not converge with spp');
      if (!(pOn > pOff)) fail('a moving frame with the passes on is no closer to the reference than one without');
      const errs = [...new Set(o.errors)];
      if (errs.length) fail('page errors:\n    ' + errs.slice(0, 8).join('\n    ').slice(0, 2000));
      await o.page.close();
    } finally { srv.close(); }
  }
} finally { await browser.close(); }
console.log(bad ? `screen check: ${bad} failure(s)` : 'screen check: ok');
process.exit(bad ? 1 : 0);
