// Mirage original code.
// ---------------------------------------------------------------------------
// The client's side of the lobby (server.js lists the messages). Runs in a page and in Node 22 (both have WebSocket).
//
//   const lobby = await connectLobby('ws://127.0.0.1:8787/net');
//   const rooms = await lobby.list();                    // [{ code, name, players, max, mode }]
//   const code = await lobby.create('My room', 8);       // a room on the server
//   const j = await lobby.join(code);                    // { mode: 'dedicated' | 'host', key, host, transport }
//   client.connect(j.transport);                         // or let joinRoom() in host.js do all of it
//   const { code } = await lobby.host('My room', 8);     // a room in this page: see host.js
//
// Everything that arrives is checked for its shape before it is used; rooms' names and codes are cleaned
// (cleanText) and must still be shown with textContent.
// ---------------------------------------------------------------------------
import { webSocketTransport } from './transport.js';
import { cleanText } from './wire.js';

export async function connectLobby(url, { WebSocketImpl = globalThis.WebSocket, timeout = 8000 } = {}) {
  const ws = webSocketTransport(url, { WebSocketImpl });
  await ws.ready;
  const waiting = [];   // { type, ok, no, timer }: answers come back in the order the questions went
  const relays = new Map();
  let direct = null;
  const lobby = {
    key: '', code: '', mode: '', hostKey: '', index: 0, socket: ws, closed: false,
    onpeer: null, onpeerleft: null, onsignal: null, onmigrate: null, onleft: null, onclose: null,
    list: () => ask({ t: 'list' }, 'rooms').then((m) => (Array.isArray(m.rooms) ? m.rooms.slice(0, 256) : []).map((r) => ({ code: cleanText(r?.code, 8), name: cleanText(r?.name, 48), players: r?.players | 0, max: r?.max | 0, mode: r?.mode === 'host' ? 'host' : 'dedicated' }))),
    create: (name, max) => ask({ t: 'create', name, max }, 'created').then((m) => cleanText(m.code, 8)),
    host: (name, max) => ask({ t: 'host', name, max }, 'hosting').then((m) => { lobby.key = String(m.key); lobby.code = cleanText(m.code, 8); lobby.mode = 'hosting'; return { code: lobby.code, key: lobby.key }; }),
    join: (code) => ask({ t: 'join', code }, 'joined').then((m) => {
      Object.assign(lobby, { key: String(m.key), code: cleanText(m.code, 8), mode: m.mode === 'host' ? 'host' : 'dedicated', hostKey: String(m.host || ''), index: m.index | 0 });
      return { mode: lobby.mode, key: lobby.key, host: lobby.hostKey, code: lobby.code, transport: lobby.direct() };
    }),
    leave: () => ask({ t: 'leave' }, 'left').then(() => { lobby.mode = ''; }),
    signal(to, data) { ws.sendText(JSON.stringify({ t: 'signal', to, data })); },
    /** binary frames to and from the room (dedicated) or the host (through the lobby's relay). A new call replaces the last. */
    direct() {
      if (direct) direct.open = false;
      const t = direct = { kind: 'websocket', reliable: true, open: true, onmessage: null, onclose: null, send(u) { if (t.open) ws.send(u); }, close(why) { if (t.open) { t.open = false; t.onclose?.(why || 'closed'); } } };
      return t;
    },
    /** for a host: the relay to the member with this index */
    relay(index) {
      const t = { kind: 'relay', reliable: true, open: true, onmessage: null, onclose: null,
        send(u) { if (!t.open) return; const out = new Uint8Array(u.length + 2); out[0] = index & 255; out[1] = index >> 8; out.set(u, 2); ws.send(out); },
        close(why) { if (t.open) { t.open = false; relays.delete(index); t.onclose?.(why || 'closed'); } } };
      relays.set(index, t);
      return t;
    },
    close(why) { lobby.closed = true; ws.close(why); },
  };
  function ask(msg, type) {
    return new Promise((ok, no) => {
      const w = { type, ok, no, timer: setTimeout(() => { const i = waiting.indexOf(w); if (i >= 0) waiting.splice(i, 1); no(new Error('mirage net: the lobby did not answer')); }, timeout) };
      waiting.push(w); ws.sendText(JSON.stringify(msg));
    });
  }
  ws.ontext = (s) => {
    if (s.length > 20000) return;
    let m; try { m = JSON.parse(s); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const w = waiting[0];
    if (w && (m.t === w.type || m.t === 'error')) {
      waiting.shift(); clearTimeout(w.timer);
      return m.t === 'error' ? w.no(new Error('mirage net: ' + cleanText(m.why, 80))) : w.ok(m);
    }
    if (m.t === 'peer' && typeof m.key === 'string') lobby.onpeer?.({ key: m.key, index: m.index | 0 });
    else if (m.t === 'peer-left' && typeof m.key === 'string') lobby.onpeerleft?.({ key: m.key });
    else if (m.t === 'signal' && typeof m.from === 'string' && m.data && typeof m.data === 'object') lobby.onsignal?.({ from: m.from, data: m.data });
    else if (m.t === 'migrate' && typeof m.host === 'string') { ws.sendText('{"t":"ready"}'); lobby.hostKey = m.host; lobby.mode = m.host === lobby.key ? 'hosting' : 'host'; lobby.onmigrate?.({ host: m.host }); }
    else if (m.t === 'left') { lobby.mode = ''; lobby.onleft?.(cleanText(m.why, 60)); }
  };
  ws.onmessage = (u) => {
    if (lobby.mode === 'hosting') { if (u.length >= 2) relays.get(u[0] | (u[1] << 8))?.onmessage?.(u.subarray(2)); }
    else if (direct?.open) direct.onmessage?.(u);
  };
  ws.onclose = (why) => {
    lobby.closed = true;
    for (const w of waiting.splice(0)) { clearTimeout(w.timer); w.no(new Error('mirage net: the lobby closed')); }
    if (direct?.open) { direct.open = false; direct.onclose?.(why); }
    for (const t of [...relays.values()]) t.close(why);
    lobby.onclose?.(why);
  };
  return lobby;
}
