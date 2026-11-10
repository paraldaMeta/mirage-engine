/** A value that effects and computeds subscribe to by reading `.value`. */
export interface ReadSignal<T> { readonly value: T; peek(): T; subscribe(fn: (value: T) => void): () => void; readonly isSignal: true }
export interface Signal<T> extends ReadSignal<T> { value: T }
/** A plain value, a signal or a function: what a widget prop that may change accepts. */
export type MaybeReactive<T> = T | ReadSignal<T> | (() => T);
export const reactiveStats: { effects: number; computes: number };
export function signal<T>(initial: T, equals?: (a: T, b: T) => boolean): Signal<T>;
/** Lazy and cached: re-evaluated when read after a dependency changed. */
export function computed<T>(fn: () => T): ReadSignal<T>;
/** A computed that wakes its readers only when its result changes. */
export function memo<T>(fn: () => T, equals?: (a: T, b: T) => boolean): ReadSignal<T>;
/** Runs now and after any signal it read changes. Returns stop(). */
export function effect(fn: () => void | (() => void)): () => void;
/** Effects that depend on the writes inside run once, after the outermost batch. */
export function batch<T>(fn: () => T): T;
export function untracked<T>(fn: () => T): T;
/** Every effect created inside is stopped by the returned dispose. */
export function scope<T>(fn: () => T): [T, () => void];
export function onCleanup(fn: () => void): () => void;
export function read<T>(value: MaybeReactive<T>): T;
export function isReactive(value: unknown): boolean;
/** An object whose own keys are signals: reads subscribe per key. */
export function store<T extends object>(initial: T): T;
