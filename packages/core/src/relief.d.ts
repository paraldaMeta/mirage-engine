import type * as THREE from 'three';
import type { MaterialHooks } from './materials.js';
/** The relief's shared uniforms: uRelief (0 off / 1 on) and uReliefFar (fade distance, m). */
export const RELIEF: { uRelief: THREE.IUniform<number>; uReliefFar: THREE.IUniform<number> };
/** 0 = off, 1 = full (fade 8 m); in between shortens the fade (8 m x max(0.4, level)). Returns the clamped level. */
export function setRelief(level?: number): number;
export const RELIEF_GLSL: string;
/** `lighting` hook snippet: scale the direct light by the relief's self-shadow (mgRlSh). */
export const RELIEF_LIGHT: string;
/** Put the relief GLSL and uniforms in front of a hooks object. */
export function withRelief(hooks?: MaterialHooks): MaterialHooks;
/** GLSL statements declaring `float <name>` = a hand-applied render's height (m), faded with distance. */
export function renderHeight(name: string, undulation: number, swipe?: number, worldPos?: string, worldNormal?: string): string;
/** `output` hook snippet: shade the render's hollows. */
export function renderShade(name: string): string;
