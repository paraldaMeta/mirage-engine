import type { NavGrid, NavPoint, PathOptions } from './navgrid.js';

export interface PathJob extends Promise<NavPoint[] | null> { cancel(): void }
export interface PathQueue {
  budgetMs: number;
  readonly pending: number;
  /** the last update: how many ran, its ms, the slowest one; total since creation */
  stats: { ran: number; ms: number; worst: number; total: number };
  request(from: NavPoint, to: NavPoint, options?: PathOptions & { priority?: number; then?: (path: NavPoint[] | null) => void }): PathJob;
  /** run queued queries, best priority first, until the budget is spent (at least one); returns how many ran */
  update(budgetMs?: number): number;
  clear(): void;
}
/** `max`: most queries an update (a counted budget: for bit-exact replays use { budgetMs: Infinity, max }) */
export function createPathQueue(nav: NavGrid, options?: { budgetMs?: number; max?: number }): PathQueue;
export function pathLength(path: NavPoint[]): number;
/** corners replaced by arcs that nav.visible accepts; link waypoints stay */
export function smoothPath(nav: NavGrid, path: NavPoint[] | null, options?: { radius?: number; corner?: number; segments?: number }): NavPoint[] | null;
