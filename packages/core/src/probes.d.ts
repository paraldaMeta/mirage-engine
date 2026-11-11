// Loose declarations for an internal module (reachable through the package's wildcard export, not part of the
// documented API in docs/api.md): every export is typed `any`. The public entry points are typed in index.d.ts.
/* eslint-disable */
export const PROBES_MAX: any;
export const PROBE_DEFAULTS: any;
export function probesConfig(...args: any[]): any;
export function boxExit(...args: any[]): any;
export function probeWeight(...args: any[]): any;
export function createProbes(...args: any[]): any;
