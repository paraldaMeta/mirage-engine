import type * as THREE from 'three';
import type { MaterialHooks, MaterialKit } from './materials.js';
export const TEX_GLSL: string;
export interface TextureSetInfo {
  tile: number; mean: readonly [number, number, number]; hMean: number; rough: number; roughSlope?: number;
  files: { c: string; n: string }; [metadata: string]: unknown;
}
export type TextureMaterialOptions = THREE.MeshStandardMaterialParameters & {
  mapping?: 'tri' | 'wall' | 'ground'; tile?: number; tint?: readonly [number, number, number]; detail?: number; normal?: number;
};
export interface TextureLibrary {
  names: string[]; info(name: string): TextureSetInfo;
  hooks(names: readonly string[], hooks?: MaterialHooks): MaterialHooks;
  material(name: string, options?: TextureMaterialOptions): THREE.MeshStandardMaterial;
  /** Failed loads are logged and resolve undefined; completion does not certify all files loaded. */
  ready(): Promise<(THREE.Texture | undefined)[]>;
  /** Frees loaded textures; materials returned by material() belong to the caller. */
  dispose(): void;
}
export function createTextures(world: { renderer: THREE.WebGLRenderer; mat: MaterialKit }, options: {
  manifest: { sets: Record<string, TextureSetInfo> }; url: string | ((file: string) => string); anisotropy?: number;
}): TextureLibrary;
