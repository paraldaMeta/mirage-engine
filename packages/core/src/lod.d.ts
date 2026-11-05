import type * as THREE from 'three';
export interface LodGroup { full: THREE.Mesh[]; twins: THREE.Mesh[][]; errors: readonly number[]; sphere: THREE.Sphere; level?: number }
export interface LodController {
  groups: LodGroup[]; stats: { meshes: number; tris: number; twinTris: number[]; ms: number };
  register(root: THREE.Object3D, options?: { errors?: readonly number[]; minTris?: number; filter?: ((mesh: THREE.Mesh) => boolean) | null; weights?: Record<string, number> }): Promise<LodGroup | null>;
  update(camera: THREE.Camera, options?: { viewHalf?: number; heightPx?: number }): void;
  /** Selects original meshes; does not remove or dispose generated twins. */
  reset(): void;
}
export function createLod(): LodController;
