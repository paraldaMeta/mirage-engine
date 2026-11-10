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
export { createUIKit } from './ui-kit.js';
export { createI18n } from './ui-i18n.js';
export { createFocusNav } from './ui-nav.js';
export { createWorldUI } from './ui-world.js';
export { createCanvasUI } from './ui-canvas.js';
export { createKitUI } from './ui-menu.js';
