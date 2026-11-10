import type * as THREE from 'three';
export type AnimParam = number | boolean;
/** 'name' (truthy), '!name', 'name > 1.5' (also <, >=, <=, ==, !=), or a function of the parameters. */
export type AnimCondition = string | ((parameters: Record<string, AnimParam>) => boolean);
export interface AnimState {
  /** one clip; without clip or blend the state is empty (a masked layer that lets the layers below through) */
  clip?: string; loop?: boolean; speed?: number;
  /** a parameter that scales playback speed (foot-slide compensation) */
  speedParam?: string;
  /** normalised time (0..1) the state is entered at */
  time?: number;
  blend1d?: { param: string; points: readonly (readonly [value: number, clip: string])[] };
  blend2d?: { x: string; y: string; mode?: 'cartesian' | 'directional'; points: readonly (readonly [x: number, y: number, clip: string])[] };
}
export interface AnimTransition {
  /** a state name, several, or '*' (the default) for any state */
  from?: string | readonly string[]; to: string; when?: readonly AnimCondition[];
  /** normalised time of the source state after which the transition may fire */
  exitTime?: number;
  /** cross-fade seconds (default 0.2) */
  duration?: number; interrupt?: boolean; offset?: number; self?: boolean;
}
export interface AnimLayer {
  name: string; start: string; states: Record<string, AnimState>; transitions?: readonly AnimTransition[];
  weight?: number;
  /** bone names; each masks itself and everything below it */
  mask?: readonly string[];
  /** the layer adds its pose's difference from the clip's first frame instead of replacing */
  additive?: boolean;
}
export interface AnimEvent { name: string; clip?: string; layer: string; state: string; time: number; [key: string]: unknown }
export interface AnimatorOptions {
  /** initial values; 'trigger' declares a parameter that resets once a transition has used it */
  parameters?: Record<string, AnimParam | 'trigger'>;
  layers?: readonly AnimLayer[];
  /** take the clips' travel of `bone` out of the pose and return it from update(); yaw (default true), y (default false) */
  rootMotion?: { bone: string; yaw?: boolean; y?: boolean } | null;
  /** advance in whole steps of this many seconds, whatever dt update() is given */
  fixedStep?: number;
  /** { clipName: [{ time, name }] }, added to each clip's own userData.events */
  events?: Record<string, readonly { time: number; name: string }[]>;
  /** a state lighter than this does not fire its clip events (default 0.5) */
  eventWeight?: number;
  onEvent?: (event: AnimEvent) => void;
}
export interface RootMove { x: number; y: number; z: number; yaw: number }
export interface AnimClipInfo { duration: number; loop: boolean; events: readonly { time: number; name: string }[]; root: { total: [number, number, number] } | null }
export interface Animator {
  root: THREE.Object3D; parameters: Record<string, AnimParam>; clips: Map<string, AnimClipInfo>;
  /** track targets that were not found under root */
  unbound: string[];
  /** called after every pose is written to the bones: IK goes here */
  post: ((animator: Animator) => void)[];
  /** the dt of the last update */
  dt: number;
  readonly time: number;
  set(name: string, value: AnimParam): Animator; get(name: string): AnimParam; trigger(name: string): Animator;
  /** Advance and write the pose. Returns the root travel of this step in the model's frame (zeros without rootMotion); the object is reused. */
  update(dt: number): RootMove;
  /** write the pose at the current time again (after changing a layer weight, or to run the post hooks) */
  evaluate(): void;
  state(layer?: string | number): string; stateTime(layer?: string | number): number; transitioning(layer?: string | number): boolean;
  /** cross-fade to a state directly, outside the transitions */
  play(state: string, options?: { layer?: string | number; duration?: number; offset?: number }): Animator;
  setLayerWeight(layer: string | number, weight: number): Animator;
  /** [clip, weight] of what the layer is playing now */
  weights(layer?: string | number): [string, number][];
  on(name: string, listener: (event: AnimEvent) => void): () => void;
  /** Show one clip at time t, outside the state machine (scrubbing, a timeline). weight < 1 blends onto the pose
   *  held from the last call; apply false holds the pose without writing bones. */
  poseClip(name: string, t: number, weight?: number, apply?: boolean): Animator;
  reset(): Animator;
  snapshot(): unknown; restore(snapshot: unknown): Animator;
  /** the flat pose buffer last written (positions, quaternions, scales of the animated nodes) */
  pose(): Float32Array;
}
/** Weights of the 1D samples at `x` (the two neighbours, linear). */
export function blend1d(points: readonly number[], x: number, out?: Float32Array): Float32Array;
/** Weights of 2D samples at (x, y): 'cartesian' (gradient band) or 'directional' (by direction and magnitude). */
export function blend2d(points: readonly (readonly [number, number])[], x: number, y: number, mode?: 'cartesian' | 'directional', out?: Float32Array): Float32Array;
export function createAnimator(root: THREE.Object3D, clips: readonly THREE.AnimationClip[], options?: AnimatorOptions): Animator;
/** A root-motion step as walker input: move (model frame) turned to `heading`, as the x/z the walker multiplies by speed and dt. */
export function rootMotionInput<T extends object>(move: RootMove, heading: number, body: { walk: number }, dt: number, out?: T): T & { x: number; z: number; run: boolean };
