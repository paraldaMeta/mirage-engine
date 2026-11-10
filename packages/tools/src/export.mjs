#!/usr/bin/env node
// Mirage original code. Export a built world to GLB (and USDZ), with the procedural looks baked into textures.
//
// usage: mirage-export <dist dir | page.html> [--out world.glb] [--usdz world.usdz] [--bake 1024] [--density 64]
//        [--maps color,orm,normal] [--png] [--query "time=12:00"] [--verify dir] [--views all | 0,2] [--spp 4]
//        [--usdz-thin 1] [--w 960 --h 600] [--no-validate]
// --usdz-thin f: keep that share of each instanced mesh's instances in the USDZ (grass and leaves dominate its size)
// Opens the page in the local headless Chrome (like mirage-snap), injects the exporter (@mirage/core/export,
// bundled here with vite) and writes:
//   <out>.glb           glTF 2.0 binary; instanced vegetation stays instanced (EXT_mesh_gpu_instancing)
//   <usdz>              USDZ for Quick Look (instances merged, vertex colours baked)
//   <out>.export.json   what went in, what was baked (atlas size, texels/m), what was skipped and what was lost
// --verify dir: reloads the GLB with GLTFLoader in the same page, renders it from the plan's viewpoints through the
//   world's own renderer next to the live world, writes dir/vNN-<name>.png (live | GLB | difference) and
//   dir/verify.json (coverage IoU, normal agreement, colour difference); parses the USDZ with three's USDLoader.
// gltf-validator (a devDependency of @mirage/tools) checks the GLB unless --no-validate; it is skipped with a note
// when not installed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, serve, open } from './chrome.mjs';
import { zipOffsets } from '@mirage/core/export';

const args = process.argv.slice(2);
const BOOL = new Set(['--png', '--no-validate']);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !BOOL.has(args[i - 1])));
if (!target) {
  console.error('usage: mirage-export <dist dir | page.html> [--out world.glb] [--usdz world.usdz] [--bake 1024] [--density 64] [--maps color,orm,normal] [--query q] [--verify dir]');
  process.exit(2);
}
const W = +flag('w', 960), H = +flag('h', 600);
const OUT = path.resolve(flag('out', 'world.glb'));
const USDZ = flag('usdz') ? path.resolve(String(flag('usdz'))) : null;
const VERIFY = flag('verify') ? path.resolve(String(flag('verify'))) : null;
const opts = { bake: +flag('bake', 1024), density: +flag('density', 64), maps: String(flag('maps', 'color,orm,normal')).split(','), jpeg: !flag('png'), usdz: !!USDZ, usdzThin: +flag('usdz-thin', 1) };
for (const f of [OUT, USDZ]) if (f) fs.mkdirSync(path.dirname(f), { recursive: true });
if (VERIFY) fs.mkdirSync(VERIFY, { recursive: true });

/** the page half, bundled with its own three (same version as the examples') */
async function bundlePage() {
  const { build } = await import('vite');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const res = await build({
    configFile: false, logLevel: 'silent', root: here,
    build: { write: false, minify: true, lib: { entry: path.join(here, 'export-page.js'), formats: ['iife'], name: 'MirageExportPage', fileName: () => 'export-page.js' } },
  });
  const outputs = [].concat(res).flatMap((r) => r.output || []);
  const code = outputs.find((o) => o.type === 'chunk')?.code;
  if (!code) throw new Error('mirage-export: could not bundle the page exporter');
  return code;
}

async function fetchFile(page, name, bytes) {
  const parts = [], step = 6 * 1024 * 1024;
  for (let s = 0; s < bytes; s += step) parts.push(Buffer.from(await page.evaluate((n, a, b) => window.__mirageExport.chunk(n, a, b), name, s, s + step), 'base64'));
  return Buffer.concat(parts);
}

async function validate(file) {
  let v;
  try { v = await import('gltf-validator'); } catch { return { skipped: 'gltf-validator is not installed (npm i -D gltf-validator)' }; }
  const r = await (v.default || v).validateBytes(new Uint8Array(fs.readFileSync(file)), { maxIssues: 500 });
  const { numErrors, numWarnings, numInfos, numHints, messages } = r.issues, codes = {};
  for (const m of messages) if (m.severity <= 1) codes[`${m.severity ? 'warning' : 'error'} ${m.code}`] = (codes[`${m.severity ? 'warning' : 'error'} ${m.code}`] || 0) + 1;
  return { validatorVersion: r.validatorVersion, numErrors, numWarnings, numInfos, numHints, codes,
    messages: messages.filter((m) => m.severity <= 1).slice(0, 20).map((m) => `${m.severity ? 'warning' : 'error'} ${m.code}: ${m.message} ${m.pointer || ''}`) };
}

const kb = (n) => (n / 1024 > 1024 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB');

async function main() {
  const code = await bundlePage();
  const isFile = target.endsWith('.html');
  const srv = isFile ? null : await serve(target);
  const url = (isFile ? pathToFileURL(path.resolve(target)).href : srv.url) + `?mode=walk&ui=0&hud=0&w=${W}&h=${H}` + (flag('query') ? '&' + flag('query') : '');
  const browser = await launch({ w: W, h: H });
  const result = { url, options: opts, files: {} };
  try {
    const { page, errors, loadMs } = await open(browser, url);
    result.loadMs = loadMs;
    await page.addScriptTag({ content: code });
    const t0 = Date.now();
    const tick = setInterval(async () => { try { process.stdout.write(`\r  ${await page.evaluate(() => window.__mirageExport.progress())}`.padEnd(90).slice(0, 90)); } catch { /* page busy */ } }, 1500);
    let run;
    try { run = await page.evaluate((o) => window.__mirageExport.run(o), opts); } finally { clearInterval(tick); process.stdout.write('\r'.padEnd(91) + '\r'); }
    result.exportMs = Date.now() - t0;
    result.report = run.report;
    fs.writeFileSync(OUT, await fetchFile(page, 'glb', run.glbBytes));
    result.files.glb = { path: OUT, bytes: run.glbBytes };
    if (USDZ) {
      const u = await fetchFile(page, 'usdz', run.usdzBytes), offs = Object.values(zipOffsets(u));
      fs.writeFileSync(USDZ, u);
      result.files.usdz = { path: USDZ, bytes: run.usdzBytes, files: offs.length, aligned64: offs.length > 0 && offs.every((o) => o % 64 === 0) };
    }
    result.reload = await page.evaluate(() => window.__mirageExport.reload());
    if (USDZ) result.usdzParse = await page.evaluate(() => window.__mirageExport.usdCheck());
    if (VERIFY) {
      const rows = await page.evaluate((o) => window.__mirageExport.compare(o), { views: flag('views', 'all'), spp: +flag('spp', 4) });
      result.verify = rows.map(({ png, ...row }, k) => {
        const f = path.join(VERIFY, `v${String(k).padStart(2, '0')}-${row.name.replace(/\W+/g, '-')}.png`);
        fs.writeFileSync(f, Buffer.from(png.split(',')[1], 'base64'));
        return { ...row, file: f };
      });
    }
    result.errors = errors;
  } finally {
    await browser.close();
    if (srv) srv.close();
  }
  if (!flag('no-validate')) result.validator = await validate(OUT);
  const json = OUT.replace(/\.glb$/i, '') + '.export.json';
  fs.writeFileSync(json, JSON.stringify(result, null, 1));
  if (VERIFY) fs.writeFileSync(path.join(VERIFY, 'verify.json'), JSON.stringify({ verify: result.verify, reload: result.reload, usdzParse: result.usdzParse, validator: result.validator }, null, 1));
  const r = result.report, g = result.reload.glb;
  const baked = r.meshes.filter((m) => m.kind === 'glb' && m.passes.length);
  console.log(`export: ${OUT} ${kb(result.files.glb.bytes)}` + (USDZ ? `, ${USDZ} ${kb(result.files.usdz.bytes)}` : '') + ` in ${(result.exportMs / 1000).toFixed(1)} s (bake ${(r.bakeMs / 1000).toFixed(1)} s)`);
  console.log(`  GLB: ${g.meshes} meshes (${g.instanced} instanced, ${g.instances} instances), ${g.materials} materials, ${g.textures} textures, ${g.triangles} triangles; baked ${baked.length} meshes, ${r.textures} maps`);
  if (r.skipped.length) console.log(`  skipped: ${[...new Set(r.skipped.map((s) => s.why))].join(', ')} (${r.skipped.length})`);
  if (r.lost.length) console.log(`  not exportable, dropped: hooks ${r.lost.join(', ')}`);
  if (result.usdzParse) console.log(`  USDZ: ${result.files.usdz.files} files, 64-byte aligned: ${result.files.usdz.aligned64}; USDLoader: ${result.usdzParse.ok ? `${result.usdzParse.meshes} meshes, ${result.usdzParse.triangles} triangles` : 'FAILED ' + result.usdzParse.error}`);
  if (result.validator) console.log(`  gltf-validator: ${result.validator.skipped || `${result.validator.numErrors} errors, ${result.validator.numWarnings} warnings ${JSON.stringify(result.validator.codes)}`}`);
  for (const v of result.verify || []) console.log(`  ${v.name}: coverage IoU ${v.coverageIoU}, normals ${(v.normalAgree * 100).toFixed(1)}%, colour diff ${v.meanAbsDiff}/255` + (v.usdMeanAbsDiff != null ? ` (USDZ ${v.usdMeanAbsDiff})` : '') + ` -> ${v.file}`);
  if (result.errors.length) console.log(`  page errors: ${result.errors.length} (see ${json})`);
  console.log(`  report: ${json}`);
  if (result.validator?.numErrors || (result.usdzParse && !result.usdzParse.ok) || (USDZ && !result.files.usdz.aligned64)) process.exitCode = 1;
}

await main();
