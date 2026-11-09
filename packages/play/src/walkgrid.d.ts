import type * as THREE from 'three';
import type { Bounds } from '@mirage/world';
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
export interface BakedWalkGrid extends WalkGrid { stats: { nx: number; nz: number; slabs: number; floors: number; overflow: number; hidden: number; ms: number } }
export interface WalkGridOptions { bounds: Bounds; cell?: number; dy?: number; yMin?: number; yMax?: number }
export function makeGrid(data: GridData): WalkGrid;
/** GPU bake; defer to the test machine. */
export function bakeWalkGrid(world: { renderer: THREE.WebGLRenderer; scene: THREE.Scene }, options: WalkGridOptions): BakedWalkGrid;
