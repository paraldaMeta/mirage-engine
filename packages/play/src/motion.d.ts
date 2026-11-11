import type { ReducedMotionSettings } from '@miragekit/core/world';

export declare const REDUCED_MOTION_QUERY: '(prefers-reduced-motion: reduce)';
/** 'auto' (default: media.matches), true, false or settings -> the value for world.setReducedMotion. */
export function resolveReducedMotion(option?: 'auto' | boolean | Partial<ReducedMotionSettings> | null, media?: { matches: boolean } | null): boolean | Partial<ReducedMotionSettings>;
/** apply(value) now and, for 'auto', on every change of the system setting; returns stop(). */
export function followReducedMotion(option: 'auto' | boolean | Partial<ReducedMotionSettings> | null | undefined, win: { matchMedia(query: string): MediaQueryList } | null, apply: (value: boolean | Partial<ReducedMotionSettings>) => void): () => void;
