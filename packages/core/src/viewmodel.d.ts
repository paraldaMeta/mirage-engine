import type * as THREE from 'three';
/** Draw every mesh under `root` with its own near plane (default 0.01 m) in the camera's depth range: the camera's
 *  x, y, w and jitter, clip z of a nearer plane, gl_FragDepth the camera's own depth. Returns the materials patched. */
export function viewModelDepth(root: THREE.Object3D, options?: { near?: number }): number;
/** The vertex / fragment edits alone (null when a shader has no main()). */
export function viewModelShaders(vertexShader: string, fragmentShader: string, near?: number): { vertexShader: string; fragmentShader: string } | null;
