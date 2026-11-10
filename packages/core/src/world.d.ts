import type * as THREE from 'three';
import type * as geom from './geom.js';
import type { rng } from './rng.js';
import type { EnvironmentUniforms, createEnv } from './env.js';
import type { MaterialKit } from './materials.js';
import type { Pipeline, PostSettings } from './post.js';
import type { Light2Option, Light2Settings } from './light2.js';
import type { SkyTime, SkyState, LightState } from './daynight.js';
import type { Place } from './sky-time.js';
import type { Quality, DeviceProfile } from './device.js';

export type XYZ = readonly [number, number, number];
export type RenderCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
export interface ShadowRegion { center: XYZ; radius: number }
export interface AmbientVolume { min: XYZ; max: XYZ; factor?: number; soft?: number }
export interface WorldRendererOptions {
  canvas?: HTMLCanvasElement; renderer?: THREE.WebGLRenderer;
  width?: number; height?: number; pixelRatio?: number; quality?: Quality;
  /** Missing fields keep their defaults (lat 0, lon 0, height 0, tzHours 0). */
  place?: Partial<Place>; time?: SkyTime; shadow?: ShadowRegion; envProbe?: XYZ;
  envIntensity?: number; envFade?: number; wind?: NonNullable<Parameters<typeof createEnv>[0]>['wind'];
  clouds?: number; fog?: Partial<{ density: number; groundDensity: number; height: number; air: number; level: number; color: number; glow: number }>;
  post?: Partial<PostSettings>; preserveDrawingBuffer?: boolean; mobile?: boolean; shadowMapSize?: number; spp?: number;
  /** Lamp shadows, screen-space reflections, volumetric light, mixed bloom (off by default). */
  light2?: Light2Option;
  /** Moving frames render below the canvas size when they run over budget (off by default; stills stay full size). */
  dynamicRes?: boolean | Partial<DynamicResSettings>;
}
export interface DynamicResSettings { target: number; min: number; step: number }
/** The full dynamic-resolution settings for `true` / a partial object; null when off. */
export function dynamicResConfig(option?: boolean | Partial<DynamicResSettings> | null): DynamicResSettings | null;
export interface RenderFrameOptions {
  camera?: RenderCamera; getCamera?: (seconds: number) => RenderCamera; spp?: number; dt?: number;
  shutter?: number; frameIndex?: number; target?: THREE.WebGLRenderTarget | null;
  shadow?: ShadowRegion; taa?: boolean | number;
}
export interface WorldContext {
  THREE: typeof THREE; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  G: EnvironmentUniforms; keyDir: THREE.Vector3; mat: MaterialKit; geom: typeof geom; rng: typeof rng;
  quality: Quality; place: Place;
  /** Called for each render sub-frame, not the fixed physics tick. Returns the new callback count, not an unsubscribe handle. */
  onUpdate(callback: (seconds: number) => void): number;
}
export interface WorldRenderer {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; sun: THREE.DirectionalLight;
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  pipeline: Pipeline; ctx: WorldContext; G: EnvironmentUniforms; keyDir: THREE.Vector3;
  mat: MaterialKit; geom: typeof geom; rng: typeof rng; post: PostSettings; device: DeviceProfile;
  /** The light2 settings in use (live), null when off. */
  light2: Light2Settings | null;
  /** The dynamic-resolution settings in use (live), null when off. */
  dynamicRes: DynamicResSettings | null;
  /** The moving frames' render scale (1 = the canvas size). */
  readonly resolutionScale: number;
  /** Auto exposure: forget the adapted exposure, so the next frame is metered on its own (after a teleport or cut). */
  resetExposure(): void;
  /** Null before setTime(), prepare() or the first renderFrame(). */
  readonly light: LightState | null; readonly state: SkyState | null; readonly exposure: number;
  setTime(time: SkyTime, options?: { ease?: boolean }): LightState;
  tick(dt: number): boolean;
  /** Compile materials and capture lighting after building the scene. Requires WebGL. */
  prepare(): Promise<void>;
  renderFrame(seconds?: number, options?: RenderFrameOptions): void;
  resize(width: number, height: number): void;
  /** Call after setTime() or prepare(). */
  captureEnv(instant?: boolean): void;
  setAmbientVolumes(volumes?: readonly AmbientVolume[]): void;
  /** Releases pipeline, environment light and scene geometries; an injected renderer stays owned by its host.
   * Does not stop external loops/listeners or generally release scene materials/textures. No reuse after disposal. */
  dispose(): void;
}
export function createWorldRenderer(options?: WorldRendererOptions): WorldRenderer;
