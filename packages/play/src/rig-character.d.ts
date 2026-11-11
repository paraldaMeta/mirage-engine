import type * as THREE from 'three';
import type { Character } from './character.js';
import type { Animator, AnimLayer } from './anim.js';
import type { FootIK, FootIKOptions, LookAtOptions } from './ik.js';
import type { Body } from './walker.js';
export interface RigCharacterOptions {
  /** which clips play the roles idle, walk, run, jump (defaults: those names) */
  clipNames?: Partial<Record<'idle' | 'walk' | 'run' | 'jump', string>>;
  /** replace the default controller; it must read the parameters speed, rate, grounded, vy */
  layers?: readonly AnimLayer[] | null;
  /** the bone whose travel is taken out of the clips (default 'Root') */
  rootBone?: string;
  ground?: ((x: number, z: number, y: number) => number | null | undefined) | null;
  footIK?: Partial<FootIKOptions>; look?: LookAtOptions; body?: Body;
  onDispose?: ((character: RigCharacter) => void) | null;
}
export interface RigCharacter extends Character {
  animator: Animator; feet: FootIK | null;
  /** floor height under a point; set it to turn foot placement on (null: off) */
  ground: ((x: number, z: number, y: number) => number | null | undefined) | null;
  /** a world point the head faces, or null */
  lookTarget: THREE.Vector3 | null;
}
/** An imported rigged model as the play character: createPlay(world, { character: () => createRigCharacter(model, clips) }). */
export function createRigCharacter(root: THREE.Object3D, clips: readonly THREE.AnimationClip[], options?: RigCharacterOptions): RigCharacter;
