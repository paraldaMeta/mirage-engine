import type * as THREE from 'three';
import type { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Light2Settings } from './light2.js';
import type { PostFX } from './postfx.js';
import type { GradeLook } from './daynight.js';
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
  /** postfx.js (docs/post.md), all off by default. 1: velocity-buffer temporal AA instead of the depth-only one. */
  taa2: number;
  /** 0.5..1: render moving frames at this scale; taa2 reconstructs the output size (0 = off; needs taa2). */
  upscale: number;
  /** Shutter fraction 0..1 of the motion blur on moving frames (velocity buffer); motionBlurMax: longest blur, px at 1080p. */
  motionBlur: number; motionBlurMax: number;
  /** 1: lens blur on moving frames from `dof` (lens radius, m) and `focus`; bokehMax: largest blur radius, px at 1080p. */
  bokeh: number; bokehMax: number;
  /** 1: the bloom as a down / up-sample pyramid mixed in by `bloom` (energy conserving). */
  bloomPyramid: number;
  /** A 3D lookup table (lutTexture()) applied after the tone map, and how much of it (0..1). */
  lut: THREE.Data3DTexture | null; lutStrength: number;
  /** Chromatic aberration: the red / blue shift at the frame corner, % of the half diagonal. */
  chroma: number;
  /** 0..1: contrast-adaptive sharpening of moving frames after the temporal resolve / upscaler. */
  rcas: number;
  /** Screen-space light shafts from the sun (0 = off; 1 = Nizwa-like): the sky round the sun blurred toward it where
   *  something hides part of it. godraysDecay: fall-off per tap of the radial blur; godraysThreshold: sky dimmer than
   *  this x the sun's luminance casts weaker shafts; godraysVol: their weight while light2's volumetric light marches
   *  the sun (0 = leave the shafts to it). */
  godrays: number; godraysDecay: number; godraysThreshold: number; godraysVol: number;
  /** The sun's lens flare (0 = off): veiling glare, ghosts, a faint halo, depth-tested; scales with the sun's radiance. */
  flare: number;
  /** Screen-space reflections in the lit materials (needs `lighting: { screen: true }`): strength 0..1, the roughness
   *  where they end, the longest ray (m) and the depth thickness (m). */
  ssr2: number; ssrRough: number; ssrDist: number; ssrThick: number;
  /** Screen-space indirect light: strength, range (m), rays per pixel on moving frames. */
  ssgi: number; ssgiRange: number; ssgiRays: number;
  /** Screen-space contact shadows of the sun: strength 0..1 and ray length (m). */
  contact: number; contactLen: number;
  /** The time-of-day grade's look for this frame (daynight.js gradeAt; the world sets it with `grade`); unset = off. */
  grade?: GradeLook | null;
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
  /** Render at scale x the output size into a corner of the same targets (nothing is reallocated; returns false). */
  setRenderScale(scale: number): boolean;
  begin(): void;
  /** jitter: the light2 passes' pattern index (the sub-frame for stills, the TAA index while moving; default subframe). */
  add(scene: THREE.Scene, camera: THREE.Camera, weight: number, subframe: number, post: PostSettings, jitter?: number): void;
  /** The time-of-day grade's variant of the grade (createWorldRenderer does this for `grade`; end() on the first
   *  frame with post.grade). Without it the grade program is the plain one. */
  useGrade(): void;
  /** true once useGrade() ran. */
  graded?: boolean;
  /** Turn on light2's passes (createWorldRenderer does this for `light2`). */
  useLight2(settings: Light2Settings, context: { sun: THREE.DirectionalLight; G: Record<string, THREE.IUniform> }): void;
  taa(inverseViewProjection: THREE.Matrix4, previousViewProjection: THREE.Matrix4, alpha: number): void;
  /** The postfx.js passes, made on first use (taa2, motionBlur, bokeh, bloomPyramid, lut, chroma, godrays, flare). */
  fx: PostFX | null;
  /** Where the sun is and how bright (post.godrays, post.flare): its direction and the world's uniforms (uKeyDir, uKeyColor);
   *  createWorldRenderer sets it. Without it the lens passes draw nothing. */
  lensSun?: { dir: THREE.Vector3; G: Record<string, THREE.IUniform> };
  /** taa2's sub-pixel jitter of the next moving frame, in render pixels (-0.5..0.5). */
  fxJitter(): [number, number];
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
