# Multiplayer (`@mirage/net`)

Experimental and opt-in: nothing in core, world, play or game imports it, and a page that does not import it is
byte for byte the page it was. It is for worlds walked with `@mirage/play`: several players in one world, each
seeing the others, with the server deciding everything that matters.

## Try it

```sh
npm run build -w examples/hello-courtyard && npm run build -w examples/net-courtyard
npm run serve -w examples/net-courtyard        # http://127.0.0.1:8787, this machine only
```

Open the address in two windows. Walk into a lantern to take it (the first to arrive gets the point), press Enter
to chat. URL flags: `?name=Ada`, `?room=CODE`, `?host=1` (this page runs the room and shows a code to give to
others), `?rtc=0` (host mode over the relay only), `?overlay=1` (the debug overlay), `?latency=75&loss=0.05&jitter=20`
(a bad network on this page's connection), `?bot=1` (walks by itself), `?server=127.0.0.1:8787` (when the page comes
from vite's dev server: start the server with `--origin http://localhost:5187`).

`npm run check -w examples/net-courtyard` is the browser test, `npm run bench -w examples/net-courtyard` prints the
numbers below, `npm test -w packages/net` are the Node checks.

## How it fits together

| piece | file | what it does |
|---|---|---|
| transport | `transport.js`, `rtc.js`, `ws.js` | datagrams. In-memory loopback (seeded latency, jitter, loss, duplication, reordering on a virtual clock: the tests), WebSocket (the platform's client; the server is 100 lines in `ws.js`, RFC 6455 without extensions), WebRTC data channel (`ordered: false, maxRetransmits: 0`) signalled through the lobby |
| channel | `channel.js` | sequence numbers and a 32-packet ack field in every packet; a reliable ordered stream (events, RPCs, the welcome) cut into chunks that ride along and are resent until acknowledged; rtt and loss |
| schema | `schema.js` | `defineProtocol`: fields quantised to a stated step (positions 1/256 m), full and delta encodings, a hash both ends compare at hello |
| room | `room.js` | the authority. Fixed 1/60 s steps of the same walker on the same walk grid, one step per client input; snapshots at 20, 30 or 60 Hz, each entity a delta against the newest state that client acknowledged, stalest first, inside 1 200 bytes; interest by grid cell and radius; a one-second position history for `hitscan` |
| client | `client.js` | applies its own input at once, resends the last 16 inputs in every packet, replays unacknowledged inputs when the server disagrees and hides the step with a decaying offset; draws everyone else two ticks plus jitter in the past; clock from the shortest round trip of the last 24 |
| sessions | `server.js`, `lobby.js`, `host.js` | a JSON lobby (list, create, join by code, host), reconnect within 30 s as the same player with a full resync, late join, host mode and migration |
| tooling | `bin/mirage-net.mjs`, `overlay.js` | the dev server with the network simulator (`--latency --jitter --loss --duplicate --reorder`), the grid bake, the overlay |

**No GPU on the server.** `@mirage/play` bakes its walk grid on the GPU. `mirage-net bake <dist> --out grid.bin`
opens the built page in headless Chrome once and writes that grid to a file (hello-courtyard: 239 KB, 18 KB
gzipped). The server loads it, and so does every client (`deserializeGrid`) instead of baking its own, so both
ends walk on identical bits. That is what lets prediction be exact rather than close. `bakeGridCPU` builds a grid
from triangles with no GPU at all; it is coarser than the GPU bake, so use one or the other for a room, not both.

**One game file.** Write the protocol and the rules in a module that the page and the server both import
(`examples/net-courtyard/game.js`, 12 lines; `mirage-net --game game.js`). In host mode the same `setup(room)` runs
in the host's page.

**Dedicated or hosted.** A dedicated room runs in the Node server. A hosted room runs in one player's page with
the same `createRoom`; the others reach it through the lobby's relay at once and over WebRTC as soon as a data
channel opens. Node has no WebRTC, so a dedicated room is always WebSocket (reliable and ordered: under loss it
stalls instead of dropping, which the protocol tolerates but does not need).

**Migration.** A host shares the room's state with its members once a second. When it disappears the lobby names
the member who has been there longest; that page restores the room and everyone resumes with the same ids. Up to a
second of play is lost, and the old host's player stands marked `away` until its place times out.

## Server validation

Every client message is treated as hostile. Packets are read with a bit reader that cannot run past the packet or
throw; counts, ids and lengths are bounded by the packet; text is stripped of control characters and capped;
nothing is evaluated; lobby JSON is parsed in a `try`, capped at 16 KB and only known message types are acted on.

- **Movement** cannot be forged: the server never reads a position, only `{x, z, run, jump, yaw}` quantised to
  a few bits, and walks the player itself. Speed is therefore the walker's speed.
- **Input rate**: a token bucket at 105 % of real time. A client that sends inputs faster does not move faster:
  the extra are dropped and counted.
- **Rate and size limits**: packets a second, RPCs a second, queued inputs, reliable message size, binary frame
  size (1 402 bytes), lobby messages a second, connections in total (256) and per address (32), rooms (64).
  Offences add strikes; 8 (decaying one every 2 s) or any framing violation closes the connection.
- **Game rules** live on the server: a pickup is granted only if the server's own position of the player is within
  reach; a tag is a `hitscan` from the server's position of the shooter, rewound at most 400 ms.

What it does not do: there are no accounts, and a host in host mode is trusted like a server (a cheating host
cannot be detected in this design; use dedicated rooms for strangers). Wall hacks are limited only by interest
management, which is by distance, not by line of sight.

## Exposing it

`mirage-net` and `createServer` listen on **127.0.0.1**: nothing outside this machine can connect. They also
refuse requests whose `Host` header is not a loopback name (DNS rebinding) and WebSocket upgrades from other
origins. `--host 0.0.0.0` prints a warning and works, and is not enough to put a game on the internet. That needs:

1. **TLS.** Browsers only allow `wss:` from an `https:` page, and plain `ws:` can be read and altered on the way.
   The server speaks plain HTTP; put a reverse proxy that terminates TLS in front (Caddy, nginx, a cloud load
   balancer) and keep the Node process on loopback behind it. Forward `Upgrade` / `Connection`, and check the
   proxy's idle timeout: a lobby socket that is only listing rooms can sit quiet.
2. **Origin and host checks.** List the site's origin in `origins` (`--origin https://game.example`) and its name
   in `hosts`, so another site's page cannot open sockets to your server from a visitor's browser. Behind a proxy
   the per-address limit sees the proxy: pass the real address through, or limit at the proxy.
3. **Authentication.** A room code is the only secret here, and it is 5 characters. Anything worth protecting
   needs accounts: issue a signed token on your site, check it in the upgrade request before `acceptWebSocket`,
   and tie the player's name to it. Names are whatever the client says.
4. **Abuse.** Rate limits here are per connection and per address; a public server also wants limits at the edge,
   a chat filter and a way to ban. Chat is plain text, cleaned, and must be shown with `textContent` (the example
   and the overlay do).
5. **WebRTC** in host mode needs a STUN server to cross NATs (`iceServers`; none is configured, so it connects on a
   LAN or one machine and otherwise stays on the relay) and exposes players' addresses to each other.
6. **Operation.** One process, in-memory rooms: a restart ends every room. Run it under a supervisor, behind the
   proxy's health check, one process per core if you need more rooms.

Nothing in this repository opens a port to the network or deploys anything.

## Numbers

Measured on this machine (Apple silicon Mac, Node 22.23.1) with `npm run bench -w examples/net-courtyard`: the real
room and clients over the in-memory network on a virtual clock, every player walking, 6 lanterns, no interest
radius (everyone sees everyone). Three runs each, minimum to maximum; other jobs were running on the machine, so
read the tick times as upper bounds. Bytes are packet payloads (a WebSocket frame adds 2 to 8 a packet).

| 4 players, per player | down B/s | up B/s |
|---|---|---|
| 20 Hz, clean network | 941 | 1213 |
| 60 Hz, clean network | 2772 | 1206 |
| 20 Hz, 150 ms + 5 % loss each way | 991 | 1405-1406 |
| 60 Hz, 150 ms + 5 % loss each way | 2894-2899 | 1405-1406 |

Up is the same at both rates because inputs go at the simulation's 60 Hz whatever the tick; each packet repeats
the last 16 inputs, which is why 5 % loss costs no corrections.

| players in one room | 20 Hz: tick mean ms | p99 ms | of one core | down B/s each | 60 Hz: tick mean ms | p99 ms | of one core | down B/s each |
|---|---|---|---|---|---|---|---|---|
| 4 | 0.025-0.029 | 0.04-0.20 | 0.06 % | 968 | 0.026-0.031 | 0.04-0.08 | 0.19 % | 2855 |
| 16 | 0.164-0.167 | 0.47-0.58 | 0.33 % | 1752 | 0.135-0.153 | 1.69-3.17 | 0.92 % | 4975 |
| 64 | 1.73-1.79 | 3.01-4.02 | 3.6 % | 4920 | 1.69-2.27 | 7.94-8.80 | 13.6 % | 13517 |
| 128 | 7.00-7.48 | 10.6-12.5 | 15 % | 9220 | 6.53-7.48 | 11.9-18.1 | 45 % | 25129 |
| 256 | 28.5-30.6 | 37.9-75.3 | 61 % | 21888 | not run | | | |

Largest room (powers of two tried) whose 99th percentile tick stays inside the tick: **128 players at 20 Hz**
(256 overran its 50 ms in one run of three), **64 at 60 Hz** (128: p99 up to 18.1 ms against 16.7). The cost grows
with the square of the player count because everyone sees everyone; an interest radius was not benchmarked. The
lobby caps a room at 64 players (`maxPlayers`), hosted rooms at 32.

The browser check (`npm run check -w examples/net-courtyard`; 3 headless Chrome clients against the real server on
localhost, 150 ms and 5 % loss each way, 20 Hz, 10 s of walking; one run): round trip 300 ms measured, loss 4.3 to
7.0 % measured, interpolation delay 106 to 107 ms, 0 corrections against 133 to 139 exact acknowledgements per
client (worst prediction error 0 cm), 949 to 992 B/s down per player, server tick 0.24 ms mean and 0.93 ms max, no
overruns. After the bots stop, every page's own position equals the server's (0.00 mm) and its picture of the
others is within 1.66 mm (the wire's step is 3.9 mm). Host mode in the same run: both members reached the host
over WebRTC, and after the host's browser was closed one member took over with ids kept.

Not measured: real networks, real WebRTC across NATs, browsers other than Chrome, CPU of a hosting page.

## Limits and what is left out

- The walker only: no vehicles, physics props or `@mirage/game` actors are replicated. `@mirage/game` is not wired
  to it; a networked game writes its rules against `createRoom` (as `kit.js` does).
- Dedicated rooms are WebSocket only (no WebRTC in Node, and no dependency was added for it).
- No STUN/TURN is configured; WebRTC was exercised between Chrome instances on one machine only.
- A hosted room ticks on the page's timer: a hidden host tab is throttled to about 1 Hz and the room stalls.
- No encryption or accounts of its own, no persistence, no matchmaking beyond a room list and codes.
- Interpolation only for other players (no extrapolation beyond 100 ms), so they are seen about
  two ticks plus the network delay in the past; `hitscan` compensates for exactly that.
- Types (`index.d.ts`) are hand-written and have not been compiled against a consumer.
