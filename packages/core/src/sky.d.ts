import type * as THREE from 'three';
export interface SkyUniforms {
  uSunDir: THREE.IUniform<THREE.Vector3>; uSunI: THREE.IUniform<number>;
  uMoonDir: THREE.IUniform<THREE.Vector3>; uMoonI: THREE.IUniform<number>; uMoonDisc: THREE.IUniform<number>; uMoonR: THREE.IUniform<number>;
  uNightGlow: THREE.IUniform<THREE.Vector3>; uCloudCover: THREE.IUniform<number>; uCloudOffset: THREE.IUniform<THREE.Vector2>;
  uCapture: THREE.IUniform<number>; uEq: THREE.IUniform<THREE.Matrix3>; uStarVis: THREE.IUniform<number>; uStarGain: THREE.IUniform<number>;
  /** the dusk sky's (createSkyUniforms({ dusk })): haze, night, airglow; and the world's haze, written as the dome draws */
  uDusk?: THREE.IUniform<THREE.Vector4>; uHazeCol?: THREE.IUniform<THREE.Color>; uHazeDen?: THREE.IUniform<number>;
  uFogL?: THREE.IUniform<Float32Array>; uFogGlow?: THREE.IUniform<Float32Array>;
  /** the storm sky's (createSkyUniforms({ storm })): x the weight (0 off .. 1; the caller sets it), y glow, z band,
   *  w flash; the drift's speed; the haze colour written as the dome draws; the lightning's (weather.js FLASH) */
  uStorm?: THREE.IUniform<THREE.Vector4>; uStormSpeed?: THREE.IUniform<number>; uStormBase?: THREE.IUniform<THREE.Color>;
  uFlash?: THREE.IUniform<THREE.Vector3>; uFlashDir?: THREE.IUniform<THREE.Vector3>;
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
/** The storm sky's settings (all optional in the option). */
export interface SkyStormSettings {
  /** The deck's brightness x the world's haze colour (1.1): lit from below by the city. */
  glow: number;
  /** The horizon band's brightness x the haze colour (1.7). */
  band: number;
  /** x the lightning's light inside the deck (0.35). */
  flash: number;
  /** The scud's drift, x the cloud layer's (6). */
  speed: number;
}
export type SkyStormOption = boolean | Partial<SkyStormSettings>;
/** `createWorldRenderer({ sky })`: opt-in sky looks. storm: a low torn rain deck over the dome, weighted by
 *  `world.sky.material.uniforms.uStorm.value.x` (0 at start: the dome as before), lit by world.flash. */
export interface SkyOption { dusk?: SkyDuskOption; storm?: SkyStormOption }
export const SKY_STORM_DEFAULTS: Readonly<SkyStormSettings>;
/** config.sky -> the storm sky's settings (clamped), or null when it is off. */
export function skyStormConfig(sky?: SkyOption | null): SkyStormSettings | null;
export const SKY_DUSK_DEFAULTS: Readonly<SkyDuskSettings>;
/** config.sky -> the dusk sky's settings (clamped), or null when it is off. */
export function skyDuskConfig(sky?: SkyOption | null): SkyDuskSettings | null;
/** With `dusk`, the uniforms carry the dusk sky (createSky and createSkyLut compile it in); without, as before. */
export function createSkyUniforms(options?: { dusk?: SkyDuskOption | null; storm?: SkyStormOption | null }): SkyUniforms;
export function createSky(uniforms: SkyUniforms): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
/** Bake the sky's air (scattering, airglow, ground) into direction tables the dome reads instead of marching per
 *  pixel. Call before createSky(uniforms); call bake() after the Sun / Moon / night-glow uniforms change. */
export function createSkyLut(renderer: THREE.WebGLRenderer, uniforms: SkyUniforms, options?: { width?: number; height?: number }): { bake(): void; dispose(): void };
