export type Action = 'forward' | 'back' | 'left' | 'right' | 'run' | 'jump' | 'interact' | 'inventory' | 'menu';
export type Bindings = Partial<Record<Action, string[]>>;
export const ACTIONS: Action[];
export const DEFAULT_BINDINGS: Record<Action, string[]>;
export const PAD: Record<'jump' | 'interact' | 'inventory' | 'menu' | 'run', number[]>;
export const PAD_NAMES: { 0: 'A'; 1: 'B'; 2: 'X'; 3: 'Y'; 4: 'LB'; 9: 'Start'; 10: 'L3' };
export interface Input {
  dispose(): void;
  bindings: Bindings; source: 'keyboard' | 'gamepad' | 'touch'; pad: Gamepad | null; enabled: boolean;
  spend(code?: string): void; discardActions(): void;
  down(action: Action): boolean; pressed(action: Action): boolean; padPressed(index: number): boolean;
  move(): { x: number; z: number }; look(dt: number): [number, number]; poll(): void;
  /** The pad's sticks after the dead zone, the rest check (a stick counts once seen at rest) and the drift guard;
   *  the right stick is read on standard-mapping pads only. */
  readonly sticks: { left: readonly [number, number]; right: readonly [number, number] };
  /** What the last look() came from: 'touch', 'gamepad' or '' (nothing). */
  lookSource?: string;
  rebind(action: Action, code: string, slot?: number): void;
  /** Restores default bindings; does not clear held keys. */
  reset(): void;
  capture(signal?: AbortSignal): Promise<string | null>;
  stick(x: number, z: number): void; hold(action: Action, on: boolean): void; tap(action: Action): void;
  addLook(dx: number, dy: number): void; glyph(action: Action): string;
  /** Clears current input; registered DOM listeners remain attached. */
  clear(): void;
}
export function createInput(options?: { target?: Partial<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>>; bindings?: Bindings; deadzone?: number }): Input;
export function keyName(code: string): string;
