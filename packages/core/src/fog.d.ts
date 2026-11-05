export const FOG: { params: Float32Array; light: Float32Array; glow: Float32Array };
/** Installs page-global shader chunks once. World disposal does not undo this patch. */
export function installFog(): void;
