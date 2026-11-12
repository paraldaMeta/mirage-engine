import type { AtlasJSON } from './sprite-atlas.js';

/** The placeholder figure: everything but shape has a default; colours are CSS colours. */
export interface PlaceholderSpec {
  id?: string;
  shape?: 'humanoid' | 'blob' | 'bird' | 'crab' | 'item';
  cell?: readonly [number, number];
  feet?: readonly [number, number];
  height?: number;
  dirs?: 1 | 5 | 8;
  /** a subset of idle, walk, attack, hurt, die */
  anims?: readonly string[];
  body?: string; trim?: string; skin?: string; hair?: string;
  /** a held stick (humanoid), null for none */
  weapon?: string | null;
}
export type CanvasLike = { width: number; height: number; getContext(type: '2d'): unknown };
export function makePlaceholderAtlas<C extends CanvasLike = OffscreenCanvas | HTMLCanvasElement>(spec?: PlaceholderSpec, options?: { canvas?: (width: number, height: number) => C }): { json: AtlasJSON; canvas: C };
