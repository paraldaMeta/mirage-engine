// Mirage original code. The modular building kit (@miragekit/assets, building): walls with doors and windows, floors,
// columns, beams, arches, stairs, railings, roofs, balconies, awnings, chimneys, gutters, fences, gates, ladders,
// ramps, steps and mouldings, all made in code. A piece adds its geometry to a MeshBatch (core's geom) at a matrix,
// with the materials of a set `M` (buildingMaterials(ctx) makes one; any object with the same slots will do):
//   M = { wall, trim, stone, wood, roof, metal, glass, floor }
// Units are metres, +y up. A piece stands on y = 0 at its origin, its front toward +z, its width along x, centred
// on x unless its header says otherwise. The usual grid: 3 m bays, 3 m storeys, 0.25 m walls.
//   const b = new geom.MeshBatch(), M = buildingMaterials(ctx);
//   wallWindow(b, M, geom.compose([0, 0, 0]), { width: 3, height: 3 });
//   stairs(b, M, geom.compose([4, 0, 0]), { width: 1.2, rise: 3, steps: 17 });
//   roofGable(b, M, geom.compose([0, 6, 0]), { width: 9, depth: 7, pitch: 35 });
//   ctx.root.add(b.finish({ name: 'house' }));
// Collision: everything is ordinary geometry, so the walk grid reads it; give a door leaf's mesh `collide = false` if
// it should open (the kit merges it with the rest: build doors you want to swing with doorLeaf() into a batch of
// their own).
import * as THREE from 'three';
import { softBox, wall as wallGeo, archPath, compose } from '@miragekit/core/geom';

const DEG = Math.PI / 180;
/** a local transform (core's compose: position, YXZ rotation, scale) under a parent matrix (or none) */
export const at = (m, p, r, s) => (m ? m.clone().multiply(compose(p, r, s)) : compose(p, r, s));
const box = (b, mat, m, size, pos, rot = [0, 0, 0], r = 0) => b.add(r ? softBox(size[0], size[1], size[2], r) : new THREE.BoxGeometry(size[0], size[1], size[2]), mat, at(m, pos, rot));
const cyl = (b, mat, m, r0, r1, h, pos, rot = [0, 0, 0], seg = 16) => b.add(new THREE.CylinderGeometry(r0, r1, h, seg), mat, at(m, pos, rot));

// ---------------------------------------------------------------------------------------------------------------
// walls
/** A plain wall panel `width` x `height`, `thick` deep, centred on x, its outer face at z = thick / 2. */
export function wallPanel(b, M, m, { width = 3, height = 3, thick = 0.25, plinth = 0.3 } = {}) {
  box(b, M.wall, m, [width, height, thick], [0, height / 2, 0]);
  if (plinth > 0) box(b, M.stone, m, [width, plinth, thick + 0.04], [0, plinth / 2, 0]);   // a plinth course, a little proud
}
/** A wall with openings: core's wall() with a frame round each one (and glass / a door leaf when asked).
 *  openings: [{ x (centre, from the panel's centre), width, height (the clear height from the sill to the top),
 *  sill (0: a door), arch: 'flat' | 'round' (a half circle: its top is the opening's top), kind: 'door' | 'window' | 'open' }] */
export function wallOpenings(b, M, m, { width = 3, height = 3, thick = 0.25, openings = [], plinth = 0.3, frame = 0.07 } = {}) {
  const g = wallGeo({ length: width, height, thickness: thick, openings: openings.map((o) => {
    const y0 = o.sill || 0, round = o.arch === 'round';
    return { x: o.x || 0, width: o.width, height: y0 + o.height - (round ? o.width / 2 : 0), sill: y0, arch: round ? 'round' : 'flat' };
  }) });
  b.add(g, M.wall, at(m));
  if (plinth > 0) {   // the plinth stops at the doors
    const cuts = openings.filter((o) => !o.sill).map((o) => [(o.x || 0) - o.width / 2, (o.x || 0) + o.width / 2]).sort((a, c) => a[0] - c[0]);
    let x0 = -width / 2;
    for (const [a, c] of [...cuts, [width / 2, width / 2]]) { if (a - x0 > 0.02) box(b, M.stone, m, [a - x0, plinth, thick + 0.04], [(x0 + a) / 2, plinth / 2, 0]); x0 = c; }
  }
  for (const o of openings) {
    const x = o.x || 0, y0 = o.sill || 0, top = y0 + o.height, round = o.arch === 'round';
    // the frame: jambs and a head (a flat lintel; an arch gets a keystone instead), a sill board under a window
    for (const s of [-1, 1]) box(b, M.trim, m, [frame, (round ? top - o.width / 2 : top) - y0, thick + 0.03], [x + s * (o.width / 2 + frame / 2), (y0 + (round ? top - o.width / 2 : top)) / 2, 0]);
    if (!round) box(b, M.trim, m, [o.width + frame * 2.6, frame * 1.4, thick + 0.05], [x, top + frame * 0.7, 0]);
    else box(b, M.stone, m, [0.16, 0.24, thick + 0.05], [x, top + 0.08, 0]);
    if (y0 > 0) box(b, M.stone, m, [o.width + 0.12, 0.05, thick + 0.12], [x, y0 - 0.025, 0.03]);
    if (o.kind === 'window') windowFrame(b, M, at(m, [x, y0, 0]), { width: o.width, height: round ? o.height - o.width / 2 : o.height });
    if (o.kind === 'door') doorLeaf(b, M, at(m, [x, 0, -thick * 0.15]), { width: o.width, height: round ? top - o.width / 2 : top });
  }
}
/** A wall `width` wide with a door in the middle. */
export const wallDoor = (b, M, m, { width = 3, height = 3, thick = 0.25, door = [1.0, 2.2], arch = 'flat', leaf = true } = {}) =>
  wallOpenings(b, M, m, { width, height, thick, openings: [{ x: 0, width: door[0], height: door[1], arch, kind: leaf ? 'door' : 'open' }] });
/** A wall `width` wide with `count` windows evenly along it. */
export const wallWindow = (b, M, m, { width = 3, height = 3, thick = 0.25, window = [1.1, 1.4], sill = 0.9, count = 1, arch = 'flat' } = {}) =>
  wallOpenings(b, M, m, { width, height, thick, openings: Array.from({ length: count }, (_, i) => ({ x: -width / 2 + width * (i + 0.5) / count, width: window[0], height: window[1], sill, arch, kind: 'window' })) });
/** A corner pilaster `size` square from y 0 to `height`, with a base and a cap (stands at the corner point). */
export function corner(b, M, m, { height = 3, size = 0.4 } = {}) {
  box(b, M.stone, m, [size, height, size], [0, height / 2, 0], [0, 0, 0], 0.02);
  box(b, M.stone, m, [size + 0.08, 0.25, size + 0.08], [0, 0.125, 0], [0, 0, 0], 0.02);
  box(b, M.stone, m, [size + 0.1, 0.14, size + 0.1], [0, height - 0.07, 0], [0, 0, 0], 0.02);
}

// ---------------------------------------------------------------------------------------------------------------
// doors and windows
/** A door leaf `width` x `height`, 5 cm thick, in the opening's plane (its hinge side at -x). style: 'panel' (four
 *  raised panels), 'plank' (vertical boards and two ledges), 'glass' (a lit pane in a frame). A knob or a bar. */
export function doorLeaf(b, M, m, { width = 1, height = 2.2, style = 'panel', thick = 0.05 } = {}) {
  const w = width - 0.02, h = height - 0.01;
  if (style === 'plank') {
    const n = Math.max(3, Math.round(w / 0.14));
    for (let i = 0; i < n; i++) box(b, M.wood, m, [w / n - 0.006, h, thick], [-w / 2 + w * (i + 0.5) / n, h / 2, 0]);
    for (const y of [0.35, h - 0.4]) box(b, M.wood, m, [w - 0.08, 0.12, 0.03], [0, y, -thick / 2 - 0.015]);
  } else {
    box(b, M.wood, m, [w, h, thick], [0, h / 2, 0]);
    if (style === 'glass') { box(b, M.glass, m, [w - 0.24, h * 0.55, 0.012], [0, h * 0.62, thick / 2]); }
    else for (const [px, py, ph] of [[-1, 0.28, 0.42], [1, 0.28, 0.42], [-1, 0.72, 0.36], [1, 0.72, 0.36]]) box(b, M.wood, m, [w * 0.36, h * ph * 0.62, 0.02], [px * w * 0.22, h * py + (py > 0.5 ? 0.06 : 0), thick / 2 + 0.01], [0, 0, 0], 0.008);
  }
  cyl(b, M.metal, m, 0.028, 0.028, 0.06, [w / 2 - 0.09, 1.0, thick / 2 + 0.03], [Math.PI / 2, 0, 0], 12);   // the knob
  cyl(b, M.metal, m, 0.008, 0.008, 0.04, [w / 2 - 0.09, 1.0, thick / 2 + 0.005], [Math.PI / 2, 0, 0], 6);
}
/** A window `width` x `height` in an opening (its bottom at y 0): a frame, mullions (`panes` [across, down]), glass. */
export function windowFrame(b, M, m, { width = 1.1, height = 1.4, panes = [2, 2], depth = 0 } = {}) {
  const f = 0.05, z = depth;
  box(b, M.glass, m, [width - 0.02, height - 0.02, 0.008], [0, height / 2, z]);
  for (const s of [-1, 1]) { box(b, M.trim, m, [f, height, 0.07], [s * (width / 2 - f / 2), height / 2, z]); box(b, M.trim, m, [width, f, 0.07], [0, s < 0 ? f / 2 : height - f / 2, z]); }
  for (let i = 1; i < panes[0]; i++) box(b, M.trim, m, [0.03, height, 0.05], [-width / 2 + width * i / panes[0], height / 2, z]);
  for (let i = 1; i < panes[1]; i++) box(b, M.trim, m, [width, 0.03, 0.05], [0, height * i / panes[1], z]);
}
/** A pair of louvred shutters folded back beside a window `width` x `height` (bottom at y 0), on the wall face z. */
export function shutters(b, M, m, { width = 1.1, height = 1.4, open = 1 } = {}) {
  const w = width / 2, n = Math.round(height / 0.07);
  for (const s of [-1, 1]) {
    const a = s * open * 0.5 * Math.PI * 0.95, hinge = [s * (width / 2 + 0.03), 0, 0.16];
    const leaf = at(m, hinge, [0, -a, 0]);
    box(b, M.trim, leaf, [0.04, height, 0.03], [s * -0.02, height / 2, 0]); box(b, M.trim, leaf, [0.04, height, 0.03], [s * -(w - 0.02), height / 2, 0]);
    for (let i = 0; i < n; i++) box(b, M.trim, leaf, [w - 0.06, 0.05, 0.012], [s * -w / 2, 0.05 + (height - 0.1) * (i + 0.5) / n, 0], [0.5, 0, 0]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// structure
/** A floor slab `width` x `depth`, `thick` deep, its top at y 0 (so it sits under a storey's walls); centred. */
export function floorSlab(b, M, m, { width = 3, depth = 3, thick = 0.22, edge = true } = {}) {
  box(b, M.floor, m, [width, thick, depth], [0, -thick / 2, 0]);
  if (edge) for (const s of [-1, 1]) box(b, M.trim, m, [width + 0.06, 0.08, 0.06], [0, -thick + 0.04, s * (depth / 2 + 0.01)]);
}
/** A column of `height`: style 'round' (a tapered shaft, a base, a capital) or 'square' (a pier with a cap). */
export function column(b, M, m, { height = 3, radius = 0.2, style = 'round' } = {}) {
  if (style === 'square') { box(b, M.stone, m, [radius * 2, height - 0.3, radius * 2], [0, (height - 0.3) / 2 + 0.15, 0], [0, 0, 0], 0.015); box(b, M.stone, m, [radius * 2.5, 0.15, radius * 2.5], [0, 0.075, 0]); box(b, M.stone, m, [radius * 2.6, 0.15, radius * 2.6], [0, height - 0.075, 0]); return; }
  const g = new THREE.LatheGeometry([[0, 0], [radius * 1.35, 0], [radius * 1.35, 0.08], [radius * 1.18, 0.12], [radius * 1.05, 0.2], [radius, 0.28], [radius * 0.86, height - 0.32], [radius * 0.95, height - 0.26], [radius * 1.3, height - 0.14], [radius * 1.4, height - 0.12], [radius * 1.4, height], [0, height]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
  b.add(g, M.stone, at(m));
}
/** A beam from a to b (local points), `size` [w, h], the wood slot. */
export function beam(b, M, m, { a = [0, 3, 0], b: e = [3, 3, 0], size = [0.18, 0.24] } = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...e), len = A.distanceTo(B), mid = A.clone().add(B).multiplyScalar(0.5), d = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d), mm = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
  b.add(softBox(len, size[1], size[0], 0.012), M.wood, m ? m.clone().multiply(mm) : mm);
}
/** A free-standing arch `width` wide, `height` to its crown, `thick` deep, on two piers `pier` wide. */
export function archway(b, M, m, { width = 2.4, height = 3.2, thick = 0.5, pier = 0.45, kind = 'round' } = {}) {
  const W = width + pier * 2, top = height + 0.45, s = new THREE.Shape();
  s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, top); s.lineTo(-W / 2, top); s.lineTo(-W / 2, 0);
  const hole = new THREE.Path(), spring = kind === 'round' ? height - width / 2 : height - width * 0.6;
  hole.moveTo(-width / 2, 0); hole.lineTo(-width / 2, spring); archPath(hole, -width / 2, width / 2, spring, kind); hole.lineTo(width / 2, 0); hole.lineTo(-width / 2, 0);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, -thick / 2);
  b.add(g, M.stone, at(m));
  box(b, M.stone, m, [W + 0.12, 0.16, thick + 0.1], [0, top - 0.08, 0]);   // a cornice on top
}

// ---------------------------------------------------------------------------------------------------------------
// circulation
/** A straight flight from y 0 up to `rise`, climbing toward -z from z 0, `width` wide, `steps` treads; stringers and
 *  (optional) a railing on each open side. Returns { run } (its horizontal length). */
export function stairs(b, M, m, { width = 1.2, rise = 3, steps = 0, going = 0.28, stringer = true, rails = [true, true], solid = false } = {}) {
  const n = steps || Math.max(2, Math.round(rise / 0.175)), h = rise / n, run = going * n;
  for (let i = 0; i < n; i++) {
    const y = h * (i + 1), z = -going * (i + 0.5);
    if (solid) box(b, M.stone, m, [width, y, going], [0, y / 2, z]);
    else { box(b, M.wood, m, [width, 0.045, going + 0.03], [0, y - 0.022, z]); box(b, M.wood, m, [width, h - 0.045, 0.02], [0, y - h / 2 - 0.02, z + going / 2 - 0.01]); }
  }
  if (stringer && !solid) {
    const ang = Math.atan2(rise, run), len = Math.hypot(rise, run), d = 0.28;   // a stringer under the nosings, its foot on the floor
    for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.05, d, len), M.wood, at(m, [s * (width / 2 + 0.025), rise / 2 + d / 2 * Math.cos(ang) - 0.1, -run / 2], [ang, 0, 0]));
  }
  rails.forEach((on, k) => { if (on) { const s = k ? 1 : -1; railing(b, M, at(m, [s * (width / 2 - 0.03), 0, 0], [0, -Math.PI / 2, 0]), { length: run, rise, style: 'bars' }); } });
  return { run };
}
/** A spiral stair round a central post: `radius`, up to `rise` in `steps`, turning `turns` (counter-clockwise). */
export function spiralStairs(b, M, m, { radius = 1.1, rise = 3, steps = 16, turns = 0.85 } = {}) {
  cyl(b, M.metal, m, 0.07, 0.07, rise + 1.0, [0, (rise + 1.0) / 2, 0], [0, 0, 0], 12);
  const da = turns * Math.PI * 2 / steps, h = rise / steps;
  for (let i = 0; i < steps; i++) {
    const a = da * i, s = new THREE.Shape();
    s.moveTo(0, 0); s.absarc(0, 0, radius, -da * 0.5, da * 0.55, false); s.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);
    b.add(g, M.metal, at(m, [0, h * (i + 1) - 0.045, 0], [0, a, 0]));
    cyl(b, M.metal, m, 0.012, 0.012, 0.95, [Math.cos(-a) * (radius - 0.05), h * (i + 1) + 0.47, Math.sin(-a) * (radius - 0.05)], [0, 0, 0], 6);   // a baluster
  }
  const pts = []; for (let i = 0; i <= steps * 3; i++) { const a = da * i / 3; pts.push(new THREE.Vector3(Math.cos(-a) * (radius - 0.05), h * (i / 3 + 1) + 0.95, Math.sin(-a) * (radius - 0.05))); }
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps * 6, 0.025, 6), M.metal, at(m));   // the handrail
}
/** A railing `length` long along +x from x 0 (rising `rise` over it: a stair's), 1 m high. style: 'bars' (posts
 *  and balusters), 'glass' (a pane between posts), 'solid' (a parapet), 'cable' (horizontal wires). */
export function railing(b, M, m, { length = 3, rise = 0, height = 1.0, style = 'bars', spacing = 0.12 } = {}) {
  const yAt = (x) => rise * x / length, ang = Math.atan2(rise, length), L = Math.hypot(length, rise);
  if (style === 'solid') { b.add(new THREE.BoxGeometry(L, height, 0.15), M.wall, at(m, [length / 2, yAt(length / 2) + height / 2, 0], [0, 0, ang])); box(b, M.stone, m, [L + 0.06, 0.06, 0.22], [length / 2, yAt(length / 2) + height + 0.03, 0], [0, 0, ang]); return; }
  const posts = Math.max(2, Math.round(length / 1.2) + 1);
  for (let i = 0; i < posts; i++) { const x = length * i / (posts - 1); box(b, M.metal, m, [0.045, height, 0.045], [x, yAt(x) + height / 2, 0]); }
  b.add(new THREE.BoxGeometry(L + 0.06, 0.05, 0.07), M.metal, at(m, [length / 2, yAt(length / 2) + height, 0], [0, 0, ang]));   // the top rail
  if (style === 'glass') b.add(new THREE.BoxGeometry(L - 0.1, height - 0.16, 0.012), M.glass, at(m, [length / 2, yAt(length / 2) + height / 2 + 0.02, 0], [0, 0, ang]));
  else if (style === 'cable') for (let k = 1; k <= 5; k++) b.add(new THREE.CylinderGeometry(0.004, 0.004, L, 5).rotateZ(Math.PI / 2), M.metal, at(m, [length / 2, yAt(length / 2) + height * k / 6, 0], [0, 0, ang]));
  else {
    b.add(new THREE.BoxGeometry(L, 0.035, 0.035), M.metal, at(m, [length / 2, yAt(length / 2) + 0.1, 0], [0, 0, ang]));
    for (let x = spacing; x < length - 0.03; x += spacing) box(b, M.metal, m, [0.016, height - 0.12, 0.016], [x, yAt(x) + 0.1 + (height - 0.12) / 2, 0]);
  }
}
/** A ramp `width` wide climbing `rise` toward -z over `run`, with kerbs. */
export function ramp(b, M, m, { width = 1.5, rise = 0.5, run = 6 } = {}) {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(run, 0); s.lineTo(run, rise); s.lineTo(0, 0);
  b.add(new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false }).translate(0, 0, -width / 2).rotateY(Math.PI / 2), M.stone, at(m));
  for (const sx of [-1, 1]) { const g = new THREE.ExtrudeGeometry((() => { const k = new THREE.Shape(); k.moveTo(0, 0); k.lineTo(run, 0); k.lineTo(run, rise + 0.12); k.lineTo(0, 0.12); k.lineTo(0, 0); return k; })(), { depth: 0.12, bevelEnabled: false }).rotateY(Math.PI / 2); b.add(g, M.stone, at(m, [sx * (width / 2 + 0.06) + 0.06, 0, 0])); }
}
/** Entrance steps: `count` steps up to `rise` in front of a door (toward +z), `width` wide. */
export function stoop(b, M, m, { width = 2, rise = 0.5, count = 3, going = 0.32 } = {}) {
  for (let i = 0; i < count; i++) { const h = rise * (count - i) / count; box(b, M.stone, m, [width - i * 0.1, h, going], [0, h / 2, going * (count - i - 0.5)], [0, 0, 0], 0.012); }
}
/** A steel ladder `height` tall, `width` wide, its rungs every 0.3 m, a hoop cage above 2.4 m when `cage`. */
export function ladder(b, M, m, { height = 4, width = 0.45, cage = false } = {}) {
  for (const s of [-1, 1]) box(b, M.metal, m, [0.05, height, 0.02], [s * width / 2, height / 2, 0]);
  for (let y = 0.3; y < height; y += 0.3) cyl(b, M.metal, m, 0.014, 0.014, width, [0, y, 0], [0, 0, Math.PI / 2], 8);
  if (cage) for (let y = 2.4; y < height; y += 0.7) b.add(new THREE.TorusGeometry(0.38, 0.012, 4, 16, Math.PI), M.metal, at(m, [0, y, 0.38], [-Math.PI / 2, 0, 0]));
}

// ---------------------------------------------------------------------------------------------------------------
// roofs
/** Rows of tiles as one ridged sheet `w` x `len` (len along the slope), on the slope's plane (y = 0, +z down slope). */
function tiles(b, M, m, w, len, { course = 0.24, lap = 0.06 } = {}) {
  const rows = Math.ceil(len / course);
  for (let i = 0; i < rows; i++) box(b, M.roof, m, [w, 0.03, course + lap], [0, 0.015 + (i % 2) * 0.004, -len / 2 + course * (i + 0.5)], [-0.08, 0, 0]);
}
/** A gable roof over a `width` (x) by `depth` (z) footprint centred at the origin, eaves at y 0: two tiled slopes,
 *  gable walls (the wall slot), a ridge, bargeboards. pitch in degrees, `overhang` past the walls. */
export function roofGable(b, M, m, { width = 9, depth = 7, pitch = 35, overhang = 0.4 } = {}) {
  const half = depth / 2 + overhang, rise = Math.tan(pitch * DEG) * (depth / 2), slope = half / Math.cos(pitch * DEG), W = width + overhang * 2;
  for (const s of [-1, 1]) {
    const sm = at(m, [0, rise / 2 - Math.tan(pitch * DEG) * overhang / 2, s * (half / 2)], [s * pitch * DEG, s > 0 ? 0 : Math.PI, 0]);
    box(b, M.wood, sm, [W, 0.06, slope], [0, -0.04, 0]);
    tiles(b, M, sm, W, slope);
  }
  // the gable ends: triangles of wall over the eaves line
  const tri = new THREE.Shape(); tri.moveTo(-depth / 2, 0); tri.lineTo(depth / 2, 0); tri.lineTo(0, rise); tri.lineTo(-depth / 2, 0);
  for (const s of [-1, 1]) b.add(new THREE.ExtrudeGeometry(tri, { depth: 0.25, bevelEnabled: false }).translate(0, 0, -0.125).rotateY(Math.PI / 2), M.wall, at(m, [s * (width / 2 - 0.125), 0, 0]));
  cyl(b, M.roof, m, 0.09, 0.09, W + 0.04, [0, rise + 0.06, 0], [0, 0, Math.PI / 2], 10);   // the ridge tiles
  for (const s of [-1, 1]) for (const t of [-1, 1]) b.add(new THREE.BoxGeometry(0.04, 0.2, slope), M.trim, at(m, [s * W / 2, rise / 2 - Math.tan(pitch * DEG) * overhang / 2 - 0.05, t * half / 2], [t * pitch * DEG, t > 0 ? 0 : Math.PI, 0]));   // bargeboards
  return { rise };
}
/** A hipped roof (four slopes) over `width` x `depth`, eaves at y 0. */
export function roofHip(b, M, m, { width = 9, depth = 7, pitch = 30, overhang = 0.4 } = {}) {
  const W = width / 2 + overhang, D = depth / 2 + overhang, t = Math.tan(pitch * DEG), rise = t * D, ridge = Math.max(0, W - D);
  const g = new THREE.BufferGeometry(), y0 = -t * overhang + 0.02;
  const P = [[-W, y0, D], [W, y0, D], [W, y0, -D], [-W, y0, -D], [-ridge, rise + y0, 0], [ridge, rise + y0, 0]];
  const F = [[0, 1, 5], [0, 5, 4], [1, 2, 5], [2, 3, 4], [2, 4, 5], [3, 0, 4]];
  g.setAttribute('position', new THREE.Float32BufferAttribute(F.flat().flatMap((i) => P[i]), 3));
  const uv = []; for (const f of F) for (const i of f) uv.push(P[i][0] / 2, (P[i][2] + P[i][1]) / 2);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  b.add(g, M.roof, at(m));
  b.add(new THREE.BoxGeometry(W * 2 + 0.04, 0.18, D * 2 + 0.04).translate(0, y0 - 0.09, 0), M.trim, at(m));   // the fascia
  if (ridge > 0) cyl(b, M.roof, m, 0.08, 0.08, ridge * 2, [0, rise + y0 + 0.05, 0], [0, 0, Math.PI / 2], 8);
  return { rise };
}
/** A flat roof over `width` x `depth` at y 0 with a parapet `parapet` high and a coping. */
export function roofFlat(b, M, m, { width = 9, depth = 7, parapet = 0.8, thick = 0.25 } = {}) {
  box(b, M.floor, m, [width, 0.2, depth], [0, -0.1, 0]);
  for (const [w, d, x, z] of [[width, thick, 0, depth / 2 - thick / 2], [width, thick, 0, -depth / 2 + thick / 2], [thick, depth, width / 2 - thick / 2, 0], [thick, depth, -width / 2 + thick / 2, 0]]) {
    box(b, M.wall, m, [w, parapet, d], [x, parapet / 2, z]); box(b, M.stone, m, [w + 0.06, 0.06, d + 0.06], [x, parapet + 0.03, z]);
  }
}
/** A dormer on a slope: a little gabled box `width` wide sticking out of the roof plane (its sill at y 0, front +z). */
export function dormer(b, M, m, { width = 1.4, height = 1.4, depth = 1.6 } = {}) {
  box(b, M.wall, m, [width, height, depth], [0, height / 2, -depth / 2]);
  windowFrame(b, M, at(m, [0, 0.25, 0.01]), { width: width - 0.5, height: height - 0.45, panes: [2, 2] });
  roofGable(b, M, at(m, [0, height, -depth / 2], [0, Math.PI / 2, 0]), { width: depth, depth: width, pitch: 40, overhang: 0.15 });
}
/** A chimney stack `height` tall from y 0: a brick-coloured stack, a cap, two pots. */
export function chimney(b, M, m, { height = 2, size = [0.7, 0.5] } = {}) {
  box(b, M.stone, m, [size[0], height, size[1]], [0, height / 2, 0]);
  box(b, M.stone, m, [size[0] + 0.12, 0.12, size[1] + 0.12], [0, height + 0.06, 0]);
  for (const s of [-1, 1]) cyl(b, M.roof, m, 0.09, 0.11, 0.35, [s * size[0] * 0.25, height + 0.3, 0], [0, 0, 0], 10);
}
/** A gutter along an eave `length` long (along x, centred) and a downpipe to the ground `drop` below it at one end. */
export function gutter(b, M, m, { length = 9, drop = 3, side = 1 } = {}) {
  b.add(new THREE.CylinderGeometry(0.07, 0.07, length, 10, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), M.metal, at(m, [0, 0, 0.07]));
  const x = side * (length / 2 - 0.15);
  cyl(b, M.metal, m, 0.04, 0.04, drop, [x, -drop / 2, 0.12], [0, 0, 0], 8);
  for (let y = -0.6; y > -drop; y -= 1.2) box(b, M.metal, m, [0.1, 0.03, 0.12], [x, y, 0.06]);   // the brackets
  cyl(b, M.metal, m, 0.04, 0.05, 0.25, [x, -drop + 0.08, 0.2], [Math.PI / 3, 0, 0], 8);   // the shoe
}

// ---------------------------------------------------------------------------------------------------------------
// outside
/** A balcony slab `width` x `depth` out from a wall face (toward +z) at y 0, a railing round it, two brackets. */
export function balcony(b, M, m, { width = 2.4, depth = 1.1, style = 'bars' } = {}) {
  box(b, M.stone, m, [width, 0.16, depth], [0, -0.08, depth / 2]);
  railing(b, M, at(m, [-width / 2 + 0.03, 0, depth - 0.03]), { length: width - 0.06, style });
  for (const s of [-1, 1]) railing(b, M, at(m, [s * (width / 2 - 0.03), 0, 0], [0, -Math.PI / 2, 0]), { length: depth - 0.03, style });
  for (const s of [-1, 1]) { const k = new THREE.Shape(); k.moveTo(0, 0); k.lineTo(depth * 0.8, 0); k.lineTo(0, -0.5); k.lineTo(0, 0); b.add(new THREE.ExtrudeGeometry(k, { depth: 0.1, bevelEnabled: false }).rotateY(-Math.PI / 2), M.stone, at(m, [s * width * 0.35 + 0.05, -0.16, 0])); }
}
/** A shop awning `width` wide sloping out `depth` from a wall at y 0 (toward +z), striped fabric or a sheet, with arms. */
export function awning(b, M, m, { width = 3, depth = 1.2, drop = 0.45, stripes = 8, fabric = null } = {}) {
  const g = new THREE.PlaneGeometry(width, Math.hypot(depth, drop), stripes, 1), ang = Math.atan2(drop, depth);
  b.add(g, fabric || M.trim, at(m, [0, -drop / 2, depth / 2], [-Math.PI / 2 + ang, 0, 0]));
  const val = new THREE.PlaneGeometry(width, 0.22); b.add(val, fabric || M.trim, at(m, [0, -drop - 0.11, depth], [0, 0, 0]));   // the valance
  for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.012, 0.012, Math.hypot(depth, drop + 0.4), 6), M.metal, at(m, [s * (width / 2 - 0.1), -(drop + 0.4) / 2, depth / 2], [Math.atan2(depth, drop + 0.4), 0, 0]));
}
/** A fence `length` long along +x from x 0: 'picket' (pointed boards on two rails), 'wire' (posts and mesh), 'panel'. */
export function fence(b, M, m, { length = 4, height = 1.1, style = 'picket' } = {}) {
  const posts = Math.max(2, Math.round(length / 2) + 1);
  for (let i = 0; i < posts; i++) box(b, style === 'wire' ? M.metal : M.wood, m, [0.08, height + 0.1, 0.08], [length * i / (posts - 1), (height + 0.1) / 2, 0]);
  if (style === 'wire') { for (const y of [0.1, height]) cyl(b, M.metal, m, 0.012, 0.012, length, [length / 2, y, 0], [0, 0, Math.PI / 2], 6); for (let x = 0.05; x < length; x += 0.06) b.add(new THREE.BoxGeometry(0.003, height - 0.1, 0.003), M.metal, at(m, [x, height / 2 + 0.05, 0], [0, 0, 0.6])); return; }
  for (const y of [0.25, height - 0.2]) box(b, M.wood, m, [length, 0.08, 0.03], [length / 2, y, -0.05]);
  if (style === 'panel') { box(b, M.wood, m, [length, height - 0.1, 0.02], [length / 2, height / 2 + 0.05, -0.02]); return; }
  for (let x = 0.07; x < length - 0.03; x += 0.12) {
    const k = new THREE.Shape(); k.moveTo(-0.04, 0); k.lineTo(0.04, 0); k.lineTo(0.04, height - 0.06); k.lineTo(0, height); k.lineTo(-0.04, height - 0.06); k.lineTo(-0.04, 0);
    b.add(new THREE.ExtrudeGeometry(k, { depth: 0.02, bevelEnabled: false }), M.wood, at(m, [x, 0.02, -0.02]));
  }
}
/** A two-leaf iron gate `width` wide between two piers (centred), its leaves at `open` (0 shut, 1 wide). */
export function gate(b, M, m, { width = 3, height = 1.8, open = 0 } = {}) {
  for (const s of [-1, 1]) column(b, M, at(m, [s * (width / 2 + 0.25), 0, 0]), { height: height + 0.4, radius: 0.22, style: 'square' });
  for (const s of [-1, 1]) {
    const leaf = at(m, [s * width / 2, 0, 0], [0, s * open * Math.PI * 0.45, 0]), w = width / 2 - 0.02;
    for (const y of [0.12, height - 0.1]) box(b, M.metal, leaf, [w, 0.04, 0.03], [-s * w / 2, y, 0]);
    for (let x = 0.08; x < w; x += 0.12) { box(b, M.metal, leaf, [0.018, height - 0.1, 0.018], [-s * x, height / 2, 0]); cyl(b, M.metal, leaf, 0.0, 0.025, 0.08, [-s * x, height + 0.03, 0], [0, 0, 0], 4); }
  }
}
/** A moulding: a profile [[x (out), y], ...] swept along a straight run `length` (x, centred): cornices, string courses. */
export function moulding(b, M, m, { length = 3, profile = [[0, 0], [0.06, 0], [0.06, 0.04], [0.12, 0.08], [0.14, 0.14], [0, 0.14]], slot = 'stone' } = {}) {
  const s = new THREE.Shape(); profile.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  b.add(new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false }).translate(0, 0, -length / 2).rotateY(-Math.PI / 2), M[slot], at(m));   // the run along x, the profile out toward +z
}
