import type * as THREE from 'three';
import type { MaterialHooks, MaterialKit } from '@miragekit/core/materials';
import type { RandomStream } from '@miragekit/core/rng';

export interface FurOptions {
  /** A ground patch [x0, z0, x1, z1] (metres); give this or `geometry`. */
  rect?: readonly [number, number, number, number];
  /** rect: the ground level (0) and its relief (() => 0), sampled on a grid of `segments` cells per side (1). */
  y?: number;
  heightAt?(x: number, z: number): number;
  segments?: number | readonly [number, number];
  /** Any surface with position and normal attributes, in world space (moss on a rock); the shells follow its normals. */
  geometry?: THREE.BufferGeometry;
  /** Shells (16, 2..128), all in one instanced draw. */
  shells?: number;
  /** Strand length, m (0.06). */
  length?: number;
  /** Strands per m² (900). */
  density?: number;
  /** Root radius as a share of a strand's cell (0.32); strands taper to the tip. */
  thickness?: number;
  /** Strand height variation 0..0.9 (0.45). */
  spread?: number;
  /** Linear RGB [r, g, b] or a three.js colour; root dark, tip pale. */
  root?: readonly [number, number, number] | THREE.ColorRepresentation;
  tip?: readonly [number, number, number] | THREE.ColorRepresentation;
  /** Wind response (1: a full gust bends a tip by about 0.4 x length); follows the world's wind and reduced motion. */
  wind?: number;
  /** Also draw an opaque layer at the surface (false: the patch sits on a ground of its own). */
  base?: boolean;
  /** Cast shadows (false). */
  shadows?: boolean;
  /** Fins for grazing views: false (default), a row spacing in metres (rect), or true (rows every 0.35 m / the mesh's edges). */
  fins?: boolean | number;
  roughness?: number;
  /** More patch() hooks, after the fur's own (strings appended, uniforms and defines merged). */
  hooks?: MaterialHooks;
  seed?: string;
  name?: string;
}
export interface Fur {
  /** One mesh, InstancedBufferGeometry with instanceCount = shells: one draw call. */
  shells: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  /** The fins (a second draw), or null. */
  fins: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
}
/** Shell fur / short grass / moss on a patch (one draw call, alpha-tested with depth writes, wind from mgWind). */
export function addFur(ctx: { root: THREE.Object3D; mat: Pick<MaterialKit, 'std' | 'patch'>; rng(sub?: string): RandomStream }, options: FurOptions): Fur;
