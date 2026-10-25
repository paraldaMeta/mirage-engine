#!/usr/bin/env node
// Mirage original code. Prepare a folder that any static host can serve as it is. Uploads nothing.
//
// usage: mirage-deploy <example dir> [--out deploy/<name>] [--multi]
//   default: the single-file build (package.mjs) as index.html; --multi: Vite's normal dist/ (hashed assets,
//   cacheable separately). Adds .nojekyll (GitHub Pages) and _headers (Netlify / Cloudflare Pages caching), checks
//   the folder, lists its files and prints how to publish it — the publishing step is yours.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
const name = path.basename(root);
const out = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join('deploy', name));
const here = path.dirname(fileURLToPath(import.meta.url));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
if (args.includes('--multi')) {
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: root, stdio: 'inherit' });
} else {
  execFileSync(process.execPath, [path.join(here, 'package.mjs'), root, '--out', path.join(out, 'index.html')], { stdio: 'inherit' });
}
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, '_headers'), '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/index.html\n  Cache-Control: no-cache\n');
// check: an index.html, and nothing it references that is missing
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const missing = [...html.matchAll(/(?:src|href)="\.?\/?([^"#?:]+)"/g)].map((m) => m[1]).filter((f) => f && !fs.existsSync(path.join(out, f)));
if (missing.length) { console.error('[deploy] missing files referenced by index.html:', missing); process.exit(1); }
const list = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else list.push([path.relative(out, p), fs.statSync(p).size]); } };
walk(out);
const total = list.reduce((s, [, n]) => s + n, 0);
console.log(`\n[deploy] ${out}  (${list.length} files, ${(total / 1024 / 1024).toFixed(2)} MB)`);
for (const [f, n] of list) console.log(`  ${f.padEnd(36)} ${(n / 1024).toFixed(0).padStart(7)} KB`);
console.log(`
Nothing was uploaded. To publish this folder (you run these, with your own accounts):
  try it locally      npx serve "${out}"                  (or: python3 -m http.server -d "${out}")
  GitHub Pages        push the folder's contents to a branch / docs/ folder and enable Pages for it
  Netlify             drag the folder onto https://app.netlify.com/drop   (or: npx netlify deploy --dir "${out}")
  Cloudflare Pages    npx wrangler pages deploy "${out}"
  any web server      copy the files as they are; index.html is the entry, no rewrites needed
The single-file build also works opened straight from disk (file://).`);
