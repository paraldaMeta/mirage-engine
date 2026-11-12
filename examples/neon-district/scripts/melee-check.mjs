#!/usr/bin/env node
// Close combat in the game (melee.js, boss.js, heavy.js), checked and pictured, on the relay's roof:
//   page 1 (a first run)  the swordsman's seven moves, each forced in turn at a player at its range: the move ran, its
//                         name was called out, the strike landed (the player thrown: a launch, a slow beat); the draw
//                         dodged by the dash's grace and jumped; rounds turned aside in guard, damage in the return to
//                         the scabbard; the brawler's and the sword robot's combos, the brawler's block; beaten, the
//                         swordsman kneels and joins; a checkpoint saved and loaded: still the ally, by the player
//   page 2 (New Game+)    a new page, the same browser profile: the ally with the player from the start; the heavy
//                         chassis on the roof: every move (the dash, the leap and landing, the grab: broken free by
//                         mashing, and thrown), the armour against small arms, the vents; the ally's draw staggers
//                         it; the ally fighting a sword robot; the ending's black card held until a key, then New Game+
//   page 3                the title's reset: the swordsman a foe again
// Pictures: 8-frame strips of every move in out/melee/, one contact sheet out/melee/sheet.png, a first-person sequence of
// the player cut and thrown, the ending card. Exit 1 on a failed check.
//   node scripts/melee-check.mjs [dist] [--no-strips]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const dist = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(here, '../dist'));
const OUT = path.join(here, '../out/melee'), FR = path.join(OUT, 'frames'), STRIPS = !args.includes('--no-strips'), W = 1280, H = 720;
fs.mkdirSync(FR, { recursive: true });
const srv = await serve(dist), b = await launch({ w: W, h: H });
const URL = `${srv.url}?w=${W}&h=${H}&start=1&grain=0&quality=medium&time=night&lang=en&fullscreen=0&drill=1&ending=1`;
const fails = [], report = {}, strips = [];
const ok = (c, m) => { if (!c) { fails.push(m); console.error('  FAIL ' + m); } else console.log('  ok   ' + m); };

/** the test harness in the page: everything parked but the subjects, steps of 1/60 s, cameras */
async function boot() {
  const { page, errors } = await open(b, URL, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const m = window.__mirage, G = m.game, E = G.enemies, M = E.melee, play = m.play, gm = m.g.game;
    play.stop();
    for (const d of G.drones.list) G.drones.park(d);
    const keepIds = new Set();
    const keep = () => { G.player.hp = 100; G.player.dead = false; for (const e of E.list) if (keepIds.has(e) && !e.dead && !e.K.boss) { e.seenT = gm.time; e.lastSeen = G.player.feet.slice(); } };
    const step = (n = 1) => { for (let i = 0; i < n; i++) { keep(); play.step(1 / 60); } };
    const draw = () => { m.world.renderFrame(gm.time, { camera: m.world.camera, taa: true }); };   // (on the game's clock: the streaks and trails age)
    const byId = (id) => E.list.find((x) => x.id === id);
    /** the player at feet p looking at q (walk), or a camera at eye looking at q (fly: the player stays put) */
    const at = (p, q) => { play.place([p[0], p[1] + 1.62, p[2]], [q[0], q[1] + 1.3, q[2]], 'walk'); const v = m.world.scene.getObjectByName('viewmodel'); if (v) v.visible = true; };
    const vm = () => m.world.scene.getObjectByName('viewmodel');
    const cam = (eye, q) => { const f = G.player.feet.slice(); play.place(eye, q, 'fly'); m.g.character.place(f, { exact: true }); if (vm()) vm().visible = false; };
    /** only these robots in play (the rest parked); the bosses keep their own state */
    const only = (ids) => { keepIds.clear(); for (const e of E.list) { if (ids.includes(e.id)) { keepIds.add(e); continue; } if (!e.K.boss && !e.dead) E.park(e); } };
    const put = (e, p, face) => { if (e.dead || !e.active) E.revive(e, p, 1); else { e.agent.place(E.nav.nearest(p, { snap: 2 }) || p); e.pos = e.agent.pos; } e.yaw = Math.atan2(face[0] - e.pos[0], face[2] - e.pos[2]); e.heading[0] = Math.sin(e.yaw); e.heading[1] = Math.cos(e.yaw); e.rig.root.visible = true; e.active = true; return e; };
    const flags = () => ({ ...gm.flags });
    window.__mc = { m, G, E, M, play, gm, step, draw, byId, at, cam, only, put, flags, keepIds };
    step(40);   // the run begins (the overlay's start puts the player at the spawn on its first steps)
    // the pictures: the game's HUD and cards hidden, the bosses' callouts and bar kept (callout.js)
    const st = document.createElement('style'); st.textContent = '.nd,.ndx,[class^="mg-"]{visibility:hidden!important}'; document.head.appendChild(st);
  });
  return { page, errors };
}
/** 8 frames at the given move times (s), each a screenshot (the callouts and the bar are in the page, over the canvas) */
async function strip(page, name, label, times, setup, frame = null, zoom = 1.6) {
  // the camera looks at the action: a window round the middle (a little high, for the callout over it)
  const cw = Math.round(W / zoom), ch = Math.round(H / zoom), clip = zoom > 1 ? { x: Math.round((W - cw) / 2), y: Math.round(H * 0.11), width: cw, height: ch } : undefined;
  const shots = [];
  let t = 0;
  for (const tt of times) {
    const n = Math.max(0, Math.round((tt - t) * 60)); t += n / 60;
    await page.evaluate((n, frame) => { const { step, draw } = window.__mc; step(n); if (frame) (0, eval)(frame)(); draw(); draw(); }, n, frame);
    if (STRIPS) shots.push(await page.screenshot({ type: 'png', clip }));
  }
  if (!STRIPS) return;
  const files = shots.map((buf, i) => { const f = path.join(FR, `${name}-${i}.png`); fs.writeFileSync(f, buf); return f; });
  const out = path.join(OUT, `${name}.png`);
  execFileSync('python3', [path.join(here, 'strip.py'), out, label, ...files]);
  strips.push([label, out]);
}

// ================================================================================================ page 1: a first run
{
  const { page, errors } = await boot();
  const roof = 6.02, lane = -24.8;
  // the swordsman and a player on the roof's open lane (z -24.8), the camera off the roof's south side looking in
  const setup = async (d, boss = [10.3, roof, lane]) => page.evaluate(({ d, boss, roof, lane }) => {
    const { M, put, at, only, step, gm } = window.__mc;
    delete gm.settings.ndAlly; gm.saveSettings();
    only([]);
    const e = M.boss.entity; e.ally = false; e.hp = e.maxHp; e.mm.move = null; e.mm.awake = true; e.mm.cd = {}; e.mm.gap = 99; e.mm.phase = 2; e.mm.open = false;
    const pf = [boss[0] + d, roof, lane];
    at(pf, boss); put(e, boss, pf); step(20);
    return { boss: e.pos.slice(), player: window.__mc.G.player.feet.slice() };
  }, { d, boss, roof, lane });
  const side = (a, c) => [(a[0] + c[0]) / 2, roof + 2.4, lane + Math.max(6.5, Math.abs(a[0] - c[0]) * 0.75)];
  const moves = { rainpierce: [11, [0.3, 0.65, 0.95, 1.12, 1.25, 1.6, 2.7, 4.0]], stormdrop: [7, [0.2, 0.5, 0.7, 0.9, 1.06, 1.4, 2.5, 3.6]],
    risingtide: [2.2, [0.2, 0.44, 0.5, 0.56, 0.62, 1.0, 2.0, 2.9]], stonewake: [10, [0.25, 0.6, 0.78, 0.9, 1.05, 1.25, 2.2, 3.2]],
    ninefold: [2.6, [0.1, 0.4, 0.62, 0.7, 0.8, 0.95, 1.9, 3.4]], twinsheath: [2.4, [0.3, 0.46, 0.52, 0.65, 0.75, 1.2, 1.9, 3.3]], ebbdraw: [3.6, [0.3, 0.55, 0.7, 0.85, 1.0, 1.08, 1.9, 3.5]] };
  for (const [name, [d, times]] of Object.entries(moves)) {
    const s = await setup(d);
    const f0 = await page.evaluate(() => window.__mc.flags());
    await page.evaluate(({ c, l, name }) => { const { cam, M } = window.__mc; cam(c, l); M.boss.force(name); }, { c: side(s.boss, s.player), l: [(s.boss[0] + s.player[0]) / 2, roof + 1, lane], name });
    await strip(page, `boss-${name}`, `SWORDSMAN · ${name} (${d} m)`, times);
    const f1 = await page.evaluate(() => ({ ...window.__mc.flags(), call: window.__mc.M.ui.last, move: window.__mc.M.boss.entity.mm.move }));
    ok((f1['move_' + name] || 0) > (f0['move_' + name] || 0), `${name}: the move ran`);
    ok(f1.callouts > (f0.callouts || 0) && f1.call === (await page.evaluate((n) => window.__mc.m.game.text.melee.moves[n], name)), `${name}: called out ("${f1.call}")`);
    ok((f1.meleeHits || 0) > (f0.meleeHits || 0), `${name}: the strike landed on a player who stood still`);
  }
  // the draw: launched, the slow beat; dodged by the dash's grace; jumped
  {
    await setup(11);
    const r = await page.evaluate(() => {
      const { M, step, flags, G, gm } = window.__mc, f0 = flags(); M.boss.force('rainpierce'); step(90);
      const f1 = flags(); const pushed = !!G.player.body.push || f1.launches > (f0.launches || 0);
      return { launched: pushed && f1.launches > (f0.launches || 0), slow: (f1.slowBeats || 0) > (f0.slowBeats || 0), t: gm.time };
    });
    ok(r.launched, 'rainpierce: the player is thrown (a launch)'); ok(r.slow, 'rainpierce: a slow beat on the hit');
    await setup(11);
    const d = await page.evaluate(() => { const { M, step, flags, G, gm } = window.__mc, f0 = flags(); M.boss.force('rainpierce'); step(64); G.player.iframe = gm.time + 0.35; step(30); const f1 = flags(); return { dodged: f1.meleeDodges > (f0.meleeDodges || 0), hit: (f1.meleeHits || 0) > (f0.meleeHits || 0) }; });
    ok(d.dodged && !d.hit, 'rainpierce: the dash\'s grace in the window dodges it');
    await setup(11);
    const j = await page.evaluate(() => { const { M, step, flags, G } = window.__mc, f0 = flags(); M.boss.force('rainpierce'); step(58); G.player.body.vy = 4.2; G.player.body.onGround = false; step(40); const f1 = flags(); return { jumped: f1.meleeJumps > (f0.meleeJumps || 0), hit: (f1.meleeHits || 0) > (f0.meleeHits || 0) }; });
    ok(j.jumped && !j.hit, 'rainpierce: a jump in the window clears the low cut');
    // guard: rounds from the front turned aside; in the return to the scabbard they land (a third more)
    await setup(8);
    const g = await page.evaluate(() => {
      const { M, E, step, flags } = window.__mc, e = M.boss.entity, f0 = flags(), hp0 = e.hp;
      for (let i = 0; i < 5; i++) E.damage(e, 10, false, [e.pos[0] + 1, e.pos[1] + 1.3, e.pos[2]], [-1, 0, 0], {});
      const guarded = e.hp === hp0 && flags().deflects >= (f0.deflects || 0) + 5;
      M.boss.force('stonewake'); step(Math.round(60 * 2.6));
      const open = e.mm.open, hp1 = e.hp; E.damage(e, 10, false, [e.pos[0] + 1, e.pos[1] + 1.3, e.pos[2]], [-1, 0, 0], {});
      return { guarded, open, took: hp1 - e.hp };
    });
    ok(g.guarded, 'guard: five rounds from the front turned aside (no damage)'); ok(g.open && Math.abs(g.took - 13.5) < 0.6, `the return to the scabbard: open, a round does ${g.took.toFixed(1)} (10 x 1.35)`);
  }
  // first person: the player cut and thrown by the draw
  {
    const s = await setup(11);
    await page.evaluate(() => { const { M } = window.__mc; M.boss.force('rainpierce'); });
    await strip(page, 'firstperson-rainpierce', 'FIRST PERSON · the draw, the cut, thrown', [0.5, 0.8, 1.0, 1.12, 1.2, 1.32, 1.5, 1.8], null, null, 1);
    void s;
  }
  // the brawler and the sword robot
  for (const [id, combo, label] of [['m0', ['jab', 'cross', 'kick'], 'BRAWLER · jab, cross, kick'], ['m1', ['slash', 'sweep'], 'BLADE · slash, sweep'], ['m1', ['thrust'], 'BLADE · thrust']]) {
    const r = await page.evaluate(({ id, combo, roof, lane }) => {
      const { M, put, at, only, step, byId, cam, flags } = window.__mc;
      const e = byId(id), d = combo[0] === 'thrust' ? 3.4 : 1.6, pf = [18, roof, lane], ep = [18 - d, roof, lane];
      only([id]); window.__mc.E.park(M.boss.entity); at(pf, ep); put(e, ep, pf); e.state = 'fight'; step(10);
      cam([17, roof + 1.9, lane + 4.6], [17.2, roof + 1.0, lane]);
      const f0 = flags(); M.combo(e, combo); return f0;
    }, { id, combo, roof, lane });
    await strip(page, `${id === 'm0' ? 'brawler' : 'blade'}-${combo.join('-')}`, label, combo.length === 3 ? [0.15, 0.27, 0.45, 0.6, 0.9, 1.15, 1.45, 1.75] : combo.length === 2 ? [0.2, 0.4, 0.47, 0.65, 0.9, 1.15, 1.25, 1.5] : [0.15, 0.3, 0.4, 0.46, 0.5, 0.55, 0.7, 0.85]);
    const f1 = await page.evaluate(() => window.__mc.flags());
    ok((f1.meleeHits || 0) > (r.meleeHits || 0), `${label}: lands on a player who stood still`);
  }
  {
    const r = await page.evaluate(({ roof, lane }) => {
      const { E, put, at, only, step, byId, cam, flags } = window.__mc;
      const e = byId('m0'), pf = [19, roof, lane], ep = [15, roof, lane];
      only(['m0']); window.__mc.E.park(window.__mc.M.boss.entity); at(pf, ep); put(e, ep, pf); e.state = 'fight'; e.mm.move = null; e.mm.queue.length = 0; e.mm.cool = 9; e.mm.blockCool = 0; e.mm.block = 0; step(10);
      cam([17, roof + 1.9, lane + 4.6], [16, roof + 1.0, lane]);
      const f0 = flags(), hp0 = e.hp; E.damage(e, 10, false, [e.pos[0] + 0.3, e.pos[1] + 1.3, e.pos[2]], [-1, 0, 0], {}); E.damage(e, 10, false, [e.pos[0] + 0.3, e.pos[1] + 1.3, e.pos[2]], [-1, 0, 0], {});
      return { blocks: flags().blocks - (f0.blocks || 0), took: hp0 - e.hp };
    }, { roof, lane });
    ok(r.blocks >= 1 && r.took < 5, `brawler: a guard raised against fire from the front (${r.took.toFixed(1)} of 20 taken)`);
    await strip(page, 'brawler-block', 'BRAWLER · the crossed-forearm guard, broken by a third hit', [0.05, 0.2, 0.35, 0.5, 0.6, 0.75, 0.9, 1.1], null,
      `() => { const { E, byId } = window.__mc, e = byId('m0'); if (window.__mcN = (window.__mcN || 0) + 1, window.__mcN === 5) E.damage(e, 10, false, [e.pos[0] + 0.3, e.pos[1] + 1.3, e.pos[2]], [-1, 0, 0], {}); }`);
  }
  // beaten: kneels, sheathes, bows, joins; a checkpoint keeps it
  {
    await setup(6);
    await page.evaluate(({ roof, lane }) => { const { M, cam } = window.__mc; cam([14.5, roof + 2.0, lane + 5.2], [12, roof + 0.9, lane]); M.boss.drillBeat(); }, { roof, lane });
    await strip(page, 'boss-kneel-join', 'SWORDSMAN · beaten: kneels, sheathes, bows, joins', [0.3, 0.9, 1.6, 2.1, 2.7, 3.2, 3.9, 5.4]);
    const r = await page.evaluate(() => {
      const { M, step, gm, m, G } = window.__mc, e = M.boss.entity; step(60);
      const joined = e.ally && gm.flags.bossBeaten === true && gm.settings.ndAlly?.unlocked === true;
      m.g.save('auto');
      // the player off somewhere else; load the checkpoint: still the ally, and it comes to the player
      e.ally = false; gm.flags.bossBeaten = false;
      m.g.load('auto'); step(120);
      return { joined, after: e.ally && gm.flags.bossBeaten === true, dist: Math.hypot(e.pos[0] - G.player.feet[0], e.pos[2] - G.player.feet[2]) };
    });
    ok(r.joined, 'beaten: it joins (bossBeaten in the run, ndAlly.unlocked in the settings)');
    ok(r.after && r.dist < 9, `a checkpoint loaded: still the ally, ${r.dist.toFixed(1)} m from the player`);
  }
  report.errors1 = errors.slice(0, 5);
  ok(errors.length === 0, `page 1: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await page.close();
}

// ================================================================================================ page 2: New Game+
{
  const { page, errors } = await boot();
  const roof = 6.02, lane = -24.8;
  const r0 = await page.evaluate(() => { const { M, step, G } = window.__mc; step(120); const e = M.boss.entity; return { ng: M.boss.ngRun, ally: e.ally, dist: Math.hypot(e.pos[0] - G.player.feet[0], e.pos[2] - G.player.feet[2]) }; });
  ok(r0.ng && r0.ally && r0.dist < 9, `New Game+: the swordsman with the player from the start (${r0.dist.toFixed(1)} m)`);
  const kicker = await page.evaluate(() => document.querySelector('.nt-kicker')?.textContent || '');
  ok(/NEW GAME\+/.test(kicker), `the title says New Game+ ("${kicker.slice(0, 30)}")`);
  const setup = async (d, extra = '') => page.evaluate(({ d, roof, lane, extra }) => {
    const { M, put, at, only, step } = window.__mc;
    only([]);
    const h = M.heavy.entity, a = M.boss.entity, hp = [9.8, roof, lane], pf = [9.8 + d, roof, lane];
    h.hp = h.maxHp; h.mm.move = null; h.mm.awake = true; h.mm.cd = {}; h.mm.gap = 99; h.mm.posture = 0; h.mm.open = false; h.mm.lt = 0; h.mm.perchAt = null; h.mm.perch = null; h.mm.land = null; h.mm.landed = false; h.mm.called = false; h.mm.held = false; h.mm.name = null;
    at(pf, hp); put(h, hp, pf);
    put(a, [Math.min(21, 9.8 + d + 1.2), roof, lane + 2.4], hp); a.mm.allyCd = extra === 'ally' ? 0 : 99; a.mm.move = null;
    step(20);
    return { h: h.pos.slice(), p: window.__mc.G.player.feet.slice() };
  }, { d, roof, lane, extra });
  const view = (a, c, far = 0.8) => [(a[0] + c[0]) / 2, roof + 3.2, lane + Math.max(8, Math.abs(a[0] - c[0]) * far)];
  const HM = { railslide: [12, [0.15, 0.3, 0.42, 0.55, 0.65, 0.8, 0.95, 1.2]], cityfall: [9, [0.25, 0.6, 0.95, 1.5, 1.85, 2.2, 2.6, 3.7]], embrace: [2.4, [0.2, 0.45, 0.62, 0.9, 1.3, 1.8, 2.1, 2.5]],
    breachcannon: [12, [0.2, 0.5, 0.8, 1.05, 1.22, 1.28, 1.4, 1.7]], houndswarm: [12, [0.25, 0.5, 0.75, 1.0, 1.3, 1.6, 1.9, 2.3]], hornetsalvo: [10, [0.3, 0.55, 0.7, 0.9, 1.2, 1.5, 1.8, 2.2]], rampart: [3, [0.2, 0.35, 0.44, 0.7, 1.05, 1.2, 1.4, 1.9]] };
  for (const [name, [d, times]] of Object.entries(HM)) {
    const s = await setup(d);
    const f0 = await page.evaluate(() => window.__mc.flags());
    await page.evaluate(({ c, l, name }) => { const { cam, M } = window.__mc; cam(c, l); M.heavy.force(name); }, { c: view(s.h, s.p), l: [(s.h[0] + s.p[0]) / 2, roof + 1.2, lane], name });
    await strip(page, `heavy-${name}`, `HEAVY CHASSIS · ${name} (${d} m)`, times);
    const f1 = await page.evaluate(() => ({ ...window.__mc.flags(), call: window.__mc.M.ui.last }));
    ok((f1['move_' + name] || 0) > (f0['move_' + name] || 0) && f1.callouts > (f0.callouts || 0), `heavy ${name}: ran, called out ("${f1.call}")`);
    const hurt = (f1.heavyHits || 0) + (f1.meleeHits || 0) > (f0.heavyHits || 0) + (f0.meleeHits || 0);
    if (name !== 'railslide') ok(hurt || name === 'embrace', `heavy ${name}: lands on a player who stood still`);
    if (name === 'cityfall') ok((f1.heavyLandings || 0) > (f0.heavyLandings || 0), 'heavy cityfall: the landing (a crack, a shockwave)');
    if (name === 'embrace') ok((f1.grabs || 0) > (f0.grabs || 0) && (f1.grabThrows || 0) > (f0.grabThrows || 0), 'heavy embrace: grabbed, lifted, thrown');
    if (name === 'railslide') ok((f1.heavyDashes || 0) > (f0.heavyDashes || 0), 'heavy railslide: the dash and the sliding stop');
  }
  // the grab broken by mashing
  {
    await setup(2.4);
    const r = await page.evaluate(() => {
      const { M, step, flags } = window.__mc, f0 = flags(); M.heavy.force('embrace'); step(60);
      for (let i = 0; i < 8; i++) dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' }));
      step(30); const f1 = flags(); return { escaped: (f1.grabEscapes || 0) > (f0.grabEscapes || 0), staggered: (f1.heavyStaggers || 0) > (f0.heavyStaggers || 0) };
    });
    ok(r.escaped && r.staggered, 'heavy embrace: mashing breaks free, the chassis reels');
  }
  // the armour: a round on the chest does a quarter; on a vent two and a half times
  {
    await setup(8);
    const r = await page.evaluate(() => {
      const { M, E } = window.__mc, h = M.heavy.entity; h.mm.move = null; h.rig.root.updateMatrixWorld(true);
      const hp0 = h.hp; E.damage(h, 10, false, [h.pos[0] + 0.3, h.pos[1] + 1.4, h.pos[2]], [-1, 0, 0], {}); const chest = hp0 - h.hp;
      const v = h.rig.bones.Chest.localToWorld(new (h.rig.root.position.constructor)(...M.heavy.VENTS[2])); const hp1 = h.hp;
      E.damage(h, 10, false, v.toArray(), [-1, 0, 0], {}); return { chest, vent: hp1 - h.hp };
    });
    ok(Math.abs(r.chest - 2.5) < 0.3 && Math.abs(r.vent - 25) < 1, `heavy armour: chest ${r.chest.toFixed(1)}, vent ${r.vent.toFixed(1)} of 10`);
  }
  // the ally's draw staggers it
  {
    const s = await setup(5);
    await page.evaluate(({ s, roof, lane }) => {
      const { M, put, cam } = window.__mc, a = M.boss.entity, h = M.heavy.entity;
      put(a, [h.pos[0] + 11, roof, lane - 0.4], h.pos); a.mm.move = null;
      cam([h.pos[0] + 5.5, roof + 3, lane + 8.5], [h.pos[0] + 5.5, roof + 1, lane]);
      M.boss.force('rainpierce', h);
      void s;
    }, { s, roof, lane });
    const f0 = await page.evaluate(() => window.__mc.flags());
    await strip(page, 'ally-staggers-heavy', 'ALLY · its draw staggers the heavy chassis', [0.3, 0.65, 0.95, 1.12, 1.22, 1.4, 1.8, 2.4]);
    const f1 = await page.evaluate(() => window.__mc.flags());
    ok((f1.allyStaggers || 0) > (f0.allyStaggers || 0), 'the ally\'s draw staggers the heavy chassis');
  }
  // the ally fighting a sword robot
  {
    const r = await page.evaluate(({ roof, lane }) => {
      const { M, put, at, only, step, byId, cam, flags } = window.__mc, a = M.boss.entity, e = byId('m1');
      only(['m1']); M.heavy.entity.mm.awake = false; window.__mc.E.park(M.heavy.entity);
      at([22, roof, lane - 2.5], [14, roof, lane]); put(e, [13, roof, lane], [20, roof, lane]); e.state = 'fight';
      put(a, [16, roof, lane + 0.3], e.pos); a.mm.move = null; a.mm.allyCd = 0;
      cam([15, roof + 2.2, lane + 6], [14.5, roof + 1, lane]); step(5);
      const f0 = flags(); M.boss.force('twinsheath', e); return f0;
    }, { roof, lane });
    await strip(page, 'ally-vs-blade', 'ALLY · its double draw on a sword robot', [0.2, 0.4, 0.5, 0.6, 0.75, 1.0, 1.6, 2.4]);
    const f1 = await page.evaluate(() => window.__mc.flags());
    ok((f1.allyHits || 0) > (r.allyHits || 0), 'the ally\'s blows land on a hostile robot (and count as the player\'s)');
    const p = await page.evaluate(() => { const { M, E, G } = window.__mc, a = M.boss.entity, hp = a.hp; E.damage(a, 50, false, a.pos, [1, 0, 0], {}); const hit = E.rayHit([a.pos[0] - 3, a.pos[1] + 1.3, a.pos[2]], [1, 0, 0], 10); return { hp: a.hp === hp, ray: !hit || hit.e !== a, php: G.player.hp }; });
    ok(p.hp && p.ray, 'the ally: the player\'s rounds pass it by, blasts do not hurt it');
  }
  // the ending: after the closing card, the black card, held until a key; then New Game+
  {
    await page.evaluate(() => { const { gm, step } = window.__mc; gm.set('closed', true); step(Math.round(60 * 12.8)); });
    const on = await page.evaluate(() => { const el = document.querySelector('.ndm-end.on'); return el ? el.innerText : ''; });
    ok(on.includes('AI乐子人灰叔') && on.includes('+vx tamtamjun'), 'the ending: the black card with the two lines');
    if (STRIPS) { await new Promise((r) => setTimeout(r, 400)); fs.writeFileSync(path.join(OUT, 'ending.png'), await page.screenshot({ type: 'png' })); }
    const held = await page.evaluate(() => !!document.querySelector('.ndm-end.on'));
    await new Promise((r) => setTimeout(r, 1300));
    await page.keyboard.press('Space');
    const gone = await page.evaluate(() => ({ off: !document.querySelector('.ndm-end.on'), ng: window.__mc.gm.flags.ngReady === true }));
    ok(held && gone.off && gone.ng, 'the ending: held until a key, then on to New Game+');
  }
  report.errors2 = errors.slice(0, 5);
  ok(errors.length === 0, `page 2: no page errors (${errors.slice(0, 2).join(' | ')})`);
  // the title's reset (New Game+ off)
  await page.evaluate(() => window.__mc.M.boss.resetAlly());
  await page.close();
}
// ================================================================================================ page 3: after the reset
{
  const { page, errors } = await boot();
  const r = await page.evaluate(() => { const { M, step } = window.__mc; step(60); return { ng: M.boss.ngRun, ally: M.boss.entity.ally, heavyParked: M.heavy.entity.dead }; });
  ok(!r.ng && !r.ally && r.heavyParked, 'the reset: a first run again (no ally, the heavy chassis parked)');
  ok(errors.length === 0, 'page 3: no page errors');
  await page.close();
}

if (STRIPS && strips.length) {
  execFileSync('python3', [path.join(here, 'strip.py'), '--sheet', path.join(OUT, 'sheet.png'), ...strips.map(([, f]) => f), path.join(OUT, 'ending.png')]);
  console.log('sheet: ' + path.join(OUT, 'sheet.png'));
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ fails, ...report }, null, 1));
console.log(fails.length ? `melee-check: ${fails.length} failed` : 'melee-check: ok');
await b.close(); srv.close?.();
process.exit(fails.length ? 1 : 0);
