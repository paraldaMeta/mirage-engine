#!/usr/bin/env node
// Mirage original code. One command from a world's folder to something a player can be given.
//
// usage: mirage-ship <example dir> --target <target> [--out ship/<name>-<target>] [options]
//   targets
//     web               the static build, with the caching rules (_headers, headers.json) and hosting notes
//     pwa               web + manifest, icons, a service worker (versioned precache, starts offline), install and update hooks
//     single            one HTML file (mirage-package)
//     desktop-electron  an Electron project around the build (main process, preload bridge, builder config, icons)
//     desktop-tauri     a Tauri 2 project around the build (Rust main, config, capabilities, icons)
//     ios | android     a Capacitor 8 project around the build (config, bridge, native settings, store assets)
//   options
//     --name "Garden Quest"   --id studio.example.gardenquest   --version 1.2.0   (defaults: the folder's package.json)
//     --icon icon.png         one square PNG, 1024 px or more (default: a placeholder; replace it before release)
//     --orientation landscape | portrait | any      --theme #101418   --background #000000
//     --dist <folder>         use this built folder instead of running Vite (it must use relative URLs: base './')
//     --isolated              web / pwa: add COOP + COEP headers (see HOSTING.txt before you do)
//     --json                  print the result as JSON (target, out, files, toolchain)
// It writes files and nothing else: no upload, no install, no download. The wrappers are project scaffolds; their
// own package.json names Electron / Tauri / Capacitor, and building them needs those toolchains on your machine
// (the tool says which ones it found). Signing is never done here. Consoles are not a target: docs/platforms.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkOut } from './safe-out.mjs';
import { decodePNG } from './imgcmp.mjs';
import { TARGETS, shipConfig, iconSet, defaultIcon, patchHtml, webFiles, pwaFiles, electronFiles, tauriFiles, capacitorFiles, sha256 } from './ship-gen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `usage: mirage-ship <example dir> --target ${TARGETS.join(' | ')} [--out dir] [--name s] [--id reverse.dns.id] [--version x.y.z] [--icon png] [--orientation landscape|portrait|any] [--theme #rrggbb] [--background #rrggbb] [--dist built-folder] [--isolated] [--json]`;

/** which wrapper toolchains this machine has (looked for, never installed) */
export function detectToolchains({ env = process.env, exists = fs.existsSync, platform = process.platform } = {}) {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const has = (bin) => dirs.some((d) => exts.some((e) => exists(path.join(d, bin + e))));
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return {
    electron: has('electron'), cargo: has('cargo') || exists(path.join(home, '.cargo', 'bin', 'cargo')), tauri: has('tauri') || has('cargo-tauri'),
    capacitor: has('cap'), xcodebuild: has('xcodebuild'), cocoapods: has('pod'), gradle: has('gradle'), java: has('java'),
    androidSdk: !!(env.ANDROID_HOME || env.ANDROID_SDK_ROOT) || exists(path.join(home, 'Library', 'Android', 'sdk')) || exists(path.join(home, 'Android', 'Sdk')),
  };
}
const NEEDS = {
  'desktop-electron': (t) => ({ ok: t.electron, need: 'electron (the scaffold\'s own `npm install` fetches it)' }),
  'desktop-tauri': (t) => ({ ok: t.cargo, need: 'Rust (cargo) and the Tauri CLI' }),
  ios: (t) => ({ ok: t.xcodebuild && t.capacitor, need: 'Xcode and the Capacitor CLI (`npm install` in the scaffold)' }),
  android: (t) => ({ ok: t.androidSdk && t.java && t.capacitor, need: 'the Android SDK, a JDK and the Capacitor CLI (`npm install` in the scaffold)' }),
};

function listFiles(dir) {
  const out = [];
  const walk = (d) => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else out.push(path.relative(dir, p).split(path.sep).join('/')); } };
  walk(dir);
  return out;
}

async function main() {
  let opts;
  try {
    opts = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
      target: { type: 'string' }, out: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' }, version: { type: 'string' }, icon: { type: 'string' },
      orientation: { type: 'string' }, theme: { type: 'string' }, background: { type: 'string' }, dist: { type: 'string' }, isolated: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean' },
    } });
    if (opts.values.help) { console.log(USAGE); return 0; }
    if (opts.positionals.length > 1) throw new Error(`one example folder, got ${opts.positionals.join(' ')}`);
    if (!TARGETS.includes(opts.values.target)) throw new Error(`--target: one of ${TARGETS.join(', ')}${opts.values.target ? `, got ${opts.values.target}` : ''}${/^(ps5|ps4|xbox|switch|console)/i.test(opts.values.target || '') ? ' (consoles need the platform holder\'s licensed SDK and a native renderer: not something this engine can target; docs/platforms.md)' : ''}`);
  } catch (e) { console.error(`[ship] ${e.message}\n${USAGE}`); return 2; }
  const v = opts.values, target = v.target, say = v.json ? () => {} : console.log;
  const root = path.resolve(opts.positionals[0] || '.');
  if (!fs.existsSync(path.join(root, 'index.html')) && !v.dist) { console.error(`[ship] ${root} has no index.html`); return 2; }
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { /* a folder without one */ }
  const folder = path.basename(root);
  let cfg;
  try {
    cfg = shipConfig({ name: v.name ?? folder.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), slug: folder, id: v.id, version: v.version ?? (/^\d+\.\d+\.\d+$/.test(pkg.version || '') ? pkg.version : undefined),
      orientation: v.orientation, theme: v.theme, background: v.background, description: pkg.description });
  } catch (e) { console.error('[ship] ' + e.message); return 2; }

  if (target === 'single') {   // the existing packager does this one
    const file = path.resolve(v.out ?? path.join('ship', `${folder}.html`));
    execFileSync(process.execPath, [path.join(here, 'package.mjs'), root, '--out', file], { stdio: v.json ? 'ignore' : 'inherit' });
    if (v.json) console.log(JSON.stringify({ target, out: file, files: [path.basename(file)] }));
    return 0;
  }

  let out;
  try { out = checkOut(v.out ?? path.join('ship', `${folder}-${target}`), { keep: [root, ...(v.dist ? [path.resolve(v.dist)] : [])], marker: '.mirage-ship' }); }
  catch (e) { console.error('[ship] ' + e.message); return 2; }

  // ---- the web build: relative URLs (base './'), because a wrapper serves it from its own origin and a PWA may
  // live in a sub-folder of a site
  let dist = v.dist ? path.resolve(v.dist) : null, tmp = null;
  if (!dist) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-ship-'));
    dist = path.join(tmp, 'dist');
    const vite = path.join(path.dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin/vite.js');
    execFileSync(process.execPath, [vite, 'build', '--base', './', '--outDir', dist, '--emptyOutDir', '--logLevel', 'warn'], { cwd: root, stdio: v.json ? 'ignore' : 'inherit' });
  }
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) { console.error(`[ship] ${dist} has no index.html`); return 1; }
  const html0 = fs.readFileSync(index, 'utf8');
  const absolute = [...html0.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1]);
  if (absolute.length) { console.error(`[ship] ${index} uses absolute URLs (${absolute.slice(0, 3).join(', ')}): build it with base './' (vite build --base ./), or leave out --dist and let this tool build`); return 1; }

  // ---- icons
  let icons, placeholder = false;
  try {
    let src;
    if (v.icon) { src = decodePNG(fs.readFileSync(path.resolve(v.icon))); if (src.w < 1024) console.error(`[ship] warning: the icon is ${src.w} px; stores ask for 1024 and the large sizes will look soft`); }
    else { src = defaultIcon(cfg); placeholder = true; }
    icons = iconSet(src, cfg);
  } catch (e) { console.error('[ship] icon: ' + e.message); return 2; }

  // ---- write
  fs.rmSync(out, { recursive: true, force: true });
  const wrapper = target !== 'web' && target !== 'pwa';
  const www = wrapper ? path.join(out, 'www') : out;
  fs.mkdirSync(www, { recursive: true });
  fs.cpSync(dist, www, { recursive: true });
  fs.writeFileSync(path.join(www, 'index.html'), patchHtml(html0, cfg, { target }));
  let files;
  if (target === 'web') files = webFiles(cfg, { isolated: v.isolated });
  else if (target === 'pwa') {
    const game = listFiles(www).map((p) => ({ path: p, hash: sha256(fs.readFileSync(path.join(www, p))) }));
    files = pwaFiles(cfg, { files: game, icons, isolated: v.isolated });
  } else if (target === 'desktop-electron') files = electronFiles(cfg, { icons });
  else if (target === 'desktop-tauri') files = tauriFiles(cfg, { icons });
  else files = capacitorFiles(cfg, { icons, platform: target });
  for (const [p, body] of files) { const f = path.join(out, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
  if (files.has('scripts/apply-native.mjs')) fs.chmodSync(path.join(out, 'scripts/apply-native.mjs'), 0o755);
  fs.writeFileSync(path.join(out, '.mirage-ship'), 'made by mirage-ship; it empties this folder on its next run\n');
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });

  const all = listFiles(out), size = all.reduce((s, p) => s + fs.statSync(path.join(out, p)).size, 0);
  const tools = detectToolchains(), need = NEEDS[target]?.(tools);
  if (v.json) { console.log(JSON.stringify({ target, out, config: cfg, files: all, bytes: size, placeholderIcon: placeholder, ...(files.version ? { swVersion: files.version } : {}), toolchain: need ? { ready: need.ok, need: need.need } : null })); return 0; }
  say(`\n[ship] ${target}: ${out}  (${all.length} files, ${(size / 1024 / 1024).toFixed(2)} MB)`);
  for (const [p] of files) say(`  ${p}`);
  say(`  ${wrapper ? 'www/' : './'}  the game (${listFiles(www).length} files)`);
  if (placeholder && target !== 'web') say('\n  The icon is a placeholder (a sun over a horizon). Pass --icon <1024 px PNG> before you release.');
  if (files.version) say(`  service worker version ${cfg.version}-${files.version}: a rebuild with any changed file gets a new one and updates installed copies`);
  if (need) say(`\n  This is a project scaffold; nothing was installed or built. To build it you need ${need.need}.\n  Found on this machine: ${need.ok ? 'yes' : 'no'}. Steps: ${path.join(out, 'README.md')}`);
  else say(`\n  Nothing was uploaded. Hosting notes: ${path.join(out, 'HOSTING.txt')}`);
  say('  Signing, store accounts and uploads are yours. Checklists: docs/platforms.md');
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
