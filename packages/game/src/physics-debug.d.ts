import type * as THREE from 'three';
import type { PhysicsKit } from './physics-kit.js';
export interface PhysicsDebug {
  group: THREE.Group; counts: { lines: number; joints: number; contacts: number }; element: { textContent: string | null } | null; visible: boolean;
  show(what: { colliders?: boolean; joints?: boolean; contacts?: boolean }): this;
  text(): string; update(): this; dispose(): void;
}
export function createPhysicsDebug(kit: PhysicsKit, scene: THREE.Object3D, options?: { colliders?: boolean; joints?: boolean; contacts?: boolean; stats?: { textContent: string | null } | null; contactSize?: number }): PhysicsDebug;
