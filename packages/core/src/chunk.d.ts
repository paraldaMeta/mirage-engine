import type * as THREE from 'three';
export interface ChunkOptions { maxVertices?: number; maxSize?: number; minVertices?: number }
/** split one geometry into spatial pieces with tight bounds; cut seams are marked in geometry.userData.locked */
export function chunkGeometry(geometry: THREE.BufferGeometry, options?: ChunkOptions): THREE.BufferGeometry[];
/** replace every large mesh under root by its chunks (same material, same parent) */
export function chunkObject(root: THREE.Object3D, options?: ChunkOptions): { meshes: THREE.Mesh[]; chunks: number; split: number };
