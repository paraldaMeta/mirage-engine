// The surface gallery: every surface (or the ones named) on its test objects under three lightings, dry and wet, from
// 5 m and from 0.5 m, one contact sheet per surface in out/gallery/ (gitignored).
// node examples/demos/materials/shoot.mjs [--only concrete,asphalt:worn] [--lights studio,golden,night] [--views far,near,wall,ground]
//        [--wet 0,0.8] [--mode baked|procedural] [--w 960 --h 600] [--spp 8] [--no-package]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from '../../../packages/tools/src/chrome.mjs';
import { sheetInPage } from '../../../packages/tools/src/sheet.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const html = path.join(here, 'out/materials.html'), outDir = path.join(here, 'out/gallery');
if (!process.argv.includes('--no-package')) execFileSync('node', [path.join(root, 'packages/tools/src/package.mjs'), here, '--out', html], { stdio: ['ignore', 'ignore', 'inherit'] });
fs.mkdirSync(outDir, { recursive: true });
const W = +arg('w', 960), H = +arg('h', 600), SPP = +arg('spp', 8), MODE = arg('mode', 'baked');
const LIGHTS = arg('lights', 'studio,golden,night').split(','), VIEWS = arg('views', 'far,near,wall,ground').split(','), WETS = arg('wet', '0,0.8').split(',').map(Number);

const b = await launch({ w: W, h: H });
const page = await b.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || /error|warn/i.test(m.text())) errors.push(m.text().slice(0, 600)); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(html) + `?ui=0&w=${W}&h=${H}&spp=${SPP}&mode=${MODE}`);
await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
const all = await page.evaluate(() => Object.entries(window.__mirage.SURFACE_KINDS).flatMap(([k, K]) => K.variants.map((v) => `${k}:${v}`)));
const only = arg('only', '');
const list = only ? all.filter((s) => only.split(',').some((o) => s === o || s.split(':')[0] === o)) : all;
const ONE = process.argv.includes('--one-sheet'), oneItems = [];
for (const s of list) {
  const items = ONE ? oneItems : [];
  for (const light of LIGHTS) for (const wet of WETS) for (const view of VIEWS) {
    const data = await page.evaluate((o) => { window.__mirage.show(o); return window.__mirage.still(); }, { s, light, wet, view, mode: MODE });
    items.push({ label: ONE ? `${s} ${light[0]}${wet ? ' wet' : ''} ${view}` : `${light} ${wet ? 'wet' : 'dry'} ${view}`, data });
  }
  if (ONE) continue;
  const note = await page.evaluate((k) => { const K = window.__mirage.SURFACE_KINDS[k.split(':')[0]], v = k.split(':')[1]; const R = (K.refs.variants || {})[v] || K.refs; return `albedo ${R.albedo.join('-')}, roughness ${R.rough.join('-')}, metal ${R.metal}: ${R.note}`; }, s);
  const sheet = await page.evaluate(sheetInPage, items, { cols: VIEWS.length, tw: 480, title: `${s} (${MODE}) | ${note}` });
  const file = path.join(outDir, `${s.replace(':', '-')}.png`);
  fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log(file);
}
if (ONE) for (let i = 0; i < oneItems.length; i += 24) {
  const sheet = await page.evaluate(sheetInPage, oneItems.slice(i, i + 24), { cols: +arg('cols', 6), tw: +arg('tw', 300), title: `overview ${i / 24 + 1} (${MODE})` });
  const file = path.join(outDir, `overview-${arg('name', 'all')}-${i / 24 + 1}.png`);
  fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64')); console.log(file);
}
await b.close();
if (errors.length) { console.error(`${errors.length} console errors / warnings:\n` + [...new Set(errors)].slice(0, 12).join('\n---\n')); process.exitCode = 1; }
