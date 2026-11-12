import type * as THREE from 'three';

type ColliderCtx = { collider(mesh: THREE.Mesh): THREE.Mesh };

/** One collider mesh: walls along the inside of [x0, z0, x1, z1]. */
export function addPerimeter(ctx: ColliderCtx, bounds: readonly [number, number, number, number], options?: { thickness?: number; y0?: number; y1?: number }): THREE.Mesh;
/** One collider mesh: a wall along a polyline [[x, z], ...]; null for fewer than two distinct points. */
export function addBarrier(ctx: ColliderCtx, points: ReadonlyArray<readonly [number, number]>, options?: { thickness?: number; y0?: number; y1?: number }): THREE.Mesh | null;
