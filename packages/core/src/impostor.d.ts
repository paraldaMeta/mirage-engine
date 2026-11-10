import type * as THREE from 'three';
import type { WorldRenderer } from './world.js';
export interface Impostor { albedo: THREE.Texture; normal: THREE.Texture; frames: number; tile: number; radius: number; center: THREE.Vector3; geometry: THREE.BufferGeometry; dispose(): void }
/** render `object` from frames x frames directions of the upper hemisphere (hemi-octahedral) into an albedo+alpha and a normal atlas */
export function bakeImpostor(world: WorldRenderer, object: THREE.Object3D, options?: { frames?: number; tile?: number }): Impostor;
/** a lit billboard material that picks and blends the atlas frames nearest the view direction */
export function impostorMaterial(world: WorldRenderer, impostor: Impostor, params?: Record<string, unknown>): THREE.Material;
export function hemiOctDecode(u: number, v: number, out?: THREE.Vector3): THREE.Vector3;
export function hemiOctEncode(direction: THREE.Vector3, out?: THREE.Vector2): THREE.Vector2;
