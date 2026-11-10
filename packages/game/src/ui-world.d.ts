import type * as THREE from 'three';
import type { Signal, MaybeReactive } from './ui-reactive.js';
import type { UIKit, Description } from './ui-kit.js';
export interface Projected { x: number; y: number; w: number; front: boolean }
/** m: a view-projection matrix's 16 elements. x, y in pixels from the top left; w: view depth; front: before the camera. */
export function projectPoint(m: ArrayLike<number>, x: number, y: number, z: number, width: number, height: number, out?: Partial<Projected>): Projected;
/** 1 up to fadeStart x max, falling to 0 at max. */
export function worldFade(distance: number, max: number, fadeStart?: number): number;
export function clampToEdge(x: number, y: number, front: boolean, width: number, height: number, margin?: number, out?: object): { x: number; y: number; clamped: boolean; angle: number };
export interface WorldAnchorOptions {
  position?: [number, number, number] | THREE.Vector3 | null; object?: THREE.Object3D | null; offset?: [number, number, number] | null;
  /** stick to the screen edge when off screen */
  clamp?: boolean; occlude?: boolean; maxDistance?: number; minDistance?: number; scale?: boolean; class?: string;
}
export interface WorldItem { el: HTMLElement; distance: Signal<number>; set(x: number, y: number, z: number): void; remove(): void }
export interface WorldUI {
  add(options: WorldAnchorOptions & { content: Description | ((item: object) => Description) }): WorldItem;
  label(options: WorldAnchorOptions & { text: MaybeReactive<string> }): WorldItem;
  marker(options: WorldAnchorOptions & { icon?: string; label?: MaybeReactive<string>; showDistance?: boolean }): WorldItem;
  healthBar(options: WorldAnchorOptions & { value: MaybeReactive<number>; max?: MaybeReactive<number>; tone?: string; label?: MaybeReactive<string> }): WorldItem;
  /** once per frame, after the camera moved */
  update(now?: number): void;
  stats: { items: number; visible: number; writes: number; rays: number };
  readonly count: number; dispose(): void;
}
export function createWorldUI(options: {
  kit: UIKit; camera: THREE.Camera; occluders?: THREE.Object3D[] | null; occlude?: ((point: THREE.Vector3, eye: THREE.Vector3) => boolean) | null;
  maxDistance?: number; fadeStart?: number; raysPerFrame?: number; occludedAlpha?: number; margin?: number; minScale?: number; viewport?: (() => [number, number]) | null;
}): WorldUI;
