// Mirage original code. Effect recipes of @miragekit/assets: effects.js has them (core's effect format, played by
// core's createVfx). VFX_RECIPES: name -> { cat, desc, loop, effect }; vfxNames(cat) lists a category.
import { VFX_RECIPES, VFX_CATEGORIES } from './effects.js';
export { VFX_RECIPES, VFX_CATEGORIES };
/** the recipe names in a category (or all) */
export function vfxNames(cat) {
  if (cat != null && !VFX_CATEGORIES.includes(cat)) throw new RangeError(`vfxNames: no category "${cat}" (${VFX_CATEGORIES.join(', ')})`);
  return Object.keys(VFX_RECIPES).filter((k) => cat == null || VFX_RECIPES[k].cat === cat);
}
