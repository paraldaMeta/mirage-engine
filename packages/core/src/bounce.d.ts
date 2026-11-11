import type { BounceSettings } from './lighting.js';
type V3 = [number, number, number];
export { BounceSettings };
export const BOUNCE_DEFAULTS: Omit<BounceSettings, 'min' | 'max' | 'keep'>;
/** The grid of a volume: probe counts, spacing, layer heights (`bounceLayerY`) and the height field's extent and size. */
export interface BounceGrid {
  x0: number; z0: number; y0: number; top: number;
  /** Metres between probes in x and z (the spacing asked for, grown until the grid fits `maxProbes`). */
  dx: number;
  nx: number; nz: number; nl: number;
  /** Height of the layers' span (max.y - min.y) and their exponent. */
  H: number; curve: number;
  probes: number;
  map: { x0: number; z0: number; w: number; d: number };
  /** Metres per height-field texel and the field's size in texels. */
  texel: number; mw: number; mh: number;
  hmax: number;
}
/** A full config, or null when off. */
export function bounceConfig(option: boolean | Partial<BounceSettings> | null | undefined): BounceSettings | null;
export function bounceGrid(config: BounceSettings, box: { min: V3; max: V3 }): BounceGrid;
/** Height (m) of probe layer k. */
export function bounceLayerY(grid: BounceGrid, k: number): number;
/** What createLighting builds for `lighting: { bounce }`; `world` is the renderer's internals. */
export function createBounce(world: object, config: BounceSettings): {
  cfg: BounceSettings;
  info: Record<string, unknown>;
  readonly grid: BounceGrid | null;
  readonly busy: boolean;
  strength: number;
  bake(now?: boolean): Record<string, unknown>;
  prepare(): Record<string, unknown>;
  invalidate(): void;
  dispose(): void;
};
