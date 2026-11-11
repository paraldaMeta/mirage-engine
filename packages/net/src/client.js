// Mirage original code.
// ---------------------------------------------------------------------------
// The client: predicts its own walker, reconciles with the server, and shows everyone else slightly in the past.
//
//   const client = createClient({ protocol, grid, name: 'Ada' });     // grid: the SAME bytes the server loaded
//   client.connect(transport);                                        // any transport; again later = reconnect + resync
//   const play = createPlay(world, { plan, grid, walker: client.walker });   // @miragekit/play drives it like its own walker
//   each frame:  client.input.yaw = yaw;  client.update();            // (without createPlay: set client.input.x/z/run/jump)
//   client.entities                      // Map id -> { id, name (type), state: { x, y, z, ... } } interpolated
//   client.onSpawn = (e) => {}; client.onDespawn = (e) => {}; client.on('chat', (args) => {});
//   client.rpc('use', { target: 3 });    // reliable, ordered, validated by the server
//   client.stats                         // rtt, loss, delay, offset, predErr, predErrMax, corrections, byType ...
//
// Prediction. Every 1/60 s the current input is quantised, numbered, applied to the local walker at once and sent
// (each packet repeats the last 16, so a lost packet costs nothing). A snapshot says which input the server has
// applied and where that left the player; if that is where the client was after the same input (to 0.1 mm), nothing
// happens. If not, the walker is put at the server's state and the inputs the server has not seen are replayed;
// the jump this makes is hidden by an offset that decays (half life 50 ms), unless it is over 3 m (a teleport).
//
// Interpolation. Other entities are drawn at server time minus `delay` (two ticks plus twice the measured arrival
// jitter), between the two snapshots around that time; angles go the short way; up to 100 ms past the newest
// snapshot is extrapolated when packets are late, never for an entity that simply stopped changing.
//
// Clock. Each snapshot echoes the client's last timestamp and how long the server held it: that is a round trip.
// The offset to server time comes from the sample with the shortest round trip of the last 24 (least queueing).
//
// Hostile input (a client must not trust a server either, less so a browser host): snapshots are read with
// BitReader, entity counts and ids are bounded by the packet, text is cleaned (wire.js cleanText) and should be
// shown with textContent; at most `maxEntities` (4096) entities are kept.
// ---------------------------------------------------------------------------
import { BitWriter, BitReader, seqDiff, cleanText, MSG } from './wire.js';
import { createChannel } from './channel.js';
import { pack, unpack, dequantise, encodeFull, decodeFull, decodeDelta } from './schema.js';
import { SIM_HZ, quantiseInput, sameInput, writeInput, applyInput, saveWalker, restoreWalker } from './sim.js';
import { createWalker } from '@miragekit/play/walker';

const STEP_MS = 1000 / SIM_HZ, REDUNDANT = 16, TAU = Math.PI * 2;

export function createClient(o = {}) {
  const { protocol, grid, now = () => performance.now(), maxEntities = 4096 } = o;
  if (!protocol || !grid) throw new Error('mirage net: createClient needs { protocol, grid }');
  const walker = createWalker(grid, { pos: o.spawn || [0, 0, 0] });
  const entities = new Map(), goneAt = new Map(), listeners = new Map(), pending = [], samples = [];
  const off = [0, 0, 0];
  let transport = null, ch = null, seq = 0, acc = 0, last = -1, newest = -1, have = false, lastAuth = null, tickMs = 50;
  let offset = null, arriveMean = null, arriveDev = 0, playAt = -1e9, resyncAt = -1e9;
  const stats = { rtt: 0, loss: 0, offset: 0, delay: 0, predErr: 0, predErrMax: 0, corrections: 0, exact: 0, snapshots: 0, stale: 0, resyncs: 0, queue: 0, bytesIn: 0, bytesOut: 0,
    byType: Object.fromEntries(protocol.types.map((t) => [t.name, 0])) };

  const api = {
    protocol, grid, entities, stats, walker: null, input: { x: 0, z: 0, run: false, jump: false, yaw: 0 },
    id: 0, status: 'idle', name: cleanText(o.name, 24) || 'guest', token: o.token || null, tickRate: 20, room: '', code: '', resumed: false, kicked: '', hostState: null, me: null,
    onJoin: null, onSpawn: null, onDespawn: null, onClose: null, onKick: null, onCorrection: null,
    connect, update, rpc, close,
    on(name, fn) { if (!protocol.event[name]) throw new Error(`mirage net: no event "${name}" in the protocol`); (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); return api; },
    /** server time (ms) now, and the server time other entities are drawn at */
    get serverTime() { return offset === null ? 0 : now() + offset; },
    get viewTime() { return arriveMean === null ? 0 : now() - arriveMean - stats.delay; },
    get pending() { return pending.length; },
    get channel() { return ch; },
    /** the transport in use (its `kind`: websocket, relay, webrtc, loopback) */
    get transport() { return transport; },
  };
  // what @miragekit/play sees: the walker's shape, with the smoothed position. play calls update(dt, motion) while walking.
  const view = api.walker = {
    pos: walker.pos.slice(), vy: 0, onGround: false, blocked: false, body: walker.body, fits: walker.fits,
    update(dt, m = {}) { api.input.x = m.x || 0; api.input.z = m.z || 0; api.input.run = !!m.run; api.input.jump = !!m.jump; playAt = now(); update(); return view; },
    place(p) { if (api.status !== 'joined') { walker.place(p); show(); } return view; },   // once joined the server decides where it stands
  };
  function show() { view.pos[0] = walker.pos[0] + off[0]; view.pos[1] = walker.pos[1] + off[1]; view.pos[2] = walker.pos[2] + off[2]; view.vy = walker.vy; view.onGround = walker.onGround; view.blocked = walker.blocked; }

  function clear() {
    for (const e of entities.values()) api.onDespawn?.(e);
    entities.clear(); goneAt.clear(); pending.length = 0; samples.length = 0;
    newest = -1; have = false; lastAuth = null; offset = null; arriveMean = null; arriveDev = 0; acc = 0; api.me = null;
  }
  /** join (or, with the token of an earlier session, come back) over `tr` */
  function connect(tr) {
    if (ch) ch.close();
    if (transport && transport !== tr) { transport.onclose = null; transport.close('reconnecting'); }
    clear();
    transport = tr; api.status = 'connecting'; api.kicked = '';
    ch = createChannel({ transport: tr, now, maxReliableIn: 1 << 20, onUnreliable: onSnap, onReliable, onViolation: (why) => close('violation: ' + why) });
    tr.onclose = (why) => {
      if (transport !== tr || api.status === 'closed') return;
      // the server's reason also travels in the close itself (a WebSocket close frame): a KICK sent just before may not arrive
      const reason = cleanText(String(why || '').replace(/^peer /, ''), 60);
      if (!api.kicked && reason && reason !== 'closed') api.kicked = reason;
      api.status = 'closed'; api.onClose?.(why);
    };
    const w = new BitWriter(80).bits(MSG.HELLO, 4).bits(protocol.hash, 32).str(api.name, 24).bool(!!api.token);
    if (api.token) w.raw(api.token);
    ch.sendReliable(w.bytes());
    return api;
  }
  function close(why = 'closed') {
    if (!transport) return;
    const tr = transport; transport = null;
    ch.close(); tr.onclose = null; tr.close(why);
    if (api.status !== 'closed') { api.status = 'closed'; api.onClose?.(why); }
  }

  function onReliable(u) {
    const kind = u[0] & 15;
    if (kind === MSG.STATE && u[0] === MSG.STATE) { api.hostState = u.slice(1); return; }
    const r = new BitReader(u); r.bits(4);
    if (kind === MSG.WELCOME) {
      const hash = r.bits(32), id = r.varu(), rate = r.bits(7), tick = r.bits(32), token = r.raw(16), resumed = r.bool(), nm = cleanText(r.str(24), 24), code = cleanText(r.str(8), 8), room = cleanText(r.str(48), 48);
      if (!r.ok || hash !== protocol.hash || SIM_HZ % rate) return close('bad welcome');
      Object.assign(api, { id, tickRate: rate, token, resumed, name: nm, code, room, status: 'joined' });
      tickMs = 1000 / rate; stats.delay = tickMs * 2 + 5; newest = tick - 1;
      api.onJoin?.(api);
    } else if (kind === MSG.EVENT) {
      const s = protocol.events[r.bits(6)];
      if (!s) return;
      const args = unpack(s, decodeFull(r, s));
      if (r.ok) for (const fn of listeners.get(s.name) || []) fn(args);
    } else if (kind === MSG.KICK) {
      api.kicked = cleanText(r.str(60), 60) || 'kicked'; api.onKick?.(api.kicked);
    }
  }

  function rpc(name, args = {}) {
    const s = protocol.rpc[name];
    if (!s) throw new Error(`mirage net: no rpc "${name}" in the protocol`);
    if (api.status !== 'joined') return false;
    const w = new BitWriter(2000).bits(MSG.RPC, 4).bits(s.id, 6).bits(Math.max(0, api.viewTime) >>> 0, 32);
    encodeFull(w, s, pack(s, args));
    return ch.sendReliable(w.bytes());
  }

  // ---- own player: prediction and reconciliation --------------------------
  function step() {
    const idle = now() - playAt > 250 && playAt > -1e8;   // play stopped driving (fly, orbit, a menu): stand still
    seq = (seq + 1) & 65535;
    const inp = quantiseInput(idle ? { yaw: api.input.yaw } : api.input);
    applyInput(walker, inp);
    pending.push({ seq, inp, s: saveWalker(walker) });
    if (pending.length > 300) pending.shift();
  }
  function sendInputs(t) {
    const n = Math.min(REDUNDANT, pending.length), w = new BitWriter(64);
    w.bits(MSG.INPUT, 2).bits(Math.floor(t) >>> 0, 32).bits(seq, 16).bits(n, 5);
    for (let i = pending.length - n; i < pending.length; i++) {
      const same = i > pending.length - n && sameInput(pending[i].inp, pending[i - 1].inp);
      if (i > pending.length - n) w.bool(same);
      if (!same) writeInput(w, pending[i].inp);
    }
    ch.sendUnreliable(w.bytes());
  }
  const near = (a, b) => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4 && Math.abs(a.vy - b.vy) < 1e-3 && !!a.onGround === !!b.onGround;
  function reconcile(hasAck, ack, s) {
    let predicted = null;
    if (hasAck) {
      while (pending.length && seqDiff(pending[0].seq, ack) < 0) pending.shift();
      if (pending.length && pending[0].seq === ack) predicted = pending.shift().s;
    }
    const again = lastAuth && lastAuth.hasAck === hasAck && lastAuth.ack === ack && near(lastAuth.s, s);
    lastAuth = { hasAck, ack, s };
    if (have && (again || (predicted && near(predicted, s)))) { if (predicted) stats.exact++; return; }
    const bx = walker.pos[0], by = walker.pos[1], bz = walker.pos[2];
    restoreWalker(walker, s);
    for (const e of pending) { applyInput(walker, e.inp); e.s = saveWalker(walker); }
    const dx = bx - walker.pos[0], dy = by - walker.pos[1], dz = bz - walker.pos[2], err = Math.hypot(dx, dy, dz);
    if (!have || err > 3) { off[0] = off[1] = off[2] = 0; }
    else { off[0] += dx; off[1] += dy; off[2] += dz; }
    if (have) { stats.corrections++; stats.predErr = err; if (err > stats.predErrMax) stats.predErrMax = err; api.onCorrection?.(err); }
    have = true;
  }

  // ---- clock --------------------------------------------------------------
  function clock(tick, echo, hold, t) {
    const T = tick * tickMs, d = t - T;
    if (arriveMean === null) arriveMean = d;
    else if (Math.abs(d - arriveMean) > 250) arriveMean = d;   // the path changed (or the tab slept): start over
    else { arriveDev += (Math.abs(d - arriveMean) - arriveDev) * 0.1; arriveMean += (d - arriveMean) * 0.03; }
    if (hold !== 1023) {
      const rtt = (((Math.floor(t) >>> 0) - echo) >>> 0) - hold;
      if (rtt >= 0 && rtt < 5000) { samples.push({ rtt, off: T + rtt / 2 - t }); if (samples.length > 24) samples.shift(); }
    }
    let best = null; for (const s of samples) if (!best || s.rtt < best.rtt) best = s;
    const target = best ? best.off : T - t;
    offset = offset === null || Math.abs(target - offset) > 250 ? target : offset + (target - offset) * 0.1;
    if (best) stats.rtt = best.rtt;
    const want = o.delay ?? Math.min(500, tickMs * 2 + arriveDev * 2 + 5);
    stats.delay += (want - stats.delay) * 0.05;
    stats.offset = offset;
  }

  // ---- snapshots ----------------------------------------------------------
  function remove(id, tick) {
    const e = entities.get(id);
    goneAt.set(id, tick);
    if (goneAt.size > 8192) goneAt.delete(goneAt.keys().next().value);
    if (!e) return;
    entities.delete(id); if (api.me === e) api.me = null;
    api.onDespawn?.(e);
  }
  function onSnap(u) {
    if (api.status !== 'joined') return;
    const r = new BitReader(u), t = now();
    if (r.bits(2) !== MSG.SNAP) return;
    const tick = r.bits(32), echo = r.bits(32), hold = r.bits(10), hasAck = r.bool(), ack = r.bits(16);
    const s = { x: r.f32(), y: r.f32(), z: r.f32(), vy: r.f32(), onGround: r.bool() }, queue = r.bits(6), nGone = r.varu();
    if (!r.ok || nGone > 64 || ![s.x, s.y, s.z, s.vy].every(Number.isFinite)) return;
    const gone = []; for (let i = 0; i < nGone; i++) gone.push(r.varu());
    if (!r.ok) return;
    const stale = tick <= newest;
    stats.snapshots++;
    if (stale) stats.stale++;
    else {
      clock(tick, echo, hold, t); reconcile(hasAck, ack, s);
      for (const id of gone) remove(id, tick);
      newest = tick; stats.queue = queue;
    }
    const born = [];
    while (r.bits(1) && r.ok) {
      const mark = r.n, id = r.varu(), type = protocol.types[r.bits(4)], full = r.bool();
      if (!type || !r.ok) return;
      let e = entities.get(id), q;
      const own = id === api.id;
      if (full) q = decodeFull(r, type, own);
      else {
        const base = e && e.type === type ? e.states.get(tick - r.varu()) : null;
        if (!base) {   // a delta on a state this client does not hold: nothing after it can be read. Ask for full states.
          if (t - resyncAt > 500) { resyncAt = t; stats.resyncs++; ch.sendReliable(new BitWriter(8).bits(MSG.RESYNC, 4).bytes()); }
          return;
        }
        q = decodeDelta(r, type, base, own);
      }
      if (!r.ok) return;
      stats.byType[type.name] += (r.n - mark) / 8;
      if ((goneAt.get(id) ?? -1) >= tick) continue;   // a late packet about something already removed
      if (!e) {
        if (entities.size >= maxEntities) continue;
        e = { id, type, name: type.name, states: new Map(), buf: [], state: {}, own };
        entities.set(id, e); born.push(e); if (own) api.me = e;
      } else if (e.type !== type) continue;
      e.states.set(tick, q);
      if (e.states.size > 48) e.states.delete(e.states.keys().next().value);
      const v = q.map((n, i) => dequantise(type.fields[i], n)), b = e.buf;
      let i = b.length; while (i > 0 && b[i - 1].tick > tick) i--;
      if (i > 0 && b[i - 1].tick === tick) continue;
      // nothing was sent while it did not change: it rested where it was until just before this sample
      if (i === b.length && i > 0 && tick - b[i - 1].tick > 3) b.push({ tick: tick - 1, t: (tick - 1) * tickMs, v: b[i - 1].v }), i++;
      b.splice(i, 0, { tick, t: tick * tickMs, v });
      if (b.length > 40) b.shift();
    }
    for (const e of born) { place(e, e.buf[e.buf.length - 1].v, null, 0); api.onSpawn?.(e); }
  }

  // ---- interpolation ------------------------------------------------------
  function place(e, a, b, u) {
    const f = e.type.fields, st = e.state;
    for (let i = 0; i < f.length; i++) {
      if (!b || !f[i].lerp) st[f[i].name] = b && u >= 1 ? b[i] : a[i];
      else if (f[i].lerp === 1) st[f[i].name] = a[i] + (b[i] - a[i]) * u;
      else { let d = (b[i] - a[i]) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; st[f[i].name] = a[i] + d * u; }
    }
  }
  function interpolate(t) {
    if (arriveMean === null) return;
    const rt = t - arriveMean - stats.delay;   // behind the average ARRIVAL of snapshots, not behind the server's clock: the latency is already in it
    for (const e of entities.values()) {
      const b = e.buf, n = b.length;
      if (!n) continue;
      while (b.length > 2 && b[1].t <= rt) b.shift();
      if (b.length === 1 || rt <= b[0].t) { place(e, b[0].v, null, 0); continue; }
      const A = b[0], B = b[1], span = B.t - A.t;
      let k = (rt - A.t) / span;
      if (k > 1) k = newest - B.tick >= 2 ? 1 : Math.min(k, 1 + 100 / span);   // late packets: a little ahead; it stopped: stay
      place(e, A.v, B.v, k);
    }
  }

  /** call every frame (and it is what client.walker.update calls): steps, sends, reconciles, interpolates */
  function update() {
    const t = now();
    if (last < 0) last = t;
    const dt = t - last; last = t;
    if (api.status === 'joined' && have) {
      acc += Math.min(dt, 250);
      let n = 0;
      while (acc >= STEP_MS && n < 8) { acc -= STEP_MS; step(); n++; }
      if (acc >= STEP_MS) acc = 0;   // far behind (a hidden tab): give the time up; the server would not take a burst anyway
      if (n) sendInputs(t);
    }
    if (ch) { ch.update(); stats.loss = ch.stats.loss; stats.bytesIn = ch.stats.bytesIn; stats.bytesOut = ch.stats.bytesOut; if (!stats.rtt) stats.rtt = ch.stats.rtt; }
    const k = Math.exp(-dt / 72);
    off[0] *= k; off[1] *= k; off[2] *= k;
    show();
    interpolate(t);
    return api;
  }
  return api;
}
