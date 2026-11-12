import type * as THREE from 'three';
import type { MaterialHooks } from './materials.js';
/** The flash's page-global uniforms: uFlash (colour x irradiance, exposure-compensated), uFlashDir (toward it, world). */
export const FLASH: { uFlash: THREE.IUniform<THREE.Vector3>; uFlashDir: THREE.IUniform<THREE.Vector3> };
/** The flash's declarations (uFlash, uFlashDir; only under MG_FLASH). */
export const FLASH_GLSL: string;
/** The flash's lighting body (inline in a lighting hook, with MG_FLASH_OPEN defined as the open sky's share 0..1). */
export const FLASH_LIGHT_GLSL: string;
/** Count a user of the flash in (true) or out (false); while any is in, the opted-in materials compile its code. */
export function enableFlash(on?: boolean): boolean;
/** Whether some world has the flash on. */
export function flashEnabled(): boolean;
export interface WithFlashOptions {
  /** 0..1 where the sky is hidden: a number, a GLSL float or a { value } uniform (0). */
  shelter?: number | string | THREE.IUniform<number> | null;
}
/** The lightning on a hooks object (Standard / Physical). withWet applies it already. */
export function withFlash(hooks?: MaterialHooks, options?: WithFlashOptions): MaterialHooks;
export interface FlashSettings {
  /** The flash's irradiance at level 1, before the exposure's compensation (2.5). */
  intensity: number;
  /** Linear RGB (a cold white). */
  color: number[];
  /** A bolt mesh, drawn while the level is above 0.25 (true). */
  bolt: boolean;
  /** The bolt's brightness x the flash (30). */
  boltGain: number;
}
export type FlashOption = boolean | Partial<FlashSettings>;
/** createWorldRenderer's flash option -> settings, or null (off). */
export function flashConfig(option?: FlashOption | null): FlashSettings | null;
/** The level t s after a strike: k >= 1 leader, return stroke, re-strike, afterglow; k < 1 one smooth pulse at k. */
export function flashEnvelope(t: number, k?: number): number;
export interface Flash {
  readonly level: number;
  readonly dir: THREE.Vector3;
  /** the bolt (a Mesh in the scene), null without */
  readonly bolt: THREE.Mesh | null;
  envelope: typeof flashEnvelope;
  /** level 0..1 this frame; dir: toward the flash (world) */
  set(level: number, dir?: ArrayLike<number> | THREE.Vector3): void;
  /** a new bolt from the cloud to where it ends; eye: where it is seen from (its quads face it) */
  strike(from: ArrayLike<number>, to: ArrayLike<number>, seed?: number, eye?: ArrayLike<number> | null): void;
  dispose(): void;
}
export function createFlash(world: { scene: THREE.Scene; gain?: () => number }, settings: FlashSettings): Flash;
