// Measure: what each surface costs per pixel, procedural against baked, and what a bake costs (the numbers in
// docs/surfaces.md). A wall 1.5 m away fills a 1440 x 900 target; FRAMES draws back to back end with a one-pixel
// readback (the GPU has finished them): wall time / FRAMES. Phases interleave round by round; the median is printed.
// base = a plain MeshStandardMaterial on the same quad; "+proc" / "+baked" are the surface's cost above it.
// Bakes: the first of a kind (compiles its program) and a repeat (same kind, other numbers), each synced by a
// readback; memory = the texture set with its mips.
// node examples/demos/materials/bench.mjs [--rounds 5] [--frames 30] [--only concrete,asphalt] [--no-package]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../packages/tools/src/chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const html = path.join(here, 'out/materials.html');
if (!process.argv.includes('--no-package')) execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', html], { stdio: ['ignore', 'ignore', 'inherit'] });
const ROUNDS = +arg('rounds', 5), FRAMES = +arg('frames', 30);
const b = await launch({ w: 640, h: 400 });
const page = await b.newPage();
await page.goto(pathToFileURL(html) + '?ui=0&w=640&h=400&spp=1');
await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
const gpu = await page.evaluate(() => { const gl = window.__mirage.world.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
const kinds = await page.evaluate(() => Object.entries(window.__mirage.SURFACE_KINDS).filter(([, K]) => !K.live).map(([k]) => k));
const only = arg('only', '');
const list = only ? kinds.filter((k) => only.split(',').includes(k)) : kinds;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const rows = [];
for (const k of list) {
  const r = { base: [], proc: [], baked: [] };
  for (let i = 0; i < ROUNDS; i++) {
    r.base.push(await page.evaluate((o) => window.__mirage.bench(o), { frames: FRAMES }));
    r.proc.push(await page.evaluate((o) => window.__mirage.bench(o), { s: k, mode: 'procedural', frames: FRAMES }));
    r.baked.push(await page.evaluate((o) => window.__mirage.bench(o), { s: k, mode: 'baked', frames: FRAMES }));
  }
  const bake = await page.evaluate((kind) => {
    const { SURFACES, bakeSurface, world } = window.__mirage, R = world.renderer, gl = R.getContext(), px = new Uint8Array(4);
    const one = (seed) => {
      const t0 = performance.now();
      const s = bakeSurface(R, SURFACES[kind]({ seed }), {});
      R.setRenderTarget(s.target); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); R.setRenderTarget(null);
      const ms = performance.now() - t0; s.target.dispose(); return { ms, size: s.size, bytes: s.bytes };
    };
    const a = one(101), c = one(102), d = one(103);
    return { first: a.ms, repeat: Math.min(c.ms, d.ms), size: a.size, mb: a.bytes / 1048576 };
  }, k);
  const base = med(r.base), proc = med(r.proc), baked = med(r.baked);
  const row = { kind: k, base: +base.toFixed(2), proc: +proc.toFixed(2), baked: +baked.toFixed(2), procAbove: +(proc - base).toFixed(2), bakedAbove: +(baked - base).toFixed(2),
    ratio: +((proc - base) / Math.max(baked - base, 0.01)).toFixed(1), bakeFirstMs: +bake.first.toFixed(1), bakeRepeatMs: +bake.repeat.toFixed(1), size: bake.size, mb: +bake.mb.toFixed(1) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
await b.close();
const md = ['| kind | base ms | procedural ms (+) | baked ms (+) | proc / baked (above base) | bake first / repeat ms | set px | MB |', '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.kind} | ${r.base} | ${r.proc} (+${r.procAbove}) | ${r.baked} (+${r.bakedAbove}) | ${r.ratio}x | ${r.bakeFirstMs} / ${r.bakeRepeatMs} | ${r.size} | ${r.mb} |`)].join('\n');
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/bench.md'), `GPU: ${gpu}\n1440 x 900, ${FRAMES} frames x ${ROUNDS} rounds, median\n\n${md}\n`);
console.log(`\nGPU: ${gpu}\n${md}`);
