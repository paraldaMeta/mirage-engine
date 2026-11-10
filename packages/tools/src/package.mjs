#!/usr/bin/env node
// Mirage code adapted from the author's own earlier package.mjs: one standalone HTML file per world (no server,
// no network). Vite builds the page with every asset inlined as a data: URL and no code splitting, workers are
// embedded as Blob URLs started as classic workers (a page opened from file:// cannot start a module worker
// from a Blob), and the bundle goes inline into the page.
//
// usage: mirage-package <example dir> [--out file.html]
import { build } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

let opts;
try {
  opts = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { out: { type: 'string' } } });
  if (opts.positionals.length > 1) throw new Error(`one example folder, got ${opts.positionals.join(' ')}`);
} catch (e) { console.error(`[package] ${e.message}\nusage: mirage-package <example dir> [--out file.html]`); process.exit(2); }
const root = path.resolve(opts.positionals[0] || '.');
const outFile = path.resolve(opts.values.out ?? path.join(root, 'release', path.basename(root) + '.html'));
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-package-'));

const t0 = Date.now();
await build({
  root, logLevel: 'warn', configFile: false,
  build: {
    outDir: DIST, emptyOutDir: true, target: 'es2022', modulePreload: false, assetsInlineLimit: () => true, minify: true,
    rolldownOptions: { output: { codeSplitting: false } }, chunkSizeWarningLimit: 1e5,
  },
  worker: { format: 'es', rolldownOptions: { output: { codeSplitting: false } } },
});

const html0 = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const assets = path.join(DIST, 'assets');
const files = fs.existsSync(assets) ? fs.readdirSync(assets) : [];
const mainName = (html0.match(/src="[^"]*assets\/([^"]+\.js)"/) || [])[1];
if (!mainName) throw new Error('main bundle not found in the built index.html');
let js = fs.readFileSync(path.join(assets, mainName), 'utf8');

// workers: every other .js asset the bundle references becomes a Blob URL made from its source, started classic
const workers = files.filter((f) => f.endsWith('.js') && f !== mainName && js.includes(f));
let pre = '';
workers.forEach((f, i) => {
  const src = fs.readFileSync(path.join(assets, f), 'utf8');
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`worker ${f} has imports/exports; it cannot run as a classic worker`);
  const v = `__W${i}`, esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  pre += `const ${v}=URL.createObjectURL(new Blob([${JSON.stringify(src)}],{type:"text/javascript"}));\n`;
  const before = js;
  js = js.replace(new RegExp(`new URL\\(\\s*(?:"[^"]*?|'[^']*?|\`[^\`]*?)${esc}(?:"|'|\`)\\s*,\\s*(?:import\\.meta\\.url|self\\.location(?:\\.href)?|location\\.href)\\s*\\)`, 'g'), v);
  js = js.replace(new RegExp(`(["'\`])[^"'\`]*?${esc}\\1`, 'g'), v);
  if (js === before) throw new Error(`could not rewrite the reference to worker ${f}`);
  js = js.replace(new RegExp(`new Worker\\(\\s*(?:new URL\\(\\s*${v}\\s*,[^()]*\\)|${v})\\s*,\\s*\\{\\s*type\\s*:\\s*[\`"']module[\`"']\\s*\\}\\s*\\)`, 'g'), `new Worker(${v})`);
  console.log(`[package] worker ${f} (${(src.length / 1024).toFixed(0)} KB) embedded`);
});
const leftovers = files.filter((f) => f !== mainName && !workers.includes(f) && js.includes(f));
if (leftovers.length) throw new Error('unresolved asset references (not inlined): ' + leftovers.join(', '));

// what index.html itself links: a stylesheet goes inline as <style>; any other built file it points at would be
// missing from the single file, so that is an error too (it used to pass with a dangling <link>)
let page = html0.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="[^"]*?assets\/([^"]+\.css)"[^>]*>/g, (_, f) =>
  `<style>\n${fs.readFileSync(path.join(assets, f), 'utf8').replace(/<\/style/gi, '<\\/style')}\n</style>`);
const dangling = [...page.matchAll(/(?:src|href)="(?:\.?\/)?(assets\/[^"]+)"/g)].map((m) => m[1]).filter((f) => !f.endsWith(mainName));
if (dangling.length) throw new Error('index.html references files that cannot be inlined: ' + dangling.join(', '));
const script = `<script type="module">\n${pre}${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
const html = page.replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => script).replace(/<link rel="modulepreload"[^>]*>/g, '');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
fs.rmSync(DIST, { recursive: true, force: true });
const kb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
const dataUris = (html.match(/data:[a-z/+-]+;base64,[A-Za-z0-9+/=]+/g) || []).reduce((s, d) => s + d.length, 0);
console.log(`[package] ${path.relative(process.cwd(), outFile)}  ${kb(html.length)} (inlined assets ${kb(dataUris)}, code ${kb(html.length - dataUris)})  in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
