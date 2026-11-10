import type * as THREE from 'three';
import type { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Light2Settings } from './light2.js';
export interface PostSettings {
  exposure: number; temperature: number; saturation: number; contrast: number; lift: number; vignette: number;
  tonemap: 'agx' | 'aces' | 'neutral'; sharpen: number; grain: number; bloom: number; bloomRadius: number;
  ao: number; aoRadius: number; aoPower: number; sky: number; dof: number; focus: number;
  /** 0..1: fade the AO out on brightly lit pixels (0 = AO everywhere, as before). */
  aoLit: number;
  /** 0..1: how far the exposure adapts toward aeKey (0 = off). */
  autoExposure: number;
  /** Auto exposure: target log-mean exposed luminance by day, the largest correction in EV either way, the adaptation rates (1/s)
   *  when brightening (aeUp) and darkening (aeDown). */
  aeKey: number; aeRange: number; aeUp: number; aeDown: number;
  /** Auto exposure: how many EV lower the target sits at full lamp level (night). */
  aeNight: number;
}
export const DEFAULT_POST: PostSettings;
export class Pipeline {
  constructor(renderer: THREE.WebGLRenderer, options: { width: number; height: number; msaa?: number; aoSamples?: number });
  /** w, h: the output size (stable); rw, rh: the render size (w, h x renderScale, below 1 only with dynamic resolution). */
  r: THREE.WebGLRenderer; msaa: number; w: number; h: number; rw: number; rh: number; renderScale: number; quad: FullScreenQuad; bloomPass: UnrealBloomPass;
  ao: THREE.ShaderMaterial; acc: THREE.ShaderMaterial; grade: THREE.ShaderMaterial;
  taaMat: THREE.ShaderMaterial; copyMat: THREE.ShaderMaterial; blendMat: THREE.ShaderMaterial;
  sceneRT: THREE.WebGLRenderTarget; aoRT: THREE.WebGLRenderTarget; accRT: THREE.WebGLRenderTarget;
  histA: THREE.WebGLRenderTarget; histB: THREE.WebGLRenderTarget;
  setSize(width: number, height: number): void;
  /** Render at scale x the output size (reallocates when the render size changes; returns whether it did). */
  setRenderScale(scale: number): boolean;
  begin(): void;
  /** jitter: the light2 passes' pattern index (the sub-frame for stills, the TAA index while moving; default subframe). */
  add(scene: THREE.Scene, camera: THREE.Camera, weight: number, subframe: number, post: PostSettings, jitter?: number): void;
  /** Turn on light2's passes (createWorldRenderer does this for `light2`). */
  useLight2(settings: Light2Settings, context: { sun: THREE.DirectionalLight; G: Record<string, THREE.IUniform> }): void;
  taa(inverseViewProjection: THREE.Matrix4, previousViewProjection: THREE.Matrix4, alpha: number): void;
  /** Adaptive stills: mean change (display levels) of the accumulation / wsum since the last call; null when first. */
  converge(wsum: number, exposure: number, first: boolean): number | null;
  /** Adaptive stills: scale the accumulation (1 / the weight sum drawn) before end(). */
  scaleAccumulation(s: number): void;
  /** options (auto exposure): dt = seconds since the last moving frame (the exposure eases); still = meter this frame
   *  on its own (history-free). Without dt the frame counts as still. */
  end(post: PostSettings, frameIndex?: number, target?: THREE.WebGLRenderTarget | null, options?: { dt?: number; still?: boolean }, setOnly?: boolean): void;
  /** world.renderTransparent: the HDR clear colour of the scene target (a grey level; null = black, the default). */
  clearColor: number | null;
  /** world.renderTransparent: keep the frame summed so far (over black) and its bloom in scratch targets. */
  keepBlack(post: PostSettings): void;
  /** world.renderTransparent: grade the black sum and the white one (background K) into `target` with straight alpha. */
  endClear(post: PostSettings, frameIndex: number, target: THREE.WebGLRenderTarget, K?: number): void;
  /** Auto exposure: the next frame is metered on its own. */
  resetExposure(): void;
  blend(a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget, t: number, target?: THREE.WebGLRenderTarget | null): void;
  /** Releases owned targets and post-processing resources; leaves the supplied renderer alive. */
  /** Start compiling every pass's program in parallel; resolves when all are ready (world.prepare() calls it). */
  compileAsync(): Promise<unknown>;
  dispose(): void;
}
