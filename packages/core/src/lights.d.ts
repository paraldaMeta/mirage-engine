// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export const LIGHTS_DEFAULTS: any;
export const CLUSTER: any;
export function lightsConfig(...args: any[]): any;
export const clusterSlice: any;
export function sphereSpan(...args: any[]): any;
export function tileAllocator(...args: any[]): any;
export function distanceMaterial(...args: any[]): any;
export function createLights(...args: any[]): any;
