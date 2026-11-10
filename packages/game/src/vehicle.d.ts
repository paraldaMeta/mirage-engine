import type * as THREE from 'three';
import type { PhysicsKit, KitBody, Layer, PhysicsMaterial } from './physics-kit.js';
type V3 = readonly [number, number, number];
export interface WheelSpec { pos: V3; steer?: boolean; drive?: boolean; brake?: boolean; handbrake?: boolean; radius?: number; rest?: number; obj?: THREE.Object3D }
export interface Wheel {
  pos: number[]; radius: number; rest: number; steer: boolean; drive: boolean; obj: THREE.Object3D | null;
  contact: boolean; compression: number; length: number; load: number; spin: number; slip: number; point: number[]; normal: number[];
}
export interface VehicleOptions {
  half?: V3; mass?: number; com?: V3; pos?: V3; quat?: readonly [number, number, number, number]; body?: KitBody;
  wheels?: WheelSpec[]; radius?: number; rest?: number; sag?: number; dampingRatio?: number; stiffness?: number; damping?: number;
  engine?: number; brake?: number; topSpeed?: number; reverseSpeed?: number; maxSteer?: number; steerSpeed?: number; steerFade?: number;
  grip?: number; rollInfluence?: number; rolling?: number;
  material?: string | Partial<PhysicsMaterial>; layer?: Layer; mask?: Layer[]; ccd?: boolean; events?: boolean; name?: string;
}
export interface Vehicle {
  body: KitBody; obj: THREE.Object3D | null; wheels: Wheel[];
  /** throttle -1..1, steer -1..1 (positive: right), brake 0..1. Forward is the body's +z. */
  controls: { throttle: number; steer: number; brake: number; handbrake: boolean };
  steerAngle: number; readonly speed: number; readonly grounded: number;
  engine: number; brake: number; topSpeed: number; reverseSpeed: number; maxSteer: number; grip: number;
  place(pos: V3, quat?: readonly [number, number, number, number]): this; dispose(): void;
}
export function createVehicle(kit: PhysicsKit, obj: THREE.Object3D | null, options?: VehicleOptions): Vehicle;
