import type * as THREE from 'three';
/** run fn before (and `after` after) every render of `scene` through `camera`, shadow passes excluded; returns off() */
export function onView(scene: THREE.Scene, camera: THREE.Camera,
  fn: (camera: THREE.Camera, heightPx: number, renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) => void,
  after?: ((camera: THREE.Camera, renderer: THREE.WebGLRenderer) => void) | null): () => void;
