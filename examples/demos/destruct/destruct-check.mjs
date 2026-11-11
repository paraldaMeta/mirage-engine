// Check: the destructibles demo on a real GPU (headless Chrome). What the Node check (packages/game/destruct.check.mjs)
// cannot see: the shards and debris on screen, lamp pool lamps really going dark (the room's light drops), frame time
// with rendering, idle and under a 1000-hit stress, and that a page with an empty registry draws the same pixels as one
// without destructibles. Writes before / during / after stills to out/.
// node examples/demos/destruct/destruct-check.mjs [--json] [--no-package]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const out = path.join(here, 'out'), html = path.join(out, 'destruct.html');
fs.mkdirSync(out, { recursive: true });
if (!process.argv.includes('--no-package')) execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', html], { stdio: ['ignore', 'ignore', 'inherit'] });
const W = 960, H = 600;

// ---- in the page
const HELPERS = () => {
  const M = window.__mirage; M.pause(true);
  const gl = M.world.renderer.getContext();
  const px = new Uint8Array(4);
  window.__h = {
    advance(n, dt = 1 / 60) { for (let i = 0; i < n; i++) M.frame(dt); },
    /** shoot at a world point (its screen position) */
    at(p, weapon = 'pistol') { const v = new M.THREE.Vector3(...p).project(M.camera); M.shoot(v.x, v.y, weapon); },
    luma() {   // the mean display level of the last still (the drawing buffer is kept)
      const c = M.world.renderer.domElement, w = 96, h = 60, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d'); g.drawImage(c, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return s / (w * h);
    },
    pixels() { const c = M.world.renderer.domElement, cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height; const g = cv.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height).data; let h = 2166136261 >>> 0; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0; return h.toString(16); },
    sync() { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); },
    /** ms per frame (frame() and the GPU, synced by a 1-pixel read) over n frames: mean, worst */
    time(n, each) { const t = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); each?.(i); M.frame(1 / 60); window.__h.sync(); t.push(performance.now() - t0); } t.sort((a, b) => a - b); return { mean: t.reduce((a, b) => a + b, 0) / n, p95: t[Math.floor(n * 0.95)], max: t[n - 1] }; },
  };
  return true;
};
const SCRIPT = () => {
  const M = window.__mirage, h = window.__h, d = M.d, pool = M.world.lampPool, R = {};
  h.advance(20);
  R.lit0 = pool.lit; R.lamps = pool.count;
  M.still(); R.luma0 = h.luma();
  // the glass wall (health 60): two pistol rounds crack it, the third shatters it
  h.at([-3.65, 1.4, -3]); h.advance(2); h.at([-3.3, 0.9, -3]); h.advance(2);
  R.cracks = d.marks.count;
  M.still(); R.crackedShot = true;
  return R;
};
const SCRIPT_2 = () => {
  const M = window.__mirage, h = window.__h, d = M.d, R = {};
  h.at([-3.9, 1.6, -3]); h.advance(5);
  R.glassDebris = d.debris.live; R.pane0 = d.get('pane0').broken;
  M.still();
  return R;
};
const SCRIPT_3 = () => {
  const M = window.__mirage, h = window.__h, d = M.d, P = M.P, R = {};
  const order = []; d.on('break', (e) => order.push(e.id));
  h.at([3.55, 1.68, -5.2], 'shotgun'); h.advance(2);               // the top shelf of bottles
  h.at([3.3, 1.0, -5.32]); h.advance(2);                            // a can off the lower shelf
  h.at([P.bulbs[4].mesh.position.x, P.bulbs[4].mesh.position.y, -6]); h.advance(2);
  h.at([-0.6, 2.7, -11.9]); h.advance(2);                           // the neon tube
  h.at([0.75, 0.2, -7.6]); h.advance(1); h.at([0.75, 0.15, -7.6]); h.advance(2);   // the fuel can
  h.at([-2.6, 2.3, -8.6]); h.advance(1); h.at([-2.9, 2.35, -8.6]); h.advance(2);   // the hung sign
  h.at([5.6, 0.3, -9.2]); h.advance(1); h.at([5.6, 0.35, -9.2]); h.advance(1); h.at([5.6, 0.2, -9.2]); h.advance(2);   // the extinguisher
  for (let i = 0; i < 4; i++) { h.at([-5.04, 1.0 + i * 0.1, -9]); h.advance(1); }                                     // the vending front
  for (let i = 0; i < 3; i++) { h.at([3.4, 0.42, -9.6]); h.advance(1); }                                             // the tyre
  for (let i = 0; i < 3; i++) { h.at([-2.2, 1.2, -10.6]); h.advance(1); }                                            // the dummy
  for (let i = 0; i < 12; i++) { h.at([3.4, 2.5, -11.98], 'shotgun'); h.advance(1); }                                // the owner's sign
  h.advance(18);
  R.order = order.slice(); R.debrisDuring = d.debris.live; R.marks = d.marks.count;
  M.still();
  return R;
};
const SCRIPT_4 = () => {
  const M = window.__mirage, h = window.__h, d = M.d, pool = M.world.lampPool, R = {};
  h.advance(240);
  M.still(); R.luma1 = h.luma();
  R.lit1 = pool.lit; R.tally = JSON.parse(JSON.stringify(d.tally)); R.owner = !d.get('owner-sign').broken && d.get('owner-sign').health === d.get('owner-sign').max;
  R.debrisAfter = d.debris.live; R.hash = d.hash(); R.steam = d.occluders.length; R.puddle = !!d.surfaceAt([-5.0, 0, -9]);
  R.snap = d.snapshot();
  d.reset(); h.advance(2); R.litReset = pool.lit; R.tallyReset = d.tally.count;
  d.restore(R.snap); h.advance(2); R.litRestored = pool.lit; R.brokenRestored = JSON.stringify(d.snapshot().broken) === JSON.stringify(R.snap.broken);
  M.still();
  return R;
};
const STRESS = () => {
  const M = window.__mirage, h = window.__h, d = M.d, R = {};
  d.reset(); h.advance(30);
  let s = 12345; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const hits = (n) => () => { for (let k = 0; k < n; k++) M.shoot(rnd() * 1.6 - 0.8, rnd() * 1.2 - 0.6, k % 4 ? 'pistol' : 'shotgun'); };
  let maxDebris = 0, maxMarks = 0;
  const watch = (f) => (i) => { f(i); maxDebris = Math.max(maxDebris, d.debris.live); maxMarks = Math.max(maxMarks, d.marks.count); };
  // a field of extra glass and crates in front of the bench so a thousand rounds keep finding something
  const T = M.THREE, mat = new T.MeshStandardMaterial({ color: 0x8a6440 }), field = new T.InstancedMesh(new T.BoxGeometry(0.3, 0.3, 0.3), mat, 400);
  for (let i = 0; i < 400; i++) field.setMatrixAt(i, new T.Matrix4().makeTranslation((i % 20) * 0.32 - 3.2, 0.9 + Math.floor(i / 20) % 5 * 0.32, -1.5 - Math.floor(i / 100) * 0.4));
  M.P.field = field; M.world.scene.add(field); field.updateMatrixWorld(true);
  for (let i = 0; i < 400; i++) d.add({ id: 'f' + i, draw: { mesh: field, index: i }, material: ['glass', 'wood', 'cardboard', 'ceramic'][i % 4], health: 15 });
  h.advance(2);
  if (window.gc) window.gc();
  const heap0 = performance.memory?.usedJSHeapSize ?? 0;
  R.stress = h.time(60, watch(hits(17)));   // 17 rounds a frame: ~1000 in a second (shotgun shells: 9 pellets)
  R.after = h.time(60);
  d.reset(); h.advance(2); if (window.gc) window.gc();
  const heap1 = performance.memory?.usedJSHeapSize ?? 0;
  R.stress2 = h.time(60, watch(hits(17))); d.reset(); h.advance(2); if (window.gc) window.gc();
  const heap2 = performance.memory?.usedJSHeapSize ?? 0;
  Object.assign(R, { maxDebris, maxMarks, cap: d.cfg.maxDebris, decalCap: d.cfg.maxDecals, heap0, heap1, heap2, hits: d.stats.hits, steps: d.steps });
  return R;
};
const BARE = () => {   // the same view with no registry (dx=0) or an empty one (dx=empty)
  const M = window.__mirage, h = window.__h, R = {};
  h.advance(20); M.still(); R.pixels = h.pixels(); R.idle = h.time(120); R.lit = M.world.lampPool.lit;
  return R;
};
const DET = () => {   // the same scripted shots on a fresh page: the same state
  const M = window.__mirage, h = window.__h, R = {};
  h.advance(20);
  for (const p of [[-3.65, 1.4, -3], [-3.3, 0.9, -3], [-3.9, 1.6, -3], [0.75, 0.2, -7.6], [0.75, 0.15, -7.6]]) { h.at(p); h.advance(3); }
  h.at([3.55, 1.68, -5.2], 'shotgun'); h.advance(60);
  R.hash = M.d.hash(); R.pixelsReady = true;
  return R;
};

const b = await launch({ w: W, h: H, args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
async function page(query) {
  const p = await b.newPage(), errors = [];
  await p.setViewport({ width: W, height: H });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(pathToFileURL(html) + `?w=${W}&h=${H}&dpr=1&ui=0&paused=1&spp=6${query}`);
  await p.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  await p.evaluate(HELPERS);
  return { p, errors };
}
const shot = async (p, name) => { await p.screenshot({ path: path.join(out, name) }); };
const R = {};
{
  const { p, errors } = await page('');
  Object.assign(R, await p.evaluate(SCRIPT)); await shot(p, '1-before-cracked.png');
  Object.assign(R, await p.evaluate(SCRIPT_2)); await shot(p, '2-glass-shatters.png');
  Object.assign(R, await p.evaluate(SCRIPT_3)); await shot(p, '3-during.png');
  Object.assign(R, await p.evaluate(SCRIPT_4)); await shot(p, '4-after-restored.png');
  Object.assign(R, await p.evaluate(STRESS));
  R.errors = errors; await p.close();
}
{ const { p, errors } = await page('&dx=0'); R.bare = await p.evaluate(BARE); R.bare.errors = errors; await shot(p, '0-no-destructibles.png'); await p.close(); }
{ const { p, errors } = await page('&dx=empty'); R.empty = await p.evaluate(BARE); R.empty.errors = errors; await p.close(); }
{ const { p } = await page(''); R.idle = (await p.evaluate(BARE)).idle; R.det1 = await p.evaluate(DET); await p.close(); }
{ const { p } = await page(''); R.det2 = await p.evaluate(DET); await p.close(); }
await b.close();

const fails = [], want = (ok, msg) => { if (!ok) fails.push(msg); };
want(R.cracks >= 1, `glass: a crack mark after two rounds (${R.cracks})`);
want(R.pane0 && R.glassDebris > 20, `glass: the third round shatters the pane into ${R.glassDebris} shards`);
for (const id of ['bulb4', 'neon', 'fuel', 'sign', 'extinguisher', 'vending', 'tyre', 'dummy', 'crate0']) want(R.order.includes(id), `broke: ${id} (${R.order.join(' ')})`);
want(R.owner && !R.order.includes('owner-sign'), "the owner's sign is whole after 12 shotgun shells");
want(R.lit1 <= R.lit0 - 14, `lamps: the bulbs, the tube and the cabinet go dark (lit ${R.lit0} -> ${R.lit1} of ${R.lamps})`);
want(R.luma1 < R.luma0 * 0.85, `the room is darker: mean level ${R.luma0.toFixed(1)} -> ${R.luma1.toFixed(1)}`);
want(R.puddle, 'the cabinet spilled');
want(R.litReset === R.lit0 && R.tallyReset === 0 && R.litRestored === R.lit1 && R.brokenRestored, `reset / restore: lit ${R.litReset} / ${R.litRestored}, broken set ${R.brokenRestored}`);
want(R.maxDebris <= R.cap && R.maxMarks <= R.decalCap, `caps under stress: debris ${R.maxDebris}/${R.cap}, marks ${R.maxMarks}/${R.decalCap}`);
const IDLE_BOUND = 1.5, STRESS_BOUND = 12;
want(R.idle.mean - R.bare.idle.mean < IDLE_BOUND, `idle cost: ${R.idle.mean.toFixed(2)} ms with the range registered vs ${R.bare.idle.mean.toFixed(2)} ms without (bound +${IDLE_BOUND} ms)`);
want(R.stress.mean < STRESS_BOUND, `stress: ${R.stress.mean.toFixed(2)} ms a frame (p95 ${R.stress.p95.toFixed(1)}) with 17 rounds a frame (bound ${STRESS_BOUND} ms)`);
const growKB = (R.heap2 - R.heap1) / 1024;
want(!R.heap1 || growKB < 1024, `heap: ${growKB.toFixed(0)} KB more after a second stress second (bound 1024 KB)`);
want(R.bare.pixels === R.empty.pixels, `zero cost: an empty registry draws the same pixels as none (${R.bare.pixels} / ${R.empty.pixels})`);
want(R.det1.hash === R.det2.hash, `determinism: two pages, one seed, the same shots: ${R.det1.hash} / ${R.det2.hash}`);
const errs = [...R.errors, ...R.bare.errors, ...R.empty.errors].filter((e) => !/AudioContext|autoplay/i.test(e));
want(errs.length === 0, `console: ${errs.slice(0, 3).join(' | ')}`);
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(R, null, 1));
if (process.argv.includes('--json')) console.log(JSON.stringify(R, null, 1));
console.log(`destruct demo: ${R.order.length} props broken in order (${R.order.slice(0, 6).join(' ')} ...), glass ${R.glassDebris} shards, lamps lit ${R.lit0} -> ${R.lit1} of ${R.lamps}, ` +
  `room level ${R.luma0.toFixed(1)} -> ${R.luma1.toFixed(1)}, tally $${R.tally.value} (${R.tally.count} broken, ${R.tally.casualties} casualty); ` +
  `frame idle ${R.idle.mean.toFixed(2)} ms (none ${R.bare.idle.mean.toFixed(2)}, empty ${R.empty.idle.mean.toFixed(2)}), stress ${R.stress.mean.toFixed(2)} ms p95 ${R.stress.p95.toFixed(1)} max ${R.stress.max.toFixed(1)} ` +
  `(debris <= ${R.maxDebris}/${R.cap}, marks <= ${R.maxMarks}/${R.decalCap}), heap ${R.heap1 ? (growKB >= 0 ? '+' : '') + growKB.toFixed(0) + ' KB' : 'n/a'}; empty registry pixels ${R.bare.pixels === R.empty.pixels ? 'identical' : 'DIFFER'}; ` +
  `determinism ${R.det1.hash === R.det2.hash ? 'ok' : 'DIFFERS'}` + (fails.length ? `\nFAIL (${fails.length})` : ': ok'));
for (const f of fails) console.log('  ' + f);
process.exit(fails.length ? 1 : 0);
