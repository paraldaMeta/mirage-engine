// Mirage original code.
// The effect description format of the particle system: plain JSON in, a validated and fully-defaulted copy out.
// Nothing here touches the GPU, so an agent or an editor can author, diff, store and check effects in Node.
//
//   import { defineEffect, bakeCurves } from '@mirage/core';
//   const fx = defineEffect({ name: 'puff', rate: 40, life: [0.8, 1.4], shape: { type: 'sphere', radius: 0.2 },
//     velocity: { dir: [0, 1, 0], speed: [0.5, 1], spread: 25 }, gravity: -0.4, drag: 0.8,
//     size: [0.2, 0.4], sizeOverLife: [[0, 0.3], [1, 1.6]], color: [[0, '#ffffff'], [1, '#606060']],
//     alpha: [[0, 0], [0.1, 0.6], [1, 0]], render: { blend: 'alpha', lit: 1, soft: 0.3 } });
//
// Value forms, the same everywhere: a number is a constant, `[a, b]` a per-particle random range, `[[t, v], ...]`
// a curve over normalised life (piecewise linear, t in 0..1) and a gradient is `[[t, '#rrggbb' | [r, g, b]], ...]`
// in sRGB. An effect is one emitter, or `{ name, emitters: [...] }` for several layers that spawn together.
// Unknown keys throw, with the path of the key: a typo must not become a silently ignored setting.

const SHAPES = ['point', 'sphere', 'box', 'cone', 'ring', 'edge', 'mesh'];
const BLENDS = ['alpha', 'add', 'premultiplied'];
const TYPES = ['billboard', 'stretched', 'horizontal', 'mesh'];
const SPRITES = ['soft', 'disc', 'ring', 'spark', 'star', 'leaf', 'flake', 'drop'];
const SORTS = ['none', 'oldest', 'youngest', 'distance'];
const EVENTS = ['birth', 'death', 'collision', 'life'];
const MODES = ['bounce', 'kill', 'stick'];
export const VFX_LUT_W = 64;
export const VFX_ENUMS = { SHAPES, BLENDS, TYPES, SPRITES, SORTS, EVENTS, MODES };

const fail = (path, msg) => { throw new TypeError(`defineEffect: ${path} ${msg}`); };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function keys(o, allowed, path) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) fail(path, 'must be an object');
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${path}.${k}`, `is not a known key (known: ${allowed.join(', ')})`);
}
const num = (v, d, path, lo = -Infinity, hi = Infinity) => {
  if (v === undefined) return d;
  if (!isNum(v)) fail(path, 'must be a finite number');
  return Math.min(hi, Math.max(lo, v));
};
const range = (v, d, path) => {
  if (v === undefined) v = d;
  if (isNum(v)) return [v, v];
  if (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])) return [Math.min(v[0], v[1]), Math.max(v[0], v[1])];
  fail(path, 'must be a number or [min, max]');
};
const vec3 = (v, d, path) => {
  if (v === undefined) return d.slice();
  if (Array.isArray(v) && v.length === 3 && v.every(isNum)) return v.slice();
  fail(path, 'must be [x, y, z]');
};
const pick = (v, list, d, path) => {
  if (v === undefined) return d;
  if (!list.includes(v)) fail(path, `must be one of ${list.join(', ')}`);
  return v;
};
const curve = (v, d, path) => {
  if (v === undefined) v = d;
  if (isNum(v)) return [[0, v], [1, v]];
  if (Array.isArray(v) && v.length && v.every((k) => Array.isArray(k) && k.length === 2 && isNum(k[0]) && isNum(k[1]))) {
    return v.map((k) => [Math.min(1, Math.max(0, k[0])), k[1]]).sort((a, b) => a[0] - b[0]);
  }
  fail(path, 'must be a number or a curve [[t, v], ...]');
};
/** '#rgb' / '#rrggbb' / [r, g, b] (sRGB 0..1) to linear [r, g, b] */
export function parseColor(c, path = 'color') {
  let rgb;
  if (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) {
    const h = c.length === 4 ? c.slice(1).replace(/./g, '$&$&') : c.slice(1);
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  } else if (Array.isArray(c) && c.length === 3 && c.every(isNum)) rgb = c;
  else fail(path, "must be '#rrggbb' or [r, g, b]");
  return rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
}
const gradient = (v, d, path) => {
  if (v === undefined) v = d;
  if (typeof v === 'string' || (Array.isArray(v) && v.length === 3 && v.every(isNum))) v = [[0, v], [1, v]];
  if (!Array.isArray(v) || !v.length || !v.every((k) => Array.isArray(k) && k.length === 2 && isNum(k[0]))) fail(path, 'must be a colour or a gradient [[t, colour], ...]');
  return v.map((k, i) => { parseColor(k[1], `${path}[${i}]`); return [Math.min(1, Math.max(0, k[0])), k[1]]; }).sort((a, b) => a[0] - b[0]);
};

function emitter(e, path, depth) {
  keys(e, ['name', 'capacity', 'rate', 'bursts', 'duration', 'loop', 'delay', 'life', 'shape', 'velocity', 'gravity', 'drag', 'wind',
    'turbulence', 'attractors', 'field', 'size', 'sizeOverLife', 'color', 'alpha', 'emissive', 'rotation', 'spin', 'spinOverLife',
    'render', 'collision', 'sub', 'trail', 'lod', 'bounds', 'pauseOffscreen', 'seed'], path);
  const o = { name: e.name === undefined ? 'effect' : String(e.name) };
  o.rate = num(e.rate, 0, `${path}.rate`, 0);
  o.bursts = (e.bursts || []).map((b, i) => {
    keys(b, ['time', 'count', 'every'], `${path}.bursts[${i}]`);
    return { time: num(b.time, 0, `${path}.bursts[${i}].time`, 0), count: Math.round(num(b.count, 1, `${path}.bursts[${i}].count`, 1)), every: num(b.every, 0, `${path}.bursts[${i}].every`, 0) };
  });
  o.loop = e.loop === undefined ? o.rate > 0 : !!e.loop;
  o.duration = num(e.duration, o.loop ? 0 : 1, `${path}.duration`, 0);      // 0 with loop: emit until stopped
  o.delay = num(e.delay, 0, `${path}.delay`, 0);
  o.life = range(e.life, 1, `${path}.life`).map((v) => Math.max(0.02, v));
  const s = e.shape || {};
  keys(s, ['type', 'radius', 'shell', 'hemisphere', 'size', 'angle', 'length', 'a', 'b', 'mesh', 'offset'], `${path}.shape`);
  o.shape = { type: pick(s.type, SHAPES, 'point', `${path}.shape.type`), radius: num(s.radius, 0.5, `${path}.shape.radius`, 0),
    shell: num(s.shell, 0, `${path}.shape.shell`, 0, 1), hemisphere: !!s.hemisphere, size: vec3(s.size, [1, 1, 1], `${path}.shape.size`),
    angle: num(s.angle, 25, `${path}.shape.angle`, 0, 89), length: num(s.length, 0, `${path}.shape.length`, 0),
    a: vec3(s.a, [-0.5, 0, 0], `${path}.shape.a`), b: vec3(s.b, [0.5, 0, 0], `${path}.shape.b`), offset: vec3(s.offset, [0, 0, 0], `${path}.shape.offset`),
    mesh: s.mesh == null ? null : String(s.mesh) };
  if (o.shape.type === 'mesh' && !o.shape.mesh) fail(`${path}.shape.mesh`, 'names a mesh registered with vfx.registerMesh');
  const v = e.velocity || {};
  keys(v, ['dir', 'speed', 'spread', 'normal', 'random', 'inherit'], `${path}.velocity`);
  o.velocity = { dir: vec3(v.dir, [0, 1, 0], `${path}.velocity.dir`), speed: range(v.speed, 0, `${path}.velocity.speed`),
    spread: num(v.spread, 0, `${path}.velocity.spread`, 0, 180), normal: range(v.normal, 0, `${path}.velocity.normal`),
    random: range(v.random, 0, `${path}.velocity.random`), inherit: num(v.inherit, 0, `${path}.velocity.inherit`) };
  o.gravity = isNum(e.gravity) ? [0, e.gravity, 0] : vec3(e.gravity, [0, 0, 0], `${path}.gravity`);   // a number is m/s² on Y (negative falls)
  o.drag = num(e.drag, 0, `${path}.drag`, 0);
  o.wind = num(e.wind, 0, `${path}.wind`, 0);
  const t = e.turbulence || {};
  keys(t, ['strength', 'scale', 'speed'], `${path}.turbulence`);
  o.turbulence = { strength: num(t.strength, 0, `${path}.turbulence.strength`, 0), scale: num(t.scale, 1, `${path}.turbulence.scale`, 1e-3), speed: num(t.speed, 0.2, `${path}.turbulence.speed`) };
  if ((e.attractors || []).length > 4) fail(`${path}.attractors`, 'holds at most 4');
  o.attractors = (e.attractors || []).map((a, i) => {
    keys(a, ['position', 'strength', 'radius', 'spin'], `${path}.attractors[${i}]`);
    return { position: vec3(a.position, [0, 0, 0], `${path}.attractors[${i}].position`), strength: num(a.strength, 1, `${path}.attractors[${i}].strength`),
      radius: num(a.radius, 1, `${path}.attractors[${i}].radius`, 1e-3), spin: num(a.spin, 0, `${path}.attractors[${i}].spin`) };
  });
  if (e.field != null) {                                     // null as absent: a defined effect (where it is null) is a valid description
    keys(e.field, ['name', 'strength', 'min', 'size'], `${path}.field`);
    o.field = { name: String(e.field.name), strength: num(e.field.strength, 1, `${path}.field.strength`), min: vec3(e.field.min, [-1, -1, -1], `${path}.field.min`), size: vec3(e.field.size, [2, 2, 2], `${path}.field.size`) };
  } else o.field = null;
  o.size = range(e.size, 0.1, `${path}.size`);
  o.sizeOverLife = curve(e.sizeOverLife, 1, `${path}.sizeOverLife`);
  o.color = gradient(e.color, '#ffffff', `${path}.color`);
  o.alpha = curve(e.alpha, 1, `${path}.alpha`);
  o.emissive = curve(e.emissive, 0, `${path}.emissive`);
  o.rotation = range(e.rotation, 0, `${path}.rotation`);                     // degrees at birth
  o.spin = range(e.spin, 0, `${path}.spin`);                                 // degrees per second
  o.spinOverLife = curve(e.spinOverLife, 1, `${path}.spinOverLife`);
  const r = e.render || {};
  keys(r, ['type', 'blend', 'lit', 'soft', 'sprite', 'flipbook', 'sort', 'stretch', 'mesh', 'additive', 'order', 'nearFade'], `${path}.render`);
  o.render = { type: pick(r.type, TYPES, 'billboard', `${path}.render.type`), blend: pick(r.blend, BLENDS, 'alpha', `${path}.render.blend`),
    lit: num(r.lit, 0, `${path}.render.lit`, 0, 1), soft: num(r.soft, 0, `${path}.render.soft`, 0), sprite: pick(r.sprite, SPRITES, 'soft', `${path}.render.sprite`),
    sort: pick(r.sort, SORTS, 'none', `${path}.render.sort`), stretch: num(r.stretch, 0.05, `${path}.render.stretch`, 0),
    mesh: r.mesh === undefined ? 'shard' : String(r.mesh), additive: num(r.additive, 0, `${path}.render.additive`, 0, 1),
    order: Math.round(num(r.order, 0, `${path}.render.order`, -50, 50)), nearFade: num(r.nearFade, 0.4, `${path}.render.nearFade`, 0), flipbook: null };
  if (r.flipbook != null) {
    keys(r.flipbook, ['sheet', 'cols', 'rows', 'fps', 'blend'], `${path}.render.flipbook`);
    o.render.flipbook = { sheet: String(r.flipbook.sheet === undefined ? 'smoke' : r.flipbook.sheet), cols: Math.round(num(r.flipbook.cols, 8, `${path}.render.flipbook.cols`, 1, 16)),
      rows: Math.round(num(r.flipbook.rows, 8, `${path}.render.flipbook.rows`, 1, 16)), fps: num(r.flipbook.fps, 0, `${path}.render.flipbook.fps`, 0),   // fps 0: the sheet plays once over the life
      blend: r.flipbook.blend !== false };
  }
  if (e.collision != null) {
    const c = e.collision;
    keys(c, ['mode', 'depth', 'planes', 'ground', 'bounce', 'friction', 'radius', 'lifeLoss', 'thickness'], `${path}.collision`);
    if ((c.planes || []).length > 4) fail(`${path}.collision.planes`, 'holds at most 4');
    o.collision = { mode: pick(c.mode, MODES, 'bounce', `${path}.collision.mode`), depth: !!c.depth, ground: !!c.ground,
      planes: (c.planes || []).map((p, i) => { if (!Array.isArray(p) || p.length !== 4 || !p.every(isNum)) fail(`${path}.collision.planes[${i}]`, 'must be [nx, ny, nz, d] (n·p + d = 0)'); return p.slice(); }),
      bounce: num(c.bounce, 0.4, `${path}.collision.bounce`, 0, 1), friction: num(c.friction, 0.2, `${path}.collision.friction`, 0, 1),
      radius: num(c.radius, 0.02, `${path}.collision.radius`, 0), lifeLoss: num(c.lifeLoss, 0, `${path}.collision.lifeLoss`, 0, 1), thickness: num(c.thickness, 0.6, `${path}.collision.thickness`, 0.01) };
  } else o.collision = null;
  if (e.trail != null) {
    keys(e.trail, ['segments', 'every', 'width', 'taper'], `${path}.trail`);
    o.trail = { segments: Math.round(num(e.trail.segments, 12, `${path}.trail.segments`, 2, 64)), every: Math.round(num(e.trail.every, 2, `${path}.trail.every`, 1, 16)),
      width: num(e.trail.width, 1, `${path}.trail.width`, 0), taper: num(e.trail.taper, 1, `${path}.trail.taper`, 0, 1) };
  } else o.trail = null;
  const l = e.lod || {};
  keys(l, ['near', 'far', 'min', 'cull', 'minPixels'], `${path}.lod`);
  o.lod = { near: num(l.near, 30, `${path}.lod.near`, 0), far: num(l.far, 120, `${path}.lod.far`, 0), min: num(l.min, 0.25, `${path}.lod.min`, 0, 1),
    cull: num(l.cull, 0, `${path}.lod.cull`, 0), minPixels: num(l.minPixels, 0, `${path}.lod.minPixels`, 0) };   // cull 0: never culled by distance
  o.pauseOffscreen = !!e.pauseOffscreen;
  o.seed = Math.round(num(e.seed, 1, `${path}.seed`, 0, 0xffffff));
  if ((e.sub || []).length && depth > 0) fail(`${path}.sub`, 'sub-emitters do not nest (one level)');
  o.sub = (e.sub || []).map((sb, i) => {
    keys(sb, ['on', 'count', 'rate', 'emitter', 'inherit'], `${path}.sub[${i}]`);
    const on = pick(sb.on, EVENTS, 'death', `${path}.sub[${i}].on`);
    if (sb.emitter === undefined) fail(`${path}.sub[${i}].emitter`, 'is required');
    return { on, count: Math.round(num(sb.count, on === 'life' ? 8 : 4, `${path}.sub[${i}].count`, 1, 64)), rate: num(sb.rate, 20, `${path}.sub[${i}].rate`, 0.1),
      inherit: num(sb.inherit, 0.3, `${path}.sub[${i}].inherit`), emitter: emitter(sb.emitter, `${path}.sub[${i}].emitter`, depth + 1) };
  });
  // the rate at full life plus every burst that can overlap one life: the steady population, with a little headroom
  const steady = Math.ceil(o.rate * o.life[1] * 1.1) + o.bursts.reduce((n, b) => n + b.count * (b.every > 0 ? Math.ceil(o.life[1] / b.every) : 1), 0);
  o.capacity = Math.round(num(e.capacity, Math.max(16, steady), `${path}.capacity`, 1, 1 << 20));
  o.bounds = num(e.bounds, 0, `${path}.bounds`, 0);                          // 0: estimated from speed, life and shape
  return o;
}

/** validate and default an effect description; returns `{ name, emitters: [...] }` (plain data, JSON-safe) */
export function defineEffect(desc) {
  if (desc && desc.__vfx) return desc;
  if (desc === null || typeof desc !== 'object') fail('effect', 'must be an object');
  const list = Array.isArray(desc.emitters) ? desc.emitters : [desc];
  if (Array.isArray(desc.emitters)) keys(desc, ['name', 'emitters'], 'effect');
  if (!list.length) fail('effect.emitters', 'is empty');
  const out = { name: desc.name === undefined ? 'effect' : String(desc.name), emitters: list.map((e, i) => emitter(e, list.length > 1 ? `emitters[${i}]` : 'effect', 0)) };
  Object.defineProperty(out, '__vfx', { value: true });                      // not enumerable: JSON.stringify(out) is the description
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;
/** value of a normalised curve at t (0..1) */
export function evalCurve(c, t) {
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (t <= c[i][0]) { const a = c[i - 1], b = c[i]; return b[0] > a[0] ? lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0])) : b[1]; }
  return c[c.length - 1][1];
}
/** the per-life lookup of one normalised emitter: Float32Array(VFX_LUT_W × 2 × 4), row 0 linear colour + alpha,
 *  row 1 size multiplier, emissive, spin multiplier, and the integral of the spin multiplier (so rotation is exact
 *  at any age without integrating it in the simulation) */
export function bakeCurves(e) {
  const W = VFX_LUT_W, out = new Float32Array(W * 2 * 4), stops = e.color.map((k) => [k[0], parseColor(k[1])]);
  let integral = 0, prev = evalCurve(e.spinOverLife, 0);
  for (let i = 0; i < W; i++) {
    const t = i / (W - 1);
    let rgb = stops[stops.length - 1][1];
    if (t <= stops[0][0]) rgb = stops[0][1];
    else for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) { const a = stops[k - 1], b = stops[k], f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1; rgb = a[1].map((v, c) => lerp(v, b[1][c], f)); break; }
    const spin = evalCurve(e.spinOverLife, t);
    if (i) integral += 0.5 * (spin + prev) / (W - 1);
    prev = spin;
    out.set([rgb[0], rgb[1], rgb[2], Math.max(0, evalCurve(e.alpha, t))], i * 4);
    out.set([Math.max(0, evalCurve(e.sizeOverLife, t)), Math.max(0, evalCurve(e.emissive, t)), spin, integral], (W + i) * 4);
  }
  return out;
}
/** radius of a sphere, about the emitter's origin, that holds its particles: shape extent plus the farthest a
 *  particle can travel (speed and gravity over the longest life, eased by drag) */
export function effectRadius(e) {
  if (e.bounds > 0) return e.bounds;
  const s = e.shape, off = Math.hypot(...s.offset);
  const ext = s.type === 'box' ? 0.5 * Math.hypot(...s.size) : s.type === 'edge' ? Math.max(Math.hypot(...s.a), Math.hypot(...s.b))
    : s.type === 'cone' ? Math.hypot(s.length, s.radius + s.length * Math.tan(s.angle * Math.PI / 180)) : s.type === 'point' ? 0 : s.radius;
  const T = e.life[1], v = e.velocity.speed[1] + Math.max(Math.abs(e.velocity.normal[1]), Math.abs(e.velocity.normal[0])) + e.velocity.random[1] + e.turbulence.strength;
  const damp = e.drag > 0 ? (1 - Math.exp(-e.drag * T)) / (e.drag * T) : 1;   // mean speed factor under exponential drag
  let r = off + ext + v * T * damp + 0.5 * Math.hypot(...e.gravity) * T * T * damp + e.size[1] * 2;
  for (const sb of e.sub) r += effectRadius(sb.emitter);
  return r;
}
