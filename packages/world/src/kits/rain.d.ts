import type * as THREE from 'three';
import type { MaterialKit } from '@mirage/core/materials';

export interface RainOptions {
  /** Streaks in the box (6000). */
  count?: number;
  /** The box around the camera, metres [x, y, z] ([22, 14, 22]). */
  box?: readonly [number, number, number];
  /** Fall speed, m/s (8.5); the world's wind tilts it. */
  speed?: number;
  /** Seconds of travel one streak spans (0.035). */
  streak?: number;
  /** Streak width, m (0.0012); never drawn under one pixel (thinner ones get less alpha). */
  width?: number;
  /** Share of the streaks shown at rain 1 (1). */
  density?: number;
  /** Brightness multiplier (1). */
  gain?: number;
  /** If given, calls setRain(intensity) (@mirage/core); otherwise the current rain level applies. */
  intensity?: number;
  /** rng stream name ('rain'). */
  seed?: string;
  /** Orthographic views: the height the box is centred on, where the view axis meets it (0). */
  ground?: number;
  /** Orthographic views: the least alpha a sub-pixel streak keeps (0.25), so rain still reads at a few cm per pixel. */
  minAlpha?: number;
}
/** Camera-following rain streaks (one instanced draw call, deterministic in G.uTime); density follows setRain(). */
export function addRain(ctx: { root: THREE.Object3D; mat: Pick<MaterialKit, 'patch'>; G?: { uTime: { value: number } } }, options?: RainOptions): THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicMaterial>;
