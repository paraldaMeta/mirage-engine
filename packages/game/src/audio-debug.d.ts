import type { AudioEngine } from './audio-engine.js';

/** The stat block as one string: voices, virtual voices, stolen / dropped, rays, assets, zone weights. */
export function audioStatsText(engine: AudioEngine): string;
export interface AudioDebug {
  /** null without a document (Node) */ readonly el: HTMLElement | null;
  text(): string;
  /** show or hide; without an argument, flip. Returns the new state. */
  toggle(on?: boolean): boolean;
  update(dt?: number): void;
  dispose(): void;
}
/** An overlay with the stat block and a meter per bus, refreshed `rate` times a second from engine.update. */
export function createAudioDebug(engine: AudioEngine, options?: { parent?: HTMLElement | null; rate?: number; visible?: boolean }): AudioDebug;
