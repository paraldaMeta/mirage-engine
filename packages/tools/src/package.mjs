#!/usr/bin/env node
// Mirage code adapted from the author's own earlier package.mjs: one standalone HTML file per world (no server,
// no network). Vite builds the page with every asset inlined as a data: URL and no code splitting, workers are
// embedded as Blob URLs started as classic workers (a page opened from file:// cannot start a module worker
// from a Blob), and the bundle goes inline into the page.
//
// usage: mirage-package <example dir> [--out file.html] [--keep-three-decoders] [--no-gzip]
//
// The bundle is gzipped and carried as base64 in a data block; a small classic script unpacks it with DecompressionStream
// and runs it as a module script (about half the size of the plain file; every browser since 2023 has the stream).
// --no-gzip writes the plain inline module script.
//
// three's DRACOLoader and KTX2Loader name their default decoder files with new URL(..., import.meta.url) at module
// top level, so any page that can reach them (the editor runtime's model import does, lazily) would carry ~2 MB of
// Draco and Basis decoders inlined. Mirage's createAssets always sets its own decoder paths, so those defaults are
// dropped here; --keep-three-decoders keeps them for a page that calls the loaders without setting a path.
import { build, parseAst } from 'vite';
import zlib from 'node:zlib';
import { embedWorkers, htmlSafe, scriptCloses } from './embed-workers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

let opts;
try {
  opts = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { out: { type: 'string' }, 'keep-three-decoders': { type: 'boolean' }, 'no-gzip': { type: 'boolean' } } });
  if (opts.positionals.length > 1) throw new Error(`one example folder, got ${opts.positionals.join(' ')}`);
} catch (e) { console.error(`[package] ${e.message}\nusage: mirage-package <example dir> [--out file.html]`); process.exit(2); }
const root = path.resolve(opts.positionals[0] || '.');
const outFile = path.resolve(opts.values.out ?? path.join(root, 'release', path.basename(root) + '.html'));
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-package-'));

const DEFAULT_DECODERS = /new URL\(\s*'\.\.\/libs\/(?:draco|basis)\/[^']+',\s*import\.meta\.url\s*\)\.toString\(\)/g;
const dropThreeDecoders = {
  name: 'mirage-drop-three-default-decoders',
  transform(code, id) {
    if (!/three\/examples\/jsm\/loaders\/(DRACOLoader|KTX2Loader)\.js$/.test(id.split('?')[0])) return null;
    const out = code.replace(DEFAULT_DECODERS, "''");
    return out === code ? null : { code: out, map: null };
  },
};

const t0 = Date.now();
await build({
  root, logLevel: 'warn', configFile: false, plugins: opts.values['keep-three-decoders'] ? [] : [dropThreeDecoders],
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

// workers: every other .js asset the bundle names becomes a Blob URL made from its source, started classic. The
// rewrite is done on the syntax tree and refuses what it cannot do safely (embed-workers.mjs).
const others = files.filter((f) => f !== mainName);
const workers = others.filter((f) => f.endsWith('.js') && js.includes(f));
const done = embedWorkers(js, workers.map((f) => ({ name: f, src: fs.readFileSync(path.join(assets, f), 'utf8') })), parseAst, { otherFiles: others.filter((f) => !workers.includes(f)) });
js = done.js;
const pre = done.pre;
for (const w of done.embedded) console.log(`[package] worker ${w.name} (${(w.bytes / 1024).toFixed(0)} KB) embedded, ${w.references} reference${w.references === 1 ? '' : 's'}`);
const leftovers = files.filter((f) => f !== mainName && !workers.includes(f) && js.includes(f));
if (leftovers.length) throw new Error('unresolved asset references (not inlined): ' + leftovers.join(', '));

// what index.html itself links: a stylesheet goes inline as <style>; any other built file it points at would be
// missing from the single file, so that is an error too (it used to pass with a dangling <link>)
let page = html0.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="[^"]*?assets\/([^"]+\.css)"[^>]*>/g, (_, f) =>
  `<style>\n${fs.readFileSync(path.join(assets, f), 'utf8').replace(/<\/style/gi, '<\\/style')}\n</style>`);
const dangling = [...page.matchAll(/(?:src|href)="(?:\.?\/)?(assets\/[^"]+)"/g)].map((m) => m[1]).filter((f) => !f.endsWith(mainName));
if (dangling.length) throw new Error('index.html references files that cannot be inlined: ' + dangling.join(', '));
const body = pre + htmlSafe(js, parseAst);
if (!scriptCloses(body)) throw new Error('the bundle holds `<!--` and `<script` in code the packager cannot escape: the inlined script would never close');
const GUNZIP = "(async()=>{try{const b=atob(document.getElementById('z').textContent.trim()),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);"
  + "const t=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text(),s=document.createElement('script');s.type='module';s.textContent=t;document.head.append(s)}"
  + "catch(e){document.body.textContent='This browser cannot unpack the page ('+e+'). Use a current Chrome, Edge, Firefox or Safari.'}})()";
// base64 holds no `<`, so the data block cannot close early; the unpacker is a classic script and runs where the module did
const script = opts.values['no-gzip'] ? `<script type="module">\n${body}\n</script>`
  : `<script type="application/octet-stream" id="z">${zlib.gzipSync(body, { level: 9 }).toString('base64')}</script>\n<script>${GUNZIP}</script>`;
const html = page.replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => script).replace(/<link rel="modulepreload"[^>]*>/g, '');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
fs.rmSync(DIST, { recursive: true, force: true });
const kb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
const dataUris = (html.match(/data:[a-z/+-]+;base64,[A-Za-z0-9+/=]+/g) || []).reduce((s, d) => s + d.length, 0);
console.log(`[package] ${path.relative(process.cwd(), outFile)}  ${kb(html.length)} (inlined assets ${kb(dataUris)}, code ${kb(html.length - dataUris)})  in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
