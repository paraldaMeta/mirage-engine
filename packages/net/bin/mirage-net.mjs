#!/usr/bin/env node
// Mirage original code. The multiplayer dev server, and the grid bake it needs.
//
// usage: mirage-net [serve] --grid grid.bin [--dir dist] [--game game.js] [--port 8787] [--tick 20]
//                   [--room Courtyard] [--code YARD] [--size 16]
//                   [--latency ms] [--jitter ms] [--loss 0..1] [--duplicate 0..1] [--reorder 0..1]   the network simulator
//                   [--origin http://localhost:5180]...   pages on other origins that may connect (vite's dev server)
//                   [--host 127.0.0.1]                    see below before changing this
//        mirage-net bake <dist dir> --out grid.bin [--query "mode=walk"]
//
// serve: one port with the folder (--dir), /net/grid.bin, /net/rooms and the WebSocket lobby at /net. --game is a
//   module of YOURS that exports { protocol, setup(room), spawn, tickRate } (the same file the page imports, so the
//   two cannot disagree); without it the rooms run @miragekit/net's kit with no pickups. One persistent room is opened
//   (--room / --code); players can create and host more.
//   --latency and friends delay, drop, repeat and reorder every room packet in BOTH directions (so --latency 150
//   is a 300 ms round trip): play against a bad network without leaving the machine.
//
// bake: opens the built page in headless Chrome (@miragekit/tools), reads the walk grid the GPU baked
//   (window.__mirage.play.grid, which every Mirage example exposes) and writes it in the serialised form the server
//   and every client then load. Bake again when the world's solids change.
//
// The server listens on 127.0.0.1: only this machine can reach it. --host with any other address prints a warning
// and still serves plain HTTP with no accounts: read "Exposing it" in docs/multiplayer.md first.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2), flags = {}, rest = [];
const MANY = new Set(['origin']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { rest.push(a); continue; }
  const k = a.slice(2), v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : '1';
  if (MANY.has(k)) (flags[k] ||= []).push(v); else flags[k] = v;
}
const die = (msg) => { console.error('mirage-net: ' + msg); process.exit(1); };
const num = (k, d, lo, hi) => { if (flags[k] === undefined) return d; const v = Number(flags[k]); if (!(v >= lo && v <= hi)) die(`--${k} must be between ${lo} and ${hi}`); return v; };
const cmd = rest[0] === 'bake' || rest[0] === 'serve' ? rest.shift() : 'serve';
if (flags.help || flags.h) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(3, 24).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

if (cmd === 'bake') {
  const dir = rest[0], out = flags.out;
  if (!dir || !out) die('bake needs <dist dir> and --out file');
  let chrome;
  try { chrome = await import('@miragekit/tools/src/chrome.mjs'); } catch (e) { die('bake needs @miragekit/tools (and a local Chrome): ' + e.message); }
  const { serializeGrid } = await import('../src/grid.js');
  const site = await chrome.serve(resolve(dir)), browser = await chrome.launch({ w: 640, h: 400 });
  try {
    const { page } = await chrome.open(browser, site.url + '?' + (flags.query ?? 'mode=walk&ui=0&w=640&h=400'));
    const g = await page.evaluate(() => {
      const g = window.__mirage?.play?.grid;
      if (!g?.floors || !g.count) return null;
      const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      return { nx: g.nx, nz: g.nz, x0: g.x0, z0: g.z0, cell: g.cell, floors: b64(g.floors), count: b64(g.count) };
    });
    if (!g) die('the page has no window.__mirage.play.grid');
    const bytes = (s) => { const b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
    const grid = { ...g, floors: new Float32Array(bytes(g.floors)), count: new Uint8Array(bytes(g.count)) };
    const data = serializeGrid(grid);
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), data);
    console.log(`mirage-net: ${out}: ${g.nx} x ${g.nz} columns of ${g.cell} m, ${data.length} bytes`);
  } finally { await browser.close(); site.close(); }
  process.exit(0);
}

// ---- serve ----------------------------------------------------------------
if (!flags.grid) die('serve needs --grid file (make one with: mirage-net bake <dist dir> --out grid.bin)');
const { createServer } = await import('../src/server.js');
const { kitProtocol, installKit } = await import('../src/kit.js');
const { deserializeGrid } = await import('../src/grid.js');
let gridBytes; try { gridBytes = new Uint8Array(readFileSync(resolve(flags.grid))); } catch (e) { die('cannot read --grid: ' + e.message); }
let g; try { g = deserializeGrid(gridBytes); } catch (e) { die('--grid is not a walk grid: ' + e.message); }
let game = {};
if (flags.game) { try { game = await import(pathToFileURL(resolve(flags.game)).href); game = game.default ?? game; } catch (e) { die('cannot load --game: ' + e.message); } }
const protocol = game.protocol ?? kitProtocol({ bounds: [g.x0, g.z0, g.x0 + g.nx * g.cell, g.z0 + g.nz * g.cell] });
const tickRate = num('tick', game.tickRate ?? 20, 1, 60);
if (60 % tickRate) die('--tick must divide 60 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60)');
const conditions = ['latency', 'jitter', 'loss', 'duplicate', 'reorder'].some((k) => flags[k] !== undefined)
  ? { latency: num('latency', 0, 0, 2000), jitter: num('jitter', 0, 0, 1000), loss: num('loss', 0, 0, 0.9), duplicate: num('duplicate', 0, 0, 0.9), reorder: num('reorder', 0, 0, 0.9) } : null;
const host = flags.host ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host))
  console.warn(`mirage-net: WARNING: listening on ${host}, reachable from other machines, over plain HTTP, with no accounts.\n            Put it behind TLS, list --origin, and read "Exposing it" in docs/multiplayer.md.`);
const srv = createServer({
  host, hosts: ['127.0.0.1', 'localhost', '::1'].includes(host) ? undefined : null, origins: flags.origin ?? [],
  dir: flags.dir, grid: gridBytes, protocol, spawn: game.spawn, tickRate, conditions, roomSize: num('size', 16, 1, 64),
  setup: game.setup ?? ((room) => installKit(room)),
  onError: (e) => console.error('mirage-net:', e?.message || e),
});
let at;
try { at = await srv.listen(num('port', 8787, 0, 65535)); } catch (e) { die('cannot listen: ' + e.message); }
const room = srv.open(flags.room ?? 'Courtyard', { code: (flags.code ?? 'YARD').toUpperCase().slice(0, 8), persistent: true });
console.log(`mirage-net: ${at.url}  (lobby ${at.ws})  room ${room.code} at ${tickRate} Hz${conditions ? `  simulating ${conditions.latency} ms +- ${conditions.jitter}, ${conditions.loss * 100} % loss each way` : ''}`);
if (process.stdout.isTTY) setInterval(() => {
  const r = room.room, s = r.stats;
  process.stdout.write(`\r  ${srv.connections} connections, ${srv.rooms.size} rooms; ${room.code}: ${r.players.size} players, tick ${s.tickMs.toFixed(3)} ms (max ${s.tickMax.toFixed(2)}), ${s.overruns} overruns   `);
}, 1000).unref();
const stop = () => { srv.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
