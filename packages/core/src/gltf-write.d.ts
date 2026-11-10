import type * as THREE from 'three';
/** meshopt vertex codec (version 0) of `count` vertices of `size` bytes each. */
export function encodeMeshoptVertices(data: Uint8Array, count: number, size: number): Uint8Array;
/** A binary glTF of `root`: node tree, meshes, skins, standard-material factors and animation clips. */
export function writeGLB(root: THREE.Object3D, options?: { clips?: THREE.AnimationClip[]; meshopt?: boolean; generator?: string }): Uint8Array;
