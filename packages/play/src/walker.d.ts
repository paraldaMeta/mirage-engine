import type { XYZ } from '@miragekit/world';
import type { WalkGrid } from './walkgrid.js';
export interface Body { radius: number; head: number; eye: number; step: number; walk: number; run: number; gravity: number; jump: number }
export interface GridBody extends Body { airStep: number }
export const BODY: GridBody;
export interface MotionInput { x?: number; z?: number; up?: number; run?: boolean; jump?: boolean; jumpPressed?: boolean }
/** Common contract for the grid walker and Rapier character. Positions are authoritative feet coordinates. */
export interface WalkerLike {
  pos: [number, number, number]; vy: number; onGround: boolean; blocked: boolean; body: Pick<Body, 'eye'>;
  update(dt: number, input?: MotionInput): unknown;
  place(position: XYZ): unknown;
}
export interface GridWalker extends WalkerLike {
  body: GridBody;
  fits(x: number, z: number, y?: number): boolean;
  update(dt: number, input?: MotionInput): this;
  place(position: XYZ): this;
}
export function createWalker(grid: WalkGrid, options?: { pos?: XYZ; body?: Partial<GridBody> }): GridWalker;
