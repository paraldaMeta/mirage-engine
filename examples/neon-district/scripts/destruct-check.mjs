#!/usr/bin/env node
// Check: the breakable props (game/destruct.js) in the built game, headless Chrome.
//   node scripts/destruct-check.mjs [dist] [--quality medium] [--shots] [--only a,b]
// Parts: families (each breaks at sensible damage, cover wears, a barrier holds), protected (the owner's five signs,
// the pass, the uplink survive a rocket), lights (a lantern, a bulb string, a neon tube, a street lamp: the lit lamp
// count and the measured luminance drop; a street lamp's zone goes dark for the robots, as the hack's), gas (the
// bottle's blast hurts a robot and the player at range, not through the stall's wall), car (glass, tyres, the alarm,
// fire, the explosion, in that order), civilians (the player's round fells one: points, the warning, panic; a robot's
// round fells one: nothing charged; one between the player and a robot takes the round), card (property damage and
// casualties on the end card in the three languages), saves (save, break, load: whole again; break, save, load:
// broken again, lamps too), stress (a gatling sweep down the street and a rocket into the stall: the debris and mark
// caps hold, the frame time bound), errors (none on the console). --shots writes pictures to out/destruct.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dist = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(here, '../dist'));
const quality = flag('quality', 'medium'), SHOTS = args.includes('--shots'), ONLY = (flag('only', '') || '').split(',').filter(Boolean);
const OUT = path.join(here, '../out/destruct'), W = 1280, H = 720;
if (SHOTS) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (cond, msg) => { results.push([!!cond, msg]); console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };
const part = (name) => !ONLY.length || ONLY.includes(name);

const srv = await serve(dist), b = await launch({ w: W, h: H, args: ['--autoplay-policy=no-user-gesture-required'] });
const { page, errors } = await open(b, `${srv.url}?w=${W}&h=${H}&start=1&grain=0&quality=${quality}&lang=en&fullscreen=0`, { timeout: 150000 });
await sleep(2500);
// the page's side: helpers on window.__dx
await page.evaluate(() => {
  const m = window.__mirage, G = m.game, P = G.props, d = P.d;
  const it = (id) => d.get(id);
  const c = (x) => (x.vol.type === 2 ? [(x.vol.a[0] + x.vol.b[0]) / 2, (x.vol.a[1] + x.vol.b[1]) / 2, (x.vol.a[2] + x.vol.b[2]) / 2] : x.vol.c.slice());
  /** a round from `from` at the item's centre, the way the weapon fires one (props first, the world as the limit) */
  const shoot = (id, from, dmg = 22, gun = 'carbine') => { const x = it(id), p = c(x), dir = [p[0] - from[0], p[1] - from[1], p[2] - from[2]], L = Math.hypot(...dir); const r = P.shoot(from, dir.map((v) => v / L), L + 1, dmg, 1, gun); return { count: r.count, stopped: r.stopped, first: r.hits[0]?.id, frac: r.frac, broke: r.hits.filter((h) => h.broke).map((h) => h.id) }; };
  const front = (id, dist = 3, up = 0) => { const x = it(id), p = c(x), yaw = x.entry?.box?.yaw ?? 0; return [p[0] + Math.sin(yaw) * dist, p[1] + up, p[2] + Math.cos(yaw) * dist]; };
  /** a place `dist` metres from the item with a clear line to it (no wall in between, open ground under it) */
  const clear = (id, dist = 4, up = 0.4, yaw0 = null) => {
    const x = it(id), p = c(x), base = yaw0 ?? x.entry?.box?.yaw ?? 0;
    for (const dd of [dist, dist * 0.75, dist * 1.3, dist * 0.5]) for (let k = 0; k < 16; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8, o = [p[0] + Math.sin(a) * dd, p[1] + up, p[2] + Math.cos(a) * dd];
      const dir = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], L = Math.hypot(...dir), w = P.worldRay(o, dir.map((v) => v / L), L);
      if (w && w.distance < L - 0.3) continue;
      const g = P.worldRay([o[0], o[1] + 0.2, o[2]], [0, -1, 0], 4), roof = P.worldRay(o, [0, 1, 0], 2.5);
      if (!g || roof) continue;
      return o;
    }
    return [p[0] + Math.sin(base) * dist, p[1] + up, p[2] + Math.cos(base) * dist];
  };
  const events = [];
  for (const k of ['break', 'fire', 'noise', 'casualty', 'panic', 'blast', 'stage']) d.on(k, (e) => events.push([k, e.item?.id ?? e.id ?? '', +d.time.toFixed(2), e.kind ?? '']));
  /** for pictures: no robot in play, the player kept alive, the radio off the frame */
  const calm = () => { for (const e of G.enemies.list) G.enemies.park(e); for (const e of G.drones.list) G.drones.park(e); if (!window.__calm) window.__calm = setInterval(() => { G.player.hp = 100; G.player.dead = false; }, 50); const r = document.querySelector('.nd-radio'); if (r) r.style.visibility = 'hidden'; };
  const uncalm = () => { const r = document.querySelector('.nd-radio'); if (r) r.style.visibility = ''; };
  window.__dx = { m, G, P, d, it, c, shoot, front, clear, calm, uncalm, events, lit: () => m.world.lampPool?.lit ?? -1, hp: (h) => { G.player.hp = h; } };
});
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const place = (eye, look) => ev((eye, look) => window.__mirage.play.place(eye, look, 'walk'), eye, look);
let shotN = 0;
const shot = async (name, radio = false) => { if (!SHOTS) return; await ev((radio) => { window.__dx.calm(); if (radio) window.__dx.uncalm(); }, radio); const f = `${String(++shotN).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: path.join(OUT, f) }); console.log('  shot', f); };
/** the mean luminance (0..1) of the middle of the view (a box w x h of the frame, centred) */
const luminance = async (w = 0.4, h = 0.4) => {
  const b64 = await page.screenshot({ encoding: 'base64' });
  return ev(async (b64, w, h) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const x0 = Math.round(img.width * (0.5 - w / 2)), y0 = Math.round(img.height * (0.5 - h / 2)), d = g.getImageData(x0, y0, Math.round(img.width * w), Math.round(img.height * h)).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  }, b64, w, h);
};
const reset = () => ev(() => { const { d, G, P } = window.__dx; clearInterval(window.__calm); window.__calm = null; d.reset(); P.resetScore(); G.player.hp = 100; G.player.dead = false; window.__dx.events.length = 0 });


// ---- registration
{
  const r = await ev(() => ({ count: window.__dx.P.count(), owner: window.__dx.d.items.filter((x) => x.tags.includes('owner')).map((x) => [x.id, x.protected, x.entry.text]) }));
  console.log('registered', JSON.stringify(r.count));
  ok(r.owner.length === 5 && r.owner.every((o) => o[1]), `the owner's five signs registered protected: ${r.owner.map((o) => o[2].slice(0, 12)).join(' | ')}`);
  ok(r.count.total > 600, `props registered: ${r.count.total}`);
  const cost = await ev(() => window.__dx.P.idleCost(600));
  ok(cost.step + cost.post < 0.1, `idle (nothing broken): ${(cost.step * 1000).toFixed(1)} us a fixed step, ${(cost.post * 1000).toFixed(1)} us a frame for the civilians`);
}

// ---- families: rounds of the carbine (22) each takes
if (part('families')) {
  const want = { 'shop-glass': [1, 3], 'vending-glass': [1, 2], vending: [6, 12], bottle: [1, 1], bulb: [1, 1], lantern: [1, 1], neon: [1, 1], streetlamp: [1, 1], sign: [1, 3], blade: [2, 3], crate: [3, 6], cardboard: [1, 3], bag: [1, 3], bin: [2, 4], tyre: [2, 4], scooter: [9, 16], gas: [1, 4], extinguisher: [1, 2], 'car-glass': [1, 2], bowls: [1, 1], steampipe: [2, 5], waterpipe: [2, 4], ac: [5, 9], led: [8, 14], 'bar-window': [1, 3] };
  const got = await ev((fams) => {
    const { d } = window.__dx, out = {};
    for (const f of fams) {
      const x = d.items.find((i) => i.tags[0] === f && !i.protected && !i.broken && (f !== 'sign' || i.entry.kind !== 'blade'));
      const y = f === 'blade' ? d.items.find((i) => i.entry?.kind === 'blade' && !i.broken) : x;
      if (!y) { out[f] = -1; continue; }
      let n = 0; while (!y.broken && !y.burning && n < 400) { d.damage(y, 22, 'bullet'); n++; }
      out[f] = n;
    }
    const j = d.items.find((i) => i.tags[0] === 'jersey'); let jn = 0; for (; jn < 300; jn++) d.damage(j, 22, 'bullet');
    out.jersey = j.broken ? 0 : 300;
    d.reset();
    return out;
  }, [...Object.keys(want), 'blade']);
  for (const [f, [lo, hi]] of Object.entries(want)) ok(got[f] >= lo && got[f] <= hi, `${f}: ${got[f]} carbine rounds (want ${lo}-${hi})`);
  ok(got.jersey === 300, 'a jersey barrier: 300 rounds, chipped, holds');
  // cover that wears: a crate stops the round until it goes, then the round passes
  const cover = await ev(() => {
    const { d, shoot, front } = window.__dx, id = d.items.find((i) => i.tags[0] === 'crate').id, from = front(id, 4, 0.05), seq = [];
    for (let k = 0; k < 7; k++) { const r = shoot(id, from); seq.push(r.first === id ? (r.stopped === 'item' ? 'S' : 'p') : '-'); }
    const bag = d.items.find((i) => i.tags[0] === 'bag'), bseq = [];
    for (let k = 0; k < 4; k++) { const r = shoot(bag.id, window.__dx.front(bag.id, 3, 0.1)); bseq.push(r.first === bag.id ? r.frac.toFixed(2) : '-'); }
    d.reset();
    return { seq: seq.join(''), bseq };
  });
  ok(/^S+-+$/.test(cover.seq.replace(/p/g, 'S')), `a crate stops rounds, then is gone and they pass: ${cover.seq}`);
  ok(cover.bseq[0] !== '-' && +cover.bseq[0] < 0.5 && cover.bseq.includes('-'), `a bag heap takes most of a round and then is gone: ${cover.bseq.join(' ')}`);
}

// ---- protected: a rocket at each
if (part('protected')) {
  const r = await ev(() => {
    const { d, P, c } = window.__dx, ids = d.items.filter((x) => x.protected).map((x) => x.id);
    for (const id of ids) P.blast(c(d.get(id)), 5.5, 220);
    const out = ids.map((id) => [id, d.get(id).broken]);
    // nothing registered at the relay's door or on the stairs
    const door = window.__mirage.built?.anchors?.doors?.[0] || null;
    d.reset();
    return { out, door: !!door };
  });
  ok(r.out.length >= 7 && r.out.every(([, br]) => !br), `protected survive a rocket: ${r.out.map(([id]) => id).join(', ')}`);
}

// ---- lights
if (part('lights')) {
  const cases = await ev(() => {
    const { d } = window.__dx, pick = (pred) => d.items.find(pred)?.id;
    return { lantern: pick((x) => x.id === 'bar-door-lantern-1'), lantern2: pick((x) => x.id === 'bar-door-lantern-0'), bulb: pick((x) => x.id === 'bulbs-1-4'), neon: pick((x) => x.tags[0] === 'neon' && x.id.startsWith('kiosk')), lamp: pick((x) => x.id === 'streetlamp-2'), sign: pick((x) => x.tags[0] === 'sign' && !x.protected && x.entry.kind === 'board' && x.entry.w * x.entry.h > 3) };
  });
  console.log('light cases', JSON.stringify(cases));
  const lightCase = async (name, ids, eyeK = 4.5) => {
    await reset();
    const v = await ev((ids, k) => { const { c, it, clear } = window.__dx, p = c(it(ids[0])); return { p, eye: clear(ids[0], k, Math.min(0, 1.7 - p[1])) }; }, ids, eyeK);
    await place(v.eye, v.p); await sleep(900);
    const crop = name === 'neon' || name === 'sign' ? [0.3, 0.16] : [0.4, 0.4];
    const l0 = await ev(() => window.__dx.lit()), y0 = await luminance(...crop);
    if (name === 'neon') await shot('neon-before');
    for (const id of ids) await ev((id, eye) => { for (let k = 0; k < 4 && !window.__dx.it(id).broken; k++) window.__dx.shoot(id, eye); }, id, v.eye);
    await sleep(name === 'neon' ? 250 : 1400);
    if (name === 'neon') await shot('neon-half-dead');
    await sleep(1300);
    const l1 = await ev(() => window.__dx.lit()), y1 = await luminance(...crop);
    const st = await ev((ids) => ids.map((id) => window.__dx.it(id).broken), ids);
    return { l0, l1, y0, y1, broken: st };
  };
  for (const [name, ids] of [['lantern', [cases.lantern, cases.lantern2]], ['bulb', [cases.bulb]], ['neon', [cases.neon]], ['streetlamp', [cases.lamp]], ['sign', [cases.sign]]]) {
    if (!ids[0]) { ok(false, `${name}: none registered`); continue; }
    const r = await lightCase(name, ids);
    const fewer = r.l1 < r.l0 || (quality !== 'low' && name === 'streetlamp');
    ok(r.broken.every(Boolean) && fewer && r.y1 < r.y0 * 0.97, `${name} shot out: lit pool lamps ${r.l0} -> ${r.l1}, luminance ${r.y0.toFixed(3)} -> ${r.y1.toFixed(3)}`);
  }
  // the bulb string pops one by one
  await reset();
  const chain = await ev(async (id) => { const { d, events } = window.__dx; d.damage(id, 99); await new Promise((r) => setTimeout(r, 1500)); return events.filter((e) => e[0] === 'break' && e[1].startsWith(id.replace(/-\d+$/, ''))).map((e) => e[2]); }, cases.bulb);
  ok(chain.length >= 6 && chain[chain.length - 1] - chain[0] > 0.2, `a bulb string pops one after another: ${chain.length} bulbs over ${(chain[chain.length - 1] - chain[0]).toFixed(2)} s`);
  // a lantern row going dark, the street darkening (a wide shot), and the robots: a street lamp's zone
  await reset();
  const zone = await ev(async () => {
    const { G, c, it, shoot } = window.__dx, L = ['streetlamp-1', 'streetlamp-2', 'streetlamp-3'].filter((id) => it(id));
    const p = c(it(L[1])), feet = [p[0], 0.16, p[2] + 2];
    const e = G.enemies.list.find((x) => x.id === 'g1'); G.enemies.revive(e, [p[0] + 3, 0.16, p[2]], 1); G.enemies.alert(e, G.player.feet, 0);
    const before = { dark: G.kit.hack.dark(feet), state: e.state };
    for (const id of L) { const o = window.__dx.clear(id, 5, -3.5); for (let k = 0; k < 3 && !it(id).broken; k++) shoot(id, o); }
    await new Promise((r) => setTimeout(r, 1500));
    return { before, after: { dark: G.kit.hack.dark(feet), state: e.state, zones: window.__dx.P.zones.length, sees: G.enemies.env.dark(feet), broken: L.map((id) => it(id).broken) } };
  });
  ok(zone.before.dark === 0 && zone.after.dark === 1 && zone.after.sees === 1, `street lamps shot out (${zone.after.broken}): their zone is dark for the robots (dark ${zone.before.dark} -> ${zone.after.dark}, ${zone.after.zones} dark zones)`);
  ok(zone.after.state === 'search', `a robot fighting there loses the player as in a hacked dark zone (state ${zone.before.state} -> ${zone.after.state})`);
  if (SHOTS) {
    await ev(() => window.__dx.calm());
    await reset();
    const row = await ev(() => { const { d } = window.__dx; return d.items.filter((x) => x.id.startsWith('stall-lantern')).map((x) => x.id); });
    await place([13.5, 1.65, -1.2], [7.5, 2.4, -5.6]); await sleep(1500); await shot('lanterns-before');
    await ev((row) => { for (const id of row) window.__dx.shoot(id, [13.5, 1.65, -1.2]); }, row); await sleep(2200);
    await shot('lanterns-after');
    await reset();
    await place([-27, 1.65, 6.2], [-6, 2.2, 6.2]); await sleep(1500); await shot('street-lamps-before');
    await ev(() => { const { it, shoot } = window.__dx; for (let i = 0; i < 10; i++) if (it('streetlamp-' + i)) shoot('streetlamp-' + i, [window.__dx.c(it('streetlamp-' + i))[0], 1.7, 6.2]); });
    await sleep(2200); await shot('street-lamps-after');
  }
}

// ---- the gas bottle
if (part('gas')) {
  await reset();
  const g = await ev(async () => {
    const { G, c, it } = window.__dx, gas = it('stall-gas'), p = c(gas);
    const eye = window.__dx.clear('stall-gas', 3.4, 1.3, Math.PI / 2), e = G.enemies.list.find((x) => x.id === 'g1');
    G.enemies.revive(e, [p[0] + 1.2, p[1], p[2] + 2.6], 1); G.enemies.stun(e, 8); const hp0 = e.hp;
    window.__mirage.play.place(eye, p, 'walk');
    await new Promise((r) => setTimeout(r, 400));
    G.player.hp = 100;
    window.__dx.shoot('stall-gas', eye); window.__dx.shoot('stall-gas', eye);
    await new Promise((r) => setTimeout(r, 3600));
    const out = { broken: gas.broken, enemy: [hp0, e.hp, e.dead], player: G.player.hp, fire: window.__dx.events.some((x) => x[0] === 'fire' && x[1] === 'stall-gas') };
    out.dist = [Math.hypot(e.pos[0] - p[0], e.pos[2] - p[2]).toFixed(1), Math.hypot(G.player.feet[0] - p[0], G.player.feet[2] - p[2]).toFixed(1)];
    return out;
  });
  console.log('gas', JSON.stringify(g));
  ok(g.broken && g.fire, 'the gas bottle shot: it burns, then goes off');
  ok(g.enemy[2] || g.enemy[1] < g.enemy[0], `its blast hurts a robot ${g.dist[0]} m away (hp ${g.enemy[0]} -> ${g.enemy[1]}${g.enemy[2] ? ', dead' : ''})`);
  ok(g.player < 100, `and the player ${g.dist[1]} m away (hp 100 -> ${g.player.toFixed(0)})`);
  if (SHOTS) {
    await ev(() => window.__dx.calm());
    await reset();
    await place([13.8, 1.7, -2.2], [8.6, 0.8, -3.6]); await sleep(1200); await shot('gas-before');
    await ev(() => { window.__dx.shoot('stall-gas', [13.8, 1.7, -2.2]); window.__dx.shoot('stall-gas', [13.8, 1.7, -2.2]); }); await sleep(1500); await shot('gas-burning');
    await sleep(1350); await shot('gas-blast'); await sleep(1500); await shot('gas-after');
  }
  await reset();
  const w = await ev(async () => {
    const { G, c, it } = window.__dx, p = c(it('stall-gas'));
    // behind the container: its back wall between the bottle and the player
    window.__mirage.play.place([p[0] - 3.6, 1.78, p[2]], p, 'walk');
    await new Promise((r) => setTimeout(r, 400));
    G.player.hp = 100; window.__dx.d.break('stall-gas');
    await new Promise((r) => setTimeout(r, 900));
    return { hp: G.player.hp, cover: window.__dx.d.cover(p, [p[0] - 3.6, 1.2, p[2]]) };
  });
  ok(w.hp === 100 && w.cover === 0, `behind the stall's wall the blast does nothing (hp ${w.hp.toFixed(0)}, cover ${w.cover})`);
}

// ---- the car
if (part('car')) {
  await reset();
  const car = await ev(async () => {
    const { d, G, c, it, shoot, events } = window.__dx, body = it('car-0'), from = [c(body)[0] + 0.5, 1.4, c(body)[2] + 5];
    const pane = d.items.find((x) => x.id.startsWith('car-0-glass')), tyre = it('car-0-tyre-1');
    G.player.hp = 100;
    for (let k = 0; k < 3 && !pane.broken; k++) shoot(pane.id, from);
    for (let k = 0; k < 6 && !tyre.broken; k++) shoot(tyre.id, [c(tyre)[0], 0.4, c(tyre)[2] + 4]);
    await new Promise((r) => setTimeout(r, 100));
    const lured0 = window.__mirage.g.game.flags.lured || 0;
    for (let k = 0; k < 120 && !body.burning && !body.broken; k++) shoot('car-0', [c(body)[0], 0.7, c(body)[2] + 4]);
    await new Promise((r) => setTimeout(r, 6500));
    const order = events.filter((e) => (e[0] === 'break' && e[1].startsWith('car-0')) || (e[0] === 'noise' && e[3] === 'alarm') || (e[0] === 'fire' && e[1] === 'car-0')).map((e) => (e[0] === 'break' ? (e[1] === 'car-0' ? 'explode' : e[1].includes('glass') ? 'glass' : 'tyre') : e[0] === 'noise' ? 'alarm' : 'fire'));
    const firstOf = (k) => order.indexOf(k);
    return { order: [...new Set(order)], idx: ['glass', 'tyre', 'alarm', 'fire', 'explode'].map(firstOf), lured: (window.__mirage.g.game.flags.alarms || 0), blasts: events.filter((e) => e[0] === 'blast').length, lured0 };
  });
  const [gi, ti, ai, fi, xi] = car.idx;   // (the alarm may go with the glass: a pane shot through hits the car)
  ok(gi >= 0 && ti > gi && ai >= 0 && ai < fi && fi > ti && xi > fi, `the car: ${car.order.join(' -> ')}`);
  ok(car.lured > 0, 'its alarm sounded (robots lured as by the hack)');
  if (SHOTS) {
    await ev(() => window.__dx.calm());
    await reset();
    const eye = [-21.5, 1.6, 12.3], at = [-21.5, 0.8, 7.3];
    await place(eye, at); await sleep(1200); await shot('car-whole');
    await ev(() => { const { d, shoot } = window.__dx; for (const x of d.items.filter((i) => i.id.startsWith('car-0-glass'))) for (let k = 0; k < 2; k++) shoot(x.id, [-21.5, 1.6, 12.3]); });
    await sleep(500); await shot('car-glass');
    await ev(() => { const { shoot, it, c } = window.__dx; for (const t of ['car-0-tyre-1', 'car-0-tyre-3']) for (let k = 0; k < 4; k++) shoot(t, [c(it(t))[0], 0.4, 12]); });
    await sleep(500); await shot('car-tyres');
    await ev(() => { const { shoot, it } = window.__dx; for (let k = 0; k < 120 && !it('car-0').burning; k++) shoot('car-0', [-21.5, 0.7, 12]); });
    await sleep(2500); await shot('car-fire');
    await sleep(3000); await shot('car-explosion'); await sleep(2000); await shot('car-after');
  }
}

// ---- civilians
if (part('civilians')) {
  await reset();
  const civ = await ev(async () => {
    const { G, P } = window.__dx, list = P.civ.filter((x) => x.u.kind === 'pedestrian');
    const a = list[0], b = list.find((x) => Math.hypot(x.pos[0] - a.pos[0], x.pos[2] - a.pos[2]) > 15) || list[list.length - 1];
    const civ0 = P.score.civilians, chest = (x) => [x.pos[0], x.pos[1] + 1.0, x.pos[2]];
    // the player's round
    const pa = chest(a), from = window.__dx.clear(a.item.id, 4, 0.3), dir = [pa[0] - from[0], pa[1] - from[1], pa[2] - from[2]], L = Math.hypot(...dir);
    for (let k = 0; k < 4 && !a.item.broken; k++) P.shoot(from, dir.map((v) => v / L), L + 1, 22);
    await new Promise((r) => setTimeout(r, 120));
    const warn = G.hud.warning, tally = document.querySelector('.nd-tally')?.textContent;
    await new Promise((r) => setTimeout(r, 900));
    const res = { a: a.item.broken, folded: a.k, civ: P.score.civilians - civ0, warn, panics: window.__mirage.g.game.flags.panics || 0, penalty: G.stats.penalty };
    // a robot's round
    const pb = chest(b);
    const fb = window.__dx.clear(b.item.id, 5, 0.3); for (let k = 0; k < 6 && !b.item.broken; k++) P.enemyShot(fb, pb);
    await new Promise((r) => setTimeout(r, 200));
    res.b = b.item.broken; res.civAfterEnemy = P.score.civilians - civ0; res.other = P.score.others;
    // tally on the HUD
    await new Promise((r) => setTimeout(r, 200)); res.tally = document.querySelector('.nd-tally')?.textContent || tally;
    return res;
  });
  ok(civ.a && civ.folded > 0.5, `the player's round fells a civilian (it folds over: ${civ.folded.toFixed(2)})`);
  ok(civ.civ === 1 && civ.penalty === 500 && /500/.test(civ.warn || ''), `charged: 1 casualty, -${civ.penalty} points, the warning "${civ.warn}"`);
  ok(civ.panics > 0, `its neighbours panic (${civ.panics} panic events)`);
  ok(civ.b && civ.civAfterEnemy === 1 && civ.other >= 1, `a robot's round fells one: nothing charged (charged ${civ.civAfterEnemy}, others ${civ.other})`);
  ok(/civ 1/.test(civ.tally || ''), `the HUD tally: "${civ.tally}"`);
  // a civilian between the player and a robot takes the round: the real weapon, one shot
  await reset();
  const block = await ev(async () => {
    const { G, P } = window.__dx, c = P.civ.find((x) => x.u.kind === 'pedestrian' && !x.item.broken);
    const at = c.pos, eye = window.__dx.clear(c.item.id, 4, 0.5), e = G.enemies.list.find((x) => x.id === 'g1');
    const dx = at[0] - eye[0], dz = at[2] - eye[2], l = Math.hypot(dx, dz);
    G.enemies.revive(e, [at[0] + dx / l * 2.2, at[1], at[2] + dz / l * 2.2], 1); G.enemies.stun(e, 6);
    window.__mirage.play.place(eye, [e.pos[0], e.pos[1] + 1.1, e.pos[2]], 'walk');
    await new Promise((r) => setTimeout(r, 300));
    G.weapon.select('sidearm'); await new Promise((r) => setTimeout(r, 900));
    window.__mirage.play.lookAt([e.pos[0], e.pos[1] + 1.1, e.pos[2]]);
    G.stats.shots0 = G.stats.shots;
    const hp0 = e.hp; return { hp0, id: c.item.id, epos: e.pos.slice() };
  });
  await page.keyboard.down('KeyF'); await sleep(90); await page.keyboard.up('KeyF'); await sleep(500);
  const blk = await ev((id) => { const { d, G } = window.__dx, e = G.enemies.list.find((x) => x.id === 'g1'); return { civ: d.get(id).health < d.get(id).max || d.get(id).broken, hp: e.hp, shots: G.stats.shots - G.stats.shots0 }; }, block.id);
  ok(blk.shots > 0 && blk.civ && blk.hp === block.hp0, `a civilian between the player and a robot takes the round (${blk.shots} fired, civilian hit ${blk.civ}, robot hp ${block.hp0} -> ${blk.hp})`);
  if (SHOTS) {
    await ev(() => window.__dx.calm());
    await reset();
    const v = await ev(() => { const c = window.__dx.P.civ.find((x) => x.u.kind === 'pedestrian'); return { p: c.pos.slice(), eye: window.__dx.clear(c.item.id, 3.4, 1.45) }; });
    await place(v.eye, [v.p[0], v.p[1] + 0.9, v.p[2]]); await sleep(1200);
    await ev((v) => { const { P } = window.__dx, from = v.eye, to = [v.p[0], v.p[1] + 1, v.p[2]], dir = to.map((x, i) => x - from[i]), L = Math.hypot(...dir); for (let k = 0; k < 3; k++) P.shoot(from, dir.map((x) => x / L), L + 1, 22); }, v);
    await ev(() => window.__dx.uncalm()); await sleep(1100); await shot('civilian-felled', true);
  }
}

// ---- the end card in three languages
if (part('card')) {
  const card = [];
  for (const l of ['en', 'zh', 'ja']) {
    const r = await ev(async (l) => {
      const { G } = window.__dx; G.switchLang(l);
      const lines = G.cardLines(), T = G.text;
      window.__mirage.g.ui.message(T.doneTitle, T.doneBody({ diff: T.front.diffs.standard, rating: T.ratings[G.props.rate(3)], min: 5, sec: 12, kills: 20, acc: 40, shots: 300, heads: 4, deaths: 0 }) + lines, T.doneBtn);
      await new Promise((r) => setTimeout(r, 300));
      return { text: document.querySelector('.mg-msg-p')?.textContent || '', card: G.props.card(), rating: T.ratings[G.props.rate(3)], top: T.ratings[3] };
    }, l);
    if (SHOTS) await shot('end-card-' + l, true);
    await ev(() => document.querySelector('.mg-msg')?.close());
    card.push([l, r]);
  }
  for (const [l, r] of card) {
    const bill = String(r.card.bill).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    ok(r.text.includes(bill) && r.text.includes(String(r.card.civilians)) && (r.card.civilians === 0 || r.rating !== r.top), `${l}: the card has the bill (${bill}) and the casualties (${r.card.civilians}, rating ${r.rating})`);
  }
  await ev(() => window.__dx.G.switchLang('en'));
}

// ---- saves
if (part('saves')) {
  await reset();
  const s = await ev(async () => {
    const { d, G, m } = window.__dx, ids = ['shop-glass-2', 'streetlamp-4', 'bar-window-0', 'crate-alley-2'].filter((id) => d.get(id));
    const lampOf = (id) => { const ch = window.__dx.P.chans[d.get(id).lamps[0]]; return ch?.pool[0] ?? -1; };
    m.g.save('auto');
    for (const id of ids) d.break(id);
    await new Promise((r) => setTimeout(r, 1200));
    const broke = ids.map((id) => d.get(id).broken);
    m.g.load('auto');
    await new Promise((r) => setTimeout(r, 400));
    const whole = ids.map((id) => !d.get(id).broken);
    for (const id of ids) d.break(id);
    await new Promise((r) => setTimeout(r, 1200));
    m.g.save('auto');
    d.reset();
    m.g.load('auto');
    await new Promise((r) => setTimeout(r, 600));
    const again = ids.map((id) => d.get(id).broken), li = lampOf('streetlamp-4');
    const lampOff = li >= 0 ? G.kit.lamps.off[li] : (d.get('streetlamp-4') ? window.__dx.P.chans[d.get('streetlamp-4').lamps[0]].lights[0]?.userData.ndOff : 0);
    return { ids, broke, whole, again, lampOff };
  });
  ok(s.broke.every(Boolean) && s.whole.every(Boolean), `save, break, load: whole again (${s.ids.join(', ')})`);
  ok(s.again.every(Boolean) && s.lampOff === 0, `break, save, load: broken again, the street lamp still out (${s.lampOff})`);
}

// ---- stress: a gatling sweep down the street, a rocket into the stall
if (part('stress')) {
  await reset();
  await place([-30, 1.7, 6.5], [10, 2, 6]); await sleep(1500);
  const r = await ev(async () => {
    const { d, P } = window.__dx, times = [];
    let last = performance.now(), run = true, a = 0;
    const raf = () => { const t = performance.now(); times.push(t - last); last = t; if (run) requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    const t0 = performance.now(); let maxD = 0, maxM = 0;
    await new Promise((res) => {
      const iv = setInterval(() => {
        const el = (performance.now() - t0) / 1000;
        for (let k = 0; k < 2; k++) { a += 0.035; const yaw = -0.45 + 0.9 * (0.5 + 0.5 * Math.sin(a * 2.3)), pitch = -0.05 + 0.25 * Math.sin(a * 5.1); P.shoot([-30, 1.7, 6.5], [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)], 70, 11, 1, 'gatling'); }
        maxD = Math.max(maxD, d.stats.debris); maxM = Math.max(maxM, d.stats.marks);
        if (el > 4) { clearInterval(iv); res(); }
      }, 42);
    });
    P.blast([8.6, 1.4, -5.6], 5.5, 220);
    await new Promise((res) => setTimeout(res, 2000));
    maxD = Math.max(maxD, d.stats.debris); maxM = Math.max(maxM, d.stats.marks);
    run = false;
    const s = times.slice(5).sort((x, y) => x - y), mean = s.reduce((x, y) => x + y, 0) / s.length;
    return { broken: d.tally.count, maxD, maxM, capD: d.cfg.maxDebris, capM: d.cfg.maxDecals, mean, p95: s[Math.floor(s.length * 0.95)], movers: d.stats.movers, dropped: d.stats.spawnDropped };
  });
  console.log('stress', JSON.stringify(r));
  ok(r.broken > 40, `the sweep broke ${r.broken} props`);
  ok(r.maxD <= r.capD && r.maxM <= r.capM, `caps hold: debris at most ${r.maxD} of ${r.capD}, marks ${r.maxM} of ${r.capM}`);
  ok(r.p95 < 60, `frame time under the stress (headless): mean ${r.mean.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms`);
  if (SHOTS) {
    await ev(() => window.__dx.calm());
    await reset();
    await place([14, 1.7, -1], [7.5, 1.6, -5.6]); await sleep(1500); await shot('stall-before');
    await ev(() => window.__dx.P.blast([9.0, 1.2, -5.2], 5.5, 220)); await sleep(350); await shot('stall-rocket');
    await sleep(1600); await shot('stall-after');
    await reset();
    // a shop window, a vending machine
    const sw = await ev(() => { const x = window.__dx.it('shop-glass-3') || window.__dx.d.items.find((i) => i.tags[0] === 'shop-glass'); return { id: x.id, eye: window.__dx.front(x.id, 3.2, 0.1), p: window.__dx.c(x) }; });
    await place(sw.eye, sw.p); await sleep(1200); await shot('window-before');
    await ev((id, eye) => window.__dx.shoot(id, eye, 12), sw.id, sw.eye); await sleep(150); await shot('window-cracked');
    await ev((id, eye) => { for (let k = 0; k < 3; k++) window.__dx.shoot(id, eye); }, sw.id, sw.eye); await sleep(250); await shot('window-shattering'); await sleep(2500); await shot('window-after');
    const vm = await ev(() => { const x = window.__dx.it('vend-3'); return { eye: window.__dx.front('vend-3', 2.6, 0.2), p: window.__dx.c(x) }; });
    await place(vm.eye, vm.p); await sleep(1200); await shot('vending-before');
    await ev(() => { const { d } = window.__dx; d.damage('vend-3-glass', 99, 'bullet'); for (let k = 0; k < 8; k++) d.damage('vend-3', 22, 'bullet'); }); await sleep(300); await shot('vending-burst');
    await sleep(2500); await shot('vending-after');
  }
}

// ---- errors
const errs = errors.filter((e) => !/favicon|AudioContext/.test(e));
ok(errs.length === 0, `no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
const bad = results.filter((r) => !r[0]);
console.log(`destruct-check: ${results.length - bad.length} of ${results.length} ok${bad.length ? '; failed: ' + bad.map((r) => r[1]).join(' / ') : ''}`);
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
