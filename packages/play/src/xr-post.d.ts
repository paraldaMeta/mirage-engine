import type * as THREE from 'three';
import type { WorldRenderer, Pipeline } from '@mirage/core';

/** What the governor may take away from an eye: resolution scale and the optional passes. */
export interface XRPostLevel { scale?: number; ao?: boolean; bloom?: boolean; lut?: boolean }
export interface XRPostOptions extends XRPostLevel {
  /** Samples of each eye's HDR scene target. Default 4. */
  msaa?: number;
  /** Copy the scene's depth into the XR layer (controllers and panels are occluded by the world). Default true. */
  depth?: boolean;
  /** Default 8. */
  aoSamples?: number;
}
export interface XRPostFrame {
  /** renderer.xr */
  xr: THREE.WebXRManager;
  /** The Object3D that stands for the reference space in the world. */
  rig: THREE.Object3D;
  /** The camera three poses (shadow cascades fit to it). */
  head: THREE.Camera;
  /** Drawn after the eyes, in the layer, over the world's depth (not graded). */
  overlay?: THREE.Object3D;
  /** A light in the overlay, visible only while the overlay is drawn. */
  light?: THREE.Light;
  shadow?: unknown; fog?: unknown; dt?: number;
}
export interface XRPost {
  /** One stereo frame at time T; false when there is no layer target or no views yet. */
  render(T: number, frame: XRPostFrame): boolean;
  stats: { width: number; height: number; scale: number; resizes: number; eyes: number };
  level: Required<XRPostLevel>;
  off: typeof XR_POST_OFF;
  readonly pipeline: Pipeline | null;
  readonly target: THREE.WebGLRenderTarget | null;
  setLevel(level: XRPostLevel): void;
  dispose(): void;
}
/** The passes a headset never gets (TAA, upscale, motion blur, depth of field, chromatic aberration, grain, vignette). */
export const XR_POST_OFF: Readonly<Record<'taa2' | 'upscale' | 'motionBlur' | 'bokeh' | 'chroma' | 'grain' | 'vignette' | 'dof', 0>>;
/** One eye's post settings: `post` with XR_POST_OFF applied and the level's switches. */
export function xrEyePost<P extends object>(post: P, level?: XRPostLevel): P & Record<string, unknown>;
/** The pipeline size of an eye at `scale` (even, at least 64). */
export function xrEyeSize(width: number, height: number, scale?: number): [number, number];
/** The engine's post chain per eye (createXR's `post` option makes one). */
export function createXRPost(world: WorldRenderer, options?: XRPostOptions): XRPost;
