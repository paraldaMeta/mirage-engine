// Mirage original code. Node check of mirage-ship's generators: the same input gives the same bytes, and every file
// a target writes is what its format says (JSON, TOML, XML, property lists, PNG / ICO / ICNS, JavaScript that
// parses), holds no secret and no machine-specific path. Runs without Vite and without any wrapper toolchain;
// on a Mac, `plutil -lint` reads the property lists as a second opinion. What it cannot do: build a wrapper.
//   node packages/tools/ship.check.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { decodePNG } from './src/imgcmp.mjs';
import { TARGETS, VERSIONS, CSP, shipConfig, iconSet, defaultIcon, resizeRGBA, padded, patchHtml, webFiles, pwaFiles, serviceWorker, electronFiles, tauriFiles, capacitorFiles, checkXML, parsePlist, parseTOML, sha256 } from './src/ship-gen.mjs';
import { detectToolchains } from './src/ship.mjs';
import { mergePlist, patchManifest, patchStyle, plistEntries } from './src/ship/apply-native.mjs';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };
const cfg = shipConfig({ name: 'Garden Quest', id: 'studio.example.gardenquest', version: '1.2.3', orientation: 'landscape' });
const HTML = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <link rel="icon" href="data:,">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>t</title>\n  <script type="module" crossorigin src="./assets/main-abc.js"></script>\n</head>\n<body><canvas></canvas></body>\n</html>\n';
const GAME = [{ path: 'index.html', hash: sha256(HTML) }, { path: 'assets/main-abc.js', hash: 'aa' }, { path: 'assets/chunk-def.js', hash: 'bb' }];
const gen = () => {
  const icons = iconSet(defaultIcon(cfg, 256), cfg);   // 256: the check stays quick; sizes above it are enlarged
  return {
    web: webFiles(cfg, {}), pwa: pwaFiles(cfg, { files: GAME, icons }), 'desktop-electron': electronFiles(cfg, { icons }), 'desktop-tauri': tauriFiles(cfg, { icons }),
    ios: capacitorFiles(cfg, { icons, platform: 'ios' }), android: capacitorFiles(cfg, { icons, platform: 'android' }),
  };
};
const A = gen(), B = gen();
const text = (m, p) => { assert.ok(m.has(p), `missing ${p}`); return String(m.get(p)); };

await ok('config: defaults, validation, versionCode', () => {
  assert.equal(cfg.slug, 'garden-quest'); assert.equal(cfg.versionCode, 10203);
  assert.equal(shipConfig({ name: 'Snow Hut' }).id, 'com.example.snowhut');
  for (const bad of [{ id: 'nodots' }, { id: '1a.b' }, { id: 'a b.c' }, { version: '1.2' }, { version: '1.100.0' }, { orientation: 'sideways' }, { theme: 'red' }, { name: 'a\nb' }, { name: '<x>' }]) assert.throws(() => shipConfig(bad), undefined, JSON.stringify(bad));
  assert.deepEqual(TARGETS, ['web', 'pwa', 'single', 'desktop-electron', 'desktop-tauri', 'ios', 'android']);
});

await ok('deterministic: two runs give the same files, byte for byte', () => {
  for (const t of Object.keys(A)) {
    assert.deepEqual([...A[t].keys()], [...B[t].keys()], t);
    for (const [p, body] of A[t]) assert.ok(Buffer.from(body).equals(Buffer.from(B[t].get(p))), `${t}/${p} differs between runs`);
  }
  assert.equal(A.pwa.version, B.pwa.version);
});

await ok('no secrets, no machine paths, no clock in any generated text', () => {
  const home = os.homedir();
  for (const [t, m] of Object.entries(A)) for (const [p, body] of m) {
    if (Buffer.isBuffer(body)) continue;
    assert.ok(!body.includes(home), `${t}/${p} holds the home folder`);
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']+["']/i.test(body), `${t}/${p} looks like it holds a secret`);
    assert.ok(!/\b20\d\d-\d\d-\d\dT\d\d:\d\d/.test(body), `${t}/${p} holds a timestamp`);
  }
});

await ok('every .json parses; package.json files name the wrapper themselves and pin known versions', () => {
  for (const [t, m] of Object.entries(A)) for (const [p, body] of m) if (/\.(json|webmanifest)$/.test(p)) assert.doesNotThrow(() => JSON.parse(body), `${t}/${p}`);
  const dev = (t) => { const j = JSON.parse(text(A[t], 'package.json')); return { ...j.dependencies, ...j.devDependencies }; };
  assert.equal(dev('desktop-electron').electron, VERSIONS.electron);
  assert.equal(dev('desktop-tauri')['@tauri-apps/cli'], VERSIONS['@tauri-apps/cli']);
  assert.ok(dev('ios')['@capacitor/ios'] && !dev('ios')['@capacitor/android']);
  assert.ok(dev('android')['@capacitor/android'] && !dev('android')['@capacitor/ios']);
  for (const t of ['desktop-electron', 'desktop-tauri', 'ios', 'android']) for (const [k, v] of Object.entries(dev(t))) assert.match(v, /^\^\d+\.\d+\.\d+$/, `${t} ${k}`);
  // the repository itself must not depend on them
  const repo = fs.readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8');
  for (const dep of ['"node_modules/electron"', '"node_modules/@tauri-apps/cli"', '"node_modules/@capacitor/core"']) assert.ok(!repo.includes(dep), `the repo's lockfile holds ${dep}`);
});

await ok('web: caching rules in both forms; COOP / COEP only when asked', () => {
  const rules = JSON.parse(text(A.web, 'headers.json')).rules;
  const of = (m) => rules.find((r) => r.match === m).headers;
  assert.match(of('/assets/*')['Cache-Control'], /max-age=31536000, immutable/);
  assert.equal(of('/*.html')['Cache-Control'], 'no-cache'); assert.equal(of('/sw.js')['Cache-Control'], 'no-cache');
  assert.equal(of('/*')['Cross-Origin-Opener-Policy'], undefined);
  const h = text(A.web, '_headers');
  for (const r of rules) { assert.ok(h.includes(r.match + '\n'), r.match); for (const [k, v] of Object.entries(r.headers)) assert.ok(h.includes(`  ${k}: ${v}\n`)); }
  const iso = webFiles(cfg, { isolated: true });
  assert.match(text(iso, '_headers'), /Cross-Origin-Opener-Policy: same-origin\n {2}Cross-Origin-Embedder-Policy: require-corp/);
  assert.match(text(A.web, 'HOSTING.txt'), /SharedArrayBuffer/);
});

await ok('pwa: manifest, icons at their sizes, worker precaches every file and versions by content', () => {
  const m = JSON.parse(text(A.pwa, 'manifest.webmanifest'));
  assert.equal(m.name, 'Garden Quest'); assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.equal(m.orientation, 'landscape'); assert.equal(m.display, 'fullscreen');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable') && m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  for (const i of m.icons) { const img = decodePNG(A.pwa.get(i.src)); assert.equal(`${img.w}x${img.h}`, i.sizes, i.src); }
  const touch = decodePNG(A.pwa.get('icons/apple-touch-icon.png'));
  assert.equal(touch.w, 180); for (let k = 3; k < touch.data.length; k += 4) assert.equal(touch.data[k], 255, 'apple-touch-icon must be opaque');
  const sw = text(A.pwa, 'sw.js');
  assert.doesNotThrow(() => new vm.Script(sw)); assert.ok(!/__[A-Z_]+__/.test(sw), 'a placeholder was left in sw.js');
  const files = JSON.parse(/const FILES = (\[.*\]);/.exec(sw)[1]);
  for (const f of ['./index.html', './assets/main-abc.js', './assets/chunk-def.js', './manifest.webmanifest', './icons/icon-192.png', './mirage-pwa.js']) assert.ok(files.includes(f), `${f} is not precached`);
  assert.ok(!files.includes('./sw.js') && !files.includes('./_headers'));
  assert.deepEqual(files, [...files].sort());
  const v1 = serviceWorker(cfg, GAME).version, v2 = serviceWorker(cfg, [...GAME].reverse()).version;
  assert.equal(v1, v2, 'the version must not depend on the order files are listed in');
  assert.notEqual(v1, serviceWorker(cfg, GAME.map((f, i) => (i === 1 ? { ...f, hash: 'changed' } : f))).version, 'a changed file must give a new version');
  assert.notEqual(v1, serviceWorker({ ...cfg, version: '1.2.4' }, GAME).version);
  assert.doesNotThrow(() => new vm.Script(text(A.pwa, 'mirage-pwa.js')));
});

await ok('index.html: each target gets its tags once, twice-patched is the same, web is untouched', () => {
  assert.equal(patchHtml(HTML, cfg, { target: 'web' }), HTML);
  assert.equal(patchHtml(HTML, cfg, { target: 'desktop-electron' }), HTML);   // the bridge comes from the preload script
  const pwa = patchHtml(HTML, cfg, { target: 'pwa' });
  assert.match(pwa, /<link rel="manifest" href="\.\/manifest\.webmanifest"/); assert.match(pwa, /viewport-fit=cover/); assert.match(pwa, /mirage-pwa\.js/);
  assert.equal(pwa.match(/name="viewport"/g).length, 1);
  assert.equal(patchHtml(pwa, cfg, { target: 'pwa' }), pwa);
  const ios = patchHtml(HTML, cfg, { target: 'ios' });
  assert.ok(ios.indexOf('mirage-native.js') < ios.indexOf('</head>') && ios.includes('Content-Security-Policy'));
  assert.equal(patchHtml(ios, cfg, { target: 'ios' }), ios);
  assert.match(patchHtml(HTML, cfg, { target: 'desktop-tauri' }), /<script src="\.\/mirage-native\.js"/);
  assert.throws(() => patchHtml('<p>no head</p>', cfg, { target: 'pwa' }));
});

await ok('electron: main and preload parse, locked-down window, saves in userData, GPU switch before ready', () => {
  const main = text(A['desktop-electron'], 'main.cjs'), pre = text(A['desktop-electron'], 'preload.cjs');
  assert.doesNotThrow(() => new vm.Script(main)); assert.doesNotThrow(() => new vm.Script(pre));
  assert.ok(!/__[A-Z_]+__/.test(main));
  for (const need of ['contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', "appendSwitch('force_high_performance_gpu')", "getPath('userData')", 'requestSingleInstanceLock', 'setPermissionRequestHandler', "'pointerLock'", 'will-navigate', 'setWindowOpenHandler', 'content-security-policy', 'window-state.json', 'setFullScreen']) assert.ok(main.includes(need), `main.cjs lacks ${need}`);
  assert.ok(main.indexOf('force_high_performance_gpu') < main.indexOf('app.whenReady()'));
  assert.ok(main.includes(JSON.stringify(CSP)));
  assert.match(pre, /exposeInMainWorld\('mirageNative'/); assert.ok(!/require\('(node:)?(fs|child_process)'\)/.test(pre));
  const pkg = JSON.parse(text(A['desktop-electron'], 'package.json'));
  assert.equal(pkg.main, 'main.cjs'); assert.equal(pkg.build.appId, cfg.id); assert.deepEqual(pkg.build.files, ['main.cjs', 'preload.cjs', 'www/**/*']);
  assert.equal(parsePlist(text(A['desktop-electron'], 'build/entitlements.mac.plist'))['com.apple.security.cs.allow-jit'], true);
});

// the save code of main.cjs, run for real against a temporary folder with a stand-in for Electron
await ok('electron: the save handlers round-trip, list, remove and refuse a key that would leave the folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-ship-check-'));
  const handlers = {};
  const noop = () => {};
  const electron = {
    app: { commandLine: { appendSwitch: noop }, requestSingleInstanceLock: () => true, quit: noop, on: noop, getPath: () => dir, whenReady: () => ({ then: (fn) => { electron.ready = fn; } }) },
    BrowserWindow: class { constructor() { this.webContents = { on: noop, setWindowOpenHandler: noop }; } once() {} on() {} loadURL() {} maximize() {} setFullScreen() {} },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, protocol: { registerSchemesAsPrivileged: noop, handle: (s, fn) => { electron.serve = fn; } },
    session: { defaultSession: { setPermissionRequestHandler: noop, setPermissionCheckHandler: noop } }, screen: { getAllDisplays: () => [] }, shell: {}, powerSaveBlocker: { start: () => 1, stop: noop },
  };
  const www = path.join(dir, 'app', 'www'); fs.mkdirSync(www, { recursive: true }); fs.writeFileSync(path.join(www, 'index.html'), HTML); fs.writeFileSync(path.join(dir, 'app', 'secret.txt'), 'x');
  const req = (id) => (id === 'electron' ? electron : id === 'node:fs' ? fs : id === 'node:path' ? path : assert.fail('main.cjs requires ' + id));
  vm.runInThisContext(`(function (require, __dirname, process, URL, Response) {${text(A["desktop-electron"], "main.cjs")}\n})`)(req, path.join(dir, 'app'), { platform: 'linux', env: {} }, URL, Response);
  electron.ready();
  const game = { senderFrame: { url: 'app://game/index.html' } }, call = (ch, ...a) => handlers['mirage:' + ch](game, ...a);
  assert.deepEqual(call('save:keys'), []); assert.equal(call('save:get', 'mirage:g:slot1'), null);
  call('save:set', 'mirage:g:slot1', '{"a":1}'); call('save:set', 'mirage:g:settings', '{}'); call('save:set', '..', 'dots'); call('save:set', 'a/b\\c', 'slashes');
  assert.equal(call('save:get', 'mirage:g:slot1'), '{"a":1}'); assert.equal(call('save:get', '..'), 'dots'); assert.equal(call('save:get', 'a/b\\c'), 'slashes');
  assert.deepEqual(call('save:keys'), ['..', 'a/b\\c', 'mirage:g:settings', 'mirage:g:slot1']);
  for (const f of fs.readdirSync(path.join(dir, 'saves'))) assert.match(f, /^[A-Za-z0-9%_-]+\.json$/, `save file name ${f}`);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['app', 'saves']);   // nothing escaped the saves folder
  call('save:remove', '..'); assert.equal(call('save:get', '..'), null);
  assert.throws(() => call('save:set', '', 'x')); assert.throws(() => call('save:set', 'k'.repeat(201), 'x')); assert.throws(() => call('save:set', 'k', 5));
  assert.throws(() => handlers['mirage:save:keys']({ senderFrame: { url: 'https://evil.example/' } }), /refused/);
  // the app:// handler: files of www/ only, with the policy on each
  return electron.serve({ url: 'app://game/' }).then(async (r) => {
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-security-policy'), CSP); assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal((await electron.serve({ url: 'app://game/%2e%2e/secret.txt' })).status === 200, false, 'path traversal');
    assert.equal((await electron.serve({ url: 'app://other/index.html' })).status, 403);
    assert.equal((await electron.serve({ url: 'app://game/nope.js' })).status, 404);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

await ok('tauri: config, Cargo.toml, capabilities and the Rust source hold together', () => {
  const T = A['desktop-tauri'];
  const conf = JSON.parse(text(T, 'src-tauri/tauri.conf.json'));
  assert.equal(conf.identifier, cfg.id); assert.equal(conf.version, cfg.version); assert.equal(conf.build.frontendDist, '../www'); assert.equal(conf.app.withGlobalTauri, true);
  assert.equal(conf.app.security.csp, CSP); assert.match(conf.app.windows[0].additionalBrowserArgs, /--force_high_performance_gpu/);
  for (const i of conf.bundle.icon) assert.ok(T.has('src-tauri/' + i), `bundle icon ${i} is not written`);
  const cargo = parseTOML(text(T, 'src-tauri/Cargo.toml'));
  assert.equal(cargo.package.name, cfg.slug); assert.equal(cargo.package.version, cfg.version); assert.equal(cargo.dependencies.tauri.version, '2'); assert.equal(cargo['build-dependencies']['tauri-build'].version, '2');
  assert.ok(cargo.dependencies['tauri-plugin-window-state']);
  const rs = text(T, 'src-tauri/src/main.rs');
  const commands = [...rs.matchAll(/#\[tauri::command\]\s*fn (\w+)/g)].map((m) => m[1]);
  const handler = /generate_handler!\[([\s\S]*?)\]/.exec(rs)[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual([...commands].sort(), [...handler].sort(), 'every #[tauri::command] is registered, and nothing else');
  const js = text(T, 'www/mirage-native.js');
  assert.doesNotThrow(() => new vm.Script(js));
  for (const c of [...js.matchAll(/invoke\('(\w+)'/g)].map((m) => m[1])) assert.ok(commands.includes(c), `the bridge invokes ${c}, which main.rs does not define`);
  // braces, brackets and parentheses balance outside strings and comments (no Rust compiler here: see the guide)
  const code = rs.replace(/\/\/.*$/gm, '').replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/b'.'/g, '0');
  for (const [o, c] of ['{}', '()', '[]']) assert.equal(code.split(o).length, code.split(c).length, `unbalanced ${o}${c} in main.rs`);
  assert.equal(JSON.parse(text(T, 'src-tauri/capabilities/default.json')).windows[0], conf.app.windows[0].label);
});

await ok('capacitor: config, bridge, property lists and Android XML', () => {
  for (const p of ['ios', 'android']) {
    const C = A[p], conf = JSON.parse(text(C, 'capacitor.config.json'));
    assert.equal(conf.appId, cfg.id); assert.equal(conf.webDir, 'www'); assert.equal(conf.server.androidScheme, 'https');
    const js = text(C, 'www/mirage-native.js');
    assert.doesNotThrow(() => new vm.Script(js)); assert.ok(js.includes("const want = 'landscape'"));
    for (const img of ['assets/icon-only.png', 'assets/icon-foreground.png', 'assets/icon-background.png']) assert.equal(decodePNG(C.get(img)).w, 1024, img);
    assert.equal(decodePNG(C.get('assets/splash.png')).w, 2732);
    assert.match(text(C, '.gitignore'), /\*\.keystore/);
  }
  const info = parsePlist(text(A.ios, 'native/ios/Info.additions.plist'));
  assert.deepEqual(info.UISupportedInterfaceOrientations, ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight']);
  assert.equal(info.UIRequiresFullScreen, true); assert.equal(info.ITSAppUsesNonExemptEncryption, false); assert.equal(info.GCSupportsControllerUserInteraction, true);
  const priv = parsePlist(text(A.ios, 'native/ios/PrivacyInfo.xcprivacy'));
  assert.equal(priv.NSPrivacyTracking, false); assert.deepEqual(priv.NSPrivacyCollectedDataTypes, []);
  assert.deepEqual(priv.NSPrivacyAccessedAPITypes, [{ NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] }]);
  for (const f of ['native/android/AndroidManifest.additions.xml', 'native/android/styles.additions.xml']) { const x = checkXML(text(A.android, f)); assert.ok(x.ok, `${f}: ${x.error}`); }
  assert.match(text(A.android, 'native/android/AndroidManifest.additions.xml'), /android:screenOrientation="sensorLandscape"/);
  assert.match(text(capacitorFiles(shipConfig({ orientation: 'portrait' }), { icons: iconSet(defaultIcon(cfg, 64), cfg), platform: 'android' }), 'native/mirage-native.json'), /sensorPortrait/);
});

await ok('the validators themselves reject what is broken', () => {
  assert.equal(checkXML('<a><b></a>').ok, false); assert.equal(checkXML('<a/><b/>').ok, false); assert.equal(checkXML('<a x=1/>').ok, false); assert.equal(checkXML('<a>&nope;</a>').ok, false);
  assert.equal(checkXML('<?xml version="1.0"?><a x="1"><b/>t &amp; u</a>').ok, true);
  assert.throws(() => parsePlist('<plist><dict><string>x</string></dict></plist>')); assert.throws(() => parsePlist('<dict/>'));
  assert.throws(() => parseTOML('a = 1\na = 2')); assert.throws(() => parseTOML('just words')); assert.throws(() => parseTOML('a = nope'));
  assert.deepEqual(parseTOML('[a.b]\nc = { version = "2", features = ["x", "y"] }\nd = true # no\n'.replace(' # no', '')), { a: { b: { c: { version: '2', features: ['x', 'y'] }, d: true } } });
});

await ok('icons: resize keeps flat colour and alpha, ICO and ICNS headers are right', () => {
  const flat = { w: 8, h: 8, data: new Uint8Array(8 * 8 * 4).map((_, i) => [10, 200, 30, 255][i % 4]) };
  for (const s of [3, 8, 20]) { const r = resizeRGBA(flat, s); assert.equal(r.data.length, s * s * 4); for (let i = 0; i < r.data.length; i++) assert.equal(r.data[i], [10, 200, 30, 255][i % 4]); }
  const clear = { w: 4, h: 4, data: new Uint8Array(64) };
  assert.deepEqual([...padded(clear, 4, '#102030', 1).data.slice(0, 4)], [16, 32, 48, 255]);
  assert.throws(() => iconSet({ w: 4, h: 5, data: new Uint8Array(80) }, cfg));
  const ico = A['desktop-electron'].get('build/icon.ico');
  assert.equal(ico.readUInt16LE(2), 1); const count = ico.readUInt16LE(4); assert.equal(count, 4);
  for (let i = 0; i < count; i++) { const e = 6 + 16 * i, size = ico[e] || 256, len = ico.readUInt32LE(e + 8), off = ico.readUInt32LE(e + 12); assert.equal(decodePNG(ico.subarray(off, off + len)).w, size); }
  const icns = A['desktop-electron'].get('build/icon.icns');
  assert.equal(icns.toString('latin1', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  let pos = 8; const types = [];
  while (pos < icns.length) { const len = icns.readUInt32BE(pos + 4); types.push(icns.toString('latin1', pos, pos + 4)); decodePNG(icns.subarray(pos + 8, pos + len)); pos += len; }
  assert.deepEqual(types, ['ic11', 'ic12', 'ic07', 'ic08', 'ic09', 'ic10']);
});

await ok('apply-native: merges into a native project like the ones Capacitor makes, and is idempotent', () => {
  const info = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>App</string>\n\t<key>UISupportedInterfaceOrientations</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t</array>\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<false/>\n\t</dict>\n\t<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<true/>\n</dict>\n</plist>\n';
  assert.deepEqual(plistEntries(info).map((e) => e.key), ['CFBundleDisplayName', 'UISupportedInterfaceOrientations', 'NSAppTransportSecurity', 'UIViewControllerBasedStatusBarAppearance']);
  const r = mergePlist(info, text(A.ios, 'native/ios/Info.additions.plist'));
  const merged = parsePlist(r.text);
  assert.equal(merged.CFBundleDisplayName, 'App'); assert.deepEqual(merged.NSAppTransportSecurity, { NSAllowsArbitraryLoads: false });
  assert.deepEqual(merged.UISupportedInterfaceOrientations, ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight']);
  assert.equal(merged.UIViewControllerBasedStatusBarAppearance, false); assert.equal(merged.UIRequiresFullScreen, true);
  assert.deepEqual(mergePlist(r.text, text(A.ios, 'native/ios/Info.additions.plist')).changed, []);
  const native = JSON.parse(text(A.android, 'native/mirage-native.json')).android;
  const manifest = '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="@string/app_name">\n        <activity\n            android:configChanges="orientation|keyboardHidden"\n            android:name=".MainActivity"\n            android:exported="true">\n            <intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>\n        </activity>\n    </application>\n    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>\n';
  const m = patchManifest(manifest, native.manifest);
  assert.ok(checkXML(m.text).ok, checkXML(m.text).error);
  assert.match(m.text, /<activity[^>]*android:screenOrientation="sensorLandscape"[^>]*>/); assert.match(m.text, /glEsVersion="0x00030000"/); assert.match(m.text, /android\.hardware\.gamepad/);
  assert.ok(m.text.indexOf('uses-feature') < m.text.indexOf('<application'));
  assert.deepEqual(patchManifest(m.text, native.manifest).changed, []);
  const styles = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">\n        <item name="windowActionBar">false</item>\n        <item name="android:windowFullscreen">false</item>\n    </style>\n    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen"></style>\n</resources>\n';
  const s = patchStyle(styles, native.style, native.styleItems);
  assert.ok(checkXML(s.text).ok, checkXML(s.text).error);
  assert.match(s.text, /<item name="android:windowFullscreen">true<\/item>/); assert.match(s.text, /windowLayoutInDisplayCutoutMode">shortEdges/); assert.match(s.text, /windowActionBar">false/);
  assert.deepEqual(patchStyle(s.text, native.style, native.styleItems).changed, []);
  assert.equal(patchStyle('<resources/>', native.style, native.styleItems).missing, true);
});

await ok('toolchain detection looks and does not install', () => {
  const none = detectToolchains({ env: { PATH: '/nowhere', HOME: '/nohome' }, exists: () => false, platform: 'linux' });
  assert.ok(Object.values(none).every((v) => v === false));
  const some = detectToolchains({ env: { PATH: '/bin', HOME: '/h' }, exists: (p) => p === '/bin/cargo' || p === '/bin/xcodebuild', platform: 'darwin' });
  assert.equal(some.cargo, true); assert.equal(some.xcodebuild, true); assert.equal(some.electron, false);
});

// second opinions from the system, where it has them (they are looked for, not required)
const have = (bin) => spawnSync('which', [bin]).status === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-ship-lint-'));
const lint = [];
if (have('plutil')) for (const [t, p] of [['ios', 'native/ios/Info.additions.plist'], ['ios', 'native/ios/PrivacyInfo.xcprivacy'], ['desktop-electron', 'build/entitlements.mac.plist']]) {
  const f = path.join(dir, path.basename(p)); fs.writeFileSync(f, A[t].get(p)); execFileSync('plutil', ['-lint', f]); lint.push('plutil ' + path.basename(p));
}
if (have('xmllint')) for (const p of ['native/android/AndroidManifest.additions.xml', 'native/android/styles.additions.xml']) {
  const f = path.join(dir, path.basename(p)); fs.writeFileSync(f, A.android.get(p)); execFileSync('xmllint', ['--noout', f]); lint.push('xmllint ' + path.basename(p));
}
if (have('sips')) { const f = path.join(dir, 'icon.icns'); fs.writeFileSync(f, A['desktop-electron'].get('build/icon.icns')); const o = execFileSync('sips', ['-g', 'pixelWidth', f]).toString(); assert.match(o, /pixelWidth: 1024/); lint.push('sips icon.icns'); }
fs.rmSync(dir, { recursive: true, force: true });
console.log(`  ok  system tools agree: ${lint.join(', ') || 'none found on this machine (skipped)'}`);
console.log(`ship.check: ${n} groups passed`);
