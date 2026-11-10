// Mirage original code. ?platform=1: the platform layer on an example (docs/platforms.md). Loaded with a dynamic
// import, so without the flag none of this is fetched and the page is what it was.
//   probe()                               the device probe picks the quality (mobile GPU tiers) instead of pickQuality
//   saves()                               the save storage a wrapper maps to its own folder (localStorage in a browser)
//   mount({ world, play, canvas, game, audio, storage })  context-loss recovery, the quality governor, visibility / audio / wake lock /
//                                         fullscreen / safe area; all on window.__platform for the console and the checks
import { probeDevice, createContextRecovery, createQualityGovernor } from '@mirage/core/platform';
import { createPlatform, createSaveStorage } from '@mirage/game/platform';

export const probe = () => probeDevice();
export const saves = () => createSaveStorage();

export function mount({ world, play, canvas, game = null, audio = null, storage = null, caps = null }) {
  const log = [];
  const note = (type, data = {}) => { log.push({ type, t: Math.round(performance.now()), ...data }); if (log.length > 200) log.shift(); };
  const recovery = createContextRecovery(world, { play, canvas, onLost: () => note('context-lost'), onRestored: (i) => note('context-restored', { ms: Math.round(i.ms), count: i.count }), onGiveUp: () => note('context-gave-up') });
  const governor = createQualityGovernor({ world, play, onStep: (step, s) => note('governor', { step, name: s.name, why: s.why }) });
  const detach = governor.attach();
  const platform = createPlatform({ canvas, play, game, audio, saves: storage, wakeLock: true });
  for (const type of ['pause', 'resume', 'fullscreen', 'insets', 'orientation', 'inputmode', 'audio']) platform.on(type, (d) => note(type, d && typeof d === 'object' ? d : { value: d }));
  return { caps, recovery, governor, platform, saves: storage, log, dispose() { detach(); governor.dispose(); recovery.dispose(); platform.dispose(); } };
}
