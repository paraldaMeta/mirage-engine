# Platforms: web, PWA, desktop and phone wrappers

Mirage is a WebGL2 engine. Everything on this page puts that same web build somewhere else: on a static host, in
an installable PWA, in a desktop window (Electron or Tauri) or in a phone app (Capacitor). It is experimental and
opt-in; a page that imports none of it renders exactly what it rendered before (six stills on two examples, base
against this branch with the flags off: 0 differing pixels).

Read "What was and was not verified" and "What Unity and Unreal still have" before promising anyone a store
release.

## 1. `mirage-ship`

```
node packages/tools/src/ship.mjs examples/garden-quest --target pwa --out ship/garden-pwa
    [--name "Garden Quest"] [--id studio.example.gardenquest] [--version 1.2.0] [--icon icon.png]
    [--orientation landscape|portrait|any] [--theme #101418] [--background #000000]
    [--query platform=1] [--author "Studio"] [--dist built-folder] [--isolated] [--json]
```

`--query` (desktop-electron) is the query string the window opens the game with, e.g. `platform=1` to mount the
run-time layer below; only `key=value` pairs joined by `&` are accepted (no path, fragment or other origin, at most
200 characters). `--author` is the publisher name installers show (default: the example's `package.json` author,
else the name).

It builds the example with Vite (`--base ./`, or takes `--dist`), then writes files. It uploads nothing, installs
nothing, downloads nothing and signs nothing. The same input gives byte-identical output (checked).

| target | what is written |
| --- | --- |
| `web` | the static build, `_headers` (Netlify / Cloudflare Pages form) and `headers.json` (the same rules for any host): `/assets/*` immutable for a year (hashed names), `*.html` / `sw.js` / the manifest `no-cache`; `HOSTING.txt`. `--isolated` adds COOP `same-origin` + COEP `require-corp`: the engine does not need them (no SharedArrayBuffer), and they break cross-origin embeds without CORP, so they are off by default. |
| `pwa` | `web` plus `manifest.webmanifest`, icons made from one square PNG (192, 512, maskable 512 with the safe zone, apple-touch 180), `sw.js`, `pwa.js` (registration, install and update hooks) and the tags in every HTML file. |
| `single` | one HTML file (the existing `mirage-package`). |
| `desktop-electron` | an Electron project: `main.cjs`, `preload.cjs`, `package.json` with `electron-builder` config (fuses, `npm run dist:win`), icons, the build under `www/`. Built and run on macOS: section 4. |
| `desktop-tauri` | a Tauri 2 project: `src-tauri/` (`tauri.conf.json`, `Cargo.toml`, `src/main.rs`, capabilities, icons), the bridge script, the build under `www/`. |
| `ios`, `android` | a Capacitor 8 project: `capacitor.config.json`, the bridge script, `native/` settings (Info.plist additions and `PrivacyInfo.xcprivacy`, or AndroidManifest attributes) with `scripts/apply-native.mjs` to apply them after `npx cap add`, icon and splash sources under `assets/`. |

Electron, Tauri and Capacitor are **not** dependencies of this repository. Each scaffold's own `package.json`
names them (versions read from the npm registry on 2026-11-11, not installed here); the owner runs `npm install`
inside the scaffold. `mirage-ship` reports which toolchains it found and never installs one.

### The service worker

Written for this engine, no library. The cache name is `mirage-<slug>-<version>-<hash of the file list>`, so any
changed file is a new version. Install precaches every file of the build; fetch answers same-origin GETs from the
cache (navigations fall back to `index.html`, query strings are ignored for lookup) and leaves everything else to
the network. A new version installs beside the old one and **waits**: `registerServiceWorker(url, { onUpdate })`
hands the game an `apply()`; calling it sends `SKIP_WAITING`, the new worker takes over, old caches are deleted and
the page reloads once. Nothing reloads under a player without the game asking.

### What every wrapper sets up

| | Electron | Tauri 2 | Capacitor (iOS / Android) |
| --- | --- | --- | --- |
| content security policy | response header on the app's own protocol; no remote origin, no JS `eval` (`'wasm-unsafe-eval'` only) | `app.security.csp` in `tauri.conf.json` | `<meta>` in every HTML file |
| GPU | `force_high_performance_gpu`; `MIRAGE_IGNORE_GPU_BLOCKLIST=1` as an owner's switch | the system webview decides; not controllable | the system webview decides |
| fullscreen | real window; F11, Alt+Enter, Ctrl+Cmd+F | `set_fullscreen` command | status bar hidden, `UIRequiresFullScreen` (iOS), `windowFullscreen` with the cutout used (Android) |
| window state | size, place, maximized, fullscreen in `window-state.json`, restored only on a screen that still exists | `tauri-plugin-window-state` | not applicable |
| gamepad, pointer lock | Chromium's own; pointer lock, fullscreen and keyboard lock are the only permissions granted | webview's own (pointer lock on WebKitGTK is unreliable) | gamepads through the webview (`GCSupportsControllerUserInteraction` on iOS); no pointer lock on phones: touch controls |
| safe area, orientation | not applicable | not applicable | `viewport-fit=cover`; orientation in the native settings and `orientation.lock` at run time |
| saves | one file per key in `<userData>/saves` | one file per key in `<app data>/saves` | `@capacitor/preferences` (UserDefaults / SharedPreferences) |
| navigation | new windows and foreign URLs refused (https links open in the system browser) | `core:default` capability only | no `allowNavigation` entry, no mixed content |

Each wrapper puts one object on the page, `window.mirageNative`
(`{ platform, save: { keys, get, set, remove }, window: { setFullscreen, isFullscreen }, orientation: { lock, unlock }, keepAwake(on), quit() }`).
The engine talks only to that and never imports a wrapper's library.

## 2. The run-time layer

Two subpath modules; nothing in the engine imports them.

```js
import { probeDevice, createContextRecovery, createQualityGovernor } from '@mirage/core/platform';
import { createPlatform, createSaveStorage, registerServiceWorker, createInstallPrompt } from '@mirage/game/platform';

const caps = await probeDevice();                       // tier 0..3, limits, float targets, battery, ... -> quality + settings
const world = createWorldRenderer({ quality: caps.quality, dynamicRes: caps.settings.dynamicRes, ... });
const saves = await createSaveStorage();                // the wrapper's save folder, else localStorage, else memory
const g = await startGame(world, { built, storage: saves });
const recovery = createContextRecovery(world, { play: g.play });
const governor = createQualityGovernor({ world, play: g.play }); governor.attach();
const platform = createPlatform({ canvas, play: g.play, game: g.game, audio: g.audio, saves, wakeLock: true });
```

- **Device probe** (`probeDevice`, `qualityFor`, `gpuTier`). Extends `pickQuality`: reads the WebGL renderer
  string into a tier (0 software, 1 low, 2 mid, 3 high: Adreno, Mali, Immortalis, Xclipse, PowerVR, Apple, Intel,
  desktop cards), the limits (texture size, samples, float and half-float targets, compressed formats), cores,
  memory, save-data, battery. It never picks `high` by itself and a saved player choice wins. The tier table was
  written from vendors' public model lines; **it was not measured on devices**, and iOS reports only "Apple GPU",
  so every iPhone is one tier.
- **Quality governor** (`createQualityGovernor`, pure rule `governorStep`). A browser exposes no temperature. The
  governor uses what exists: the Battery Status API, the Compute Pressure API (Chrome, desktop) and the median
  frame interval over a time window. Steps: full, resolution x0.85, x0.7, x0.7 at 30 fps. It steps down fast and
  up slowly; a climb that has to be taken back doubles the wait (up to 8x), so a slow device does not see-saw.
  On Safari and Firefox only the frame-time signal exists.
- **Context loss** (`createContextRecovery`). On `webglcontextlost` it stops `play`; on restore it calls
  `world.contextRestored()` (re-bakes what lived only in render targets), runs the game's own `onRestore`
  callbacks and restarts `play` if it was running.
- **Page life** (`createPlatform`). Hidden: pause the game, suspend audio, release the wake lock, flush saves.
  Shown: audio and wake lock return; the game stays paused unless `resumeOnShow`. Audio unlock on the first
  gesture and again after an interruption. Fullscreen, orientation lock, wake lock and quit go through the wrapper
  when there is one, else the web API; where neither exists the call answers `{ ok: false, why }`. Safe-area
  insets are measured and written to `--mirage-safe-top/right/bottom/left` on `:root` (the UI toolkit's
  `safeArea` already reads `env()`; this adds numbers and an `insets` event). `inputmode` says `touch`, `pad` or
  `keyboard` from what the player last used. `storage.persist()` asks the browser not to evict saves.
  `pauseOnBlur` (default `false`): a desktop window behind another one is still visible, so Alt+Tab or Cmd+Tab
  pauses nothing by itself; `true` pauses the game when the window loses focus, a function is called instead (the
  examples open the pause menu with it). Focus never resumes the game. The examples' `?platform=1` turns it on only
  inside a wrapper (`window.mirageNative.window` exists), so a browser tab behaves as before.
- **Saves** (`createSaveStorage`). The game's storage is synchronous; a native folder is not. It reads every save
  once at start, answers reads from memory and writes behind in order. A failed write is kept, listed in
  `errors` and retried on the next `flush()`.
- **8-bit render targets** (`@mirage/core/byte-targets`, `createWorldRenderer({ byteTargets: true })`). On a
  context with neither `EXT_color_buffer_float` nor `EXT_color_buffer_half_float` the world's half-float targets
  are incomplete and the canvas is black. The renderer now switches them to 8 bits there, automatically; the option
  forces it elsewhere. It covers targets that hold colour. Features that store numbers in float targets (GPU
  particles, probe GI, Hi-Z, auto exposure) are not covered and stay off on such a device.

## 3. Try it

- `examples/hello-courtyard` and `examples/garden-quest`: `?platform=1` (probe picks the quality, recovery, governor
  and the page layer are mounted; `window.__platform` holds them and an event log).
- `examples/hello-courtyard`: `?bytetargets=1` forces 8-bit targets on a normal GPU.
- `await __platform.recovery.simulate({ hold: 300 })` in the console loses and restores the context.

## 4. What was and was not verified

Everything below ran on one Mac (shared with other jobs, so timings are noisy) in headless Chrome.
**No real phone, no real installed app, no store submission.**

| check | command | result |
| --- | --- | --- |
| generators | `node packages/tools/ship.check.mjs` (in `npm test`) | deterministic output; JSON, TOML, XML and plist parse; CSP, bridge and worker structure; 15 groups pass |
| page layer | `node packages/game/platform.check.mjs`, `node packages/core/platform.check.mjs` (in `npm test`) | pass |
| PWA offline, update, CSP | `npm run test:ship` | garden-quest PWA, 33 files, 3.98 MB: first load 1671 ms, controlled and cached (27 files) after 1817 ms; server down: reload ready in 793 ms, with another query string 707 ms; update waits, applies on request, one reload, old cache gone. Electron / Tauri header CSP: game starts, no violation, inline script and foreign fetch refused. Capacitor meta CSP: starts, no violation |
| context loss | `npm run test:context-loss` | hello-courtyard back in 309 / 313 ms (300 ms held lost), 1850 / 2545 of 518400 px differ by at most 1/255; garden-quest 317 / 307 ms, 71367 px by at most 1/255. Control without recovery: all 518400 px differ |
| phone emulation | `npm run test:mobile` | see below |

Phone emulation: 844x390 at device pixel ratio 3, touch, an Android user agent, and a wrapper around the GL
context that reports a 4096 texture limit, 4 samples, a Mali-G52 and hides float colour targets, float filtering
and the desktop compressed formats (`phone`), then also half-float targets (`no-float`). Both examples start,
draw a non-black frame with no GL error and no console error under both profiles; the `no-float` profile is what
found the black canvas fixed by the 8-bit targets (canvas mean 0.5 before, 96 after, 97 with floats). Frame time
at `low` (the probe picks it: tier 1, mobile, no float targets), 60 moving frames, three interleaved rounds,
median (range of the rounds' medians):

| | 1x CPU | 4x throttle | 6x throttle |
| --- | --- | --- | --- |
| hello-courtyard | 1.9 ms (1.3-2.3) | 3.1 ms (1.7-3.4) | 2.2 ms (2.0-2.5) |
| garden-quest | 3.6 ms (3.2-6.4) | 6.1 ms (5.9-7.8) | 7.9 ms (7.9-8.8) |

The drawing buffer is 844x390 (the probe sets pixel ratio 1 on a tier-1 phone). Two earlier runs of the same
check gave garden-quest 4.7 and 5.9 ms at 6x: the machine is shared and the run-to-run spread is about 2 ms.
These numbers say little about a phone: CPU throttling slows JavaScript only, the GPU underneath is a desktop
one, and on the small scene the spread is as large as the effect. They show that the CPU side of a `low` frame
fits a 16.7 ms budget at 6x (worst p95 10.4 ms); GPU cost on a phone is **not measured**.

Not run, because the toolchains are not on this machine (detected, not installed): Rust / Tauri, Capacitor,
Xcode builds, Gradle. So: `main.rs` has never been compiled; `npx cap add` has never been run against these
scaffolds; no `.ipa` or `.apk` was produced. Those wrapper files are checked for structure and their CSP is checked
in Chrome, nothing more. Expect to fix things on the first real build. Electron is the exception: next section.

### Electron, built and run (macOS only)

On 2026-11-11, on one Mac (Apple M4 Pro, macOS 26, 120 Hz display), with Electron 45.3.0 and electron-builder
26, garden-quest was shipped with `--target desktop-electron --query platform=1`, installed (`npm install` in the
scaffold, about 30 s) and checked with `desktop-check` (below), first as `electron .`, then as the packaged app.

| | `electron .` | packaged `.app` (unsigned, fuses set) |
| --- | --- | --- |
| desktop-check | 21 of 21 pass | 21 of 21 pass |
| start to `window.__READY` | 3765 ms first run after install, 1153 ms after that; 1071 ms on the restart | 4270 ms first start of the new binary; 1050 ms on the restart |
| GPU | ANGLE Metal, Apple M4 Pro | same |
| frame interval while walking (4 s, the window paced by vsync) | median 8.34 ms, p95 8.86, worst 9.34 | median 8.33 ms, p95 9.02, worst 9.28 |
| crashed page (`Page.crash`) back to ready | 806 ms | 896 ms |
| quit through the bridge | exit 0 after 130 ms | exit 0 after 136 ms |

| artefact | command | size |
| --- | --- | --- |
| `Garden Quest.app` (arm64) | `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir` (5 s) | 274 MB unpacked (the game's `www/` is 4.0 MB of it) |
| `Garden Quest-1.0.0-arm64-mac.zip` | `... --mac zip` (34 s) | 118.0 MB; the app inside passes `codesign --verify --deep --strict` (ad hoc) |
| `Garden Quest Setup 1.0.0.exe` (x64 NSIS) | `npx electron-builder --win nsis --x64` from the Mac, no Wine (22 s) | 122.8 MB; the unpacked app is 381 MB and its fuses read as set. **Not run on Windows.** |

What the first real run found and fixed:
- **Electron 45 no longer downloads its binary on `npm install`.** The scaffold's `postinstall` runs
  `install-electron`, which fetches it and checks it against Electron's published SHA-256 sums.
- **Fuses broke the unsigned Mac app.** Flipping a fuse edits the executable; the ad-hoc signature no longer
  matched and Apple Silicon killed the app at start (SIGKILL, no window, no message). The fuse config now has
  `resetAdHocDarwinSignature: true`, which re-signs ad hoc after the flip; a Developer ID signature still replaces
  it when you sign.
- The page's `<title>` replaced the window title; the window now keeps the game's name.
- `package.json` had no `author` (electron-builder warns, installers show an empty publisher): `--author`.
- Alt+Tab away from the window left the game running (the window stays visible): `pauseOnBlur`.

Fuses, set by electron-builder when it packages (`build.electronFuses`): no `ELECTRON_RUN_AS_NODE`, no
`NODE_OPTIONS`, no `--inspect`, code loaded only from `app.asar` and checked against the hash in the executable,
cookie encryption on, no extra `file://` privileges. Checked: with `ELECTRON_RUN_AS_NODE=1` the plain Electron
binary runs a Node script, the packaged app ignores the variable and starts the game. `--remote-debugging-port` is
a Chromium switch and still works, which is what lets desktop-check drive the packaged app; a player can use it
too, and it gives access to the page only, not to Node.

A crashed page (out of memory, a GPU reset that took the renderer down) is reloaded once; a second crash within a
minute shows a message and quits instead of looping. Only the first half was exercised (one `Page.crash`).

#### desktop-check

```
node packages/tools/src/desktop-check.mjs <scaffold folder>                         # electron .
node packages/tools/src/desktop-check.mjs <scaffold folder> --exe "dist/mac-arm64/Garden Quest.app/Contents/MacOS/Garden Quest"
npm run test:desktop -- <scaffold folder>       # or MIRAGE_DESKTOP_APP=<folder> npm run test:desktop
```

It starts the app with a throwaway profile folder and a local DevTools port, drives it with puppeteer-core and
checks, in order: it starts; the window opens where `window-state.json` says; the GPU renderer is not a software
one; the page has no `require`, `process`, `module`, `Buffer` or `global`; `window.mirageNative` is the one bridge
and the page cannot overwrite it; cross-origin isolation; saves round-trip and are files in `<profile>/saves`, a
key like `../escape` stays inside; a foreign fetch, a pop-up and a navigation away are refused and camera,
microphone, location and notifications are denied; frame intervals while walking; window blur pauses the game and
opens the menu (with `?platform=1`); a crashed page is reloaded; a second copy hands over and exits 0; quit through
the bridge writes the window state; a second launch finds the save and opens the window at the same place; no
console error over all of it (the refusals it provokes on purpose are not counted). Without Electron in the folder,
or with no folder at all, it prints `skipped` and exits 0: Electron is not a dependency of this repository.

It opens a real window on the screen for about 15 s. Limits: blur is a synthetic `blur` event, not a real focus
change from the OS; Electron has no DevTools call that moves its window, so the window state is seeded through the
state file rather than by dragging; it was run on macOS only.

Still not verified for the desktop: **Windows and Linux were not run** (the NSIS installer was built, never
installed; no AppImage was built). **Signing and notarization were not done** (no certificate here; section 5).
Real Alt+Tab, a second monitor, a laptop with two GPUs, fullscreen across Spaces and gamepads in the packaged app
were not tried. Steam is documentation only (section 5): no Steamworks, no overlay test. Tauri was not built.

## 5. Store readiness: what the owner must do

Signing, accounts and store forms cannot be done by a tool and are not attempted. No key, certificate, password
or token belongs in the project folder or in git.

**Web / PWA**
- [ ] HTTPS host; serve the headers from `_headers` / `headers.json`.
- [ ] Replace the placeholder icon (`--icon`, 1024 px square or more); check the maskable icon in a mask preview.
- [ ] Real `name`, `short_name`, `description`, theme colour; screenshots in the manifest if you want the richer install sheet.
- [ ] Bump `--version` for every release (the cache name depends on it and on the files).
- [ ] iOS: there is no install prompt; show "Share, then Add to Home Screen" (`createInstallPrompt().ios`).
- [ ] A privacy page if you add analytics; the engine itself sends nothing.

**Windows / macOS / Linux (Electron or Tauri)**
- [ ] Real app id (`--id`, reverse DNS you own) and icons.
- [ ] Windows: a code-signing certificate (or Azure Trusted Signing); without it SmartScreen warns.
- [ ] macOS: Apple Developer membership, a Developer ID Application certificate, hardened runtime, notarization
      (`notarytool`) and stapling. Kept in your keychain or CI secrets, never in the scaffold.
- [ ] Mac App Store or Microsoft Store: sandbox entitlements / MSIX packaging are not generated.
- [ ] Steam, itch, Epic: upload the built folder with their tools; Steamworks (achievements, cloud saves, overlay) is not integrated, and the Steam overlay over an Electron window was not tried.
- [ ] Run `desktop-check` against your own packaged app on every OS you ship for (it was run on macOS only).
- [ ] Auto-update is not set up (electron-updater / the Tauri updater need your signing key and a feed).
- [ ] Test on a machine with an integrated GPU and on one with old drivers.

**iOS (Capacitor)**
- [ ] A Mac with Xcode, an Apple Developer membership, a bundle id registered to you.
- [ ] `npm install`, `npx cap add ios`, `node scripts/apply-native.mjs`, then icons and splash from `assets/` (`@capacitor/assets`).
- [ ] Signing team, distribution certificate and provisioning profile in Xcode (automatic signing is fine).
- [ ] `PrivacyInfo.xcprivacy` is generated with one entry: UserDefaults, reason CA92.1 (saves). Add an entry for
      every SDK you add; fill in App Privacy ("nutrition labels") in App Store Connect to match.
- [ ] Export compliance (encryption) answer, age rating, screenshots for the required device sizes.
- [ ] Review guideline 4.2: an app that is only a web page can be rejected; it must work offline (it does: the build is inside the app) and feel like an app.
- [ ] Test on real devices: WKWebView memory limits, thermal behaviour and audio interruptions are not emulated here.

**Android (Capacitor)**
- [ ] Android Studio, a JDK, a Play Console account, an application id you own.
- [ ] `npm install`, `npx cap add android`, `node scripts/apply-native.mjs`, icons and splash.
- [ ] An upload keystore you create and back up yourself; enrol in Play App Signing. Keep the keystore and its
      passwords out of the project (`keystore.properties` in `.gitignore`, or CI secrets).
- [ ] Target the API level Play currently requires; build an `.aab`.
- [ ] Data safety form (the engine collects nothing; saves stay on the device), content rating, store listing.
- [ ] Test on a low-end device (Mali-G52 class) and one with an old system WebView.

**Consoles.** PlayStation, Xbox and Switch need licensed SDKs, dev kits and agreements under NDA. Nothing here
targets them and nothing here can. Xbox can run a web game in Edge; that is a browser, not a console release.

## 6. What Unity and Unreal still have

- **Native renderers.** Metal, Vulkan and DX12 back ends with compute, mesh shaders, hardware ray tracing and
  explicit memory control. Here every target is WebGL2 inside a browser engine, with its limits and its overhead.
- **Consoles**, with certification-ready builds.
- **Native performance tooling.** Platform profilers, GPU captures tied to engine markers, memory profilers,
  thermal and power traces on device, automated device farms. Here: the browser's tools and a desktop emulation.
- **Store integrations.** In-app purchases, achievements, leaderboards, cloud saves, push messages, ads, crash
  reporting, auto-update: none are integrated.
- **Build pipelines that produce the signed artefact** for every target from one editor, with texture formats and
  shader variants cooked per platform. Here: scaffolds the owner still has to build, sign and test.
- **Real device coverage.** Years of fixes for specific phones and drivers. Here: none tested.
