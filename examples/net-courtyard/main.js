// net-courtyard: hello-courtyard's world (its plan, modules and textures, imported from next door) walked by several
// players at once with @mirage/net: each sees the others' characters with their names, the lanterns are shared (the
// first to reach one gets the point) and there is a text chat. Start it with `npm run build && npm run serve`, then
// open the printed address in two windows. docs/multiplayer.md has the whole story.
// URL: ?name=Ada   ?room=CODE (default YARD, the server's own room)
//      ?host=1     this page runs the room ("host mode"); the code to give others is shown top right
//      ?rtc=0      host mode over the lobby's relay only, no WebRTC data channel
//      ?server=127.0.0.1:8787   the lobby, when the page is not served by mirage-net (vite dev: add --origin there)
//      ?overlay=1  the debug overlay   ?latency=ms &loss=0..1 &jitter=ms   a bad network on this page's connection
//                  (with the overlay: keys [ ] change latency, - = loss, 0 clears)
//      ?mode=walk | game   ?bot=1 (walks by itself: the browser check)   ?quality= ?w= ?h= ?spp= ?ui=0
import * as THREE from 'three';
import { createWorldRenderer, createTextures, pickQuality, setRelief } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import { createPlay, createCharacter } from '@mirage/play';
import { connectLobby, joinRoom, hostRoom, deserializeGrid, createNetOverlay } from '@mirage/net';
import manifest from '../hello-courtyard/tex/manifest.json';
import plan from '../hello-courtyard/plan.js';
import modules from '../hello-courtyard/modules/index.js';
import { protocol, spawn, setup, tickRate } from './game.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const $ = (id) => document.getElementById(id);
const canvas = document.querySelector('canvas');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const quality = Q.get('quality') || (await pickQuality()).quality;
setRelief({ low: 0, medium: 0.7, high: 1 }[quality] ?? 1);
const world = createWorldRenderer({ quality, canvas, width: W, height: H, place: { lat: 35.01, lon: 135.77, height: 50, tzHours: 9 }, time: 'golden', preserveDrawingBuffer: true,
  shadow: { center: [0, 2, 0], radius: 17 }, envProbe: [0, 2.2, 0], fog: { groundDensity: 0.0022, height: 30 }, post: { grain: 0.012, focus: 9 } });
const urls = import.meta.glob('../hello-courtyard/tex/*.webp', { eager: true, query: '?url', import: 'default' });
const tex = createTextures(world, { manifest, url: (f) => urls['../hello-courtyard/tex/' + f] });
const built = await buildWorld(world, { plan, modules: modules(), shared: { tex, detail: true } });
const { camera } = world;
camera.aspect = W / H; camera.fov = 48; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await tex.ready();
await world.prepare();

// ---- the room ---------------------------------------------------------------
// The grid is the file the server loaded (mirage-net bake wrote it from hello-courtyard's GPU bake): every player
// and the server walk on the same bits, which is what makes prediction exact.
const grid = deserializeGrid(new Uint8Array(await (await fetch('./grid.bin')).arrayBuffer()));
const name = (Q.get('name') || 'guest' + Math.floor(Math.random() * 900 + 100)).slice(0, 24);
const conditions = Q.has('latency') || Q.has('loss') || Q.has('jitter') || Q.has('overlay') ? { latency: +Q.get('latency') || 0, loss: +Q.get('loss') || 0, jitter: +Q.get('jitter') || 0 } : null;
const status = (text) => { $('status').textContent = text; };
const net = { session: null, client: null, error: '', chat: [], took: [] };
try {
  const lobby = await connectLobby(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${Q.get('server') || location.host}/net`);
  const o = { lobby, protocol, grid, name, spawn, setup, tickRate, rtc: Q.get('rtc') !== '0', conditions };
  net.session = Q.has('host') ? await hostRoom({ ...o, roomName: name + "'s room" }) : await joinRoom({ ...o, code: Q.get('room') || 'YARD' });
  net.client = net.session.client;
} catch (e) { net.error = e.message; status('offline: ' + e.message + ' (npm run serve)'); }
const { session, client } = net;

const spp = +Q.get('spp') || 4, mode = Q.get('mode') || 'walk';
const bot = Q.has('bot') && { t: 0, turn: 0, seed: [...name].reduce((a, c) => a + c.charCodeAt(0), 0) };
const others = new Map(), lanterns = new Map(), asked = new Map();
let labelAt = 0, overlay = null;
const play = createPlay(world, { plan: built.plan, grid, canvas, mode, spp, ui: Q.get('ui') !== '0', fit: !Q.get('w'), quality, hud: Q.get('hud') !== '0',
  ...(client ? { walker: client.walker } : {}),
  // the bot: forward, turning now and then, a jump here and there. Its "keys" go the same way a player's do.
  ...(bot ? { input: (dt) => { if (net.still) return { x: 0, z: 0, run: false, jump: false }; bot.t += dt; if (bot.t > bot.turn) { bot.turn = bot.t + 1.2 + ((bot.seed * 7 + Math.floor(bot.t)) % 5) * 0.3; play.yaw += 1.1 + (bot.seed % 3) * 0.5; } return { x: 0, z: 1, run: Math.floor(bot.t / 3) % 2 === 1, jump: Math.floor(bot.t * 2) % 9 === 0 }; } } : {}),
  onStep: client ? step : undefined });

// ---- everyone else, the lanterns, the labels ---------------------------------
const lanternGeo = new THREE.OctahedronGeometry(0.16), lanternMat = world.mat.std({ color: 0x1a1206, emissive: new THREE.Color(1, 0.62, 0.22), emissiveIntensity: 6, roughness: 0.4 });
function step(dt) {
  let moved = false;
  client.input.yaw = play.yaw;
  if (play.mode !== 'walk' && play.mode !== 'game') client.update();   // walking, play calls it through client.walker
  for (const e of client.entities.values()) {
    const s = e.state;
    if (e.name === 'pickup') {
      let m = lanterns.get(e.id);
      if (!m) { m = new THREE.Mesh(lanternGeo, lanternMat); m.position.set(s.x, s.y + 0.95, s.z); world.scene.add(m); lanterns.set(e.id, m); moved = true; }
      if (m.visible === !!s.taken) { m.visible = !s.taken; moved = true; }
      // walking into a lantern asks for it; the server decides who was first (and whether we are really that close)
      const p = client.walker.pos, t = performance.now();
      if (!s.taken && Math.hypot(s.x - p[0], s.z - p[2]) < 1.2 && t - (asked.get(e.id) || 0) > 400) { asked.set(e.id, t); client.rpc('take', { id: e.id }); }
    } else if (e.name === 'player' && !e.own) {
      let o = others.get(e.id);
      if (!o) {
        const avatar = createCharacter(world, { palette: { jacket: [0x7a4b3a, 0x3d5a80, 0x6b705c, 0x8d5b9a, 0xa8763e][e.id % 5] } });
        const label = document.createElement('div'); $('labels').appendChild(label);
        o = { avatar, label, text: '', x: s.x, y: s.y, z: s.z }; avatar.root.position.set(s.x, s.y, s.z); world.scene.add(avatar.root); others.set(e.id, o); moved = true;
      }
      const d = Math.hypot(s.x - o.x, s.z - o.z), heading = Math.PI / 2 - s.yaw;
      if (d > 1e-4 || Math.abs(s.y - o.y) > 1e-4 || Math.abs(heading - o.avatar.root.rotation.y) > 1e-3) moved = true;
      if (o.avatar.update(dt, { distance: d, run: !!s.run, onGround: !!s.onGround, verticalSpeed: dt > 0 ? (s.y - o.y) / dt : 0 })) moved = true;
      o.avatar.root.position.set(s.x, s.y, s.z); o.avatar.root.rotation.y = heading;
      o.x = s.x; o.y = s.y; o.z = s.z;
      const text = `${s.name}${s.away ? ' (away)' : ''} · ${s.score}`;
      if (text !== o.text) o.label.textContent = o.text = text;   // textContent: a name is never markup
    }
  }
  for (const [id, o] of others) if (!client.entities.has(id)) { o.avatar.dispose(); o.label.remove(); others.delete(id); moved = true; }
  for (const [id, m] of lanterns) if (!client.entities.has(id)) { m.removeFromParent(); lanterns.delete(id); moved = true; }
  // labels above the heads, through whichever camera is drawing
  const cam = play.mode === 'game' ? play.gameCam : camera, v = new THREE.Vector3();
  for (const o of others.values()) {
    v.set(o.x, o.y + 2.0, o.z).project(cam);
    const on = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    o.label.style.display = on ? '' : 'none';
    if (on) { o.label.style.left = ((v.x + 1) / 2 * W).toFixed(1) + 'px'; o.label.style.top = ((1 - v.y) / 2 * H).toFixed(1) + 'px'; }
  }
  overlay?.update();
  const t = performance.now();
  if (t - labelAt > 500) {
    labelAt = t;
    const how = session.mode === 'host' ? (session.room ? 'hosting' : 'in a hosted room') : 'on the server';
    status(client.status === 'joined' ? `${client.name} · room ${session.lobby.code || client.code} (${how}${client.transport?.kind === 'webrtc' ? ', webrtc' : ''}) · ${client.entities.size ? [...client.entities.values()].filter((e) => e.name === 'player').length : 1} here · lanterns ${client.me?.state.score ?? 0}` : client.kicked ? 'removed: ' + client.kicked : client.status + '…');
  }
  return moved;
}
if (client && Q.has('overlay')) overlay = createNetOverlay(client, { conditions: session.conditions, session });

// ---- chat ------------------------------------------------------------------
const say = $('say'), log = $('log');
const line = (text) => { const d = document.createElement('div'); d.textContent = text; log.appendChild(d); while (log.childElementCount > 7) log.firstChild.remove(); };
const who = (id) => (id === client.id ? client.name : client.entities.get(id)?.state.name || 'player ' + id);
if (client) {
  client.on('chat', ({ from, text }) => { net.chat.push({ from, text }); line(`${who(from)}: ${text}`); });
  client.on('took', ({ by, id }) => { net.took.push({ by, id }); line(`${who(by)} took a lantern`); });
  addEventListener('keydown', (e) => { if (e.code === 'Enter' && document.activeElement !== say) { e.preventDefault(); say.focus(); } });
  say.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') { const text = say.value.trim(); if (text) client.rpc('chat', { text }); say.value = ''; say.blur(); }
    else if (e.code === 'Escape') say.blur();
    e.stopPropagation();
  });
  session.lobby.onclose = () => status('the server went away');
} else $('chat').style.display = 'none';

window.__mirage = { world, tex, built, play, net, overlay, render: (o = {}) => world.renderFrame(o.T ?? 0, { spp, frameIndex: 1, ...o }) };
window.__READY = true;
