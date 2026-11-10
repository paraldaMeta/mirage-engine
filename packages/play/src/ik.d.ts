import type * as THREE from 'three';
export interface TwoBoneOptions {
  /** a world point the middle joint points towards; default: the pose's own bend plane */
  pole?: THREE.Vector3 | null;
  weight?: number;
  /** world direction a straight limb bends towards when there is no pole (default the upper bone's local +Z) */
  hint?: THREE.Vector3 | null;
  /** how straight the limb may get, as a fraction of its length (default 0.999) */
  stretch?: number;
}
/** Bend upper -> lower -> end so `end` reaches `target` (world). Returns the distance left. */
export function solveTwoBone(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, options?: TwoBoneOptions): number;
export interface LookAtOptions {
  /** the last bone's facing axis in its own frame (default +Z) */
  forward?: THREE.Vector3 | null;
  /** how the turn is split along the chain, parent first */
  share?: readonly number[] | null;
  /** radians the chain may turn away from the animated pose */
  limit?: number; weight?: number;
}
/** Turn a bone or a chain (parent first) so the last one faces `target` (world). Returns the angle left over. */
export function solveLookAt(bones: THREE.Object3D | readonly THREE.Object3D[], target: THREE.Vector3, options?: LookAtOptions): number;
export type BoneRef = string | THREE.Object3D;
export interface FootIKOptions {
  /** floor height under (x, z) for a body with feet at y; NaN or null where there is none (a walk grid's groundAt fits) */
  ground: (x: number, z: number, y: number) => number | null | undefined;
  legs: readonly (readonly [upper: BoneRef, lower: BoneRef, foot: BoneRef])[];
  hips: BoneRef;
  maxStep?: number; maxDrop?: number;
  /** easing of the offsets, per second (default 12) */
  rate?: number;
  /** steepest slope (radians) the foot pitches to; 0 turns pitching off */
  tilt?: number; footLength?: number; weight?: number; forward?: THREE.Vector3 | null;
}
export interface FootIK {
  weight: number; readonly hipOffset: number;
  legs: { upper: THREE.Object3D; lower: THREE.Object3D; foot: THREE.Object3D; offset: number; pitch: number }[];
  /** forget the eased offsets (after a teleport) */
  reset(): void;
  /** call after the animation has posed the bones (an animator's post hook) */
  update(dt?: number): void;
}
export function createFootIK(root: THREE.Object3D, options: FootIKOptions): FootIK;
