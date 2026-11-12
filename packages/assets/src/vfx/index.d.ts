export type VfxCategory = 'combat' | 'weather' | 'fire' | 'water' | 'magic' | 'celebration' | 'ambience';
/** A recipe: an effect description in core's format (defineEffect / createVfx take it as it is). */
export interface VfxRecipe { cat: VfxCategory; desc: string; loop: boolean; effect: { name: string; [k: string]: unknown } }
export const VFX_RECIPES: Readonly<Record<string, VfxRecipe>>;
export const VFX_CATEGORIES: readonly VfxCategory[];
/** The recipe names in a category, or all. Throws on an unknown category. */
export function vfxNames(cat?: VfxCategory): string[];
