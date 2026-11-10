import type * as THREE from 'three';
import type * as geom from './geom.js';
import type { rng } from './rng.js';
import type { EnvironmentUniforms, createEnv } from './env.js';
import type { MaterialKit } from './materials.js';
import type { Pipeline, PostSettings } from './post.js';
import type { Light2Option, Light2Settings } from './light2.js';
import type { SoftShadowOption, SoftShadowSettings } from './softshadow.js';
import type { Lighting, LightingOption } from './lighting.js';
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
  /** A multisampled, XR-compatible context, so a WebXR session (@mirage/play/xr) gets MSAA. Pass `(await xrSupport()).vr`. */
  xr?: boolean;
  /** Lamp shadows, screen-space reflections, volumetric light, mixed bloom (off by default). */
  light2?: Light2Option;
  /** Moving frames render below the canvas size when they run over budget (off by default; stills stay full size). */
  dynamicRes?: boolean | Partial<DynamicResSettings>;
  /** Contact-hardening soft sun shadows, per pixel (off by default): still and walking frames alike. */
  softShadows?: SoftShadowOption;
  /** Realtime lighting features (off by default, each one opt-in): cascaded sun shadows, probe GI, reflection probes, clustered local lights. */
  lighting?: LightingOption;
  /** Reduced motion from the start (off by default; @mirage/play follows prefers-reduced-motion): see setReducedMotion. */
  reducedMotion?: boolean | Partial<ReducedMotionSettings>;
}
/** Scales 0..1: sway = the wind's strength while a frame renders (every mgWind / uWind sway), rain = the rain kit's fall speed. */
export interface ReducedMotionSettings { sway: number; rain: number }
/** The full reduced-motion settings for `true` / a partial object (clamped to 0..1, defaults sway 0.25, rain 0.4); null when off. */
export function reducedMotionConfig(option?: boolean | Partial<ReducedMotionSettings> | null): ReducedMotionSettings | null;
/** renderTransparent's result: RGBA8, straight (not premultiplied) alpha, top row first. */
export interface TransparentStill { width: number; height: number; data: Uint8Array }
/** cap: the app's own frame cap (fps; @mirage/play sets it from maxFps / the power saver) — the budget is never tighter. */
export interface DynamicResSettings { target: number; min: number; step: number; cap?: number }
/** The full dynamic-resolution settings for `true` / a partial object; null when off. */
export function dynamicResConfig(option?: boolean | Partial<DynamicResSettings> | null): DynamicResSettings | null;
export interface RenderFrameOptions {
  camera?: RenderCamera; getCamera?: (seconds: number) => RenderCamera; spp?: number; dt?: number;
  shutter?: number; frameIndex?: number; target?: THREE.WebGLRenderTarget | null;
  shadow?: ShadowRegion; taa?: boolean | number;
  /** Adaptive still (spp >= 8, not with taa): stop once the mean change between estimates every spp / 4 sub-frames
   *  is <= this many display levels (0..255; true = 0.25). renderFrame then returns what it drew. */
  converge?: boolean | number;
}
/** What an adaptive still (renderFrame with `converge`) drew: sub-frames used of `of`, and the mean changes measured. */
export interface ConvergeResult { spp: number; of: number; diffs: number[] }
export interface WorldContext {
  THREE: typeof THREE; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  G: EnvironmentUniforms; keyDir: THREE.Vector3; mat: MaterialKit; geom: typeof geom; rng: typeof rng;
  quality: Quality; place: Place;
  /** Live reduced-motion scales for kits (1 when off); world.setReducedMotion writes it. */
  motion: { reduced: boolean; sway: number; rain: number };
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
  /** The soft-shadow settings in use (live: `on`, `sunAngle`, …), null when off. */
  softShadows: SoftShadowSettings | null;
  /** The lighting features of the `lighting` option, null when off. */
  lighting: Lighting | null;
  /** Null before setTime(), prepare() or the first renderFrame(). */
  readonly light: LightState | null; readonly state: SkyState | null; readonly exposure: number;
  setTime(time: SkyTime, options?: { ease?: boolean }): LightState;
  tick(dt: number): boolean;
  /** Compile materials and capture lighting after building the scene. Requires WebGL.
   *  { warm: true } (opt-in): also draw one discarded frame and wait for the GPU, so the first visible frame pays no upload or driver work. */
  prepare(options?: { warm?: boolean }): Promise<void | { warmMs: number }>;
  renderFrame(seconds?: number, options?: RenderFrameOptions): ConvergeResult | void;
  /** A still with a transparent sky: rendered over black and over white (sky and stars hidden), straight alpha recovered
   *  per pixel. Still-path options (spp, frameIndex, camera, shadow, shutter); no bloom, no auto exposure. */
  renderTransparent(seconds?: number, options?: Omit<RenderFrameOptions, 'taa' | 'target'>): TransparentStill;
  /** The reduced-motion settings in use, null when off. */
  readonly reducedMotion: ReducedMotionSettings | null;
  /** true | { sway, rain } scales the wind sway and the rain while rendering and closes the still path's shutter (no
   *  motion blur, unless renderFrame gets one); false restores. Returns the settings (null when off). */
  setReducedMotion(option?: boolean | Partial<ReducedMotionSettings> | null): ReducedMotionSettings | null;
  /** One plain draw of the scene into the current framebuffer (the XR path): no pipeline; the renderer's tone mapping grades. */
  renderDirect(seconds?: number, options?: { camera?: THREE.Camera; shadow?: ShadowRegion; fog?: number }): void;
  resize(width: number, height: number): void;
  /** Call after setTime() or prepare(). */
  captureEnv(instant?: boolean): void;
  setAmbientVolumes(volumes?: readonly AmbientVolume[]): void;
  /** Releases pipeline, environment light and scene geometries; an injected renderer stays owned by its host.
   * Does not stop external loops/listeners or generally release scene materials/textures. No reuse after disposal. */
  dispose(): void;
}
export function createWorldRenderer(options?: WorldRendererOptions): WorldRenderer;
