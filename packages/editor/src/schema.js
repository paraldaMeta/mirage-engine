// Mirage original code.
// ---------------------------------------------------------------------------
// What the inspector shows: typed fields, generated from data instead of written per panel.
//
//   fieldsFromSchema(planSchema, schemaAt(planSchema, 'points.palm'), [1, 0, 2])
//     -> [{ path: '', type: 'vector', labels: ['x', 'y', 'z'] }]
//   OBJECT_TYPES.light.fields          // the placed-object types and their fields
//   planElements(plan)                 // every plan entry the editor can select: points, shapes, paths, views
//   elementPose / elementMoved / elementScaled   // how a gizmo edits a plan entry (pure array maths)
//
// Field types: number (drag), vector, color, enum, bool, string, asset (a picker), points (a list of [x, z]),
// json (anything else, edited as text). Plan fields come from @miragekit/world's plan.schema.json; a world's own
// fields, which the schema does not know, are typed from their value. No three.js, no DOM.
// ---------------------------------------------------------------------------
import { parsePath, joinPath, clone } from './layer.js';

const num = (min, max, step) => ({ type: 'number', min, max, step });
const VOLUME = [1, 1, 1];
/** The placed-object types. `volume`: drawn as a box whose size is `scale`. `defaults` are merged into a new object. */
export const OBJECT_TYPES = {
  model: { label: 'Model', defaults: { url: '', collide: true }, fields: [{ key: 'url', type: 'asset', kind: 'model' }, { key: 'collide', type: 'bool' }] },
  primitive: { label: 'Primitive', defaults: { shape: 'box', color: '#b9ab98', roughness: 0.85, metalness: 0, collide: true },
    fields: [{ key: 'shape', type: 'enum', options: ['box', 'sphere', 'cylinder', 'plane'] }, { key: 'color', type: 'color' }, { key: 'roughness', ...num(0, 1, 0.01) }, { key: 'metalness', ...num(0, 1, 0.01) },
      { key: 'map', type: 'asset', kind: 'texture' }, { key: 'collide', type: 'bool' }] },
  wall: { label: 'Wall', defaults: { points: [[0, 0], [3, 0]], height: 2.4, thickness: 0.3, color: '#b9ab98', collide: true },
    fields: [{ key: 'height', ...num(0.1, 50, 0.05) }, { key: 'thickness', ...num(0.05, 5, 0.01) }, { key: 'color', type: 'color' }, { key: 'points', type: 'points' }, { key: 'collide', type: 'bool' }] },
  light: { label: 'Light', defaults: { kind: 'point', color: '#ffd9a8', intensity: 30, distance: 12, angle: 40, penumbra: 0.4, shadow: false },
    fields: [{ key: 'kind', type: 'enum', options: ['point', 'spot'] }, { key: 'color', type: 'color' }, { key: 'intensity', ...num(0, 2000, 0.5) }, { key: 'distance', ...num(0, 200, 0.1) },
      { key: 'angle', ...num(1, 89, 0.5), when: (o) => o.kind === 'spot' }, { key: 'penumbra', ...num(0, 1, 0.01), when: (o) => o.kind === 'spot' }, { key: 'shadow', type: 'bool' }] },
  probe: { label: 'Reflection probe', volume: true, reload: true, defaults: { scale: [6, 4, 6], fade: 1 }, fields: [{ key: 'fade', ...num(0, 10, 0.05) }] },
  gi: { label: 'GI volume', volume: true, reload: true, defaults: { scale: [12, 5, 12], spacing: 2 }, fields: [{ key: 'spacing', ...num(0.5, 10, 0.25) }] },
  audioZone: { label: 'Audio zone', volume: true, defaults: { scale: [6, 4, 6], fade: 1, reverb: '', wet: 0.3 },
    fields: [{ key: 'fade', ...num(0, 20, 0.05) }, { key: 'reverb', type: 'enum', options: ['', 'room', 'hall', 'cave', 'outdoor'] }, { key: 'wet', ...num(0, 1, 0.01) }] },
  sound: { label: 'Sound', defaults: { url: '', volume: 1, radius: 8, loop: true },
    fields: [{ key: 'url', type: 'asset', kind: 'audio' }, { key: 'volume', ...num(0, 4, 0.01) }, { key: 'radius', ...num(0.1, 200, 0.1) }, { key: 'loop', type: 'bool' }] },
  vfx: { label: 'VFX emitter', defaults: { effect: 'fire' }, fields: [{ key: 'effect', type: 'asset', kind: 'vfx' }] },
  nav: { label: 'Nav area', volume: true, defaults: { scale: [4, 2, 4], area: 'walk', cost: 1 }, fields: [{ key: 'area', type: 'enum', options: ['walk', 'slow', 'blocked'] }, { key: 'cost', ...num(0, 100, 0.1) }] },
  trigger: { label: 'Trigger volume', volume: true, defaults: { scale: [3, 2.5, 3], event: '', once: false }, fields: [{ key: 'event', type: 'string' }, { key: 'once', type: 'bool' }] },
  spawnPoint: { label: 'Spawn point', defaults: { team: '' }, fields: [{ key: 'team', type: 'string' }] },
};
/** The fields every placed object has. */
export const COMMON_FIELDS = [
  { key: 'name', type: 'string' },
  { key: 'position', type: 'vector', labels: ['x', 'y', 'z'], step: 0.05 },
  { key: 'rotation', type: 'vector', labels: ['x', 'y', 'z'], step: 1, unit: '°' },
  { key: 'scale', type: 'vector', labels: ['x', 'y', 'z'], step: 0.05 },
];
/** A new object of a type: its defaults plus a pose. */
export function newObject(type, at = [0, 0, 0], extra = {}) {
  const T = OBJECT_TYPES[type];
  if (!T) throw new Error('editor: no object type "' + type + '"');
  return { type, name: '', position: at.map((n) => +(+n).toFixed(4)), rotation: [0, 0, 0], scale: [...VOLUME], ...clone(T.defaults), ...clone(extra) };
}
export function objectFields(o) {
  const T = OBJECT_TYPES[o.type];
  return [...COMMON_FIELDS, ...(T ? T.fields.filter((f) => !f.when || f.when(o)) : [])].map((f) => ({ path: f.key, label: f.key, ...f }));
}

// ---- JSON schema -> fields
const VEC_LABELS = { xz: ['x', 'z'], xyz: ['x', 'y', 'z'], rect: ['x0', 'z0', 'x1', 'z1'], circle: ['x', 'z', 'r'] };
const deref = (root, node) => { let name; while (node && node.$ref) { name = node.$ref.slice('#/$defs/'.length); node = root.$defs[name]; } return [node, name]; };
/** The schema node a plan path points at, or null where the schema says nothing (a world's own field). */
export function schemaAt(root, path) {
  let node = root;
  for (const k of parsePath(path)) {
    [node] = deref(root, node);
    if (!node) return null;
    node = typeof k === 'number' ? (node.prefixItems?.[k] ?? node.items) : (node.properties?.[k] ?? (node.properties ? null : node.additionalProperties));
    if (!node || node === true) return null;
  }
  return node;
}
const isNums = (v, n) => Array.isArray(v) && (n ? v.length === n : v.length >= 2 && v.length <= 4) && v.every((x) => typeof x === 'number');
const isPoints = (v) => Array.isArray(v) && v.length > 0 && v.every((p) => isNums(p, 2));
// a field for a value the schema does not describe
function infer(value, path, label) {
  if (typeof value === 'number') return [{ path, label, type: 'number', step: 0.05 }];
  if (typeof value === 'boolean') return [{ path, label, type: 'bool' }];
  if (typeof value === 'string') return [{ path, label, type: /^#[0-9a-f]{6}$/i.test(value) ? 'color' : 'string' }];
  if (isNums(value)) return [{ path, label, type: 'vector', labels: (VEC_LABELS[{ 2: 'xz', 3: 'xyz', 4: 'rect' }[value.length]]), step: 0.05 }];
  if (isPoints(value)) return [{ path, label, type: 'points' }];
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.keys(value).flatMap((k) => infer(value[k], path ? path + '.' + k : k, label ? label + '.' + k : k));
  return [{ path, label, type: 'json' }];
}
/** Flat field list for `value` under schema `node`: [{ path (inside value, '' = the value itself), label, type, ... }]. */
export function fieldsFromSchema(root, node, value, path = '', label = '') {
  let name;
  [node, name] = deref(root, node);
  if (!node) return infer(value, path, label);
  if (node.enum) return [{ path, label, type: 'enum', options: [...node.enum] }];
  if (node.const !== undefined) return [{ path, label, type: 'enum', options: [node.const], readonly: true }];
  const type = [].concat(node.type || [])[0];
  if (type === 'number') return [{ path, label, type: 'number', step: 0.05, ...(node.exclusiveMinimum !== undefined ? { min: node.exclusiveMinimum + 0.001 } : {}) }];
  if (type === 'string') return [{ path, label, type: 'string' }];
  if (type === 'array') {
    const [item, itemName] = deref(root, node.items || node.prefixItems?.[0]);
    if (node.minItems !== undefined && node.minItems === node.maxItems && [].concat(item?.type)[0] === 'number') return [{ path, label, type: 'vector', labels: VEC_LABELS[name] || VEC_LABELS[{ 2: 'xz', 3: 'xyz', 4: 'rect' }[node.minItems]], step: 0.05 }];
    if (itemName === 'xz') return [{ path, label, type: 'points', min: node.minItems || 0 }];
    return [{ path, label, type: 'json' }];
  }
  if (type === 'object') {
    const out = [], props = node.properties || {}, v = value && typeof value === 'object' ? value : {};
    const sub = (k) => [path ? path + '.' + k : k, label ? label + '.' + k : k];
    for (const [k, child] of Object.entries(props)) {
      const [c] = deref(root, child), scalar = c && (c.enum || ['number', 'string'].includes([].concat(c.type || [])[0]));
      // a shape has one of rect / circle / poly: show what is there, and the optional scalars (y, width, mode)
      if (Object.hasOwn(v, k) || (scalar && c.const === undefined) || node.required?.includes(k)) out.push(...fieldsFromSchema(root, child, v[k], ...sub(k)).map((f) => ({ ...f, optional: !node.required?.includes(k) && !Object.hasOwn(v, k) })));
    }
    for (const k of Object.keys(v)) if (!Object.hasOwn(props, k)) out.push(...infer(v[k], ...sub(k)));
    return out;
  }
  return infer(value, path, label);
}

// ---- the plan's own entries
const VIEW_KEYS = ['spawn', 'gameView'];
/** Everything in a plan the editor can select: [{ id, path, group, kind, label }]. kind: point | shape | path | view. */
export function planElements(plan) {
  const out = [], add = (path, group, kind, label) => out.push({ id: 'plan:' + path, path, group, kind, label });
  for (const k of Object.keys(plan.points || {})) if (isNums(plan.points[k], 3)) add(joinPath(['points', k]), 'points', 'point', k);
  for (const g of ['footprints', 'regions']) for (const k of Object.keys(plan[g] || {})) add(joinPath([g, k]), g, 'shape', k);
  for (const k of Object.keys(plan.paths || {})) add(joinPath(['paths', k]), 'paths', 'path', k);
  (plan.viewpoints || []).forEach((v, i) => add('viewpoints[' + i + ']', 'viewpoints', 'view', v.name || 'view ' + i));
  for (const k of VIEW_KEYS) if (plan[k]) add(k, 'views', 'view', k);
  return out;
}
const mean = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
/** Where a plan entry sits: { position: [x, y, z], size: [sx, sz] | null }. */
export function elementPose(kind, v) {
  if (kind === 'point') return { position: [...v], size: null };
  if (kind === 'view') return { position: [...v.eye], size: null };
  if (kind === 'path') { const c = mean(v.points); return { position: [c[0], v.y ?? 0, c[1]], size: null }; }
  const y = v.y ?? 0;
  if (v.rect) return { position: [(v.rect[0] + v.rect[2]) / 2, y, (v.rect[1] + v.rect[3]) / 2], size: [v.rect[2] - v.rect[0], v.rect[3] - v.rect[1]] };
  if (v.circle) return { position: [v.circle[0], y, v.circle[1]], size: [v.circle[2] * 2, v.circle[2] * 2] };
  const c = mean(v.poly || [[0, 0]]); return { position: [c[0], y, c[1]], size: null };
}
const r4 = (n) => +n.toFixed(4);
/** The entry moved by [dx, dy, dz] (a new value; a view's look target moves with its eye). */
export function elementMoved(kind, v, [dx, dy, dz]) {
  const xz = (p) => [r4(p[0] + dx), r4(p[1] + dz)], xyz = (p) => [r4(p[0] + dx), r4(p[1] + dy), r4(p[2] + dz)];
  if (kind === 'point') return xyz(v);
  const out = clone(v);
  if (kind === 'view') { out.eye = xyz(v.eye); out.look = xyz(v.look); return out; }
  if (dy && (v.y !== undefined || kind !== 'view')) out.y = r4((v.y ?? 0) + dy);
  if (kind === 'path') out.points = v.points.map(xz);
  else if (v.rect) out.rect = [...xz(v.rect), ...xz(v.rect.slice(2))];
  else if (v.circle) out.circle = [...xz(v.circle), v.circle[2]];
  else if (v.poly) out.poly = v.poly.map(xz);
  return out;
}
/** The entry scaled by [fx, fz] about its own centre (points and views have no size and come back unchanged). */
export function elementScaled(kind, v, [fx, fz]) {
  if (kind === 'point' || kind === 'view') return clone(v);
  const { position: [cx, , cz] } = elementPose(kind, v), out = clone(v);
  const xz = (p) => [r4(cx + (p[0] - cx) * fx), r4(cz + (p[1] - cz) * fz)];
  if (kind === 'path') out.points = v.points.map(xz);
  else if (v.rect) { const a = xz(v.rect), b = xz(v.rect.slice(2)); out.rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; }
  else if (v.circle) out.circle = [v.circle[0], v.circle[1], r4(Math.max(0.01, v.circle[2] * Math.max(Math.abs(fx), Math.abs(fz))))];
  else if (v.poly) out.poly = v.poly.map(xz);
  return out;
}
