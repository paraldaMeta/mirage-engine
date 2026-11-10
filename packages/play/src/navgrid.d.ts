import type { WalkGrid } from './walkgrid.js';
import type { GridWalker } from './walker.js';

export type NavPoint = [number, number, number];
export interface NavStats {
  ms?: number; searchMs?: number; found?: boolean; length?: number;
  coarseExpanded?: number; cellExpanded?: number; corridor?: boolean; editMs?: number;
}
export interface NavProfile { radius: number; fit: Uint8Array; ms: number }
export interface NavGridOptions {
  /** cells per coarse block side (1 = plain cell A*); default 4 */
  coarse?: number;
  /** step up (m); default BODY.step 0.4 */
  step?: number;
  /** head room (m); default BODY.head 1.8 */
  head?: number;
  /** largest step down a path may take (m); default = step (no jumping off ledges) */
  drop?: number;
  /** radius baked at creation; default BODY.radius 0.28 (others bake on first use) */
  radius?: number;
}
export interface QueryOptions { radius?: number; snap?: number }
export type NavObstacle = { box: [number, number, number, number, number, number] } | { cylinder: [number, number, number, number, number] };
export interface FlowField {
  goal: NavPoint; radius: number; dist: Float32Array; version: number; reached: number; ms: number;
  /** metres to the goal along the field (Infinity: not reached) */
  distance(x: number, y: number, z: number): number;
  /** unit [dx, dz] to walk from a feet position, [0, 0] at the goal, null off the field */
  direction(x: number, y: number, z: number): [number, number] | null;
  nodeAt(x: number, y: number, z: number): number;
  /** true after a block / unblock: build a new field */
  stale(): boolean;
}
export interface NavGrid {
  /** the walk grid with the dynamic obstacles in (make NPC walkers on this) */
  grid: WalkGrid;
  base: WalkGrid;
  step: number; head: number; drop: number; coarse: number; nodes: number;
  /** bumped by every block / unblock */
  version: number;
  /** create + first fit bake (ms) */
  ms: number;
  /** the last query's numbers */
  stats: NavStats;
  profile(radius?: number): NavProfile;
  nodeAt(x: number, y: number, z: number): number;
  floorOf(node: number): number;
  fits(x: number, y: number, z: number, radius?: number): boolean;
  nearest(p: NavPoint, options?: QueryOptions): NavPoint | null;
  visible(a: NavPoint, b: NavPoint, options?: { radius?: number }): boolean;
  findPath(from: NavPoint, to: NavPoint, options?: QueryOptions & { maxNodes?: number }): NavPoint[] | null;
  flowField(goal: NavPoint, options?: QueryOptions & { maxCost?: number }): FlowField;
  block(shape: NavObstacle): number;
  unblock(id: number): boolean;
  obstacles(): (NavObstacle & { id: number })[];
}
export function createNavGrid(grid: WalkGrid, options?: NavGridOptions): NavGrid;

export interface NavAgent {
  walker: GridWalker; pos: NavPoint; radius: number; speed: number;
  path: NavPoint[] | null; index: number; arrived: boolean; moving: boolean; blocked: boolean;
  separation: number; push: [number, number]; heading: [number, number];
  /** a feet point or a flow field; false when there is no way there */
  setGoal(target: NavPoint | FlowField | null): boolean;
  stop(): void;
  update(dt: number, push?: [number, number]): this;
  place(p: NavPoint): this;
}
export function createNavAgent(nav: NavGrid, options?: { radius?: number; speed?: number; pos?: NavPoint; arrive?: number; separation?: number; snap?: number }): NavAgent;
export interface NavCrowd {
  agents: NavAgent[]; separation: number; range: number;
  add(agent: NavAgent): NavAgent;
  remove(agent: NavAgent): void;
  update(dt: number): void;
}
export function createNavCrowd(nav: NavGrid, options?: { separation?: number; range?: number }): NavCrowd;
