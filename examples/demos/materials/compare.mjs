// Calibration (local only): a surface recipe against a photographed texture set it is meant to reproduce. The photo
// sets are read from a folder you name (never copied into this repository); everything this writes goes to the
// gitignored out/compare/: a sheet per pair (flat tiles side by side: albedo and normal; then both sets on the gallery
// objects under the same light, far and near) and the numbers (albedo mean / sd per channel, luminance histogram,
// power by octave of luminance and of height, normal slope distribution, roughness).
// node examples/demos/materials/compare.mjs --ref <folder with <set>_c.webp, <set>_n.webp, manifest.json> [--only brick] [--no-package]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../packages/tools/src/chrome.mjs';
import { sheetInPage } from '../../../packages/tools/src/sheet.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const refDir = arg('ref');
if (!refDir) { console.error('usage: compare.mjs --ref <folder of photo sets with manifest.json>'); process.exit(2); }
const html = path.join(here, 'out/materials.html'), outDir = path.join(here, 'out/compare');
if (!process.argv.includes('--no-package')) execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', html], { stdio: ['ignore', 'ignore', 'inherit'] });
fs.mkdirSync(outDir, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(refDir, 'manifest.json'), 'utf8')).materials;

// reference set -> the recipe meant to reproduce it (its numbers tuned against it)
export const PAIRS = [
  { ref: 'plaster_smooth', s: 'render:smooth', opts: { color: [0.13, 0.1, 0.068], roughness: 0.6, cracks: 0.15 } },
  { ref: 'plaster_broken', s: 'render:roughcast', opts: { color: [0.33, 0.22, 0.105], roughness: 0.85, patches: 0.3 } },
  { ref: 'brick_buff', s: 'brick:common', opts: { color: [0.5, 0.27, 0.12], roughness: 0.7, mortarColor: [0.46, 0.36, 0.24], brick: [0.2, 0.11], mortar: 0.022, recess: 0.01, age: 1, burnt: 0.05 } },
  { ref: 'paving_hex', s: 'paving:slabs', opts: { color: [0.42, 0.34, 0.24], roughness: 0.87, cell: [0.4, 0.4] } },
  { ref: 'flagstone', s: 'paving:setts', opts: { color: [0.13, 0.09, 0.062], roughness: 0.83, cell: [0.45, 0.3] } },
  { ref: 'wood_old', s: 'wood:weathered', opts: { color: [0.11, 0.082, 0.056] } },
  { ref: 'wood_teak', s: 'wood:varnished', opts: { color: [0.09, 0.03, 0.008], roughness: 0.7 } },
  { ref: 'iron_rusty', s: 'paintedMetal:sheet', opts: { color: [0.62, 0.62, 0.6], roughness: 0.5, chips: 0.5, rust: 0.8, streaks: 1 } },
  { ref: 'canvas', s: 'fabric:canvas', opts: { color: [0.56, 0.555, 0.545], roughness: 0.55, thread: 0.0022 } },
  { ref: 'gravel', s: 'roofing:gravel', opts: {} },
  { ref: 'terracotta', s: 'tile:floor', opts: { color: [0.2, 0.115, 0.047], altColor: [0.19, 0.11, 0.045], roughness: 0.69, cell: [0.3, 0.3] } },
];

// ---- numbers -------------------------------------------------------------------------------------------------------
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function fft1(re, im) {   // in place, radix 2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k), u = i + k, v = u + len / 2;
      const tr = re[v] * c - im[v] * s, ti = re[v] * s + im[v] * c;
      re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
    }
  }
}
/** power by octave (radial bands 1-2, 2-4 ... cycles per tile) of a w x w field (w a power of 2), normalised */
function octaves(field, w) {
  const N = 256, k = w / N, g = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += field[(y * k + j) * w + x * k + i]; g[y * N + x] = s / (k * k); }
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  const re = Array.from({ length: N }, (_, y) => Array.from(g.subarray(y * N, y * N + N), (v) => v - mean)), im = re.map(() => new Array(N).fill(0));
  for (let y = 0; y < N; y++) fft1(re[y], im[y]);
  for (let x = 0; x < N; x++) { const cr = re.map((r) => r[x]), ci = im.map((r) => r[x]); fft1(cr, ci); for (let y = 0; y < N; y++) { re[y][x] = cr[y]; im[y][x] = ci[y]; } }
  const bands = new Array(7).fill(0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = x < N / 2 ? x : x - N, fy = y < N / 2 ? y : y - N, r = Math.hypot(fx, fy);
    if (r < 1) continue;
    const b = Math.min(6, Math.floor(Math.log2(r)));
    bands[b] += re[y][x] ** 2 + im[y][x] ** 2;
  }
  const tot = bands.reduce((a, b) => a + b, 0) || 1;
  return bands.map((v) => +(v / tot).toFixed(3));
}
function stats({ w, c, n }, roughOverride = null) {
  const L = new Float64Array(w * w), Hh = new Float64Array(w * w), mean = [0, 0, 0], sq = [0, 0, 0], hist = new Array(16).fill(0), slopes = [];
  let rs = 0, rs2 = 0;
  for (let i = 0; i < w * w; i++) {
    const r = toLin(c[4 * i]), g = toLin(c[4 * i + 1]), b = toLin(c[4 * i + 2]);
    [r, g, b].forEach((v, k) => { mean[k] += v; sq[k] += v * v; });
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; L[i] = l;
    hist[Math.min(15, Math.floor(Math.sqrt(l) * 16))]++;
    Hh[i] = n[4 * i + 2] / 255;
    const nx = n[4 * i] / 127.5 - 1, ny = n[4 * i + 1] / 127.5 - 1; if (i % 7 === 0) slopes.push(Math.hypot(nx, ny));
    const ro = c[4 * i + 3] / 255; rs += ro; rs2 += ro * ro;
  }
  const N = w * w, m = mean.map((v) => v / N), sd = sq.map((v, k) => Math.sqrt(Math.max(v / N - m[k] ** 2, 0)));
  slopes.sort((a, b) => a - b);
  const rm = rs / N, rsd = Math.sqrt(Math.max(rs2 / N - rm * rm, 0));
  return {
    mean: m.map((v) => +v.toFixed(4)), sd: sd.map((v) => +v.toFixed(4)), histSqrtLum: hist.map((v) => +(v / N).toFixed(3)),
    lumOctaves: octaves(L, w), heightOctaves: octaves(Hh, w), slope: { mean: +(slopes.reduce((a, b) => a + b, 0) / slopes.length).toFixed(3), p50: +slopes[slopes.length >> 1].toFixed(3), p90: +slopes[Math.floor(slopes.length * 0.9)].toFixed(3) },
    rough: roughOverride || { mean: +rm.toFixed(3), sd: +rsd.toFixed(3) },
  };
}
const dist = (a, b) => +Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)).toFixed(3);

// ---- the page ------------------------------------------------------------------------------------------------------
const W = 800, H = 500;
const b = await launch({ w: W, h: H });
const page = await b.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
await page.goto(pathToFileURL(html) + `?ui=0&w=${W}&h=${H}&spp=6`);
await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
const only = arg('only', '');
const report = {};
for (const p of PAIRS.filter((x) => !only || only.split(',').some((o) => x.ref === o || x.s.startsWith(o)))) {
  const M = manifest[p.ref];
  if (!M) { console.error('no reference set', p.ref); continue; }
  const dataUrl = (f) => 'data:image/webp;base64,' + fs.readFileSync(path.join(refDir, f)).toString('base64');
  const rc = dataUrl(`${p.ref}_c.webp`), rn = dataUrl(`${p.ref}_n.webp`);
  // the reference decoded in the page (an untainted canvas: data URLs)
  const ref = await page.evaluate(async (c, n) => {
    const read = async (u) => { const img = new Image(); img.src = u; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return { w: cv.width, d: Array.from(g.getImageData(0, 0, cv.width, cv.height, { colorSpace: 'srgb' }).data) }; };
    const C = await read(c), N = await read(n);
    return { w: C.w, c: C.d, n: N.d };
  }, rc, rn);
  const size = ref.w;
  const opts = { tile: M.scale, ...p.opts };
  const mine = await page.evaluate((s, o, sz) => window.__mirage.readTile(s, o, sz), p.s, opts, size);
  // my tile as images (flipped to image rows) for the sheet
  const tileUrls = await page.evaluate(({ w, c, n }) => {
    const img = (d, alpha) => { const cv = document.createElement('canvas'); cv.width = cv.height = w; const g = cv.getContext('2d'); const id = g.createImageData(w, w);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const s = 4 * ((w - 1 - y) * w + x), t = 4 * (y * w + x); id.data[t] = d[s]; id.data[t + 1] = d[s + 1]; id.data[t + 2] = alpha ? 255 : d[s + 2]; id.data[t + 3] = 255; }
      if (!alpha) for (let i = 0; i < id.data.length; i += 4) id.data[i + 2] = d[(4 * ((w - 1 - Math.floor(i / 4 / w)) * w + (i / 4) % w)) + 2];
      g.putImageData(id, 0, 0); return cv.toDataURL('image/png'); };
    return { c: img(c, false), n: img(n, true) };
  }, mine);
  const sR = stats(ref, { mean: M.rough, sd: M.roughSd }), sM = stats(mine);
  const cmp = { albedoMeanDist: dist(sR.mean, sM.mean), albedoSdDist: dist(sR.sd, sM.sd), histDist: dist(sR.histSqrtLum, sM.histSqrtLum), lumOctDist: dist(sR.lumOctaves, sM.lumOctaves), hOctDist: dist(sR.heightOctaves, sM.heightOctaves), slopeP50: [sR.slope.p50, sM.slope.p50], rough: [sR.rough.mean, sM.rough.mean] };
  report[p.ref] = { recipe: p.s, opts, tileM: M.scale, px: size, ref: sR, mine: sM, cmp, bakeMs: +mine.ms.toFixed(1) };
  console.log(p.ref.padEnd(16), p.s.padEnd(20), JSON.stringify(cmp));
  // lit: both sets on the gallery objects
  const lit = [];
  for (const view of ['far', 'near', 'wall']) {
    await page.evaluate((o) => window.__mirage.showRef(o), { c: rc, n: rn, tile: M.scale, mean: M.mean, hMean: M.hMean, rough: M.rough, roughSlope: M.roughSlope, light: 'golden', view });
    lit.push({ label: `photo ${view}`, data: await page.evaluate(() => window.__mirage.still()) });
    await page.evaluate((o) => window.__mirage.show(o), { s: p.s, opts, light: 'golden', view });
    lit.push({ label: `recipe ${view}`, data: await page.evaluate(() => window.__mirage.still()) });
  }
  const flat = [{ label: 'photo albedo', data: rc }, { label: 'recipe albedo', data: tileUrls.c }, { label: 'photo normal', data: rn }, { label: 'recipe normal', data: tileUrls.n }];
  const sheet1 = await page.evaluate(sheetInPage, flat, { cols: 4, tw: 400, title: `${p.ref} (photo, ${M.scale} m) vs ${p.s} — albedo dist ${cmp.albedoMeanDist}, lum octaves dist ${cmp.lumOctDist}` });
  const sheet2 = await page.evaluate(sheetInPage, lit, { cols: 2, tw: 520, title: `${p.ref}: photo set (left) vs recipe (right), golden hour` });
  fs.writeFileSync(path.join(outDir, `${p.ref}-tiles.png`), Buffer.from(sheet1.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(outDir, `${p.ref}-lit.png`), Buffer.from(sheet2.split(',')[1], 'base64'));
}
fs.writeFileSync(path.join(outDir, 'numbers.json'), JSON.stringify(report, null, 1));
await b.close();
if (errors.length) { console.error([...new Set(errors)].slice(0, 8).join('\n')); process.exitCode = 1; }
