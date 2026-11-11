// Check: garden-quest with ?audio=engine. The game's own sounds still play (through the engine's buses), the chime
// is muffled by the pavilion walls from the gate and clear inside, and the pavilion zone fades in at its door.
// node examples/garden-quest/scripts/audio-engine.mjs [dist]   (build first: npm run build -w garden-quest)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist'));
const srv = await serve(dist), b = await launch({ w: 960, h: 600, args: ['--autoplay-policy=no-user-gesture-required'] });
const { page, errors } = await open(b, `${srv.url}?audio=engine&start&w=960&h=600&quality=low&spp=1`);
const r = await page.evaluate(async () => {
  const { g, audioEngine: A } = window.__mirage, { engine, chimeAt } = A, [cx, cy, cz] = chimeAt, wait = (ms) => new Promise((res) => setTimeout(res, ms));
  g.audio.unlock();
  for (let i = 0; i < 200 && engine.stats.state !== 'running'; i++) await wait(20);
  const chime = () => engine.voices.filter((v) => /^chime/.test(v.name));
  let occOut = 0;   // beside the pavilion: a wall between the ears and the chime
  A.ears = { pos: [cx + 8, cy - 1, cz], forward: [-1, 0, 0], up: [0, 1, 0] };
  for (let i = 0; i < 400; i++) { await wait(16); for (const v of chime()) occOut = Math.max(occOut, v.occ); }
  const out = { state: engine.stats.state, zoneOut: engine.stats.zones.pavilion, rays: engine.stats.raysTotal, started: engine.stats.started, occOut };
  const before = g.audio.stats.played.pickup || 0;
  g.audio.play('pickup');
  let peak = 0; for (let i = 0; i < 12; i++) { await wait(16); peak = Math.max(peak, engine.meters().sfx?.peak || 0); }
  out.legacy = (g.audio.stats.played.pickup || 0) - before; out.sfxPeak = peak;
  // stand in the pavilion: the engine follows whatever camera it is given
  let occIn = 1, zoneIn = 0;
  A.ears = { pos: [cx + 1.5, cy - 1, cz + 1.5], forward: [0, 0, -1], up: [0, 1, 0] };
  for (let i = 0; i < 400; i++) { await wait(16); zoneIn = Math.max(zoneIn, engine.stats.zones.pavilion); if (i > 100) for (const v of chime()) occIn = Math.min(occIn, v.occ); }
  A.ears = null;
  return { ...out, zoneIn, occIn, voices: engine.stats.voices, overlay: !!document.querySelector('[data-mirage-audio-debug]') };
});
await b.close(); srv.close?.();
const ok = r.state === 'running' && r.zoneOut === 0 && r.zoneIn === 1 && r.legacy === 1 && r.sfxPeak > 0.005 && r.started > 0 && r.rays > 0 && r.occOut > 0.9 && r.occIn < 0.1 && r.overlay && !errors.length;
console.log(`garden-quest ?audio=engine: context ${r.state}; audio.play('pickup') through the engine's sfx bus, peak ${r.sfxPeak.toFixed(3)}; pavilion zone ${r.zoneOut} outside, ${r.zoneIn} inside; chime occlusion ${r.occOut.toFixed(2)} through the wall, ${r.occIn.toFixed(2)} inside; ${r.rays} rays, ${r.started} voices started; errors ${errors.length} -> ${ok ? 'ok' : 'FAIL'}`);
for (const e of errors) console.log('  ' + e);
process.exit(ok ? 0 : 1);
