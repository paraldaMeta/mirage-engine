import type * as THREE from 'three';
export type DecoderSource = string | { js: string; wasm: string };
export interface AssetDecoders { draco?: DecoderSource; basis?: DecoderSource }
export type AssetCollide = 'mesh' | 'box' | 'hull' | false;
export interface AssetsOptions {
  decoders?: AssetDecoders;
  /** patch imported materials into the world (default true); a function may return a replacement material */
  adapt?: boolean | ((material: THREE.Material, mesh: THREE.Mesh) => THREE.Material | void);
  anisotropy?: number; workers?: number;
}
export interface AssetLoadOptions {
  /** cache key (default: the URL; give one to share a buffer) */
  key?: string;
  /** base URL for external .bin / image files of a buffer */
  path?: string;
  scale?: number; shadows?: boolean; collide?: AssetCollide; adapt?: AssetsOptions['adapt'];
}
export interface AssetModel {
  readonly key: string;
  /** the template: never add it to a scene, instantiate() it */
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[]; cameras: THREE.Camera[]; asset: Record<string, unknown>;
  collide: AssetCollide; collider: THREE.BufferGeometry | null; bounds: THREE.Box3; skinned: boolean; disposed?: boolean;
  stats: { meshes: number; triangles: number; geometries: number; materials: number; textures: number; bytes: number; skinned: boolean; extensions: string[]; ms: number };
}
export interface AssetInstances {
  root: THREE.Group; count: number; model: AssetModel;
  setMatrixAt(index: number, matrix: THREE.Matrix4): AssetInstances;
  commit(): AssetInstances;
}
export interface Assets {
  load(src: string | ArrayBuffer | ArrayBufferView, options?: AssetLoadOptions): Promise<AssetModel>;
  get(key: string): AssetModel | undefined;
  instantiate(model: AssetModel | string, options?: { skeleton?: boolean }): THREE.Object3D;
  instances(model: AssetModel | string, matrices: THREE.Matrix4[] | number): AssetInstances;
  retain<T extends AssetModel>(model: T): T;
  release(target: AssetModel | AssetInstances | THREE.Object3D | string): void;
  refs(model: AssetModel | string): number;
  stats(): { models: number; refs: number; bytes: number; triangles: number };
  dispose(): void;
}
export function gltfExtensions(buffer: ArrayBuffer | Uint8Array): string[];
export function createAssets(world: { G?: Record<string, { value: unknown }>; renderer?: THREE.WebGLRenderer }, options?: AssetsOptions): Assets;
