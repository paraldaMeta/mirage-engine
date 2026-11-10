import type * as THREE from 'three';
/** root, hips, spine, chest, neck, head, and upperLeg / lowerLeg / foot / toe / upperArm / lowerArm / hand + L or R */
export type HumanoidRoles = Record<string, THREE.Bone>;
/** The humanoid roles found by bone name under a model (Mixamo-style, .L/.R, _l/_r, Left/Right spellings). */
export function humanoidRoles(root: THREE.Object3D): HumanoidRoles;
/** { source bone name: target bone name } for every role both models have. */
export function humanoidMap(source: THREE.Object3D, target: THREE.Object3D): Record<string, string>;
export interface RetargetOptions {
  map?: Record<string, string> | null;
  /** keys per second of the baked clip (default 30) */
  fps?: number;
  /** translation scale; default the ratio of hip heights */
  scale?: number | null;
  /** swing target limbs onto the source's rest directions first (default true) */
  matchRest?: boolean; name?: string;
}
/** `clip` (made for the skeleton under `source`) as a new clip for the skeleton under `target`. Both in rest pose. */
export function retargetClip(clip: THREE.AnimationClip, source: THREE.Object3D, target: THREE.Object3D, options?: RetargetOptions): THREE.AnimationClip;
