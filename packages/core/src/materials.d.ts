import type * as THREE from 'three';
import type { EnvironmentUniforms } from './env.js';

export interface MaterialHooks {
  vertexDecl?: string;
  vertexWorld?: string;
  fragmentDecl?: string;
  albedo?: string;
  roughness?: string;
  metalness?: string;
  normal?: string;
  emissive?: string;
  lighting?: string;
  output?: string;
  uniforms?: Record<string, THREE.IUniform>;
  defines?: Record<string, string | number | boolean>;
  /** Specular AA on the roughness: default where a hook mentions roughnessFactor; false never; a GLSL condition: while it holds. */
  specAA?: boolean | string;
}
export type UniformSet = EnvironmentUniforms | Record<string, THREE.IUniform>;
export interface ProceduralSurfaces {
  plaster(base?: string, options?: { wear?: number; foot?: number; render?: number | readonly [number, number] }): MaterialHooks;
  stone(base?: string, options?: { course?: number; block?: number }): MaterialHooks;
  wood(base?: string, axis?: 'x' | 'y' | 'z'): MaterialHooks;
  terracotta(base?: string): MaterialHooks;
}
export interface MaterialKit {
  patch<M extends THREE.Material>(material: M, hooks: MaterialHooks): M;
  std(parameters?: THREE.MeshStandardMaterialParameters, hooks?: MaterialHooks): THREE.MeshStandardMaterial;
  phys(parameters?: THREE.MeshPhysicalMaterialParameters, hooks?: MaterialHooks): THREE.MeshPhysicalMaterial;
  depth(hooks: MaterialHooks): THREE.MeshDepthMaterial;
  glow(rgb: readonly [number, number, number], intensity?: number, parameters?: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial;
  PROC: ProceduralSurfaces;
}
export function patch<M extends THREE.Material>(material: M, hooks: MaterialHooks, uniforms: UniformSet): M;
export function createMaterials(uniforms: UniformSet): MaterialKit;
export const PROC: ProceduralSurfaces;
