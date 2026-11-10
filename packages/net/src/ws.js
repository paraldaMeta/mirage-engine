// Mirage original code. Written from RFC 6455 (The WebSocket Protocol); no code taken from any library.
// ---------------------------------------------------------------------------
// The server half of WebSocket, for Node. Node 22 ships a WebSocket CLIENT (globalThis.WebSocket) but no server,
// and the usual answer is the `ws` package. This file is the part of it this engine needs (about 150 lines:
// handshake, frames both ways, fragments, ping/pong, close), so @mirage/net adds no runtime dependency and every
// limit a public server needs sits where it can be read:
//
//   httpServer.on('upgrade', (req, socket, head) => {
//     const ws = acceptWebSocket(req, socket, head, { maxPayload: 16384 });   // null (and a 4xx) if it is not one
//     ws.addEventListener('message', (e) => e.data);   // string, or ArrayBuffer for binary frames
//     ws.send(stringOrUint8Array); ws.close(1000, 'bye');
//   });
//
// The object has the browser WebSocket's shape (readyState, send, close, addEventListener), so
// webSocketTransport(ws) takes either. Not implemented, on purpose: extensions (permessage-deflate: the payloads
// are already bit packed, and compression is a memory-exhaustion surface) and subprotocols.
//
// Hostile input: a frame's declared length is checked against `maxPayload` BEFORE anything is allocated for it
// (close 1009); unmasked client frames, reserved bits, unknown opcodes and oversized control frames close with
// 1002; a slow reader is not buffered without bound: past `maxBuffered` bytes binary frames are dropped (the
// channel above treats that as loss) and text frames close the connection.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';   // the protocol's fixed handshake string (RFC 6455 section 1.3)
const refuse = (socket, code, text) => { try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* gone */ } return null; };

export function acceptWebSocket(req, socket, head, { maxPayload = 65536, maxBuffered = 1 << 20 } = {}) {
  const h = req.headers, key = h['sec-websocket-key'];
  if (req.method !== 'GET' || String(h.upgrade).toLowerCase() !== 'websocket' || h['sec-websocket-version'] !== '13' || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key))
    return refuse(socket, 400, 'Bad Request');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
  socket.setNoDelay(true); socket.setTimeout(0);

  const listeners = { message: [], close: [], error: [], open: [] };
  const fire = (type, e) => { for (const fn of [...listeners[type]]) try { fn(e); } catch (err) { queueMicrotask(() => { throw err; }); } };
  let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0), parts = [], partsLen = 0, partsOp = 0, done = false;
  const ws = {
    readyState: 1, binaryType: 'arraybuffer', remoteAddress: socket.remoteAddress, dropped: 0,
    addEventListener(type, fn, opt) { if (!listeners[type]) return; listeners[type].push(opt?.once ? function once(e) { ws.removeEventListener(type, once); fn(e); } : fn); },
    removeEventListener(type, fn) { const l = listeners[type], i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); },
    send(data) {
      if (ws.readyState !== 1) return;
      const text = typeof data === 'string', body = text ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      if (socket.writableLength > maxBuffered) { if (text) return ws.close(1008, 'too slow'); ws.dropped++; return; }
      frame(text ? 1 : 2, body);
    },
    close(code = 1000, reason = '') { finish(code, String(reason), true); },
  };
  function frame(op, body) {
    const n = body.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeUInt32BE(n, 6); return b; })();
    try { socket.write(n ? Buffer.concat([head, body]) : head); } catch { /* gone */ }
  }
  function finish(code, reason, sendClose) {
    if (done) return;
    done = true; ws.readyState = 3;
    if (sendClose && !socket.destroyed) { const r = Buffer.from(reason.slice(0, 100), 'utf8'), b = Buffer.alloc(2 + r.length); b.writeUInt16BE(code === 1005 ? 1000 : code, 0); r.copy(b, 2); frame(8, b); }   // 1005 ("no code given") may not be sent
    try { socket.end(); } catch { /* gone */ }
    setTimeout(() => socket.destroy(), 2000).unref?.();
    fire('close', { code, reason });
  }
  function deliver(op, payload) {
    if (op === 1) {
      let s; try { s = new TextDecoder('utf-8', { fatal: true }).decode(payload); } catch { return finish(1007, 'bad utf-8', true); }
      fire('message', { data: s });
    } else fire('message', { data: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) });
  }
  function parse() {
    while (!done) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1], fin = b0 & 0x80, op = b0 & 15;
      if (b0 & 0x70 || !(b1 & 0x80)) return finish(1002, 'protocol', true);   // reserved bits; clients must mask
      let len = b1 & 127, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; if (buf.readUInt32BE(2)) return finish(1009, 'too big', true); len = buf.readUInt32BE(6); at = 10; }
      if (op >= 8 ? (len > 125 || !fin) : len + partsLen > maxPayload) return finish(op >= 8 ? 1002 : 1009, op >= 8 ? 'protocol' : 'too big', true);
      if (buf.length < at + 4 + len) return;                                   // wait for the rest (at most maxPayload + 14 bytes are held)
      const mask = buf.subarray(at, at + 4), payload = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len);
      if (op === 8) return finish(len >= 2 ? payload.readUInt16BE(0) : 1005, len > 2 ? payload.subarray(2).toString('utf8') : '', true);
      else if (op === 9) frame(10, payload);
      else if (op === 10) { /* pong: nothing to do */ }
      else if (op === 0) {
        if (!partsOp) return finish(1002, 'protocol', true);
        parts.push(payload); partsLen += len;
        if (fin) { const all = Buffer.concat(parts, partsLen), o = partsOp; parts = []; partsLen = 0; partsOp = 0; deliver(o, all); }
      } else if (op === 1 || op === 2) {
        if (partsOp) return finish(1002, 'protocol', true);
        if (fin) deliver(op, payload); else { partsOp = op; parts = [payload]; partsLen = len; }
      } else return finish(1002, 'protocol', true);
    }
  }
  socket.on('data', (chunk) => { if (done) return; buf = buf.length ? Buffer.concat([buf, chunk]) : chunk; parse(); });
  socket.on('end', () => finish(1006, '', false));     // http's sockets are half-open: without this a peer that just hangs up would stay
  socket.on('close', () => finish(1006, '', false));
  socket.on('error', () => finish(1006, '', false));
  if (buf.length) queueMicrotask(parse);
  return ws;
}
