#!/usr/bin/env node
// Mirage original code. Headless check of the wet layer's rain rings, specular AA and wear / shelter
// (packages/core/src/wet.js) on a built hello-courtyard.
//
// usage: node packages/tools/src/wet-check.mjs <hello-courtyard dist> [--before=<the same dist built before>] [--out=dir]
//          [--cost=N]   (needs Chrome with a GPU: not in npm test; the pure parts are packages/core/wet.check.mjs)
// Pages: ?wet=0.9&rain=1 (and &wear=1). Checked:
//   - ripples off (every wet material's `ripples` 0, through its mgWetQ uniform) draws the same bytes as rain 0;
//   - ripples on changes only puddle pixels (pixels the puddles themselves change, grown by 3 px), and more rings
//     (dark/bright blobs of the difference) the heavier the rain;
//   - a still with rain is the same bytes when drawn again after other frames (time is the still's T);
//   - specular AA: on a grazing wet floor, moving frames with TAA flicker less with it than without (temporal second
//     difference of the luma), and a single-sample still holds less high-frequency energy (Laplacian);
//   - &wear=1: the paving under the pergola (shelter) changes less between dry and wet than the open paving beside it;
//   - more wet materials with other numbers (porosity, ripples, specAA, rim, a numeric shelter) add no program;
//   - --before: no flag, ?wet=0, ?wet=0.9 and ?wet=0.9&planar=1 draw byte-identical stills to the build from before
//     (without rain the defaults did not change); with rain the differing pixels are counted; --cost=N: N interleaved rounds of 60 walking frames (wet 0.9 + rain 1), before / after.
// --out: close / grazing / low stills of both builds (rain, planar; with &wear=1) as PNG.
// WET_KS='[0,1,2,4]' (env): also prints the AA measures for those specAA strengths.
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, open } from './chrome.mjs';

const args = process.argv.slice(2), dist = args.find((a) => !a.startsWith('--'));
const opt = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
if (!dist) { console.error('usage: wet-check.mjs <hello-courtyard dist> [--before=<dist>] [--out=dir] [--cost=N]'); process.exit(2); }
const before = opt('before'), outDir = opt('out'), costN = +(opt('cost') || 0);
const W = 960, H = 600, BASE = `?mode=walk&ui=0&hud=0&w=${W}&h=${H}&grain=0`;
let bad = 0;
const fail = (m) => { bad++; console.error('  FAIL ' + m); };
const save = (name, url) => { if (outDir && url) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(url.split(',')[1], 'base64')); } };

// the views (eye, look)
const VIEWS = {
  close: [[0.9, 1.25, 5.6], [0.2, 0.0, 3.4]],          // down onto the path from the gate to the basin
  grazing: [[0.4, 0.42, 7.0], [0.0, 0.05, -3.0]],      // low over the paving, toward the pergola
  pergola: [[0.0, 1.7, -1.2], [0.0, 0.0, -6.0]],      // down onto the pergola's strip and the open paving before it
  low: [[0.3, 0.55, 5.6], [0.0, 0.0, 2.4]],            // crouched over the path: the basin mirrored, the rings in it
};

// in the page: stills of the named views (o.views), optional analyses (o.tests)
const PAGE = async (o) => {
  const { play, world, wet } = window.__mirage, cam = world.camera, gl = world.renderer.getContext(), cv = world.renderer.domElement;
  play.stop();
  world.post.grain = 0;
  const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
  const g2 = c2.getContext('2d', { willReadFrequently: true });
  const place = ([eye, look]) => { cam.position.fromArray(eye); cam.lookAt(...look); cam.updateMatrixWorld(); };
  const T = 1.37;   // the stills' time (s): uTime, so the rings stand still
  const still = (spp = 4, t = T) => { world.renderFrame(t, { spp, frameIndex: 1, shutter: 0 }); return cv.toDataURL('image/png'); };
  const pixels = () => { g2.drawImage(cv, 0, 0); return g2.getImageData(0, 0, cv.width, cv.height).data; };
  const luma = (d) => { const L = new Float32Array(d.length / 4); for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; return L; };
  const mats = [];
  world.scene.traverse((ob) => { for (const m of [].concat(ob.material || [])) if (m.userData.hooks && m.userData.hooks.uniforms && m.userData.hooks.uniforms.mgWetQ && !mats.includes(m)) mats.push(m); });
  const setQ = (i, v) => { for (const m of mats) m.userData.hooks.uniforms.mgWetQ.value.setComponent(i, v); };
  const getQ = (i) => mats.map((m) => m.userData.hooks.uniforms.mgWetQ.value.getComponent(i));
  const out = { mats: mats.length, views: {}, errors: [] };
  // the falling streaks (the rain kit, density from setRain) would differ with the level: hidden for the analyses
  if (o.tests && wet.rain) wet.rain.visible = false;
  for (const v of o.views || []) { place(o.V[v]); out.views[v] = still(6); }
  const W = cv.width, H = cv.height;
  const t = o.tests || {};
  if (t.ripples) {
    place(o.V.close);
    const rip0 = getQ(0), puds = mats.map((m) => m.userData.hooks.uniforms.mgWetP.value.w);
    wet.setRain(0); const r0 = still(); const p0 = pixels();
    wet.setRain(1); setQ(0, 0); const off = still(); const pOff = pixels();
    out.offSame = off === r0;
    // puddle pixels: what removing the puddles changes (rain on, ripples off), grown by 3 px
    for (const m of mats) m.userData.hooks.uniforms.mgWetP.value.w = 0;
    still(); const pNo = pixels();
    mats.forEach((m, i) => { m.userData.hooks.uniforms.mgWetP.value.w = puds[i]; });
    const pud = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) { let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(pOff[4 * i + c] - pNo[4 * i + c])); if (d > 2) pud[i] = 1; }
    const grown = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pud[y * W + x]) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) grown[Y * W + X] = 1; }
    let pudN = 0; for (let i = 0; i < W * H; i++) pudN += pud[i];
    // ripples on at rain levels: the pixels they change, how many lie in the puddles, and the rings (blobs)
    const blobs = (mask) => {
      const seen = new Uint8Array(W * H), st = []; let n = 0;
      for (let s = 0; s < W * H; s++) {
        if (!mask[s] || seen[s]) continue;
        let size = 0; st.push(s); seen[s] = 1;
        while (st.length) { const k = st.pop(); size++; const x = k % W, y = (k / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const q = Y * W + X; if (mask[q] && !seen[q]) { seen[q] = 1; st.push(q); } } }
        if (size >= 6) n++;
      }
      return n;
    };
    mats.forEach((m, i) => { m.userData.hooks.uniforms.mgWetQ.value.x = rip0[i]; });
    out.levels = [];
    for (const r of [0.25, 0.5, 1]) {
      wet.setRain(r); setQ(0, 0); still(); const base = pixels();
      mats.forEach((m, i) => { m.userData.hooks.uniforms.mgWetQ.value.x = rip0[i]; });
      const img = still(); const pr = pixels();
      const mask = new Uint8Array(W * H); let n = 0, inP = 0, energy = 0;
      for (let i = 0; i < W * H; i++) { let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(pr[4 * i + c] - base[4 * i + c])); energy += d; if (d > 3) { mask[i] = 1; n++; if (grown[i]) inP++; } }
      out.levels.push({ rain: r, changed: n, inPuddles: n ? +(inP / n).toFixed(4) : 1, rings: blobs(mask), energy: Math.round(energy) });
      if (r === 1) { out.rippleImg = img; out.rippleSame = img === still(); }
    }
    out.puddlePx = pudN;
    void r0; void p0;
  }
  if (t.specaa) {
    // a grazing view over the wet floor, rain on; specAA on (as built) and off (mgWetQ.y = 0)
    place(o.V.grazing);
    wet.setRain(1);
    const k0 = getQ(1);
    const rows = [Math.round(H * (o.floorFrom ?? 0.55)), H];   // the floor: the lower part of the frame
    // TAA frames with the camera held (its jitter alone: the sparkle a still viewer sees) or drifting 2 mm a frame
    const flicker = (k, step = 0) => {
      setQ(1, k);
      cam.position.fromArray(o.V.grazing[0]); cam.lookAt(...o.V.grazing[1]); cam.updateMatrixWorld();
      for (let i = 0; i < 8; i++) world.renderFrame(T, { taa: true });
      const Ls = [];
      for (let i = 0; i < 24; i++) { cam.position.x += step; cam.updateMatrixWorld(); world.renderFrame(T, { taa: true }); Ls.push(luma(pixels())); }
      // per pixel: the mean temporal second difference; the flicker is the mean over the floor's worst 1 % (the sparkle)
      const per = [];
      for (let y = rows[0]; y < rows[1]; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; let s = 0;
        for (let f = 1; f < Ls.length - 1; f++) s += Math.abs(Ls[f + 1][i] - 2 * Ls[f][i] + Ls[f - 1][i]);
        per.push(s / (Ls.length - 2));
      }
      per.sort((a, b) => b - a);
      const top = per.slice(0, Math.max(1, Math.round(per.length * 0.01)));
      return top.reduce((a, b) => a + b, 0) / top.length;
    };
    const hf = (k) => {
      setQ(1, k); place(o.V.grazing);
      world.renderFrame(T, { spp: 1, frameIndex: 1, shutter: 0 });
      const L = luma(pixels()); let s = 0, n = 0;
      for (let y = Math.max(rows[0], 1); y < rows[1] - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; const lap = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - W] - L[i + W]; s += lap * lap; n++; }
      return s / n;
    };
    out.flicker = { on: +flicker(1).toFixed(4), off: +flicker(0).toFixed(4) };
    out.flickerMoving = { on: +flicker(1, 0.002).toFixed(4), off: +flicker(0, 0.002).toFixed(4) };
    out.hf = { on: +hf(1).toFixed(3), off: +hf(0).toFixed(3) };
    if (o.ks) out.ks = o.ks.map((k) => [k, +flicker(k).toFixed(4), +flicker(k, 0.002).toFixed(4), +hf(k).toFixed(2)]);
    mats.forEach((m, i) => { m.userData.hooks.uniforms.mgWetQ.value.y = k0[i]; });
  }
  if (t.shelter) {
    // project the pergola's strip of paving and an open strip before it; compare wet against dry there
    place(o.V.pergola);
    const THREE = world.ctx.THREE;
    const box = (x0, x1, z0, z1) => {
      const ps = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => new THREE.Vector3(x, 0, z).project(cam));
      const xs = ps.map((p) => (p.x * 0.5 + 0.5) * W), ys = ps.map((p) => (0.5 - p.y * 0.5) * H);
      return [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(W, Math.max(...xs)), Math.min(H, Math.max(...ys))].map(Math.round);
    };
    // inside: under the pergola's roof, away from its edge; outside: open paving the same distance from the eye
    const inside = box(-1.6, 1.6, -6.2, -5.7), outside = box(-1.6, 1.6, -4.2, -3.7);
    wet.setRain(0);
    const wetImg = still(); const pw = pixels();
    const lvl = wet.setWetness(0); still(); still(); const pd = pixels();
    wet.setWetness(o.wet);
    const mean = ([x0, y0, x1, y1]) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = 4 * (y * W + x); for (let c = 0; c < 3; c++) s += Math.abs(pw[i + c] - pd[i + c]); n += 3; } return n ? s / n : NaN; };
    out.shelter = { inside: +mean(inside).toFixed(2), outside: +mean(outside).toFixed(2), boxes: { inside, outside }, dry: lvl };
    out.shelterImg = wetImg;
  }
  if (t.programs) {
    // more wet materials with other numbers: no new program
    // (the first numeric shelter switches the shelter term on: one program, shared by the second)
    const THREE = world.ctx.THREE, paving = mats.find((m) => m.userData.hooks.__wetOptions && m.userData.hooks.__wetOptions.height);
    place(o.V.close); still(1);
    const n0 = world.renderer.info.programs.length;
    const withWet = wet.withWet;
    const meshes = [];
    if (withWet && paving) {
      const h = paving.userData.hooks, base = h.__wetBase, o0 = h.__wetOptions;
      for (const [i, o2] of [{ porosity: 0.2 }, { ripples: 2.5 }, { specAA: 0.4 }, { rim: 0.6, porosity: 0.9 }, { ripples: 0, band: 1 }, { shelter: 0.2 }, { shelter: 0.7, porosity: 0.1 }].entries()) {
        const m = world.mat.std({ roughness: paving.roughness }, withWet(base, { ...o0, ...o2 }));
        const me = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), m); me.position.set(-1.5 + i * 0.45, 0.03, 4.5); world.scene.add(me); meshes.push(me);
      }
      still(1);
    }
    out.programs = { before: n0, after: world.renderer.info.programs.length, added: meshes.length, core: !!(withWet && paving) };
    for (const me of meshes) world.scene.remove(me);
  }
  out.gl = gl.getError();
  return out;
};

// walking frames for the cost: play.stop(), a step, render, a 1-px readback
const COST = async (n) => {
  const { play, world } = window.__mirage, cam = world.camera, gl = world.renderer.getContext();
  play.stop(); world.post.grain = 0;
  cam.position.set(0.4, 1.62, 5.4); cam.lookAt(0, 1.2, -6); cam.updateMatrixWorld();
  const px = new Uint8Array(4), ms = [];
  for (let i = 0; i < 10; i++) world.renderFrame(i / 60, { taa: true });
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    cam.position.z -= 0.02; cam.updateMatrixWorld();
    world.renderFrame(i / 60, { taa: true });
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return ms[ms.length >> 1];
};

const browser = await launch({ w: W, h: H });
const run = async (srvUrl, q, o) => {
  const pg = await open(browser, srvUrl + BASE + q);
  try {
    const r = await pg.page.evaluate(PAGE, { V: VIEWS, ...o });
    r.pageErrors = [...new Set(pg.errors)];
    r.warn = pg.warnings.filter((w) => /GL_INVALID|WebGL: |shader/i.test(w));
    return r;
  } finally { await pg.page.close(); }
};
// how many pixels of two PNG data URLs differ (decoded in a blank page)
let diffPage = null;
const diffPx = async (a, b) => {
  diffPage ??= await browser.newPage();
  return diffPage.evaluate(async (a, b) => {
    const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
    const [A, B] = await Promise.all([load(a), load(b)]);
    const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const p = px(A), q = px(B); let n = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n++;
    return n;
  }, a, b);
};
const ok = (r, name) => {
  if (r.gl) fail(`${name}: GL error ${r.gl}`);
  if (r.pageErrors.length) fail(`${name}: page errors: ${r.pageErrors.slice(0, 4).join(' | ').slice(0, 1500)}`);
  if (r.warn.length) fail(`${name}: warnings: ${r.warn.slice(0, 4).join(' | ').slice(0, 1500)}`);
};
try {
  const srv = await serve(dist);
  try {
    await run(srv.url, '&wet=0.9', {});   // a fresh browser's first page differs by 1/255 in places: warm it up
    const views = ['close', 'grazing'];
    const main = await run(srv.url, '&wet=0.9&rain=1', { views, wet: 0.9, tests: { ripples: true, programs: true }, pavingOpts: {} });
    ok(main, 'wet 0.9 rain 1');
    console.log(dist);
    console.log(`  wet materials: ${main.mats}; puddle pixels in the close view: ${main.puddlePx}`);
    console.log(`  ripples off = rain 0: ${main.offSame ? 'byte-identical' : 'DIFFERS'}`);
    if (!main.offSame) fail('ripples 0 does not draw the frame of rain 0');
    for (const l of main.levels) console.log(`  rain ${l.rain}: ${l.changed} px changed by the rings, ${(100 * l.inPuddles).toFixed(2)} % in puddles, ${l.rings} rings, energy ${l.energy}`);
    for (const l of main.levels) if (l.inPuddles < 0.99) fail(`rain ${l.rain}: ${(100 * (1 - l.inPuddles)).toFixed(2)} % of the ripple pixels lie outside the puddles`);
    const [a, b, c] = main.levels;
    if (!(a.rings < b.rings && b.rings < c.rings && a.changed < c.changed)) fail('the rings do not grow with the rain');
    if (!(c.rings > 3)) fail('too few rings at rain 1: ' + c.rings);
    console.log(`  a rain still drawn again after other frames: ${main.rippleSame ? 'byte-identical' : 'DIFFERS'}`);
    if (!main.rippleSame) fail('a still with rain differs when drawn again');
    for (const [name, q] of [['wet 0.9 rain 1', '&wet=0.9&rain=1'], ['wear, rain 1, planar', '&wet=0.9&rain=1&wear=1&planar=1'], ['wet 0.9 rain 1 at night', '&wet=0.9&rain=1&wear=1&time=21:30']]) {
      const r = await run(srv.url, q, { wet: 0.9, tests: { specaa: true }, ks: process.env.WET_KS ? JSON.parse(process.env.WET_KS) : null });
      if (r.ks) console.log('  k, flicker held, drifting, hf:', JSON.stringify(r.ks));
      ok(r, 'specaa ' + name);
      const x = (a) => (a.off / a.on).toFixed(2);
      console.log(`  specular AA off -> on, grazing wet floor (${name}): TAA held ${r.flicker.off} -> ${r.flicker.on} (x${x(r.flicker)}), TAA drifting ${r.flickerMoving.off} -> ${r.flickerMoving.on} (x${x(r.flickerMoving)}), 1-sample high-frequency energy ${r.hf.off} -> ${r.hf.on} (x${x(r.hf)})`);
      if (!(r.flicker.off / r.flicker.on > 1.05 || r.flickerMoving.off / r.flickerMoving.on > 1.05)) fail(`${name}: specular AA does not reduce the flicker`);
      if (!(r.hf.off / r.hf.on > 1.05)) fail(`${name}: specular AA does not reduce the high-frequency energy`);
    }
    console.log(`  programs: ${main.programs.before} -> ${main.programs.after} with ${main.programs.added} more wet materials of other numbers`);
    if (!main.programs.core) fail('window.__mirage.wet.withWet or the paving missing');
    else if (main.programs.after - main.programs.before > 1) fail('more wet materials with other numbers added programs');
    const wear = await run(srv.url, '&wet=0.9&wear=1', { views: ['pergola', 'close', 'grazing'], wet: 0.9, tests: { shelter: true } });
    ok(wear, 'wear');
    console.log(`  shelter: |wet - dry| under the pergola ${wear.shelter.inside}, on the open paving ${wear.shelter.outside} (boxes ${JSON.stringify(wear.shelter.boxes)})`);
    if (!(wear.shelter.inside * 4 < wear.shelter.outside)) fail('the sheltered paving changes nearly as much as the open paving');
    const planar = await run(srv.url, '&wet=0.9&rain=1&planar=1', { views: ['close', 'grazing'] });
    ok(planar, 'planar');
    const wearRain = await run(srv.url, '&wet=0.9&rain=1&wear=1&planar=1', { views: ['close', 'grazing', 'pergola'] });
    ok(wearRain, 'wear rain planar');
    if (outDir) {
      save('after-pergola-wear-shelter', wear.views.pergola); save('after-pergola-rain-wear-planar', wearRain.views.pergola);
      save('after-close-ripples-still', main.rippleImg);
    }
    if (before) {
      const sb = await serve(before);
      try {
        await run(sb.url, '&wet=0.9', {});
        // without rain the defaults must draw the same bytes; with rain the rings' AA may differ (in the puddles only)
        for (const q of ['', '&wet=0', '&wet=0.9', '&wet=0.9&planar=1', '&wet=0.9&rain=1', '&wet=0.9&rain=1&planar=1', '&wet=0.9&rain=1&wear=1&planar=1']) {
          const vs = q.includes('rain') ? [...views, 'low'] : views;
          const A = await run(sb.url, q, { views: vs, px: true }), B = await run(srv.url, q, { views: vs, px: true });
          for (const v of vs) {
            const same = A.views[v] === B.views[v], must = !q.includes('rain');
            const d = same ? 0 : await diffPx(A.views[v], B.views[v]);
            console.log(`  ${q || '(no flag)'} ${v}: ${same ? 'byte-identical' : `differs in ${d} px`} to the build before${!same && !must ? ' (rain > 0: allowed)' : ''}`);
            if (!same && must) fail(`${q} ${v}: the still differs from the build before`);
            if (outDir && q.includes('planar')) { const tag = `${v}-rain${q.includes('wear') ? '-wear' : ''}-planar`; save(`before-${tag}`, A.views[v]); save(`after-${tag}`, B.views[v]); }
          }
        }
        if (costN > 0) {
          const ms = { before: [], after: [] };
          const pa = await open(browser, sb.url + BASE + '&wet=0.9&rain=1'), pb = await open(browser, srv.url + BASE + '&wet=0.9&rain=1');
          try {
            for (let i = 0; i < costN; i++) { ms.before.push(await pa.page.evaluate(COST, 60)); ms.after.push(await pb.page.evaluate(COST, 60)); }
          } finally { await pa.page.close(); await pb.page.close(); }
          const st = (a) => { const s = [...a].sort((x, y) => x - y); return `median ${s[s.length >> 1].toFixed(2)} ms (${s[0].toFixed(2)}..${s.at(-1).toFixed(2)})`; };
          const d = ms.after.map((x, i) => x - ms.before[i]).sort((x, y) => x - y);
          console.log(`  cost, walking frames (wet 0.9 + rain 1, ${costN} interleaved rounds of 60): before ${st(ms.before)}, after ${st(ms.after)}; after - before per round median ${d[d.length >> 1].toFixed(2)} ms (${d[0].toFixed(2)}..${d.at(-1).toFixed(2)})`);
        }
      } finally { sb.close(); }
    }
  } finally { srv.close(); }
} finally { await browser.close(); }
console.log(bad ? `wet check: ${bad} failure(s)` : 'wet check: ok');
process.exit(bad ? 1 : 0);
