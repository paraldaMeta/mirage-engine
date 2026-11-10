// Mirage original code.
// ---------------------------------------------------------------------------
// A small game on top of a room, for the example and as a pattern to copy: shared pickups, text chat and a
// lag-compensated "tag". The SAME file runs on the server (or the hosting page) and names the protocol the
// clients use, so the two cannot drift apart.
//
//   const protocol = kitProtocol({ bounds: plan.bounds, y: [-2, 12] });
//   const kit = installKit(room, { pickups: [[2, 0, 3], [-4, 0, 1]], respawnMs: 8000 });   // where the room runs
//   client.rpc('take', { id });  client.rpc('chat', { text });  client.rpc('tag', { dx, dy, dz });
//   client.on('chat', ({ from, text }) => {});  client.on('took', ({ by, id }) => {});  client.on('tagged', ({ by, target }) => {});
//
// Every rule is decided here, from the server's own state: a pickup is taken only if the SERVER's position of the
// player is within `reach` of it and it is not already taken (two players asking in the same tick: the first
// message wins, the second gets nothing); chat is cleaned and limited to one line every 400 ms; a tag is a ray
// from the server's position of the shooter against where the others were on the shooter's screen (room.hitscan).
// ---------------------------------------------------------------------------
import { defineProtocol, field } from './schema.js';
import { cleanText } from './wire.js';

export const kitProtocol = ({ bounds, y, version = 1 } = {}) => defineProtocol({
  bounds, y, version,
  player: [field.u('score', 10), field.u('tagged', 8)],
  entities: { pickup: [field.pos(), field.u('kind', 3), field.bool('taken')] },
  rpcs: { chat: [field.str('text', 160)], take: [field.u('id', 16)], tag: [field.q('dx', -1, 1, 1 / 512), field.q('dy', -1, 1, 1 / 512), field.q('dz', -1, 1, 1 / 512)] },
  events: { chat: [field.u('from', 16), field.str('text', 160)], took: [field.u('by', 16), field.u('id', 16)], tagged: [field.u('by', 16), field.u('target', 16)] },
});

export function installKit(room, { pickups = [], reach = 1.6, respawnMs = 8000, chatMs = 400, tagRange = 30, restored = false } = {}) {
  const kit = { pickups: [], taken: 0, chats: 0, tags: 0 };
  // after a host migration the pickups came back with the room's state: find them instead of making more
  if (restored) for (const e of room.entities.values()) { if (e.type.name === 'pickup') { kit.pickups.push(e); if (e.get('taken')) e.data = { back: room.time + respawnMs }; } }
  else pickups.forEach((p, i) => kit.pickups.push(room.spawn('pickup', { x: p[0], y: p[1], z: p[2], kind: i % 8, taken: false })));
  room.rpc('take', (player, { id }) => {
    const e = room.entities.get(id), w = player.walker.pos;
    if (!e || e.type.name !== 'pickup' || e.get('taken')) return;
    if (Math.hypot(e.p[0] - w[0], e.p[1] - w[1], e.p[2] - w[2]) > reach) return;   // the server's position, not the client's word
    e.set({ taken: true }); e.data = { back: room.time + respawnMs };
    player.ent.set({ score: Math.min(1023, player.ent.get('score') + 1) });
    kit.taken++;
    room.emit('took', { by: player.id, id });
  });
  room.rpc('chat', (player, { text }) => {
    const t = cleanText(text, 160), d = player.data;
    if (!t || room.time - (d.chatAt ?? -1e9) < chatMs) return;
    d.chatAt = room.time; kit.chats++;
    room.emit('chat', { from: player.id, text: t });
  });
  room.rpc('tag', (player, { dx, dy, dz }, ctx) => {
    const d = player.data;
    if (room.time - (d.tagAt ?? -1e9) < 500) return;
    d.tagAt = room.time;
    const hit = room.hitscan(player, { dir: [dx, dy, dz], range: tagRange, time: ctx.viewTime, filter: (e) => e.type.name === 'player' });
    if (!hit?.player) return;
    hit.entity.set({ tagged: (hit.entity.get('tagged') + 1) & 255 }); kit.tags++;
    room.emit('tagged', { by: player.id, target: hit.player.id });
  });
  room.onTick(() => { for (const e of kit.pickups) if (e.data && room.time >= e.data.back) { e.data = null; e.set({ taken: false }); } });   // taken pickups come back
  return kit;
}
