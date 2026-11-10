// Mirage original code. Browser check of the opt-in looks: the metal PROCs, shell fur (one draw per patch, moss on a
// mesh), reduced motion (less sway, no shutter) and the transparent still (alpha from black / white renders).
// Serves the repository root (check/looks.html, no build) in headless Chrome with the GPU:
//   node packages/tools/looks.check.mjs [--out out/looks]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from './src/chrome.mjs';
import { decodePNG, encodePNG } from './src/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const only = process.argv.includes('--scene') ? process.argv[process.argv.indexOf('--scene') + 1] : null;
const i = process.argv.indexOf('--out'), OUT = path.resolve(i > 0 ? process.argv[i + 1] : 'out/looks');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) fails++; };
const W = 960, H = 540;
const srv = await serve(ROOT), browser = await launch({ w: W, h: H });
const page = async (scene, q = '') => {
  const r = await open(browser, `${srv.url}packages/tools/check/looks.html?scene=${scene}&w=${W}&h=${H}${q}`);
  return r;
};
// a still of the canvas (spp sub-frames at time T), decoded
async function still(p, { T = 0, spp = 16 } = {}) {
  const url = await p.evaluate((T, spp) => { const { world } = window.__mirage; world.renderFrame(T, { spp, frameIndex: 1 }); return world.renderer.domElement.toDataURL('image/png'); }, T, spp);
  return { png: Buffer.from(url.split(',')[1], 'base64'), ...decodePNG(Buffer.from(url.split(',')[1], 'base64')) };
}
const save = (name, png) => fs.writeFileSync(path.join(OUT, name), png);
// mean and spread of the luma in a box (fractions of the frame)
function region(im, [x0, y0, x1, y1]) {
  let s = 0, s2 = 0, n = 0;
  const r = [0, 0, 0];
  for (let y = Math.floor(y0 * im.height); y < y1 * im.height; y++) for (let x = Math.floor(x0 * im.width); x < x1 * im.width; x++) {
    const k = (y * im.width + x) * 4, l = 0.2126 * im.data[k] + 0.7152 * im.data[k + 1] + 0.0722 * im.data[k + 2];
    s += l; s2 += l * l; n++; r[0] += im.data[k]; r[1] += im.data[k + 1]; r[2] += im.data[k + 2];
  }
  return { mean: s / n, sd: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), rgb: r.map((v) => v / n) };
}
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const diff = (a, b) => { let d = 0; for (let k = 0; k < a.data.length; k += 4) d += Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]); return d / (a.width * a.height * 3); };

try {
  // ---- metals: four spheres (plain, brushed, hammered, patina) and a panel of each behind
  if (!only || only === 'metals') {
    const { page: p, errors } = await page('metals');
    const im = await still(p);
    save('metals.png', im.png);
    const cols = [0.11, 0.365, 0.63, 0.895].map((cx) => region(im, [cx - 0.04, 0.47, cx + 0.04, 0.6]));
    console.log('metals', cols.map((c) => `${c.mean.toFixed(1)}±${c.sd.toFixed(1)} rgb(${c.rgb.map((v) => v.toFixed(0))})`).join('  '));
    ok(errors.length === 0, 'metals: no console errors ' + errors.join(' | '));
    ok(cols.every((c) => c.mean > 8 && c.mean < 250), 'metals: every sphere lit, none clipped');
    const green = (x0, x1) => { let g = 0, n = 0; for (let y = Math.round(0.4 * im.height); y < 0.66 * im.height; y++) for (let x = Math.round(x0 * im.width); x < x1 * im.width; x++) { const k = (y * im.width + x) * 4; n++; if (im.data[k + 1] > im.data[k] + 6 && im.data[k + 1] >= im.data[k + 2]) g++; } return g / n; };
    const gp = green(0.84, 0.95), g0 = green(0.05, 0.16);
    console.log(`patina: ${(gp * 100).toFixed(0)} % of the sphere green (plain: ${(g0 * 100).toFixed(0)} %)`);
    ok(gp > 0.08 && gp < 0.85 && g0 < 0.03, 'patina (amount 0.5): part of the copper turned green');
    ok(cols[2].rgb[0] > cols[2].rgb[2] * 1.15, 'hammered copper stays warm');
    ok(cols[1].sd > 1 && cols[2].sd > 1, 'brushed and hammered carry a pattern');
    await p.close();
  }
  // ---- transparent still: background alpha 0, the object opaque, partial alpha only at its edges
  if (!only || only === 'alpha') {
    const { page: p, errors } = await page('alpha');
    const r = await p.evaluate(() => {
      const { world } = window.__mirage;
      const t = performance.now(), im = world.renderTransparent(0, { spp: 16, frameIndex: 1 }), ms = performance.now() - t;
      let bin = ''; for (let i = 0; i < im.data.length; i += 0x8000) bin += String.fromCharCode.apply(null, im.data.subarray(i, i + 0x8000));
      // the reference: the normal still with the sky hidden (over black), which the opaque pixels should match
      world.sky.visible = world.stars.visible = false;
      world.renderFrame(0, { spp: 16, frameIndex: 1 });
      world.sky.visible = world.stars.visible = true;
      return { rgba: btoa(bin), w: im.width, h: im.height, ms, opaque: world.renderer.domElement.toDataURL('image/png') };
    });
    const a = { width: r.w, height: r.h, data: new Uint8Array(Buffer.from(r.rgba, 'base64')) }, o = decodePNG(Buffer.from(r.opaque.split(',')[1], 'base64'));
    save('alpha.png', encodePNG(a.width, a.height, a.data)); save('alpha-opaque.png', Buffer.from(r.opaque.split(',')[1], 'base64'));
    let zero = 0, full = 0, part = 0, isolated = 0, dc = 0, nc = 0, de = 0;
    const A = (x, y) => a.data[(Math.min(a.height - 1, Math.max(0, y)) * a.width + Math.min(a.width - 1, Math.max(0, x))) * 4 + 3];
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const v = A(x, y);
      if (v === 0) zero++; else if (v === 255) full++;
      else {
        part++;
        // an edge pixel: within 2 px of both a background and an object pixel
        let lo = false, hi = false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const q = A(x + dx, y + dy); lo ||= q < 128; hi ||= q >= 128; }
        if (!(lo && hi)) isolated++;
        // composited over black in linear light, an edge pixel is close to the still over black (not exact: the
        // tone map is not linear, so grade(alpha x colour) != alpha x grade(colour))
        const k = (y * a.width + x) * 4;
        for (let ch = 0; ch < 3; ch++) de += Math.abs(lin(a.data[k + ch]) * (v / 255) - lin(o.data[k + ch])) / 3;
      }
      if (v === 255) { const k = (y * a.width + x) * 4; dc += Math.abs(a.data[k] - o.data[k]) + Math.abs(a.data[k + 1] - o.data[k + 1]) + Math.abs(a.data[k + 2] - o.data[k + 2]); nc += 3; }
    }
    const corners = [[0, 0], [a.width - 1, 0], [0, a.height - 1], [a.width - 1, a.height - 1]].map(([x, y]) => A(x, y));
    console.log(`alpha: ${zero} transparent, ${full} opaque, ${part} partial (${isolated} away from an edge); opaque pixels differ from the still over black by ${(dc / nc).toFixed(2)}/255, edges (over black, linear) by ${((de / part) * 100).toFixed(2)} %; ${r.ms.toFixed(0)} ms`);
    ok(errors.length === 0, 'alpha: no console errors ' + errors.join(' | '));
    ok(corners.every((v) => v === 0) && zero > a.width * a.height * 0.6, 'alpha: the background is fully transparent');
    ok(full > a.width * a.height * 0.05 && A(a.width >> 1, Math.round(a.height * 0.47)) === 255, 'alpha: the object is opaque');
    ok(part > 200 && isolated / part < 0.02, 'alpha: partial alpha only along the edges (anti-aliased)');
    ok(dc / nc < 2, 'alpha: opaque pixels keep their colour (vs the still over black)');
    ok(de / part < 0.02, 'alpha: edge pixels composite back to the still over black (linear light, within 2 %)');
    await p.close();
  }
  // ---- fur: one draw per patch, wind, reduced motion; moss on a mesh
  if (!only || only === 'fur') {
    const { page: p, errors } = await page('fur', '&fins=1');
    const info = await p.evaluate(() => {
      const { world, out } = window.__mirage, r = world.renderer;
      const calls = (on) => { out.fur.shells.visible = out.fur.fins.visible = on; r.info.autoReset = false; r.info.reset(); world.renderFrame(0, { spp: 1, frameIndex: 1 }); const c = r.info.render.calls, t = r.info.render.triangles; r.info.autoReset = true; return [c, t]; };
      const [on, tOn] = calls(true), [off, tOff] = calls(false);
      out.fur.shells.visible = out.fur.fins.visible = true;
      return { calls: on - off, tris: tOn - tOff, shells: out.fur.shells.geometry.instanceCount, finTris: out.fur.fins.geometry.index.count / 3 };
    });
    console.log('fur', JSON.stringify(info));
    ok(info.calls === 2 && info.tris === 2 * info.shells + info.finTris, 'fur: shells in one draw call, fins in one more');
    const a = await still(p, { T: 0 }), b = await still(p, { T: 1.7 });
    save('fur.png', a.png);
    await p.evaluate(() => window.__mirage.world.setReducedMotion(true));
    const ra = await still(p, { T: 0 }), rb = await still(p, { T: 1.7 });
    save('fur-reduced.png', ra.png);
    const full = diff(a, b), calm = diff(ra, rb);
    console.log(`fur: wind change between T 0 and 1.7: ${full.toFixed(3)} (full motion) vs ${calm.toFixed(3)} (reduced) /255 per channel`);
    ok(full > 0.05 && calm < full * 0.6, 'reduced motion: the sway moves less');
    const back = await p.evaluate(() => { const w = window.__mirage.world; w.setReducedMotion(false); return w.reducedMotion; });
    const again = await still(p, { T: 0 });
    ok(back === null && diff(again, a) === 0, 'reduced motion off: the same image as before');
    ok(errors.length === 0, 'fur: no console errors ' + errors.join(' | '));
    await p.close();
    // play follows prefers-reduced-motion ('auto'), live; an explicit option wins
    const state = (pg) => pg.evaluate(() => ({ play: window.__mirage.out.play.reducedMotion, world: window.__mirage.world.reducedMotion }));
    const plain = await page('play');
    ok((await state(plain.page)).world === null && (await state(plain.page)).play === false, "play 'auto' without the system setting: off");
    await plain.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await new Promise((r) => setTimeout(r, 200));
    const live = await state(plain.page);
    ok(live.play === true && live.world && live.world.sway === 0.25, "play 'auto': follows the setting when it changes");
    await plain.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await new Promise((r) => setTimeout(r, 200));
    ok((await state(plain.page)).world === null, "play 'auto': and back");
    await plain.page.evaluate(() => { window.__mirage.out.play.reducedMotion = true; });
    ok((await state(plain.page)).play === true, 'play.reducedMotion = true overrides');
    await plain.page.evaluate(() => window.__mirage.out.play.dispose());
    ok((await state(plain.page)).world === null, 'dispose() gives the world back as it was');
    ok(plain.errors.length === 0, 'play: no console errors ' + plain.errors.join(' | '));
    await plain.page.close();
    const m = await page('moss');
    const im = await still(m.page);
    save('moss.png', im.png);
    ok(m.errors.length === 0 && region(im, [0.4, 0.4, 0.6, 0.6]).mean > 5, 'moss on a mesh renders ' + m.errors.join(' | '));
    await m.page.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(fails ? `looks: ${fails} failed (images in ${OUT})` : `looks: all passed (images in ${OUT})`);
process.exit(fails ? 1 : 0);
