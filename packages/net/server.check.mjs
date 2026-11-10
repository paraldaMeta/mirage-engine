// Node checks of the server with real sockets on 127.0.0.1 (a free port, nothing leaves the machine): HTTP, the
// WebSocket handshake and its refusals, hostile frames, the lobby, a dedicated room, reconnect, and a hosted room
// over the relay with a host migration. Clients are Node 22's own WebSocket. The virtual-clock checks are check.mjs.
import http from 'node:http';
import net from 'node:net';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './src/server.js';
import { connectLobby } from './src/lobby.js';
import { joinRoom, hostRoom } from './src/host.js';
import { kitProtocol, installKit } from './src/kit.js';
import { bakeGridCPU, boxTriangles, serializeGrid, deserializeGrid } from './src/grid.js';

import { ok } from '../../scripts/soft-assert.mjs';   // reports every failure with a count, not only the first
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) return false; await sleep(20); } return true; };

const bounds = [-20, -20, 20, 20];
const gridBytes = serializeGrid(bakeGridCPU(boxTriangles([[-20, -1, -20, 20, 0, 20], [5, 0, 5, 6, 0.6, 6]]), { bounds, cell: 0.25, yMin: -1, yMax: 5 }));
const grid = deserializeGrid(gridBytes), protocol = kitProtocol({ bounds, y: [-2, 12] });
const PICKUPS = [[1.2, 0, 5], [-6, 0, -6]];
const setup = (room, info) => installKit(room, { pickups: PICKUPS, respawnMs: 60000, restored: !!info?.restored });

const dir = join(tmpdir(), 'mirage-net-check-' + process.pid);
mkdirSync(join(dir, 'sub'), { recursive: true });
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
writeFileSync(join(dir, 'sub', 'a.js'), 'export default 1;');

const srv = createServer({ protocol, grid: gridBytes, spawn: [0, 0, 5], dir, setup, tickRate: 20, emptyMs: 400, reconnectMs: 3000 });
const at = await srv.listen();
const get = (path, headers = {}, method = 'GET') => new Promise((res) => {
  const r = http.request({ host: '127.0.0.1', port: at.port, path, method, headers }, (m) => { const c = []; m.on('data', (d) => c.push(d)); m.on('end', () => res({ status: m.statusCode, type: m.headers['content-type'], body: Buffer.concat(c) })); });
  r.on('error', () => res({ status: 0 })); r.end();
});
/** a raw upgrade request: resolves to the status line's code and the socket */
const upgrade = (headers = {}, path = '/net') => new Promise((res) => {
  const s = net.connect(at.port, '127.0.0.1', () => {
    const h = { Host: `127.0.0.1:${at.port}`, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', ...headers };
    s.write(`GET ${path} HTTP/1.1\r\n` + Object.entries(h).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}\r\n`).join('') + '\r\n');
  });
  let buf = Buffer.alloc(0), done = false;
  s.on('data', (d) => { buf = Buffer.concat([buf, d]); const i = buf.indexOf('\r\n\r\n'); if (i >= 0 && !done) { done = true; res({ status: +buf.subarray(9, 12).toString(), head: buf.subarray(0, i).toString(), rest: buf.subarray(i + 4), socket: s }); } });
  s.on('error', () => { if (!done) { done = true; res({ status: 0, socket: s }); } });
  s.on('close', () => { if (!done) { done = true; res({ status: 0, socket: s }); } });
});
/** the close code a raw socket receives after sending `bytes` (0: closed without a close frame) */
const closeCode = async (bytes, wait = 1500) => {
  const u = await upgrade();
  if (u.status !== 101) return -1;
  return new Promise((res) => {
    let buf = u.rest, done = false;
    const look = () => { for (let i = 0; i + 4 <= buf.length;) { const op = buf[i] & 15, n = buf[i + 1] & 127; if (n > 125) return; if (op === 8) { done = true; return res(n >= 2 ? buf.readUInt16BE(i + 2) : 1005); } i += 2 + n; } };
    u.socket.on('data', (d) => { buf = Buffer.concat([buf, d]); if (!done) look(); });
    u.socket.on('close', () => { if (!done) { done = true; res(0); } });
    u.socket.write(bytes);
    setTimeout(() => { if (!done) { done = true; res(-2); } u.socket.destroy(); }, wait);
  });
};
const frame = (op, payload, { mask = true, fin = true, len = payload.length } = {}) => {
  const head = len < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, (mask ? 0x80 : 0) | len]) : len < 65536 ? Buffer.from([(fin ? 0x80 : 0) | op, (mask ? 0x80 : 0) | 126, len >> 8, len & 255])
    : Buffer.from([(fin ? 0x80 : 0) | op, (mask ? 0x80 : 0) | 127, 0, 0, 0, 0, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255]);
  const key = Buffer.from([1, 2, 3, 4]), body = Buffer.from(payload);
  if (mask) for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
  return Buffer.concat(mask ? [head, key, body] : [head, body]);
};

// ---- http ---------------------------------------------------------------------
{
  ok(at.url.startsWith('http://127.0.0.1:') && srv.http.address().address === '127.0.0.1', `server: listens on 127.0.0.1 only by default (${at.url})`);
  const a = await get('/'), b = await get('/sub/a.js'), g = await get('/net/grid.bin'), r = await get('/net/rooms');
  ok(a.status === 200 && a.type.startsWith('text/html') && b.status === 200 && b.type.startsWith('text/javascript'), 'http: serves the folder with content types');
  ok(g.status === 200 && g.body.length === gridBytes.length && g.body.every((v, i) => v === gridBytes[i]), `http: /net/grid.bin is the grid the rooms run on (${gridBytes.length} bytes)`);
  ok(r.status === 200 && JSON.parse(r.body).length === 0, 'http: /net/rooms lists rooms');
  const esc = await Promise.all(['/../package.json', '/%2e%2e/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/sub/../../x', '/%00', '/%zz'].map((p) => get(p)));
  ok(esc.every((x) => x.status >= 400 && x.status < 500), `http: no path leaves the folder (${esc.map((x) => x.status).join(' ')})`);
  ok((await get('/', {}, 'POST')).status === 405 && (await get('/', { Host: 'evil.example' })).status === 403, 'http: only GET and HEAD; a foreign Host header (DNS rebinding) is refused');
}

// ---- the handshake and hostile frames -----------------------------------------------
{
  const good = await upgrade({ Origin: `http://127.0.0.1:${at.port}` }); good.socket.destroy();
  const none = await upgrade(); none.socket.destroy();
  ok(good.status === 101 && /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/.test(good.head) && none.status === 101, 'ws: handshake answers the RFC 6455 example key; no Origin (not a browser) is accepted');
  const evil = await upgrade({ Origin: 'http://evil.example' }), host = await upgrade({ Host: 'evil.example' }), path = await upgrade({}, '/other'), ver = await upgrade({ 'Sec-WebSocket-Version': '8' }), key = await upgrade({ 'Sec-WebSocket-Key': 'short' });
  for (const x of [evil, host, path, ver, key]) x.socket.destroy();
  ok(evil.status === 403 && host.status === 403 && path.status === 404 && ver.status === 400 && key.status === 400, 'ws: another origin 403, foreign Host 403, wrong path 404, bad version or key 400');
  ok(await closeCode(frame(1, '{"t":"list"}', { mask: false })) === 1002, 'ws: an unmasked client frame closes 1002');
  ok(await closeCode(frame(2, '', { len: 0x7fffffff })) === 1009, 'ws: a frame declaring 2 GB closes 1009 before anything is allocated');
  ok(await closeCode(Buffer.concat([frame(1, 'a'.repeat(9000), { fin: false }), frame(0, 'a'.repeat(9000))])) === 1009, 'ws: fragments that add up past the cap close 1009');
  ok(await closeCode(Buffer.from([0xc1, 0x80, 1, 2, 3, 4])) === 1002 && await closeCode(frame(3, 'x')) === 1002 && await closeCode(frame(0, 'x')) === 1002, 'ws: reserved bits, unknown opcodes and stray continuations close 1002');
  ok(await closeCode(frame(1, Buffer.from([0xff, 0xfe]))) === 1007, 'ws: invalid UTF-8 in a text frame closes 1007');
  ok(await closeCode(Buffer.concat(Array.from({ length: 80 }, () => frame(1, '{"t":"nope"}')))) === 1008, 'lobby: a flood of unknown messages is dropped (1008)');
  ok(await closeCode(Buffer.concat(Array.from({ length: 12 }, () => frame(2, new Uint8Array(1500))))) === 1008, 'lobby: oversized packets are dropped (1008)');
  const u = await upgrade(); let pong = false;
  u.socket.on('data', (d) => { if ((d[0] & 15) === 10 && d.subarray(2, 6).toString() === 'ping') pong = true; });
  u.socket.write(frame(9, 'ping')); await until(() => pong, 1000); u.socket.destroy();
  ok(pong, 'ws: ping is answered with its payload');
  await until(() => srv.connections === 0, 2000);
  ok(srv.connections === 0 && srv.stats.refused >= 5, `server: every refused or dropped socket is gone (${srv.stats.refused} refused, ${srv.stats.dropped} dropped)`);
}

// ---- lobby and a dedicated room -------------------------------------------------------
const pump = new Set();   // sessions whose clients are updated at 60 Hz
const timer = setInterval(() => { for (const s of pump) s.client.update(); }, 1000 / 60);
const others = (s) => [...s.client.entities.values()].filter((e) => e.name === 'player' && e.id !== s.client.id);
const pickupsOf = (s) => [...s.client.entities.values()].filter((e) => e.name === 'pickup');
let firstId = 0;
{
  const la = await connectLobby(at.ws), lb = await connectLobby(at.ws);
  const code = await la.create('  Yard\u0007  ', 4);
  const list = await lb.list();
  ok(/^[A-HJ-NP-Z2-9]{5}$/.test(code) && list.length === 1 && list[0].code === code && list[0].name === 'Yard' && list[0].max === 4 && list[0].mode === 'dedicated', `lobby: create and list (room ${code}, name cleaned)`);
  let refused = ''; try { await lb.join('NOPE1'); } catch (e) { refused = e.message; }
  let quick = ''; try { await la.create('again'); } catch (e) { quick = e.message; }
  ok(/no such room/.test(refused) && /five seconds/.test(quick), 'lobby: an unknown code and a second room at once are refused');
  const a = await joinRoom({ lobby: la, code, protocol, grid, name: 'Ada' }), b = await joinRoom({ lobby: lb, code: code.toLowerCase(), protocol, grid, name: 'Bo' });
  pump.add(a); pump.add(b);
  ok(await until(() => a.client.status === 'joined' && b.client.status === 'joined' && others(a).length === 1 && others(b).length === 1 && pickupsOf(a).length === 2), 'room: two WebSocket clients join by code (case-insensitive) and see each other and the pickups');
  ok(a.mode === 'dedicated' && a.client.code === code && a.client.room === 'Yard' && others(b)[0].state.name === 'Ada', 'room: welcome carries the room and names replicate');
  // walk Ada to the first pickup (1.2 m along +x from spawn) and take it; Bo asks for the same one from afar
  const chat = [], took = [];
  b.client.on('chat', (m) => chat.push(m)); b.client.on('took', (m) => took.push(m));
  a.client.input.x = 1;
  await until(() => a.client.walker.pos[0] > 1, 4000);
  a.client.input.x = 0;
  const pid = pickupsOf(a)[0].id; await sleep(150);
  b.client.rpc('take', { id: pid }); await sleep(100); a.client.rpc('take', { id: pid }); a.client.rpc('chat', { text: 'got it' + String.fromCharCode(0x202e) });
  ok(await until(() => took.length === 1 && chat.length === 1) && took[0].by === a.client.id && chat[0].text === 'got it' && chat[0].from === a.client.id, 'kit: the near player takes the pickup, the far one cannot; chat arrives cleaned');
  ok(await until(() => others(b)[0].state.score === 1 && pickupsOf(b).find((e) => e.id === pid).state.taken === true) && Math.abs(others(b)[0].state.x - a.client.walker.pos[0]) < 0.05, 'room: score, pickup state and position converge on the other client');
  ok(a.client.stats.corrections === 0 && a.client.stats.exact > 20, `room: prediction over a real socket is exact (${a.client.stats.exact} confirmations, 0 corrections)`);
  // reconnect: the socket dies, a new one resumes the same player with its token
  firstId = a.client.id;
  const where = a.client.walker.pos.slice();
  la.socket.socket.close(); pump.delete(a);
  ok(await until(() => a.client.status === 'closed' && others(b)[0]?.state.away === true), 'reconnect: a dropped player stays in the room, marked away');
  const la2 = await connectLobby(at.ws), a2 = await joinRoom({ lobby: la2, code, protocol, grid, name: 'Ada', client: a.client });
  pump.add(a2);
  ok(await until(() => a2.client.status === 'joined' && a2.client.resumed && pickupsOf(a2).length === 2 && others(a2).length === 1) && a2.client.id === firstId && Math.hypot(a2.client.walker.pos[0] - where[0], a2.client.walker.pos[2] - where[2]) < 0.01,
    'reconnect: the token resumes the same player where it stood, with the room resynchronised');
  ok(await until(() => pickupsOf(a2).find((e) => e.id === pid).state.taken === true && others(b)[0].state.away === false), 'reconnect: state taken before the drop is still taken; the others see the player back');
  // a third connection saying it is Ada without the token is someone else
  const lc = await connectLobby(at.ws), c = await joinRoom({ lobby: lc, code, protocol, grid, name: 'Ada' });
  pump.add(c);
  ok(await until(() => c.client.status === 'joined') && c.client.id !== firstId && !c.client.resumed, 'reconnect: the name alone does not resume a player');
  const entry = srv.rooms.get(code);
  ok(entry.room.players.size === 3 && entry.room.stats.overruns === 0 && entry.room.stats.errors === 0, `room: 3 players, no tick overran (${entry.room.stats.tickMs.toFixed(3)} ms a tick on average)`);
  for (const s of [a2, b, c]) { pump.delete(s); s.close(); }
  ok(await until(() => srv.connections === 0 && !srv.rooms.has(code), 40000), 'server: an empty room is closed after its players time out');
}

// ---- a room hosted by one client, relayed by the lobby, and its migration ----------------
{
  const lh = await connectLobby(at.ws), l1 = await connectLobby(at.ws), l2 = await connectLobby(at.ws);
  const opts = { protocol, grid, spawn: [0, 0, 5], setup, shareMs: 150, tickRate: 30 };
  const h = await hostRoom({ ...opts, lobby: lh, name: 'Host', roomName: 'Mine', max: 4 });
  pump.add(h);
  const list = await l1.list();
  ok(list.length === 1 && list[0].mode === 'host' && list[0].code === h.code && h.room.code === h.code, `host: a hosted room is listed (${h.code})`);
  const m1 = await joinRoom({ ...opts, lobby: l1, code: h.code, name: 'M1' }), m2 = await joinRoom({ ...opts, lobby: l2, code: h.code, name: 'M2' });
  pump.add(m1); pump.add(m2);
  ok(await until(() => [h, m1, m2].every((s) => s.client.status === 'joined' && others(s).length === 2 && pickupsOf(s).length === 2)), 'host: two members join through the relay and all three see each other');
  ok(h.room.players.size === 3 && m1.client.tickRate === 30 && m1.mode === 'host' && await until(() => srv.stats.relayed > 50), `host: the room runs in the host's process at its tick rate (${srv.stats.relayed} packets relayed)`);
  m1.client.input.z = -1; await until(() => m1.client.walker.pos[2] < 4, 4000); m1.client.input.z = 0;
  m2.client.input.x = 1; await until(() => m2.client.walker.pos[0] > 1.5, 4000); m2.client.input.x = 0;
  const pid = pickupsOf(m2)[0].id; await sleep(200);
  m2.client.rpc('take', { id: pid });
  ok(await until(() => others(m1).find((e) => e.id === m2.client.id)?.state.score === 1), 'host: rpcs and state go through the hosting client');
  // a member cannot talk to another member through the lobby, nor a stranger to the host
  let leaked = false; l2.onsignal = () => { leaked = true; }; l1.signal(l2.key, { sdp: { type: 'offer', sdp: 'x' } }); await sleep(150);
  ok(!leaked, 'lobby: signals go between a host and its members only');
  await until(() => m1.client.hostState && m2.client.hostState, 2000); await sleep(400);
  const ids = [m1.client.id, m2.client.id], p1 = m1.client.walker.pos.slice(), p2 = m2.client.walker.pos.slice();
  ok(m1.client.hostState.length > 100, `migration: members hold the room's state (${m1.client.hostState.length} bytes, shared every 150 ms here)`);
  let became = null; m1.onhost = (room) => { became = room; };
  pump.delete(h); lh.socket.socket.close();   // the host vanishes without a word
  ok(await until(() => became && m1.client.status === 'joined' && m2.client.status === 'joined' && m1.client.resumed && m2.client.resumed && others(m2).length >= 1 && pickupsOf(m2).length === 2, 8000), 'migration: the oldest member becomes the host and both resume');
  ok(m1.client.id === ids[0] && m2.client.id === ids[1] && Math.hypot(m1.client.walker.pos[0] - p1[0], m1.client.walker.pos[2] - p1[2]) < 0.05 && Math.hypot(m2.client.walker.pos[0] - p2[0], m2.client.walker.pos[2] - p2[2]) < 0.05, 'migration: same ids, same positions');
  ok(await until(() => pickupsOf(m2).find((e) => e.id === pid)?.state.taken === true && others(m1).find((e) => e.id === m2.client.id)?.state.score === 1), 'migration: the taken pickup and the score survive');
  ok(m1.room === became && became.players.size === 3 && m1.migrations === 1 && m2.migrations === 1 && (await l2.list())[0].code === h.code, 'migration: the room keeps its code; the old host is a player who may come back');
  m2.client.input.x = -1; const x0 = m2.client.walker.pos[0];
  ok(await until(() => m2.client.walker.pos[0] < x0 - 0.5 && Math.abs((others(m1).find((e) => e.id === m2.client.id)?.state.x ?? 99) - m2.client.walker.pos[0]) < 0.6, 4000), 'migration: play goes on under the new host');
  for (const s of [m1, m2]) { pump.delete(s); s.close(); }
  h.client.close(); h.stopHosting?.();
  ok(await until(() => srv.connections === 0 && srv.rooms.size === 0, 3000), 'host: the room is gone when its last member leaves');
}

clearInterval(timer);
await srv.close();
rmSync(dir, { recursive: true, force: true });
console.log('net server check: all ok');
process.exit(0);
