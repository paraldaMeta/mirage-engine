// Mirage original code. Node checks of the verification helpers (no browser): PNG round trip, region SSIM, pixel
// diffs, the playtest vocabulary, the Chrome capture flags. Part of `npm test -w @miragekit/tools`.
import assert from '../../scripts/soft-assert.mjs';
import puppeteer from 'puppeteer-core';
import { encodePNG, decodePNG, regionSSIM, ssimVerdict, pixelDiff, parseThresholds, boxed, sideBySide } from './src/imgcmp.mjs';
import { unknownFields } from './src/scenario-fields.mjs';
import { launchArgs, CAPTURE_ARGS } from './src/chrome.mjs';

// ---- imgcmp: PNG round trip, region SSIM finds the cell that changed, bit-identical diff, thresholds
const w = 64, h = 48, img = { w, h, data: new Uint8Array(w * h * 4) };
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (x * 7 + y * 13 + ((x * y) % 17) * 5) & 255; img.data.set([v, 255 - v, (v * 3) & 255, 255], 4 * (y * w + x)); }
const back = decodePNG(encodePNG(img));
assert.equal(back.w, w); assert.equal(back.h, h);
assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data), 'PNG round trip');
const same = regionSSIM(img, back);
assert.equal(same.mean, 1); assert.equal(same.cell, 1); assert.ok(ssimVerdict(same).pass);
// flatten the bottom-right cell: it must be the worst one, and the verdict must fail on it
const moved = { w, h, data: new Uint8Array(img.data) };
for (let y = 36; y < 48; y++) for (let x = 48; x < 64; x++) moved.data.set([128, 128, 128, 255], 4 * (y * w + x));
const s = regionSSIM(img, moved);
assert.equal(s.worst.i, 15); assert.deepEqual(s.worst.roi, [48, 36, 64, 48]);
assert.ok(s.cell < 0.75 && !ssimVerdict(s).pass && ssimVerdict(s).fails.some((f) => f.startsWith('worst cell')));
assert.ok(ssimVerdict(s, { cell: 0 , p05: 0, mean: 0 }).pass, 'thresholds can be lowered');
assert.deepEqual(pixelDiff(img, back), { same: true, differing: 0, max: 0, mean: 0 });
assert.equal(pixelDiff(img, moved).same, false);
assert.deepEqual(parseThresholds('0.9,,0.7'), { mean: 0.9, cell: 0.7 });
const bx = boxed(img, [0, 0, 10, 10]);
assert.deepEqual([...bx.data.slice(0, 4)], [255, 40, 40, 255]); assert.notEqual(bx.data, img.data);
assert.equal(sideBySide(img, img, 8).w, 2 * w + 8);
assert.throws(() => regionSSIM(img, { w: 2, h: 2, data: new Uint8Array(16) }), /sizes differ/);
console.log('imgcmp unit: ok');

// ---- the playtest vocabulary: unknown scenario fields are named
assert.deepEqual(unknownFields({ title: 't', steps: [{ name: 'a', walkTo: [[0, 0]], contrast: true, expect: { x: '> 1', 'flags.lit': '== true', 'see.rail': '> 0' } }] }), []);
assert.deepEqual(unknownFields({ titel: 't', steps: [{ lookat: 'key', expect: { nearr: '== key' } }] }), ['titel', 'steps[0].lookat', 'steps[0].expect.nearr']);
console.log('scenario fields unit: ok');

// ---- Chrome: puppeteer's defaults still carry the capture flags launch() relies on; launchArgs adds ours
const def = await puppeteer.defaultArgs({ headless: true });
for (const f of ['--force-color-profile=srgb', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']) assert.ok(def.includes(f), 'puppeteer default ' + f);
const a = launchArgs({ w: 375, h: 812, args: ['--x'] });
for (const f of CAPTURE_ARGS) assert.ok(a.includes(f));
assert.ok(a.includes('--window-size=375,812') && a.at(-1) === '--x');
console.log('chrome args unit: ok');

// ---- snap's command line: --adaptive before the target or with 0; the determinism redraw order
import { adaptiveOption, redrawOrder } from './src/snap-args.mjs';
assert.equal(adaptiveOption(['dist']), null);
assert.equal(adaptiveOption(['--adaptive', 'dist']), true, '--adaptive before the target is on, not NaN');
assert.equal(adaptiveOption(['dist', '--adaptive']), true);
assert.equal(adaptiveOption(['--adaptive', '0', 'dist']), 0, '--adaptive 0 is on');
assert.equal(adaptiveOption(['--adaptive', '0.5']), 0.5);
for (const n of [2, 3, 6, 9]) {
  const o = redrawOrder(n), before = [n - 1, ...o.slice(0, -1)];   // what was drawn right before each redraw
  assert.deepEqual([...o].sort((a, b) => a - b), [...Array(n).keys()], 'every view once');
  assert.ok(o.every((k, i) => before[i] !== k), `no view is redrawn right after itself (n ${n}: ${o})`);
}
assert.deepEqual(redrawOrder(1), [0]); assert.deepEqual(redrawOrder(0), []);
console.log('snap args unit: ok');

// ---- the lease pool, with a fake Chrome: a context per lease (closed on release), one browser per key, a
// disconnected browser leaves the pool, a failed launch does not remove a newer entry
import { lease, drain, poolSize } from './src/chrome.mjs';
{
  const made = [];
  const fake = () => { const b = { contexts: [], handlers: {}, closed: false, on(ev, fn) { b.handlers[ev] = fn; }, close: async () => { b.closed = true; }, version: () => 'fake',
    createBrowserContext: async () => { const c = { closed: false, newPage: async () => ({}), close: async () => { c.closed = true; } }; b.contexts.push(c); return c; } }; made.push(b); return b; };
  const a = await lease({ w: 10, h: 10 }, fake), b = await lease({ w: 10, h: 10 }, fake);
  assert.equal(made.length, 1, 'one browser per size and arguments'); assert.equal(a.browser, b.browser);
  assert.notEqual(a.context, b.context, 'a context per lease');
  await a.close(); assert.ok(a.context.closed && !b.context.closed);
  made[0].handlers.disconnected();   // Chrome crashed
  const c = await lease({ w: 10, h: 10 }, fake);
  assert.equal(made.length, 2, 'a crashed browser is not handed out again');
  await assert.rejects(lease({ w: 20, h: 20 }, () => { throw new Error('no chrome'); }), /no chrome/);
  const d = await lease({ w: 20, h: 20 }, fake);
  assert.equal(made.length, 3);
  await b.close(); await c.close(); await d.close(); await drain();
  assert.equal(poolSize(), 0);
  console.log('lease pool unit: ok');
}
