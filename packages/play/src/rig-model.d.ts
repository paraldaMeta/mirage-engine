import type * as THREE from 'three';
/** the test rig's measures: hip joint height, thigh, shin, ankle height (metres); walk and run clip speeds (m/s) */
export const RIG: { hip: number; thigh: number; shin: number; ankle: number; walk: number; run: number };
export interface RigModel {
  root: THREE.Group; mesh: THREE.SkinnedMesh; bones: Record<string, THREE.Bone>;
  /** idle, walk, run, walkBack, strafeL, strafeR, jump, wave, lean */
  clips: THREE.AnimationClip[];
}
/** A rigged humanoid authored in code (T-pose, 20 bones, Mixamo-style names, root-motion clips with foot events). */
export function createRigModel(options?: { material?: THREE.Material; colors?: Partial<Record<'skin' | 'shirt' | 'trousers' | 'boots' | 'hair', THREE.ColorRepresentation>> }): RigModel;
