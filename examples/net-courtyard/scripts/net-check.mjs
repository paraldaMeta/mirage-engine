// Mirage original code. The multiplayer browser check: `npm run build && npm run check` in this folder.
// Starts the real server (127.0.0.1, a free port) with 150 ms of latency and 5 % loss in each direction, opens
// CLIENTS headless-Chrome pages that walk by themselves (?bot=1), and asserts:
//   - everyone joins the server's room and sees everyone else, with names;
//   - while walking, prediction error stays bounded (worst correction under 0.75 m, and few of them);
//   - a chat line and the lantern pickups reach every page;
//   - when the bots stop, every page's picture of every player converges on the server's position (2 cm), and each
//     page's own predicted position equals the server's (5 mm: the wire's 1/256 m);
// then host mode: one page hosts, two join by code (WebRTC when the browser gives it, else the relay), the host's
// page is closed, and the room carries on in the page the lobby picks (migration).
// usage: node scripts/net-check.mjs [--clients 3] [--seconds 10] [--latency 150] [--loss 0.05] [--no-host]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '@mirage/tools/src/chrome.mjs';
import { createServer } from '@mirage/net/server';
import * as game from '../game.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : +process.argv[i + 1]; };
const CLIENTS = arg('clients', 3), SECONDS = arg('seconds', 10), LATENCY = arg('latency', 150), LOSS = arg('loss', 0.05);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { if (!ok) bad.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };

const srv = createServer({ protocol: game.protocol, grid: new Uint8Array(readFileSync(here('../public/grid.bin'))), spawn: game.spawn, tickRate: game.tickRate, dir: here('../dist'),
  setup: game.setup, conditions: { latency: LATENCY, loss: LOSS }, onError: (e) => console.error('server:', e?.message || e) });
const at = await srv.listen(0);
const entry = srv.open('Courtyard', { code: 'YARD', persistent: true });
// one Chrome per player: a page that is not the front tab of its window gets no animation frames, and would not walk
const browsers = [];
const PAGE = 'w=480&h=300&quality=low&spp=1&ui=0&hud=0&bot=1';
async function page(query) {
  const browser = await launch({ w: 480, h: 300 }); browsers.push(browser);
  const p = await browser.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`${at.url}/?${PAGE}&${query}`);
  await p.waitForFunction('window.__READY === true', { timeout: 120000 });
  return Object.assign(p, { errors, quit: () => browser.close() });
}
const joined = (p) => p.waitForFunction('window.__mirage.net.client && window.__mirage.net.client.status === "joined"', { timeout: 30000 });
/** what a page believes: itself, the others, the lanterns, its counters */
const view = (p) => p.evaluate(() => {
  const { client, session, chat, took } = window.__mirage.net, s = client.stats;
  return { id: client.id, pos: [...client.walker.pos], kind: client.transport?.kind, mode: session.mode, hosting: !!session.room, status: client.status, code: session.lobby.code,
    players: [...client.entities.values()].filter((e) => e.name === 'player').map((e) => ({ id: e.id, own: !!e.own, name: e.state.name, x: e.state.x, y: e.state.y, z: e.state.z, score: e.state.score, away: !!e.state.away })),
    pickups: [...client.entities.values()].filter((e) => e.name === 'pickup').map((e) => ({ id: e.id, taken: !!e.state.taken })),
    labels: [...document.querySelectorAll('#labels div')].map((d) => d.textContent), chat, took: took.length,
    stats: { rtt: s.rtt, loss: s.loss, delay: s.delay, predErr: s.predErr, predErrMax: s.predErrMax, corrections: s.corrections, exact: s.exact, snapshots: s.snapshots, bytesIn: s.bytesIn, bytesOut: s.bytesOut } };
});

try {
  // ---- 1. the dedicated room under a bad network -----------------------------
  console.log(`net check: ${CLIENTS} pages on ${at.url}, ${LATENCY} ms and ${LOSS * 100} % loss each way, ${game.tickRate} Hz`);
  const names = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'].slice(0, CLIENTS);
  const pages = await Promise.all(names.map((n) => page(`name=${n}`)));
  await Promise.all(pages.map(joined));
  check(entry.room.players.size === CLIENTS, `${CLIENTS} players in the server's room (${entry.room.players.size})`);
  const t0 = Date.now(), before = await Promise.all(pages.map(view));
  await sleep(SECONDS * 1000);
  await pages[0].evaluate(() => window.__mirage.net.client.rpc('chat', { text: 'hello from Ada' }));
  const moving = await Promise.all(pages.map(view)), dt = (Date.now() - t0) / 1000;
  const walked = moving.map((v, i) => Math.hypot(v.pos[0] - before[i].pos[0], v.pos[2] - before[i].pos[2]));
  check(moving.every((v) => v.players.length === CLIENTS), `every page sees ${CLIENTS} players (${moving.map((v) => v.players.length)})`);
  check(moving.every((v) => v.labels.length === CLIENTS - 1 && v.labels.every((l) => names.some((n) => l.startsWith(n)))), `name labels over the others (${moving[0].labels.join(' | ')})`);
  check(moving.every((v) => v.stats.snapshots > SECONDS * game.tickRate * 0.6), `snapshots arrive (${moving.map((v) => v.stats.snapshots)})`);
  const worst = Math.max(...moving.map((v) => v.stats.predErrMax)), corr = moving.map((v) => v.stats.corrections), exact = moving.map((v) => v.stats.exact);
  check(worst < 0.75, `prediction error bounded while walking: worst correction ${(worst * 100).toFixed(1)} cm (limit 75)`);
  check(corr.every((c, i) => c <= 0.05 * (c + exact[i]) + 3), `corrections are rare: ${corr} against ${exact} exact acknowledgements`);
  console.log(`       rtt ${moving.map((v) => v.stats.rtt.toFixed(0))} ms, measured loss ${moving.map((v) => (v.stats.loss * 100).toFixed(1))} %, interpolation delay ${moving.map((v) => v.stats.delay.toFixed(0))} ms`);
  console.log(`       per player: ${moving.map((v, i) => `${((v.stats.bytesIn - before[i].stats.bytesIn) / dt).toFixed(0)} B/s down, ${((v.stats.bytesOut - before[i].stats.bytesOut) / dt).toFixed(0)} up`).join('; ')}`);
  console.log(`       server tick ${entry.room.stats.tickMs.toFixed(3)} ms mean, ${entry.room.stats.tickMax.toFixed(2)} max, ${entry.room.stats.overruns} overruns`);

  // stop, let the last inputs and snapshots through, then everyone must agree with the server
  await Promise.all(pages.map((p) => p.evaluate(() => { window.__mirage.net.still = true; })));
  await sleep(2500 + LATENCY * 4);
  const still = await Promise.all(pages.map(view));
  const truth = new Map([...entry.room.players.values()].map((p) => [p.id, { pos: [...p.walker.pos], name: p.name }]));
  let own = 0, others = 0;
  for (const v of still) {
    const me = truth.get(v.id); own = Math.max(own, Math.hypot(v.pos[0] - me.pos[0], v.pos[1] - me.pos[1], v.pos[2] - me.pos[2]));
    for (const p of v.players) if (!p.own) { const t = truth.get(p.id); others = Math.max(others, t ? Math.hypot(p.x - t.pos[0], p.y - t.pos[1], p.z - t.pos[2]) : 99); }
  }
  check(own < 0.005, `after stopping, each page's own position is the server's: worst ${(own * 1000).toFixed(2)} mm (limit 5)`);
  check(others < 0.02, `after stopping, every page's picture of the others is the server's: worst ${(others * 1000).toFixed(2)} mm (limit 20)`);
  check(Math.min(...walked) > 1, `the bots really walked (${walked.map((d) => d.toFixed(1))} m from where they began)`);
  check(still.every((v) => v.chat.some((c) => c.text === 'hello from Ada')), 'the chat line reached every page');
  const taken = [...entry.room.entities.values()].filter((e) => e.type.name === 'pickup').map((e) => [e.id, !!e.state.taken]);
  check(taken.length === game.pickups.length && still.every((v) => taken.every(([id, t]) => v.pickups.find((p) => p.id === id)?.taken === t)), `all ${taken.length} lanterns in the same state on every page as on the server (${taken.filter((t) => t[1]).length} taken now)`);
  const scores = [...entry.room.players.values()].map((p) => [p.id, p.ent.state.score]);
  check(still.every((v) => scores.every(([id, s]) => v.players.find((p) => p.id === id)?.score === s)), `scores agree (${scores.map((s) => s[1])}; ${still[0].took} pickups announced)`);
  check(pages.every((p) => !p.errors.length), `no page errors${pages.flatMap((p) => p.errors).slice(0, 3).map((e) => '\n         ' + e).join('')}`);
  await Promise.all(pages.map((p) => p.quit()));

  // ---- 2. host mode and migration --------------------------------------------
  if (!process.argv.includes('--no-host')) {
    console.log('net check: host mode (one page is the server), then the host leaves');
    const host = await page('name=Hana&host=1'); await joined(host);
    const code = (await view(host)).code;
    check(/^[A-Z2-9]{4,8}$/.test(code), `the host has a room code (${code})`);
    const a = await page(`name=Ivo&room=${code}`), b = await page(`name=Jun&room=${code}`);
    await joined(a); await joined(b);
    await sleep(5000);
    const hv = await view(host), av = await view(a), bv = await view(b);
    check(hv.hosting && hv.players.length === 3 && av.players.length === 3 && bv.players.length === 3, `three players in the hosted room (${[hv, av, bv].map((v) => v.players.length)})`);
    console.log(`       members reach the host over: ${av.kind}, ${bv.kind}`);
    const snaps = av.stats.snapshots;
    await host.quit();
    await a.waitForFunction('window.__mirage.net.session.migrations > 0 || !!window.__mirage.net.session.room', { timeout: 20000 }).catch(() => {});
    await b.waitForFunction('window.__mirage.net.session.migrations > 0 || !!window.__mirage.net.session.room', { timeout: 20000 }).catch(() => {});
    await sleep(5000);
    const a2 = await view(a), b2 = await view(b), here = (v) => v.players.filter((p) => !p.away).length;
    check(a2.hosting !== b2.hosting, `exactly one of the two became the host (${a2.hosting ? 'Ivo' : b2.hosting ? 'Jun' : 'neither'})`);
    check(a2.status === 'joined' && b2.status === 'joined' && here(a2) === 2 && here(b2) === 2, `both play on as themselves; the old host is marked away until its place times out (${a2.status}/${b2.status}, ${here(a2)}/${here(b2)} present)`);
    check(a2.id === av.id && b2.id === bv.id, 'player ids survived the migration');
    check(a2.stats.snapshots > snaps, 'snapshots flow again');
    check(!a.errors.length && !b.errors.length, `no page errors${[...a.errors, ...b.errors].slice(0, 3).map((e) => '\n         ' + e).join('')}`);
  }
} catch (e) { bad.push(e.message); console.error('  FAIL', e); }
await Promise.all(browsers.map((b) => b.close().catch(() => {})));
await srv.close();
if (bad.length) { console.error(`net check: FAIL (${bad.length})`); process.exit(1); }
console.log('net check: all ok');
process.exit(0);
