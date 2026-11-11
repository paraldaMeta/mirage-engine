// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export const SCREEN_DEFAULTS: any;
export const SCREEN_POST: any;
export function screenConfig(...args: any[]): any;
export function createScreen(...args: any[]): any;
