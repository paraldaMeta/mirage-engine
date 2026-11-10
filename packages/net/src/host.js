// Mirage original code.
// ---------------------------------------------------------------------------
// Sessions from a page's point of view: join a room wherever it runs, or be the server ("host mode").
//
//   const lobby = await connectLobby('ws://127.0.0.1:8787/net');
//   const s = await joinRoom({ lobby, code, protocol, grid, name: 'Ada', setup: (room) => installKit(room) });
//   const s = await hostRoom({ lobby, protocol, grid, name: 'Ada', roomName: 'My room', setup });
//   s.client          // a createClient(): the same object whichever way the room runs
//   s.room            // the createRoom() when this page is the host, else null
//   s.onhost = (room) => {}   // this page has just become the host (migration)
//   joinRoom({ ..., conditions: { latency: 75, loss: 0.05 } })   // a bad network on this page's connection, both ways
//
// Host mode. The host's page runs createRoom() with the same code as the Node server; its own player reaches it
// over an in-memory pair. Every other player reaches it through the lobby's relay at once, and over a WebRTC data
// channel as soon as one opens (rtc.js; preferTransport switches without a reconnect).
//
// Migration. The host shares the room's state with everyone once a second (room.shareState(): entities, players,
// positions, the clock; no session tokens). When the host disappears the lobby names the member who has been in
// the room longest; that page starts a room from the state it holds and the lobby tells it which key each
// arriving connection has, so everyone resumes as themselves. Up to a second of play is lost. A host is trusted
// like a server: a cheating host cannot be detected by this design; for strangers use a dedicated room.
//
// The host's room ticks on setTimeout: a hidden tab is throttled by the browser (to about 1 Hz), so the room
// stalls while the host looks elsewhere. That is the price of host mode.
// ---------------------------------------------------------------------------
import { createLoopbackNetwork, conditioned } from './transport.js';
import { createRoom } from './room.js';
import { createClient } from './client.js';
import { rtcTransport, preferTransport } from './rtc.js';

function startHosting(s, o, restore) {
  const { lobby } = s;
  let room;
  const make = (r) => createRoom({ protocol: o.protocol, grid: o.grid, spawn: o.spawn, tickRate: o.tickRate ?? 20, maxPlayers: o.max ?? 8, name: o.roomName ?? 'Room', interest: o.interest, ...o.room, code: lobby.code, restore: r });
  try { room = make(restore || undefined); } catch { room = make(undefined); }   // a state that does not load: start clean rather than not at all
  s.room = room; s.kit = o.setup?.(room, { restored: !!restore && room.players.size > 0 }) ?? null;
  const peers = new Map();
  lobby.onpeer = ({ key, index }) => {
    peers.get(key)?.tr.close('replaced');
    const relay = lobby.relay(index), rtc = o.rtc === false ? null : rtcTransport({ initiator: false, iceServers: o.iceServers, signal: (d) => lobby.signal(key, d) });
    const tr = preferTransport(relay, rtc);
    peers.set(key, { tr, rtc });
    room.accept(tr, { key });
  };
  lobby.onpeerleft = ({ key }) => { const p = peers.get(key); if (p) { peers.delete(key); p.tr.close('left'); } };
  lobby.onsignal = ({ from, data }) => peers.get(from)?.rtc?.signal(data);
  lobby.onmigrate = null;
  // this page's own player: the same client, over memory
  const [a, b] = createLoopbackNetwork({ realtime: true }).pair();
  room.accept(b, { key: lobby.key });
  s.client.connect(a);
  room.start();
  const share = setInterval(() => room.shareState(), o.shareMs ?? 1000);
  s.stopHosting = () => { clearInterval(share); room.close('host left'); for (const p of peers.values()) p.tr.close('host left'); };
  s.onhost?.(room);
}

function follow(s, o) {
  const { lobby } = s;
  const toHost = () => {
    s.rtc?.close('replaced');
    const rtc = s.rtc = o.rtc === false ? null : rtcTransport({ initiator: true, iceServers: o.iceServers, signal: (d) => lobby.signal(lobby.hostKey, d) });
    s.client.connect(worse(s, preferTransport(lobby.direct(), rtc)));
  };
  lobby.onsignal = ({ from, data }) => { if (from === lobby.hostKey) s.rtc?.signal(data); };
  lobby.onmigrate = ({ host }) => {
    s.migrations++;
    if (host === lobby.key) { s.rtc?.close('migrating'); s.rtc = null; startHosting(s, o, s.client.hostState); }
    else toHost();
  };
  toHost();
}

// the network simulator on this page's own connection (o.conditions; the overlay's keys edit s.conditions)
const worse = (s, tr) => (s.conditions ? conditioned(tr, s.conditions) : tr);
const session = (lobby, o) => ({ lobby, conditions: o.conditions ? Object.assign(o.conditions, { both: true }) : null, client: o.client ?? createClient({ protocol: o.protocol, grid: o.grid, name: o.name, spawn: o.spawn }), room: null, kit: null, rtc: null, mode: '', code: '', migrations: 0, onhost: null, stopHosting: null,
  close() { this.stopHosting?.(); this.rtc?.close('closed'); this.client.close('closed'); lobby.close('closed'); } });

/** join the room with this code: on the server, or in another player's page */
export async function joinRoom(o) {
  const s = session(o.lobby, o), j = await o.lobby.join(o.code);
  s.mode = j.mode; s.code = j.code;
  if (j.mode === 'dedicated') s.client.connect(worse(s, j.transport)); else follow(s, o);
  return s;
}

/** open a room that runs in this page and join it */
export async function hostRoom(o) {
  const s = session(o.lobby, o), h = await o.lobby.host(o.roomName ?? 'Room', o.max ?? 8);
  s.mode = 'host'; s.code = h.code;
  startHosting(s, o, null);
  return s;
}
