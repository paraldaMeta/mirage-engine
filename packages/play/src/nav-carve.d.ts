import type { NavGrid } from './navgrid.js';
import type { Solid, SolidSpace } from './solids.js';

export interface NavCarve {
  stats: { ms: number; moved: number; total: number };
  /** re-block what moved more than the tolerance; returns how many */
  update(): number;
  dispose(): void;
}
export function carveSolids(nav: NavGrid, space: SolidSpace, options?: {
  /** metres / radians a solid may move before it is carved again */
  tolerance?: number; turn?: number;
  /** extra metres round each footprint */
  pad?: number;
  /** most re-carves an update */
  max?: number;
  filter?: (solid: Solid) => boolean;
}): NavCarve;
