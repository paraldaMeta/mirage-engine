import type { Game, InteractableEntity } from './game.js';
import type { Input } from './input.js';
import type { AudioMixer } from './audio.js';
export interface GameMessages {
  prompt(entity: InteractableEntity | null): void;
  objective(heading: string, text: string): void;
  toast(text: string, milliseconds?: number): void;
  /** Shows a dialog that pauses the game; the promise resolves when it closes (also when replaced or disposed). */
  message(heading: string, text: string, button?: string): Promise<void>;
}
/** createUI's text table (UI_STRINGS holds the English). `{name}` marks a parameter. */
export interface UIStrings {
  start: string; startKey: string; startHint: string;
  carrying: string; bag: string; use: string; jump: string; menu: string; close: string; continue: string; nothing: string;
  paused: string; resume: string; save: string; load: string; controls: string; sound: string; restart: string; back: string;
  slot: string; slotEmpty: string; slotBroken: string; saveHere: string; loadSlot: string;
  file: string; exportFile: string; importFile: string;
  saved: string; savedToast: string; saveFailed: string; loadedToast: string; loadedFile: string; notASave: string;
  pressKey: string; rebind: string; defaults: string; padHelp: string;
  'action.forward': string; 'action.back': string; 'action.left': string; 'action.right': string; 'action.run': string; 'action.jump': string;
  'action.interact': string; 'action.inventory': string; 'action.menu': string;
  'bus.master': string; 'bus.music': string; 'bus.sfx': string; 'bus.ambience': string;
}
/** createUI's strings in English: the keys a game's table may set. */
export const UI_STRINGS: Readonly<UIStrings>;
export interface GameUI extends GameMessages {
  dispose(): void;
  root: HTMLDivElement;
  openMenu(panel?: 'main' | 'save' | 'load' | 'controls' | 'sound'): void;
  openInventory(): void; update(): void;
  begin(event?: { code?: string; type?: string }): void; setTouch(on: boolean): void;
  /** createUI: another text table (merged over UI_STRINGS, in place of the last one); the labels and an open menu follow. */
  setStrings?(strings: Partial<UIStrings>): void;
  /** createUI: the table in use (a copy). */
  readonly strings?: Readonly<UIStrings>;
  readonly started: boolean; readonly touch: boolean; readonly open: HTMLDialogElement | undefined;
}
export interface UISaveHandler { (slot: number): unknown; (slot: 'export'): string }
export interface UIOptions {
  game: Game; input: Input; audio: AudioMixer; title?: string; subtitle?: string; slots?: number;
  onSave: UISaveHandler; onLoad: (slotOrJSON: number | string) => unknown; onRestart?: () => void; canvas?: HTMLCanvasElement;
  /** The overlay's text, whole or in part (keys left out keep UI_STRINGS' English). */
  strings?: Partial<UIStrings>;
}
/** Installs an overlay and its listeners until dispose(). */
export function createUI(options: UIOptions): GameUI;
