import type * as THREE from 'three';
import type * as geom from '@mirage/core/geom';
import type { RandomStream } from '@mirage/core/rng';
import type { MaterialKit } from '@mirage/core/materials';
import type { Bounds, XYZ } from '../plan.js';

export interface VegetationContext {
  root: THREE.Object3D;
  mat: Pick<MaterialKit, 'std' | 'depth'>;
  geom: Pick<typeof geom, 'compose' | 'instances'>;
  rng(sub?: string): RandomStream;
}
export interface Tree { pos: XYZ; height: number; crownRadius?: number; trunkRadius?: number }
export interface CanopyOptions { trees: readonly Tree[]; seed?: string; cardsPerTree?: number }
export interface Canopies {
  /** All three are null for an empty tree list. Only trunks collide. */
  trunks: THREE.InstancedMesh | null;
  branches: THREE.InstancedMesh | null;
  crowns: THREE.InstancedMesh | null;
}
export interface GrassOptions {
  bounds: Bounds; count: number; height?: number; seed?: string;
  include?(x: number, z: number): boolean;
  /** Must return a finite ground height; handle terrain.heightAt's null before passing it here. */
  heightAt?(x: number, z: number): number;
}
export function addTreeCanopies(ctx: VegetationContext, options: CanopyOptions): Canopies;
/** At most count tufts; null if no candidate is accepted (including count = 0). */
export function addGrass(ctx: VegetationContext, options: GrassOptions): THREE.InstancedMesh | null;
