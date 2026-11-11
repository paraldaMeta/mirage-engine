import type * as THREE from 'three';
import type { MaterialKit } from '@miragekit/core/materials';
import type { Bounds } from '../plan.js';

export interface TerrainOptions {
  bounds: Bounds;
  segments?: readonly [xCells: number, zCells: number];
  sample(x: number, z: number): number;
  material?: THREE.Material | THREE.Material[];
  surface?: string;
}
export interface Terrain {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.Material | THREE.Material[]>;
  /** Exact triangle height including edges; null outside the map or for non-finite coordinates. */
  heightAt(x: number, z: number): number | null;
}
export function addTerrain(ctx: { root: THREE.Object3D; mat: Pick<MaterialKit, 'std'> }, options: TerrainOptions): Terrain;
