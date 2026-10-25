// Headless check of the built example in the real Chrome: screenshots, console errors, still-frame stability,
// orbit shimmer with and without temporal AA, frame time.
// usage: node scripts/verify.mjs <outDir> [distDir]   (runs `vite preview` on the built dist/ or on distDir;
//        distDir may be an older build without TAA: its orbit then runs at 1 sub-frame only)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'out'), DIST = process.argv[3];
const PORT = 5181, W = 1440, H = 900;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DAY = 'date=2026-10-25';
const VIEWS = DIST ? [['m1-golden', 'time=golden', true]] : [
  ['golden', 'time=golden', true],
  ['noon', `time=12:00&${DAY}`],
  ['dusk-lanterns', `time=17:22&${DAY}`],
  ['night', 'time=21:00&date=2026-11-09'],
  ['golden-dof', 'time=golden&dof=1&spp=24'],
];
// the orbit: 0.35° per frame around a point in the courtyard, from M1's camera (the same path for every build)
const ORBIT = { eye: [5.6, 1.75, 5.9], target: [-2.5, 2.3, -2.8], step: 0.35, warm: 24 };
fs.mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', `--window-size=${W},${H}`],
});
const report = { views: {} };
try {
  for (const [name, q, orbit] of VIEWS.filter(([n]) => !process.env.ONLY || process.env.ONLY.split(',').includes(n))) {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/?${q}&w=${W}&h=${H}`);
    await page.waitForFunction('window.__READY === true', { timeout: 180000 });
    await new Promise((r) => setTimeout(r, 300));
    const spp = +(new URLSearchParams(q).get('spp') || 6);
    const r = await page.evaluate(async (ORBIT, doOrbit, spp) => {
      const { world, render } = window.__mirage;
      const gl = world.renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const grab = () => { const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
      const diff = (a, b) => { let m = 0, n = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { n++; if (d > m) m = d; } } return { max: m, differing: n }; };
      const out = { gpu: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) };
      render({ frameIndex: 1, spp }); const a = grab();
      render({ frameIndex: 1, spp }); const b = grab();
      out.sameFrameIndex = diff(a, b);                  // a still view: must be 0
      render({ frameIndex: 2, spp }); out.nextFrameIndexWithGrain = diff(b, grab());
      for (const n of [1, 6]) {
        render({ spp: n }); sync();
        const t = performance.now();
        for (let i = 0; i < 12; i++) { render({ spp: n, frameIndex: i }); sync(); }
        out['frameMs_spp' + n] = +((performance.now() - t) / 12).toFixed(2);
      }
      if (doOrbit) {
        // shimmer on an orbit: mean |f(i+1) - f(i)| (motion + shimmer) and mean |f0 - 2 f1 + f2| (what is not
        // smooth motion: flicker, crawling edges). Per RGB channel, 0..255, grain off.
        const cam = world.camera, [tx, ty, tz] = ORBIT.target, saved = [cam.position.clone(), cam.quaternion.clone()];
        const r0 = Math.hypot(ORBIT.eye[0] - tx, ORBIT.eye[2] - tz), a0 = Math.atan2(ORBIT.eye[2] - tz, ORBIT.eye[0] - tx);
        const place = (i) => { const an = a0 + (i * ORBIT.step * Math.PI) / 180; cam.position.set(tx + r0 * Math.cos(an), ORBIT.eye[1], tz + r0 * Math.sin(an)); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld(); };
        const stats = (f) => {
          let d1 = 0, d2 = 0;
          for (let i = 0; i < f[0].length; i += 4) for (let c = 0; c < 3; c++) { d1 += Math.abs(f[1][i + c] - f[0][i + c]) + Math.abs(f[2][i + c] - f[1][i + c]); d2 += Math.abs(f[0][i + c] - 2 * f[1][i + c] + f[2][i + c]); }
          const n = (f[0].length / 4) * 3; return { meanAbsDiff: +(d1 / (2 * n)).toFixed(3), flicker: +(d2 / n).toFixed(3) };
        };
        const run = (opts) => { const f = []; for (let i = 0; i < ORBIT.warm + 3; i++) { place(i); world.renderFrame(0, { frameIndex: 1, ...opts }); if (i >= ORBIT.warm) f.push(grab()); } return f; };
        world.post.grain = 0;
        out.orbit_spp1 = stats(run({ spp: 1 }));
        let frames = null;
        if (world.tick) {
          frames = run({ taa: true });
          out.orbit_taa = stats(frames);
          sync(); const t = performance.now();
          for (let i = 0; i < 24; i++) { place(i); world.renderFrame(0, { taa: true, frameIndex: i }); sync(); }
          out.frameMs_orbitTaa = +((performance.now() - t) / 24).toFixed(2);
        } else frames = run({ spp: 1 });
        window.__orbitFrames = frames;
        if (world.tick) {
          // a running clock through sunset (16:50 -> 17:20, 20 s of clock per frame at 30 fps): eased (one capture
          // per change + cross-fade) against snapping (two captures every setTime, the M1 behaviour)
          const clockRun = (ease) => {
            const t0 = Date.parse('2026-10-25T07:50:00Z'), ms = [], lum = [];
            for (let i = 0; i < 90; i++) {
              world.setTime(new Date(t0 + i * 20000), { ease }); world.tick(1 / 30);
              sync(); const t = performance.now();
              world.renderFrame(0, { taa: true, frameIndex: 1 }); const f = grab(); ms.push(performance.now() - t);
              let s = 0, n = 0; for (let k = 0; k < f.length; k += 64) { s += f[k] + f[k + 1] + f[k + 2]; n += 3; } lum.push(s / n);
            }
            for (let i = 0; i < 120; i++) { world.tick(1 / 30); world.renderFrame(0, { taa: true, frameIndex: 1 }); }   // hold the clock 4 s: settle
            { const f = grab(); let s = 0, n = 0; for (let k = 0; k < f.length; k += 64) { s += f[k] + f[k + 1] + f[k + 2]; n += 3; } lum.push(s / n); }
            let step = 0; for (let i = 1; i < 90; i++) step = Math.max(step, Math.abs(lum[i] - lum[i - 1]));
            ms.sort((a, b) => a - b);
            return { meanMs: +(ms.reduce((a, b) => a + b) / ms.length).toFixed(2), p95Ms: +ms[Math.floor(ms.length * 0.95)].toFixed(2), maxLumaStep: +step.toFixed(2), lumaStart: +lum[0].toFixed(1), lumaEnd: +lum[89].toFixed(1), lumaSettled: +lum[90].toFixed(1) };
          };
          out.clock_eased = clockRun(true);
          out.clock_snap = clockRun(false);
          world.setTime('golden');
        }
        world.post.grain = 0.012;
        cam.position.copy(saved[0]); cam.quaternion.copy(saved[1]); cam.updateMatrixWorld();
      }
      render({ frameIndex: 1, spp });
      out.png = document.querySelector('canvas').toDataURL('image/png');   // same task: no animation frame in between
      return out;
    }, ORBIT, !!orbit, spp);
    r.loadMs = Date.now() - t0;
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    delete r.png;
    if (orbit) {
      // the three measured orbit frames as PNGs (GL rows are bottom-up)
      const frames = await page.evaluate(() => window.__orbitFrames.map((a) => {
        const c = document.createElement('canvas'), w = 1440, h = 900; c.width = w; c.height = h;
        const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) img.data.set(a.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        ctx.putImageData(img, 0, 0); return c.toDataURL('image/png');
      }));
      frames.forEach((d, i) => fs.writeFileSync(path.join(OUT, `${name}-orbit-${i}.png`), Buffer.from(d.split(',')[1], 'base64')));
    }
    r.errors = errors;
    report.views[name] = r;
    console.log(name, JSON.stringify(r));
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
