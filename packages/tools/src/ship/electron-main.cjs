// Mirage original code. Electron main process written by `mirage-ship --target desktop-electron` (template).
// What it does, in order: asks for the fast GPU, serves the game from its own app:// origin (so fetch, workers
// and WebAssembly work as on a web server, with a Content-Security-Policy on every response), opens one window
// where it was last time, keeps saves as files in the user's app-data folder, and refuses everything a game does
// not need (other sites, new windows, device permissions).
'use strict';
const { app, BrowserWindow, ipcMain, protocol, session, screen, shell, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = __CONFIG__;
const WWW = path.join(__dirname, 'www');
const ORIGIN = 'app://game';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };

// ---- GPU: a laptop with two GPUs gives a new process the slow one unless asked. Must be set before 'ready'.
app.commandLine.appendSwitch('force_high_performance_gpu');
// sound may start without a click: there is no browser chrome here for an autoplay policy to protect
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// MIRAGE_IGNORE_GPU_BLOCKLIST=1: for a machine whose driver Chromium distrusts (it then runs WebGL on it anyway)
if (process.env.MIRAGE_IGNORE_GPU_BLOCKLIST === '1') app.commandLine.appendSwitch('ignore-gpu-blocklist');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

// ---- saves: one file per key in <userData>/saves. Windows: %APPDATA%\<name>, macOS: ~/Library/Application
// Support/<name>, Linux: ~/.config/<name>. Written to a temporary file first and renamed, so a crash or a power
// cut in the middle of a write leaves the previous save, never half of one.
const savesDir = () => path.join(app.getPath('userData'), 'saves');
const MAX_KEY = 200, MAX_VALUE = 32 * 1024 * 1024;
function saveFile(key) {
  if (typeof key !== 'string' || !key || key.length > MAX_KEY) throw new Error('bad save key');
  // encodeURIComponent leaves no path separator; '.' and '*' are escaped too so no key can name '..' or a wildcard
  return path.join(savesDir(), encodeURIComponent(key).replace(/\./g, '%2E').replace(/\*/g, '%2A') + '.json');
}
const saves = {
  keys() {
    let names = [];
    try { names = fs.readdirSync(savesDir()); } catch { /* no save yet */ }
    return names.filter((n) => n.endsWith('.json')).map((n) => { try { return decodeURIComponent(n.slice(0, -5)); } catch { return null; } }).filter((k) => k !== null).sort();
  },
  get(key) { try { return fs.readFileSync(saveFile(key), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
  set(key, value) {
    if (typeof value !== 'string' || value.length > MAX_VALUE) throw new Error('bad save value');
    const file = saveFile(key), tmp = file + '.tmp';
    fs.mkdirSync(savesDir(), { recursive: true });
    fs.writeFileSync(tmp, value);
    fs.renameSync(tmp, file);
    return true;
  },
  remove(key) { fs.rmSync(saveFile(key), { force: true }); return true; },
};

// ---- window state: size, place, maximized and fullscreen, restored only if that place still exists on a screen
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function readState() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { /* first run */ }
  const out = { width: CONFIG.width, height: CONFIG.height };
  const ok = (n) => Number.isFinite(n);
  if (ok(s.width) && ok(s.height) && s.width >= CONFIG.minWidth && s.height >= CONFIG.minHeight) { out.width = Math.round(s.width); out.height = Math.round(s.height); }
  if (ok(s.x) && ok(s.y)) {
    const visible = screen.getAllDisplays().some((d) => { const a = d.workArea; return s.x < a.x + a.width - 64 && s.x + out.width > a.x + 64 && s.y >= a.y - 8 && s.y < a.y + a.height - 64; });
    if (visible) { out.x = Math.round(s.x); out.y = Math.round(s.y); }
  }
  return { bounds: out, maximized: !!s.maximized, fullscreen: s.fullscreen === undefined ? CONFIG.fullscreen : !!s.fullscreen };
}
function writeState(win) {
  try {
    const b = win.getNormalBounds();
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized(), fullscreen: win.isFullScreen() }));
  } catch { /* a read-only profile: the window just opens at its default next time */ }
}

let win = null, awake = null;
const fromGame = (e) => { const f = e.senderFrame; return !!f && typeof f.url === 'string' && f.url.startsWith(ORIGIN + '/'); };
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => { if (!fromGame(e)) throw new Error('refused'); return fn(...args); });

function createWindow() {
  const state = readState();
  win = new BrowserWindow({
    ...state.bounds, minWidth: CONFIG.minWidth, minHeight: CONFIG.minHeight, show: false, title: CONFIG.name,
    backgroundColor: CONFIG.background, autoHideMenuBar: true, fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
      backgroundThrottling: true,   // a hidden window stops its frames; play.js pauses on visibilitychange anyway
    },
  });
  if (state.maximized) win.maximize();
  if (state.fullscreen) win.setFullScreen(true);
  win.once('ready-to-show', () => win.show());
  win.on('close', () => writeState(win));
  win.on('closed', () => { win = null; });
  // F11 and Alt+Enter (Ctrl+Cmd+F on a Mac) toggle fullscreen even when the game shows no button for it
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mac = process.platform === 'darwin';
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt) || (mac && input.key.toLowerCase() === 'f' && input.control && input.meta)) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // the window shows the game and nothing else: no navigation away, no pop-ups; https links open in the browser
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(ORIGIN + '/index.html');
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  // the game's files, under app://game/. Paths are resolved inside www/ only.
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return new Response('bad request', { status: 400 }); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(WWW, rel));
    if (url.host !== 'game' || !file.startsWith(WWW + path.sep)) return new Response('forbidden', { status: 403 });
    let body;
    try { body = await fs.promises.readFile(file); } catch { return new Response('not found', { status: 404 }); }
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-security-policy': CONFIG.csp,
        'x-content-type-options': 'nosniff',
        // cross-origin isolation costs nothing here (every file is same-origin) and allows SharedArrayBuffer
        'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
      },
    });
  });
  // a game needs the mouse (pointer lock) and the whole screen; nothing else is granted (camera, location, ...).
  // Gamepads need no permission.
  const ALLOW = new Set(['pointerLock', 'fullscreen', 'keyboardLock']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(ALLOW.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ALLOW.has(permission));

  handle('mirage:save:keys', () => saves.keys());
  handle('mirage:save:get', (key) => saves.get(key));
  handle('mirage:save:set', (key, value) => saves.set(key, value));
  handle('mirage:save:remove', (key) => saves.remove(key));
  handle('mirage:window:setFullscreen', (on) => { if (win) win.setFullScreen(!!on); return true; });
  handle('mirage:window:isFullscreen', () => !!win && win.isFullScreen());
  handle('mirage:keepAwake', (on) => {
    if (on && awake === null) awake = powerSaveBlocker.start('prevent-display-sleep');
    else if (!on && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
    return true;
  });
  handle('mirage:quit', () => { app.quit(); return true; });
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
