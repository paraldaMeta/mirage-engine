import type * as THREE from 'three';
import type { MaterialHooks, MaterialKit } from '@miragekit/core/materials';
import type { MeshBatch } from '@miragekit/core/geom';

/** Linear RGB; values above 1 are fine on the glow material (they are its intensity). */
export type RGB = readonly [number, number, number];
/** An atlas cell [u0, v0, u1, v1]. */
export type AtlasRect = readonly [number, number, number, number];
/** The geometry helpers a builder needs: ctx.geom. */
export interface CyberGeom {
  MeshBatch: typeof MeshBatch;
  compose(position?: RGB, rotation?: RGB, scale?: number | RGB): THREE.Matrix4;
  RoundedBoxGeometry: new (width?: number, height?: number, depth?: number, segments?: number, radius?: number) => THREE.BufferGeometry;
  taperedTube(points: readonly RGB[], radii: readonly number[] | ((u: number) => number), options?: object): THREE.BufferGeometry;
}
/** The world ctx fields the kit reads. */
export interface CyberCtx {
  mat: MaterialKit;
  geom: CyberGeom;
  root: THREE.Object3D;
  shared: Record<string, unknown>;
  camera?: THREE.Camera;
}

/** propKit(ctx): the shared label atlas and its materials (one per ctx, cached on ctx.shared.props). */
export interface PropKit {
  /** Atlas cells by name: 'can0'..'can12', 'bottle0'.., 'box0'.., 'pack0'.., 'cap0'.., 'price0'.., 'sticker0'..,
   *  'header0'..'header4', 'warn0', 'warn1', 'stencil0', 'stencil1', 'plate0'..'plate2', 'menuA'..'menuC', 'bar0'..,
   *  'lantern0'..'lantern3', 'goods0'..'goods5', 'drives', 'keys', 'tyre', 'lens', 'vent', 'jdoor', 'backlit',
   *  'coin', 'lcd', 'keypad', 'push', 'white'. */
  R: Record<string, AtlasRect>;
  /** paint (dielectric), metal, glow (unlit, vertex colour = intensity), lantern, clear (glass), product (instanced labels). */
  mats: { paint: THREE.Material; metal: THREE.Material; glow: THREE.Material; lantern: THREE.Material; clear: THREE.Material; product: THREE.Material };
  /** Fit `geometry`'s uv into atlas cell `rect` (default: plain white), tint it, add it to `batch` at `matrix`. */
  put(batch: MeshBatch, geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4 | null, color?: RGB, rect?: AtlasRect | null): THREE.BufferGeometry;
  /** One instanced mesh of `geometry` (fitted to cell `base`), each item with its own label cell. */
  instanced(geometry: THREE.BufferGeometry, base: string, items: readonly { m: THREE.Matrix4; lab?: string }[], options?: { name?: string; material?: THREE.Material }): THREE.InstancedMesh | null;
  texture: THREE.CanvasTexture;
  /** The label lists the atlas was drawn from (invented brands). */
  names: Record<string, readonly (readonly string[] | string)[]>;
}
export function propKit(ctx: CyberCtx): PropKit;
export function uvRect<G extends THREE.BufferGeometry>(geometry: G, rect: AtlasRect): G;
export function tint<G extends THREE.BufferGeometry>(geometry: G, color: RGB): G;
export function uvByHeight<G extends THREE.BufferGeometry>(geometry: G, y0: number, y1: number): G;
export function hex(color: THREE.ColorRepresentation, k?: number): [number, number, number];

// ---- what a builder records for destructibles (the vertex ranges it added to each merged batch, its lamps)
/** [[group key, first vertex, vertex count]] */
export type BatchRanges = [unknown, number, number][];
export interface BreakableEntry { parts?: [MeshBatch, BatchRanges, 'draw' | 'glow'][]; draw?: { mesh: THREE.Mesh; range: [number, number] }[]; glow?: { mesh: THREE.Mesh; range: [number, number] }[]; [k: string]: unknown }
/** The shared list on ctx.shared.breakables. */
export function breakables(ctx: CyberCtx): { list: BreakableEntry[]; lampGroups?: Record<string, unknown> };
export function markBatch(batch: MeshBatch): Map<unknown, number>;
export function sinceMark(batch: MeshBatch, mark: Map<unknown, number>): BatchRanges;
/** The ranges fn() adds to batch (fn's own return value on .result). */
export function track<R>(batch: MeshBatch, fn: () => R): BatchRanges & { result: R };
/** A lamp several props share: it goes out with the last of them. */
export function breakablesLamp(ctx: CyberCtx, group: string, lamps: unknown): void;
/** The pool lamps (indices into ctx.shared.pool) and clustered lights fn() declares. */
export function trackLamps<R>(ctx: CyberCtx, fn: () => R): { pool: number[]; lights: THREE.Light[]; result: R };
/** A recorder for one module: add(entry); finished(batch, group) after batch.finish() resolves the ranges to draw handles. */
export function recorder(ctx: CyberCtx): { add(entry: BreakableEntry): BreakableEntry; finished(batch: MeshBatch, group: THREE.Object3D): THREE.Object3D };

/** The surface library per world (cached on ctx.shared.surf): core's createSurfaces in 'auto' mode, bake sizes per
 *  quality (ctx.shared.tier) and role ('big' | 'mid' | 'small'); surf(spec, options, { post, decl }) a material,
 *  painted(rgb, options) painted steel in any colour, shade(kind, rgb, options) a light-coloured set tinted. */
export function surfaceLib(ctx: CyberCtx): {
  lib: unknown;
  surf(spec: object, options?: object, extra?: { post?: string; decl?: string }): THREE.Material;
  painted(color: RGB, options?: object): THREE.Material;
  shade(kind: 'plastic' | 'coat' | 'board' | 'sawn', color: RGB | null, options?: object): THREE.Material;
  LIGHT: Record<string, unknown>; SURFACES: Record<string, (options?: object) => object>; SIZE: Record<string, number>; tier: string;
};

// ---- product shapes (uv laid out for their atlas family; rect: the cell they print from)
export function canGeo(rect: AtlasRect, segments?: number): THREE.BufferGeometry;
export function bottleGeo(rect: AtlasRect, segments?: number): THREE.BufferGeometry;
export function wineGeo(rect: AtlasRect, radius?: number, height?: number, segments?: number): THREE.BufferGeometry;
export function cupGeo(rect: AtlasRect, segments?: number): THREE.BufferGeometry;
export function boxGeo(rect: AtlasRect, width?: number, height?: number, depth?: number): THREE.BufferGeometry;
export function packGeo(rect: AtlasRect, width?: number, height?: number, depth?: number): THREE.BufferGeometry;
export function capsuleGeo(rect: AtlasRect): THREE.BufferGeometry;
export function spiralGeo(radius?: number, length?: number, turns?: number, wire?: number): THREE.BufferGeometry;
export function glassGeo(radius?: number, height?: number, segments?: number): THREE.BufferGeometry;
export function bowlGeo(radius?: number, height?: number, segments?: number): THREE.BufferGeometry;
export function jarGeo(rect: AtlasRect, radius?: number, height?: number, segments?: number): THREE.BufferGeometry;

// ---- builders: (props kit, batch, ctx.geom, matrix of the prop's foot (its front toward +z), ...)
type Builder<A extends unknown[] = []> = (P: PropKit, batch: MeshBatch, geom: CyberGeom, matrix: THREE.Matrix4, ...rest: A) => void;
export const spiritBottle: Builder<[options?: { r?: number; h?: number; glass?: RGB; liquid?: RGB; fill?: number; label?: number; cap?: RGB; square?: boolean }]>;
export const tumbler: Builder<[scale?: number]>;
export const bowls: Builder<[count?: number, color?: RGB, radius?: number]>;
export const pot: Builder<[radius?: number, height?: number, lid?: boolean]>;
export const noodleBasket: Builder;
export const riceCooker: Builder;
export const chopsticks: Builder;
export const skewers: Builder<[count?: number, span?: number]>;
export const stool: Builder<[seatY?: number]>;
export const goodsBox: Builder<[index: number, width?: number, height?: number, depth?: number]>;
export const jar: Builder<[index: number, radius?: number, height?: number]>;
export const goodsRack: Builder<[seed?: number, width?: number]>;
export const gasBottle: Builder;
export const extinguisher: Builder;

/** A paper lantern hanging from `top` [x, y, z]; print: 0..3 the character on its paper. */
export function paperLantern(P: PropKit, batch: MeshBatch, geom: CyberGeom, top: RGB, options?: { r?: number; h?: number; print?: number; color?: RGB; k?: number; tilt?: number; cord?: number; yaw?: number }): void;
/** A string of bulbs from a to c sagging `sag` m, n bulbs; returns the bulbs' positions (for lamps). */
export function bulbString(P: PropKit, batch: MeshBatch, geom: CyberGeom, a: RGB, c: RGB, sag: number, n: number, colors: readonly RGB[], options?: { r?: number }): [number, number, number][];
/** A street lamp at [x, y, z], `height` m, its arm toward `dir` (radians), the head `reach` m out. */
export function streetLamp(P: PropKit, batch: MeshBatch, geom: CyberGeom, foot: RGB, height: number, dir: number, reach?: number): void;
export const bulkhead: Builder<[color?: RGB, k?: number]>;
export const tubeFixture: Builder<[length: number, color?: RGB, k?: number, drop?: number]>;
export const floodlight: Builder<[color?: RGB, k?: number, tilt?: number]>;
export function beacon(P: PropKit, batch: MeshBatch, geom: CyberGeom, position: RGB, color?: RGB, k?: number, radius?: number): void;
export const signalHead: Builder<[colors: readonly RGB[], on?: number]>;

export const bin: Builder<[color?: RGB, open?: boolean]>;
export const crate: Builder<[size?: number, color?: RGB, stencil?: number]>;
export const bag: Builder<[seed?: number, color?: RGB]>;
export const cardboard: Builder<[size?: number, print?: number]>;
export const acUnit: Builder<[color?: RGB]>;
export const junctionBox: Builder<[height?: number, color?: RGB, conduits?: number]>;
export const bollard: Builder<[band?: RGB]>;
export const jersey: Builder<[length?: number]>;
export const newsBox: Builder<[color?: RGB, lit?: RGB]>;
export const bench: Builder<[length?: number]>;

// ---- cars
export interface CarDesign { name: string; [k: string]: unknown }
export const CAR_DESIGNS: readonly CarDesign[];
export function carMaterials(ctx: CyberCtx): { steel: THREE.Material; pearl: THREE.Material; glass: THREE.Material };
/** Parked cars at [[x, z, rotY], ...] (design i % 3). proxyBox: the host's collision volume per car; lamp: how the host
 *  lights the under-glow and the tail light (none without it). Returns the anchors { pos, rotY }. */
export function parkedCars(ctx: CyberCtx, P: PropKit, batch: MeshBatch, list: readonly (readonly [number, number, number])[],
  proxyBox?: (size: RGB, matrix: THREE.Matrix4, rotY: number) => void,
  options?: { lamp?: (ctx: CyberCtx, light: { pos: number[]; color: THREE.ColorRepresentation; intensity: number; range: number }) => unknown }): { pos: number[]; rotY: number }[];

/** Rain on a smooth surface (beads, runs, a film) added to `hooks`; compose inside core's withWet. */
export function rainBeads(hooks?: MaterialHooks, options?: { scale?: number; density?: number; run?: number; film?: number; strength?: number }): MaterialHooks;

// ---- civilian robots
export interface MachinesSpec {
  stand?: readonly { x: number; y: number; z: number; yaw: number; umb?: boolean }[];
  walkers?: { loop: { x0: number; x1: number; z0: number; z1: number }; speed?: number; n?: number; courier?: boolean };
  stall?: { m: THREE.Matrix4 };
  cart?: { m: THREE.Matrix4 };
  sweeper?: { a: RGB; b: RGB; y?: number };
  totem?: readonly [number, number, number, number];
  broken?: readonly (readonly [number, number, number, number])[];
  detail?: number;
}
export function buildMachines(ctx: CyberCtx, spec: MachinesSpec): { group: THREE.Group; update(t: number): void; count: number; tris: number; units(): unknown[] };
/** Every unit's batch instance ids and its body frame (the group buildMachines returned). */
export function machineUnits(group: THREE.Object3D | null | undefined): unknown[];

// ---- the robot parts kit (bodies, parts, decals, materials, gaits)
/** A robot part: geometry, slot ('s' shell, 'l' light...), colour, roughness, decal cell. */
export interface RobotPart { g: THREE.BufferGeometry; slot: string; [k: string]: unknown }
export function tf<G extends THREE.BufferGeometry>(geometry: G, position?: RGB, rotation?: RGB, scale?: RGB): G;
export function decalTexture(): THREE.Texture;
export function decalUV(cell: string, inset?: number): [number, number, number, number];
/** The robot kit's surface library per renderer (core's createSurfaces). */
export function robotSurfaces(world: object): any;
export function robotMaterials(world: object, options?: { rim?: { value: THREE.Vector3 } | null; key?: string; decals?: boolean; wear?: number; glow?: { value: THREE.Color } | null }): Record<string, THREE.Material>;
export const COL: Record<string, RGB>;
export function part(geometry: THREE.BufferGeometry, slot: string, color?: RGB, options?: { r?: number; d?: string | null; mud?: number | null }): RobotPart;
export function mergeParts(list: readonly RobotPart[]): THREE.BufferGeometry;
export function moved(list: readonly RobotPart[], matrix: THREE.Matrix4): RobotPart[];
export function ext(points: readonly (readonly [number, number])[], depth: number, bevel?: number, plane?: string, segments?: number): THREE.BufferGeometry;
export function drum(radius: number, width: number, quality: number, axis?: string, position?: RGB, colors?: object): RobotPart[];
export function link(r0: number, r1: number, y0: number, y1: number, segments: number, color: RGB, sx?: number, sz?: number, slot?: string, options?: object): RobotPart;
export function cover(points: readonly (readonly [number, number])[], segments: number, color: RGB, sx?: number, sz?: number, position?: RGB, options?: object): RobotPart[];
export function cable(a: RGB, b: RGB, bulge: RGB, radius: number, quality: number, color?: RGB): RobotPart;
export function decal(cell: string, width: number, height: number, position: RGB, rotation?: RGB): RobotPart & { decal: true };
export const JOINTS: Record<string, unknown>;
export const LEN: { thigh: number; shin: number; ankle: number; upper: number; fore: number };
/** A humanoid's parts per bone, at level of detail `lod` (0 near .. 2 far). */
export function humanoid(style: string, lod: number, kit?: object): Record<string, RobotPart[]>;
export function humanoidRig(parts: Record<string, RobotPart[]>): unknown;
export function quadrupedDims(style: string): Record<string, number>;
export function quadruped(style: string, lod: number, options?: { light?: RGB }): Record<string, RobotPart[]>;
/** Two-bone IK in a plane: the hip and knee angles that put the foot dz ahead and dy below, bones a and b. */
export function legIK(dz: number, dy: number, a: number, b: number, knee?: number): [number, number];
export function bipedLegs(phase: number, gait: object, out?: object): { hipY: number; legs: object[] };
export const GAITS: Record<string, object>;
export function trotLegs(phase: number, dims: object, gait: object, crouch?: number, out?: [number, number][]): [number, number][];

// ---- surfaces
export function corrugated(width: number, height: number, options?: { pitch?: number; depth?: number; ribs?: 'v' | 'h' }): THREE.BufferGeometry;
export function canopy(width: number, depth: number, drop: number, segments?: number): THREE.PlaneGeometry;
export const WORN_DECL: string;
/** Hooks for worn painted metal; `base` a GLSL vec3 (linear albedo). */
export function worn(base: string, options?: { rows?: number; chip?: number; rust?: number }): MaterialHooks;
export function interiorMaterial(ctx: CyberCtx, options?: { W?: number; H?: number; D?: number; kind?: 'shop' | 'clinic' }): THREE.MeshBasicMaterial;
export interface TextLabel { text: string | readonly string[]; style?: 'neon' | 'box' | 'plate' | 'way' | 'stencil'; color?: string; bg?: string; ink?: string; w: number; h: number }
export function textAtlas(entries: readonly TextLabel[], options?: { width?: number }): { texture: THREE.CanvasTexture; rect(i: number): [number, number, number, number] };
export function atlasQuad(width: number, height: number, rect: AtlasRect): THREE.PlaneGeometry;
