// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export const GI_DEFAULTS: any;
export function giConfig(...args: any[]): any;
export function giGrid(...args: any[]): any;
export const giCell: any;
export const giTile: any;
export function createGi(...args: any[]): any;
