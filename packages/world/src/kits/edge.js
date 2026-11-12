// Mirage original code. Brought in from a game built on Mirage ("close the map naturally").
// ---------------------------------------------------------------------------
// Invisible walls for the edge of a walkable map: a ring of collider boxes just inside the walk bounds (whatever
// the scenery does, the walk grid ends there) and a wall along a polyline (a stream bank, a cliff edge). Both are
// ctx.collider proxies (layer 2: the walk grid sees them, the camera does not) merged into ONE mesh each: a wall
// made of one mesh per segment costs the bake a draw per segment.
//
//   addPerimeter(ctx, plan.bounds);                         // [x0, z0, x1, z1]
//   addBarrier(ctx, [[x, z], ...], { y0: -2, y1: 3 });
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Collider walls along the inside of `bounds` ([x0, z0, x1, z1]), `thickness` m thick (0.6), from y0 (-20) to y1 (30). */
export function addPerimeter(ctx, [x0, z0, x1, z1], { thickness: t = 0.6, y0 = -20, y1 = 30 } = {}) {
  const h = y1 - y0, cy = (y0 + y1) / 2;
  const parts = [
    new THREE.BoxGeometry(x1 - x0, h, t).translate((x0 + x1) / 2, cy, z0 + t / 2),
    new THREE.BoxGeometry(x1 - x0, h, t).translate((x0 + x1) / 2, cy, z1 - t / 2),
    new THREE.BoxGeometry(t, h, z1 - z0).translate(x0 + t / 2, cy, (z0 + z1) / 2),
    new THREE.BoxGeometry(t, h, z1 - z0).translate(x1 - t / 2, cy, (z0 + z1) / 2),
  ];
  const mesh = ctx.collider(new THREE.Mesh(mergeGeometries(parts, false)));
  for (const g of parts) g.dispose();
  mesh.name = 'perimeter';
  return mesh;
}

/**
 * A collider wall along a polyline ([[x, z], ...]), `thickness` m thick (0.4), from y0 (-6) to y1 (4); segments
 * overlap by the thickness so the corners close. Returns the mesh, or null for fewer than two distinct points.
 */
export function addBarrier(ctx, points, { thickness: t = 0.4, y0 = -6, y1 = 4 } = {}) {
  const parts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    parts.push(new THREE.BoxGeometry(t, y1 - y0, len + t).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2));
  }
  if (!parts.length) return null;
  const mesh = ctx.collider(new THREE.Mesh(mergeGeometries(parts, false)));
  for (const g of parts) g.dispose();
  mesh.name = 'barrier';
  return mesh;
}
