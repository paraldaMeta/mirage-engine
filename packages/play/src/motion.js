// Mirage original code. prefers-reduced-motion for play: which reduced-motion setting a world gets, following the
// user's system setting unless the page overrides it.

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const isAuto = (option) => option === undefined || option === null || option === 'auto';

/** option 'auto' (the default: the media query), true, false, or { sway, rain } (on, with these scales) -> the value
 *  for world.setReducedMotion: false (off), true or the settings object. media: a MediaQueryList (or { matches }). */
export function resolveReducedMotion(option = 'auto', media = null) {
  if (isAuto(option)) return !!(media && media.matches);
  if (option === true || option === false) return option;
  if (typeof option === 'object') return option;
  throw new RangeError("reducedMotion must be 'auto', true, false or { sway, rain }");
}

/** Calls apply(value) now and, for 'auto', whenever the system setting changes. win: anything with matchMedia
 *  (window), or null (no media query: 'auto' is off). Returns stop(). */
export function followReducedMotion(option, win, apply) {
  const media = !win || typeof win.matchMedia !== 'function' ? null : win.matchMedia(REDUCED_MOTION_QUERY);
  apply(resolveReducedMotion(option, media));
  if (!media || !isAuto(option)) return () => {};
  const on = () => apply(resolveReducedMotion(option, media));
  if (media.addEventListener) media.addEventListener('change', on); else if (media.addListener) media.addListener(on);
  return () => { if (media.removeEventListener) media.removeEventListener('change', on); else if (media.removeListener) media.removeListener(on); };
}
