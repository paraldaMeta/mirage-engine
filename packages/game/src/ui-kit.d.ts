import type { Signal, ReadSignal, MaybeReactive } from './ui-reactive.js';
import type { I18n, MessageParams } from './ui-i18n.js';
import type { FocusNav, FocusNavOptions, Device, GlyphInfo } from './ui-nav.js';
import type { Input } from './input.js';
export { signal, computed, memo, effect, batch, untracked, scope, onCleanup, read, store } from './ui-reactive.js';
export { createI18n } from './ui-i18n.js';
export type { Signal, ReadSignal, MaybeReactive } from './ui-reactive.js';

export interface Context { doc: Document; kit: UIKit | null }
/** (props, ctx) -> a description. */
export type Component<P = any> = (props: P, ctx: Context) => Description;
/** What can be mounted: text, a node, h() / each() / show() results, arrays of those, or a function returning any
 *  of them (a region re-rendered when the signals it reads change). */
export type Description = string | number | boolean | null | undefined | Node | ElementDescription | EachDescription | ShowDescription | Description[] | (() => Description) | ReadSignal<unknown>;
export interface ElementDescription { tag: string | Component; props: Props; children: Description[] }
export interface EachDescription { each: true }
export interface ShowDescription { show: true }
/** Attributes and properties (values may be signals or functions: each is bound on its own), plus class (string,
 *  array or { name: reactive boolean }), style (string or { property: reactive value }), onEvent listeners, and
 *  ref(element). */
export type Props = Record<string, any> | null;
export function h<P>(tag: string | Component<P>, props?: P | Props, ...children: Description[]): ElementDescription;
/** Keyed rows: created once per key, moved when the order changes. render gets signals. */
export function each<T>(list: MaybeReactive<readonly T[]>, key: (item: T, index: number) => unknown, render: (item: ReadSignal<T>, index: ReadSignal<number>) => Description): EachDescription;
export function each<T>(list: MaybeReactive<readonly T[]>, render: (item: ReadSignal<T>, index: ReadSignal<number>) => Description): EachDescription;
export function show(when: MaybeReactive<unknown>, render: () => Description, options?: { transition?: 'fade' | 'pop' | 'rise' | 'slide'; fallback?: () => Description }): ShowDescription;
/** DOM writes made by bindings and nodes created, since the page started. */
export const kitStats: { writes: number; created: number };
export function mount(description: Description, parent: Element, ctx?: Partial<Context>): () => void;

export type Anchor = 'top-start' | 'top' | 'top-end' | 'start' | 'center' | 'end' | 'bottom-start' | 'bottom' | 'bottom-end';
type Em = number | string;
export function stack(props?: Props & { dir?: 'col' | 'row'; gap?: Em; align?: string; justify?: string; wrap?: boolean; grow?: number; pad?: Em; tag?: string }, ...children: Description[]): ElementDescription;
export function row(props?: Props, ...children: Description[]): ElementDescription;
export function grid(props?: Props & { cols?: number | string; rows?: number | string; gap?: Em; min?: Em }, ...children: Description[]): ElementDescription;
/** start / end follow the text direction; offset in em. */
export function anchor(props?: Props & { at?: Anchor; offset?: [Em, Em] }, ...children: Description[]): ElementDescription;
export function safeArea(props?: Props & { pad?: Em }, ...children: Description[]): ElementDescription;
export function spacer(size?: Em): ElementDescription;
export interface ScaleOptions { reference?: [number, number]; mode?: 'fit' | 'width' | 'height' | 'fill'; min?: number; max?: number }
export function computeScale(width: number, height: number, options?: ScaleOptions): number;

export interface ThemeTokens {
  scheme: 'dark' | 'light'; bg: string; surface: string; surface2: string; text: string; muted: string; accent: string; onAccent: string;
  border: string; focus: string; good: string; warn: string; bad: string; info: string; health: string; stamina: string; mana: string; track: string; scrim: string;
  radius: string; radiusSm: string; pad: string; gap: string; touch: string; fast: string; slow: string; shadow: string; font: string; mono: string;
  [token: string]: string;
}
export type ThemeName = 'dark' | 'light' | 'contrast' | 'colorblind';
export const THEMES: Record<ThemeName, ThemeTokens>;
export function themeCSS(tokens: Partial<ThemeTokens>): string;
type Color = string | readonly number[];
/** '#rgb' | '#rgba' | '#rrggbb' | '#rrggbbaa' -> [r, g, b, alpha 0..1] */
export function parseColor(color: string): [number, number, number, number];
export function luminance(color: Color): number;
/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: Color, b: Color): number;
/** A translucent colour over an opaque one. */
export function over(top: string, under: string): [number, number, number];
export function simulateCVD(color: Color, type: 'protanopia' | 'deuteranopia' | 'tritanopia'): [number, number, number];
/** CIELAB delta E (1976). */
export function colorDistance(a: Color, b: Color): number;
export function addStyles(doc: Document, id: string, css: string): void;

export interface UIKitOptions {
  parent?: HTMLElement; theme?: ThemeName | string | Partial<ThemeTokens>; themes?: Record<string, ThemeTokens>;
  i18n?: I18n | null; input?: Input | null; scale?: ScaleOptions | false; textScale?: number;
  /** 'auto' follows prefers-reduced-motion */
  motion?: 'auto' | 'full' | 'reduced'; nav?: Partial<FocusNavOptions>; id?: string;
}
export type LayerName = 'world' | 'hud' | 'modal' | 'toast';
export interface UIKit {
  root: HTMLDivElement; layers: Record<LayerName, HTMLDivElement>; doc: Document; nav: FocusNav; i18n: I18n; input: Input | null;
  t(key: string, params?: MessageParams): string;
  /** a bound text that follows the language */
  tx(key: string, params?: MessageParams | (() => MessageParams)): () => string;
  device: Signal<Device>;
  /** call after input.rebind() / reset(): glyphs on screen follow */
  rebound(): void;
  theme: Signal<string>; tokens: Signal<ThemeTokens>; textScale: Signal<number>; scale: Signal<number>; motion: Signal<'full' | 'reduced'>;
  motionSetting: 'auto' | 'full' | 'reduced'; themes: Record<string, ThemeTokens>;
  setTheme(theme: string | Partial<ThemeTokens>): void; setMotion(motion: 'auto' | 'full' | 'reduced'): void;
  /** Returns dispose(). */
  mount(description: Description, layer?: LayerName | Element): () => void;
  /** To a screen reader, without moving focus. */
  announce(text: string, options?: { assertive?: boolean }): void;
  glyph(action: string): GlyphInfo;
  onFrame(fn: (now: number, dt: number) => void): () => void;
  service<T>(name: string, make: (kit: UIKit) => T): T;
  /** once per frame */
  update(now?: number): void; autoUpdate(): () => void;
  addStyles(id: string, css: string): void; dispose(): void;
}
export function createUIKit(options?: UIKitOptions): UIKit;
