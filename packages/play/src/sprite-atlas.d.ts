// The atlas data and the direction convention (no three): docs/sprites-25d.md.
/** One animation of an atlas.json (docs/sprites-25d.md). */
export interface AtlasAnimJSON {
  /** frames a second (8) */
  fps?: number;
  /** true (default): repeats; false: holds the last frame and ends */
  loop?: boolean;
  /** one list of cell top-left corners [x, y] (px) per drawn direction */
  frames: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** the frame index the blow lands on (onHit) */
  hit?: number;
}
/** atlas.json: the sprite atlas format (docs/sprites-25d.md). */
export interface AtlasJSON {
  id?: string;
  /** px of one frame */
  cell: readonly [number, number];
  /** px in a cell where the feet touch the ground (the pivot); default bottom centre */
  feet?: readonly [number, number];
  /** metres the cell's height spans (1.75) */
  height?: number;
  /** 8: every direction drawn; 5: 0..4 drawn, 5..7 mirrored; 1: one for all (default) */
  dirs?: 1 | 5 | 8;
  anims: Record<string, AtlasAnimJSON>;
  /** the image beside the json (atlas.png) */
  image?: string;
  /** nearest-neighbour magnification */
  pixelArt?: boolean;
  [key: string]: unknown;
}
/** What atlas.frame() returns. */
export interface SpriteFrame {
  /** [u, v, du, dv] in texture space, v up */
  rect: [number, number, number, number];
  /** mirrored left-right */
  flip: boolean;
  index: number;
  count: number;
  /** a non-looping animation has run to its end */
  done: boolean;
}
/** parseAtlas's result: the atlas data, no texture. */
export interface AtlasData {
  id: string | null;
  json: AtlasJSON;
  cell: [number, number];
  size: [number, number];
  dirs: 1 | 5 | 8;
  /** metres */
  height: number;
  width: number;
  /** the feet in the cell, 0..1 from the left / from the bottom */
  feetU: number;
  feetV: number;
  texel: [number, number];
  names: string[];
  has(name: string): boolean;
  /** the animation, or idle (else the first) */
  anim(name: string): AtlasAnimJSON;
  duration(name: string): number;
  frame(name: string, dir: number, seconds: number, out?: SpriteFrame): SpriteFrame;
}
export interface SpritePlayOptions {
  /** start over even when the animation is already playing */
  restart?: boolean;
  speed?: number;
  /** once, on the atlas's hit frame (a third of the way in without one) */
  onHit?: (() => void) | null;
  /** once, when a non-looping run ends */
  onEnd?: (() => void) | null;
}
export interface SpriteAnim {
  readonly frame: SpriteFrame;
  readonly name: string;
  readonly time: number;
  play(name: string, options?: SpritePlayOptions): SpriteAnim;
  /** advance dt seconds at screen direction dir; fires the callbacks */
  update(dt: number, dir?: number): SpriteFrame;
}

/** The screen direction 0..7 of facing angle a (atan2(dx, dz)) seen from a camera at yaw. */
export function spriteDirection(a: number, yaw?: number): number;
/** [drawn direction, mirrored] for screen direction dir with `dirs` drawn. */
export function drawnDirection(dirs: number, dir: number): [number, boolean];
/** Check an atlas.json against its image size (throws listing every problem). */
export function parseAtlas(json: AtlasJSON, size: { width: number; height: number }): AtlasData;
export function createSpriteAnim(atlas: AtlasData): SpriteAnim;

