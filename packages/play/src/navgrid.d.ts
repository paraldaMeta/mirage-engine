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
/** `costs`: metres-worth per metre by area id for this query (Infinity: closed); `canUse`: false refuses an off-mesh link */
export interface PathOptions extends QueryOptions { maxNodes?: number; costs?: Record<number, number> | Float32Array; canUse?: (link: NavLink) => boolean }
/** box [x0, y0, z0, x1, y1, z1], cylinder [x, z, r, y0, y1], obb [x, z, halfX, halfZ, yaw, y0, y1] (yaw as three's rotation.y) */
export type NavObstacle = { box: [number, number, number, number, number, number] } | { cylinder: [number, number, number, number, number] } | { obb: [number, number, number, number, number, number, number] };
export interface NavLinkDef {
  from: NavPoint; to: NavPoint;
  /** metres-worth (default: the distance) */
  cost?: number;
  bidirectional?: boolean;
  /** 'jump' | 'ladder' | 'door' | yours */
  type?: string;
  /** seconds to cross (default: the length at the agent's speed) */
  time?: number;
  radius?: number; snap?: number;
  /** false holds an agent at the near end (a door still shut) */
  canEnter?: (agent: any, link: NavLink) => boolean | void;
  /** the position at f in 0..1, in place of a straight line */
  traverse?: (f: number, link: NavLink, agent: any) => NavPoint;
  [key: string]: any;
}
export interface NavLink extends NavLinkDef { id: number; type: string; bidirectional: boolean; cost: number }
/** what a waypoint's `.link` holds: the ends in travel order */
export interface NavLinkView { from: NavPoint; to: NavPoint; reverse: boolean; link: NavLink }
export type NavWaypoint = NavPoint & { link?: NavLinkView };
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
  /** a waypoint that ends an off-mesh link carries `.link` */
  findPath(from: NavPoint, to: NavPoint, options?: PathOptions): NavWaypoint[] | null;
  flowField(goal: NavPoint, options?: QueryOptions & { maxCost?: number }): FlowField;
  block(shape: NavObstacle): number;
  unblock(id: number): boolean;
  obstacles(): (NavObstacle & { id: number })[];
  /** mark the nodes inside a shape as area `id` (0..255, 0: plain ground); returns how many */
  setArea(shape: NavObstacle, id: number): number;
  /** what a metre in the area costs (1: plain, Infinity: closed; keep >= 1) */
  setAreaCost(id: number, cost: number): void;
  areaCosts: Float32Array;
  areaAt(x: number, y: number, z: number): number;
  areaOf(node: number): number;
  /** an off-mesh link; null when an end is not on walkable floor */
  link(def: NavLinkDef): NavLink | null;
  unlink(link: NavLink | number): boolean;
  links(): NavLink[];
  /** every node, for debug views */
  eachNode(fn: (x: number, y: number, z: number, node: number, fits: boolean, area: number, blocked: boolean) => void, options?: { radius?: number }): void;
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
export function createNavAgent(nav: NavGrid, options?: { radius?: number; speed?: number; pos?: NavPoint; arrive?: number; separation?: number; snap?: number;
  costs?: PathOptions['costs']; canUse?: PathOptions['canUse']; onLink?: (agent: NavAgent, link: NavLink, phase: 'start' | 'end') => void }): NavAgent;
export interface NavCrowd {
  agents: NavAgent[]; separation: number; range: number;
  add(agent: NavAgent): NavAgent;
  remove(agent: NavAgent): void;
  update(dt: number): void;
}
export function createNavCrowd(nav: NavGrid, options?: { separation?: number; range?: number }): NavCrowd;
