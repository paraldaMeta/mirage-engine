// Mirage original code. The game state: entities + systems, events, flags, an inventory, interactables,
// save / load (versioned JSON in localStorage, export / import), pause. No three.js, no DOM: runs in node.
// ---------------------------------------------------------------------------
// const game = createGame({ id: 'garden-quest', version: 1, migrate: { 1: (s) => s } });
// game.add({ id, pos | object, interact: { label, can?(game), use(game, e) }, update?(dt, game), save?() -> data, load?(data) })
// game.spawn(anchors.lamps, (a, i) => ({ id: 'lamp' + i, pos: a.pos, ... }))   entities from a module's anchors
// game.system((dt, game) => ...)   runs every tick after the entities' update
// game.zone({ id, box: [[x,y,z], [x,y,z]] | sphere: [[x,y,z], r], enter?(game, z), exit?(game, z), once? })   fires as
//   game.player (the character's feet) crosses it, then emits 'zone' { id, inside }; saves keep who is inside
// game.on('flag' | 'inventory' | 'interact' | 'zone' | 'spawn' | 'remove' | 'pause' | 'load' | <your own>, fn); game.emit(type, data)
// game.set(flag, value); game.flags; game.inventory.add({ id, name }) / has(id) / remove(id)
// game.save(slot, extra) / load(slot) / slots() / exportJSON(extra) / importJSON(text)
//
// ponytail: entities are plain objects in a Map and systems plain functions. bitECS (MPL-2.0, 1.7 MB unpacked)
// and Koota (ISC, 0.5 MB, React-leaning) pay off with thousands of entities in typed arrays; a game made of a few
// dozen interactables is clearer, and saves as JSON, without them. Swap in one when entity counts reach ~10^4.
// ---------------------------------------------------------------------------

export function createGame({ id = 'mirage', version = 1, migrate = {}, storage = globalThis.localStorage } = {}) {
  const listeners = new Map(), grave = new Map();
  const key = (slot) => `mirage:${id}:${slot}`;
  const g = {
    id, version, entities: new Map(), systems: [], flags: {}, removed: new Set(), settings: {}, paused: false, time: 0,
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
    emit(type, data) { for (const fn of listeners.get(type) || []) fn(data, g); },
    set(k, value = true) { if (g.flags[k] === value) return; g.flags[k] = value; g.emit('flag', { key: k, value }); },

    add(e) { if (g.removed.has(e.id)) return e; g.entities.set(e.id, e); g.emit('spawn', e); return e; },
    spawn(anchors, make) { return (anchors || []).map((a, i) => g.add(make(a, i))); },
    remove(e) {
      if (typeof e === 'string') e = g.entities.get(e);
      if (!e) return;
      g.entities.delete(e.id); g.removed.add(e.id);
      grave.set(e.id, { e, parent: e.object && e.object.parent });   // an earlier save can bring it back
      if (e.object) e.object.removeFromParent();
      if (e.onRemove) e.onRemove(g);
      g.emit('remove', e);
    },
    system(fn) { g.systems.push(fn); return fn; },
    tick(dt) {
      if (g.paused) return;
      g.time += dt;
      for (const e of g.entities.values()) if (e.update) e.update(dt, g);
      for (const fn of g.systems) fn(dt, g);
      if (g.player) for (const z of g.zones.values()) {
        if (z.fired) continue;
        const inside = inZone(z, g.player);
        if (inside === z.inside) continue;
        z.inside = inside;
        if (inside) { if (z.once) z.fired = true; if (z.enter) z.enter(g, z); } else if (z.exit) z.exit(g, z);
        g.emit('zone', { id: z.id, inside });
      }
    },

    // ---- zones: a box [[min], [max]] or a sphere [[centre], r] around g.player (startGame sets it every tick)
    zones: new Map(), player: null,
    zone(z) { const s = { inside: false, fired: false, ...z }; g.zones.set(z.id, s); return s; },
    pause(on = !g.paused) { if (g.paused === on) return; g.paused = on; g.emit('pause', on); },

    // ---- interactables: the closest one within reach, inside a cone around the view direction
    label: (e) => (typeof e.interact.label === 'function' ? e.interact.label(g, e) : e.interact.label),
    where(e) {
      if (e.interact.at) return e.interact.at(e);
      if (e.pos) return e.pos;
      const p = e.object.getWorldPosition(e.object.position.clone()); return [p.x, p.y, p.z];
    },
    nearest(eye, dir, { reach = 2.4, cone = 0.72 } = {}) {
      let best = null, bs = Infinity;
      for (const e of g.entities.values()) {
        if (!e.interact || (e.interact.can && !e.interact.can(g, e))) continue;
        const p = g.where(e), d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]], l = Math.hypot(...d);
        if (l > (e.interact.reach || reach)) continue;
        const c = l < 0.4 ? 1 : (d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]) / l;
        if (c < cone) continue;
        const s = l * (2 - c);
        if (s < bs) { bs = s; best = e; }
      }
      return best;
    },
    interact(e) { if (!e || !e.interact) return; e.interact.use(g, e); g.emit('interact', e); },

    // ---- inventory
    inventory: {
      items: [],
      has: (iid) => g.inventory.items.some((i) => i.id === iid),
      add(item) { if (!g.inventory.has(item.id)) { g.inventory.items.push(item); g.emit('inventory', { added: item }); } },
      remove(iid) { const i = g.inventory.items.findIndex((x) => x.id === iid); if (i >= 0) g.emit('inventory', { removed: g.inventory.items.splice(i, 1)[0] }); },
    },

    // ---- save / load
    snapshot(extra = {}) {
      const entities = {};
      for (const e of g.entities.values()) if (e.save) entities[e.id] = e.save(g);
      const zones = {};
      for (const z of g.zones.values()) if (z.inside || z.fired) zones[z.id] = { inside: z.inside, fired: z.fired };
      return { v: version, id, at: new Date().toISOString(), time: +g.time.toFixed(2), flags: { ...g.flags }, inventory: g.inventory.items.map((i) => ({ ...i })),
        removed: [...g.removed], entities, zones, settings: g.settings, ...extra };
    },
    restore(s) {
      if (!s || typeof s !== 'object' || typeof s.v !== 'number') throw new Error('not a save');
      if (s.v > version) throw new Error(`save version ${s.v} is newer than this game (${version})`);
      for (let v = s.v; v < version; v++) s = { ...(migrate[v] ? migrate[v](s) : s), v: v + 1 };
      g.flags = { ...s.flags }; g.time = s.time || 0;
      g.inventory.items = (s.inventory || []).map((i) => ({ ...i }));
      const gone = new Set(s.removed || []);
      for (const [rid, { e, parent }] of grave) if (!gone.has(rid)) { grave.delete(rid); g.removed.delete(rid); if (parent) parent.add(e.object); g.add(e); }
      for (const rid of gone) { g.remove(rid); g.removed.add(rid); }
      for (const [eid, data] of Object.entries(s.entities || {})) { const e = g.entities.get(eid); if (e && e.load) e.load(data, g); }
      for (const z of g.zones.values()) Object.assign(z, { inside: false, fired: false }, (s.zones || {})[z.id]);
      if (s.settings) g.settings = s.settings;
      g.emit('inventory', {}); g.emit('load', s);
      return s;
    },
    save(slot = 1, extra) { const s = g.snapshot(extra); storage.setItem(key(slot), JSON.stringify(s)); g.emit('save', { slot, s }); return s; },
    load(slot = 1) { const t = storage.getItem(key(slot)); return t ? g.restore(JSON.parse(t)) : null; },
    slots(n = 3) {
      return Array.from({ length: n }, (_, i) => {
        try { const s = JSON.parse(storage.getItem(key(i + 1))); return s ? { slot: i + 1, at: s.at, time: s.time, summary: s.summary || '' } : { slot: i + 1 }; } catch { return { slot: i + 1, broken: true }; }
      });
    },
    exportJSON: (extra) => JSON.stringify(g.snapshot(extra), null, 1),
    importJSON: (text) => g.restore(JSON.parse(text)),
    saveSettings() { try { storage.setItem(key('settings'), JSON.stringify(g.settings)); } catch { /* private mode */ } },
    loadSettings() { try { return (g.settings = JSON.parse(storage.getItem(key('settings'))) || g.settings); } catch { return g.settings; } },
    reset() { g.flags = {}; g.inventory.items = []; g.removed.clear(); g.time = 0; for (const z of g.zones.values()) Object.assign(z, { inside: false, fired: false }); },
  };
  return g;
}

function inZone(z, p) {
  if (z.box) { const [a, b] = z.box; return p[0] >= a[0] && p[0] <= b[0] && p[1] >= a[1] && p[1] <= b[1] && p[2] >= a[2] && p[2] <= b[2]; }
  const [c, r] = z.sphere;
  return (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 <= r * r;
}
