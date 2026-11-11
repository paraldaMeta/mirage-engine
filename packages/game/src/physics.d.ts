import type * as THREE from 'three';
import type { Collider, RigidBody, KinematicCharacterController, World } from '#rapier';
import type { XYZ } from '@miragekit/world';
import type { Body, WalkerLike, MotionInput } from '@miragekit/play/walker';
// The runtime returns Rapier's declared default API in both module resolution modes.
type RapierAPI = typeof import('#rapier')['default'];
export type { Collider, RigidBody, KinematicCharacterController, World } from '#rapier';
export function loadRapier(): Promise<RapierAPI>;
export interface PhysicsBody extends Body { stride: number }
export interface PhysicsCharacter extends WalkerLike {
  body: PhysicsBody; collider: Collider; controller: KinematicCharacterController;
  walked: number; surface: string; onStride: ((surface: string, run: boolean | undefined) => void) | null;
  update(dt: number, input?: MotionInput): this;
  /** Replaces pos and resets movement; exact skips the ground ray used by normal placement. */
  place(position: XYZ, options?: { exact?: boolean }): this;
}
export interface PropState { p: XYZ; q: readonly [number, number, number, number] }
export interface DynamicProp<O extends THREE.Object3D = THREE.Object3D> {
  body: RigidBody; obj: O; readonly pos: [number, number, number];
  get state(): { p: [number, number, number]; q: [number, number, number, number] };
  set state(value: PropState);
}
export interface Hinge<O extends THREE.Object3D = THREE.Object3D> {
  body: RigidBody; obj: O; angle: number; target: number; swing: number; speed: number;
  base: THREE.Quaternion; offset: THREE.Vector3; readonly isOpen: boolean;
  open(): void; close(): void; toggle(): void; set(open: boolean): void;
}
export interface RayHit { point: [number, number, number]; distance: number; surface: string; object: THREE.Object3D | undefined }
export interface Physics {
  dispose(): void;
  R: RapierAPI; world: World; stats: { colliders: number; triangles: number; buildMs: number };
  info: Map<number, { surface: string; object: THREE.Object3D }>; hinges: Hinge[];
  addStatic(root?: THREE.Object3D): void;
  body<O extends THREE.Object3D>(object: O, options?: { shape?: 'box' | 'ball'; mass?: number; friction?: number; restitution?: number; damping?: number }): DynamicProp<O>;
  hinge<O extends THREE.Object3D>(object: O, options: { half: XYZ; offset?: XYZ; swing?: number; speed?: number }): Hinge<O>;
  character(options?: { pos?: XYZ; body?: Partial<PhysicsBody>; onPlace?: () => void }): PhysicsCharacter;
  /** Explicit low-level step, not a fixed-clock accumulator. startGame supplies the 60 Hz clock. */
  step(dt: number): boolean;
  /** Step until every dynamic prop sleeps (at most maxSteps of 1/60 s); returns the steps taken. */
  settle(maxSteps?: number): number;
  ray(from: XYZ, direction: XYZ, max?: number, exclude?: Collider): RayHit | null;
  /** The whole physics state. `canonical` (default true) also replaces the live world by the snapshot, so that
   *  carrying on and restoring later are the same computation (docs/physics.md). */
  snapshot(options?: { canonical?: boolean }): PhysicsSnapshot;
  /** Back to a snapshot. `world` and every `body` are new objects afterwards (handles are kept). */
  restore(snapshot: PhysicsSnapshot): void;
  /** Hooks of the physics kit (physics-kit.js); empty without it. */
  ext: PhysicsExt;
}
export interface PhysicsSnapshot { bytes: Uint8Array; hinges: [number, number][]; chars: unknown[]; ext: Record<string, unknown> }
export interface PhysicsExt {
  queue: import('#rapier').EventQueue | undefined;
  pre: ((dt: number) => void)[]; post: ((dt: number) => boolean | void)[];
  save: Record<string, () => unknown>; load: Record<string, (state: any) => void>; rebind: (() => void)[];
}
export function createPhysics(scene: THREE.Object3D, options?: { gravity?: number }): Promise<Physics>;
