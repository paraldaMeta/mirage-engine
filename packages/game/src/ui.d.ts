import type { Game, InteractableEntity } from './game.js';
import type { Input } from './input.js';
import type { AudioMixer } from './audio.js';
export interface GameMessages {
  prompt(entity: InteractableEntity | null): void;
  objective(heading: string, text: string): void;
  toast(text: string, milliseconds?: number): void;
  message(heading: string, text: string, button?: string): void;
}
export interface GameUI extends GameMessages {
  dispose(): void;
  root: HTMLDivElement;
  openMenu(panel?: 'main' | 'save' | 'load' | 'controls' | 'sound'): void;
  openInventory(): void; update(): void;
  begin(event?: { code?: string; type?: string }): void; setTouch(on: boolean): void;
  readonly started: boolean; readonly touch: boolean; readonly open: HTMLDialogElement | undefined;
}
export interface UISaveHandler { (slot: number): unknown; (slot: 'export'): string }
export interface UIOptions {
  game: Game; input: Input; audio: AudioMixer; title?: string; subtitle?: string; slots?: number;
  onSave: UISaveHandler; onLoad: (slotOrJSON: number | string) => unknown; onRestart?: () => void; canvas?: HTMLCanvasElement;
}
/** Installs an overlay and its listeners until dispose(). */
export function createUI(options: UIOptions): GameUI;
