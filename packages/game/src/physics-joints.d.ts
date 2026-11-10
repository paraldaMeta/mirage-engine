import type { RigidBody } from '#rapier';
import type { PhysicsKit, KitBody } from './physics-kit.js';
type V3 = readonly [number, number, number];
type BodyLike = KitBody | RigidBody | { body: RigidBody };
export type JointMotor = { speed: number; strength?: number } | { target: number; stiffness?: number; damping?: number };
export interface JointOptions {
  /** World space, at the moment of creation; anchorA / anchorB when the two differ (spring, rope). */
  anchor?: V3; anchorA?: V3; anchorB?: V3;
  /** Newtons, against an estimate of the force the joint carries; a 'break' event on the kit when it goes. */
  breakForce?: number; contacts?: boolean; name?: string;
}
export type AxisLimit = 'locked' | 'free' | readonly [number, number];
export interface Joint {
  readonly id: number; type: 'fixed' | 'ball' | 'cone' | 'hinge' | 'slider' | 'spring' | 'rope' | 'sixDof'; name: string;
  a: BodyLike | null; b: BodyLike; readonly bodyA: RigidBody; readonly bodyB: RigidBody; alive: boolean;
  /** The last estimate, N (only kept up to date while some joint has a breakForce). */
  force: number; breakForce: number | null;
  /** Hinge: radians from the pose at creation. Slider: metres along the axis. Spring, rope: anchor distance. */
  readonly angle: number; readonly travel: number; readonly length: number;
  /** Cone: the last measured swing from the centre and twist, radians. */
  swingAngle?: number; twistAngle?: number;
  setLimits(min: number, max: number, axis?: number): this; setMotor(motor: JointMotor | null, axis?: number): this; setContacts(on: boolean): this;
  remove(): void;
}
export interface Joints {
  all: Map<number, Joint>;
  /** a = null pins b to the world. */
  fixed(a: BodyLike | null, b: BodyLike, options?: JointOptions): Joint;
  ball(a: BodyLike | null, b: BodyLike, options?: JointOptions & { limits?: Partial<Record<'x' | 'y' | 'z', readonly [number, number]>> }): Joint;
  /** A ball whose `axis` (in b) stays within `swing` radians of `centre` (in a) and turns at most `twist` about itself. */
  cone(a: BodyLike | null, b: BodyLike, options?: JointOptions & { axis?: V3; centre?: V3; swing?: number; twist?: number | [number, number] }): Joint;
  hinge(a: BodyLike | null, b: BodyLike, options?: JointOptions & { axis?: V3; limits?: readonly [number, number]; motor?: JointMotor }): Joint;
  slider(a: BodyLike | null, b: BodyLike, options?: JointOptions & { axis?: V3; limits?: readonly [number, number]; motor?: JointMotor }): Joint;
  spring(a: BodyLike | null, b: BodyLike, options?: JointOptions & { rest?: number; stiffness?: number; damping?: number }): Joint;
  rope(a: BodyLike | null, b: BodyLike, options?: JointOptions & { length?: number }): Joint;
  sixDof(a: BodyLike | null, b: BodyLike, options?: JointOptions & { axis?: V3; linear?: Partial<Record<'x' | 'y' | 'z', AxisLimit>>; angular?: Partial<Record<'x' | 'y' | 'z', AxisLimit>> }): Joint;
  forget(body: BodyLike): void; dispose(): void;
}
/** One per kit: a second call returns the same object. */
export function createJoints(kit: PhysicsKit): Joints;
