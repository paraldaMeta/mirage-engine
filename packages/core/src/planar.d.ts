// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export const PLANAR_DEFAULTS: any;
export function planarConfig(...args: any[]): any;
export function mirrorMatrix(...args: any[]): any;
export function obliqueClip(...args: any[]): any;
export function mirrorCamera(...args: any[]): any;
export function createPlanar(...args: any[]): any;
