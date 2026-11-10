import type * as THREE from 'three';
import type { PhysicsKit, KitBody, Layer, QueryFilter, PhysicsMaterial } from './physics-kit.js';
import type { PhysicsCharacter } from './physics.js';
type V3 = readonly [number, number, number];
export interface WaterVolume {
  min: number[]; max: number[]; density: number; drag: number; angularDrag: number; flow: V3 | null; readonly level: number;
  /** Awake bodies in the water at the last step. */
  inside: number; remove(): void;
}
export interface ExplosionHit { body: KitBody | null; impulse: number; distance: number }
export interface Platform { body: KitBody; path: number[][]; speed: number; mode: 'pingpong' | 'loop'; spin: number; t: number; paused: boolean; readonly pos: [number, number, number]; remove(): void }
export interface Forces {
  waters: WaterVolume[]; platforms: Platform[];
  water(box: { min: V3; max: V3 }, options?: { density?: number; drag?: number; angularDrag?: number; flow?: V3 | null }): WaterVolume;
  /** A radial impulse (N s at the centre, falling off to the radius) on every dynamic body in range. */
  explosion(center: V3, options?: { radius?: number; impulse?: number; falloff?: 'linear' | 'square' | 'none'; upward?: number; occlude?: boolean; filter?: QueryFilter | null }): ExplosionHit[];
  platform(obj: THREE.Object3D | KitBody | null, options?: { path?: V3[]; speed?: number; mode?: 'pingpong' | 'loop'; spin?: number; half?: V3; material?: string | Partial<PhysicsMaterial>; layer?: Layer; mask?: Layer[]; name?: string }): Platform;
  /** The phys.character() rides kinematic platforms. */
  carry(character: PhysicsCharacter): { character: PhysicsCharacter; on: Platform | null; yaw: number; remove(): void };
  dispose(): void;
}
export function createForces(kit: PhysicsKit): Forces;
