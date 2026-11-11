// Mirage original code. The generators behind `mirage-ship` (ship.mjs): pure functions from a config and a built
// web folder's file list to the files of each target. No clock, no random, no network: the same input gives the
// same bytes (ship.check.mjs runs every generator twice and compares).
//
//   const cfg = shipConfig({ name: 'Garden Quest', id: 'studio.example.gardenquest', version: '1.2.0', orientation: 'landscape' });
//   const icons = iconSet(decodePNG(fs.readFileSync('icon.png')) /* or defaultIcon(cfg) */, cfg);
//   webFiles(cfg, { isolated })                    -> Map path -> string | Buffer    (_headers, headers.json, ...)
//   pwaFiles(cfg, { files: [{ path, hash }], icons }) -> manifest, sw.js, mirage-pwa.js, icons/*
//   electronFiles(cfg, { icons })  tauriFiles(cfg, { icons })  capacitorFiles(cfg, { icons, platform: 'ios' | 'android' })
//   patchHtml(html, cfg, { target })               -> index.html with the tags that target needs
// The game's own files (the Vite build) are copied by ship.mjs; nothing here reads the disk except the templates
// in ./ship/ (the service worker, the Electron main process, the Rust main, the bridges: real files, so they can
// be read, linted and syntax-checked as they are).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './imgcmp.mjs';

const TPL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ship');
const tpl = (name, vars = {}) => {
  let s = fs.readFileSync(path.join(TPL, name), 'utf8');
  for (const [k, v] of Object.entries(vars)) s = s.split(k).join(v);
  return s;
};
const json = (o) => JSON.stringify(o, null, 2) + '\n';
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export const TARGETS = ['web', 'pwa', 'single', 'desktop-electron', 'desktop-tauri', 'ios', 'android'];
// Versions the scaffolds ask for: the latest on the npm registry on 2026-11-11 (looked up, not installed).
// Rust crates are given as major versions; cargo resolves them when the owner builds.
export const VERSIONS = {
  electron: '^45.2.3', 'electron-builder': '^26.18.0', '@tauri-apps/cli': '^2.12.4',
  '@capacitor/core': '^8.6.0', '@capacitor/cli': '^8.6.0', '@capacitor/ios': '^8.6.0', '@capacitor/android': '^8.6.0',
  '@capacitor/preferences': '^8.0.1', '@capacitor/screen-orientation': '^8.0.2', '@capacitor/app': '^8.1.2',
  '@capacitor-community/keep-awake': '^8.0.1', '@capacitor/assets': '^4.0.0',
};

// What the engine needs and nothing more: its own files, WebAssembly (Rapier), workers and textures made from
// blobs, styles the UI toolkit injects. No remote origin at all: a game that calls a server adds it to connect-src.
export const CSP = ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval' blob:", "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "media-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self' data: blob:",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');

const slugOf = (s) => String(s).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'game';
const HEX = /^#[0-9a-fA-F]{6}$/;
// the start page's query string in a wrapper (e.g. 'platform=1'): plain key=value pairs only, so it cannot carry a
// path, a fragment or another origin into the window's first URL
function queryOf(q) {
  const s = String(q ?? '').replace(/^\?/, '');
  if (s && (!/^[\w.~%-]+(=[\w.~%,-]*)?(&[\w.~%-]+(=[\w.~%,-]*)?)*$/.test(s) || s.length > 200)) throw new Error(`query: key=value pairs joined by '&', like platform=1, got ${JSON.stringify(q)}`);
  return s;
}

/** validated settings shared by every target; throws with the reason */
export function shipConfig(o = {}) {
  const name = String(o.name || 'Mirage Game').trim();
  if (!name || name.length > 60 || /[\r\n<>]/.test(name)) throw new Error(`name: 1 to 60 characters on one line, got ${JSON.stringify(o.name)}`);
  const slug = slugOf(o.slug || name);
  const id = String(o.id || `com.example.${slug.replace(/-/g, '')}`);
  // reverse-DNS, as the stores want it: letters, digits and '-' in two or more dot-separated parts, none starting with a digit
  if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/.test(id) || id.length > 120) throw new Error(`id: a reverse-DNS identifier like studio.example.mygame, got ${JSON.stringify(id)}`);
  const version = String(o.version || '1.0.0');
  if (!/^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(version)) throw new Error(`version: three numbers like 1.2.0 (minor and patch below 100: Android's versionCode is built from them), got ${JSON.stringify(version)}`);
  const orientation = o.orientation || 'landscape';
  if (!['landscape', 'portrait', 'any'].includes(orientation)) throw new Error(`orientation: landscape | portrait | any, got ${JSON.stringify(orientation)}`);
  const theme = o.theme || '#101418', background = o.background || '#000000';
  for (const [k, v] of [['theme', theme], ['background', background]]) if (!HEX.test(v)) throw new Error(`${k}: a colour like #101418, got ${JSON.stringify(v)}`);
  const [maj, min, pat] = version.split('.').map(Number);
  return {
    name, slug, id, version, orientation, theme: theme.toLowerCase(), background: background.toLowerCase(),
    author: String(o.author || name).replace(/[\r\n]+/g, ' ').slice(0, 100), query: queryOf(o.query),
    shortName: String(o.shortName || name).slice(0, 12), description: String(o.description || `${name}, made with Mirage.`).replace(/[\r\n]+/g, ' '),
    lang: o.lang || 'en', width: 1280, height: 720, minWidth: 640, minHeight: 360, fullscreen: !!o.fullscreen,
    versionCode: maj * 10000 + min * 100 + pat,
  };
}

// ---------------------------------------------------------------------------------------------------- icons
// One square source image (1024 px is best) -> every size a target asks for. Box filter in premultiplied alpha
// (no dark fringe around a transparent edge); a smaller source is enlarged the same way (and looks soft: said by ship.mjs).
export function resizeRGBA({ w, h, data }, size) {
  const out = new Uint8Array(size * size * 4), sx = w / size, sy = h / size;
  for (let y = 0; y < size; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy;
    for (let x = 0; x < size; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let v = Math.floor(y0); v < Math.min(h, Math.ceil(y1)); v++) {
        const wy = Math.min(v + 1, y1) - Math.max(v, y0);
        for (let u = Math.floor(x0); u < Math.min(w, Math.ceil(x1)); u++) {
          const wt = wy * (Math.min(u + 1, x1) - Math.max(u, x0)), i = (v * w + u) * 4, al = data[i + 3] * wt;
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al; wsum += wt;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = wsum > 0 ? Math.round(a / wsum) : 0;
    }
  }
  return { w: size, h: size, data: out };
}
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** the image at `scale` of the square, centred on an opaque colour (a maskable icon, an icon without alpha) */
export function padded(img, size, hex, scale = 1) {
  const [br, bg, bb] = rgbOf(hex), out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { out[4 * i] = br; out[4 * i + 1] = bg; out[4 * i + 2] = bb; out[4 * i + 3] = 255; }
  const s = Math.round(size * scale), src = resizeRGBA(img, s), off = Math.floor((size - s) / 2);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4, o = ((y + off) * size + x + off) * 4, a = src.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(src.data[i + c] * a + out[o + c] * (1 - a));
  }
  return { w: size, h: size, data: out };
}
/** a placeholder when the owner gives no icon: a low sun over a horizon in the theme colour. Replace before release. */
export function defaultIcon(cfg, size = 1024) {
  const [tr, tg, tb] = rgbOf(cfg.theme), data = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size * 0.56, rad = size * 0.2, horizon = size * 0.66;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4, t = y / size;
    let r = tr + (255 - tr) * 0.55 * t * t, g = tg + (190 - tg) * 0.55 * t * t, b = tb + (120 - tb) * 0.45 * t * t;
    const d = Math.hypot(x - cx, y - cy), sun = Math.min(1, Math.max(0, (rad - d) / 3 + 0.5));
    r += (255 - r) * sun; g += (226 - g) * sun; b += (160 - b) * sun;
    if (y > horizon) { const k = 0.82; r = tr * k; g = tg * k; b = tb * k; }
    data[o] = Math.round(r); data[o + 1] = Math.round(g); data[o + 2] = Math.round(b); data[o + 3] = 255;
  }
  return { w: size, h: size, data };
}
/** .ico with PNG entries (Windows Vista and later read them) */
export function encodeICO(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}
/** .icns with PNG entries (macOS 10.7 and later) */
export function encodeICNS(pngs) {
  const TYPE = { 32: 'ic11', 64: 'ic12', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
  const parts = pngs.map(({ size, png }) => { const h = Buffer.alloc(8); h.write(TYPE[size], 0, 'latin1'); h.writeUInt32BE(png.length + 8, 4); return Buffer.concat([h, png]); });
  const head = Buffer.alloc(8); head.write('icns', 0, 'latin1'); head.writeUInt32BE(8 + parts.reduce((s, p) => s + p.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}
/** every icon a target can ask for, from one source image: { png(size), opaque(size), maskable(size), ico, icns } */
export function iconSet(src, cfg) {
  if (src.w !== src.h) throw new Error(`icon: a square image, got ${src.w} x ${src.h}`);
  const cache = new Map();
  const memo = (k, fn) => { if (!cache.has(k)) cache.set(k, fn()); return cache.get(k); };
  const png = (size) => memo('p' + size, () => encodePNG(resizeRGBA(src, size)));
  return {
    png,
    opaque: (size) => memo('o' + size, () => encodePNG(padded(src, size, cfg.background, 1))),              // iOS: no alpha allowed
    maskable: (size, scale = 0.72) => memo('m' + size + scale, () => encodePNG(padded(src, size, cfg.background, scale))),   // the safe zone is the middle 80 %
    get ico() { return memo('ico', () => encodeICO([16, 32, 48, 256].map((size) => ({ size, png: png(size) })))); },
    get icns() { return memo('icns', () => encodeICNS([32, 64, 128, 256, 512, 1024].map((size) => ({ size, png: png(size) })))); },
  };
}

// ---------------------------------------------------------------------------------------------------- html
/** index.html with what a target needs in <head>. Idempotent: tags carry data-mirage-ship and are replaced. */
export function patchHtml(html, cfg, { target }) {
  if (!/<\/head>/i.test(html)) throw new Error('index.html has no </head>');
  // a second run starts from a clean page; the viewport tag stays where it is (it is rewritten in place below)
  let out = html.replace(/[ \t]*<(?![^>]*name="viewport")[^>]*data-mirage-ship[^>]*>(?:<\/script>)?\n?/g, '');
  const tags = [];
  const mobile = target === 'pwa' || target === 'ios' || target === 'android';
  if (mobile) {
    // viewport-fit=cover: the page reaches under the notch and env(safe-area-inset-*) becomes non-zero
    const vp = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover${target === 'pwa' ? '' : ', user-scalable=no'}" data-mirage-ship>`;
    if (/<meta[^>]*name=["']viewport["'][^>]*>/i.test(out)) out = out.replace(/<meta[^>]*name=["']viewport["'][^>]*>/i, vp); else tags.push(vp);
  }
  if (target === 'pwa') {
    tags.push('<link rel="manifest" href="./manifest.webmanifest" data-mirage-ship>',
      `<meta name="theme-color" content="${cfg.theme}" data-mirage-ship>`,
      '<link rel="icon" type="image/png" sizes="192x192" href="./icons/icon-192.png" data-mirage-ship>',
      '<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" data-mirage-ship>',
      '<meta name="mobile-web-app-capable" content="yes" data-mirage-ship>',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" data-mirage-ship>',
      `<meta name="apple-mobile-web-app-title" content="${xmlEsc(cfg.shortName)}" data-mirage-ship>`,
      '<script src="./mirage-pwa.js" defer data-mirage-ship></script>');
    out = out.replace(/[ \t]*<link rel="icon" href="data:,">\n?/, '');
  }
  if (target === 'desktop-tauri' || target === 'ios' || target === 'android') tags.push('<script src="./mirage-native.js" data-mirage-ship></script>');
  // Capacitor serves www/ itself and gives no way to set a response header: the policy goes in the page. Its
  // Android bridge may be injected as an inline script, so script-src keeps 'unsafe-inline' there (docs/platforms.md).
  if (target === 'ios' || target === 'android') tags.unshift(`<meta http-equiv="Content-Security-Policy" content="${xmlEsc(CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("; frame-ancestors 'none'", ''))}" data-mirage-ship>`);
  if (!tags.length) return out;
  return out.replace(/([ \t]*)<\/head>/i, (m, ind) => tags.map((t) => `${ind}  ${t}\n`).join('') + m);
}

// ---------------------------------------------------------------------------------------------------- web
const HEADER_RULES = (isolated) => [
  // Vite puts a content hash in every name under assets/: such a file never changes, so it may be cached for a year
  { match: '/assets/*', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  // the entry points must be asked for again each time, or players stay on an old build
  { match: '/*.html', headers: { 'Cache-Control': 'no-cache' } },
  { match: '/', headers: { 'Cache-Control': 'no-cache' } },
  { match: '/sw.js', headers: { 'Cache-Control': 'no-cache' } },
  { match: '/manifest.webmanifest', headers: { 'Cache-Control': 'no-cache' } },
  { match: '/icons/*', headers: { 'Cache-Control': 'public, max-age=86400' } },
  { match: '/*', headers: { 'X-Content-Type-Options': 'nosniff', ...(isolated ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}) } },
];
const HOSTING = (cfg, isolated) => `${cfg.name} ${cfg.version}: static web build (mirage-ship --target web)

Any static host can serve this folder as it is. index.html is the entry; no rewrites are needed.

Caching (the rules are in two forms: _headers for Netlify and Cloudflare Pages, headers.json for anything else)
  /assets/*      public, max-age=31536000, immutable   (hashed names: a new build has new names)
  *.html, sw.js  no-cache                              (asked for again each visit, so a new build is seen at once)
  A host that ignores both files (GitHub Pages) uses its own short cache for everything: correct, only slower to
  load a second time.

Cross-origin isolation (COOP / COEP): ${isolated ? 'ON in this build (--isolated)' : 'off in this build'}
  The engine does not need it: it uses no SharedArrayBuffer and its physics (Rapier) is single-threaded
  WebAssembly. Turn it on (--isolated) only when your own code needs SharedArrayBuffer or the high-resolution
  timer. With it on, every file from another origin (a CDN font, an analytics script, an embedded video) must
  be served with CORS or Cross-Origin-Resource-Policy, or the browser blocks it; and the page can no longer be
  embedded in another site's iframe unless that site is isolated too. Hosts without custom headers (GitHub
  Pages) cannot turn it on at all.

Try it:  npx serve .   (or: python3 -m http.server)
Nothing was uploaded by the tool; publishing is yours.
`;
export function webFiles(cfg, { isolated = false } = {}) {
  const rules = HEADER_RULES(isolated);
  return new Map([
    ['_headers', rules.map((r) => `${r.match}\n${Object.entries(r.headers).map(([k, v]) => `  ${k}: ${v}\n`).join('')}`).join('')],
    ['headers.json', json({ note: 'Cache and security headers for this folder, one rule per path pattern (* = any run of characters). _headers holds the same rules in Netlify / Cloudflare Pages form.', rules })],
    ['.nojekyll', ''],
    ['HOSTING.txt', HOSTING(cfg, isolated)],
  ]);
}

// ---------------------------------------------------------------------------------------------------- pwa
/** files: [{ path: 'assets/main-abc.js', hash }] = everything the page needs offline (ship.mjs lists the folder) */
export function serviceWorker(cfg, files) {
  const list = files.map((f) => ({ path: f.path.split(path.sep).join('/'), hash: f.hash })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // the version is the content: the same build gives the same worker (no update), any changed byte a new one
  const version = sha256(cfg.version + '\n' + list.map((f) => `${f.path} ${f.hash}`).join('\n')).slice(0, 16);
  return { version, source: tpl('sw.js', { __VERSION__: `${cfg.version}-${version}`, __CACHE_PREFIX__: `mirage-${cfg.slug}-`, __FILES__: JSON.stringify(list.map((f) => './' + f.path)) }) };
}
export function pwaFiles(cfg, { files, icons, isolated = false }) {
  const out = webFiles(cfg, { isolated });
  const manifest = {
    name: cfg.name, short_name: cfg.shortName, description: cfg.description, lang: cfg.lang, id: './', start_url: './', scope: './',
    display: 'fullscreen', display_override: ['fullscreen', 'standalone'],
    ...(cfg.orientation === 'any' ? {} : { orientation: cfg.orientation }),
    theme_color: cfg.theme, background_color: cfg.background, categories: ['games'],
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  out.set('manifest.webmanifest', json(manifest));
  out.set('icons/icon-192.png', icons.png(192)); out.set('icons/icon-512.png', icons.png(512));
  out.set('icons/maskable-512.png', icons.maskable(512)); out.set('icons/apple-touch-icon.png', icons.opaque(180));
  out.set('mirage-pwa.js', tpl('pwa.js'));
  // the worker precaches the game's files and the ones made here (not itself, not the host-only files)
  const own = [...out].filter(([p]) => !['_headers', 'headers.json', '.nojekyll', 'HOSTING.txt'].includes(p)).map(([p, body]) => ({ path: p, hash: sha256(body) }));
  const sw = serviceWorker(cfg, [...files.filter((f) => !own.some((o) => o.path === f.path) && f.path !== 'sw.js'), ...own]);
  out.set('sw.js', sw.source);
  out.version = sw.version;
  return out;
}

// ---------------------------------------------------------------------------------------------------- electron
const ELECTRON_README = (cfg) => `# ${cfg.name}: desktop build (Electron)

Made by \`mirage-ship --target desktop-electron\`. The game is in \`www/\`; \`main.cjs\` opens it in one window.

    npm install          # electron-builder, Electron's package, then its binary (about 100 MB, checked against
                         # Electron's published SHA-256 sums): your machine, your choice. Electron 45 no longer
                         # fetches the binary on install by itself; the postinstall script here runs install-electron.
    npm start            # run it
    npm run pack         # an unpacked app in dist/ (quick check)
    npm run dist         # installers for the OS you run it on: dmg + zip (macOS), NSIS (Windows), AppImage (Linux)
    npm run dist:win     # a Windows NSIS installer, also from a Mac or Linux (no Wine needed; it was not run on Windows here)

Check it before you ship it (from the Mirage repository; it launches the app and drives it over the DevTools
protocol: start, GPU, console, bridge, saves across a restart, window state, navigation, permissions, frame time):

    node packages/tools/src/desktop-check.mjs <this folder> [--exe "dist/mac-arm64/<name>.app/Contents/MacOS/<name>"]

What is set up: the high-performance GPU is asked for, the window comes back where it was (size, place,
maximized, fullscreen), F11 / Alt+Enter toggle fullscreen, pointer lock and gamepads work as in Chrome, saves
are files in the user's app-data folder (\`saves/\`), the page has no Node access, a Content-Security-Policy
with no remote origin, no navigation away from the game, the window keeps the game's name as its title, a
crashed page is reloaded once (a second crash within a minute quits with a message instead of looping), and the
packaged app has Electron's fuses set: no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS, no --inspect, code only from
the app's own archive, checked against its hash.

Before you give it to anyone: replace \`build/icon.*\` if they are the placeholder, and sign it. Signing is
yours: an Apple Developer ID certificate plus notarization on macOS, a code-signing certificate on Windows.
electron-builder reads them from your keychain or from environment variables you set (CSC_LINK,
APPLE_ID, ...). Never put a certificate, a password or a key in this folder or in git.
The full checklist: docs/platforms.md in the Mirage repository.
`;
const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
</dict>
</plist>
`;
export function electronFiles(cfg, { icons }) {
  const pkg = {
    name: cfg.slug, productName: cfg.name, version: cfg.version, description: cfg.description, private: true, main: 'main.cjs',
    author: cfg.author, scripts: { postinstall: 'install-electron', start: 'electron .', pack: 'electron-builder --dir', dist: 'electron-builder', 'dist:win': 'electron-builder --win nsis --x64' },
    devDependencies: { electron: VERSIONS.electron, 'electron-builder': VERSIONS['electron-builder'] },
    build: {
      appId: cfg.id, productName: cfg.name, asar: true, files: ['main.cjs', 'preload.cjs', 'www/**/*'], directories: { buildResources: 'build', output: 'dist' },
      // Electron's fuses, flipped in the binary when it is packaged: the shipped app cannot be turned into a Node
      // runtime (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect) and loads code only from its own archive, checked
      // against the hash written into the executable. The game never needs any of what is switched off.
      // resetAdHocDarwinSignature: flipping a fuse edits the executable, which breaks its ad-hoc signature, and Apple
      // Silicon kills an arm64 binary whose signature does not match (measured: the unsigned .app died at once with
      // SIGKILL without it). It re-signs ad hoc; a real Developer ID signature still replaces that afterwards.
      electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, enableCookieEncryption: true, grantFileProtocolExtraPrivileges: false,
        resetAdHocDarwinSignature: true },
      // hardened runtime + the JIT entitlement: what notarization needs for a Chromium app
      mac: { category: 'public.app-category.games', target: ['dmg', 'zip'], hardenedRuntime: true, entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.plist' },
      win: { target: ['nsis'] },
      linux: { target: ['AppImage'], category: 'Game' },
    },
  };
  const config = { name: cfg.name, background: cfg.background, width: cfg.width, height: cfg.height, minWidth: cfg.minWidth, minHeight: cfg.minHeight, fullscreen: cfg.fullscreen, csp: CSP, query: cfg.query };
  return new Map([
    ['package.json', json(pkg)],
    ['main.cjs', tpl('electron-main.cjs', { __CONFIG__: JSON.stringify(config, null, 2) })],
    ['preload.cjs', tpl('electron-preload.cjs')],
    ['build/icon.png', icons.png(1024)], ['build/icon.ico', icons.ico], ['build/icon.icns', icons.icns],
    ['build/entitlements.mac.plist', ENTITLEMENTS],
    ['.gitignore', 'node_modules/\ndist/\n'],
    ['README.md', ELECTRON_README(cfg)],
  ]);
}

// ---------------------------------------------------------------------------------------------------- tauri
const tomlStr = (s) => JSON.stringify(String(s));   // a TOML basic string takes the same escapes as JSON for these
const TAURI_README = (cfg) => `# ${cfg.name}: desktop build (Tauri 2)

Made by \`mirage-ship --target desktop-tauri\`. The game is in \`www/\`; it runs in the system WebView
(WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux), so the download is a few MB instead of Electron's
100, and the renderer is whatever that WebView has: test on each OS, WebKitGTK's WebGL is the slowest of the three.

    # needs Rust (https://rustup.rs) and your OS's build tools; see https://tauri.app/start/prerequisites/
    npm install          # the Tauri CLI
    npm run dev          # run it
    npm run build        # installers for the OS you run it on (src-tauri/target/release/bundle/)

What is set up: saves are files in the app-data folder (commands in \`src-tauri/src/main.rs\`), window size and
place are kept (tauri-plugin-window-state), F11 / Alt+Enter toggle fullscreen, a Content-Security-Policy with no
remote origin, the high-performance GPU is asked for on Windows (WebView2 arguments; macOS and Linux follow the
page's own powerPreference, which the engine sets).

Before you give it to anyone: replace \`src-tauri/icons/*\` if they are the placeholder, and sign it (Apple
Developer ID + notarization, a Windows code-signing certificate). Tauri reads signing settings from environment
variables you set; never put a certificate, a password or a key in this folder or in git.
The full checklist: docs/platforms.md in the Mirage repository.
`;
export function tauriFiles(cfg, { icons }) {
  const conf = {
    $schema: 'https://schema.tauri.app/config/2',
    productName: cfg.name, version: cfg.version, identifier: cfg.id,
    build: { frontendDist: '../www' },
    app: {
      withGlobalTauri: true,
      windows: [{
        label: 'main', title: cfg.name, width: cfg.width, height: cfg.height, minWidth: cfg.minWidth, minHeight: cfg.minHeight,
        resizable: true, fullscreen: cfg.fullscreen, backgroundColor: cfg.background,
        // WebView2 only. Setting this replaces Tauri's defaults, so they are repeated first.
        additionalBrowserArgs: '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --force_high_performance_gpu --autoplay-policy=no-user-gesture-required',
      }],
      security: { csp: CSP },
    },
    bundle: {
      active: true, targets: 'all', category: 'Game', shortDescription: cfg.description,
      icon: ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico'],
    },
  };
  const cargo = `[package]
name = ${tomlStr(cfg.slug)}
version = ${tomlStr(cfg.version)}
description = ${tomlStr(cfg.description)}
edition = "2021"
rust-version = "1.77.2"
publish = false

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-window-state = "2"

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
`;
  return new Map([
    ['package.json', json({ name: cfg.slug, version: cfg.version, description: cfg.description, private: true, scripts: { dev: 'tauri dev', build: 'tauri build', tauri: 'tauri' }, devDependencies: { '@tauri-apps/cli': VERSIONS['@tauri-apps/cli'] } })],
    ['src-tauri/tauri.conf.json', json(conf)],
    ['src-tauri/Cargo.toml', cargo],
    ['src-tauri/build.rs', 'fn main() {\n    tauri_build::build()\n}\n'],
    ['src-tauri/src/main.rs', tpl('tauri-main.rs')],
    ['src-tauri/capabilities/default.json', json({ $schema: '../gen/schemas/desktop-schema.json', identifier: 'default', description: 'The one window: core events only. The save and window commands are the app\'s own (src/main.rs).', windows: ['main'], permissions: ['core:default'] })],
    ['src-tauri/icons/32x32.png', icons.png(32)], ['src-tauri/icons/128x128.png', icons.png(128)], ['src-tauri/icons/128x128@2x.png', icons.png(256)],
    ['src-tauri/icons/icon.png', icons.png(512)], ['src-tauri/icons/icon.ico', icons.ico], ['src-tauri/icons/icon.icns', icons.icns],
    ['www/mirage-native.js', tpl('native-tauri.js')],
    ['.gitignore', 'node_modules/\nsrc-tauri/target/\nsrc-tauri/gen/\n'],
    ['README.md', TAURI_README(cfg)],
  ]);
}

// ---------------------------------------------------------------------------------------------------- capacitor
const plist = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}</dict>
</plist>
`;
const IOS_ORIENT = { landscape: ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'], portrait: ['UIInterfaceOrientationPortrait'], any: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'] };
const AND_ORIENT = { landscape: 'sensorLandscape', portrait: 'sensorPortrait', any: 'fullUser' };
const CAP_README = (cfg, p) => `# ${cfg.name}: ${p === 'ios' ? 'iOS' : 'Android'} build (Capacitor 8)

Made by \`mirage-ship --target ${p}\`. The game is in \`www/\`; Capacitor wraps it in a native app whose screen
is the system WebView (${p === 'ios' ? 'WKWebView' : 'Android System WebView, Chromium'}). The native project itself is created on your
machine by Capacitor, with your ${p === 'ios' ? 'Xcode' : 'Android Studio'}:

    npm install                      # Capacitor and its plugins
    npx cap add ${p}${p === 'ios' ? '                  # makes ios/ (needs a Mac with Xcode and CocoaPods or SPM)' : '              # makes android/ (needs Android Studio / the Android SDK)'}
    npm run assets                   # icons and splash screens from assets/ into the native project
    npm run sync                     # copies www/ and applies native/ (orientation, full screen, privacy file)
    npx cap open ${p}                 # build, run on a device and archive from there

What is set up: saves go to @capacitor/preferences (kept with the app), orientation is ${cfg.orientation}
(native setting plus a runtime lock), the page covers the whole screen with safe-area insets available to the
game (viewport-fit=cover; the UI toolkit already pads for them), the screen can be kept awake, a
Content-Security-Policy with no remote origin.

Signing and the store are yours: ${p === 'ios' ? 'an Apple Developer account, a distribution certificate and a provisioning profile, set in Xcode (Signing & Capabilities)' : 'a keystore you create and keep (keytool), set in Android Studio (Build > Generate Signed Bundle); Play App Signing holds the app key'}.
Never put a certificate, a keystore, a password or a key in this folder or in git.
versionCode for this build: ${cfg.versionCode} (from ${cfg.version}). The full checklist: docs/platforms.md in the Mirage repository.
`;
export function capacitorFiles(cfg, { icons, platform }) {
  if (platform !== 'ios' && platform !== 'android') throw new Error(`capacitor platform: ios | android, got ${platform}`);
  const ios = platform === 'ios';
  const deps = { '@capacitor/core': 0, '@capacitor/preferences': 0, '@capacitor/screen-orientation': 0, '@capacitor/app': 0, '@capacitor-community/keep-awake': 0, [ios ? '@capacitor/ios' : '@capacitor/android']: 0 };
  const pick = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, VERSIONS[k]]));
  const out = new Map([
    ['package.json', json({
      name: cfg.slug, version: cfg.version, description: cfg.description, private: true,
      scripts: { sync: 'cap sync && node scripts/apply-native.mjs', assets: `capacitor-assets generate --${platform}`, open: `cap open ${platform}` },
      dependencies: pick(deps), devDependencies: pick({ '@capacitor/cli': 0, '@capacitor/assets': 0 }),
    })],
    ['capacitor.config.json', json({
      appId: cfg.id, appName: cfg.name, webDir: 'www', backgroundColor: cfg.background,
      // contentInset never + scrollEnabled false: the WebView is the whole screen and does not rubber-band
      ios: { contentInset: 'never', scrollEnabled: false, allowsLinkPreview: false, backgroundColor: cfg.background },
      android: { allowMixedContent: false, captureInput: false, webContentsDebuggingEnabled: false, backgroundColor: cfg.background },
      server: { androidScheme: 'https' },
    })],
    ['www/mirage-native.js', tpl('native-capacitor.js', { __ORIENTATION__: cfg.orientation })],
    ['scripts/apply-native.mjs', tpl('apply-native.mjs')],
    // the names @capacitor/assets looks for
    ['assets/icon-only.png', icons.opaque(1024)], ['assets/icon-foreground.png', icons.maskable(1024, 0.6)],
    ['assets/icon-background.png', icons.maskable(1024, 0)], ['assets/splash.png', icons.maskable(2732, 0.25)], ['assets/splash-dark.png', icons.maskable(2732, 0.25)],
    ['.gitignore', 'node_modules/\nios/App/Pods/\nandroid/.gradle/\nandroid/app/build/\n*.keystore\n*.jks\n*.p12\n*.mobileprovision\n'],
    ['README.md', CAP_README(cfg, platform)],
  ]);
  const android = {
    manifest: {
      attrs: { 'android:screenOrientation': AND_ORIENT[cfg.orientation] },
      // WebGL2 is OpenGL ES 3.0: Play hides the app from devices without it. A gamepad and a touch screen are optional (TV, Chromebook).
      features: ['<uses-feature android:glEsVersion="0x00030000" android:required="true" />', '<uses-feature android:name="android.hardware.gamepad" android:required="false" />', '<uses-feature android:name="android.hardware.touchscreen" android:required="false" />'],
    },
    style: 'AppTheme.NoActionBar',
    styleItems: { 'android:windowFullscreen': 'true', 'android:windowLayoutInDisplayCutoutMode': 'shortEdges' },
  };
  out.set('native/mirage-native.json', json({ note: 'Read by scripts/apply-native.mjs after `cap add`.', orientation: cfg.orientation, android }));
  if (ios) {
    const arr = (items) => `\t<array>\n${items.map((i) => `\t\t<string>${i}</string>\n`).join('')}\t</array>\n`;
    out.set('native/ios/Info.additions.plist', plist(
      `\t<key>UISupportedInterfaceOrientations</key>\n${arr(IOS_ORIENT[cfg.orientation])}` +
      `\t<key>UISupportedInterfaceOrientations~ipad</key>\n${arr(IOS_ORIENT[cfg.orientation])}` +
      '\t<key>UIRequiresFullScreen</key>\n\t<true/>\n' +
      '\t<key>UIStatusBarHidden</key>\n\t<true/>\n' +
      '\t<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<false/>\n' +
      '\t<key>GCSupportsControllerUserInteraction</key>\n\t<true/>\n' +
      '\t<key>LSApplicationCategoryType</key>\n\t<string>public.app-category.games</string>\n' +
      // false = only the encryption iOS itself provides (HTTPS). Change it if your game ships its own cryptography.
      '\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n'));
    // What this scaffold itself does: no tracking, collects nothing, reads UserDefaults (the saves, through
    // @capacitor/preferences) for the app's own use (reason CA92.1). Add what your game and its SDKs do.
    out.set('native/ios/PrivacyInfo.xcprivacy', plist(
      '\t<key>NSPrivacyTracking</key>\n\t<false/>\n' +
      '\t<key>NSPrivacyTrackingDomains</key>\n\t<array/>\n' +
      '\t<key>NSPrivacyCollectedDataTypes</key>\n\t<array/>\n' +
      '\t<key>NSPrivacyAccessedAPITypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>NSPrivacyAccessedAPIType</key>\n\t\t\t<string>NSPrivacyAccessedAPICategoryUserDefaults</string>\n' +
      '\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>\n\t\t\t<array>\n\t\t\t\t<string>CA92.1</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n'));
  } else {
    out.set('native/android/AndroidManifest.additions.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- What scripts/apply-native.mjs puts into android/app/src/main/AndroidManifest.xml (shown here to read or to apply by hand). -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${android.manifest.features.map((f) => `    ${f}\n`).join('')}    <application>
        <activity android:name=".MainActivity"${Object.entries(android.manifest.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')} />
    </application>
</manifest>
`);
    out.set('native/android/styles.additions.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- Items scripts/apply-native.mjs adds to the activity theme in android/app/src/main/res/values/styles.xml:
     no status bar, and the page drawn into the display cutout (the game reads the safe-area insets). -->
<resources>
    <style name="${android.style}">
${Object.entries(android.styleItems).map(([k, v]) => `        <item name="${k}">${v}</item>\n`).join('')}    </style>
</resources>
`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- validators
// Small structural readers for the checks (and for ship.mjs' own self-check before it reports success).
/** well-formed XML? -> { ok, error, root, elements } (tags balance, attributes quoted, one root; no DTD validation) */
export function checkXML(text) {
  const stack = [];
  let root = null, elements = 0;
  const body = text.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/g, '');
  const re = /<(\/)?([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/)?>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[0] === '<' || m[0] === '&') return { ok: false, error: `stray ${m[0]} at ${m.index}: ${JSON.stringify(body.slice(m.index, m.index + 30))}` };
    const [, close, name, , self] = m;
    if (close) { const open = stack.pop(); if (open !== name) return { ok: false, error: `</${name}> closes <${open}>` }; }
    else { elements++; if (!stack.length) { if (root) return { ok: false, error: 'more than one root element' }; root = name; } if (!self) stack.push(name); }
  }
  if (stack.length) return { ok: false, error: `<${stack.pop()}> is not closed` };
  if (!root) return { ok: false, error: 'no element' };
  return { ok: true, root, elements };
}
/** a property list (XML form) as a JS value; throws when it is not one */
export function parsePlist(text) {
  const x = checkXML(text);
  if (!x.ok || x.root !== 'plist') throw new Error('plist: ' + (x.error || `root is <${x.root}>`));
  const toks = [...text.slice(text.indexOf('<plist')).matchAll(/<(\/?)(\w+)[^>]*?(\/?)>([^<]*)/g)].map((m) => ({ close: !!m[1], tag: m[2], self: !!m[3], text: m[4] }));
  let i = 1;   // after <plist>
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  function value() {
    const t = toks[i++];
    if (!t || t.close) throw new Error('plist: value expected');
    if (t.tag === 'true' || t.tag === 'false') return t.tag === 'true';
    if (t.tag === 'string') { i++; return unesc(t.text); }
    if (t.tag === 'integer' || t.tag === 'real') { i++; return Number(t.text); }
    if (t.tag === 'array') { const a = []; if (t.self) return a; while (!toks[i].close) a.push(value()); i++; return a; }
    if (t.tag === 'dict') {
      const d = {}; if (t.self) return d;
      while (!toks[i].close) { const k = toks[i++]; if (k.tag !== 'key') throw new Error(`plist: <key> expected, got <${k.tag}>`); i++; d[unesc(k.text)] = value(); }
      i++; return d;
    }
    throw new Error(`plist: unknown type <${t.tag}>`);
  }
  return value();
}
/** the subset of TOML the scaffolds use (tables, strings, numbers, booleans, arrays, inline tables) as a JS object; throws otherwise */
export function parseTOML(text) {
  const root = {};
  let cur = root;
  const val = (s) => {
    s = s.trim();
    if (s.startsWith('"')) return JSON.parse(s);
    if (s === 'true' || s === 'false') return s === 'true';
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s.startsWith('[') && s.endsWith(']')) return split(s.slice(1, -1)).map(val);
    if (s.startsWith('{') && s.endsWith('}')) return Object.fromEntries(split(s.slice(1, -1)).map((kv) => { const j = kv.indexOf('='); if (j < 0) throw new Error(`TOML: bad inline table entry ${kv}`); return [kv.slice(0, j).trim(), val(kv.slice(j + 1))]; }));
    throw new Error(`TOML: cannot read value ${s}`);
  };
  const split = (s) => {   // on top-level commas
    const out = []; let depth = 0, str = false, from = 0;
    for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '"' && s[i - 1] !== '\\') str = !str; else if (!str && (c === '[' || c === '{')) depth++; else if (!str && (c === ']' || c === '}')) depth--; else if (!str && c === ',' && !depth) { out.push(s.slice(from, i)); from = i + 1; } }
    if (s.slice(from).trim()) out.push(s.slice(from));
    return out;
  };
  text.split('\n').forEach((raw, n) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const table = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (table) { cur = root; for (const k of table[1].split('.')) cur = cur[k] ??= {}; return; }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) throw new Error(`TOML line ${n + 1}: ${line}`);
    if (kv[1] in cur) throw new Error(`TOML line ${n + 1}: ${kv[1]} set twice`);
    cur[kv[1]] = val(kv[2]);
  });
  return root;
}
