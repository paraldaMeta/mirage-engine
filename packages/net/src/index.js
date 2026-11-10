// Mirage original code.
// Everything here runs in a browser and in Node. The Node server is '@mirage/net/server' (and '@mirage/net/ws'):
// it imports node:http, so it is not in this file.
export { createLoopbackNetwork, conditioned, webSocketTransport } from './transport.js';
export { rtcTransport, preferTransport } from './rtc.js';
export { createChannel } from './channel.js';
export { defineProtocol, field } from './schema.js';
export { serializeGrid, deserializeGrid, bakeGridCPU, boxTriangles, sceneTriangles } from './grid.js';
export { createRoom } from './room.js';
export { createClient } from './client.js';
export { connectLobby } from './lobby.js';
export { joinRoom, hostRoom } from './host.js';
export { kitProtocol, installKit } from './kit.js';
export { createNetOverlay } from './overlay.js';
