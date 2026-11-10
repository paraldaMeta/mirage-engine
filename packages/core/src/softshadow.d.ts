import type * as THREE from 'three';
export interface SoftShadowSettings {
  /** Live switch: false = three's PCF and the sub-frame sun-disc jitter. */
  on: boolean;
  /** The sun's full angular diameter (degrees); the real sun is ~0.53. */
  sunAngle: number;
  /** Widest penumbra (m, full width); also the blocker search's reach. */
  maxPenumbra: number;
  /** Widest penumbra in shadow-map texels. */
  maxPenumbraTexels: number;
  /** Casters nearer the receiver than this (m) are the receiver itself. */
  minBlocker: number;
  /** Compiled in once per page (the first world's). */
  blockerSamples: number;
  /** Compiled in once per page (the first world's). */
  blockerSteps: number;
  /** Compiled in once per page (the first world's). */
  filterSamples: number;
  /** Receiver-plane slope clamp (tan of the angle to the light's view plane). */
  slopeMax: number;
  /** Share of the shadow map over which shadows fade out at its edge. */
  edgeFade: number;
}
/** `true`, or the fields to override. */
export type SoftShadowOption = boolean | Partial<SoftShadowSettings>;
export const SOFTSHADOW_DEFAULTS: SoftShadowSettings;
/** The full settings for an option (numbers clamped); null when off. */
export function softShadowConfig(option?: SoftShadowOption | null): SoftShadowSettings | null;
/** Patch three's shadow chunks once (page-global); the tap counts of the first call are compiled in.
 *  False (warning, nothing patched) when three's chunks are not the expected ones. */
export function installSoftShadows(settings?: SoftShadowOption | null): boolean;
/** The tap counts compiled in on this page; null before the first install. */
export function softShadowsInstalled(): Pick<SoftShadowSettings, 'blockerSamples' | 'blockerSteps' | 'filterSamples'> | null;
/** The page-global uniforms (typed arrays shared by every program). */
export const SS_SHARED: { a: Float32Array; b: Float32Array; c: Float32Array };
/** Publish the uniforms for the sun's orthographic shadow camera before a (sub-)frame; settings null or `on: false` = off. */
export function softShadowUniforms(settings: SoftShadowSettings | null, shadowCamera: THREE.OrthographicCamera | null, mapSize?: THREE.Vector2 | null, subFrameIndex?: number): void;
