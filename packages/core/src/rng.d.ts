/** Seeded helpers. Declaration candidate; runtime behaviour is in rng.js. */
export interface RandomStream {
  seed: number;
  next(): number;
  float(a?: number, b?: number): number;
  range(a: number, b: number): number;
  /** Inclusive bounds. */
  int(a: number, b: number): number;
  /** An empty list returns undefined. */
  pick<T>(list: readonly T[]): T | undefined;
  chance(probability: number): boolean;
  sign(): -1 | 1;
  gauss(mean?: number, deviation?: number): number;
  inDisc(): [number, number];
  onSphere(): [number, number, number];
  fork(name: string): RandomStream;
}
export function hash32(input: unknown): number;
export function sfc32(seed: number): () => number;
export function rng(seed?: string | number): RandomStream;
export function valueNoise2(x: number, y: number, seed?: number): number;
export function fbm2(x: number, y: number, octaves?: number, seed?: number): number;
