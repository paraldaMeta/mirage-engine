/** An RGBA byte image (straight alpha), row 0 at the top. */
export interface GlyphImage { width: number; height: number; data: Uint8Array }
/** The encoded built-in font: 95 glyphs (printable ASCII), 9 base-32 rows of 5 bits each. */
export const FONT_SOURCE: string;
/** Glyph cells: width, height, advance, cap height. */
export const GW: number; export const GH: number; export const ADVANCE: number; export const CAP: number;
/** The text as the font can draw it: printable ASCII, other characters folded or shown as '?'. */
export function glyphText(text: string): string;
/** The width in pixels of `text` at `cell` px per font pixel. */
export function textWidth(text: string, cell: number): number;
export function createImage(width: number, height: number): GlyphImage;
export function clearImage(img: GlyphImage): GlyphImage;
/** A rounded rectangle, filled; with `lineWidth` its outline (centred on the edge). rgba: 0-255, alpha 0-1. */
export function fillRoundRect(img: GlyphImage, x: number, y: number, w: number, h: number, r: number, rgba: readonly number[], lineWidth?: number): void;
/** `text` with its left edge at x and the middle of its capitals at yMid; `cell` px per font pixel. */
export function drawText(img: GlyphImage, text: string, x: number, yMid: number, cell: number, rgba: readonly number[], bold?: boolean): void;
/** Whether this page's Canvas 2D draws text (cached; false without a canvas). */
export function canvasTextWorks(): boolean;
/** Tests: forget the cached answer. */
export function resetCanvasTextCheck(): void;
