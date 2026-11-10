// Mirage original code.
export { startGame } from './start.js';
export { createPhysics, loadRapier } from './physics.js';
export { createGame } from './game.js';
export { createInput, DEFAULT_BINDINGS, ACTIONS, PAD } from './input.js';
export { createAudio, SURFACES } from './audio.js';
export { createUI } from './ui.js';
export { createUIKit } from './ui-kit.js';
export { createI18n } from './ui-i18n.js';
export { createFocusNav } from './ui-nav.js';
export { createWorldUI } from './ui-world.js';
export { createCanvasUI } from './ui-canvas.js';
export { createKitUI } from './ui-menu.js';

export type { GameSession, GameSetup, StartGameOptions, PlayerSnapshot } from './start.js';
export type { Physics, PhysicsBody, PhysicsCharacter, DynamicProp, PropState, Hinge, RayHit } from './physics.js';
export type { Game, GameOptions, Entity, InteractableEntity, Interaction, InventoryItem, Zone, ActiveZone, ZoneShape,
  Snapshot, ExtendedSnapshot, LoadedSave, SaveSlot, SlotInfo, Migrations, GameEvents, EventData, System } from './game.js';
export type { Action, Bindings, Input } from './input.js';
export type { AudioMixer, AudioLoop, AudioOptions, AudioBus, Sound, LoopSound, SingleBufferSound, Surface } from './audio.js';
export type { GameUI, GameMessages, UIOptions, UISaveHandler } from './ui.js';
export type { UIKit, UIKitOptions, Description, Component, ThemeTokens } from './ui-kit.js';
export type { I18n, StringTable } from './ui-i18n.js';
export type { FocusNav, FocusNavOptions } from './ui-nav.js';
export type { WorldUI, WorldItem } from './ui-world.js';
export type { CanvasUI, CanvasNode } from './ui-canvas.js';
export type { KitUIOptions } from './ui-menu.js';
