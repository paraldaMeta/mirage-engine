import type * as THREE from 'three';
import type { MaterialKit } from '@miragekit/core/materials';
import type { XZ } from '../plan.js';

export interface WaterOptions {
  outline: readonly XZ[];
  level?: number;
  flow?: XZ;
  ripple?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
}
/** Level, non-colliding surface; the terrain underneath supplies wading collision. */
export function addWater(ctx: { root: THREE.Object3D; mat: Pick<MaterialKit, 'phys'> }, options: WaterOptions): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshPhysicalMaterial>;
