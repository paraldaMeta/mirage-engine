// The guns' sounds rendered off the main thread (sfx.js): one job a message, the samples sent back (transferred).
import { SOUNDS } from './gunsound.js';

self.onmessage = (e) => {
  const { i, name, v, SR } = e.data, d = SOUNDS[name].render(SR, v);
  self.postMessage({ i, d }, [d.buffer]);
};
