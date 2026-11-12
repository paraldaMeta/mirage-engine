import type { WalkGrid } from './walkgrid.js';
import type { NavGrid, NavPoint } from './navgrid.js';

type Vec3Like = ArrayLike<number> | { x: number; y: number; z: number };

export interface PickWalkGridOptions {
  /** the floor must fit a body of `radius` (nav.fits) */
  nav?: NavGrid | null;
  radius?: number;
  /** metres along the ray (160), the first sample (0.5), the march step (0.25) */
  maxDist?: number; start?: number; step?: number;
  /** how far below a floor's top a sample still counts as on it, and above it a floor is looked for (0.6) */
  reach?: number;
  /** true: a hit at this point does not count (e.g. cutaway.hides) */
  skip?: ((x: number, y: number, z: number) => boolean) | null;
}
/** The first walkable floor along a ray: [x, floor y, z], or null. */
export function pickWalkGrid(grid: Pick<WalkGrid, 'groundAt'>, ray: { origin: Vec3Like; direction: Vec3Like }, options?: PickWalkGridOptions): [number, number, number] | null;

export interface ReachableOptions {
  radius?: number;
  /** where the walker is (its height picks the rings' floor; nav.findPath from it without tryGoal) */
  from?: Vec3Like | null;
  /** is q reachable (agent.setGoal returns exactly that) */
  tryGoal?: ((q: NavPoint) => boolean) | null;
  /** ring radii round the point (0.6, 1.2, 1.8, 2.6, 3.6 m) */
  rings?: readonly number[];
  /** nav.nearest's snap (0.6) */
  snap?: number;
  /** most height difference from the walker for a ring point (1.5 m) */
  climb?: number;
}
/** A reachable goal at or near p, or null. */
export function reachableGoal(nav: NavGrid, p: Vec3Like, options?: ReachableOptions): [number, number, number] | null;
