import type * as THREE from 'three';
import type { PhysicsKit, KitBody, Layer, PhysicsMaterial } from './physics-kit.js';
import type { Joint } from './physics-joints.js';
type V3 = readonly [number, number, number];
/** One body of the ragdoll: see the table at the top of ragdoll.js for the shape, mass and joint fields. */
export interface RagdollPartSpec { bone: string; parent?: string; [key: string]: unknown }
export const RAGDOLL_HUMANOID: RagdollPartSpec[];
export interface RagdollPart {
  name: string; bone: THREE.Object3D; body: KitBody; parent: RagdollPart | null; joint: Joint | null; dynamic: boolean;
  /** The animation's pose of this bone, world space. */
  ap: THREE.Vector3; aq: THREE.Quaternion;
}
export interface RagdollOptions {
  parts?: RagdollPartSpec[]; mass?: number; material?: string | Partial<PhysicsMaterial>; layer?: Layer; mask?: Layer[];
  damping?: number; angularDamping?: number; ccd?: boolean; events?: boolean; hitboxes?: boolean;
  /** Help a fallen ragdoll to rest: damp it, then put it to sleep (speed 0.35 m/s, time 0.8 s). Default false. */
  settle?: false | { speed?: number; time?: number };
  /** A figure moved further than this in one step is placed, not swept (0.6 m). */
  jump?: number;
}
export interface Ragdoll {
  parts: Record<string, RagdollPart>; list: RagdollPart[]; root: THREE.Object3D;
  readonly mode: 'animated' | 'ragdoll' | 'partial'; strength: number; pin: number; readonly atRest: boolean;
  /** After anim.update and kit.advance, every frame. */
  update(dt: number): void;
  ragdoll(options?: { velocity?: V3 }): this;
  partial(bones: string | string[], on?: boolean, options?: { below?: boolean; blend?: number; limp?: boolean }): this;
  animate(options?: { blend?: number }): this;
  /** Active ragdoll: strength 0..1 pulls rotations to the animation, pin 0..1 positions. */
  drive(strength: number, pin?: number): this;
  impulse(part: string, j: V3, at?: V3): this; partOf(body: KitBody | null): string | null;
  pose(): { pos: [number, number, number]; yaw: number; faceUp: boolean; lying: boolean };
  dispose(): void;
}
export function createRagdoll(kit: PhysicsKit, root: THREE.Object3D, options?: RagdollOptions): Ragdoll;
