// kit: what the street-level modules share (not a module itself): the keep-clear rectangles of the plan's wall signs
// and the density factor of the quality level. The surfaces (corrugated sheet, canopy, worn paint, shop interiors, text
// atlases) live in @miragekit/world/kits/cyber and are passed through here.
export { corrugated, canopy, WORN_DECL, worn, interiorMaterial, textAtlas, atlasQuad } from '@miragekit/world/kits/cyber';

/** how much of the optional dressing to build: low 0.4, medium 0.8, high 1 (main.js sets ctx.shared.detail) */
export const detail = (ctx) => ctx.shared.detail ?? 1;
/** keep about `n * detail` of a list, spread evenly (the same items on every visit) */
export const thin = (ctx, list, floor = 1) => {
  const k = detail(ctx), n = Math.max(Math.min(floor, list.length), Math.round(list.length * k));
  if (n >= list.length) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
};

// ---------------------------------------------------------------------------------------------------------------
// the plan's wall signs as rectangles on their faces, so dressing can keep out of their way
const FACE = { s: (r, a) => [a, r[3], 0, 1], n: (r, a) => [a, r[1], 0, -1], e: (r, a) => [r[2], a, 1, 0], w: (r, a) => [r[0], a, -1, 0] };
/** [{ x, z, nx, nz, u0, u1 (world coordinate along the face), y0, y1, owner }] for every sign of plan.blocks (plus `extra`) */
export function signRects(plan, extra = []) {
  const out = [];
  for (const k of plan.blocks) for (const s of k.signs || []) {
    const [x, z, nx, nz] = FACE[s.face](k.rect, s.at), half = (s.kind === 'blade' ? 0.7 : s.w / 2);
    const along = nx ? z : x;
    const text = [].concat(s.text).join('');
    out.push({ x, z, nx, nz, u0: along - half, u1: along + half, y0: s.y - s.h / 2, y1: s.y + s.h / 2, owner: /灰叔|他抄/.test(text), blade: s.kind === 'blade' });
  }
  return out.concat(extra);
}
/** true when a thing on the wall plane (nx, nz) at `along` (+-half) and y0..y1 would stand in front of a sign there;
 *  `below`: also keep clear this far under a sign (things that stick out hide it from below) */
export function inFrontOfSign(rects, { plane, nx, nz, along, half = 0, y0, y1, below = 0, margin = 0.3 }) {
  return rects.some((r) => r.nx === nx && r.nz === nz && Math.abs((nx ? r.x : r.z) - plane) < 0.6 &&
    along + half > r.u0 - margin && along - half < r.u1 + margin && y1 > r.y0 - below && y0 < r.y1 + 0.3);
}
