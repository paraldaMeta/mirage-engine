// Node checks of @miragekit/net on a virtual clock: wire, loopback, channel, schema, grid, determinism, a room with
// clients under latency, jitter, loss, duplication and reordering (prediction, interpolation, interest, events,
// lag compensation, reconnect, late join, anti-cheat, hostile input, migration). No sockets here: server.check.mjs.
import { BitWriter, BitReader, seqDiff, cleanText, MSG } from './src/wire.js';
import { createLoopbackNetwork } from './src/transport.js';
import { createChannel } from './src/channel.js';
import { defineProtocol, field, pack, unpack, encodeFull, decodeFull, encodeDelta, decodeDelta, differs } from './src/schema.js';
import { bakeGridCPU, boxTriangles, serializeGrid, deserializeGrid, gridRay } from './src/grid.js';
import { quantiseInput, applyInput, writeInput, readInput } from './src/sim.js';
import { createRoom } from './src/room.js';
import { createClient } from './src/client.js';
import { createWalker } from '@miragekit/play/walker';
import { rng } from '@miragekit/core/rng';

import { ok } from '../../scripts/soft-assert.mjs';   // reports every failure with a count, not only the first
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ---- wire -------------------------------------------------------------------
{
  const w = new BitWriter(64); w.bits(5, 3).bool(true).varu(300).vari(-77).f32(1.5).str('héllo', 32).bits(0xdeadbeef, 32);
  const r = new BitReader(w.bytes());
  ok(r.bits(3) === 5 && r.bool() && r.varu() === 300 && r.vari() === -77 && r.f32() === 1.5 && r.str(32) === 'héllo' && r.bits(32) === 0xdeadbeef && r.ok, 'wire: bits, varints, floats and strings round trip');
  r.bits(32); ok(!r.ok, 'wire: reading past the end clears ok instead of throwing');
  const h = new BitReader(new Uint8Array([255, 255, 255, 255, 255, 255])); h.str(8); ok(!h.ok, 'wire: a string longer than its cap is refused before it is allocated');
  const f = new BitWriter(4); f.bits(1, 32).bits(1, 8); ok(f.full && f.size === 4, 'wire: the writer stops at its cap');
  const g = new BitWriter(16); g.bits(3, 5); const m = g.n; g.bits(0xffff, 16); g.rewind(m); g.bits(0, 3); ok(g.bytes()[0] === 3 && g.size === 1, 'wire: rewind erases what followed');
  ok(seqDiff(2, 65534) === 4 && seqDiff(65534, 2) === -4, 'wire: sequence numbers wrap');
  ok(cleanText('  a\u0000b‮c\n ', 10) === 'abc', 'wire: cleanText strips control and direction-override characters');
}

// ---- loopback -----------------------------------------------------------------
{
  const trace = (seed) => {
    const net = createLoopbackNetwork({ seed, latency: 50, jitter: 20, loss: 0.2, duplicate: 0.1, reorder: 0.1 }), [a, b] = net.pair(), got = [];
    b.onmessage = (u) => got.push(u[0] + '@' + net.now.toFixed(3));
    for (let i = 0; i < 200; i++) { a.send(new Uint8Array([i])); net.advance(5); }
    net.advance(500);
    return got;
  };
  const x = trace('s1'), y = trace('s1'), z = trace('s2');
  ok(x.join() === y.join() && x.join() !== z.join(), `loopback: deterministic per seed (${x.length} deliveries of 200 sends)`);
  const ids = x.map((s) => +s.split('@')[0]);
  ok(ids.length < 200 * 1.1 && new Set(ids).size < 190 && ids.length > new Set(ids).size && ids.some((v, i) => i && v < ids[i - 1]), 'loopback: loses, duplicates and reorders');
}

// ---- channel ------------------------------------------------------------------
{
  const net = createLoopbackNetwork({ seed: 'channel', latency: 60, jitter: 25, loss: 0.25, duplicate: 0.05, reorder: 0.1 }), [ta, tb] = net.pair(), now = () => net.now;
  const gotR = [], gotU = [], acks = [];
  const A = createChannel({ transport: ta, now, onAck: (s) => acks.push(s) });
  const B = createChannel({ transport: tb, now, maxReliableIn: 1 << 16, onReliable: (u) => gotR.push(u), onUnreliable: (u) => gotU.push(u[0] | (u[1] << 8)) });
  const R = rng('channel-data'), sent = [];
  for (let i = 0; i < 600; i++) {
    if (i < 300 && i % 3 === 0) { const m = new Uint8Array(1 + Math.floor(R.next() * (i % 30 === 0 ? 3000 : 200))).map(() => Math.floor(R.next() * 256)); sent.push(m); A.sendReliable(m); }
    if (i < 300) A.sendUnreliable(new Uint8Array([i & 255, i >> 8]));
    net.advance(16); A.update(); B.update();
  }
  ok(gotR.length === sent.length && gotR.every((m, i) => m.length === sent[i].length && m.every((v, j) => v === sent[i][j])), `channel: ${sent.length} reliable messages (up to 3 KB) arrive once, whole and in order under 25 % loss`);
  ok(new Set(gotU).size === gotU.length && gotU.length > 180 && gotU.length < 260, `channel: unreliable messages arrive at most once (${gotU.length} of 300)`);
  ok(A.stats.rtt > 100 && A.stats.rtt < 200, `channel: round trip estimate ${A.stats.rtt.toFixed(0)} ms for 120 ms + jitter`);
  ok(acks.length > 150 && new Set(acks).size === acks.length, 'channel: each packet is acknowledged at most once');
  ok(A.pendingReliable === 0, 'channel: nothing left to resend');
  let why = '';
  const [tc, td] = net.pair({ loss: 0, latency: 0, jitter: 0, duplicate: 0, reorder: 0 });
  createChannel({ transport: td, now, maxReliableIn: 100, onViolation: (w) => { why = w; } });
  const C = createChannel({ transport: tc, now });
  C.sendReliable(new Uint8Array(900)); C.update(); net.advance(1); C.sendUnreliable(new Uint8Array(1)); net.advance(1);
  ok(why === 'reliable message too large', 'channel: a reliable message over the cap is a violation, not an allocation');
  why = ''; tc.send(new Uint8Array(5000)); net.advance(1); ok(why === 'packet size', 'channel: an oversized packet is a violation');
}

// ---- schema -------------------------------------------------------------------
const protocol = defineProtocol({
  bounds: [-20, -20, 20, 20], y: [-2, 12],
  player: [field.u('score', 10)],
  entities: { pickup: [field.pos(), field.u('kind', 3), field.bool('taken')], mover: [field.pos(), field.angle('yaw')], note: [field.str('text', 40)] },
  rpcs: { chat: [field.str('text', 120)], fire: [field.f32('dx'), field.f32('dy'), field.f32('dz')], take: [field.u('id', 16)] },
  events: { chat: [field.u('from', 16), field.str('text', 120)], hit: [field.u('by', 16), field.u('target', 16)] },
});
{
  const s = protocol.type.mover, R = rng('schema');
  let base = pack(s, { x: 1, y: 0, z: 2, yaw: 6.2 }), fine = true, small = 0, n = 0;
  for (let i = 0; i < 2000; i++) {
    const far = R.next() < 0.1, st = unpack(s, base);
    const q = pack(s, { x: far ? R.next() * 40 - 20 : st.x + (R.next() - 0.5) * 0.1, y: st.y, z: st.z + (R.next() - 0.5) * 0.1, yaw: st.yaw + (R.next() - 0.5) * 0.3 });
    const w = new BitWriter(64); encodeDelta(w, s, q, base); const d = decodeDelta(new BitReader(w.bytes()), s, base);
    const f = new BitWriter(64); encodeFull(f, s, q);
    if (d.some((v, k) => v !== q[k])) fine = false;
    small += w.n; n += f.n; base = q;
  }
  ok(fine, 'schema: 2 000 random deltas decode to the same quantised state (angles wrap the short way)');
  ok(small < n * 0.62, `schema: deltas of small moves take ${(small / 2000 / 8).toFixed(1)} bytes against ${(n / 2000 / 8).toFixed(1)} for a full state`);
  const a = pack(s, { x: 3 }), b = a.slice(); ok(!differs(s, a, b), 'schema: equal states do not differ');
  ok(defineProtocol({ entities: { a: [field.pos()] } }).hash !== defineProtocol({ entities: { a: [field.pos(), field.u('k', 2)] } }).hash, 'schema: the protocol hash follows the definition');
  const t = protocol.rpc.chat, w = new BitWriter(200); encodeFull(w, t, pack(t, { text: 'x'.repeat(500) + '\u0007' }));
  ok(unpack(t, decodeFull(new BitReader(w.bytes()), t)).text.length === 120, 'schema: strings are cut to their cap on both ends');
  ok(Math.abs(unpack(s, pack(s, { x: 1.23456 })).x - 1.23456) < 1 / 256, 'schema: positions quantise to under 4 mm');
}

// ---- grid -----------------------------------------------------------------------
const boxes = [[-20, -1, -20, 20, 0, 20], [-20, 0, -0.3, -1, 3, 0.3], [1, 0, -0.3, 20, 3, 0.3], [5, 0, 5, 6, 0.6, 6], [-8, 0, 6, -6, 0.3, 8], [-8, 2.4, 6, -6, 2.6, 8]];
const baked = bakeGridCPU(boxTriangles(boxes), { bounds: [-20, -20, 20, 20], cell: 0.125, yMin: -1, yMax: 7 });
const gridBytes = serializeGrid(baked), grid = deserializeGrid(gridBytes);
{
  ok(baked.groundAt(0, 5) === 0 && baked.groundAt(10, 0) === 3 && Math.abs(baked.groundAt(5.5, 5.5) - 0.6) < 1e-6 && Number.isNaN(baked.groundAt(30, 0)), `grid: CPU bake of ${boxes.length} boxes finds floor, wall top and crate (${baked.stats.ms} ms, ${baked.stats.floors} floors)`);
  const L = baked.layers(-7, 7); ok(L.length === 2 && Math.abs(L[0][0] - 0.3) < 1e-6 && Math.abs(L[0][1] - 2.4) < 1e-6 && Math.abs(L[1][0] - 2.6) < 1e-6, 'grid: a slab over a platform is two layers with the ceiling between');
  let same = grid.nx === baked.nx && grid.cell === baked.cell && grid.x0 === baked.x0;
  for (let i = 0; i < baked.count.length && same; i++) if (baked.count[i] !== grid.count[i]) same = false;
  for (let i = 0; i < baked.floors.length && same; i++) if (!Object.is(baked.floors[i], grid.floors[i])) same = false;
  ok(same, `grid: serialise and load is bit exact (${baked.nx} x ${baked.nz} columns in ${gridBytes.length} bytes)`);
  const R = rng('grid-fuzz'); let refused = 0;
  for (let i = 0; i < 300; i++) { const b = gridBytes.slice(0, 37 + Math.floor(R.next() * 200)); for (let k = 0; k < 6; k++) b[Math.floor(R.next() * b.length)] = Math.floor(R.next() * 256); try { deserializeGrid(b); } catch { refused++; } }
  ok(refused === 300, 'grid: 300 truncated and corrupted files are all refused');
  const huge = gridBytes.slice(0, 60); new DataView(huge.buffer).setUint32(5, 1 << 30, true); ok(throws(() => deserializeGrid(huge)), 'grid: a header asking for 2^30 columns is refused before allocating');
  ok(gridRay(grid, [5, 1.5, 3], [0, 0, -1], 10) < 3 && gridRay(grid, [0, 1.5, 3], [0, 0, -1], 10) === Infinity, 'grid: a ray stops at the wall and passes the gate');
}

// ---- determinism ------------------------------------------------------------------
{
  const a = createWalker(baked, { pos: [0, 0, 5] }), b = createWalker(grid, { pos: [0, 0, 5] }), R = rng('inputs');
  let inp = quantiseInput({}), equal = true, moved = 0, jumps = 0;
  for (let i = 0; i < 4000; i++) {
    if (i % 23 === 0) { const ang = R.next() * 7; inp = quantiseInput({ x: Math.cos(ang) * 1.4, z: Math.sin(ang) * 1.4, run: R.next() < 0.6, jump: R.next() < 0.3, yaw: ang }); }
    const w = new BitWriter(8); writeInput(w, inp); const back = readInput(new BitReader(w.bytes()));   // b gets it over the wire
    const px = a.pos[0], pz = a.pos[2];
    applyInput(a, inp); applyInput(b, back);
    moved += Math.hypot(a.pos[0] - px, a.pos[2] - pz); if (a.vy > 0) jumps++;
    if (!Object.is(a.pos[0], b.pos[0]) || !Object.is(a.pos[1], b.pos[1]) || !Object.is(a.pos[2], b.pos[2]) || !Object.is(a.vy, b.vy) || a.onGround !== b.onGround) equal = false;
  }
  ok(equal && moved > 100 && jumps > 50, `sim: 4 000 inputs give two walkers the same bits (${moved.toFixed(0)} m walked, one over the wire and a reloaded grid)`);
  const w1 = createWalker(grid, { pos: [-15, 0, 10] }), w2 = createWalker(grid, { pos: [-15, 0, 10] });
  for (let i = 0; i < 120; i++) { applyInput(w1, quantiseInput({ x: 1, run: true })); applyInput(w2, { x: 127, z: 127, run: 1, jump: 0, yaw: 0 }); }
  ok(Math.abs(Math.hypot(w2.pos[0] + 15, w2.pos[2] - 10) - (w1.pos[0] + 15)) < 1e-6 && w1.pos[0] > -7, 'sim: a diagonal input at both maxima is no faster than a straight one');
}

// ---- a room and clients on one virtual clock ------------------------------------------
function world({ tickRate = 20, conditions = {}, seed = 'check', ...opts } = {}) {
  const net = createLoopbackNetwork({ seed, ...conditions }), now = () => net.now, clients = [];
  const room = createRoom({ protocol, grid, spawn: [0, 0, 5], tickRate, now, ...opts });
  let acc = 0;
  const W = {
    net, room, clients, now,
    add(name, o = {}) { const [a, b] = net.pair(o.conditions); room.accept(b, { key: o.key }); const c = createClient({ protocol, grid, name, now, ...o }); c.end = a; c.connect(a); clients.push(c); return c; },
    run(secs, each, after) {
      for (let f = 0, n = Math.round(secs * 60); f < n; f++) {
        net.advance(1000 / 60); acc += 1000 / 60;
        while (acc >= room.tickMs - 1e-6) { acc -= room.tickMs; room.tick(); }
        each?.(f);
        for (const c of clients) if (c.status !== 'closed') c.update();
        after?.(f);
      }
    },
    player: (c) => room.players.get(c.id),
  };
  return W;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const BAD = { latency: 150, jitter: 20, loss: 0.05, duplicate: 0.01, reorder: 0.02 };   // each way: 300 ms round trip

for (const tickRate of [20, 60]) {
  const W = world({ tickRate, conditions: BAD, seed: 'walk' + tickRate });
  const cs = ['Ada', 'Bo', 'Cy', 'Di'].map((n) => W.add(n));
  W.run(1.5);
  ok(cs.every((c) => c.status === 'joined' && c.id > 0) && W.room.players.size === 4, `room ${tickRate} Hz: 4 clients join through 150 ms each way, 5 % loss`);
  ok(cs.every((c) => c.entities.size === 4 && c.me && c.me.state.name === c.name), 'room: everyone sees everyone, names included');
  // server truth per tick, to judge what clients show of each other
  const truth = new Map(); let R = rng('walkers' + tickRate);
  let errSum = 0, errN = 0, errMax = 0;
  const seen = (t, id) => { const k = t / W.room.tickMs, a = truth.get(Math.floor(k))?.get(id), b = truth.get(Math.floor(k) + 1)?.get(id); if (!a || !b) return null; const u = k - Math.floor(k); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; };
  W.run(20, (f) => {
    if (f % 40 === 0) for (const c of cs) { const a = R.next() * 7; Object.assign(c.input, { x: Math.cos(a), z: Math.sin(a), run: R.next() < 0.5, jump: R.next() < 0.2, yaw: a }); }
    if (!truth.has(W.room.stats.tick)) truth.set(W.room.stats.tick, new Map([...W.room.players.values()].map((p) => [p.id, [...p.walker.pos]])));
  }, () => {
    const c = cs[0];
    for (const e of c.entities.values()) {
      if (e.own) continue;
      const s = seen(c.viewTime, e.id); if (!s) continue;
      const d = dist(s, [e.state.x, e.state.y, e.state.z]); errSum += d; errN++; if (d > errMax) errMax = d;
    }

  });
  for (const c of cs) Object.assign(c.input, { x: 0, z: 0, run: false, jump: false });
  W.run(2.5);
  const off = cs.map((c) => dist(c.walker.pos, W.player(c).walker.pos));
  ok(Math.max(...off) < 1e-3, `room ${tickRate} Hz: after 20 s of walking every client stands where the server has it (worst ${Math.max(...off).toExponential(1)} m)`);
  const corr = cs.reduce((n, c) => n + c.stats.corrections, 0), exact = cs.reduce((n, c) => n + c.stats.exact, 0), worst = Math.max(...cs.map((c) => c.stats.predErrMax));
  ok(corr <= exact * 0.02 && worst < 1.5, `room ${tickRate} Hz: prediction exact for ${exact} acknowledgements, ${corr} corrections, worst ${worst.toFixed(3)} m`);
  ok(errN > 2000 && errSum / errN < 0.02 && errMax < 0.6, `room ${tickRate} Hz: others are shown within ${(errSum / errN * 100).toFixed(1)} cm on average (worst ${errMax.toFixed(2)} m) of where the server had them at the view time`);
  ok(Math.abs(cs[0].serverTime - W.room.time) < 40 && Math.abs(cs[0].stats.rtt - 300) < 45, `room ${tickRate} Hz: clock within ${Math.abs(cs[0].serverTime - W.room.time).toFixed(0)} ms of the server, rtt ${cs[0].stats.rtt.toFixed(0)} ms`);
  const tr = W.room.traffic(), secs = W.room.stats.tick / tickRate;
  console.log(`     ${tickRate} Hz, 4 players: ${(tr.out / 4 / secs).toFixed(0)} B/s down and ${(tr.in / 4 / secs).toFixed(0)} B/s up per player (channel bytes, walking 20 of ${secs.toFixed(0)} s)`);
  ok(W.room.stats.kicked === 0 && W.room.stats.strikes < 1, 'room: honest clients earn no strikes');
}

// ---- interest, entities, events, rpcs ------------------------------------------------
{
  const W = world({ interest: { radius: 6 }, conditions: { latency: 40, jitter: 10, loss: 0.1 }, seed: 'interest' });
  const chat = [];
  W.room.rpc('chat', (p, a) => W.room.emit('chat', { from: p.id, text: a.text }));
  const near = W.room.spawn('pickup', { x: 1, y: 0, z: 6, kind: 2 }), far = W.room.spawn('pickup', { x: -15, y: 0, z: 15, kind: 3 }), note = W.room.spawn('note', { text: 'hello' });
  const a = W.add('Ada'), b = W.add('Bo');
  const spawned = [], despawned = [];
  a.onSpawn = (e) => spawned.push(e.id); a.onDespawn = (e) => despawned.push(e.id);
  b.on('chat', (m) => chat.push(m.from + ':' + m.text));
  W.run(1.5);
  ok(a.entities.has(near.id) && !a.entities.has(far.id) && a.entities.has(note.id) && a.entities.get(note.id).state.text === 'hello', 'interest: the near pickup and the always-relevant note arrive, the far pickup does not');
  ok(a.entities.get(near.id).state.kind === 2 && Math.abs(a.entities.get(near.id).state.z - 6) < 0.01, 'entities: fields arrive as defined');
  near.set({ taken: true }); far.set({ kind: 5 });

  Object.assign(a.input, { x: -0.7, z: 0.7, run: true });
  W.run(7, (f) => { if (f % 9 === 0 && f < 360) a.rpc('chat', { text: 'm' + f / 9 }); });   // 6.7 a second: under the 20 a second allowed
  ok(a.entities.get(near.id) === undefined && a.entities.has(far.id) && a.entities.get(far.id).state.kind === 5, `interest: walking away drops the near pickup and brings the far one (at ${a.walker.pos.map((v) => v.toFixed(1))})`);
  ok(spawned.includes(far.id) && despawned.includes(near.id), 'interest: onSpawn and onDespawn fire');
  ok(!b.entities.has(a.id) && b.entities.has(near.id) && b.entities.get(near.id).state.taken === true, 'interest: the player who walked off is gone for the one who stayed; the change to the pickup arrived');
  ok(chat.length === 40 && chat.every((m, i) => m === `${a.id}:m${i}`), 'events: 40 chat messages go client, server, client in order under 10 % loss');
  W.room.despawn(far); W.run(1);
  ok(!a.entities.has(far.id), 'entities: a despawn reaches the client');
  const back = W.room.spawn('pickup', { x: a.walker.pos[0], y: 0, z: a.walker.pos[2], kind: 1 }); W.run(1);
  ok(a.entities.get(back.id)?.state.kind === 1, 'entities: a later spawn reaches the client');
}

// ---- lag compensation -------------------------------------------------------------------
{
  const W = world({ conditions: { latency: 100, jitter: 5 }, seed: 'lag', spawn: (i) => (i ? [-6, 0, 12] : [0, 0, 5]) });
  let withComp = 0, without = 0, shots = 0;
  W.room.rpc('fire', (p, a, ctx) => { shots++; if (W.room.hitscan(p, { dir: [a.dx, a.dy, a.dz], time: ctx.viewTime })) withComp++; if (W.room.hitscan(p, { dir: [a.dx, a.dy, a.dz] })) without++; });
  const shooter = W.add('Shooter'), runner = W.add('Runner');
  W.run(1.5);
  Object.assign(runner.input, { x: 1, z: 0, run: true });
  W.run(0.5);
  W.run(2.5, (f) => {
    if (f % 6) return;
    const e = shooter.entities.get(runner.id), o = shooter.walker.pos;   // aim at the chest of what the shooter's screen shows
    shooter.rpc('fire', { dx: e.state.x - o[0], dy: e.state.y + 1 - (o[1] + 1.62), dz: e.state.z - o[2] });
  });
  W.run(1);
  ok(shots === 25 && withComp >= 24 && without === 0, `lag compensation: ${withComp} of ${shots} shots at the runner as seen hit with rewinding, ${without} without (4.2 m/s across, 200 ms round trip)`);
  const p = W.player(shooter);
  ok(W.room.hitscan(p, { dir: [1, 0, -1], range: 30 }) === null && W.room.hitscan(p, { dir: [NaN, 0, 0] }) === null, 'lag compensation: a miss and a bad direction return null');
  const far = W.add('Hidden', { spawn: [0, 0, 0] }); W.run(1);
  W.player(far).walker.place([6, 0, -5]); W.player(shooter).walker.place([6, 0, 5]); W.run(1.2);
  ok(W.room.hitscan(p, { dir: [0, 0, -1] }) === null && W.room.hitscan(p, { dir: [0, 0, -1], walls: false })?.player === W.player(far), 'lag compensation: a wall between two players blocks the hit');
}

// ---- reconnect, late join -----------------------------------------------------------------
{
  const W = world({ conditions: { latency: 30, loss: 0.02 }, seed: 'sessions', reconnectMs: 3000 });
  W.room.spawn('pickup', { x: 2, y: 0, z: 6, kind: 4 });
  const a = W.add('Ada'), b = W.add('Bo');
  Object.assign(a.input, { x: 1, z: 0.2 }); W.run(3);
  const id = a.id, token = a.token, where = [...W.player(a).walker.pos];
  a.end.close('cable'); W.run(0.5);
  ok(a.status === 'closed' && W.room.players.has(id) && !W.room.players.get(id).connected && b.entities.get(id).state.away === true, 'reconnect: a dropped player stays in the room, marked away');
  const [t1, t2] = W.net.pair(); W.room.accept(t2); a.connect(t1); W.run(1);
  ok(a.status === 'joined' && a.id === id && a.resumed && dist(a.walker.pos, where) < 3 && a.entities.size === 3 && b.entities.get(id).state.away === false, 'reconnect: the token brings the same player back where it stood, with a full resync');
  ok(a.token.some((v, i) => v !== 0) && token.every((v, i) => v === a.token[i]), 'reconnect: the session token is 16 random bytes, kept');
  const thief = W.add('Eve', { token: new Uint8Array(16).fill(7) }); W.run(1);
  ok(thief.status === 'joined' && thief.id !== id && !thief.resumed, 'reconnect: a wrong token is a new player, not someone else');
  const late = W.add('Late'); W.run(1);
  ok(late.entities.size === 5 && [...late.entities.values()].filter((e) => e.name === 'pickup')[0].state.kind === 4, 'late join: a player arriving later gets every entity in full');
  W.room.onLeaveTest = 0;
  b.end.close('gone'); W.run(4);
  ok(!W.room.players.has(b.id) && !a.entities.has(b.id), 'reconnect: after the grace time the player is removed everywhere');
  const full = world({ maxPlayers: 2, seed: 'full' }); const x = full.add('a'), y = full.add('b'), z = full.add('c'); full.run(1);
  ok(x.status === 'joined' && y.status === 'joined' && z.status === 'closed' && z.kicked === 'room full', 'sessions: a full room turns the next player away with a reason');
  const other = defineProtocol({ bounds: [-20, -20, 20, 20] }), [m1, m2] = full.net.pair(); full.room.accept(m2);
  const wrong = createClient({ protocol: other, grid, now: full.now }); wrong.connect(m1); full.clients.push(wrong); full.run(0.5);
  ok(wrong.kicked === 'protocol mismatch', 'sessions: a client built against another protocol is refused');
}

// ---- anti-cheat and hostile input -----------------------------------------------------------
{
  const W = world({ seed: 'cheat' });
  const honest = W.add('Honest'), cheat = W.add('Cheat');
  W.run(1);
  // the cheat steps its simulation three times a frame (a "speed hack": more inputs per second)
  Object.assign(honest.input, { x: 0, z: 1, run: true }); Object.assign(cheat.input, { x: 0, z: 1, run: true });
  const cid = cheat.id, start = W.player(cheat).walker.pos[2], hs = W.player(honest).walker.pos[2];
  let kickedAt = 0;
  const realNow = W.now; let boost = 0;
  const fast = createClient({ protocol, grid, name: 'x', now: () => realNow() * 3 });   // a client whose clock runs 3x
  const [f1, f2] = W.net.pair(); W.room.accept(f2); fast.connect(f1); W.clients.push(fast);
  W.run(1); Object.assign(fast.input, { x: 1, z: 0, run: true });
  const fid = fast.id, fs = W.player(fast).walker.pos[0];
  W.run(2, (f) => { if (!W.room.players.get(fid)?.connected && !kickedAt) kickedAt = f / 60; });
  const fd = W.room.players.get(fid).walker.pos[0] - fs, hd = W.player(honest).walker.pos[2] - hs;
  ok(fd < (kickedAt || 2) * 4.2 * 1.08 + 1.5, `anti-cheat: a client sending inputs at 3x speed moved ${fd.toFixed(1)} m in ${(kickedAt || 2).toFixed(1)} s (run speed 4.2 m/s), not ${(4.2 * 3 * 2).toFixed(0)}`);
  ok(kickedAt > 0 && fast.kicked.startsWith('kicked'), `anti-cheat: and was dropped after ${kickedAt.toFixed(1)} s (${fast.kicked})`);
  ok(Math.abs(hd - 3 * 4.2) < 0.6 && honest.status === 'joined', `anti-cheat: the honest runner beside it is untouched (${hd.toFixed(1)} m in 3 s)`);
  void cid; void start; void boost;

  // garbage, at every layer
  const R = rng('fuzz'); let thrown = 0;
  for (let round = 0; round < 40; round++) {
    const [h1, h2] = W.net.pair({ latency: 0, loss: 0 }); W.room.accept(h2);
    const good = createChannel({ transport: h1, now: W.now });
    try {
      for (let i = 0; i < 60; i++) {
        const len = Math.floor(R.next() * (i % 10 === 0 ? 1500 : 80)), u = new Uint8Array(len).map(() => Math.floor(R.next() * 256));
        const mode = round % 4;
        if (mode === 0) h1.send(u);                              // raw noise
        else if (mode === 1) good.sendUnreliable(u);             // well-framed packets, noise payload
        else if (mode === 2) { good.sendReliable(u); good.update(); }   // noise as reliable messages
        else { const w = new BitWriter(1400).bits(MSG.HELLO, 4).bits(protocol.hash, 32).str('z', 24).bool(false); if (i === 0) good.sendReliable(w.bytes()); else if (i % 2) good.sendUnreliable(u); else { u[0] = (u[0] & 0xf0) | MSG.RPC; good.sendReliable(u); } good.update(); }
        W.net.advance(3);
      }
      W.run(0.1);
    } catch (e) { thrown++; console.error(e); }
  }
  ok(thrown === 0, 'hostile input: 2 400 garbage packets, payloads, reliable messages and RPCs never throw');
  ok(W.room.connections <= 3 + 4 && W.room.stats.kicked > 10 && honest.status === 'joined', `hostile input: the offenders were dropped (${W.room.stats.kicked} kicked), the honest player plays on`);
  const before = W.room.players.size; W.run(6);
  const flood = W.net.pair({ latency: 0 }); W.room.accept(flood[1]); for (let i = 0; i < 5000; i++) flood[0].send(new Uint8Array(20)); W.net.advance(5); W.run(0.2);
  ok(!flood[1].open || W.room.connections <= before + 1, 'hostile input: a flood of 5 000 packets in one instant is cut off by the packet rate');
  const idle = W.net.pair(); W.room.accept(idle[1]); W.run(6);
  ok(!idle[1].open, 'hostile input: a connection that never says hello is closed after 5 s');
}

// ---- host migration ---------------------------------------------------------------------------
{
  const W = world({ seed: 'migrate' });
  const p1 = W.room.spawn('pickup', { x: 3, y: 0, z: 7, kind: 6 });
  const a = W.add('Ada', { key: 'k1' }), b = W.add('Bo', { key: 'k2' });
  W.run(1); Object.assign(b.input, { x: 1, z: 0.3, run: true }); W.player(b).ent.set({ score: 7 }); W.run(2);
  W.room.shareState(); W.run(0.5);
  ok(a.hostState && a.hostState.length > 50 && !new TextDecoder().decode(a.hostState).includes(Array.from(b.token).join(',')), `migration: every client holds the room's state (${a.hostState.length} bytes), without anyone's token`);
  const posB = [...W.player(b).walker.pos], idA = a.id, idB = b.id, tick = W.room.stats.tick;
  // the host vanishes; Ada's machine starts a room from the state it holds and the lobby vouches for who is who
  const W2 = world({ seed: 'migrate2', restore: a.hostState });
  ok(W2.room.stats.tick === 0 && W2.room.time >= (tick - 12) * 50 && W2.room.players.size === 2 && W2.room.entities.get(p1.id)?.get('kind') === 6, 'migration: a new room restores entities, players and the clock');
  const na = W2.add('Ada', { key: 'k1' }), nb = W2.add('Bo', { key: 'k2' }), stranger = W2.add('Mallory', { key: 'k9' });
  W2.run(1.5);
  ok(na.id === idA && nb.id === idB && na.resumed && nb.resumed && dist(nb.walker.pos, posB) < 2.5 && nb.me.state.score === 7, 'migration: players come back as themselves, where they were, with their score');
  ok(stranger.id !== idA && stranger.id !== idB && !stranger.resumed && W2.room.players.size === 3, 'migration: a key the state does not know is a new player');
  ok(throws(() => createRoom({ protocol, grid, restore: new TextEncoder().encode('{"v":1,"hash":1}') })) && throws(() => createRoom({ protocol, grid, restore: new Uint8Array([1, 2, 3]) })), 'migration: a state for another protocol, or garbage, is refused');
}
console.log('net check: all ok');
