import type * as THREE from 'three';
type V3 = [number, number, number];
export interface CsmSettings {
  /** 2..4. */
  cascades: number;
  /** Metres from the camera the cascades cover. */
  distance: number;
  /** Split scheme: 1 = logarithmic, 0 = linear. */
  lambda: number;
  /** Metres: where the first split starts. */
  near: number;
  /** Pixels per cascade; 0 = half the quality tier's shadow map. */
  tile: number;
  /** Share of a tile over which a cascade blends into the next one. */
  blend: number;
  /** Metres toward the sun that casters outside a cascade still count. */
  reach: number;
  /** Moving frames redraw far cascades less often (1st every frame, 2nd every 2nd, 3rd every 4th, 4th every 8th). */
  stagger: boolean;
  /** stagger: how much larger than its slice a cascade after the first is drawn (0.12 = 12 %). */
  pad: number;
  /** Metres: PCF disc radius (at least one texel of the cascade). */
  radius: number;
  bias: number;
  /** Texels the lookup is pushed along the surface normal. */
  normalOffset: number;
  /** PCF taps (compiled in). */
  taps: number;
}
export interface GiSettings {
  /** The volume (world metres). Required. */
  min: V3; max: V3;
  /** Metres between probes (or `counts`). */
  spacing: number;
  counts?: V3;
  /** Passes over the volume at load: each adds a bounce. */
  bounces: number;
  /** Pixels of a probe's capture cube face. */
  cube: number;
  /** Probes re-baked per frame after the time of day changed. */
  perFrame: number;
  intensity: number;
  /** Metres at the box faces over which it blends to the image-based light. */
  fade: number;
  /** Share of the spacing the lookup is pushed off the surface. */
  bias: number;
  /** Scale image-based reflections inside the volume by probe light / sky light. */
  specular: boolean;
  maxProbes: number;
}
export interface BounceSettings {
  /** The volume (world metres). Without a box: the shadow volume in x / z, the built heights in y. */
  min?: V3; max?: V3;
  /** Metres between probes in x and z. */
  spacing: number;
  /** Probe heights over the box: layer k at min.y + (max.y - min.y) (k / (layers - 1))^curve. */
  layers: number;
  /** 2: dense at the ground (quadratic); 1: even steps. */
  curve: number;
  /** Metres per height-field texel. */
  texel: number;
  /** Metres of height field around the box. */
  margin: number;
  /** Rays above this height escape to the sky; 0 = the box top + 4 m. */
  hmax: number;
  /** 0..1 (more extrapolates). */
  strength: number;
  /** The further bounces: a surface of albedo a sends 1 / (1 - multi a) of its single bounce. */
  multi: number;
  /** Probes outside the grid over which the factor fades to 1. */
  edge: number;
  /** Clamp of local / reference light. */
  lo: number; hi: number;
  /** An eased re-bake gathers 1 / bands of a layer per frame. */
  bands: number;
  /** Seconds: time constant of the blend toward a re-bake. */
  ease: number;
  maxProbes: number;
  /** Pixels per side of the height field at most (the texel grows). */
  maxMap: number;
  /** Which objects the height field draws (default: every visible opaque mesh not marked mgDynamic, mgNoCapture or mgNoBounce). */
  keep?: (object: THREE.Object3D) => boolean;
}
export interface LightsSettings {
  /** Most lights (records in the light texture). */
  max: number;
  /** false = every pixel loops over every light (the comparison path). */
  cluster: boolean;
  /** Most lights one cluster cell keeps; `info.clipped` counts the ones dropped. 0 = no limit (the index texture grows). */
  perCell: number;
  /** Shadow atlas size (px). */
  atlas: number;
  tileMax: number; tileMin: number;
  /** Shadow tiles redrawn per frame at most. */
  perFrame: number;
  /** Texels of depth bias. */
  bias: number;
}
export interface ReflectionProbe {
  /** The room's box (world metres): reflections are parallax-corrected against it. */
  min: V3; max: V3;
  /** Where the capture is taken; the box centre by default. */
  position?: V3;
  /** Metres inside the faces over which the probe blends to the world's image-based light. */
  fade?: number;
  intensity?: number;
}
export interface LightingOption {
  csm?: boolean | Partial<CsmSettings>;
  gi?: (Partial<GiSettings> & { min: V3; max: V3 }) | null;
  /** One-bounce light and sky occlusion from a height field of the built scene (bounce.js); `true` = the shadow volume. */
  bounce?: boolean | Partial<BounceSettings> | null;
  /** At most 4. */
  probes?: ReflectionProbe[] | null;
  lights?: boolean | Partial<LightsSettings>;
  /** Screen-space reflections, indirect light and contact shadows (screen.js); the strengths are post settings (ssr2, ssgi, contact). */
  screen?: boolean | Partial<ScreenSettings>;
}
export interface ScreenSettings {
  /** Size of the traced buffers on moving frames, as a share of the render size. */
  scale: number;
  /** The same for stills (the reference mode). */
  refScale: number;
  /** The three.js layer the G-buffer pass draws. */
  layer: number;
}
/** One feature's handle: its settings and counters (`info`), for inspection. */
export interface LightingFeature { cfg?: unknown; info: Record<string, unknown>; invalidate?(): void }
export interface Lighting {
  screen: LightingFeature | null;
  csm: LightingFeature | null; gi: (LightingFeature & { bake(): void }) | null; probes: LightingFeature | null; lights: LightingFeature | null;
  /** `bake(true)` now, `bake(false)` over the next frames; `prepare()` draws the height field again; `strength` 0..1. */
  bounce: (LightingFeature & { bake(now?: boolean): unknown; prepare(): unknown; strength: number; readonly busy: boolean }) | null;
  /** Hand a PointLight / SpotLight already in the scene to the clustered path; `shadow` gives it a tile of the shadow atlas. */
  addLight(light: THREE.PointLight | THREE.SpotLight, options?: { shadow?: boolean }): boolean;
  removeLight(light: THREE.Light): boolean;
  /** The built world changed (a wall, a door): cached shadows and baked light are redone. */
  invalidate(): void;
  /** Wrap lit materials added since the last call (the world also does it every 30 frames). */
  adopt(): number;
  /** True while baked light is still being brought up to date. */
  readonly busy: boolean;
  dispose(): void;
}
export const CSM_DEFAULTS: CsmSettings;
export const GI_DEFAULTS: Omit<GiSettings, 'min' | 'max' | 'counts'>;
export const BOUNCE_DEFAULTS: Omit<BounceSettings, 'min' | 'max' | 'keep'>;
export const LIGHTS_DEFAULTS: LightsSettings;
export const PROBE_DEFAULTS: { fade: number; intensity: number };
export const SCREEN_DEFAULTS: ScreenSettings;
/** The post settings of the screen-space passes, all off. */
export const SCREEN_POST: { ssr2: number; ssrRough: number; ssrDist: number; ssrThick: number; ssgi: number; ssgiRange: number; ssgiRays: number; contact: number; contactLen: number };
/** What createWorldRenderer({ lighting }) builds; `world` is the renderer's internals (renderer, scene, sun, ...). */
export function createLighting(world: object, option: LightingOption | true): Lighting;
