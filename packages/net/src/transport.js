// Mirage original code.
// ---------------------------------------------------------------------------
// Transports. A transport is the smallest thing the rest of the package needs: datagrams of bytes, both ways.
//
//   { send(u8), onmessage: (u8) => {}, onclose: (why) => {}, close(), open, kind, reliable }
//
// Nothing above this file assumes delivery, order or uniqueness: channel.js adds acks and the reliable stream on
// top, so the same game code runs over WebRTC (unreliable), WebSocket (TCP) and the loopback below.
//
// 1. The loopback: an in-memory network with a virtual clock, for tests and for the browser host's own player.
//      const net = createLoopbackNetwork({ seed: 'check', latency: 75, jitter: 20, loss: 0.05, duplicate: 0.01, reorder: 0.02 });
//      const [a, b] = net.pair();          // a.send(x) arrives at b.onmessage after latency +- jitter, or never
//      net.advance(16.7);                  // move the clock; everything due is delivered in time order
//    Deterministic: one seeded generator (@mirage/core rng), ties broken by send order. `reorder` holds a packet
//    back by up to `reorderMs` more (default 3 x jitter + 30 ms), so later packets overtake it.
//    Conditions can be per pair (net.pair({ loss: 0.2 })) and changed while running (end.conditions.loss = 0).
//    createLoopbackNetwork({ realtime: true }) delivers on setTimeout instead (the browser host's own player).
// 2. conditioned(transport, conditions): the same conditions on a real transport with real timers (the network
//    simulator behind `mirage-net --latency 150 --loss 0.05` and the overlay's keys).
// 3. webSocketTransport(url | socket): a browser or Node 22 WebSocket carrying binary frames.
// ---------------------------------------------------------------------------
import { rng } from '@mirage/core/rng';

const NONE = { latency: 0, jitter: 0, loss: 0, duplicate: 0, reorder: 0 };

/** when (ms from now) the copies of one packet arrive under `c`: [] lost, one entry, or two when duplicated */
function schedule(c, R) {
  if (c.loss && R.next() < c.loss) return [];
  const one = () => {
    let t = (c.latency || 0) + (c.jitter ? (R.next() * 2 - 1) * c.jitter : 0);
    if (c.reorder && R.next() < c.reorder) t += R.next() * (c.reorderMs ?? 3 * (c.jitter || 0) + 30);
    return Math.max(0, t);
  };
  return c.duplicate && R.next() < c.duplicate ? [one(), one()] : [one()];
}

export function createLoopbackNetwork(defaults = {}) {
  const R = rng(defaults.seed ?? 'mirage/net/loopback'), realtime = !!defaults.realtime;
  let now = 0, order = 0;
  const queue = [];   // { t, order, to, data } sorted by (t, order): binary insertion, deliveries shift from the front
  const push = (e) => {
    let lo = 0, hi = queue.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (queue[m].t < e.t || (queue[m].t === e.t && queue[m].order < e.order)) lo = m + 1; else hi = m; }
    queue.splice(lo, 0, e);
  };
  const end = (conditions) => ({
    kind: 'loopback', reliable: false, open: true, conditions, onmessage: null, onclose: null, peer: null, sent: 0, bytes: 0,
    send(u) {
      if (!this.open || !this.peer.open) return;
      this.sent++; this.bytes += u.length;
      for (const dt of schedule(conditions, R)) {
        const to = this.peer, data = u.slice();
        if (realtime) setTimeout(() => to.open && to.onmessage?.(data), dt);
        else push({ t: now + dt, order: order++, to, data });
      }
    },
    close(why = 'closed') {
      if (!this.open) return;
      this.open = false; this.onclose?.(why);
      const p = this.peer; if (p.open) { p.open = false; p.onclose?.('peer ' + why); }
    },
  });
  return {
    get now() { return now; },
    /** two connected ends; `conditions` override the network's for this pair (both directions share the object) */
    pair(conditions = {}) {
      const c = { ...NONE, ...defaults, ...conditions }, a = end(c), b = end(c);
      a.peer = b; b.peer = a;
      return [a, b];
    },
    /** move the clock by ms, delivering what falls due (in order); a handler may send, and that is delivered too if due */
    advance(ms) {
      const until = now + ms;
      while (queue.length && queue[0].t <= until) {
        const e = queue.shift();
        now = Math.max(now, e.t);
        if (e.to.open) e.to.onmessage?.(e.data);
      }
      now = until;
    },
    get pending() { return queue.length; },
  };
}

/** `transport` with network conditions applied, on real timers. Outgoing packets always; incoming too with
 *  `both: true` (else wrap the other end as well). `conditions` may be edited while it runs. */
export function conditioned(transport, conditions = {}, { seed = 'mirage/net/conditioned', timer = setTimeout } = {}) {
  const R = rng(seed), c = Object.assign(conditions, { ...NONE, ...conditions });   // the caller's own object: edit it and the next packet obeys
  const later = (u, fn) => { for (const dt of schedule(c, R)) { if (dt < 0.5) fn(u); else { const copy = u.slice(); timer(() => fn(copy), dt); } } };
  const out = {
    reliable: false, conditions: c, onmessage: null, onclose: null, inner: transport,
    get kind() { return transport.kind; },
    get open() { return transport.open; },
    send(u) { later(u, (p) => transport.open && transport.send(p)); },
    close: (why) => transport.close(why),
  };
  transport.onmessage = (u) => { if (c.both) later(u, (p) => out.onmessage?.(p)); else out.onmessage?.(u); };
  transport.onclose = (why) => out.onclose?.(why);
  return out;
}

/** A WebSocket (browser, or Node 22's built-in client) as a transport of binary frames. Text frames go to `ontext`
 *  (the lobby's JSON); `ready` resolves when it is open. */
export function webSocketTransport(target, { WebSocketImpl = globalThis.WebSocket } = {}) {
  const ws = typeof target === 'string' ? new WebSocketImpl(target) : target;
  ws.binaryType = 'arraybuffer';
  const t = {
    kind: 'websocket', reliable: true, socket: ws, onmessage: null, onclose: null, ontext: null, closed: false,
    get open() { return ws.readyState === 1; },
    send(u) { if (ws.readyState === 1) ws.send(u); },
    sendText(s) { if (ws.readyState === 1) ws.send(s); },
    close(why) { try { ws.close(1000, String(why || '').slice(0, 60)); } catch { /* already closed */ } },
  };
  t.ready = new Promise((ok, no) => {
    if (ws.readyState === 1) ok(t);
    ws.addEventListener('open', () => ok(t), { once: true });
    ws.addEventListener('error', () => no(new Error('mirage net: WebSocket failed to connect')), { once: true });
  });
  t.ready.catch(() => {});
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string') t.ontext?.(e.data);
    else t.onmessage?.(new Uint8Array(e.data));
  });
  ws.addEventListener('close', (e) => { if (!t.closed) { t.closed = true; t.onclose?.(e.reason || 'closed'); } });
  return t;
}
