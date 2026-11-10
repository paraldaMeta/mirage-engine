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
  /** Specular AA on the roughness: default where a hook mentions roughnessFactor; false never; a string: a preprocessor #if expression. */
  specAA?: boolean | string;
  /** Called with the material once patch() has set it up (not part of the program key). */
  attach?: (material: THREE.Material) => void;
}
export type UniformSet = EnvironmentUniforms | Record<string, THREE.IUniform>;
export interface ProceduralSurfaces {
  plaster(base?: string, options?: { wear?: number; foot?: number; render?: number | readonly [number, number] }): MaterialHooks;
  stone(base?: string, options?: { course?: number; block?: number }): MaterialHooks;
  wood(base?: string, axis?: 'x' | 'y' | 'z'): MaterialHooks;
  terracotta(base?: string): MaterialHooks;
  /** Brushed metal (use on a metalness-1 material): streaks and hairlines along `axis`. */
  brushed(base?: string, options?: { axis?: 'x' | 'y' | 'z'; scale?: number; wear?: number }): MaterialHooks;
  /** Hammered / beaten metal: dimples `size` m across (0.035), polished ridges. */
  hammered(base?: string, options?: { size?: number; depth?: number }): MaterialHooks;
  /** Verdigris on copper / bronze: `amount` 0..1 turned green, rough and not metallic. */
  patina(base?: string, options?: { amount?: number; verdigris?: string }): MaterialHooks;
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
