# @miragekit/net

Multiplayer for worlds walked with `@miragekit/play`: an authoritative room that runs the same walker over the same
walk grid, headlessly in Node or inside one player's browser; snapshots with quantised fields and deltas against
acknowledged baselines; client-side prediction with reconciliation; lag-compensated hit queries; a lobby with room
codes, reconnect and host migration. No dependencies: the WebSocket server is in this package (`src/ws.js`), the
client is the platform's `WebSocket`.

```js
// game.js: imported by the page and by the server, so the two cannot disagree
import { kitProtocol, installKit } from '@miragekit/net/kit';
export const protocol = kitProtocol({ bounds: plan.bounds });
export const setup = (room) => installKit(room, { pickups: [[4, 0, 2]] });

// the page
import { connectLobby, joinRoom, deserializeGrid } from '@miragekit/net';
const grid = deserializeGrid(new Uint8Array(await (await fetch('./grid.bin')).arrayBuffer()));
const lobby = await connectLobby('ws://127.0.0.1:8787/net');
const { client } = await joinRoom({ lobby, code: 'YARD', protocol, grid, name: 'Ada', setup });
const play = createPlay(world, { plan, grid, walker: client.walker, onStep: () => drawOthers(client.entities) });
```

```sh
mirage-net bake dist --out public/grid.bin      # the walk grid the GPU baked, as a file the server can load
mirage-net --dir dist --grid public/grid.bin --game game.js --latency 75 --loss 0.05
```

The server listens on 127.0.0.1 only. `docs/multiplayer.md` in the repository has the guide, the numbers, the
limits, and what exposing a server to the internet requires (TLS, origin checks, accounts). The playable example
is `examples/net-courtyard`.

| module | |
|---|---|
| `transport.js` | `createLoopbackNetwork` (seeded latency, jitter, loss, duplication, reordering), `conditioned`, `webSocketTransport` |
| `rtc.js` | `rtcTransport` (unreliable, unordered data channel; signalling through the lobby), `preferTransport` |
| `channel.js` | acks, a reliable ordered stream over the unreliable one, rtt and loss |
| `schema.js` | `defineProtocol`, `field`: quantised fields, full and delta encodings, a hash both ends compare |
| `grid.js` | `serializeGrid`, `deserializeGrid`, `bakeGridCPU` (no GPU), `boxTriangles`, `sceneTriangles` |
| `room.js` | `createRoom`: ticks, interest, validation, rate limits, `hitscan`, `serialize` |
| `client.js` | `createClient`: prediction, reconciliation, interpolation, clock |
| `lobby.js`, `host.js` | `connectLobby`, `joinRoom`, `hostRoom` (host mode and migration) |
| `kit.js` | `kitProtocol`, `installKit`: names, pickups, chat, tag |
| `overlay.js` | `createNetOverlay`: rtt, loss, bytes/s per entity type, prediction error |
| `server.js`, `ws.js` | Node only: `createServer`, `acceptWebSocket`; import as `@miragekit/net/server` |
