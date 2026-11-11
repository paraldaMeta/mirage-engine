// Mirage original code. Capacitor side of window.mirageNative (written by `mirage-ship`, loaded by index.html
// before the game). Uses the bridge Capacitor injects into its WebView, so the game needs no bundler step for it:
// saves -> @capacitor/preferences (UserDefaults on iOS, SharedPreferences on Android: kept with the app, part of
// the device backup), orientation -> @capacitor/screen-orientation, screen on -> @capacitor-community/keep-awake,
// quit -> @capacitor/app (Android only: an iOS app does not close itself).
// Outside Capacitor (the same www/ opened in a browser) it does nothing and the game falls back to the web.
(() => {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const call = (plugin, method, options) => {
    const p = C.Plugins && C.Plugins[plugin];
    if (p && typeof p[method] === 'function') return p[method](options);
    if (typeof C.nativePromise === 'function') return C.nativePromise(plugin, method, options || {});
    return Promise.reject(new Error('Capacitor plugin ' + plugin + ' is not installed'));
  };
  const os = C.getPlatform();
  const native = {
    platform: 'capacitor',
    os,
    save: {
      keys: () => call('Preferences', 'keys').then((r) => r.keys || []),
      get: (key) => call('Preferences', 'get', { key: String(key) }).then((r) => (r.value == null ? null : r.value)),
      set: (key, value) => call('Preferences', 'set', { key: String(key), value: String(value) }).then(() => true),
      remove: (key) => call('Preferences', 'remove', { key: String(key) }).then(() => true),
    },
    orientation: {
      lock: (type) => call('ScreenOrientation', 'lock', { orientation: type === 'any' ? 'any' : type }),
      unlock: () => call('ScreenOrientation', 'unlock'),
    },
    keepAwake: (on) => call('KeepAwake', on ? 'keepAwake' : 'allowSleep'),
  };
  if (os === 'android') native.quit = () => call('App', 'exitApp');
  window.mirageNative = native;
  // the orientation this build was made for (also set in the native project: this covers a rotation lock the OS
  // applies late on some Android versions)
  const want = '__ORIENTATION__';
  if (want !== 'any') native.orientation.lock(want).catch(() => {});
})();
