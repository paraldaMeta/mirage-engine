import type { Signal, MaybeReactive } from './ui-reactive.js';
import type { UIKit, Component, Description, Props } from './ui-kit.js';
import type { Input, Action, Bindings } from './input.js';
type Text = MaybeReactive<string>;
type Rest = Record<string, any>;
/** action: a game action or 'confirm' | 'cancel' | 'tabPrev' | 'tabNext'. */
export const Glyph: Component<{ action: string; class?: string }>;
export const Prompt: Component<{ action: string; label: Description }>;
export const Button: Component<{ label?: Text; onPress?: (event: Event) => void; variant?: 'primary' | 'ghost' | 'wide'; glyph?: string; icon?: Description; disabled?: MaybeReactive<boolean> } & Rest>;
export const Toggle: Component<{ value: Signal<boolean>; label: Text; onChange?: (value: boolean) => void } & Rest>;
export const Slider: Component<{ value: Signal<number>; min?: number; max?: number; step?: number; label: Text; format?: (value: number) => string; onChange?: (value: number) => void } & Rest>;
export const Select: Component<{ value: Signal<any>; options: MaybeReactive<{ value: any; label: Text }[]>; label: Text; onChange?: (value: any) => void } & Rest>;
export const Tabs: Component<{ tabs: { id: string; label: Text; content: () => Description }[]; value: Signal<string>; label?: Text } & Rest>;
export const TextInput: Component<{ value: Signal<string>; label: Text; placeholder?: Text; maxLength?: number; onSubmit?: (value: string) => void; type?: string } & Rest>;
export const Progress: Component<{ value: MaybeReactive<number>; label?: Text; tone?: string } & Rest>;
export const Bar: Component<{ value: MaybeReactive<number>; max?: MaybeReactive<number>; label?: Text; tone?: 'health' | 'stamina' | 'mana' | string; icon?: Description; ghost?: boolean; showValue?: boolean; low?: number } & Rest>;
export const Tooltip: Component<{ text: Text; placement?: 'top' | 'bottom' }>;

export interface ModalHandle<R = unknown> { close(result?: R): void; el: HTMLElement; closed: Promise<R | undefined> }
export interface ModalStack {
  readonly depth: Signal<number>;
  open<R = unknown>(render: (close: (result?: R) => void) => Description, options?: { label?: Text; onClose?: (result?: R) => void; dismissable?: boolean; class?: string }): ModalHandle<R>;
  closeAll(): void; dispose(): void;
}
/** The kit's modal stack: the top one traps focus, B / Escape / a click on the scrim close it. */
export function modals(kit: UIKit): ModalStack;
export function confirm(kit: UIKit, options?: { title?: Text; text?: Text; yes?: Text; no?: Text }): Promise<boolean>;

export function virtualRange(scrollTop: number, rowPx: number, viewPx: number, count: number, overscan?: number): { first: number; last: number };
export const VirtualList: Component<{ items: MaybeReactive<readonly any[]>; render: (item: Signal<any>, index: Signal<number>) => Description; rowHeight?: number; height?: number; overscan?: number;
  active?: Signal<number>; onActivate?: (item: any, index: number) => void; label?: Text } & Rest>;

/** A count makes an item stackable. */
export interface InventorySlot { id: string; name?: Text; icon?: Description; count?: number; [key: string]: unknown }
export function moveItem<T extends InventorySlot>(slots: readonly (T | null)[], from: number, to: number, options?: { maxStack?: number }): (T | null)[];
export const InventoryGrid: Component<{ slots: Signal<(InventorySlot | null)[]>; cols?: number; label?: Text; onMove?: (from: number, to: number, slots: (InventorySlot | null)[]) => void;
  onUse?: (item: InventorySlot, index: number) => void; name?: (item: InventorySlot) => string; maxStack?: number } & Rest>;

export function revealCount(elapsed: number, perSecond: number, total: number): number;
export interface DialogueBox {
  /** Resolves with the chosen index, or -1 when there were no choices (or the box was closed). */
  say(line: { speaker?: string; text: string; choices?: string[]; speed?: number }): Promise<number>;
  advance(): void; choose(index: number): void; close(): void; dispose(): void;
}
export function dialogue(kit: UIKit): DialogueBox;

/** 0 is up, then clockwise; -1 inside the dead zone. */
export function radialIndex(dx: number, dy: number, n: number, deadzone?: number): number;
export function openRadial<T extends { label: Text; icon?: Description }>(kit: UIKit, options: { items: T[]; onPick?: (item: T, index: number) => void; label?: Text; radius?: number }): ModalHandle;

export const MinimapFrame: Component<{ size?: number; round?: boolean; heading?: MaybeReactive<number>; markers?: MaybeReactive<{ id: string; x: number; y: number; kind?: 'poi' | 'goal' | 'enemy' }[]>; label?: Text } & Rest>;
export const ObjectiveTracker: Component<{ objectives: MaybeReactive<{ id: string; text: string; done?: boolean; progress?: string }[]>; title?: Text } & Rest>;
export interface Toasts {
  push(toast: { text: Text; tone?: 'info' | 'good' | 'warn' | 'bad'; icon?: Description; duration?: number }): number;
  dismiss(id: number): void; dispose(): void;
}
export function toasts(kit: UIKit): Toasts;
export const RebindList: Component<{ input: Input; actions?: Action[]; onChange?: (bindings: Bindings) => void } & Rest>;
export type { Props };
