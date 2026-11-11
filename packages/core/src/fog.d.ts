export const FOG: { params: Float32Array; light: Float32Array; glow: Float32Array };
/** Installs page-global shader chunks once. They go back to three's own when the last world on the page is disposed. */
export function installFog(): void;
/** a world is created: three's own shader chunks are remembered before the first one patches them (createWorldRenderer calls it) */
export function retainChunks(): void;
/** a world is disposed: with the last one on the page three's chunks go back and the installers may run again (world.dispose calls it) */
export function releaseChunks(): void;
/** for an installer of chunk patches: called when the chunks went back, to forget that it ran */
export function onChunksRestored(fn: () => void): void;
