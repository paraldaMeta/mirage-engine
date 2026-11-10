// Mirage original code.
// ---------------------------------------------------------------------------
// The edit layer: what the editor saves, as plain data next to the plan (plan.edits.json).
//
//   import plan from './plan.js';
//   import edits from './plan.edits.json';
//   const edited = applyEdits(plan, edits);      // the same object back when the layer is empty
//   planHash(edited)                             // 16 hex digits, the same in Node and in the page
//
// A plan file is JavaScript with constants and comments, so the editor never rewrites it: it writes a layer of
// overrides the project applies on load. Five sections, each a flat map (that is what makes every edit one
// { section, key, before, after } and undo trivial):
//   set        plan path -> value          "points.palm": [1, 0, 2]; null removes the key
//   objects    id -> placed object         { type, name, position, rotation (degrees), scale, ...type fields }
//   nodes      scene path -> overrides     "walls/3": { position, rotation, scale, visible, material }
//   env        setting -> value            time, wet, rain, post.exposure, ...
//   timelines  name -> { duration, loop, tracks }
// applyEdits writes `set` into a copy of the plan and derives the fields the engine already reads from the placed
// objects (plan.objects, plan.audio.zones for the audio engine, plan.nav.areas, plan.triggers, plan.spawns,
// plan.lighting for createWorldRenderer({ lighting })). No three.js here: Node tools and checks import this file.
// ---------------------------------------------------------------------------

export const SECTIONS = ['set', 'objects', 'nodes', 'env', 'timelines'];
export const LAYER_VERSION = 1;
const BAD = new Set(['__proto__', 'constructor', 'prototype']);   // a layer is a file from disk: no prototype walks
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const emptyLayer = () => ({ version: LAYER_VERSION, set: {}, objects: {}, nodes: {}, env: {}, timelines: {} });

/** A checked deep copy with every section present. Throws on a shape that is not a layer. */
export function normalizeLayer(layer) {
  if (layer == null) return emptyLayer();
  if (!record(layer)) throw new Error('edit layer: expected an object');
  if (layer.version !== undefined && layer.version !== LAYER_VERSION) throw new Error('edit layer: version ' + layer.version + ' is not supported (this editor writes ' + LAYER_VERSION + ')');
  const out = emptyLayer();
  for (const s of SECTIONS) {
    if (layer[s] === undefined) continue;
    if (!record(layer[s])) throw new Error('edit layer: "' + s + '" must be an object');
    for (const [k, v] of Object.entries(layer[s])) {
      if (BAD.has(k)) throw new Error('edit layer: key "' + k + '" is not allowed');
      if (s === 'set') parsePath(k);
      else if (s !== 'env' && !record(v)) throw new Error('edit layer: ' + s + '.' + k + ' must be an object');
      out[s][k] = clone(v);
    }
  }
  for (const [id, o] of Object.entries(out.objects)) if (typeof o.type !== 'string') throw new Error('edit layer: objects.' + id + ' needs a type');
  return out;
}

export const isEmptyLayer = (layer) => !layer || SECTIONS.every((s) => !layer[s] || Object.keys(layer[s]).length === 0);

/** Deep copy of plain data (arrays and records); anything else (numbers, strings, functions) is kept as is. */
export function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (record(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) { const o = {}; for (const k of Object.keys(v)) o[k] = clone(v[k]); return o; }
  return v;
}

export function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (record(a)) { if (!record(b)) return false; const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k])); }
  return false;
}

/** "points.palm", "viewpoints[2].eye", 'footprints["a b"].rect' -> ['points', 'palm'] ... */
export function parsePath(path) {
  const out = [];
  const re = /(?:^|\.)([A-Za-z_$][\w$-]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/gy;
  let m, end = 0;
  while ((m = re.exec(path))) { out.push(m[1] ?? (m[2] !== undefined ? +m[2] : JSON.parse('"' + m[3] + '"'))); end = re.lastIndex; }
  if (!out.length || end !== path.length) throw new Error('edit layer: bad plan path "' + path + '"');
  for (const k of out) if (BAD.has(k)) throw new Error('edit layer: plan path "' + path + '" is not allowed');
  return out;
}
export const joinPath = (keys) => keys.map((k, i) => typeof k === 'number' ? '[' + k + ']' : /^[A-Za-z_$][\w$-]*$/.test(k) ? (i ? '.' : '') + k : '[' + JSON.stringify(k) + ']').join('');

export function getPath(obj, path) {
  let o = obj;
  for (const k of parsePath(path)) { if (o == null || typeof o !== 'object' || !Object.hasOwn(o, k)) return undefined; o = o[k]; }
  return o;
}
/** Write (or with null / undefined remove) one value; containers on the way are made. Mutates obj. */
export function setPath(obj, path, value) {
  const keys = parsePath(path);
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (o[k] == null || typeof o[k] !== 'object') { if (value == null) return obj; o[k] = typeof keys[i + 1] === 'number' ? [] : {}; }
    o = o[k];
  }
  const last = keys[keys.length - 1];
  if (value == null) { if (Array.isArray(o)) o.splice(last, 1); else delete o[last]; } else o[last] = clone(value);
  return obj;
}

const V = (v, d) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v : d);
/** The axis-aligned box [x0, y0, z0, x1, y1, z1] a placed volume covers (its rotation is not applied: the engine's
 *  zones are axis-aligned). */
export function objectBox(o) {
  const p = V(o.position, [0, 0, 0]), s = V(o.scale, [1, 1, 1]).map(Math.abs);
  return [p[0] - s[0] / 2, p[1] - s[1] / 2, p[2] - s[2] / 2, p[0] + s[0] / 2, p[1] + s[1] / 2, p[2] + s[2] / 2].map((n) => +n.toFixed(4));
}

/** The plan with the layer applied. An empty layer gives the plan object itself back (nothing changes). */
export function applyEdits(plan, layer) {
  if (isEmptyLayer(layer)) return plan;
  layer = normalizeLayer(layer);
  const hasSet = Object.keys(layer.set).length, ids = Object.keys(layer.objects).sort(), tl = Object.keys(layer.timelines);
  if (!hasSet && !ids.length && !tl.length) return plan;
  const out = clone(plan);
  // shallow paths first, so "viewpoints" (a whole array) lands before "viewpoints[1].eye"
  for (const path of Object.keys(layer.set).sort((a, b) => parsePath(a).length - parsePath(b).length)) setPath(out, path, layer.set[path]);
  if (tl.length) out.timelines = { ...(out.timelines || {}), ...layer.timelines };
  if (!ids.length) return out;
  const objects = ids.map((id) => ({ id, ...layer.objects[id] }));
  out.objects = [...(Array.isArray(out.objects) ? out.objects : []), ...objects];
  const of = (type) => objects.filter((o) => o.type === type);
  const named = (o) => o.name || o.id;
  const zones = of('audioZone').map((o) => ({ name: named(o), box: objectBox(o), fade: o.fade ?? 1, ...(o.reverb ? { reverb: o.reverb } : {}), wet: o.wet ?? 0.3 }));
  if (zones.length) out.audio = { ...(out.audio || {}), zones: [...(out.audio?.zones || []), ...zones] };
  const sounds = of('sound').map((o) => ({ name: named(o), url: o.url || '', position: V(o.position, [0, 0, 0]), radius: o.radius ?? 8, volume: o.volume ?? 1, loop: o.loop !== false }));
  if (sounds.length) out.audio = { ...(out.audio || {}), emitters: [...(out.audio?.emitters || []), ...sounds] };
  const areas = of('nav').map((o) => ({ name: named(o), box: objectBox(o), area: o.area || 'walk', cost: o.cost ?? 1 }));
  if (areas.length) out.nav = { ...(out.nav || {}), areas: [...(out.nav?.areas || []), ...areas] };
  const triggers = of('trigger').map((o) => ({ name: named(o), box: objectBox(o), event: o.event || named(o), once: !!o.once }));
  if (triggers.length) out.triggers = [...(out.triggers || []), ...triggers];
  const spawns = of('spawnPoint').map((o) => ({ name: named(o), position: V(o.position, [0, 0, 0]), yaw: V(o.rotation, [0, 0, 0])[1], ...(o.team ? { team: o.team } : {}) }));
  if (spawns.length) out.spawns = [...(out.spawns || []), ...spawns];
  const probes = of('probe').map((o) => { const b = objectBox(o); return { min: b.slice(0, 3), max: b.slice(3), position: V(o.position, [0, 0, 0]), fade: o.fade ?? 1 }; });
  const gi = of('gi')[0];
  if (probes.length || gi) {
    out.lighting = { ...(out.lighting || {}) };
    if (probes.length) out.lighting.probes = [...(out.lighting.probes || []), ...probes];
    if (gi) { const b = objectBox(gi); out.lighting.gi = { min: b.slice(0, 3), max: b.slice(3), spacing: gi.spacing ?? 2 }; }
  }
  return out;
}

/** JSON with sorted keys: the same text for the same data whatever order it was built in. */
export function stableStringify(v, indent) {
  const sort = (x) => Array.isArray(x) ? x.map(sort) : record(x) ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined && typeof x[k] !== 'function').map((k) => [k, sort(x[k])])) : (typeof x === 'number' && !Number.isFinite(x) ? null : x);
  return JSON.stringify(sort(v), null, indent);
}
const fnv = (s, h) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
/** 16 hex digits over the plan's data (functions and undefined are left out, key order does not matter). */
export function planHash(plan) { const s = stableStringify(plan); return fnv(s, 0x811c9dc5) + fnv(s, 0x9747b28c); }

/** What is written to disk: sections in a fixed order, empty ones left out, two-space JSON and a newline. */
export function serializeLayer(layer) {
  const n = normalizeLayer(layer), out = { version: LAYER_VERSION };
  for (const s of SECTIONS) if (Object.keys(n[s]).length) out[s] = Object.fromEntries(Object.keys(n[s]).sort().map((k) => [k, n[s][k]]));
  return JSON.stringify(out, null, 2) + '\n';
}
