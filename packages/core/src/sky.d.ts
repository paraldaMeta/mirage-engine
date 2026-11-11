import type * as THREE from 'three';
export interface SkyUniforms {
  uSunDir: THREE.IUniform<THREE.Vector3>; uSunI: THREE.IUniform<number>;
  uMoonDir: THREE.IUniform<THREE.Vector3>; uMoonI: THREE.IUniform<number>; uMoonDisc: THREE.IUniform<number>; uMoonR: THREE.IUniform<number>;
  uNightGlow: THREE.IUniform<THREE.Vector3>; uCloudCover: THREE.IUniform<number>; uCloudOffset: THREE.IUniform<THREE.Vector2>;
  uCapture: THREE.IUniform<number>; uEq: THREE.IUniform<THREE.Matrix3>; uStarVis: THREE.IUniform<number>; uStarGain: THREE.IUniform<number>;
  /** the dusk sky's (createSkyUniforms({ dusk })): haze, night, airglow; and the world's haze, written as the dome draws */
  uDusk?: THREE.IUniform<THREE.Vector4>; uHazeCol?: THREE.IUniform<THREE.Color>; uHazeDen?: THREE.IUniform<number>;
  uFogL?: THREE.IUniform<Float32Array>; uFogGlow?: THREE.IUniform<Float32Array>;
  /** set by createSkyLut */
  tSkyCol?: THREE.IUniform<THREE.Texture>; tSkyTr?: THREE.IUniform<THREE.Texture>;
}
/** The dusk sky's settings (all optional in the option). */
export interface SkyDuskSettings {
  /** Aerosol x the clear air's (2.5): a paler horizon, a wider glow round a low Sun or Moon. */
  haze: number;
  /** The night dome's brightness as seen, x the light it gives (0.5; 1 = as lit). Captures keep it as lit. */
  night: number;
  /** x the airglow's brightening toward the horizon (1). */
  airglow: number;
  /** Cloud cover when the world's `clouds` is not given (0.5). */
  cover: number;
}
export type SkyDuskOption = boolean | Partial<SkyDuskSettings>;
/** `createWorldRenderer({ sky })`: opt-in sky looks. */
export interface SkyOption { dusk?: SkyDuskOption }
export const SKY_DUSK_DEFAULTS: Readonly<SkyDuskSettings>;
/** config.sky -> the dusk sky's settings (clamped), or null when it is off. */
export function skyDuskConfig(sky?: SkyOption | null): SkyDuskSettings | null;
/** With `dusk`, the uniforms carry the dusk sky (createSky and createSkyLut compile it in); without, as before. */
export function createSkyUniforms(options?: { dusk?: SkyDuskOption }): SkyUniforms;
export function createSky(uniforms: SkyUniforms): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
/** Bake the sky's air (scattering, airglow, ground) into direction tables the dome reads instead of marching per
 *  pixel. Call before createSky(uniforms); call bake() after the Sun / Moon / night-glow uniforms change. */
export function createSkyLut(renderer: THREE.WebGLRenderer, uniforms: SkyUniforms, options?: { width?: number; height?: number }): { bake(): void; dispose(): void };
