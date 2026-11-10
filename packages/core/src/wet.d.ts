import type * as THREE from 'three';
import type { MaterialHooks } from './materials.js';
/** The wetness's page-global uniforms: uWet (0 dry / off .. 1) and uRain (0 .. 1). */
export const WET: { uWet: THREE.IUniform<number>; uRain: THREE.IUniform<number> };
/** 0 = dry (off: the wet code is not compiled), 1 = soaked with full puddles. Crossing 0 recompiles the wet materials. Returns the clamped level. */
export function setWetness(level?: number): number;
/** 0 = no rain, 1 = heavy: ripples on standing water and the rain kit's streak density. Returns the clamped level. */
export function setRain(intensity?: number): number;
/** How many times the wetness / rain level changed (createWorldRenderer's tick() watches them). */
export function wetVersion(): { wet: number; rain: number };
/** The wet GLSL (mgWetApply, mgWetNormal, mgWetRipples, mgWetH, …). */
export const WET_GLSL: string;
export interface WetOptions {
  /** 0 sealed .. 1 very porous: how much darker the material gets when wet (0.6). Metals only get smoother. */
  porosity?: number;
  /** The damp band's foot: a height (m), an Object3D (its world y) or a horizontal THREE.Plane (0). */
  ground?: number | THREE.Object3D | THREE.Plane;
  /** Height of the damp band above the ground (m, 0.3). */
  band?: number;
  /** 0 = no standing water, 1 = default, more = fuller puddles (1). */
  puddles?: number;
  /** A GLSL float 0..1 in scope in the metalness hook (e.g. 'mgS.h'): low parts fill first. */
  height?: string | null;
  /** The mean of `height` (e.g. the texture set's hMean; 0.5). */
  heightMid?: number;
  /** Bed height (m) per unit of `height` (0.012). */
  heightScale?: number;
}
/** Wetness, puddles and rain ripples on a hooks object (Standard / Physical materials). */
export function withWet(hooks?: MaterialHooks, options?: WetOptions): MaterialHooks;
