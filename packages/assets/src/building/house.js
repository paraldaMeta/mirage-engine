// Mirage original code. Materials for the building kit, and a house put together from its parts.
//   const M = buildingMaterials(ctx, 'stucco');     // 'stucco' | 'stone' | 'brick' | 'timber' | 'concrete'
//   const info = house(b, M, geom.compose([0, 0, 0]), { bays: [3, 2], storeys: 2, roof: 'gable', seed: 7 });
// house() lays out a rectangle of 3 m bays and 3 m storeys: a door on the front's middle bay, windows elsewhere
// (some with shutters, a balcony or two upstairs), floor slabs, corner pilasters, a roof (gable | hip | flat), a
// chimney, gutters, entrance steps. The same seed gives the same house. Returns { width, depth, height, doors }
// (door centres in the house's frame, for a walk-through's anchors).
import { wallPanel, wallOpenings, corner, floorSlab, roofGable, roofHip, roofFlat, chimney, gutter, stoop, balcony, shutters, moulding, at } from './parts.js';
import { rng } from '@miragekit/core/rng';
import * as THREE from 'three';

/** Linear-albedo bases (GLSL) of each style: wall, trim, stone, roof. */
export const BUILDING_STYLES = {
  stucco: { wall: 'vec3(0.78, 0.70, 0.58)', trim: [0.92, 0.9, 0.85], stone: 'vec3(0.55, 0.50, 0.43)', roof: 'vec3(0.50, 0.22, 0.12)', proc: 'plaster' },
  stone: { wall: 'vec3(0.50, 0.45, 0.38)', trim: [0.3, 0.22, 0.15], stone: 'vec3(0.42, 0.38, 0.33)', roof: 'vec3(0.22, 0.22, 0.24)', proc: 'stone' },
  brick: { wall: 'vec3(0.45, 0.18, 0.11)', trim: [0.9, 0.9, 0.88], stone: 'vec3(0.62, 0.58, 0.52)', roof: 'vec3(0.20, 0.20, 0.22)', proc: 'stone', brick: true },
  timber: { wall: 'vec3(0.86, 0.82, 0.72)', trim: [0.16, 0.1, 0.06], stone: 'vec3(0.45, 0.42, 0.38)', roof: 'vec3(0.42, 0.30, 0.20)', proc: 'plaster' },
  concrete: { wall: 'vec3(0.52, 0.52, 0.50)', trim: [0.12, 0.12, 0.13], stone: 'vec3(0.46, 0.46, 0.45)', roof: 'vec3(0.30, 0.30, 0.31)', proc: 'plaster' },
};
/** The kit's material slots for a style, from core's PROC surfaces: { wall, trim, stone, wood, roof, metal, glass, floor }. */
export function buildingMaterials(ctx, style = 'stucco') {
  const S = BUILDING_STYLES[style];
  if (!S) throw new RangeError(`buildingMaterials: no style "${style}" (${Object.keys(BUILDING_STYLES).join(', ')})`);
  const { mat } = ctx, P = mat.PROC, c = (a) => new THREE.Color().setRGB(a[0], a[1], a[2]);
  const key = 'building:' + style;
  if (ctx.shared?.[key]) return ctx.shared[key];
  const M = {
    wall: S.brick ? mat.std({ color: 0xffffff, roughness: 0.9 }, P.stone(S.wall, { course: 0.075, block: 0.23 })) : mat.std({ color: 0xffffff, roughness: 0.9 }, P[S.proc](S.wall)),
    trim: mat.std({ color: c(S.trim), roughness: 0.55 }),
    stone: mat.std({ color: 0xffffff, roughness: 0.85 }, P.stone(S.stone)),
    wood: mat.std({ color: 0xffffff, roughness: 0.7 }, P.wood('vec3(0.30, 0.19, 0.11)')),
    roof: mat.std({ color: 0xffffff, roughness: 0.75 }, P.terracotta(S.roof)),
    metal: mat.std({ color: 0xffffff, metalness: 1, roughness: 0.35 }, P.brushed('vec3(0.45, 0.46, 0.47)')),
    glass: mat.phys({ color: new THREE.Color(0.05, 0.07, 0.08), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 }),
    floor: mat.std({ color: 0xffffff, roughness: 0.8 }, P.stone(S.stone, { course: 0.4, block: 0.4 })),
  };
  if (ctx.shared) ctx.shared[key] = M;
  return M;
}

/** A house of `bays` [across, deep] 3 m bays and `storeys` 3 m storeys, its front (with the door) toward +z, centred. */
export function house(b, M, m, { bays = [3, 2], storeys = 2, roof = 'gable', seed = 1, bay = 3, storey = 3, thick = 0.25, plinth = 0.5 } = {}) {
  const R = rng(seed).next, W = bays[0] * bay, D = bays[1] * bay, H = storeys * storey;
  const T = (p, r) => at(m, p, r);
  const doors = [], frontDoor = Math.floor(bays[0] / 2);
  // the four sides: [count of bays, centre, yaw]
  const sides = [[bays[0], [0, D / 2 - thick / 2], 0, true], [bays[0], [0, -D / 2 + thick / 2], Math.PI, false], [bays[1], [W / 2 - thick / 2, 0], Math.PI / 2, false], [bays[1], [-W / 2 + thick / 2, 0], -Math.PI / 2, false]];
  for (let f = 0; f < storeys; f++) {
    const y = plinth + f * storey;
    for (const [n, [cx, cz], yaw, front] of sides) {
      const len = n * bay - (yaw % Math.PI ? thick * 2 : 0);   // the side walls fit between the front and the back
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + len * (i + 0.5) / n, wm = T([cx + Math.cos(yaw) * u, y, cz - Math.sin(yaw) * u], [0, yaw, 0]), w = len / n;
        if (front && f === 0 && i === frontDoor) { wallOpenings(b, M, wm, { width: w, height: storey, thick, plinth: 0, openings: [{ x: 0, width: 1.1, height: 2.3, arch: R() < 0.4 ? 'round' : 'flat', kind: 'door' }] }); doors.push([cx + Math.cos(yaw) * u, y, cz + 0.4]); continue; }
        if (R() < 0.12 && !front) { wallPanel(b, M, wm, { width: w, height: storey, thick, plinth: 0 }); continue; }   // a blind bay now and then
        const tall = f > 0 && front && R() < 0.35, wh = tall ? 2.2 : 1.4, sill = tall ? 0.05 : 0.9;
        wallOpenings(b, M, wm, { width: w, height: storey, thick, plinth: 0, openings: [{ x: 0, width: 1.1, height: wh, sill, arch: R() < 0.25 ? 'round' : 'flat', kind: 'window' }] });
        if (tall) balcony(b, M, T([cx + Math.cos(yaw) * u, y, cz + thick / 2], [0, yaw, 0]), { width: 2.0, depth: 0.9 });
        else if (R() < 0.45) shutters(b, M, T([cx + Math.cos(yaw) * u, y + sill, cz - Math.sin(yaw) * u], [0, yaw, 0]), { width: 1.1, height: wh, open: 0.7 + R() * 0.3 });
      }
    }
    floorSlab(b, M, T([0, y, 0]), { width: W - 0.02, depth: D - 0.02, edge: false });
    if (f > 0) for (const [n, [cx, cz], yaw] of sides) moulding(b, M, T([cx + Math.sin(yaw) * thick / 2, y - 0.07, cz + Math.cos(yaw) * thick / 2], [0, yaw, 0]), { length: n * bay + (yaw % Math.PI ? 0 : 0.5), profile: [[0, 0], [0.05, 0], [0.08, 0.05], [0.08, 0.1], [0, 0.12]] });
  }
  // the plinth all round, the corners, the steps
  wallPanel(b, M, T([0, 0, D / 2 - thick / 2]), { width: W, height: plinth, thick: thick + 0.06, plinth: 0 });
  wallPanel(b, M, T([0, 0, -D / 2 + thick / 2]), { width: W, height: plinth, thick: thick + 0.06, plinth: 0 });
  for (const s of [-1, 1]) wallPanel(b, M, T([s * (W / 2 - thick / 2), 0, 0], [0, Math.PI / 2, 0]), { width: D - thick * 2, height: plinth, thick: thick + 0.06, plinth: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) corner(b, M, T([sx * (W / 2 - 0.12), 0, sz * (D / 2 - 0.12)]), { height: H + plinth, size: 0.34 });
  stoop(b, M, T([doors[0] ? doors[0][0] : 0, 0, D / 2 + 0.02]), { width: 2.0, rise: plinth, count: Math.max(2, Math.round(plinth / 0.17)) });
  // the roof, its chimney, the gutters
  const top = plinth + H;
  let rise = 0;
  if (roof === 'flat') roofFlat(b, M, T([0, top, 0]), { width: W, depth: D });
  else rise = (roof === 'hip' ? roofHip : roofGable)(b, M, T([0, top, 0]), { width: W, depth: D, pitch: roof === 'hip' ? 28 : 34, overhang: 0.45 }).rise;
  if (roof !== 'flat') {
    chimney(b, M, T([W * 0.25 * (R() < 0.5 ? -1 : 1), top + rise * 0.45, -D * 0.12]), { height: rise * 0.75 + 0.9 });
    for (const s of [-1, 1]) gutter(b, M, T([0, top - 0.02, s * (D / 2 + 0.42)], [0, s > 0 ? 0 : Math.PI, 0]), { length: W + 0.8, drop: top - 0.02 });
  }
  return { width: W, depth: D, height: top + rise, doors };
}
