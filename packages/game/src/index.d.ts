// Mirage original code.
export { startGame } from './start.js';
export { createPhysics, loadRapier } from './physics.js';
export { createGame } from './game.js';
export { createInput, DEFAULT_BINDINGS, ACTIONS, PAD } from './input.js';
export { createAudio, SURFACES } from './audio.js';
export { createUI } from './ui.js';
export { createAudioEngine, zonesFromPlan, zoneWeights } from './audio-engine.js';
export { createMixer, EFFECT_TYPES } from './audio-mixer.js';
export { createMusic } from './audio-music.js';
export { gridOccluder, physicsOccluder, sceneOccluder } from './audio-occlusion.js';
export { createAudioDebug, audioStatsText } from './audio-debug.js';
export { REVERBS, impulseResponse, encodeWav, decodeWav, distanceGain, coneGain, dopplerRatio, occlusionResponse, dbToGain, gainToDb, rms, peak, toneLevel, onset } from './audio-dsp.js';

export type { GameSession, GameSetup, StartGameOptions, PlayerSnapshot } from './start.js';
export type { Physics, PhysicsBody, PhysicsCharacter, DynamicProp, PropState, Hinge, RayHit } from './physics.js';
export type { Game, GameOptions, Entity, InteractableEntity, Interaction, InventoryItem, Zone, ActiveZone, ZoneShape,
  Snapshot, ExtendedSnapshot, LoadedSave, SaveSlot, SlotInfo, Migrations, GameEvents, EventData, System } from './game.js';
export type { Action, Bindings, Input } from './input.js';
export type { AudioMixer, AudioLoop, AudioOptions, AudioBus, Sound, LoopSound, SingleBufferSound, Surface } from './audio.js';
export type { GameUI, GameMessages, UIOptions, UISaveHandler } from './ui.js';
export type { AudioEngine, AudioEngineOptions, AudioEngineStats, Voice, PlayOptions, CueSpec, Stream, ZoneSpec, ZoneOptions, OcclusionOptions, PanningModel, Ears } from './audio-engine.js';
export type { Mixer, Bus, BusSpec, Effect, EffectSpec, EffectType, Meter, Duck } from './audio-mixer.js';
export type { Music, MusicOptions, MusicSection, TransitionOptions, Quantize } from './audio-music.js';
export type { Occluder } from './audio-occlusion.js';
export type { AudioDebug } from './audio-debug.js';
export type { DistanceModel, DistanceOptions, RolloffCurve, ReverbParams, ReverbPreset, ReverbSpec } from './audio-dsp.js';
