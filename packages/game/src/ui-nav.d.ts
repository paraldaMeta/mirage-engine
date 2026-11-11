import type { Signal } from './ui-reactive.js';
import type { Input, Bindings } from './input.js';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Device = 'keyboard' | 'mouse' | 'gamepad' | 'touch';
export type PadKind = 'xbox' | 'playstation' | 'switch';
export interface FocusRect { x: number; y: number; w: number; h: number }
export const DIRS: Direction[];
/** The index of the rectangle to move to from rects[from] (-1: none; from = -1: the top-left-most). */
export function nextFocus(rects: readonly (FocusRect | null)[], from: number, dir: Direction, options?: { wrap?: boolean }): number;
export function buildFocusGraph(rects: readonly (FocusRect | null)[], options?: { wrap?: boolean }): (Record<Direction, number> | null)[];
export const PAD_GLYPHS: Record<PadKind, string[]>;
export function padKind(id?: string): PadKind;
export interface GlyphInfo { text: string; kind: 'key' | 'pad' | 'touch'; button?: number; code?: string }
/** action: a game action, or a UI verb: 'confirm' | 'cancel' | 'tabPrev' | 'tabNext' | 'navUp' | 'navDown' | 'navLeft' | 'navRight'. */
export function glyphFor(action: string, options?: { device?: Device; bindings?: Bindings; padKind?: PadKind; touchLabels?: Record<string, string> }): GlyphInfo;
export interface FocusNavOptions {
  root: HTMLElement; input?: Input | null; getGamepads?: () => (Gamepad | null)[];
  /** 'scoped' (default): the pad drives the UI only while a scope (a modal) is open */
  gamepad?: 'scoped' | 'always' | false; repeat?: [number, number]; wrap?: boolean;
}
export interface FocusNav {
  device: Signal<Device>; padKind: Signal<PadKind>;
  /** true while a widget captures the next key (rebinding) */
  suspended: boolean;
  readonly scope: { el: HTMLElement } | null; readonly depth: number;
  focusables(el?: HTMLElement): HTMLElement[]; focusFirst(el?: HTMLElement): boolean;
  /** The focused element hears a cancelable 'mk-nav' ({ dir }) first. */
  move(dir: Direction): boolean; activate(): boolean; back(): boolean; tab(step: -1 | 1): boolean;
  /** Focus stays inside el until the returned function is called; it then returns to where it was. */
  pushScope(el: HTMLElement, options?: { onBack?: (() => void) | null; trap?: boolean; autofocus?: boolean }): () => void;
  update(now?: number): void; dispose(): void;
}
export function createFocusNav(options: FocusNavOptions): FocusNav;
