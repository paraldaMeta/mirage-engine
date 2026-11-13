import type * as THREE from 'three';
import type { Game } from './game.js';
import type { Physics } from './physics.js';
import type { AudioMixer } from './audio.js';

type V3 = [number, number, number];

/** The damage kinds; armour is a multiplier per kind (0 immune, 1 as dealt). */
export type DamageKind = 'bullet' | 'pellet' | 'blast' | 'melee' | 'emp' | 'fire';
export const DAMAGE_KINDS: DamageKind[];
/** A class name: the registered table's (@miragekit/assets/destruct: glass, paper, wood, cardboard, plastic, thinMetal,
 *  heavyMetal, ceramic, liquid, electronics, fabric, actor; the built-in default: generic, actor). */
export type MaterialClass = string;

export interface DestructStage {
  /** The share of health lost at which the stage starts (0..1). */
  at: number;
  /** A mark on the surface at each hit from here on: crack, hole, dent, splinter, puddle, scorch, soot. */
  mark?: 'crack' | 'hole' | 'dent' | 'splinter' | 'puddle' | 'scorch' | 'soot';
  /** One mark per hit place that grows with the damage (glass cracks). */
  grow?: boolean;
  /** Its lamps stutter for a moment. */
  flicker?: boolean;
  /** Show this broken state already (a dent) in place of the prop. */
  state?: 'pane' | 'crate' | 'dent' | 'tyre';
  /** A particle effect (DESTRUCT_EFFECTS name) at each hit from here on. */
  fx?: string;
  color?: string; opacity?: number;
}
export interface DebrisSpec {
  shape: 'glass' | 'shard' | 'chunk' | 'flake' | 'bolt';
  count: number;
  /** Metres; drawn on a power law (many small, a few large). */
  size: [number, number];
  speed: [number, number];
  spread: number; up?: number; bounce: number; friction: number; spin: number;
  /** Seconds lying still before it fades. */
  rest: number;
  drag?: number;
  colors: string[];
}
export interface DestructMaterial {
  health: number;
  armour: Partial<Record<DamageKind, number>>;
  /** The share of a bullet's or pellet's damage that goes on through it. */
  pierce: number;
  value: number;
  /** The sound set: dx_break_<sound>. */
  sound: string;
  hitSound?: 'tick' | 'ping' | 'zap' | 'thud';
  stages: DestructStage[];
  debris: DebrisSpec | false;
  fx: { hit?: string; break?: string };
  /** Blasts behind it are cut to a quarter. */
  blocks?: boolean;
  behave?: Partial<Behaviours>;
}
/** A class table: what registerDestructData takes and destructData returns. */
export interface DestructData {
  materials: Record<string, DestructMaterial>;
  /** The particle effects (vfx JSON) the classes and behaviours name. */
  effects: Record<string, object>;
  /** The class a name the game adds starts from. */
  fallback: string;
  /** Adds the sounds the classes name to a createAudio() mixer. */
  addSounds: ((audio: Pick<AudioMixer, 'add'>) => unknown) | null;
}
/** Set the class table for registries made from now on (@miragekit/assets/destruct registers the library's); null: the
 *  built-in default (one `generic` class and an `actor`, no effects, no sounds). Returns the table in use. */
export function registerDestructData(data: { materials: Record<string, DestructMaterial>; effects?: Record<string, object>; fallback?: string; addSounds?: ((audio: Pick<AudioMixer, 'add'>) => unknown) | null } | null): DestructData;
/** The class table registries are made from now. */
export function destructData(): DestructData;
/** Broken-state geometry generators in a unit box: pane (XY plane), crate, dent (front +Z), tyre (axis X). */
export const BROKEN_STATES: { pane(seed?: string): THREE.BufferGeometry; crate(): THREE.BufferGeometry; dent(seed?: string): THREE.BufferGeometry; tyre(): THREE.BufferGeometry };
export const MARKS: Record<string, { tile: number; size: number; color: string; opacity: number }>;

/** What is drawn: an Object3D, one instance, one BatchedMesh instance, a vertex range of a merged mesh, your own hide / show, or several. */
export type DrawHandleSpec = THREE.Object3D
  | { mesh: THREE.InstancedMesh; index: number }
  | { mesh: THREE.BatchedMesh; id: number }
  | { mesh: THREE.Mesh; range: [number, number] }
  | { mesh: THREE.Mesh; indexRange: [number, number] }
  | { hide(): void; show?(): void; box?(obb: { c: V3; u: number[]; h: V3 }): boolean; material?: THREE.Material }
  | DrawHandleSpec[];

export interface Behaviours {
  explosive: { delay?: number; radius?: number; damage?: number; falloff?: BlastOptions['falloff']; occlusion?: boolean; fx?: string; sound?: string; scorch?: boolean; noise?: number };
  spillLiquid: { radius?: number; grow?: number; color?: string; slippery?: boolean; conductive?: boolean; liquid?: string };
  ventSteam: { duration?: number; radius?: number; height?: number; density?: number; effect?: string; sound?: string };
  sprayWater: { duration?: number; radius?: number; height?: number; density?: number; effect?: string; sound?: string };
  dropLoot: { chance?: number; table?: { id: string; weight?: number; [k: string]: unknown }[] };
  alarm: { radius?: number; duration?: number; on?: 'hit' | 'break'; sound?: string };
  fall: { damage?: number; radius?: number; bounce?: number };
  chain: { delay?: number; index?: number };
  burn: { duration?: number; then?: 'break' | 'explode'; catch?: DamageKind[]; at?: number; fx?: string; sound?: string };
}
export interface MoverSpec {
  shape?: 'cylinder' | 'box';
  radius?: number; height?: number; mass?: number; bounce?: number; friction?: number;
  /** false: knocked about, never broken (a can). */
  breakable?: boolean;
  /** Back into its instance when it comes to rest (default true). */
  reinstance?: boolean;
}
export interface DestructibleSpec {
  id?: string;
  draw?: DrawHandleSpec;
  material?: MaterialClass | string;
  health?: number;
  armour?: Partial<Record<DamageKind, number>>;
  pierce?: number;
  value?: number;
  /** A hit volume; default: the drawn thing's bounds. */
  box?: { center: V3; half: V3; quaternion?: [number, number, number, number]; yaw?: number } | { min: V3; max: V3 };
  sphere?: { center: V3; radius: number };
  capsule?: { a: V3; b: V3; radius: number };
  /** A fixed Rapier cuboid the character bumps into, gone when it breaks. */
  solid?: boolean;
  /** Never breaks (quest items, the owner's signs): takes hits, shows impacts, nothing more. */
  protected?: boolean;
  group?: string;
  tags?: string[];
  /** Lamp pool indices it owns (dark when it breaks). */
  lamps?: number[];
  lights?: THREE.Light[];
  emissive?: THREE.Material | { mesh: THREE.InstancedMesh | THREE.BatchedMesh; index?: number; id?: number } | (THREE.Material | { mesh: THREE.InstancedMesh | THREE.BatchedMesh; index?: number; id?: number })[];
  /** 'off' (default) or 'flicker' (stutters, then off) when it breaks. */
  lampMode?: 'off' | 'flicker';
  /** The broken state: a generator name, your own object, a function making one, or null (just gone). */
  broken?: 'pane' | 'crate' | 'dent' | 'tyre' | THREE.Object3D | ((item: Destructible) => THREE.Object3D | null) | null;
  brokenMaterial?: THREE.Material;
  behave?: { [K in keyof Behaviours]?: Partial<Behaviours[K]> | boolean };
  mover?: MoverSpec;
  stages?: DestructStage[];
  debris?: Partial<DebrisSpec> | false;
  fx?: { hit?: string; break?: string };
  sound?: string;
  surface?: string;
  /** Metres of the 'noise' event a break makes (default by class). */
  noise?: number;
  /** A couple of real kit bodies for its big pieces (options.kit). */
  physics?: boolean;
  liquid?: string;
  onHit?(e: HitEvent, d: Destructibles): void;
  onBreak?(e: BreakEvent, d: Destructibles): void;
}
export interface ActorSpec extends Omit<DestructibleSpec, 'box' | 'sphere' | 'capsule'> {
  pos?: V3; height?: number; radius?: number;
  /** The pieces of the slump, the top ones with a later start (lag 0..1). */
  parts?: { draw: DrawHandleSpec; lag?: number }[];
  panicRadius?: number;
  /** Pose it yourself: k from 0 (standing) to 1 (down). */
  collapse?(item: Destructible, k: number, dir: V3): void;
  onPanic?(item: Destructible, from: V3, e: object): void;
}
export interface Destructible {
  readonly id: string; readonly index: number; readonly cls: string; readonly mat: DestructMaterial; readonly spec: DestructibleSpec;
  health: number; readonly max: number; stage: number; broken: boolean; readonly protected: boolean; readonly value: number;
  readonly group: string | null; readonly tags: string[];
  readonly vol: { type: 0 | 1 | 2; c?: V3; u?: number[]; h?: V3; r?: number; a?: V3; b?: V3 };
  readonly aabb: Float64Array;
  [k: string]: unknown;
}
export interface HitEvent { item: Destructible; damage: number; kind: DamageKind; point: V3; normal: V3; dir: V3; source: unknown; stage: number; broke: boolean }
export interface BreakEvent { item: Destructible; id: string; class: string; value: number; tags: string[]; point: V3; dir: V3; kind: DamageKind; source: unknown; time: number }
export interface HitRecord { item: Destructible; id: string; t: number; point: V3; normal: V3; damage: number; broke: boolean; class: string }
/** Reused between calls: copy what you keep. */
export interface HitResult { item: Destructible | null; t: number; point: V3; normal: V3; hits: HitRecord[]; count: number; stopped: 'world' | 'item' | 'none'; world: { distance: number; point?: V3; normal?: V3; object?: unknown } | null; left: number }
export interface HitOptions {
  ray?: { origin?: V3; from?: V3; dir: V3; max?: number };
  point?: V3; normal?: V3; dir?: V3; radius?: number;
  item?: string | Destructible;
  kind?: DamageKind; damage?: number; source?: unknown;
  /** false: the first prop stops it. */
  pierce?: boolean;
  /** false: do not ask the occluder for the world in the way (you already cut `max` there). */
  occlude?: boolean;
}
export interface BlastOptions {
  point: V3; radius?: number; damage?: number;
  falloff?: 'linear' | 'square' | 'none' | number | ((x: number) => number);
  occlusion?: boolean; kind?: DamageKind; source?: unknown;
  /** The least share at the rim. */
  min?: number;
}
export interface BlastHit { item: Destructible; damage: number; distance: number; cover: number }
export interface Tally { count: number; value: number; casualties: number; byClass: Record<string, { count: number; value: number }>; byTag: Record<string, { count: number; value: number }> }
export interface DestructSnapshot { v: 1; steps: number; broken: (string | [string, number])[]; hurt: [string, number, number][]; moved: [string, number, number, number, number, number, number, number][] }
export interface DestructiblesOptions {
  seed?: string; hz?: number;
  /** Quality 0..1: debris counts, caps, marks and bursts scale with it. */
  detail?: number;
  maxDebris?: number; maxDecals?: number; maxEmitters?: number; maxSpawnPerStep?: number; maxMovers?: number; maxPierce?: number; maxSounds?: number; maxFx?: number; maxBodies?: number;
  /** Grid cell (m). */
  cell?: number; gravity?: number;
  root?: THREE.Object3D;
  world?: { scene: THREE.Scene; lampPool?: unknown };
  vfx?: { burst(effect: object, at: V3, o?: object): void; spawn(effect: object, o?: object): { stop(): unknown }; prewarm?(effect: object, options?: { compile?: boolean }): unknown } | null;
  audio?: Partial<AudioMixer> | null;
  /** false: do not add the destructibles sounds to the audio. */
  sounds?: boolean;
  physics?: Physics | null;
  kit?: { rigid(obj: THREE.Object3D, o: object): { impulse?(j: V3, at?: V3): void; remove?(): void } } | null;
  /** A lamp pool (its scale(i, k)) or a function. */
  lamps?: { scale(i: number, k: number): unknown } | ((index: number, k: number) => void) | null;
  occluder?: ((from: V3, dir: V3, max: number) => { distance: number; point?: V3; normal?: V3 } | null) | null;
  /** What a blast behind solid world keeps (default 0). */
  occludedBlast?: number;
  floor?: number | ((x: number, y: number, z: number) => number);
  colliders?: { min: V3; max: V3 }[];
  /** Also a Rapier sensor per prop (kit.ray with sensors: true finds them; d.fromCollider maps back). */
  sensors?: boolean;
  materials?: Partial<Record<string, Partial<DestructMaterial>>>;
  effects?: Record<string, object>;
  onBlast?(e: object, d: Destructibles): void;
  onCrush?(e: object, d: Destructibles): void;
  onNoise?(e: { point: V3; radius: number; item: Destructible; kind: string }): void;
  onLoot?(e: { item: Destructible; point: V3; loot: { id: string } }): void;
  /** With a game: step with its systems and save with its entities (default true). */
  attach?: boolean;
  /** The game entity id (default 'destructibles'). */
  id?: string;
}
export interface Destructibles {
  add(spec: DestructibleSpec): Destructible;
  actor(spec: ActorSpec): Destructible;
  place(id: string | Destructible, pos: V3): void;
  hit(o: HitOptions): HitResult;
  blast(o: BlastOptions): BlastHit[];
  ray(origin: V3, dir: V3, max?: number): { item: Destructible; t: number; point: V3; normal: V3 } | null;
  cover(from: V3, to: V3, ignore?: Destructible | null, occludedK?: number): number;
  query(p: V3, radius: number): Destructible[];
  get(id: string): Destructible | null;
  readonly items: Destructible[];
  break(id: string | Destructible, o?: { kind?: DamageKind; point?: V3; dir?: V3; source?: unknown }): boolean;
  damage(id: string | Destructible, amount: number, kind?: DamageKind, o?: { point?: V3; normal?: V3; dir?: V3; source?: unknown }): number;
  on(type: 'hit' | 'stage' | 'break' | 'casualty' | 'panic' | 'noise' | 'blast' | 'crush' | 'loot' | 'spill' | 'fire' | 'steam' | 'water' | 'restore' | 'reset', fn: (e: any, d: Destructibles) => void): () => boolean;
  emit(type: string, e: unknown): void;
  update(frameDt: number): number;
  step(): void;
  sync(alpha?: number): void;
  snapshot(): DestructSnapshot;
  restore(s: DestructSnapshot): DestructSnapshot;
  reset(): void;
  prewarm(options?: { compile?: boolean }): void;
  dispose(): void;
  fromCollider(handle: number | { handle: number }): Destructible | null;
  visibility(from: V3, to: V3): number;
  blocksSight(from: V3, to: V3, threshold?: number): boolean;
  surfaceAt(p: V3): { slippery: boolean; conductive: boolean; liquid: string; item: Destructible; c: V3; r: number } | null;
  setDetail(x: number): number;
  setLamps(a: DestructiblesOptions['lamps']): void;
  hash(): string;
  readonly tally: Tally;
  readonly stats: { items: number; broken: number; debris: number; marks: number; emitters: number; movers: number; timers: number; stepMs: number; hits: number; blasts: number; spawnDropped: number };
  readonly materials: Record<string, DestructMaterial>;
  readonly effects: Record<string, object>;
  readonly cfg: Record<string, number>;
  readonly debris: { live: number; stats: { live: number; spawned: number; recycled: number; dropped: number }; meshes: THREE.InstancedMesh[] | null; hash(): string };
  readonly marks: { count: number; mesh: THREE.InstancedMesh | null };
  readonly time: number; readonly steps: number; readonly alpha: number;
  readonly occluders: object[]; readonly puddles: object[]; readonly moving: Destructible[];
}
/** target: startGame's session or setup's ctx ({ game, physics, audio, root, world }), or {}. */
export function createDestructibles(target?: { game?: Game; physics?: Physics; audio?: AudioMixer; root?: THREE.Object3D; world?: { scene: THREE.Scene } } | Game, options?: DestructiblesOptions): Destructibles;
