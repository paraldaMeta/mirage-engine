// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export const CSM_DEFAULTS: any;
export function csmConfig(...args: any[]): any;
export function csmSplits(...args: any[]): any;
export function sliceSphere(...args: any[]): any;
export function snapToTexel(...args: any[]): any;
export function createCsm(...args: any[]): any;
