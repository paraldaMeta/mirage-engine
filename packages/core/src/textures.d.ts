import type * as THREE from 'three';
import type { MaterialHooks, MaterialKit } from './materials.js';
export const TEX_GLSL: string;
export const TEX_RELIEF_GLSL: string;
export interface TextureSetInfo {
  tile: number; mean: readonly [number, number, number]; hMean: number; rough: number; roughSlope?: number;
  files: { c: string; n: string }; [metadata: string]: unknown;
}
export type TextureMaterialOptions = THREE.MeshStandardMaterialParameters & {
  mapping?: 'tri' | 'wall' | 'ground'; tile?: number; tint?: readonly [number, number, number]; detail?: number; normal?: number;
  /** close-range relief depth (m): one parallax step and the relief's own shadow, faded out by 8 m */
  relief?: number;
  /** undulation (m) of a hand-applied render, bumped (swipes 0.7x) */
  render?: number;
};
export interface TextureLibrary {
  names: string[]; info(name: string): TextureSetInfo;
  hooks(names: readonly string[], hooks?: MaterialHooks, options?: { relief?: boolean }): MaterialHooks;
  /** The set's name as spelled in MG_TEX_<name>. */
  glslName(name: string): string;
  material(name: string, options?: TextureMaterialOptions): THREE.MeshStandardMaterial;
  /** Failed loads are logged and resolve undefined; completion does not certify all files loaded. */
  ready(): Promise<(THREE.Texture | undefined)[]>;
  /** Frees loaded textures; materials returned by material() belong to the caller. */
  dispose(): void;
  /** The textures of the sets used so far (e.g. for createUploadBudget). */
  textures(): THREE.Texture[];
}
export function createTextures(world: { renderer: THREE.WebGLRenderer; mat: MaterialKit }, options: {
  manifest: { sets: Record<string, TextureSetInfo> }; url: string | ((file: string) => string); anisotropy?: number;
  /** 'bitmap' (opt-in): decode off the main thread (createImageBitmap), same pixels; falls back to 'image'. */
  decode?: 'image' | 'bitmap';
  /** a KTX2Loader (createKTX2Loader) for manifest files ending in .ktx2 (opt-in) */
  ktx2?: { load(url: string, onLoad: (texture: THREE.CompressedTexture) => void, onProgress?: unknown, onError?: (error: unknown) => void): unknown } | null;
}): TextureLibrary;

/** The GLSL spelling of a set name in MG_TEX_<name> ('stone-wall' -> 'stone_2d_wall'; plain names are unchanged). */
export function glslName(name: string): string;
