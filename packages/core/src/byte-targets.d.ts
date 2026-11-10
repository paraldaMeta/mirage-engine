import type { WebGLRenderer } from 'three';
/** 8-bit render targets on a context that cannot draw into float textures (or always, with force); true when installed */
export function byteTargets(renderer: WebGLRenderer, force?: boolean): boolean;
