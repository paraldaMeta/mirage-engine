#!/usr/bin/env node
// Frames of the city as a weapon (kit.js): the scan view, a zone gone dark with its robots outlined, a turned kite at
// work, the shield sentinel, the marksman's beam, the HUD with its cooldowns, the ammo marker, a comic hit word.
//   node scripts/kitshots.mjs [dist] [--out out/kit] [--quality medium]
// Driven with real keys where the player would use them (G held, 1, 2); the page's API places the view.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const OUT = path.resolve(flag('out', path.join(here, '../out/kit'))), W = 1280, H = 720, quality = flag('quality', 'medium'), lang = flag('lang', 'en');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve(dist), b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&start=1&assist=1&grain=0&quality=${quality}&lang=${lang}`);
await sleep(3000);
const place = (eye, look) => page.evaluate((eye, look) => { const m = window.__mirage; const l = typeof look === 'string' ? m.g.game.where(m.g.game.entities.get(look)) : look; m.play.place(eye, l, 'walk'); }, eye, look);
const lookAt = (look) => page.evaluate((look) => { const m = window.__mirage; const l = typeof look === 'string' ? m.g.game.where(m.g.game.entities.get(look)) : look; m.play.lookAt(l); }, look);
const flags = () => page.evaluate(() => ({ ...window.__mirage.g.game.flags }));
let n = 0;
const shot = async (name) => { const f = `${String(++n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: path.join(OUT, f) }); console.log(f); };

// 1. the scan view, the ring filling on a street lamp
await place([-14.5, 1.62, 8.4], [-17, 5.0, 7.85]);
await sleep(1500);
await page.evaluate(() => window.__mirage.game.enemies.wake('street', window.__mirage.game.player.feet));
await page.keyboard.down('KeyG'); await sleep(450);
await lookAt([-17, 5.0, 7.85]);
await shot('scan-view');
await sleep(700); await page.keyboard.up('KeyG');
console.log('dark zones', (await flags()).darkNow);
// 2. the zone dark: look down the street at the sentinels
await sleep(900); await lookAt([-3, 1.2, 5.5]); await sleep(500);
await shot('zone-dark');
// 3. a turned kite: hacked with the key, then watched from behind it as it works a sentinel over
await page.evaluate(() => { const m = window.__mirage, d = m.game.drones.list.find((e) => e.id === 'd0'); m.game.drones.revive(d, [-9, 4.5, 6.5]); });
await sleep(300); await lookAt('d0');
await page.keyboard.down('KeyG'); await sleep(1100); await page.keyboard.up('KeyG');
console.log('kites turned', (await flags()).kitesTurned);
// behind the kite, looking past it at its prey; the frame is taken just after a bolt
const prey = await page.evaluate(() => { const d = window.__mirage.game.drones.list.find((e) => e.id === 'd0'); return d.target ? d.target.id : null; });
console.log('prey', prey);
for (let i = 0; i < 40; i++) {
  await sleep(60);
  const k = await page.evaluate(() => { const m = window.__mirage, d = m.game.drones.list.find((e) => e.id === 'd0'), t = d.target; return t ? { d: d.pos.slice(), t: [t.pos[0], t.pos[1] + 1.2, t.pos[2]], next: d.next } : null; });
  if (!k) continue;
  if (i === 0 || k.next > 0.7) {
    const dx = k.t[0] - k.d[0], dz = k.t[2] - k.d[2], l = Math.hypot(dx, dz) || 1;
    await place([k.d[0] - dx / l * 3.2, 1.62, k.d[2] - dz / l * 3.2], [(k.d[0] + k.t[0]) / 2, (k.d[1] + k.t[1]) / 2, (k.d[2] + k.t[2]) / 2]);
    if (k.next > 0.7) break;
  }
}
await shot('turned-kite');
// 4. the shield sentinel, from in front
await page.evaluate(() => { const m = window.__mirage, e = m.game.enemies.list.find((x) => x.id === 'g11'); m.game.enemies.revive(e, [3.5, 0, 7]); e.yaw = -1.57; });
await place([-2.5, 1.62, 7.2], [3.5, 1.2, 7]); await sleep(1200); await lookAt('g11');
await shot('shield');
// 5. the marksman's beam from the plaza
await page.evaluate(() => { const m = window.__mirage; for (const e of m.game.enemies.list) if (e.def.zone !== 'plaza') m.game.enemies.park(e); for (const d of m.game.drones.list) m.game.drones.park(d); });
await place([15, 1.76, -9], [17.5, 7.6, -20.8]); await sleep(400);
await page.evaluate(() => { const m = window.__mirage; m.game.enemies.wake('plaza', m.game.player.feet); });
for (let i = 0; i < 40; i++) { await sleep(150); const c = await page.evaluate(() => window.__mirage.game.enemies.list.find((x) => x.id === 'g12').charge); if (c > 0.7) break; }
await lookAt([17.5, 7.6, -20.8]);
await shot('marksman-beam');
// 6. the HUD: dash and grenade cooling down, the overdrive part charged, a comic word, low ammunition
await page.evaluate(() => { const m = window.__mirage; m.game.kit.abilities.gain(0.62); m.game.weapon.S.reserve = 10; });
await place([10.2, 1.76, 0.9], [19, 2.6, -11]); await sleep(800);
await page.keyboard.press('Digit1'); await sleep(300); await page.keyboard.press('Digit2'); await sleep(1500);
await page.evaluate(() => { const m = window.__mirage; m.game.kit.story.pop('head', [18, 2.4, -9]); });
await sleep(150);
await shot('hud-cooldowns');
console.log(await flags());
// 7. overdrive: everything marked through walls
await page.evaluate(() => { const m = window.__mirage; m.game.kit.abilities.gain(1); });
await page.keyboard.press('Digit3'); await sleep(600);
await place([12, 1.76, -12], [16, 1.5, -25]); await sleep(900);
await shot('overdrive');
console.log('errors', errors);
await b.close(); srv.close();
