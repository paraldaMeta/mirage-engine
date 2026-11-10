import type * as THREE from 'three';
import type { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Light2Settings } from './light2.js';
export interface PostSettings {
  exposure: number; temperature: number; saturation: number; contrast: number; lift: number; vignette: number;
  tonemap: 'agx' | 'aces' | 'neutral'; sharpen: number; grain: number; bloom: number; bloomRadius: number;
  ao: number; aoRadius: number; aoPower: number; sky: number; dof: number; focus: number;
}
export const DEFAULT_POST: PostSettings;
export class Pipeline {
  constructor(renderer: THREE.WebGLRenderer, options: { width: number; height: number; msaa?: number; aoSamples?: number });
  r: THREE.WebGLRenderer; msaa: number; w: number; h: number; quad: FullScreenQuad; bloomPass: UnrealBloomPass;
  ao: THREE.ShaderMaterial; acc: THREE.ShaderMaterial; grade: THREE.ShaderMaterial;
  taaMat: THREE.ShaderMaterial; copyMat: THREE.ShaderMaterial; blendMat: THREE.ShaderMaterial;
  sceneRT: THREE.WebGLRenderTarget; aoRT: THREE.WebGLRenderTarget; accRT: THREE.WebGLRenderTarget;
  histA: THREE.WebGLRenderTarget; histB: THREE.WebGLRenderTarget;
  setSize(width: number, height: number): void;
  begin(): void;
  /** jitter: the light2 passes' pattern index (the sub-frame for stills, the TAA index while moving; default subframe). */
  add(scene: THREE.Scene, camera: THREE.Camera, weight: number, subframe: number, post: PostSettings, jitter?: number): void;
  /** Turn on light2's passes (createWorldRenderer does this for `light2`). */
  useLight2(settings: Light2Settings, context: { sun: THREE.DirectionalLight; G: Record<string, THREE.IUniform> }): void;
  taa(inverseViewProjection: THREE.Matrix4, previousViewProjection: THREE.Matrix4, alpha: number): void;
  end(post: PostSettings, frameIndex?: number, target?: THREE.WebGLRenderTarget | null): void;
  blend(a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget, t: number, target?: THREE.WebGLRenderTarget | null): void;
  /** Releases owned targets and post-processing resources; leaves the supplied renderer alive. */
  dispose(): void;
}
