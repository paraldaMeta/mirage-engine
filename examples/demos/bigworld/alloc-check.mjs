// How much the frame loop allocates: bytes of JS heap allocated per frame while walking in an example, from
// Chrome's sampling heap profiler (objects already collected are counted too), and the top allocating functions.
// node examples/demos/bigworld/alloc-check.mjs [--only hello-courtyard,walled-garden] [--seconds 6] [--runs 3] [--query perf=chunk,lod,occ] [--stacks 4] [--out file.json]
// Needs the examples built (npm run build:examples). The page runs its own loop (play.js): W is held and the
// view turns, so step(), view(), the shadow fit and renderFrame all run as they do for a player.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), EX = path.join(here, '../..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const NAMES = flag('only', 'hello-courtyard,walled-garden').split(','), SECONDS = +flag('seconds', 6), RUNS = +flag('runs', 3), QUERY = flag('query', '');
const W = 1280, H = 720, results = {}, STACKS = +flag('stacks', 0);   // --stacks 4: split each entry by its 4 callers (use a build with --minify false)

async function measure(url) {
  const browser = await launch({ w: W, h: H }), page = await browser.newPage();
  await page.goto(`${url}?w=${W}&h=${H}&mode=walk&ui=0&hud=0&grain=0&${QUERY}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 300000, polling: 100 });
  const cdp = await page.createCDPSession();
  await page.evaluate(() => { window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await page.keyboard.down('KeyW'); await page.keyboard.down('ArrowLeft');
  await new Promise((r) => setTimeout(r, 1500));                      // warm: JIT, caches, the first shadow fits
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const f0 = await page.evaluate(() => window.__frames);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const f1 = await page.evaluate(() => window.__frames);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  await page.keyboard.up('KeyW'); await page.keyboard.up('ArrowLeft');
  let total = 0; const by = new Map();
  (function walk(n, via) { total += n.selfSize; const name = n.callFrame.functionName || '(anonymous)'; if (n.selfSize) { const k = `${name} ${path.basename(n.callFrame.url || '')}:${n.callFrame.lineNumber}` + (STACKS ? ' < ' + via.slice(-STACKS).reverse().join(' < ') : ''); by.set(k, (by.get(k) || 0) + n.selfSize); } n.children?.forEach((c) => walk(c, [...via, name])); })(profile.head, []);
  await browser.close();
  const frames = f1 - f0;
  return { frames, bytesPerFrame: total / frames, top: [...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${Math.round(v / frames)} B/frame ${k}`) };
}

for (const name of NAMES) {
  const dist = path.join(EX, name, 'dist');
  if (!fs.existsSync(dist)) { console.log(`${name}: no dist (npm run build:examples)`); continue; }
  const srv = await serve(dist), runs = [];
  for (let r = 0; r < RUNS; r++) runs.push(await measure(srv.url));
  srv.close();
  const b = runs.map((r) => r.bytesPerFrame);
  results[name] = { bytesPerFrame: { mean: Math.round(b.reduce((a, c) => a + c, 0) / b.length), min: Math.round(Math.min(...b)), max: Math.round(Math.max(...b)) }, frames: runs.map((r) => r.frames), top: runs.at(-1).top };
  console.log(`${name}: ${results[name].bytesPerFrame.mean} bytes per frame (${results[name].bytesPerFrame.min}-${results[name].bytesPerFrame.max}) over ${runs.map((r) => r.frames).join(', ')} frames\n  ` + results[name].top.join('\n  '));
}
const out = flag('out', null);
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
