import type * as THREE from 'three';
import type { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
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
  add(scene: THREE.Scene, camera: THREE.Camera, weight: number, subframe: number, post: PostSettings): void;
  taa(inverseViewProjection: THREE.Matrix4, previousViewProjection: THREE.Matrix4, alpha: number): void;
  end(post: PostSettings, frameIndex?: number, target?: THREE.WebGLRenderTarget | null): void;
  blend(a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget, t: number, target?: THREE.WebGLRenderTarget | null): void;
  /** Releases owned targets and post-processing resources; leaves the supplied renderer alive. */
  dispose(): void;
}
