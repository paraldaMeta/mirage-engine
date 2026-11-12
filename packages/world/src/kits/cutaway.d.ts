import type * as THREE from 'three';
import type { MaterialHooks, MaterialKit } from '@miragekit/core/materials';

export interface CutawayOptions {
  /** the hole's radius (1.8 m) */
  radius?: number;
  /** the share of the eye -> target way the hole starts and ends at (0.02, 0.96) */
  near?: number; far?: number;
  /** metres under the target below which nothing is cut (0.6) */
  below?: number;
}
export interface Cutaway {
  radius: number;
  readonly uniforms: { uMgCut: THREE.IUniform<THREE.Vector4>; uMgCutShape: THREE.IUniform<THREE.Vector3> };
  readonly on: boolean;
  /** hooks with the cut in front of their albedo */
  hooks(hooks?: MaterialHooks): MaterialHooks;
  /** re-patch an existing material with its hooks plus the cut */
  apply<M extends THREE.Material>(mat: Pick<MaterialKit, 'patch'>, material: M): M;
  /** the point kept in view, and the radius */
  set(x: number, y: number, z: number, radius?: number): Cutaway;
  off(): Cutaway;
  /** would the hole hide (x, y, z) seen from eye */
  hides(x: number, y: number, z: number, eye: ArrayLike<number> | { x: number; y: number; z: number }): boolean;
}
/** A see-through hole between the camera and a target in the materials marked with it. */
export function createCutaway(options?: CutawayOptions): Cutaway;
