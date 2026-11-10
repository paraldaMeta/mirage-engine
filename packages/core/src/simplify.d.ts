export interface SimplifyMesh { positions: Float32Array; index?: Uint32Array | Uint16Array | null;
  attributes?: { array: Float32Array; itemSize: number; weight?: number }[]; locked?: Uint8Array | null; lockBorder?: boolean; borderWeight?: number }
export interface SimplifiedLevel { positions: Float32Array; attributes: Float32Array[]; index: Uint32Array | Uint16Array; triangles: number; vertices: number;
  /** largest distance (input units) a collapse moved the surface so far */ error: number }
export interface Simplifier { readonly triangles: number;
  /** collapse edges until `triangles` remain, the next collapse would exceed `error`, or `budgetMs` ran out; true when done */
  run(options?: { triangles?: number; error?: number; budgetMs?: number }): boolean; extract(): SimplifiedLevel }
export function createSimplifier(mesh: SimplifyMesh): Simplifier;
export function simplify(mesh: SimplifyMesh, options?: { triangles?: number; ratio?: number; error?: number }): SimplifiedLevel;
export interface LodChain { levels: SimplifiedLevel[]; source: number; step(budgetMs?: number): boolean }
export function createChain(mesh: SimplifyMesh, options?: { ratios?: readonly number[]; error?: number; minGain?: number }): LodChain;
