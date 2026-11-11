// Mirage original code. Types of postfx.js (docs/post.md).
import * as THREE from 'three';
import type { Pipeline, PostSettings } from './post.js';

/** The post settings postfx.js adds to DEFAULT_POST: everything off. */
export const FX_DEFAULTS: Pick<PostSettings, 'taa2' | 'upscale' | 'motionBlur' | 'motionBlurMax' | 'bokeh' | 'bokehMax' | 'bloomPyramid' | 'lut' | 'lutStrength' | 'chroma' | 'rcas'
  | 'godrays' | 'godraysDecay' | 'godraysThreshold' | 'godraysVol' | 'flare' | 'lensDirt' | 'lensDirtThreshold' | 'streak' | 'streakThreshold' | 'streakLength' | 'streakTint'>;
/** post.lensDirt's mask as plain data: one byte per texel (row 0 at the bottom), made in code from the seed: a mottle,
 *  soft blotches, dried drops, wiped streaks, specks. The same seed gives the same bytes. */
export function lensDirtMask(options?: { width?: number; height?: number; seed?: number }): Uint8Array;
/** Element i >= 1 of the Halton sequence in `base` (0..1). */
export function halton(i: number, base: number): number;
/** The lens radius (m) of a focal length (mm) at an f-number: post.dof for a real lens. */
export function apertureRadius(focalMm: number, fStop: number): number;
/** A cubic lookup table: size^3 RGB triples, red fastest (the .cube order). */
export interface LutData { size: number; data: Float32Array }
/** Parse an Adobe / Resolve .cube file (LUT_3D_SIZE, optional DOMAIN_MIN / DOMAIN_MAX); throws on a 1D table or a wrong count. */
export function parseCube(text: string): LutData;
/** A table from a function of display-referred [r, g, b] (0..1) to [r, g, b]. */
export function makeLut(fn: (rgb: [number, number, number]) => [number, number, number], size?: number): LutData;
/** The table as a texture for post.lut (linear filtered, half float). */
export function lutTexture(lut: LutData): THREE.Data3DTexture;
/** Post settings from URL flags: taa2, upscale, mb, bokeh, lens, focus, bloom, bloom2, chroma, rcas, godrays, flare, dirt (lensDirt), streak,
 *  streakthr, streaklen, lut=warm|cool|bleach; ssr, ssrrough, ssgi, girange, girays, contact (lighting.screen). */
export function postFromQuery(query: URLSearchParams): Partial<PostSettings>;
/** The passes behind those settings; the Pipeline makes one on first use (pipeline.fx). */
export class PostFX {
  constructor(pipeline: Pipeline);
  /** How many objects had their own motion in the last velocity pass. */
  moved: number;
  /** Forget the history (the next frame takes no part of the last one). */
  reset(): void;
  jitter(): [number, number];
  /** rg: previous uv minus current uv, b: clip w one frame ago, a: clip w now. */
  velocity(scene: THREE.Scene, camera: THREE.Camera): THREE.WebGLRenderTarget;
  resolve(alpha: number): void;
  bokeh(post: PostSettings, camera: THREE.Camera): void;
  motionBlur(post: PostSettings): void;
  bloom(post: PostSettings): number;
  grade(post: PostSettings): THREE.ShaderMaterial | null;
  /** Screen-space light shafts added to the frame before the bloom. jitter: the sub-frame / TAA index; light2Vol: light2
   *  marched the sun this frame (weight post.godraysVol); live: a moving frame (eased through a history). */
  godrays(post: PostSettings, camera: THREE.Camera, jitter?: number, light2Vol?: boolean, live?: boolean): void;
  /** The sun's lens flare added after the bloom; visibility from 16 depth taps over the sun's disc. */
  flare(post: PostSettings, camera: THREE.Camera, live?: boolean): void;
  /** post.lensDirt: the dirt mask lit by a wide blur of the frame's light above post.lensDirtThreshold, added after the
   *  bloom. exposure: the grade's (post.exposure x the bloom's factor; auto exposure is read on the GPU). */
  lensDirt(post: PostSettings, exposure: number): void;
  /** post.streak: anamorphic streaks of the light above post.streakThreshold, added after the bloom. */
  streak(post: PostSettings, exposure: number): void;
  dispose(): void;
}
