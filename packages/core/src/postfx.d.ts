// Mirage original code. Types of postfx.js (docs/post.md).
import * as THREE from 'three';
import type { Pipeline, PostSettings } from './post.js';

/** The post settings postfx.js adds to DEFAULT_POST: everything off. */
export const FX_DEFAULTS: Pick<PostSettings, 'taa2' | 'upscale' | 'motionBlur' | 'motionBlurMax' | 'bokeh' | 'bokehMax' | 'bloomPyramid' | 'lut' | 'lutStrength' | 'chroma' | 'rcas'>;
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
/** Post settings from URL flags: taa2, upscale, mb, bokeh, lens, focus, bloom, bloom2, chroma, rcas, lut=warm|cool|bleach; ssr, ssrrough, ssgi, girange, girays, contact (lighting.screen). */
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
  dispose(): void;
}
