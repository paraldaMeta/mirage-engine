import type { GameUI, UIOptions } from './ui.js';
import type { UIKit, UIKitOptions, Component, ThemeName } from './ui-kit.js';
import type { I18n } from './ui-i18n.js';
import type { Input, Action } from './input.js';
export interface KitUIOptions extends UIOptions {
  /** an existing kit (not disposed with the overlay) */
  kit?: UIKit; i18n?: I18n; locale?: string; theme?: ThemeName | string; kitOptions?: UIKitOptions;
}
/** createUI's overlay rebuilt on the toolkit: pass it as startGame's `ui`. */
export function createKitUI(options: KitUIOptions): GameUI & { kit: UIKit };
export const TouchControls: Component<{ input: Input; actions?: Action[]; menu?: boolean; look?: boolean }>;
