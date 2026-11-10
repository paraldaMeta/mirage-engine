// Mirage original code. Electron preload written by `mirage-ship` (template). The page gets one small object and
// no Node: window.mirageNative, the same shape in every wrapper (@mirage/game/platform talks to it).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('mirageNative', {
  platform: 'electron',
  os: process.platform,
  save: {
    keys: () => call('mirage:save:keys'),
    get: (key) => call('mirage:save:get', String(key)),
    set: (key, value) => call('mirage:save:set', String(key), String(value)),
    remove: (key) => call('mirage:save:remove', String(key)),
  },
  window: {
    setFullscreen: (on) => call('mirage:window:setFullscreen', !!on),
    isFullscreen: () => call('mirage:window:isFullscreen'),
  },
  keepAwake: (on) => call('mirage:keepAwake', !!on),
  quit: () => call('mirage:quit'),
});
