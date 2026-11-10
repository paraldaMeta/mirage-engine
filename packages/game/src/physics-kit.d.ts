import type * as THREE from 'three';
import type { RigidBody, Collider } from '#rapier';
import type { Physics } from './physics.js';
import type { Joint, Joints } from './physics-joints.js';
type RapierAPI = typeof import('#rapier')['default'];
type V3 = readonly [number, number, number];
type Q4 = readonly [number, number, number, number];
export type CombineRule = 'average' | 'min' | 'multiply' | 'max';
export interface PhysicsMaterial { friction: number; restitution: number; density: number; frictionCombine?: CombineRule; restitutionCombine?: CombineRule }
export const PHYSICS_MATERIALS: Record<'default' | 'wood' | 'stone' | 'metal' | 'rubber' | 'ice', PhysicsMaterial>;
export type Layer = string | number;
export type ShapeName = 'box' | 'ball' | 'capsule' | 'cylinder' | 'cone' | 'hull' | 'mesh';
export interface ColliderSpec {
  shape?: ShapeName; half?: V3; radius?: number; height?: number; axis?: 'x' | 'y' | 'z';
  points?: ArrayLike<number>; vertices?: ArrayLike<number>; indices?: ArrayLike<number>;
  pos?: V3; rot?: Q4; sensor?: boolean; mass?: number; density?: number; friction?: number; restitution?: number;
  frictionCombine?: CombineRule; restitutionCombine?: CombineRule; layer?: Layer; mask?: Layer[];
}
export interface RigidOptions extends Omit<ColliderSpec, 'shape' | 'pos' | 'rot' | 'layer' | 'mask'> {
  type?: 'dynamic' | 'fixed' | 'kinematic';
  /** 'compound': one collider per child mesh of the object (`part` names their shape, default 'box'). */
  shape?: ShapeName | 'compound'; part?: ShapeName; colliders?: ColliderSpec[];
  pos?: V3; quat?: Q4; velocity?: V3; spin?: V3;
  material?: string | Partial<PhysicsMaterial>; layer?: Layer; mask?: Layer[] | null;
  /** true: swept (never tunnels); 'soft': predictive contacts within ccdDistance (cheaper). */
  ccd?: boolean | 'soft'; ccdDistance?: number;
  events?: boolean; com?: V3; damping?: number; angularDamping?: number; gravityScale?: number; canSleep?: boolean; sleeping?: boolean;
  lockRotation?: true | [boolean, boolean, boolean]; lockPosition?: [boolean, boolean, boolean]; dominance?: number;
  interpolate?: boolean; name?: string; surface?: string; userData?: unknown;
}
export interface BodyState { p: number[]; q: number[]; v?: number[]; w?: number[] }
export interface KitBody<O extends THREE.Object3D | null = THREE.Object3D | null> {
  readonly id: number; readonly body: RigidBody; obj: O; type: 'dynamic' | 'fixed' | 'kinematic'; layer: Layer; mask: Layer[] | null;
  colliders: number[]; events: boolean; alive: boolean; name: string; surface: string; userData: unknown;
  readonly pos: [number, number, number]; readonly quat: [number, number, number, number];
  velocity: number[]; spin: number[]; readonly mass: number; readonly sleeping: boolean;
  /** N s at the centre of mass, or at a world point. */
  impulse(j: V3, at?: V3): this; twist(j: V3): this; wake(): this; sleep(): this;
  teleport(p: V3, q?: Q4, stop?: boolean): this;
  /** Kinematic bodies: where to be after the next step. */
  moveTo(p?: V3 | null, q?: Q4): this;
  setLayer(layer: Layer, mask?: Layer[]): this; setCcd(on: boolean): this; setEvents(on?: boolean): this;
  state: BodyState; remove(): void;
}
export interface QuerySide { body: KitBody | null; object: THREE.Object3D | undefined; surface: string; collider: number }
export interface QueryFilter {
  layers?: Layer[]; exclude?: KitBody | RigidBody | Collider; sensors?: boolean; fixed?: boolean; dynamic?: boolean; kinematic?: boolean;
  test?: (side: QuerySide) => boolean;
}
export interface QueryHit extends QuerySide { point: [number, number, number]; normal: [number, number, number]; distance: number }
export interface QueryShape { shape?: 'box' | 'ball' | 'capsule' | 'cylinder'; half?: V3; radius?: number; height?: number; rot?: Q4 }
export interface Sensor {
  readonly id: number; name: string; userData: unknown; readonly count: number; bodies(): KitBody[];
  onEnter: ((e: SensorEvent) => void) | null; onExit: ((e: SensorEvent) => void) | null; remove(): void;
}
export interface SensorEvent extends QuerySide { sensor: Sensor }
export interface ContactEvent {
  a: KitBody | null; b: KitBody | null; objectA?: THREE.Object3D; objectB?: THREE.Object3D; surfaceA: string; surfaceB: string;
  colliderA: number; colliderB: number;
  /** N s of the step the contact began in (force x dt); bodies need `events: true` to report. */
  impulse: number; force: number; point: [number, number, number] | null; normal: [number, number, number] | null; speed: number;
}
export interface KitStats { bodies: number; dynamic: number; awake: number; colliders: number; joints: number; sensors: number; stepMs: number; stepMsAvg: number; rapierMs: number; steps: number }
export interface KitEvents {
  contact: ContactEvent; contactEnd: Pick<ContactEvent, 'a' | 'b' | 'objectA' | 'objectB' | 'colliderA' | 'colliderB'>;
  enter: SensorEvent; exit: SensorEvent; break: { joint: Joint; force: number }; step: number; stepped: number;
}
export interface PhysicsKit {
  phys: Physics; R: RapierAPI; hz: number; bodies: Map<number, KitBody>; sensors: Map<number, Sensor>; time: number; steps: number;
  joints: Joints | null; readonly alpha: number;
  on<K extends keyof KitEvents>(type: K, fn: (e: KitEvents[K]) => void): () => void;
  emit(type: string, e: unknown): void; wantEvents(): void;
  layers: {
    names: string[]; bit(name: Layer): number; bits(names?: Layer | Layer[] | null): number; groups(layer: Layer, mask?: Layer[] | null): number;
    collide(a: Layer, b: Layer, on?: boolean): void; collides(a: Layer, b: Layer): boolean;
    assign(collider: Collider, layer: Layer, mask?: Layer[]): void; assignStatic(layer: Layer): void;
  };
  material(name: string, def?: Partial<PhysicsMaterial>): PhysicsMaterial;
  rigid<O extends THREE.Object3D | null>(obj: O, options?: RigidOptions): KitBody<O>;
  bodyOf(colliderHandle: number): KitBody | null;
  sensor(spec: ColliderSpec, options?: { on?: KitBody | null; layer?: Layer; mask?: Layer[] | null; name?: string; userData?: unknown }): Sensor;
  ray(from: V3, dir: V3, max?: number, filter?: QueryFilter): QueryHit | null;
  rayAll(from: V3, dir: V3, max?: number, filter?: QueryFilter): QueryHit[];
  shapeCast(shape: QueryShape, from: V3, dir: V3, max?: number, filter?: QueryFilter): QueryHit | null;
  overlap(shape: QueryShape, pos: V3, filter?: QueryFilter): QuerySide[];
  closest(point: V3, filter?: QueryFilter): (QuerySide & { point: [number, number, number]; distance: number; inside: boolean }) | null;
  /** Fixed steps of 1 / hz for a frame of dt seconds, then interpolated render transforms; returns the steps taken. */
  advance(dt: number): number; interpolate(alpha: number): void;
  /** FNV-1a over every body's pose and velocities. */
  hash(): string; stats(): KitStats; dispose(): void;
}
export function createPhysicsKit(phys: Physics, options?: { hz?: number; maxSteps?: number; interpolate?: boolean; layers?: string[]; profile?: boolean }): PhysicsKit;
