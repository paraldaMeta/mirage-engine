// Mirage original code. Furnished rooms from the home and office props and the building kit's walls: a living room,
// a kitchen-diner, a bedroom, a bathroom and an office. A room is a floor and three walls (its front, toward +z, is
// left open: a cut-away for a set or a showcase; `closed: true` adds the fourth with a door), furnished to its
// size. The same seed furnishes it the same way.
//   const MH = homeMaterials(ctx), MB = buildingMaterials(ctx, 'stucco');
//   room(b, MH, MB, geom.compose([0, 0, 0]), { kind: 'office', size: [5, 4], seed: 2 });
import * as THREE from 'three';
import * as P from './props.js';
import { wallPanel, wallDoor, wallWindow, floorSlab } from '../building/parts.js';

const T = (m, p = [0, 0, 0], r = [0, 0, 0]) => { const o = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')), new THREE.Vector3(1, 1, 1)); return m ? m.clone().multiply(o) : o; };
const rnd = (seed) => { let s = (seed * 2654435761 >>> 0) || 1; return () => ((s ^= s << 13, s ^= s >>> 17, s ^= s << 5) >>> 0) / 4294967296; };
export const ROOM_KINDS = ['living', 'kitchen', 'bedroom', 'bathroom', 'office'];

/** A furnished room `size` [w, d] (inside), its floor at y 0, centred; `kind` one of ROOM_KINDS. Returns { width, depth }. */
export function room(b, MH, MB, m, { kind = 'living', size = [5, 4], height = 2.8, seed = 1, closed = false, window = true } = {}) {
  if (!ROOM_KINDS.includes(kind)) throw new RangeError(`room: no kind "${kind}" (${ROOM_KINDS.join(', ')})`);
  const [w, d] = size, R = rnd(seed), t = 0.15, at = (x, z, yaw = 0) => T(m, [x, 0, z], [0, yaw, 0]);
  floorSlab(b, MB, T(m), { width: w + t * 2, depth: d + t * 2, edge: false });
  // the back wall (with a window), the two sides, and the front if asked
  (window ? wallWindow : wallPanel)(b, MB, T(m, [0, 0, -d / 2 - t / 2]), { width: w + t * 2, height, thick: t, plinth: 0, ...(window ? { window: [1.2, 1.3], sill: 0.95, count: w > 5 ? 2 : 1 } : {}) });
  for (const s of [-1, 1]) wallPanel(b, MB, T(m, [s * (w / 2 + t / 2), 0, 0], [0, Math.PI / 2, 0]), { width: d, height, thick: t, plinth: 0 });
  if (closed) wallDoor(b, MB, T(m, [0, 0, d / 2 + t / 2], [0, Math.PI, 0]), { width: w + t * 2, height, thick: t, door: [0.9, 2.1] });
  const hang = (fn, x, y, z, yaw = 0, o = {}) => fn(b, MH, T(m, [x, y, z], [0, yaw, 0]), o);
  if (kind === 'living') {
    P.rug(b, MH, at(0, 0.2), { size: [Math.min(3, w - 1.2), Math.min(2.2, d - 1.4)] });
    P.sofa(b, MH, at(0, -d / 2 + 0.6), { seats: w > 4.5 ? 3 : 2, color: [[0.28, 0.33, 0.38], [0.45, 0.35, 0.22], [0.2, 0.32, 0.25]][Math.floor(R() * 3)] });
    for (const s of [-1, 1]) P.cushion(b, MH, T(m, [s * 0.7, 0.42, -d / 2 + 0.75], [-0.3, s * 0.2, 0]), { color: [0.75, 0.45, 0.2] });
    P.coffeeTable(b, MH, at(0, 0.25), { glass: R() < 0.4 });
    P.armchair(b, MH, at(-w / 2 + 0.75, 0.6, Math.PI / 2 - 0.3));
    P.sideTable(b, MH, at(w / 2 - 0.45, -d / 2 + 0.5)); P.tableLamp(b, MH, T(m, [w / 2 - 0.45, 0.555, -d / 2 + 0.5]));
    P.tvStand(b, MH, at(0, d / 2 - 0.4, Math.PI));
    P.bookshelf(b, MH, at(w / 2 - 0.2, 0.3, -Math.PI / 2), { seed });
    P.floorLamp(b, MH, at(-w / 2 + 0.4, -d / 2 + 0.4));
    P.plant(b, MH, at(w / 2 - 0.45, d / 2 - 0.5), { kind: 'tall', seed });
    hang(P.picture, 0, 1.75, -d / 2 + 0.001, 0, { size: [1.0, 0.6], seed }); hang(P.wallClock, -w / 2 + 0.001, 2.0, -0.5, Math.PI / 2);
    if (window) hang(P.curtain, 0, 2.45, -d / 2, 0, { width: 1.8 });
  } else if (kind === 'kitchen') {
    P.kitchenCounter(b, MH, at(-0.3, -d / 2 + 0.31), { width: Math.min(w - 1.4, 3.6) });
    P.fridge(b, MH, at(w / 2 - 0.4, -d / 2 + 0.33));
    P.microwave(b, MH, T(m, [-0.3 - Math.min(w - 1.4, 3.6) / 2 + 0.35, 0.9, -d / 2 + 0.3]));
    P.kettle(b, MH, T(m, [0.6, 0.9, -d / 2 + 0.25]));
    P.diningTable(b, MH, at(0, 0.6), { size: [1.4, 0.85] });
    for (const [x, z, yaw] of [[-0.4, 0.05, 0], [0.4, 0.05, 0], [-0.4, 1.15, Math.PI], [0.4, 1.15, Math.PI]]) { P.chair(b, MH, at(x, z, yaw)); P.placeSetting(b, MH, T(m, [x, 0.755, z < 0.6 ? 0.35 : 0.85], [0, yaw, 0])); }
    P.plant(b, MH, T(m, [0, 0.755, 0.6]), { kind: 'grass', size: 0.5, seed });
    hang(P.wallClock, w / 2 - 0.001, 2.0, 0.6, -Math.PI / 2);
  } else if (kind === 'bedroom') {
    P.bed(b, MH, at(0, -d / 2 + 1.06), { width: w > 3.5 ? 1.6 : 1.2 });
    for (const s of [-1, 1]) { P.nightstand(b, MH, at(s * ((w > 3.5 ? 0.8 : 0.6) + 0.35), -d / 2 + 0.25)); P.tableLamp(b, MH, T(m, [s * ((w > 3.5 ? 0.8 : 0.6) + 0.35), 0.55, -d / 2 + 0.25]), { color: [0.85, 0.8, 0.7] }); }
    P.wardrobe(b, MH, at(-w / 2 + 0.31, d / 2 - 0.9, Math.PI / 2), { width: 1.4 });
    P.dresser(b, MH, at(w / 2 - 0.25, d / 2 - 1.0, -Math.PI / 2));
    P.rug(b, MH, at(0, 0.6), { size: [2.0, 1.2], color: [0.82, 0.78, 0.7], border: [0.6, 0.55, 0.48] });
    P.plant(b, MH, at(w / 2 - 0.35, -d / 2 + 0.35), { seed });
    hang(P.picture, 0, 1.9, -d / 2 + 0.001, 0, { size: [0.8, 0.5], seed: seed + 1 });
    if (window) hang(P.curtain, 0, 2.45, -d / 2, 0, { width: 1.8, color: [0.75, 0.72, 0.66], open: 0.3 });
  } else if (kind === 'bathroom') {
    P.bathtub(b, MH, at(-w / 2 + 0.85, -d / 2 + 0.375));
    P.toilet(b, MH, at(w / 2 - 0.5, -d / 2 + 0.36));
    P.washbasin(b, MH, at(w / 2 - 0.23, 0.4, -Math.PI / 2));
    P.towelRail(b, MH, T(m, [-w / 2, 0, 0.6], [0, Math.PI / 2, 0]));
    P.rug(b, MH, at(-w / 2 + 0.85, 0.3), { size: [0.9, 0.55], color: [0.5, 0.65, 0.7], border: [0.5, 0.65, 0.7] });
    P.plant(b, MH, at(w / 2 - 0.3, d / 2 - 0.4), { kind: 'grass', seed, size: 0.8 });
  } else {   // office: desks in rows facing the window, a meeting corner, cabinets
    const cols = Math.max(1, Math.floor((w - 1) / 1.6)), rows = Math.max(1, Math.floor((d - 2.2) / 1.6));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = -w / 2 + 0.5 + 1.6 * (c + 0.5), z = -d / 2 + 0.9 + r * 1.6;
      P.desk(b, MH, at(x, z), { seed: seed * 7 + r * 3 + c });
      P.officeChair(b, MH, at(x + (R() - 0.5) * 0.2, z + 0.65, Math.PI + (R() - 0.5) * 0.6));
      P.wasteBin(b, MH, at(x + 0.55, z + 0.25));
      if (r === 0 && c < cols - 1) P.partition(b, MH, at(x + 0.8, z, Math.PI / 2), { width: 0.8, height: 1.2 });
    }
    P.filingCabinet(b, MH, at(-w / 2 + 0.3, d / 2 - 0.6, Math.PI / 2), { drawers: 4 });
    P.filingCabinet(b, MH, at(-w / 2 + 0.3, d / 2 - 1.1, Math.PI / 2), { drawers: 2 });
    P.printer(b, MH, at(w / 2 - 0.35, d / 2 - 0.5, -Math.PI / 2));
    P.waterCooler(b, MH, at(w / 2 - 0.3, d / 2 - 1.2, -Math.PI / 2));
    P.plant(b, MH, at(w / 2 - 0.35, -d / 2 + 0.35), { kind: 'tall', seed });
    hang(P.whiteboard, w / 2 - 0.001, 0, 0, -Math.PI / 2, { size: [Math.min(1.8, d - 1.6), 1.0] });
    hang(P.wallClock, -w / 2 + 0.001, 2.1, -0.5, Math.PI / 2);
  }
  return { width: w, depth: d };
}
