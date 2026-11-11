import type * as THREE from 'three';
import type { Bounds } from '@miragekit/world';
export const MAXL: 4;
export interface GridData { nx: number; nz: number; x0: number; z0: number; cell: number; floors: Float32Array; count: Uint8Array }
export interface WalkGrid extends GridData {
  idx(x: number, z: number): number;
  layers(x: number, z: number): [number, number][];
  supportAt(index: number, y: number, step: number): [number, number] | null;
  support(x: number, z: number, y: number, step?: number): [number, number] | null;
  /** Returns NaN if no supporting layer exists. */
  groundAt(x: number, z: number, y?: number, step?: number): number;
}
export interface BakedWalkGrid extends WalkGrid {
  /** The bake's frame, for region re-bakes ({ into }). */
  bake: { bounds: Bounds; cell: number; dy: number; yMin: number; yMax: number };
  stats: { nx: number; nz: number; slabs: number; floors: number; overflow: number; hidden: number; ms: number;
    /** region bakes: the image rectangle re-baked */ region?: { x0: number; r0: number; w: number; h: number } | null;
    /** async bakes */ tiles?: number; frames?: number; maxSliceMs?: number; restarts?: number; changed?: boolean };
}
/** bounds is required for a new bake; with `into` the earlier bake's frame is used. region: [x0, z0, x1, z1] re-bakes only those cells. */
export interface WalkGridOptions { bounds?: Bounds; cell?: number; dy?: number; yMin?: number; yMax?: number; region?: Bounds; into?: BakedWalkGrid | WalkGrid }
export interface AsyncWalkGridOptions extends WalkGridOptions {
  /** cells per tile side (1024) */ tile?: number;
  /** main-thread ms a frame (4) */ budgetMs?: number;
  /** reads in flight (8) */ inflight?: number;
  /** waits for the next frame (default: requestAnimationFrame) */ frame?: () => Promise<unknown>;
  /** restarts of a tile when the scene changes under it (3) */ restarts?: number;
  /** abort: the promise rejects; finished tiles stay written */ signal?: AbortSignal;
}
export function makeGrid(data: GridData): WalkGrid;
/** GPU bake; defer to the test machine. */
export function bakeWalkGrid(world: { renderer: THREE.WebGLRenderer; scene: THREE.Scene }, options: WalkGridOptions): BakedWalkGrid;
/** The same arrays as bakeWalkGrid, baked over frames (fenced pixel-pack reads, a main-thread budget a frame). */
export function bakeWalkGridAsync(world: { renderer: THREE.WebGLRenderer; scene: THREE.Scene }, options: AsyncWalkGridOptions): Promise<BakedWalkGrid>;
