import type * as THREE from 'three';

export type Triple = readonly [number, number, number];
export interface ShadowOptions { castShadow?: boolean; receiveShadow?: boolean }
export type ArchKind = 'round' | 'pointed' | 'segmental' | 'flat';
export interface Opening {
  x: number; width: number; height: number; sill?: number; arch?: ArchKind; rise?: number;
}
export function lerp(a: number, b: number, t: number): number;
export function clamp(x: number, low: number, high: number): number;
export function smoothstep(edge0: number, edge1: number, x: number): number;
export function remap(x: number, a0: number, a1: number, b0: number, b1: number): number;
export function compose(position?: Triple, rotation?: Triple, scale?: number | Triple): THREE.Matrix4;
export class MeshBatch {
  groups: Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[]; verts: number }>;
  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4 | null): this;
  box(material: THREE.Material, size: Triple, position?: Triple, rotation?: Triple, bevel?: number): this;
  cylinder(material: THREE.Material, topRadius: number, bottomRadius: number, height: number, position?: Triple, rotation?: Triple, segments?: number): this;
  finish(options?: ShadowOptions & { name?: string }): THREE.Group;
}
export function instances<G extends THREE.BufferGeometry, M extends THREE.Material | THREE.Material[]>(
  geometry: G, material: M, matrices: readonly THREE.Matrix4[], options?: ShadowOptions,
): THREE.InstancedMesh<G, M>;
export function lathe(profile: readonly (readonly [number, number])[], segments?: number): THREE.LatheGeometry;
export function taperedTube(points: readonly Triple[], radii: readonly number[] | ((u: number) => number), options?: {
  radial?: number; segments?: number | null; capEnd?: boolean;
}): THREE.BufferGeometry;
export function archPath<P extends THREE.Path>(path: P, x0: number, x1: number, y: number, kind?: ArchKind, rise?: number | null, steps?: number): P;
/** Why an opening does not fit a wall of this height (its arch top reaches the wall top), or null. wall() warns with this text (MG206). */
export function openingProblem(opening: Opening, wallHeight: number): string | null;
export function wall(options: { length: number; height: number; thickness?: number; openings?: readonly Opening[]; curveSteps?: number; round?: number }): THREE.ExtrudeGeometry;
export function softExtrude(shape: THREE.Shape | THREE.Shape[], depth: number, radius: number, curveSegments?: number, segments?: number): THREE.ExtrudeGeometry;
export function softBox(width: number, height: number, depth: number, radius?: number): THREE.BoxGeometry;
export interface SootPlume { pos: Triple; normal?: Triple; rotY?: number; scale?: number; up?: number }
export function sootPlumes(list: readonly SootPlume[]): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
export { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
