// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export function createTrailMesh(...args: any[]): any;
export function createBeams(...args: any[]): any;
export function createDecals(...args: any[]): any;
