// Measure: what N particles cost, simulation and draw apart, at pixel ratio 1 and 2 (the numbers in docs/vfx.md).
// node examples/demos/vfx/vfx-bench.mjs [--w 1280 --h 720] [--rounds 5] [--n 25000,100000,...] [--kind plain|lit]
// Headless Chrome presents at 60 Hz at most, so frames per second cannot be read off the page. Each phase instead
// runs FRAMES frames back to back and ends with a one-pixel readback, which returns only when the GPU has finished
// them: wall time / FRAMES is the real cost of a frame. Phases are interleaved round by round (other work on the
// machine moves every phase alike) and the median and the spread over the rounds are printed.
//   base  the yard, effects hidden        draw  the yard + N particles, no simulation step
//   sim   one simulation step, no frame   both  one step + one frame (what a running page pays)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = +arg('w', 1280), H = +arg('h', 720), ROUNDS = +arg('rounds', 5), KIND = arg('kind', 'plain');
const NS = arg('n', '25000,100000,250000,500000,1000000,2000000').split(',').map(Number);
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const html = path.join(here, 'out/vfx.html');
execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', html], { stdio: ['ignore', 'ignore', 'inherit'] });

const IN_PAGE = async ({ N, ROUNDS, KIND }) => {
  const { world, createVfx } = window.__mirage, gl = world.renderer.getContext(), px = new Uint8Array(4), FRAMES = 12;
  const v = createVfx({ renderer: world.renderer, scene: world.scene, camera: world.camera, G: world.G }, { maxParticles: 1e9, instances: 1, gain: 2 });
  // small soft sprites filling a box in view: fill rate is a parameter of the picture, so the mean size is reported
  const LIFE = 4, layers = Math.ceil(N / 900000), per = N / layers;
  const one = (i) => ({ name: 'bench' + i, rate: per / LIFE, life: LIFE, capacity: Math.ceil(per * 1.02), seed: i + 1, shape: { type: 'box', size: [12, 4, 8] }, velocity: { random: [0.1, 0.5] },
    turbulence: { strength: 0.5, scale: 2 }, gravity: -0.2, drag: 0.3, size: [0.03, 0.06], color: [[0, '#ffd9a0'], [1, '#ff6a30']], alpha: [[0, 0], [0.1, 0.7], [1, 0]],
    render: KIND === 'lit' ? { blend: 'alpha', lit: 1, soft: 0.2 } : { blend: 'add' } });
  v.spawn({ name: 'bench', emitters: Array.from({ length: layers }, (_, i) => one(i)) }, { position: [0, 2.2, 0] });
  let step = 0;
  for (; step < LIFE * 60 + 30; step++) v.update(step / 60);
  const pool = v.pools()[0], one4 = new Float32Array(4);
  const frame = () => world.renderFrame(1, { spp: 1, frameIndex: 1 });
  const syncFrame = () => { world.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const syncSim = () => world.renderer.readRenderTargetPixels(pool.a, 0, 0, 1, 1, one4, undefined, 0);
  const phases = {
    base: () => { v.root.visible = false; for (let i = 0; i < FRAMES; i++) frame(); syncFrame(); v.root.visible = true; },
    draw: () => { for (let i = 0; i < FRAMES; i++) frame(); syncFrame(); },
    sim: () => { for (let i = 0; i < FRAMES; i++) v.update(step++ / 60); syncSim(); },
    both: () => { for (let i = 0; i < FRAMES; i++) { v.update(step++ / 60); frame(); } syncFrame(); },
  };
  const T = { base: [], draw: [], sim: [], both: [] };
  for (const k in phases) phases[k]();                                       // warm: shaders, targets
  for (let r = 0; r < ROUNDS; r++) for (const k in phases) { const t0 = performance.now(); phases[k](); T[k].push((performance.now() - t0) / FRAMES); }
  const alive = v.countAlive(), slots = v.pools().reduce((n, p) => n + p.cap, 0);
  const size = world.renderer.getDrawingBufferSize(new (window.__mirage.THREE.Vector2)());
  v.dispose();
  return { N, alive, slots, T, buffer: [size.x, size.y] };
};

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const fmt = (a) => `${med(a).toFixed(2)} (${Math.min(...a).toFixed(2)}-${Math.max(...a).toFixed(2)})`;
const b = await launch({ w: W, h: H });
const out = {};
for (const dpr of [1, 2]) {
  const page = await b.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(html) + `?fx=none&ui=0&time=15:00&w=${W}&h=${H}&dpr=${dpr}&spp=1`);
  await page.waitForFunction('window.__READY === true', { timeout: 120000, polling: 100 });
  const rows = [];
  for (const N of NS) rows.push(await page.evaluate(IN_PAGE, { N, ROUNDS, KIND }));
  await page.close();
  out[dpr] = rows;
  console.log(`\npixel ratio ${dpr}: ${rows[0].buffer.join('x')} buffer, '${KIND}' particles, ms per frame: median (min-max) of ${ROUNDS} rounds${errors.length ? '  ERRORS ' + errors[0] : ''}`);
  console.log('        N    alive  base               draw - base  sim                both               both - base');
  const own = rows.map((r) => med(r.T.both) - med(r.T.base)), all = rows.map((r) => med(r.T.both));
  rows.forEach((r, i) => console.log(`${String(r.N).padStart(9)} ${String(r.alive).padStart(8)}  ${fmt(r.T.base).padEnd(18)} ${(med(r.T.draw) - med(r.T.base)).toFixed(2).padEnd(12)} ${fmt(r.T.sim).padEnd(18)} ${fmt(r.T.both).padEnd(18)} ${own[i].toFixed(2)}`));
  // the largest N that fits a budget: linear between the two measured counts that straddle it
  const fit = (y, ms) => {
    if (y[0] > ms) return `under ${NS[0]}`;
    if (y[y.length - 1] <= ms) return `over ${NS[NS.length - 1]}`;
    for (let i = 1; i < y.length; i++) if (y[i] > ms) return String(Math.round(NS[i - 1] + (NS[i] - NS[i - 1]) * (ms - y[i - 1]) / (y[i] - y[i - 1])));
  };
  for (const [hz, ms] of [[60, 1000 / 60], [120, 1000 / 120]]) console.log(`  ${hz} fps (${ms.toFixed(2)} ms): ${fit(all, ms)} particles with the yard's own frame included, ${fit(own, ms)} if the particles had the whole frame`);
}
await b.close();
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
