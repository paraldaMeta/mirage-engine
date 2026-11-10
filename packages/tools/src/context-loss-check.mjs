#!/usr/bin/env node
// Mirage original code. WebGL context loss in the real Chrome, on an example's dist opened with ?platform=1
// (docs/platforms.md): take a still, lose the context (WEBGL_lose_context), restore it, take the still again.
//   node packages/tools/src/context-loss-check.mjs examples/hello-courtyard/dist examples/garden-quest/dist [--out dir]
// Passes when, twice in a row: the page hears lost and restored, play stops while the context is gone and runs again
// after, the still after is the still before (<= 2/255 on any channel: the temporal histories start again), the
// image is not black, and the page logged no error. Then the control: the same loss with the recovery object
// removed must NOT come back to the same image, or this check proves nothing.
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, open } from './chrome.mjs';
import { readPNG, pixelDiff } from './imgcmp.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const targets = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!targets.length) { console.error('usage: context-loss-check.mjs <dist dir>... [--out dir]'); process.exit(2); }
const OUT = flag('out', null), W = 960, H = 540;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const browser = await launch({ w: W, h: H });
try {
  for (const dir of targets) {
    const name = path.basename(path.resolve(dir, '..')), srv = await serve(dir), problems = [];
    try {
      const { page, errors } = await open(browser, `${srv.url}?platform=1&quality=medium&hud=0&ui=0&grain=0&w=${W}&h=${H}`);
      const still = async () => readPNG(Buffer.from((await page.evaluate(() => { const { play } = window.__mirage; play.render({ moving: false, spp: 8, frameIndex: 1 }); return document.querySelector('canvas').toDataURL('image/png'); })).split(',')[1], 'base64'));
      const luma = (img) => { let s = 0; for (let i = 0; i < img.data.length; i += 4) s += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]; return s / (img.data.length / 4); };
      const save = (tag, dataUrlImg) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${name}-${tag}.json`), JSON.stringify(dataUrlImg)); } };
      const before = await still();
      if (luma(before) < 8) problems.push(`the still before is black (mean luma ${luma(before).toFixed(1)})`);
      const rounds = [];
      for (let round = 1; round <= 2; round++) {
        const r = await page.evaluate(async () => {
          const { recovery } = window.__platform, { play, world } = window.__mirage;
          const was = play.running;
          const p = recovery.simulate({ hold: 300 });
          await new Promise((res) => setTimeout(res, 120));
          const mid = { lost: recovery.lost, glLost: world.renderer.getContext().isContextLost(), running: play.running };
          const info = await p;
          return { was, mid, ms: Math.round(info.ms), count: recovery.count, lostAfter: recovery.lost, glLostAfter: world.renderer.getContext().isContextLost(), running: play.running, log: window.__platform.log.filter((e) => e.type.startsWith('context')).map((e) => e.type) };
        });
        await sleep(400);
        const after = await still(), d = pixelDiff(before, after);
        rounds.push({ round, ms: r.ms, differing: d.differing, max: d.max, mean: +d.mean.toFixed(4) });
        if (!r.mid.lost || !r.mid.glLost) problems.push(`round ${round}: the context was not lost (${JSON.stringify(r.mid)})`);
        if (r.mid.running) problems.push(`round ${round}: play kept running in a dead context`);
        if (r.lostAfter || r.glLostAfter) problems.push(`round ${round}: the context did not come back`);
        if (r.was && !r.running) problems.push(`round ${round}: play did not start again`);
        if (r.count !== round) problems.push(`round ${round}: restore count is ${r.count}`);
        if (r.log.filter((t) => t === 'context-restored').length !== round) problems.push(`round ${round}: the page heard ${JSON.stringify(r.log)}`);
        if (d.max > 2) problems.push(`round ${round}: the still after differs from the still before (${d.differing} px, max ${d.max}/255, mean ${d.mean.toFixed(3)})`);
        if (luma(after) < 8) problems.push(`round ${round}: the still after is black`);
      }
      // control: no recovery object -> three restores its own state, the baked targets stay empty
      const c = await page.evaluate(async () => {
        window.__platform.recovery.dispose();
        const { world } = window.__mirage, cv = world.renderer.domElement, ext = world.renderer.getContext().getExtension('WEBGL_lose_context');
        const back = new Promise((res) => cv.addEventListener('webglcontextrestored', res, { once: true }));
        ext.loseContext(); setTimeout(() => ext.restoreContext(), 300);
        await back;
        return true;
      });
      await sleep(400);
      const ctl = c ? pixelDiff(before, await still()) : null;
      if (!ctl || ctl.max <= 2) problems.push('control: without the recovery the image came back unchanged, so this check cannot tell recovery from nothing');
      const real = errors.filter((e) => !/CONTEXT_LOST_WEBGL|context lost|Context Lost/i.test(e));
      if (real.length) problems.push(`console: ${real.slice(0, 3).join(' | ')}`);
      save('result', { rounds, control: ctl });
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}: ${rounds.map((r) => `round ${r.round} back in ${r.ms} ms, ${r.differing} px differ (max ${r.max}/255)`).join('; ')}; control without recovery: ${ctl ? `${ctl.differing} px differ (max ${ctl.max}/255, mean ${ctl.mean.toFixed(1)})` : 'not run'}`);
      for (const p of problems) console.log('     ' + p);
      if (problems.length) failed++;
      await page.close();
    } finally { srv.close(); }
  }
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
