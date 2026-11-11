import type { WalkGrid } from './walkgrid.js';
import type { GridBody, GridWalker, MotionInput } from './walker.js';
import type { Solid, SolidSpace, Volume } from './solids.js';

export interface MoverBody extends GridBody {
  sprint: number; crouchSpeed: number; crouchHead: number; crouchEye: number;
  /** seconds a jump still works after walking off an edge / before landing */
  coyote: number; buffer: number;
  /** the rise kept when jump is released early (0..1) */
  jumpCut: number;
  /** steepest walkable slope (degrees), then the slide's acceleration and top speed */
  slope: number; slideAccel: number; slideMax: number;
  climb: number; climbSide: number; swim: number; swimUp: number; swimDepth: number; swimFloat: number;
  mantleMax: number; mantleReach: number; mantleTime: number;
  /** newtons applied to a dynamic solid walked into */
  push: number;
}
export const MOVER: MoverBody;
export type MoverMode = 'idle' | 'walk' | 'run' | 'sprint' | 'crouch' | 'jump' | 'fall' | 'slide' | 'climb' | 'swim' | 'mantle';
export const MODES: MoverMode[];
export interface MoverInput extends MotionInput { sprint?: boolean; crouch?: boolean }
/** opaque: what restore() takes */
export interface MoverState { x: number; y: number; z: number; vy: number; onGround: boolean; [key: string]: unknown }
export interface Mover extends GridWalker {
  body: MoverBody;
  mode: MoverMode;
  /** m/s over the ground */
  speed: number;
  crouched: boolean; sliding: boolean; swimming: boolean;
  /** crouched under a ceiling too low to stand */
  squeezed: boolean;
  /** eased eye height */
  eye: number;
  /** what the platform under it moved it by this step: [dx, dy, dz, dyaw] */
  carry: [number, number, number, number];
  /** merged into every input */
  intent: { crouch?: boolean; sprint?: boolean };
  /** the solid stood on, or null */
  ground: Solid | null;
  /** 'jump' / 'land' on the step they happen */
  events: string[];
  update(dt: number, input?: MoverInput): this;
  save(): MoverState;
  restore(state: MoverState): this;
}
export function createMover(grid: WalkGrid | SolidSpace, options?: { pos?: ArrayLike<number>; body?: Partial<MoverBody>; volumes?: Volume[] }): Mover;
/** sets speed / vy / grounded / crouch / mode and one parameter per mode name; triggers 'jump' and 'land' */
export function driveAnimator<A extends { set(name: string, value: number): A; trigger(name: string): unknown }>(mover: Mover, animator: A): A;
