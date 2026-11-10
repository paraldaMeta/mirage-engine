import type * as THREE from 'three';

/** What the interaction is fed per hand or controller each frame. */
export interface XRPointer {
  id: string | number;
  /** The grip pose in the world (what a held object follows). */
  grip: THREE.Matrix4;
  /** The aiming ray. */
  origin?: THREE.Vector3; dir?: THREE.Vector3;
  /** A fingertip (or the controller's tip) for poking. */
  tip?: THREE.Vector3;
  grab?: boolean; select?: boolean;
  /** Haptics: strength 0..1, milliseconds. */
  pulse?: (strength: number, ms: number) => void;
}
export interface XRInteractionOptions {
  /** @mirage/game createPhysics (optional): held bodies turn kinematic, thrown ones dynamic. */
  physics?: unknown;
  /** Near-grab reach beyond an object's radius (0.1 m); far-grab distance along the ray (6 m); far grab at all. */
  reach?: number; rayReach?: number; ray?: boolean;
  /** Without physics: gravity of a thrown object (9.81) and the ground under (x, z) it lands on. */
  gravity?: number; ground?: ((x: number, z: number) => number) | null;
  throwScale?: number;
  /** Seconds of hand motion a throw's velocity is the mean of. Default 0.1. */
  window?: number;
}
export interface XRGrabbableOptions {
  /** physics.js handle or a Rapier RigidBody. */
  body?: unknown; radius?: number; twoHanded?: boolean;
  /** Two-handed scale range [min, max] (ignored with a body). */
  scale?: [number, number]; ray?: boolean;
  onGrab?: (object: THREE.Object3D, pointerId: string | number, hands: number) => void;
  onRelease?: (object: THREE.Object3D, pointerId: string | number, handsLeft: number, velocity: THREE.Vector3, angular: THREE.Vector3) => void;
  onHover?: (object: THREE.Object3D, on: boolean) => void;
  onLand?: (object: THREE.Object3D) => void;
}
export interface XRSnapZoneOptions {
  position?: readonly [number, number, number]; object?: THREE.Object3D; radius?: number;
  accepts?: (object: THREE.Object3D) => boolean;
  onSnap?: (object: THREE.Object3D, zone: unknown) => void; onUnsnap?: (object: THREE.Object3D, zone: unknown) => void;
}
/** The part of a ui-canvas panel (@mirage/game createCanvasUI) the interaction drives. */
export interface XRPanelLike { pointerUV(uv: { x: number; y: number }, down: boolean): unknown; pointer(x: number, y: number, down: boolean): unknown }
export interface XRInteractionState {
  time: number;
  pointers: { id: string | number; held: string | true | null; hover: string | true | null; far: boolean; ui: boolean }[];
  items: { name: string; holders: number; snapped: boolean; flying: boolean; pos: [number, number, number]; scale: number }[];
  panels: (string | number | null)[];
  grabs: number; throws: number; snaps: number; presses: number; pulses: number;
}
export interface XRInteraction {
  update(dt: number, pointers: XRPointer[]): void;
  stats: { grabs: number; throws: number; snaps: number; presses: number; pulses: number };
  options: Required<XRInteractionOptions>;
  grabbable(object: THREE.Object3D, options?: XRGrabbableOptions): unknown;
  snapZone(options?: XRSnapZoneOptions): unknown;
  /** A ui-canvas panel and its mesh (ui.mesh()): by ray + select, by fingertip, or both (default). */
  panel(ui: XRPanelLike, mesh: THREE.Mesh, options?: { ray?: boolean; poke?: boolean }): unknown;
  pokeable(object: THREE.Object3D, options?: { radius?: number; onPress?: (object: THREE.Object3D, pointerId: string | number) => void; onRelease?: (object: THREE.Object3D) => void }): unknown;
  /** By the registration returned, its object or its panel. */
  remove(what: unknown): void;
  held(pointerId: string | number): THREE.Object3D | null;
  busy(pointerId: string | number): boolean;
  /** Release everything (a session ended). */
  reset(): void;
  state(): XRInteractionState;
  readonly pointers: XRPointer[];
}
export function createXRInteraction(options?: XRInteractionOptions): XRInteraction;
/** A hand's velocity for a throw: poses over the last `window` s. */
export function createVelocityTracker(window?: number, capacity?: number): {
  reset(): void; push(t: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  /** Linear (m/s) and angular (rad/s, world axis); false with fewer than two samples. */
  read(linear: THREE.Vector3, angular: THREE.Vector3): boolean;
};
/** Two hands on one object: the world transform from the hands then (a0, b0) to now (a1, b1). Returns the scale applied. */
export function twoHandTransform(a0: THREE.Vector3, b0: THREE.Vector3, a1: THREE.Vector3, b1: THREE.Vector3, out: THREE.Matrix4, range?: readonly [number, number] | null, scale0?: number): number;
export interface PokeState { over?: boolean; u?: number; v?: number; down?: boolean; front?: boolean }
export const POKE: { hover: number; press: number; release: number; back: number };
/** A fingertip (`local`: in the panel's space) against a panel of width x height m facing +z. */
export function pokeTest<S extends PokeState>(local: { x: number; y: number; z: number }, width: number, height: number, state: S, thresholds?: typeof POKE): S;
