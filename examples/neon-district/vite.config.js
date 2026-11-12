import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { rapierWasm } from '../../packages/tools/src/vite-rapier.mjs';

// The installable web app, for the hosted build only (`vite build`; not the dev server, and not the single-file
// package, which builds without this config): the manifest and icon links go into index.html, and dist/sw.js gets
// the list of every built file and a version from their contents (public/sw.js is the source).
const HEAD = `<link rel="icon" href="./icon.svg" type="image/svg+xml"><link rel="icon" href="./favicon.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="./apple-touch-icon.png"><link rel="manifest" href="./manifest.webmanifest">
  <meta name="theme-color" content="#060a1c"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`;
const pwa = () => {
  let out;
  return {
    name: 'neon-district-pwa', apply: 'build',
    configResolved(c) { out = c.build.outDir; },
    transformIndexHtml: (html) => html.replace('<link rel="icon" href="data:,">', HEAD),
    closeBundle() {
      const files = [], hash = crypto.createHash('sha256');
      const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, f.name), rel = path.relative(out, p).split(path.sep).join('/');
        if (f.isDirectory()) walk(p);
        else if (rel !== 'sw.js') { files.push('./' + rel); hash.update(rel).update(fs.readFileSync(p)); }
      } };
      walk(out);
      const sw = path.join(out, 'sw.js');
      const src = fs.readFileSync(sw, 'utf8').replace("const VERSION = 'dev';", `const VERSION = '${hash.digest('hex').slice(0, 12)}';`)
        .replace('const FILES = [];', `const FILES = ${JSON.stringify(['./', ...files])};`);
      if (!/FILES = \["/.test(src)) throw new Error('neon-district-pwa: the FILES line of public/sw.js was not found');
      fs.writeFileSync(sw, src);
    },
  };
};
export default defineConfig({ plugins: [rapierWasm(), pwa()], build: { target: 'es2022', chunkSizeWarningLimit: 2500 }, server: { hmr: false } });
