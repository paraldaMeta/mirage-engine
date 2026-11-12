#!/usr/bin/env node
// Check: the mission can always be finished (NOTES.md "The last wave"). The uplink runs only when every robot of the
// last wave is down; a robot that lost the player, cannot reach them or is stuck must not hold it open for ever.
// In headless Chrome, the game fast-forwarded (fixed steps, no rendering between): the player on the relay roof starts
// the uplink, the wave is woken, then
//   reach     one sentinel of the wave is put far off on the street, out of sight, its others down: it must come to
//             the player (the gap closes until it fights them in sight) and be marked through walls on the way
//   stuck     the same sentinel shut in a corner the walk grid cannot leave (its agent pinned there each step), and a
//             kite of the wave kept behind the relay out of sight: the uplink must still complete (they withdraw)
// usage: node scripts/uplink-check.mjs [dist]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist'));
const srv = await serve(dist), b = await launch({ w: 960, h: 600 });
let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}  ${info}`); if (!ok) failed++; };
for (const kind of ['reach', 'stuck']) {
  const { page, errors } = await open(b, `${srv.url}?w=960&h=600&grain=0&hud=0&start=1&assist=1&quality=low&fullscreen=0`);
  const r = await page.evaluate((kind) => {
    const { play, g, game } = window.__mirage, gm = g.game, E = game.enemies, D = game.drones;
    play.stop();
    const step = (n) => { for (let i = 0; i < n; i++) play.step(1 / 60); };
    play.place([9.5, 7.62, -23.5], [9.5, 7.62, -27], 'walk'); step(30);
    gm.entities.get('uplink').interact.use(gm); step(10);
    const wave = E.byZone.wave, kites = D.byZone.wave || [];
    const keep = wave[0];
    for (const e of wave.slice(1)) E.damage(e, 9999, false, e.pos, [0, -1, 0], {});
    for (const k of kites.slice(1)) D.damage(k, 9999, false, k.pos, [0, -1, 0]);
    const far = kind === 'reach' ? [-10, 0.1, 9.2] : [-26.4, 0.02, 33.0];   // the street; the alley's dead end behind the fence
    const nav = E.nav, at = nav.nearest(far, { snap: 3 }) || far;
    keep.agent.place(at); keep.pos = keep.agent.pos; keep.agent.stop(); keep.state = 'post'; keep.seenT = -1e9; keep.wokeT = gm.time; keep.home = at.slice();
    const kite = kites[0];
    if (kite && kind === 'stuck') { kite.pos = [18, 2.2, -28.5]; kite.seenT = -1e9; kite.wokeT = gm.time; }   // inside the relay's ground floor, under the roof
    else if (kite) D.damage(kite, 9999, false, kite.pos, [0, -1, 0]);
    const d0 = Math.hypot(keep.pos[0] - 9.5, keep.pos[2] + 23.5);
    let marked = false, minD = d0, t = 0;
    while (t < 150 && !gm.flags.done) {
      if (kind === 'stuck') { keep.agent.place(at); keep.pos = keep.agent.pos; if (kite && !kite.dead) { kite.pos[0] = 18; kite.pos[1] = 2.2; kite.pos[2] = -28.5; } }
      step(30); t += 0.5;
      if (keep.straggler) marked = true;
      if (!keep.dead) minD = Math.min(minD, Math.hypot(keep.pos[0] - 9.5, keep.pos[2] + 23.5) + Math.abs(keep.pos[1] - 6) * 2);
      if (kind === 'reach' && (minD < 6 || (keep.state === 'fight' && gm.time - keep.seenT < 1))) break;   // there, or fighting the player in sight
    }
    return { t, sees: gm.time - keep.seenT < 1, done: !!gm.flags.done, withdrawn: gm.flags.withdrawn || 0, kitesWithdrawn: gm.flags.kitesWithdrawn || 0, marked, d0: +d0.toFixed(1), minD: +minD.toFixed(1), state: keep.state, dead: keep.dead, uplink: !!gm.flags.uplink };
  }, kind);
  if (kind === 'reach') check('a straggler of the last wave comes to the player (marked on the way) and fights them', (r.minD < 6 || (r.state === 'fight' && r.sees)) && r.marked && r.minD < r.d0 - 20, JSON.stringify(r));
  else check('a robot and a kite of the last wave that cannot reach the player do not hold the uplink open', r.done && r.withdrawn >= 1 && r.kitesWithdrawn >= 1 && r.t < 120, JSON.stringify(r));
  check(`${kind}: no console errors`, errors.length === 0, errors[0] || '');
  await page.close();
}
await b.close(); srv.close?.();
console.log(`\nuplink-check: ${failed ? failed + ' FAILED' : 'all pass'}`);
process.exit(failed ? 1 : 0);
