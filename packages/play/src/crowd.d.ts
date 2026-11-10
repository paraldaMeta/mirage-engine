import type { NavGrid, NavPoint, NavLink, FlowField, PathOptions } from './navgrid.js';
import type { PathQueue } from './nav-path.js';

/** what ai.js behaviours drive: crowd.actor(i) or agentActor(navAgent) */
export interface Actor {
  pos: ArrayLike<number>; heading: ArrayLike<number>; radius: number;
  moveTo(p: NavPoint): boolean; stop(): void;
  readonly arrived: boolean; readonly moving: boolean; speed: number;
  readonly onLink?: boolean; readonly noPath?: boolean;
  [key: string]: any;
}
export interface CrowdOptions {
  /** capacity (512) */
  max?: number;
  /** nearest agents avoided (8), within `range` metres (2.5), looking `horizon` seconds ahead (1.2) */
  neighbours?: number; range?: number; horizon?: number;
  /** metres from the goal that count as there (0.2) */
  arrive?: number;
  /** wall-clock ms of path queries an update (1); or bring a queue */
  pathBudgetMs?: number;
  queue?: PathQueue;
  /** radii are rounded UP to this for everything asked of the nav (one fit profile per distinct radius); 0.05 m */
  radiusStep?: number;
}
export interface Crowd {
  x: Float64Array; y: Float64Array; z: Float64Array; vx: Float64Array; vz: Float64Array; radius: Float64Array; speed: Float64Array;
  /** 0 free, 1 idle, 2 on a path, 3 on a field, 4 wish, 5 on a link, 6 fixed, 7 waiting for a path */
  state: Uint8Array;
  queue: PathQueue; max: number; count: number;
  /** -> the agent's index, -1 when full */
  add(agent?: { pos?: ArrayLike<number>; radius?: number; speed?: number; fixed?: boolean } & Pick<PathOptions, 'costs' | 'canUse'>): number;
  remove(i: number): void;
  setGoal(i: number, p: NavPoint): boolean;
  setField(i: number, field: FlowField): boolean;
  setVelocity(i: number, vx: number, vz: number): void;
  stop(i: number): void;
  /** a fixed agent (the player): where it is now */
  move(i: number, x: number, y: number, z: number, dt?: number): void;
  place(i: number, p: NavPoint): void;
  arrived(i: number): boolean;
  pathOf(i: number): NavPoint[] | null;
  waypoint(i: number): number;
  linkOf(i: number): NavLink | null;
  heading(i: number, out?: [number, number]): [number, number];
  position(i: number, out?: NavPoint): NavPoint;
  actor(i: number): Actor;
  onLink: ((i: number, link: NavLink, phase: 'start' | 'end') => void) | null;
  onNoPath: ((i: number) => void) | null;
  update(dt: number): void;
}
export function createCrowd(nav: NavGrid, options?: CrowdOptions): Crowd;
