// Mirage original code. Types for '@mirage/net' (the browser-safe index) and, at the end, '@mirage/net/server'.
import type { WalkGrid, WalkerLike } from '@mirage/play';

/** A datagram pipe: every transport (loopback, WebSocket, relay, WebRTC) has this shape. */
export interface Transport {
  readonly kind: 'loopback' | 'websocket' | 'relay' | 'webrtc' | string;
  /** false: packets may be lost, repeated or reordered (channel.js copes either way) */
  readonly reliable: boolean;
  open: boolean;
  send(bytes: Uint8Array): void;
  close(why?: string): void;
  onmessage: ((bytes: Uint8Array) => void) | null;
  onclose: ((why: string) => void) | null;
  onopen?: (() => void) | null;
}
/** A simulated network. Probabilities are 0..1, times are milliseconds, applied per packet per direction. */
export interface Conditions { latency?: number; jitter?: number; loss?: number; duplicate?: number; reorder?: number; both?: boolean }
export interface LoopbackNetwork {
  readonly now: number;
  /** two connected ends */
  pair(conditions?: Conditions): [Transport, Transport];
  /** move the network's clock: delivers everything due (tests drive time with this) */
  advance(ms: number): void;
  [more: string]: unknown;
}
export function createLoopbackNetwork(defaults?: Conditions & { seed?: string | number }): LoopbackNetwork;
/** Wrap a real transport in simulated conditions. The `conditions` object stays live: change it while running. */
export function conditioned(transport: Transport, conditions?: Conditions, o?: { seed?: string | number; timer?: typeof setTimeout }): Transport;
export function webSocketTransport(target: string | WebSocket, o?: { WebSocketImpl?: typeof WebSocket }): Transport;
export function rtcTransport(o: { initiator?: boolean; signal: { send(data: unknown): void; onmessage: ((data: unknown) => void) | null }; iceServers?: RTCIceServer[]; timeout?: number; RTCPeerConnectionImpl?: typeof RTCPeerConnection }): Transport;
/** Use `fallback` now and switch to `better` when (if) it opens, without a reconnect. */
export function preferTransport(fallback: Transport, better: Transport): Transport;

export interface ChannelStats { rtt: number; loss: number; packetsOut: number; packetsIn: number; bytesOut: number; bytesIn: number; resent: number }
export interface Channel {
  sendUnreliable(bytes: Uint8Array): number;
  sendReliable(bytes: Uint8Array): void;
  update(): void;
  budget(): number;
  readonly stats: ChannelStats;
  [more: string]: unknown;
}
export function createChannel(o: { transport: Transport; now?: () => number; onUnreliable?: (bytes: Uint8Array, seq: number) => void; onReliable?: (bytes: Uint8Array) => void; onAck?: (seq: number) => void; onViolation?: (why: string) => void; maxPacket?: number; maxReliableIn?: number }): Channel;

export interface FieldDef { name: string; t: string; owner?: boolean; [more: string]: unknown }
export const field: {
  /** a number in [min, max] stored in steps of `step` */
  q(name: string, min: number, max: number, step?: number, o?: object): FieldDef;
  angle(name: string, bits?: number, o?: object): FieldDef;
  u(name: string, bits?: number, o?: object): FieldDef;
  bool(name: string, o?: object): FieldDef;
  f32(name: string, o?: object): FieldDef;
  str(name: string, max?: number, o?: object): FieldDef;
  /** x, y, z inside the protocol's bounds, to 1/256 m */
  pos(o?: object): FieldDef[];
};
export interface Protocol { readonly hash: number; entity: Record<string, unknown>; rpc: Record<string, unknown>; event: Record<string, unknown>; [more: string]: unknown }
export function defineProtocol(def: { version?: number; bounds: [number, number, number, number]; y?: [number, number]; player?: (FieldDef | FieldDef[])[]; entities?: Record<string, (FieldDef | FieldDef[])[]>; rpcs?: Record<string, (FieldDef | FieldDef[])[]>; events?: Record<string, (FieldDef | FieldDef[])[]> }): Protocol;

export interface GridData { nx: number; nz: number; x0: number; z0: number; cell: number; floors: Float32Array; count: Uint8Array }
export function serializeGrid(grid: GridData): Uint8Array;
/** Throws on anything that is not a grid (sizes are checked before anything is allocated). */
export function deserializeGrid(bytes: Uint8Array): WalkGrid;
export function bakeGridCPU(triangles: Float32Array | number[], o: { bounds: [number, number, number, number]; cell?: number; yMin?: number; yMax?: number }): WalkGrid;
export function boxTriangles(boxes: { min: number[]; max: number[] }[] | number[][]): Float32Array;
export function sceneTriangles(scene: object): Float32Array;

export type EntityState = Record<string, number | string | boolean>;
export interface RoomEntity { id: number; type: { name: string }; readonly state: EntityState; get(field: string): number | string; set(patch: EntityState): RoomEntity; data: unknown }
export interface RoomPlayer { id: number; name: string; ent: RoomEntity; walker: WalkerLike; data: Record<string, unknown>; [more: string]: unknown }
export interface RpcContext { viewTime: number; [more: string]: unknown }
export interface RoomStats { tickMs: number; tickMax: number; overruns: number; bytesOut: number; bytesIn: number; [more: string]: number }
export interface RoomOptions {
  protocol: Protocol; grid: WalkGrid; spawn?: number[] | ((player: RoomPlayer) => number[]);
  /** 1..60, must divide 60 (default 20) */
  tickRate?: number; maxPlayers?: number; name?: string; code?: string;
  interest?: { radius?: number; cell?: number };
  onJoin?(player: RoomPlayer, resumed: boolean): void; onLeave?(player: RoomPlayer, why: string): void; onTick?(room: Room, dt: number): void;
  /** bytes from room.serialize(): continue that room (host migration) */
  restore?: Uint8Array; now?: () => number;
  [more: string]: unknown;
}
export interface Room {
  readonly protocol: Protocol; readonly tickRate: number; readonly players: Map<number, RoomPlayer>; readonly entities: Map<number, RoomEntity>; readonly stats: RoomStats;
  readonly time: number; readonly connections: number;
  accept(transport: Transport, o?: object): void;
  start(): void; stop(): void; tick(): void;
  spawn(type: string, state: EntityState, o?: object): RoomEntity;
  despawn(entity: RoomEntity): void;
  rpc(name: string, fn: (player: RoomPlayer, args: any, ctx: RpcContext) => void): Room;
  emit(name: string, args?: object, to?: RoomPlayer | null): void;
  /** Lag compensated ray: others are put back where they were at `time` (at most 400 ms). */
  hitscan(player: RoomPlayer, o: { dir: number[]; range?: number; time?: number; origin?: number[]; radius?: number; height?: number; walls?: boolean; filter?(e: RoomEntity): boolean }): { entity: RoomEntity; distance: number; point: number[] } | null;
  serialize(): Uint8Array; shareState(): void;
  kick(player: RoomPlayer, why?: string): void;
  onTick(fn: (room: Room, dt: number) => void): Room;
  close(why?: string): void;
  [more: string]: unknown;
}
export function createRoom(o: RoomOptions): Room;

export interface ClientEntity { id: number; name: string; own: boolean; state: EntityState }
export interface ClientStats { rtt: number; loss: number; delay: number; offset: number; predErr: number; predErrMax: number; corrections: number; bytesIn: number; bytesOut: number; byType: Record<string, number>; [more: string]: unknown }
export interface Client {
  readonly protocol: Protocol; readonly entities: Map<number, ClientEntity>; readonly stats: ClientStats;
  /** give this to createPlay({ walker }) */
  readonly walker: WalkerLike;
  input: { x: number; z: number; run: boolean; jump: boolean; yaw: number };
  id: number; status: 'idle' | 'connecting' | 'joined' | 'closed' | string; name: string; tickRate: number; room: string; code: string; kicked: string;
  me: ClientEntity | null;
  onJoin: (() => void) | null; onSpawn: ((e: ClientEntity) => void) | null; onDespawn: ((e: ClientEntity) => void) | null;
  onClose: ((why: string) => void) | null; onKick: ((why: string) => void) | null; onCorrection: ((error: number) => void) | null;
  connect(transport: Transport): void;
  update(): void;
  rpc(name: string, args?: object): void;
  on(name: string, fn: (args: any) => void): Client;
  close(why?: string): void;
  readonly serverTime: number; readonly viewTime: number; readonly pending: number; readonly transport: Transport | null;
  [more: string]: unknown;
}
export function createClient(o: { protocol: Protocol; grid: WalkGrid; name?: string; token?: Uint8Array | null; now?: () => number; maxEntities?: number; [more: string]: unknown }): Client;

export interface RoomInfo { code: string; name: string; players: number; max: number; mode: 'dedicated' | 'host' }
export interface Lobby {
  list(): Promise<RoomInfo[]>;
  create(name: string, max?: number): Promise<string>;
  join(code: string): Promise<{ mode: 'dedicated' | 'host'; key: string; host: string; transport: Transport }>;
  host(name: string, max?: number): Promise<{ code: string; key: string }>;
  leave(): Promise<void>;
  close(): void;
  code: string;
  onclose: ((why: string) => void) | null;
  [more: string]: unknown;
}
export function connectLobby(url: string, o?: { WebSocketImpl?: typeof WebSocket; timeout?: number }): Promise<Lobby>;

export interface SessionOptions {
  lobby: Lobby; protocol: Protocol; grid: WalkGrid; name?: string; spawn?: number[]; tickRate?: number;
  /** runs where the room runs: needed by anyone who may host, now or after a migration */
  setup?(room: Room, o: { restored: boolean }): void;
  rtc?: boolean; iceServers?: RTCIceServer[]; conditions?: Conditions | null;
  [more: string]: unknown;
}
export interface Session {
  client: Client; lobby: Lobby; mode: 'dedicated' | 'host';
  /** the room, while this page is the host */
  room: Room | null; conditions: Conditions | null;
  onhost: ((room: Room) => void) | null;
  close(): void;
  [more: string]: unknown;
}
export function joinRoom(o: SessionOptions & { code: string }): Promise<Session>;
export function hostRoom(o: SessionOptions & { roomName?: string; maxPlayers?: number }): Promise<Session>;

/** A ready-made protocol: players with names and scores, `pickup` entities, chat, take and tag RPCs. */
export function kitProtocol(o: { bounds: [number, number, number, number]; y?: [number, number]; version?: number }): Protocol;
export function installKit(room: Room, o?: { pickups?: number[][]; reach?: number; respawnMs?: number; chatMs?: number; tagRange?: number; restored?: boolean }): unknown;

export interface NetOverlay { el: HTMLElement; values: Record<string, unknown>; update(): void; read(): Record<string, unknown>; dispose(): void }
export function createNetOverlay(client: Client, o?: { parent?: HTMLElement; conditions?: Conditions | null; session?: Session | null; interval?: number; keys?: boolean; now?: () => number }): NetOverlay;
