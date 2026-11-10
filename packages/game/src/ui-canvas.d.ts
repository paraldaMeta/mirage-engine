import type * as THREE from 'three';
import type { Signal, MaybeReactive } from './ui-reactive.js';
import type { UIKit, ThemeTokens } from './ui-kit.js';
import type { I18n } from './ui-i18n.js';
import type { Direction } from './ui-nav.js';
export interface CanvasNode { type: string; props: Record<string, any>; children: CanvasNode[] }
type Make<P> = (props?: P | null, ...children: (CanvasNode | CanvasNode[] | null | false | undefined)[]) => CanvasNode;
type Text = MaybeReactive<string>;
/** The canvas-rendered subset of the widgets. */
export const cv: {
  panel: Make<{ title?: Text; pad?: number; gap?: number }>; col: Make<{ gap?: number }>; row: Make<{ gap?: number }>;
  text: Make<{ text: Text; size?: number; color?: string; bold?: boolean; align?: 'left' | 'center' | 'right'; wrap?: boolean }>;
  button: Make<{ label: Text; onPress?: () => void; primary?: boolean }>;
  toggle: Make<{ value: Signal<boolean>; label: Text; onChange?: (value: boolean) => void }>;
  slider: Make<{ value: Signal<number>; min?: number; max?: number; step?: number; label?: Text; onChange?: (value: number) => void }>;
  bar: Make<{ value: MaybeReactive<number>; max?: MaybeReactive<number>; tone?: string; label?: Text }>;
  spacer: Make<{ size?: number }>;
};
export type CanvasCommand =
  | { op: 'rect'; x: number; y: number; w: number; h: number; r: number; fill?: string; stroke?: string; lineWidth?: number }
  | { op: 'text'; text: string; x: number; y: number; size: number; color: string; bold?: boolean; align: 'left' | 'center' | 'right' };
export interface CanvasBox { x: number; y: number; w: number; h: number; node: CanvasNode; track?: [number, number] }
export function layoutCanvas(description: CanvasNode, options?: { width?: number; height?: number; tokens?: Partial<ThemeTokens>; measure?: (text: string, size: number, bold?: boolean) => number;
  locale?: string; rtl?: boolean; size?: number; focus?: number; hover?: number; pressed?: number }): { commands: CanvasCommand[]; boxes: CanvasBox[] };
export interface CanvasUI {
  texture: THREE.Texture; canvas?: HTMLCanvasElement; image?: { width: number; height: number; data: Uint8ClampedArray };
  stats: { layouts: number; paints: number };
  /** the focused widget's index in boxes (-1: none) */
  focus: Signal<number>; readonly boxes: CanvasBox[]; readonly commands: CanvasCommand[];
  /** Repaints if something shown changed; true when it did. */
  update(): boolean;
  /** u, v in 0..1 from the top left; down: the trigger is held. Returns the index under the pointer. */
  pointer(u: number, v: number, down?: boolean): number;
  pointerUV(uv: { x: number; y: number } | null | undefined, down?: boolean): number;
  raycast(raycaster: THREE.Raycaster, down?: boolean): boolean;
  /** From an XR controller's ray space (any Object3D looking down its -z). */
  pointFrom(object: THREE.Object3D, down?: boolean): boolean;
  move(dir: Direction): boolean; activate(): void;
  /** A plane showing the panel, `width` metres wide. */
  mesh(options?: { width?: number; doubleSide?: boolean }): THREE.Mesh;
  dispose(): void;
}
export function createCanvasUI(options: { width?: number; height?: number; description: CanvasNode | (() => CanvasNode); kit?: UIKit | null; tokens?: Partial<ThemeTokens> | null;
  i18n?: I18n | null; size?: number; backend?: 'auto' | 'canvas' | 'glyphs'; font?: string | null }): CanvasUI;
