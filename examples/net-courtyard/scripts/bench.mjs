// Mirage original code. Numbers for docs/multiplayer.md: `npm run bench` in this folder (Node only, no browser).
// The real room and real clients over the in-memory network (a virtual clock, so the traffic is exact and
// repeatable), every player walking and turning in the courtyard, 6 lanterns, no interest radius (everyone sees
// everyone: the worst case). Wall time is measured around room.tick() only.
//   1. bytes a second per player, down and up, at 20 and 60 Hz, on a clean network and at 150 ms + 5 % loss;
//   2. the tick's cost against player count, and the largest room whose 99th percentile tick fits its budget.
// usage: node scripts/bench.mjs [--runs 3] [--seconds 20] [--max 1024]
import { readFileSync } from 'node:fs';
import { createLoopbackNetwork, createRoom, createClient, deserializeGrid } from '@mirage/net';
import * as game from '../game.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : +process.argv[i + 1]; };
const RUNS = arg('runs', 3), SECONDS = arg('seconds', 20), MAX = arg('max', 1024);
const grid = deserializeGrid(new Uint8Array(readFileSync(new URL('../public/grid.bin', import.meta.url))));

function run({ players, tickRate, seconds, conditions = {}, seed = 1 }) {
  const net = createLoopbackNetwork({ seed: 'bench/' + seed, ...conditions }), now = () => net.now;
  const room = createRoom({ protocol: game.protocol, grid, spawn: game.spawn, tickRate, maxPlayers: players, now });
  game.setup(room);
  const clients = [], ends = [];
  for (let i = 0; i < players; i++) {
    const [a, b] = net.pair(); room.accept(b);
    const c = createClient({ protocol: game.protocol, grid, name: 'p' + i, now }); c.connect(a); clients.push(c); ends.push([a, b]);
  }
  const ticks = [];
  let acc = 0, mark = null;
  const total = () => ends.reduce((s, [a, b]) => [s[0] + b.bytes, s[1] + a.bytes], [0, 0]);
  for (let f = 0, n = Math.round((seconds + 2) * 60); f < n; f++) {
    const t = f / 60;
    if (f === 120) mark = total();   // the first two seconds (joining, full states) are not counted
    for (let i = 0; i < players; i++) {
      const c = clients[i], k = Math.floor(t / 1.7 + i * 0.37);
      c.input.x = 0; c.input.z = 1; c.input.run = k % 3 === 0; c.input.jump = f % 97 === i % 97; c.input.yaw = k * 2.1 + i;
      c.update();
    }
    net.advance(1000 / 60); acc += 1000 / 60;
    while (acc >= room.tickMs - 1e-6) { acc -= room.tickMs; const t0 = performance.now(); room.tick(); if (f >= 120) ticks.push(performance.now() - t0); }
  }
  const end = total(); ticks.sort((a, b) => a - b);
  const joined = clients.filter((c) => c.status === 'joined').length;
  return { joined, down: (end[0] - mark[0]) / seconds / players, up: (end[1] - mark[1]) / seconds / players,
    mean: ticks.reduce((a, b) => a + b, 0) / ticks.length, p99: ticks[Math.floor(ticks.length * 0.99)], max: ticks[ticks.length - 1] };
}
const span = (v, d = 0) => { const lo = Math.min(...v), hi = Math.max(...v); return lo.toFixed(d) === hi.toFixed(d) ? lo.toFixed(d) : `${lo.toFixed(d)}-${hi.toFixed(d)}`; };

console.log(`net bench: node ${process.version}, ${RUNS} runs each (min-max), ${SECONDS} s measured after 2 s of warm-up`);
console.log('1. traffic per player, 4 players in the room (B/s, packet payloads; a WebSocket frame adds 2-8 bytes a packet, UDP/DTLS about 50)');
for (const [label, conditions] of [['clean network', {}], ['150 ms + 5 % loss each way', { latency: 150, loss: 0.05 }]]) {
  // interleaved: 20, 60, 20, 60, ...
  const r = { 20: [], 60: [] };
  for (let i = 0; i < RUNS; i++) for (const hz of [20, 60]) r[hz].push(run({ players: 4, tickRate: hz, seconds: SECONDS, conditions, seed: i }));
  for (const hz of [20, 60]) console.log(`   ${label}, ${hz} Hz: down ${span(r[hz].map((x) => x.down))}, up ${span(r[hz].map((x) => x.up))}`);
}
console.log('2. tick cost against players (ms; budget 50 at 20 Hz, 16.7 at 60 Hz)');
for (const hz of [20, 60]) {
  let best = 0;
  for (let n = 4; n <= MAX; n *= 2) {
    const secs = n >= 256 ? 4 : 8, r = [];
    for (let i = 0; i < RUNS; i++) r.push(run({ players: n, tickRate: hz, seconds: secs, seed: i }));
    const p99 = Math.max(...r.map((x) => x.p99)), fits = p99 < 1000 / hz && r.every((x) => x.joined === n);
    console.log(`   ${hz} Hz, ${String(n).padStart(4)} players: mean ${span(r.map((x) => x.mean), 3)}, p99 ${span(r.map((x) => x.p99), 2)}, max ${span(r.map((x) => x.max), 2)}; ${(Math.max(...r.map((x) => x.mean)) * hz / 10).toFixed(2)} % of one core; down ${span(r.map((x) => x.down))} B/s each${fits ? '' : '   <- over budget'}`);
    if (!fits) break;
    best = n;
  }
  console.log(`   ${hz} Hz: largest room tried whose p99 tick fits: ${best} players${best === MAX ? ' (the largest tried)' : ''}`);
}
