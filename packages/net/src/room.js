// Mirage original code.
// ---------------------------------------------------------------------------
// The authoritative room: the one place where the game is decided. It runs the same walker over the same walk grid
// as every client (sim.js), fed only by the inputs clients send, and tells each client what it may see.
// No GPU, no DOM: the same file runs in Node (server.js) and in a page (host.js, one browser hosting).
//
//   const room = createRoom({ protocol, grid, spawn: [0.4, 0, 5.4], tickRate: 20, maxPlayers: 16,
//     interest: { radius: 30 },                       // entities further than this are not sent (default: all)
//     onJoin(player, resumed) {}, onLeave(player, why) {}, onTick(room, dt) {} });
//   room.accept(transport);                           // a new connection; it becomes a player when it says hello
//   room.start();                                     // or call room.tick() yourself (tests, the browser host)
//   const e = room.spawn('pickup', { x, y, z, kind: 2 });   e.set({ kind: 3 });   room.despawn(e);
//   room.rpc('use', (player, args, ctx) => { ... });  // args are already decoded, clamped and cleaned
//   room.emit('chat', { from: player.id, text });     // reliable, ordered; third argument: one player
//   room.hitscan(player, { dir, range: 40, time: ctx.viewTime })   // lag compensated: see below
//   room.serialize() / createRoom({ restore: bytes }) // host migration
//
// Each tick (20, 30 or 60 a second; the simulation step is always 1/60 s, so a tick is 3, 2 or 1 steps):
//   1. every player consumes queued inputs: one step per input, never a step without one, so a player's state is a
//      function of its input sequence only and the client's prediction can be exact;
//   2. onTick runs game code; 3. positions go into a one-second history (lag compensation);
//   4. every client gets one snapshot packet: its own state and input acknowledgement, despawns, and as many
//      changed entities as fit, each a delta against the newest state that client acknowledged, stalest first.
//
// Hostile input. Everything a client sends is read with BitReader (never throws, never allocates past the packet),
// clamped by readInput / the RPC schema, and counted: packets a second, inputs a second (a token bucket at 105 % of
// real time: a client cannot move faster by sending more), queued inputs, RPCs a second, reliable message size.
// Offences add strikes; 8 strikes (they decay by one every 2 s) or a framing violation drops the connection.
// Movement itself cannot be forged: the server never reads a position from a client.
//
// Lag compensation. hitscan({ time }) puts every other entity back where it was at `time` (the server time the
// shooter's screen showed, sent with each RPC; at most 400 ms back), tests the ray against their capsules, and lets
// the walk grid block it. The shooter's own position is the server's, not the client's claim.
// ---------------------------------------------------------------------------
import { BitWriter, BitReader, seqDiff, cleanText, MSG } from './wire.js';
import { createChannel } from './channel.js';
import { PLAYER, pack, unpack, quantise, dequantise, encodeFull, decodeFull, encodeDelta, differs } from './schema.js';
import { SIM_HZ, readInput, applyInput, yawOf, rayCapsule } from './sim.js';
import { gridRay } from './grid.js';
import { createWalker, BODY } from '@mirage/play/walker';

const MAX_PACKET = 1200, QUEUE = 60, TOKENS = 24, STRIKES = 8, HELLO_MS = 5000, MAX_REWIND = 400, HISTORY_MS = 1000;
const enc = new TextEncoder(), dec = new TextDecoder();
const same16 = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < 16; i++) d |= a[i] ^ b[i]; return d === 0; };

export function createRoom(o = {}) {
  const { protocol, grid, tickRate = 20, maxPlayers = 16, name = 'room', code = '', reconnectMs = 30000, now = () => performance.now() } = o;
  if (!protocol || !grid) throw new Error('mirage net: createRoom needs { protocol, grid }');
  if (SIM_HZ % tickRate) throw new Error('mirage net: tickRate must divide 60 (20, 30 or 60)');
  const steps = SIM_HZ / tickRate, tickMs = 1000 / tickRate, resendMs = o.resendMs ?? Math.max(100, tickMs * 2);
  const R = o.interest?.radius ?? Infinity, cellSize = o.interest?.cell ?? (R < Infinity ? Math.max(2, R / 2) : 16);
  const Rin2 = R * R, Rout2 = (R * 1.15 + cellSize) ** 2;
  const S = protocol.type[PLAYER], yFloor = protocol.box[1][0] + 0.5;
  const packetRate = o.packetRate ?? 120, rpcRate = o.rpcRate ?? 20;
  const entities = new Map(), players = new Map(), conns = new Set(), handlers = new Map(), cells = new Map(), always = new Set();
  let nextId = 1, tickN = 0, joined = 0, timer = null, closed = false;
  const hooks = o.onTick ? [o.onTick] : [];
  const stats = { tick: 0, tickMs: 0, tickMax: 0, overruns: 0, late: 0, kicked: 0, strikes: 0, errors: 0, resyncs: 0, snapshotBytes: 0, byType: Object.fromEntries(protocol.types.map((t) => [t.name, 0])) };

  const spawnOf = (i) => {
    if (typeof o.spawn === 'function') return o.spawn(i);
    const s = o.spawn || [0, 0, 0];
    return i ? [s[0] + Math.cos(i * 2.4) * 0.9, s[1], s[2] + Math.sin(i * 2.4) * 0.9] : s;
  };

  // ---- entities -----------------------------------------------------------
  function makeEntity(type, state, opt = {}) {
    const s = protocol.type[type];
    if (!s) throw new Error(`mirage net: no entity type "${type}"`);
    const ix = s.index.x, iy = s.index.y, iz = s.index.z, placed = ix !== undefined && iz !== undefined;
    const e = { id: opt.id ?? nextId++, type: s, q: opt.q || pack(s, state || {}), always: !!opt.always || !placed, owner: opt.owner ?? null, hist: [], cell: null, p: null, dead: false, data: opt.data ?? null };
    const refresh = () => { if (placed) e.p = [dequantise(s.fields[ix], e.q[ix]), iy === undefined ? 0 : dequantise(s.fields[iy], e.q[iy]), dequantise(s.fields[iz], e.q[iz])]; };
    /** change fields; a new quantised array only when something really changed (replication compares identity first) */
    e.set = (patch) => {
      let q = null;
      for (const k in patch) { const i = s.index[k]; if (i === undefined) continue; const v = quantise(s.fields[i], patch[k]); if (v !== e.q[i]) { q ||= e.q.slice(); q[i] = v; } }
      if (q) { e.q = q; refresh(); }
      return e;
    };
    e.get = (k) => dequantise(s.fields[s.index[k]], e.q[s.index[k]]);
    Object.defineProperty(e, 'state', { get: () => unpack(s, e.q) });
    refresh();
    entities.set(e.id, e);
    if (e.always) always.add(e);
    return e;
  }
  function despawn(e) {
    if (!e || e.dead) return;
    e.dead = true; entities.delete(e.id); always.delete(e);
    if (e.cell !== null) { cells.get(e.cell)?.delete(e); e.cell = null; }
  }
  function rehash(e) {
    if (e.always || !e.p) return;
    const k = (Math.floor(e.p[0] / cellSize) + 32768) * 65536 + (Math.floor(e.p[2] / cellSize) + 32768);
    if (k === e.cell) return;
    if (e.cell !== null) { const c = cells.get(e.cell); c.delete(e); if (!c.size) cells.delete(e.cell); }
    let c = cells.get(k); if (!c) cells.set(k, c = new Set());
    c.add(e); e.cell = k;
  }

  // ---- connections --------------------------------------------------------
  function accept(transport, { key = null } = {}) {
    if (closed) { transport.close('room closed'); return null; }
    const t = now();
    const c = { transport, key, player: null, t0: t, pk: packetRate, pkAt: t, rp: rpcRate, strikes: 0, closed: false, ch: null };
    c.ch = createChannel({ transport, now, maxPacket: MAX_PACKET, maxReliableIn: o.maxMessage ?? 2048, maxReliableQueue: 1 << 20,
      onUnreliable: (u) => onInput(c, u), onReliable: (u) => onReliable(c, u), onAck: (s) => onAck(c, s), onViolation: (why) => drop(c, 'violation: ' + why) });
    const receive = transport.onmessage;
    transport.onmessage = (u) => {
      const n = now();
      c.pk = Math.min(packetRate, c.pk + ((n - c.pkAt) / 1000) * packetRate); c.pkAt = n;
      if (c.pk < 1) return strike(c, 0.1, 'packet rate');
      c.pk -= 1; receive(u);
    };
    transport.onclose = () => drop(c, 'closed', true);
    conns.add(c);
    return c;
  }
  function strike(c, n, why) {
    if (c.closed) return;
    c.strikes += n; stats.strikes += n;
    if (c.strikes >= STRIKES) { stats.kicked++; drop(c, 'kicked: ' + why); }
  }
  function sendTo(c, bytes) { if (!c.closed && !c.ch.sendReliable(bytes)) drop(c, 'not acknowledging'); }
  /** end a connection. Its player (if any) stays for `reconnectMs`, standing where it was, so it can come back. */
  function drop(c, why = 'closed', silent = false) {
    if (c.closed) return;
    if (!silent && c.transport.open) {
      c.ch.sendReliable(new BitWriter(80).bits(MSG.KICK, 4).str(why, 60).bytes());
      c.ch.sendUnreliable(new Uint8Array(0));   // carry it now: there is no later
    }
    c.closed = true; c.ch.close(); conns.delete(c);
    const p = c.player;
    if (p && p.conn === c) { p.conn = null; p.connected = false; p.leftAt = now(); p.queue.length = 0; p.ent.set({ away: true }); o.onDisconnect?.(p, why); }
    c.transport.onclose = null;
    if (!silent) c.transport.close(why);
  }
  function leave(p, why) {
    if (!players.delete(p.id)) return;
    if (p.conn) drop(p.conn, why);
    despawn(p.ent);
    o.onLeave?.(p, why);
  }

  function onReliable(c, u) {
    const r = new BitReader(u), kind = r.bits(4);
    if (kind === MSG.HELLO) {
      if (c.player) return strike(c, 2, 'second hello');
      const hash = r.bits(32), nm = cleanText(r.str(96), 24) || 'guest', has = r.bool(), tok = has ? r.raw(16) : null;
      if (!r.ok) return drop(c, 'violation: hello');
      if (hash !== protocol.hash) return drop(c, 'protocol mismatch');
      let p = null;
      for (const x of players.values()) {
        if (tok && x.token && same16(tok, x.token)) { p = x; break; }
        if (c.key !== null && x.key === c.key && x.restored && !x.connected) { p = x; break; }   // vouched for by the lobby after a migration
      }
      if (!p && players.size >= maxPlayers) return drop(c, 'room full');
      if (!p && o.authorize && !o.authorize({ name: nm, key: c.key })) return drop(c, 'not allowed');
      join(c, nm, p);
    } else if (kind === MSG.RPC) {
      const p = c.player, s = protocol.rpcs[r.bits(6)], viewTime = r.bits(32);
      if (!p || !s) return strike(c, 2, 'rpc');
      const args = unpack(s, decodeFull(r, s));
      if (!r.ok) return strike(c, 2, 'rpc arguments');
      if (c.rp < 1) return strike(c, 0.5, 'rpc rate');
      c.rp -= 1;
      const h = handlers.get(s.name);
      if (h) try { h(p, args, { viewTime, room }); } catch (err) { stats.errors++; o.onError?.(err); }
    } else if (kind === MSG.RESYNC) {
      // the client met a delta whose baseline it does not hold (it should not happen; if it does, this ends it): forget
      // what it was thought to have, so everything goes out in full again
      const p = c.player;
      if (!p) return strike(c, 2, 'resync');
      if (c.rp < 1) return strike(c, 0.5, 'rpc rate');
      c.rp -= 1; stats.resyncs++; p.flights.clear();
      for (const v of p.view.values()) { v.base = null; v.sentQ = null; v.sends = 0; }
    } else strike(c, 2, 'message kind');
  }

  const fresh = () => ({ queue: [], lastSeq: -1, ack: 0, hasAck: false, tokens: TOKENS, echo: 0, echoAt: -1, view: new Map(), gone: new Map(), flights: new Map() });
  function join(c, nm, p) {
    const resumed = !!p;
    if (!p) {
      const id = nextId++, walker = createWalker(grid, { pos: spawnOf(joined++) });
      const ent = makeEntity(PLAYER, { name: nm }, { id, owner: id, always: R === Infinity });
      p = { id, name: nm, key: c.key, token: null, walker, ent, data: {}, yawQ: 0, run: 0, restored: false, joinedAt: tickN };
      players.set(id, p);
    } else if (p.conn && p.conn !== c) drop(p.conn, 'replaced');
    if (!p.token) p.token = globalThis.crypto.getRandomValues(new Uint8Array(16));
    Object.assign(p, fresh(), { conn: c, connected: true, leftAt: 0, restored: false, key: c.key ?? p.key });
    c.player = p;
    p.ent.set({ away: false, name: p.name });
    syncPlayer(p);
    sendTo(c, new BitWriter(200).bits(MSG.WELCOME, 4).bits(protocol.hash, 32).varu(p.id).bits(tickRate, 7).bits(tickN, 32).raw(p.token).bool(resumed).str(p.name, 24).str(code, 8).str(name, 48).bytes());
    o.onJoin?.(p, resumed);
  }
  function syncPlayer(p) {
    const w = p.walker;
    p.ent.set({ x: w.pos[0], y: w.pos[1], z: w.pos[2], yaw: yawOf({ yaw: p.yawQ }), onGround: w.onGround, run: p.run });
  }

  function onInput(c, u) {
    const p = c.player;
    if (!p) return;
    const r = new BitReader(u);
    if (r.bits(2) !== MSG.INPUT) return strike(c, 1, 'payload kind');
    const time = r.bits(32), newest = r.bits(16), count = r.bits(5);
    if (count < 1 || count > 16) return strike(c, 1, 'input count');
    const list = [];
    for (let i = 0; i < count; i++) list.push(i && r.bool() ? list[i - 1] : readInput(r));
    if (!r.ok) return strike(c, 1, 'input packet');
    p.echo = time; p.echoAt = now();
    for (let i = 0; i < count; i++) {
      const s = (newest - (count - 1 - i)) & 65535;
      if (p.lastSeq >= 0 && seqDiff(s, p.lastSeq) <= 0) continue;   // seen (inputs are sent several times over)
      p.lastSeq = s; p.queue.push({ seq: s, inp: list[i] });
      if (p.queue.length > QUEUE) { p.queue.shift(); strike(c, 0.05, 'input rate'); if (c.closed) return; }
    }
  }
  function onAck(c, seq) {
    const p = c.player, rec = p?.flights.get(seq);
    if (!rec) return;
    p.flights.delete(seq);
    for (const [id, tick, q] of rec) {
      if (q === null) { if (p.gone.get(id) <= tick) p.gone.delete(id); continue; }
      const v = p.view.get(id);
      if (v && tick >= v.since && (!v.base || tick > v.base.tick)) { v.base = { tick, q }; v.sends = 0; }
    }
  }

  // ---- the tick -----------------------------------------------------------
  function interest(p) {
    const px = p.walker.pos[0], pz = p.walker.pos[2];
    for (const [id, v] of p.view) {
      const e = v.e;
      if (!e.dead && (e.always || id === p.id)) continue;
      if (e.dead || (e.p[0] - px) ** 2 + (e.p[2] - pz) ** 2 > Rout2) { p.view.delete(id); p.gone.set(id, tickN); }
    }
    const add = (e) => { if (!p.view.has(e.id)) { p.view.set(e.id, { e, base: null, sentQ: null, sentAt: -1e9, sentTick: 0, sends: 0, since: tickN, pri: 0 }); p.gone.delete(e.id); } };
    add(p.ent);
    for (const e of always) add(e);
    if (R === Infinity) { for (const e of entities.values()) add(e); return; }   // no interest radius: everything, to everyone
    const n = Math.ceil(R / cellSize), cx = Math.floor(px / cellSize), cz = Math.floor(pz / cellSize);
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const c = cells.get((cx + i + 32768) * 65536 + (cz + j + 32768));
      if (c) for (const e of c) if ((e.p[0] - px) ** 2 + (e.p[2] - pz) ** 2 <= Rin2) add(e);
    }
  }
  function snapshot(p, t) {
    const ch = p.conn.ch, max = Math.max(96, ch.budget()), w = new BitWriter(max), wk = p.walker;
    w.bits(MSG.SNAP, 2).bits(tickN, 32).bits(p.echo, 32).bits(p.echoAt < 0 ? 1023 : Math.min(1022, Math.round(t - p.echoAt)), 10);
    w.bool(p.hasAck).bits(p.ack, 16).f32(wk.pos[0]).f32(wk.pos[1]).f32(wk.pos[2]).f32(wk.vy).bool(wk.onGround).bits(Math.min(63, p.queue.length), 6);
    interest(p);
    const rec = [];
    for (const id of p.gone.keys()) { if (rec.length === 48) break; rec.push([id, tickN, null]); }
    w.varu(rec.length); for (const [id] of rec) w.varu(id);
    const list = [];
    for (const v of p.view.values()) {
      const e = v.e, own = e.id === p.id;
      if (v.base && (v.base.q === e.q || !differs(e.type, e.q, v.base.q, own))) continue;   // the client has it
      if (v.sentQ === e.q && t - v.sentAt < resendMs) continue;                              // on its way
      v.pri = v.sentQ ? tickN - v.sentTick : 1e9;
      list.push(v);
    }
    list.sort((a, b) => b.pri - a.pri);
    for (const v of list) {
      const e = v.e, own = e.id === p.id, mark = w.n;
      w.bits(1, 1).varu(e.id).bits(e.type.id, 4);
      if (!v.base || v.sends > 40) { w.bits(1, 1); encodeFull(w, e.type, e.q, own); }
      else { w.bits(0, 1).varu(tickN - v.base.tick); encodeDelta(w, e.type, e.q, v.base.q, own); }
      if (w.full || w.n + 1 > max * 8) { w.rewind(mark); break; }   // out of room: the stalest went first, the rest wait a tick
      v.sentQ = e.q; v.sentAt = t; v.sentTick = tickN; v.sends++;
      rec.push([e.id, tickN, e.q]);
      stats.byType[e.type.name] += (w.n - mark) / 8;
    }
    w.bits(0, 1);
    stats.snapshotBytes += w.size;
    const seq = ch.sendUnreliable(w.bytes());
    if (seq >= 0 && rec.length) { p.flights.set(seq, rec); if (p.flights.size > 128) p.flights.delete(p.flights.keys().next().value); }
  }

  function tick() {
    if (closed) return;
    const t0 = now();
    tickN++; stats.tick = tickN;
    const T = tickN * tickMs;
    for (const p of [...players.values()]) {
      const q = p.queue;
      p.tokens = Math.min(TOKENS, p.tokens + steps * 1.05);
      let want = q.length > steps * 2 + 2 ? steps * 2 : q.length > steps + 2 ? steps + 1 : steps;   // behind: catch up, gently
      want = Math.min(want, q.length, Math.floor(p.tokens));
      for (let i = 0; i < want; i++) { const e = q.shift(); applyInput(p.walker, e.inp); p.ack = e.seq; p.hasAck = true; p.yawQ = e.inp.yaw; p.run = e.inp.run && (e.inp.x || e.inp.z) ? 1 : 0; }
      p.tokens -= want;
      if (!want) p.run = 0;
      if (!(p.walker.pos[1] > yFloor)) p.walker.place(spawnOf(0));   // fell out of the world
      syncPlayer(p);
      if (p.conn) { p.conn.rp = Math.min(rpcRate, p.conn.rp + rpcRate / tickRate); p.conn.strikes = Math.max(0, p.conn.strikes - 0.5 / tickRate); }
      else if (t0 - p.leftAt > reconnectMs) leave(p, 'timed out');
    }
    for (const fn of hooks) try { fn(room, 1 / tickRate); } catch (err) { stats.errors++; o.onError?.(err); }
    const keep = Math.ceil(HISTORY_MS / tickMs) + 2;
    for (const e of entities.values()) {
      if (!e.p) continue;
      rehash(e);
      e.hist.push({ t: T, x: e.p[0], y: e.p[1], z: e.p[2] }); if (e.hist.length > keep) e.hist.shift();
    }
    for (const c of [...conns]) {
      // not before the welcome is acknowledged: a snapshot the client drops (it has not joined yet) would still be
      // acknowledged by its channel, and become a baseline it does not have
      if (c.player && (c.synced ||= c.ch.pendingReliable === 0)) snapshot(c.player, t0);
      else if (t0 - c.t0 > HELLO_MS) { drop(c, 'no hello'); continue; }
      c.ch.update();
    }
    const ms = now() - t0;
    stats.tickMs += (ms - stats.tickMs) * 0.05; if (ms > stats.tickMax) stats.tickMax = ms; if (ms > tickMs) stats.overruns++;
  }

  // ---- lag compensation ---------------------------------------------------
  function rewind(e, at) {
    const h = e.hist;
    if (!h.length) return e.p;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (at >= b.t) return [b.x, b.y, b.z];
      if (at >= a.t) { const u = (at - a.t) / (b.t - a.t); return [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u]; }
    }
    return [h[0].x, h[0].y, h[0].z];
  }
  function hitscan(p, { dir, range = 50, time, origin, radius = BODY.radius, height = BODY.head, filter, walls = true } = {}) {
    const l = Math.hypot(+dir?.[0], +dir?.[1], +dir?.[2]);
    if (!(l > 1e-6) || !(range > 0)) return null;
    const d = [dir[0] / l, dir[1] / l, dir[2] / l], T = tickN * tickMs;
    const at = Math.min(T, Math.max(T - MAX_REWIND, Number.isFinite(time) ? time : T));
    const from = origin || [p.walker.pos[0], p.walker.pos[1] + BODY.eye, p.walker.pos[2]];
    let dist = Math.min(range, walls ? gridRay(grid, from, d, range) : range), best = null, where = null;
    for (const e of entities.values()) {
      if (e === p.ent || !e.p || (filter && !filter(e))) continue;
      const c = rewind(e, at), t = rayCapsule(from, d, c, e.data?.radius ?? radius, e.data?.height ?? height);
      if (t < dist) { dist = t; best = e; where = c; }
    }
    return best ? { entity: best, player: players.get(best.id) || null, distance: dist, point: [from[0] + d[0] * dist, from[1] + d[1] * dist, from[2] + d[2] * dist], at: where, rewound: T - at } : null;
  }

  // ---- host migration -----------------------------------------------------
  /** the room as bytes: entities, players (by lobby key, never their tokens) and counters */
  function serialize() {
    return enc.encode(JSON.stringify({ v: 1, hash: protocol.hash, tick: tickN, nextId, joined,
      ents: [...entities.values()].filter((e) => e.type !== S).map((e) => [e.id, e.type.name, e.q, e.always ? 1 : 0, e.data]),
      players: [...players.values()].map((p) => [p.id, p.key, p.name, p.ent.q, [...p.walker.pos], p.walker.vy, p.walker.onGround ? 1 : 0, p.data]) }));
  }
  const cleanQ = (s, q) => Array.isArray(q) && q.length === s.fields.length && q.every((v, i) => { const f = s.fields[i]; return f.t === 'str' ? typeof v === 'string' && v.length <= f.max : Number.isFinite(v) && (f.t === 'f32' || (Number.isInteger(v) && v >= 0 && v < 2 ** f.bits)); });
  const fixQ = (s, q) => q.map((v, i) => (s.fields[i].t === 'str' ? cleanText(v, s.fields[i].max) : v));
  function restore(bytes) {
    if (bytes.length > (4 << 20)) throw new Error('mirage net: room state too large');
    const d = JSON.parse(dec.decode(bytes));
    if (d?.v !== 1 || d.hash !== protocol.hash || !Array.isArray(d.ents) || !Array.isArray(d.players) || d.ents.length > 8192 || d.players.length > maxPlayers) throw new Error('mirage net: room state does not match');
    const num = (v) => (Number.isFinite(v) ? v : 0);
    tickN = Math.max(0, num(d.tick) | 0); joined = num(d.joined) | 0;
    for (const [id, type, q, alw, data] of d.ents) {
      const s = protocol.type[type];
      if (!s || s === S || !Number.isInteger(id) || id < 1 || entities.has(id) || !cleanQ(s, q)) continue;
      makeEntity(type, null, { id, q: fixQ(s, q), always: !!alw, data: data ?? null });
    }
    const t = now();
    for (const [id, key, nm, q, pos, vy, onG, data] of d.players) {
      if (!Number.isInteger(id) || id < 1 || entities.has(id) || !cleanQ(S, q) || !Array.isArray(pos)) continue;
      const walker = createWalker(grid, {});
      walker.pos[0] = num(pos[0]); walker.pos[1] = num(pos[1]); walker.pos[2] = num(pos[2]); walker.vy = num(vy); walker.onGround = !!onG;
      const ent = makeEntity(PLAYER, null, { id, q: fixQ(S, q), owner: id, always: R === Infinity });
      players.set(id, { id, name: cleanText(nm, 24) || 'guest', key: key ?? null, token: null, walker, ent, data: data && typeof data === 'object' ? data : {}, yawQ: ent.q[S.index.yaw], run: 0, restored: true,
        conn: null, connected: false, leftAt: t, joinedAt: tickN, ...fresh() });
      ent.set({ away: true });
    }
    nextId = Math.max(num(d.nextId) | 0, 1, ...[...entities.keys()].map((i) => i + 1));
  }

  const room = {
    protocol, grid, tickRate, tickMs, name, code, players, entities, stats, maxPlayers,
    accept, tick, hitscan, serialize, despawn,
    spawn: (type, state, opt) => { if (type === PLAYER) throw new Error('mirage net: players join, they are not spawned'); return makeEntity(type, state, opt); },
    rpc(nm, fn) { if (!protocol.rpc[nm]) throw new Error(`mirage net: no rpc "${nm}" in the protocol`); handlers.set(nm, fn); return room; },
    /** a reliable event to one player, or to every connected player */
    emit(nm, args = {}, to = null) {
      const s = protocol.event[nm];
      if (!s) throw new Error(`mirage net: no event "${nm}" in the protocol`);
      const w = new BitWriter(2000).bits(MSG.EVENT, 4).bits(s.id, 6);
      encodeFull(w, s, pack(s, args));
      const b = w.bytes();
      if (to) { if (to.conn) sendTo(to.conn, b); } else for (const c of [...conns]) if (c.player) sendTo(c, b);
    },
    /** send every client the room's state, to restore from if this host goes away (host.js calls it every second) */
    shareState() {
      const b = serialize(), u = new Uint8Array(b.length + 1); u[0] = MSG.STATE; u.set(b, 1);
      for (const c of [...conns]) if (c.player) sendTo(c, u);
    },
    kick(p, why = 'kicked') { leave(p, why); },
    /** more game code to run each tick, after the players have moved (what the onTick option is) */
    onTick(fn) { hooks.push(fn); return room; },
    get time() { return tickN * tickMs; },
    get connections() { return conns.size; },
    /** bytes sent and received over every live connection since each opened */
    traffic() { let out = 0, inn = 0; for (const c of conns) { out += c.ch.stats.bytesOut; inn += c.ch.stats.bytesIn; } return { out, in: inn }; },
    /** tick on a timer that does not drift; when more than 5 ticks behind it gives the time up (stats.late) */
    start() {
      if (timer || closed) return room;
      let next = now() + tickMs;
      const run = () => {
        tick();
        next += tickMs;
        const t = now();
        if (next < t - tickMs * 5) { stats.late += Math.floor((t - next) / tickMs); next = t; }
        timer = setTimeout(run, Math.max(0, next - t));
      };
      timer = setTimeout(run, tickMs);
      return room;
    },
    stop() { clearTimeout(timer); timer = null; },
    close(why = 'room closed') { room.stop(); for (const c of [...conns]) drop(c, why); closed = true; },
  };
  if (o.restore) restore(o.restore);
  return room;
}
