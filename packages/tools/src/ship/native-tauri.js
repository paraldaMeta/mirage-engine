// Mirage original code. Tauri side of window.mirageNative (written by `mirage-ship`, loaded by index.html before
// the game). Needs "withGlobalTauri": true (set in tauri.conf.json) and the commands in src-tauri/src/main.rs.
// Outside Tauri (the same www/ opened in a browser) it does nothing and the game falls back to the web.
(() => {
  const T = window.__TAURI__;
  const invoke = T && T.core && T.core.invoke;
  if (!invoke) return;
  // F11 and Alt+Enter toggle fullscreen: a system WebView has no browser menu to do it
  window.addEventListener('keydown', (e) => {
    if (e.repeat || !(e.key === 'F11' || (e.key === 'Enter' && e.altKey))) return;
    e.preventDefault();
    invoke('is_fullscreen').then((on) => invoke('set_fullscreen', { on: !on })).catch(() => {});
  }, true);
  window.mirageNative = {
    platform: 'tauri',
    save: {
      keys: () => invoke('save_keys'),
      get: (key) => invoke('save_get', { key: String(key) }),
      set: (key, value) => invoke('save_set', { key: String(key), value: String(value) }),
      remove: (key) => invoke('save_remove', { key: String(key) }),
    },
    window: {
      setFullscreen: (on) => invoke('set_fullscreen', { on: !!on }),
      isFullscreen: () => invoke('is_fullscreen'),
    },
    quit: () => invoke('quit'),
  };
})();
