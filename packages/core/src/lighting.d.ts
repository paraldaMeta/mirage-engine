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
export interface LightsSettings {
  /** Most lights (records in the light texture). */
  max: number;
  /** false = every pixel loops over every light (the comparison path). */
  cluster: boolean;
  /** Most lights one cluster cell keeps; `info.clipped` counts the ones dropped. */
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
  /** At most 4. */
  probes?: ReflectionProbe[] | null;
  lights?: boolean | Partial<LightsSettings>;
}
/** One feature's handle: its settings and counters (`info`), for inspection. */
export interface LightingFeature { cfg?: unknown; info: Record<string, unknown>; invalidate?(): void }
export interface Lighting {
  csm: LightingFeature | null; gi: (LightingFeature & { bake(): void }) | null; probes: LightingFeature | null; lights: LightingFeature | null;
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
export const LIGHTS_DEFAULTS: LightsSettings;
export const PROBE_DEFAULTS: { fade: number; intensity: number };
/** What createWorldRenderer({ lighting }) builds; `world` is the renderer's internals (renderer, scene, sun, ...). */
export function createLighting(world: object, option: LightingOption | true): Lighting;
