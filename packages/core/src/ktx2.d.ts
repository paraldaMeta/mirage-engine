import type * as THREE from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
/** A KTX2Loader with support detected for this renderer; three's loader is imported only when this is called. */
export function createKTX2Loader(renderer: THREE.WebGLRenderer, options?: { transcoderPath?: string; workers?: number }): Promise<KTX2Loader>;
