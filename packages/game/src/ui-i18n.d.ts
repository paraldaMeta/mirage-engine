import type { ReadSignal, Signal } from './ui-reactive.js';
/** key -> ICU-style message: {name}, {n, plural, one {# item} other {# items}}, {n, selectordinal, ...},
 *  {g, select, ...}, {n, number, percent | integer | compact | <currency>}, {d, date | time, short | medium | long}. */
export type StringTable = Record<string, string>;
export type MessageParams = Record<string, unknown>;
export interface I18n {
  /** the current BCP 47 tag; change it with setLocale() */
  locale: Signal<string>; lang: ReadSignal<string>; dir: ReadSignal<'ltr' | 'rtl'>; font: ReadSignal<string>;
  /** 'locale:key' for every string asked for and not found in that language */
  missing: Set<string>;
  setLocale(locale: string): void;
  /** under: keep the strings already there (defaults beneath a game's own) */
  add(locale: string, table: StringTable, under?: boolean): void;
  locales(): string[]; has(key: string, locale?: string): boolean;
  /** Reactive: inside an effect or a bound text it follows the language. Unknown keys return the key. */
  t(key: string, params?: MessageParams): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  date(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string;
  list(items: string[], options?: Intl.ListFormatOptions): string;
  relative(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
  plural(n: number, type?: 'cardinal' | 'ordinal'): Intl.LDMLPluralRule;
}
export function createI18n(options?: { locale?: string; fallback?: string; tables?: Record<string, StringTable>;
  /** wrap interpolated strings of the other direction in isolates (default true) */
  isolate?: boolean; onMissing?: (key: string, locale: string) => void }): I18n;
export function textDirection(locale: string): 'ltr' | 'rtl';
/** A CSS font-family list with the locale's script faces. */
export function fontStack(locale: string): string;
/** User-perceived characters. */
export function graphemes(text: string, locale?: string): string[];
/** The pieces a line may break between (words; characters with kinsoku rules for CJK). */
export function breakPieces(text: string, locale?: string): string[];
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number, locale?: string): string[];
