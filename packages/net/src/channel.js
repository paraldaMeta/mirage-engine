// Mirage original code. The ack scheme (a sequence number, the newest one received and a bit field of the 32 before
// it, in every packet) is the one described in the Tribes networking paper and Glenn Fiedler's articles; written here.
// ---------------------------------------------------------------------------
// A channel turns a transport of loose datagrams into what a game needs:
//   - unreliable messages: sent once, delivered at most once, possibly out of order (inputs, snapshots);
//   - one reliable ordered stream of messages of any size up to a cap (events, RPCs, chat, the welcome), cut into
//     chunks that ride in the same packets and are sent again until a packet that carried them is acknowledged;
//   - per-packet acknowledgement callbacks (room.js moves its delta baselines on them);
//   - round-trip time and loss estimates.
//
//   const ch = createChannel({ transport, now, onUnreliable, onReliable, onAck, onViolation });
//   const seq = ch.sendUnreliable(bytes);      // one packet, now; due reliable chunks ride along
//   ch.sendReliable(bytes);                    // queued; goes with the next packet (or update() sends one)
//   ch.update();                               // call every tick: resends, and acks when nothing else was sent
//   ch.budget()                                // bytes an unreliable payload may use in the next packet
//   ch.stats                                   // { rtt, loss, packetsOut, packetsIn, bytesOut, bytesIn, resent }
//
// Packet: seq u16 | ack u16 | ackBits u32 | flags u8 (bit 7: ack valid, low 4 bits: chunk count) |
//         chunks { id u16, len u15 + last bit, bytes } | the unreliable payload (the rest, may be empty).
// Limits (hostile input): a packet over `maxPacket` + 64 bytes, a malformed header or a reliable message growing
// past `maxReliableIn` calls onViolation(reason) and is dropped; at most WINDOW out-of-order chunks are held.
// ---------------------------------------------------------------------------
import { seqDiff } from './wire.js';

const HEADER = 9, CHUNK = 480, WINDOW = 64;

export function createChannel({ transport, now = () => performance.now(), maxPacket = 1200, maxReliableIn = 4096,
  maxReliableQueue = 4 << 20, idleMs = 40, onUnreliable, onReliable, onAck, onViolation } = {}) {
  let seq = 0, rAck = 0, rBits = 0, got = false, lastSend = -1e9, owe = false, closed = false;
  const sent = new Map();          // seq -> { t, ids }: packets not yet acknowledged or given up on
  const out = [];                  // reliable chunks not yet acknowledged, oldest first: { id, bytes, last, t }
  let nextOut = 0, nextIn = 0, queued = 0;
  const held = new Map();          // chunks that arrived ahead of nextIn
  let parts = [], partsLen = 0;
  const stats = { rtt: 0, rttVar: 0, loss: 0, packetsOut: 0, packetsIn: 0, bytesOut: 0, bytesIn: 0, resent: 0, duplicates: 0, lost: 0 };
  const rto = () => (stats.rtt ? Math.min(1000, Math.max(50, stats.rtt + 4 * stats.rttVar + 20)) : 200);

  const due = (t) => { const r = rto(), list = []; for (let i = 0; i < out.length && i < WINDOW && list.length < 15; i++) if (t - out[i].t >= r) list.push(out[i]); return list; };

  function packet(payload) {
    if (closed || !transport.open) return -1;
    const t = now();
    let size = HEADER + (payload ? payload.length : 0);
    const chunks = [];
    for (const c of due(t)) { if (size + 4 + c.bytes.length > maxPacket) continue; chunks.push(c); size += 4 + c.bytes.length; }
    const b = new Uint8Array(size);
    b[0] = seq & 255; b[1] = seq >> 8; b[2] = rAck & 255; b[3] = rAck >> 8;
    b[4] = rBits & 255; b[5] = (rBits >>> 8) & 255; b[6] = (rBits >>> 16) & 255; b[7] = rBits >>> 24;
    b[8] = (got ? 128 : 0) | chunks.length;
    let o = HEADER;
    for (const c of chunks) {
      if (c.t > -1e8) stats.resent++;
      c.t = t;
      const meta = c.bytes.length | (c.last ? 0x8000 : 0);
      b[o] = c.id & 255; b[o + 1] = c.id >> 8; b[o + 2] = meta & 255; b[o + 3] = meta >> 8;
      b.set(c.bytes, o + 4); o += 4 + c.bytes.length;
    }
    if (payload) b.set(payload, o);
    const s = seq;
    sent.set(s, { t, ids: chunks.map((c) => c.id) });
    // a packet 64 behind has fallen out of the peer's ack window: count it lost
    const old = (s - 64) & 65535;
    if (sent.delete(old)) { stats.lost++; stats.loss = stats.loss * 0.98 + 0.02; }
    seq = (seq + 1) & 65535;
    lastSend = t; owe = false;
    stats.packetsOut++; stats.bytesOut += size;
    transport.send(b);
    return s;
  }

  function acked(s, t) {
    const e = sent.get(s);
    if (!e) return;
    sent.delete(s);
    const sample = t - e.t;
    if (!stats.rtt) { stats.rtt = sample; stats.rttVar = sample / 2; }
    else { stats.rttVar += (Math.abs(sample - stats.rtt) - stats.rttVar) * 0.25; stats.rtt += (sample - stats.rtt) * 0.125; }
    stats.loss *= 0.98;
    if (e.ids.length) for (let i = out.length - 1; i >= 0; i--) if (e.ids.includes(out[i].id)) { queued -= out[i].bytes.length; out.splice(i, 1); }
    onAck?.(s);
  }

  const violation = (why) => { if (!closed) onViolation?.(why); };

  function receive(b) {
    if (closed) return;
    if (!(b instanceof Uint8Array) || b.length < HEADER || b.length > maxPacket + 64) return violation('packet size');
    const t = now(), s = b[0] | (b[1] << 8), flags = b[8];
    stats.packetsIn++; stats.bytesIn += b.length;
    if (!got) { got = true; rAck = s; rBits = 0; }
    else {
      const d = seqDiff(s, rAck);
      if (d > 0) { rBits = d > 32 ? 0 : d === 32 ? 0x80000000 : ((rBits << d) | (1 << (d - 1))) >>> 0; rAck = s; }
      else {
        const bit = -d - 1;
        if (d === 0 || bit >= 32 || (rBits & (1 << bit))) { stats.duplicates++; return; }   // seen, or too old to tell
        rBits = (rBits | (1 << bit)) >>> 0;
      }
    }
    owe = true;
    if (flags & 128) {
      const a = b[2] | (b[3] << 8), bits = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
      // an ack for a sequence number never sent is not an error by itself (a restarted peer), it just matches nothing
      acked(a, t);
      for (let i = 0; i < 32; i++) if (bits & (1 << i)) acked((a - 1 - i) & 65535, t);
    }
    let o = HEADER;
    for (let n = flags & 15; n > 0; n--) {
      if (o + 4 > b.length) return violation('chunk header');
      const id = b[o] | (b[o + 1] << 8), meta = b[o + 2] | (b[o + 3] << 8), len = meta & 0x7fff;
      o += 4;
      if (o + len > b.length) return violation('chunk length');
      const d = seqDiff(id, nextIn);
      if (d >= 0 && d < WINDOW && !held.has(id)) held.set(id, { bytes: b.slice(o, o + len), last: !!(meta & 0x8000) });
      o += len;
    }
    while (held.has(nextIn)) {
      const c = held.get(nextIn); held.delete(nextIn); nextIn = (nextIn + 1) & 65535;
      partsLen += c.bytes.length;
      if (partsLen > maxReliableIn) { parts = []; partsLen = 0; return violation('reliable message too large'); }
      parts.push(c.bytes);
      if (c.last) {
        let m = parts[0];
        if (parts.length > 1) { m = new Uint8Array(partsLen); let p = 0; for (const x of parts) { m.set(x, p); p += x.length; } }
        parts = []; partsLen = 0;
        onReliable?.(m);
        if (closed) return;
      }
    }
    if (o < b.length) onUnreliable?.(b.subarray(o), s);
  }
  transport.onmessage = receive;

  return {
    stats, transport,
    sendUnreliable: (payload) => packet(payload),
    /** false when the queue is full (the peer is not acknowledging): the caller should drop the connection */
    sendReliable(bytes) {
      if (closed || queued + bytes.length > maxReliableQueue) return false;
      for (let p = 0; p === 0 || p < bytes.length; p += CHUNK) {
        const part = bytes.slice(p, p + CHUNK);
        out.push({ id: nextOut, bytes: part, last: p + CHUNK >= bytes.length, t: -1e9 });
        nextOut = (nextOut + 1) & 65535; queued += part.length;
      }
      return true;
    },
    update() {
      const t = now();
      if (t - lastSend >= idleMs && (owe || due(t).length)) packet(null);
      else if (due(t).length > 1 && t - lastSend >= 4) packet(null);   // a long reliable message: do not wait for the idle timer
    },
    budget() { let r = 0; for (const c of due(now())) r += 4 + c.bytes.length; return maxPacket - HEADER - Math.min(r, maxPacket >> 1); },
    get pendingReliable() { return out.length; },
    get lastSeq() { return (seq - 1) & 65535; },
    close() { closed = true; },
  };
}
