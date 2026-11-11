// The surface library's GLSL (surface-glsl.js): the shared helpers and one recipe per kind, as strings.
/** The shared periodic noise, grids and helpers (guarded MS_COMMON). */
export const MS_COMMON: string;
/** One `MsS ms_<kind>(vec2 u)` recipe per bakeable kind. */
export const KIND_GLSL: Record<string, string>;
/** The per-pixel-only kinds (emissive, liquids), each writing msEmit. */
export const LIVE_GLSL: Record<string, string>;
