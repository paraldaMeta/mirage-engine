// Mirage original code.
// ---------------------------------------------------------------------------
// The Node server: one HTTP port that serves a folder (the built example), the walk grid, and a WebSocket lobby at
// /net. Node only (node:http, node:crypto, node:fs); import it as '@mirage/net/server', it is not in the index.
//
//   const srv = createServer({ protocol, grid: gridBytes, spawn: [0, 0, 5], dir: 'dist', setup: (room) => installKit(room) });
//   const { url } = await srv.listen();        // 127.0.0.1 and a free port unless { host, port } say otherwise
//   srv.open('Courtyard', { code: 'YARD', persistent: true });
//   srv.close();
//
// The lobby speaks JSON text frames (at most 16 KB, parsed in a try, known types only); a room speaks binary:
//   -> {t:'list'}                    <- {t:'rooms', rooms:[{code, name, players, max, mode}]}
//   -> {t:'create', name, max}       <- {t:'created', code}                 a room that runs here ("dedicated")
//   -> {t:'join', code}              <- {t:'joined', code, mode, key, host, index}
//   -> {t:'host', name, max}         <- {t:'hosting', code, key}            a room that runs in the sender's browser
//   -> {t:'signal', to, data}        <- {t:'signal', from, data}            WebRTC offers/answers/candidates, host <-> member only
//   -> {t:'leave'}                   <- {t:'left'}
//   <- {t:'peer', key, index} / {t:'peer-left', key}   to a host           <- {t:'migrate', host}   the host left: `host` takes over
//   -> {t:'ready'}                   after 'migrate': relay my packets again (those before it were for the old host)
//   <- {t:'error', why}
// After joining a dedicated room every binary frame is a packet of that room. In a hosted room the lobby relays
// binary frames between a member and the host (the host's frames carry the member's index in their first two
// bytes) until, or instead of, a WebRTC data channel: see host.js.
//
// What a public deployment needs is in docs/multiplayer.md ("Exposing it"). What this file does on its own:
// binds to 127.0.0.1; refuses a Host header that is not a loopback name (DNS rebinding) unless `hosts` lists it;
// refuses WebSocket upgrades from another origin unless `origins` lists it; caps connections in total and per
// address, rooms, frame size (16 KB text, 1 402 bytes binary), messages a second; never evaluates anything.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { resolve, sep, extname, join } from 'node:path';
import { acceptWebSocket } from './ws.js';
import { conditioned } from './transport.js';
import { createRoom } from './room.js';
import { deserializeGrid } from './grid.js';
import { cleanText } from './wire.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I: codes are read aloud
const MAX_BINARY = 1402;

export function createServer(o = {}) {
  const host = o.host ?? '127.0.0.1', loop = LOOPBACK.includes(host === '::1' ? '[::1]' : host);
  const hosts = o.hosts ?? (loop ? LOOPBACK : null), origins = o.origins ?? [];
  const maxConnections = o.maxConnections ?? 256, perAddress = o.perAddress ?? 32, maxRooms = o.maxRooms ?? 64, emptyMs = o.emptyMs ?? 60000;
  const gridBytes = o.grid ?? null, grid = gridBytes ? deserializeGrid(gridBytes) : null;
  const root = o.dir ? resolve(o.dir) : null;
  const rooms = new Map(), conns = new Set(), perAddr = new Map();
  const stats = { connections: 0, refused: 0, dropped: 0, relayed: 0 };
  const now = o.now ?? (() => performance.now());

  // ---- http ---------------------------------------------------------------
  const hostOk = (req) => { if (!hosts) return true; const h = String(req.headers.host || ''); return hosts.includes(h.replace(/:\d+$/, '')); };
  const server = http.createServer((req, res) => {
    const end = (code, text, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : text); };
    if (!hostOk(req)) return end(403, 'forbidden host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return end(405, 'method not allowed');
    let path; try { path = decodeURIComponent(String(req.url).split('?')[0]); } catch { return end(400, 'bad request'); }
    if (path === '/net/grid.bin') return gridBytes ? end(200, Buffer.from(gridBytes.buffer, gridBytes.byteOffset, gridBytes.byteLength), MIME['.bin']) : end(404, 'no grid');
    if (path === '/net/rooms') return end(200, JSON.stringify(listRooms()), MIME['.json']);
    if (!root || path.includes('\0')) return end(404, 'not found');
    let file = resolve(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return end(403, 'forbidden');   // no way out of the folder
    try { let st = statSync(file); if (st.isDirectory()) { file = join(file, 'index.html'); st = statSync(file); } if (!st.isFile()) throw 0;
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { end(404, 'not found'); }
  });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const deny = (code, text) => { stats.refused++; try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* gone */ } };
    if (String(req.url).split('?')[0] !== '/net') return deny(404, 'Not Found');
    if (!hostOk(req)) return deny(403, 'Forbidden');
    const origin = req.headers.origin;   // browsers always send it; a page on another site is refused. Other programs send none.
    if (origin !== undefined) {
      let same = false; try { same = new URL(origin).host === req.headers.host; } catch { /* not a URL */ }
      if (!same && !origins.includes(origin)) return deny(403, 'Forbidden');
    }
    const addr = socket.remoteAddress || '?';
    if (conns.size >= maxConnections || (perAddr.get(addr) || 0) >= perAddress) return deny(503, 'Service Unavailable');
    const ws = acceptWebSocket(req, socket, head, { maxPayload: 16384 });
    if (ws) connection(ws, addr); else stats.refused++;
  });

  // ---- rooms --------------------------------------------------------------
  const newCode = () => { for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += ALPHABET[randomInt(ALPHABET.length)]; if (!rooms.has(c)) return c; } };
  const listRooms = () => [...rooms.values()].filter((r) => !r.hidden).map((r) => ({ code: r.code, name: r.name, players: r.room ? r.room.players.size : r.members.size + 1, max: r.max, mode: r.mode }));
  /** a room that runs in this process */
  function open(name = 'Room', opt = {}) {
    if (!o.protocol || !grid) throw new Error('mirage net: createServer needs { protocol, grid } to run rooms here');
    if (rooms.size >= maxRooms) return null;
    const code = opt.code ?? newCode(), max = Math.max(1, Math.min(o.maxPlayers ?? 64, opt.max | 0 || o.roomSize || 16));
    const room = createRoom({ protocol: o.protocol, grid, spawn: o.spawn, tickRate: o.tickRate ?? 20, interest: o.interest, reconnectMs: o.reconnectMs, ...o.room, maxPlayers: max, name, code });
    const entry = { code, name, max, mode: 'dedicated', room, members: new Map(), host: null, persistent: !!opt.persistent, hidden: !!opt.hidden, emptyAt: now(), kit: null };
    entry.kit = o.setup?.(room, entry) ?? null;
    rooms.set(code, entry); room.start();
    return entry;
  }
  function shut(entry, why = 'room closed') {
    if (!rooms.delete(entry.code)) return;
    entry.room?.close(why);
    for (const m of entry.members.values()) { m.entry = null; m.role = 'lobby'; send(m, { t: 'left', why }); }
  }
  const sweep = setInterval(() => {
    const t = now();
    for (const r of [...rooms.values()]) {
      if (r.mode !== 'dedicated' || r.persistent) continue;
      if (r.room.players.size || r.room.connections) r.emptyAt = t; else if (t - r.emptyAt > emptyMs) shut(r, 'empty');
    }
  }, 5000);
  sweep.unref?.();

  // ---- connections ----------------------------------------------------------
  const send = (c, m) => c.ws.send(JSON.stringify(m));
  function connection(ws, addr) {
    const c = { ws, addr, key: randomBytes(6).toString('hex'), role: 'lobby', entry: null, index: 0, tr: null, text: 40, bin: 300, at: now(), strikes: 0 };
    conns.add(c); perAddr.set(addr, (perAddr.get(addr) || 0) + 1); stats.connections++;
    const strike = (n, why) => { c.strikes += n; if (c.strikes >= 8) { stats.dropped++; ws.close(1008, why); } };
    ws.addEventListener('message', (e) => {
      const t = now(), dt = (t - c.at) / 1000; c.at = t;
      c.text = Math.min(40, c.text + dt * 20); c.bin = Math.min(300, c.bin + dt * 300); c.strikes = Math.max(0, c.strikes - dt * 0.5);
      if (typeof e.data === 'string') {
        if (c.text < 1) return strike(1, 'message rate');
        c.text -= 1;
        let m; try { m = JSON.parse(e.data); } catch { return strike(2, 'not json'); }
        if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return strike(2, 'not a message');
        try { onText(c, m, strike); } catch (err) { o.onError?.(err); strike(2, 'error'); }
      } else {
        const u = new Uint8Array(e.data);
        if (u.length > MAX_BINARY) return strike(2, 'packet size');
        if (c.role === 'dedicated') return c.tr.open && c.tr.onmessage?.(u);     // the room has its own rate limits
        if (c.bin < 1) return strike(0.1, 'packet rate');
        c.bin -= 1;
        const entry = c.entry;
        if (c.hold) return;   // packets of the connection to the host that left: see 'migrate'
        if (c.role === 'member' && entry?.host) { const out = new Uint8Array(u.length + 2); out[0] = c.index & 255; out[1] = c.index >> 8; out.set(u, 2); entry.host.ws.send(out); stats.relayed++; }
        else if (c.role === 'host' && u.length >= 2) { const m = entry.byIndex.get(u[0] | (u[1] << 8)); if (m) { m.ws.send(u.subarray(2)); stats.relayed++; } }
        else strike(0.5, 'packet outside a room');
      }
    });
    ws.addEventListener('close', () => {
      if (!conns.delete(c)) return;
      const n = (perAddr.get(addr) || 1) - 1; if (n > 0) perAddr.set(addr, n); else perAddr.delete(addr);
      leave(c, 'closed', true);
    });
  }
  function leave(c, why, gone = false) {
    const entry = c.entry, role = c.role;
    c.entry = null; c.role = 'lobby'; c.hold = false;
    if (role === 'dedicated') { const tr = c.tr; c.tr = null; if (tr.open) { tr.open = false; tr.onclose?.(why); } }
    else if (role === 'member' && entry) {
      entry.members.delete(c.key); entry.byIndex.delete(c.index);
      if (entry.host) send(entry.host, { t: 'peer-left', key: c.key });
    } else if (role === 'host' && entry) {
      // the host left: the member who has been there longest takes over, with the state every member holds
      const next = entry.members.values().next().value;
      if (!next) { rooms.delete(entry.code); return; }
      entry.members.delete(next.key); entry.byIndex.delete(next.index);
      entry.host = next; next.role = 'host';
      // Packets still on their way belong to channels that ended with the old host; relayed to the new one they would
      // poison its fresh channels' sequence numbers. So nothing is relayed for a connection until it answers 'ready',
      // which it sends after the last packet of the old channel (one socket: the order holds).
      for (const m of [next, ...entry.members.values()]) { m.hold = true; send(m, { t: 'migrate', code: entry.code, host: next.key }); }
      for (const m of entry.members.values()) send(next, { t: 'peer', key: m.key, index: m.index });
    }
    if (!gone && role !== 'lobby') send(c, { t: 'left', why });
  }
  function onText(c, m, strike) {
    const err = (why) => send(c, { t: 'error', why });
    switch (m.t) {
      case 'list': return send(c, { t: 'rooms', rooms: listRooms() });
      case 'create': {
        if (o.allowCreate === false) return err('rooms cannot be created here');
        if (c.created && now() - c.created < 5000) return err('one room every five seconds');
        const entry = open(cleanText(m.name, 48) || 'Room', { max: m.max | 0 });
        if (!entry) return err('no more rooms');
        c.created = now();
        return send(c, { t: 'created', code: entry.code });
      }
      case 'host': {
        if (o.allowHost === false) return err('hosting is off here');
        if (c.role !== 'lobby') return err('already in a room');
        if (rooms.size >= maxRooms) return err('no more rooms');
        const entry = { code: newCode(), name: cleanText(m.name, 48) || 'Room', max: Math.max(1, Math.min(32, m.max | 0 || 8)), mode: 'host', room: null, host: c, members: new Map(), byIndex: new Map(), nextIndex: 1, hidden: false };
        rooms.set(entry.code, entry); c.entry = entry; c.role = 'host';
        return send(c, { t: 'hosting', code: entry.code, key: c.key });
      }
      case 'join': {
        if (c.role !== 'lobby') return err('already in a room');
        const entry = rooms.get(cleanText(m.code, 8).toUpperCase());
        if (!entry) return err('no such room');
        if (entry.mode === 'dedicated') {
          const inner = { kind: 'websocket', reliable: true, open: true, onmessage: null, onclose: null, send: (u) => c.ws.send(u),
            close(why) { if (!inner.open) return; inner.open = false; if (c.tr === inner) { c.tr = null; c.entry = null; c.role = 'lobby'; c.ws.close(1000, String(why || 'closed').slice(0, 60)); } } };
          // --latency/--loss: the simulator sits here, on both directions of every player's connection
          const tr = o.conditions ? conditioned(inner, { ...o.conditions, both: true }, { seed: 'mirage/net/' + c.key }) : inner;
          c.tr = inner; c.entry = entry; c.role = 'dedicated';
          send(c, { t: 'joined', code: entry.code, mode: 'dedicated', key: c.key, tickRate: entry.room.tickRate });
          entry.room.accept(tr, { key: c.key });
          return;
        }
        if (entry.members.size + 1 >= entry.max) return err('room full');
        c.index = entry.nextIndex++; if (entry.nextIndex > 65000) entry.nextIndex = 1;
        entry.members.set(c.key, c); entry.byIndex.set(c.index, c); c.entry = entry; c.role = 'member';
        send(c, { t: 'joined', code: entry.code, mode: 'host', key: c.key, host: entry.host.key, index: c.index });
        return send(entry.host, { t: 'peer', key: c.key, index: c.index });
      }
      case 'signal': {
        const entry = c.entry, data = m.data;
        if (!entry || entry.mode !== 'host' || typeof m.to !== 'string' || !data || typeof data !== 'object') return strike(1, 'signal');
        const to = c.role === 'host' ? entry.members.get(m.to) : m.to === entry.host?.key ? entry.host : null;   // never member to member
        if (to) send(to, { t: 'signal', from: c.key, data });
        return;
      }
      case 'ready': c.hold = false; return;
      case 'leave': return leave(c, 'left');
      default: return strike(1, 'unknown message');
    }
  }

  return {
    http: server, rooms, stats, open, shut, listRooms,
    get connections() { return conns.size; },
    /** start listening; resolves to { port, url, ws } */
    listen: (port = o.port ?? 0) => new Promise((ok, no) => {
      server.once('error', no);
      server.listen(port, host, () => { const p = server.address().port, h = host.includes(':') ? `[${host}]` : host; ok({ port: p, url: `http://${h}:${p}`, ws: `ws://${h}:${p}/net` }); });
    }),
    close: () => new Promise((ok) => {
      clearInterval(sweep);
      for (const r of [...rooms.values()]) shut(r, 'server closing');
      for (const c of [...conns]) c.ws.close(1001, 'server closing');
      server.close(() => ok()); server.closeAllConnections?.();
    }),
  };
}
