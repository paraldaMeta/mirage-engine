import type { DestructMaterial, DestructData } from '@miragekit/game/destruct';
import type { AudioMixer } from '@miragekit/game/audio';

/** The library's classes. */
export type LibraryMaterialClass = 'glass' | 'paper' | 'wood' | 'cardboard' | 'plastic' | 'thinMetal' | 'heavyMetal' | 'ceramic' | 'liquid' | 'electronics' | 'fabric' | 'actor';
export const DESTRUCT_MATERIALS: Record<LibraryMaterialClass, DestructMaterial>;
/** The particle effects (vfx JSON) the classes and behaviours use. */
export const DESTRUCT_EFFECTS: Record<string, object>;
/** The break sound sets (dx_break_<name>). */
export const DESTRUCT_SOUNDS: string[];
/** Every destructibles sound as audio.add() factories. */
export function destructSoundFactories(): Record<string, (ctx: BaseAudioContext) => AudioBuffer | AudioBuffer[]>;
/** Add them to a createAudio() mixer (made at unlock); returns the names. */
export function addDestructSounds(audio: Pick<AudioMixer, 'add'>): string[];
/** Register the classes, effects and sounds (done on import); returns the table in use. */
export function registerDestruct(register?: (data: { materials: Record<string, DestructMaterial>; effects: Record<string, object>; fallback: string; addSounds: (audio: Pick<AudioMixer, 'add'>) => unknown }) => DestructData): DestructData;
