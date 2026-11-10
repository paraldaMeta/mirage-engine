// Mirage original code. The parts of mirage-snap's command line with rules worth a Node check (snap.mjs runs on import).

/** --adaptive: absent -> null (off); followed by a number (0 included) -> that many levels; else (the next argument
 *  is a flag or the target) -> true (the default tolerance) */
export function adaptiveOption(argv) {
  const i = argv.indexOf('--adaptive');
  if (i < 0) return null;
  const v = argv[i + 1];
  return v !== undefined && /^\d*\.?\d+$/.test(v) ? +v : true;
}

/** The redraw order of n views shot 0..n-1: n-2, n-3, ..., 0, n-1 (each follows a view other than itself). */
export const redrawOrder = (n) => (n < 2 ? [0].slice(0, n) : [...Array.from({ length: n - 1 }, (_, k) => n - 2 - k), n - 1]);

