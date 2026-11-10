#!/usr/bin/env node
// Mirage original code. Fit the XR grade's bloom stand-in (packages/play/src/xr.js XR_FIT) to the desktop pipeline:
// for each world, the desktop frame from the emulated left eye's pose and lens is the reference; the XR left eye is
// rendered for every candidate and the mean |difference| (8-bit RGB, 200 x 200 thumbnails) is summed over worlds.
// usage: node packages/tools/src/xr-fit.mjs <dist dir> [...] [--w 1600 --h 800]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { launch, serve } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const targets = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const W = +flag('w', 1600), H = +flag('h', 800);
const IWER = fs.readFileSync(createRequire(import.meta.url).resolve('iwer/build/iwer.min.js'), 'utf8');
const INSTALL = `${IWER};(() => { const d = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: true }); d.installRuntime({ forceInstall: true }); window.__iwer = d; })();`;
const GRID = [];
for (const GAIN of [0, 0.6, 1.0, 1.4, 1.8]) for (const VEIL of [0, 0.5, 1.0, 1.5, 2.0, 2.5]) for (const VEIL_SAT of [0, 0.5, 1]) GRID.push({ GAIN, VEIL, VEIL_SAT });
const total = GRID.map(() => 0), per = [];

const DIFF = `async (a, b, halfA) => {
  const load = async (f) => { const i = new Image(); i.src = f; await i.decode(); return i; };
  const [A, B] = [await load(a), await load(b)];
  const c = document.createElement('canvas'); c.width = 200; c.height = 200; const g = c.getContext('2d');
  const px = (img, sw) => { g.clearRect(0, 0, 200, 200); g.drawImage(img, 0, 0, sw, img.height, 0, 0, 200, 200); return g.getImageData(0, 0, 200, 200).data; };
  const x = px(A, halfA ? A.width / 2 : A.width), y = px(B, B.width);
  let d = 0; for (let i = 0; i < x.length; i += 4) for (let k = 0; k < 3; k++) d += Math.abs(x[i + k] - y[i + k]);
  return d / (x.length / 4) / 3;
}`;

for (const dir of targets) {
  const srv = await serve(dir);
  const browser = await launch({ w: W, h: H });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(INSTALL);
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto(srv.url + `?mode=walk&ui=0&hud=0&start=1&grain=0&w=${W}&h=${H}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
    const enter = async () => {
      const f0 = await page.evaluate(() => window.__mirage.xr.stats.frames);
      await page.click('.mirage-xr button[data-mode="immersive-vr"]');
      await page.waitForFunction((f0) => window.__mirage.xr.mode === 'vr' && window.__mirage.xr.stats.frames > f0 + 10, { polling: 50 }, f0);
      await page.evaluate(() => { const sp = window.__mirage.built.plan.spawn; window.__mirage.xr.place(sp.eye, sp.look); });
      await new Promise((r) => setTimeout(r, 1200));
    };
    await page.waitForFunction(() => !window.__mirage.xr.buttons['immersive-vr'].hidden);
    await enter();
    const eye = await page.evaluate(() => { const c = window.__mirage.world.renderer.xr.getCamera().cameras[0]; return { m: c.matrixWorld.toArray(), p: c.projectionMatrix.toArray() }; });
    await page.evaluate(() => window.__mirage.xr.exit());
    await page.waitForFunction(() => !window.__mirage.xr.presenting);
    const ref = await page.evaluate((e, w, h) => {
      const { world, play } = window.__mirage, THREE = world.ctx.THREE;
      play.stop(); world.resize(w, h);
      const cam = new THREE.PerspectiveCamera();
      new THREE.Matrix4().fromArray(e.m).decompose(cam.position, cam.quaternion, cam.scale);
      cam.updateMatrixWorld(); cam.projectionMatrix.fromArray(e.p); cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      world.renderFrame(play.clock, { camera: cam, spp: 6, frameIndex: 1 });
      const png = document.querySelector('canvas').toDataURL('image/png');
      world.resize(innerWidth, innerHeight); play.start();
      return png;
    }, eye, W / 2, H);
    await enter();
    const res = [];
    for (const [i, f] of GRID.entries()) {
      const shot = await page.evaluate(async (f) => {
        Object.assign(window.__mirage.xr.fit, f);
        const f0 = window.__mirage.xr.stats.frames;
        await new Promise((r) => { (function w() { if (window.__mirage.xr.stats.frames > f0 + 2) r(); else setTimeout(w, 5); })(); });
        return document.querySelector('canvas').toDataURL('image/png');
      }, f);
      const d = await page.evaluate(`(${DIFF})(${JSON.stringify(shot)}, ${JSON.stringify(ref)}, true)`);
      total[i] += d; res.push(+d.toFixed(2));
    }
    const name = await page.evaluate(() => window.__mirage.built.plan.name);
    per.push({ name, res });
    console.log(name, 'best', GRID[res.indexOf(Math.min(...res))], Math.min(...res));
  } finally { await browser.close(); srv.close(); }
}
const best = total.indexOf(Math.min(...total));
console.log('overall best', GRID[best], per.map((p) => `${p.name} ${p.res[best]}`).join(', '), 'current (1.4, 1, 0.5):', per.map((p) => p.res[GRID.findIndex((g) => g.GAIN === 1.4 && g.VEIL === 1 && g.VEIL_SAT === 0.5)]).join(', '),
  'no bloom stand-in (0, 0):', per.map((p) => p.res[0]).join(', '));
