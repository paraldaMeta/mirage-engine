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
  /** A GLSL float 0..1 in scope in the metalness hook: worn ruts, joints, round drains. They sit `wearDepth` lower and fill first (null). */
  wear?: string | null;
  /** How much lower (m) a fully worn spot sits (0.012). */
  wearDepth?: number;
  /** 0..1 where the rain does not reach (under an awning, indoors): dry and matte there. A number, a GLSL float or a { value } uniform (null: none). */
  shelter?: number | string | THREE.IUniform<number> | null;
  /** 0..1: a thin darker damp band round each puddle and an eased (meniscus) water edge. Default 1 when `wear` or `shelter` is given, else 0. */
  rim?: number | null;
  /** Rain rings' strength on this material's standing water: 0 off, 1 default, more = stronger (1). Only while setRain > 0. */
  ripples?: number;
  /** The specular AA's strength while wet (the shading normal's screen-space variance widens the roughness): 0 / false off, 1 default. */
  specAA?: number | boolean;
}
/** Wetness, puddles and rain ripples on a hooks object (Standard / Physical materials). */
export function withWet(hooks?: MaterialHooks, options?: WetOptions): MaterialHooks;
