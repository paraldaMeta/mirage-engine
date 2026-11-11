// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export function seeded(...args: any[]): any;
export function sampleMesh(...args: any[]): any;
export function heightTexture(...args: any[]): any;
export function createSorter(...args: any[]): any;
export function makeSheet(...args: any[]): any;
export function createDepthCopy(...args: any[]): any;
