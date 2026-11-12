import type * as THREE from 'three';
import type { MaterialKit } from '@miragekit/core/materials';
import type { AtlasJSON, AtlasData, SpriteAnim, SpritePlayOptions } from './sprite-atlas.js';
import type { PlaceholderSpec } from './sprite-placeholder.js';

export { spriteDirection, drawnDirection, parseAtlas, createSpriteAnim } from './sprite-atlas.js';
export type { AtlasJSON, AtlasAnimJSON, AtlasData, SpriteFrame, SpriteAnim, SpritePlayOptions } from './sprite-atlas.js';
export { makePlaceholderAtlas } from './sprite-placeholder.js';
export type { PlaceholderSpec, CanvasLike } from './sprite-placeholder.js';

/** makeAtlas / loadAtlas: the data with its texture. */
export interface SpriteAtlas extends AtlasData {
  texture: THREE.Texture;
  /** 'file' or 'placeholder' */
  source: string;
}
export function makeAtlas(json: AtlasJSON, image: THREE.Texture | TexImageSource | OffscreenCanvas, options?: { pixelArt?: boolean; source?: string }): SpriteAtlas;
export function loadAtlas(url: string | URL, options?: { placeholder?: PlaceholderSpec | true | null; fetch?: typeof fetch; pixelArt?: boolean }): Promise<SpriteAtlas>;

/** A world renderer or a module ctx: what the sprite materials need. */
export interface SpriteWorld {
  mat: MaterialKit;
  scene?: THREE.Object3D;
  /** (a world renderer) the emissive colours follow the frame's exposure */
  ctx?: { onUpdate(fn: (seconds: number) => void): () => void };
  post?: { exposure?: number };
  readonly exposure?: number;
}
export interface SpriteUniforms {
  uAtlas: THREE.IUniform<THREE.Texture>;
  uRect: THREE.IUniform<THREE.Vector4>;
  uCard: THREE.IUniform<THREE.Vector4>;
  uTexel: THREE.IUniform<THREE.Vector2>;
  uFlip: THREE.IUniform<number>;
  uLift: THREE.IUniform<number>;
  uTint: THREE.IUniform<THREE.Vector3>;
  /** rgb, width in texels (0 = off) */
  uOutline: THREE.IUniform<THREE.Vector4>;
  uFlash: THREE.IUniform<number>;
  uFade: THREE.IUniform<number>;
  /** 1 / the frame's exposure, shared per world */
  uEmit: THREE.IUniform<number>;
  [name: string]: THREE.IUniform;
}
export function createSpriteMaterial(world: SpriteWorld, atlas: SpriteAtlas): THREE.MeshStandardMaterial;
export function createSilhouetteMaterial(world: SpriteWorld, uniforms: SpriteUniforms, options?: { color?: readonly [number, number, number]; opacity?: number }): THREE.MeshBasicMaterial;

export interface SpriteActorOptions {
  /** where the group goes (world.scene); null: not added */
  parent?: THREE.Object3D | null;
  /** blob size as a share of the card's width (0.42) */
  shadow?: number;
  shadowOpacity?: number;
  /** a see-through silhouette where something stands in front */
  silhouette?: boolean | { color?: readonly [number, number, number]; opacity?: number };
  /** the ground's height at (x, z) (NaN: none): the blob lies on it, tilted with the slope */
  ground?: ((x: number, z: number) => number) | null;
}
export interface ScreenRect { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; depth: number }
export interface SpriteActor {
  group: THREE.Group;
  card: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  blob: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  silhouette: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  atlas: SpriteAtlas;
  uniforms: SpriteUniforms;
  anim: SpriteAnim;
  readonly name: string;
  readonly dir: number;
  readonly facing: number;
  setFacing(a: number): SpriteActor;
  faceToward(x: number, z: number): SpriteActor;
  play(name: string, options?: SpritePlayOptions): SpriteActor;
  duration(name: string): number;
  /** k: 0..1; 0 clears */
  flash(k?: number): SpriteActor;
  outline(kind: 'hover' | 'enemy' | 'friend' | 'select' | readonly [number, number, number] | null, width?: number): SpriteActor;
  setTint(r: number, g: number, b: number): SpriteActor;
  setFade(k: number): SpriteActor;
  setLift(metres: number): SpriteActor;
  visible: boolean;
  /** returns the screen direction */
  update(dt: number, yaw?: number | { yaw: number }): number;
  screenRect(camera: THREE.Camera, width: number, height: number, out?: Partial<ScreenRect>): ScreenRect;
  dispose(): void;
}
export function createSpriteActor(world: SpriteWorld, atlas: SpriteAtlas, options?: SpriteActorOptions): SpriteActor;
