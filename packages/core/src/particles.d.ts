// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export const MAX_SPAWN_SOURCES: any;
export function simFragment(...args: any[]): any;
export const SIM_VERTEX: any;
export function gpuPass(...args: any[]): any;
export class ParticlePool { constructor(...args: any[]); [key: string]: any; }
export function setSourceTransform(...args: any[]): any;
