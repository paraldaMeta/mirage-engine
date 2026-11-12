// The NEON DISTRICT mark and wordmark, drawn as neon tubes (SVG paths only: no font). One source for the title screen,
// the loading card (index.html, written by scripts/logo.mjs) and the icons in public/ (also scripts/logo.mjs).
//   mark      an N whose last stem is the stem of a D: the N one cyan tube, the D's bowl a magenta one
//   wordmark  NEON / DISTRICT and KESTREL STREET in a chamfered monoline (each glyph a polyline on a 60 x 100 grid)

const CY = '#19d8ff', MG = '#ff3fd2', NIGHT = ['#101a46', '#060a1c'];
const CORE = { [CY]: '#dcfbff', [MG]: '#ffe2f6' };

// the mark, in a 512 box (centre 256, 256)
const N = 'M128 372V140L262 372V140';
const D = 'M262 140H330L392 202V310L330 372H262';

// the glyphs: [width, path] on a 60 x 100 grid (y down), chamfers of 15
const G = {
  N: [60, 'M0 100V0L60 100V0'],
  E: [56, 'M56 0H0V100H56M0 50H42'],
  O: [60, 'M15 0H45L60 15V85L45 100H15L0 85V15Z'],
  D: [60, 'M0 0H40L60 20V80L40 100H0Z'],
  I: [0, 'M0 0V100'],
  S: [60, 'M60 0H12L0 12V38L12 50H48L60 62V88L48 100H0'],
  T: [60, 'M0 0H60M30 0V100'],
  R: [60, 'M0 100V0H45L60 15V37L45 52H0M32 52L60 100'],
  C: [58, 'M58 0H15L0 15V85L15 100H58'],
  K: [58, 'M0 0V100M58 0L0 58M24 36L58 100'],
  L: [54, 'M0 0V100H54'],
};

/** a word as one path: x, y the top left, h the cap height, track the gap between letters (in glyph units) */
export function word(text, x, y, h, track = 30, space = 60) {
  const k = h / 100;
  let at = 0;
  const d = [];
  for (const ch of text) {
    if (ch === ' ') { at += space; continue; }
    const [w, p] = G[ch];
    // move the glyph: every absolute coordinate pair (and lone H / V values) scaled and offset
    d.push(p.replace(/([MLHVZ])([^MLHVZ]*)/g, (_, c, args) => {
      const n = args.trim() ? args.trim().split(/[ ,]+/).map(Number) : [];
      const f = (v, i) => +(c === 'V' ? y + v * k : c === 'H' ? x + (at + v) * k : i % 2 ? y + v * k : x + (at + v) * k).toFixed(2);
      return c + n.map(f).join(' ');
    }));
    at += w + track;
  }
  return { d: d.join(''), width: (at - track) * k };
}

/** neon tubes [[path, colour, width]], pass by pass so no tube's shadow falls on another: an unlit shadow on the
 *  wall, a soft halo, the coloured glass, its hot core */
function tubes(list, id) {
  const pass = (f) => list.map(([d, c, w]) => f(d, c, w)).join('');
  return pass((d, c, w) => `<path d="${d}" stroke="#000" stroke-opacity=".45" stroke-width="${w * 1.15}" transform="translate(${w * 0.22} ${w * 0.32})"/>`)
    + pass((d, c, w) => `<path d="${d}" stroke="${c}" stroke-width="${w * 1.9}" opacity=".55" filter="url(#${id}-h)"/>`)
    + pass((d, c, w) => `<path d="${d}" stroke="${c}" stroke-width="${w}"/>`)
    + pass((d, c, w) => `<path d="${d}" stroke="${CORE[c]}" stroke-width="${w * 0.36}" opacity=".9"/>`);
}
const defs = (id, blur) => `<defs><filter id="${id}-h" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000"><feGaussianBlur stdDeviation="${blur}"/></filter>`
  + `<radialGradient id="${id}-bg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="${NIGHT[0]}"/><stop offset="1" stop-color="${NIGHT[1]}"/></radialGradient></defs>`;
const G0 = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';

/** the mark alone, 512 x 512: tile (a rounded night-blue square behind it), full (the square to the edges, for a
 *  maskable icon: the mark shrinks into the safe circle), plate (the chamfered sign plate around it) */
export function mark({ id = 'ndm', tile = true, full = false, plate = false, scale, title = 'Neon District' } = {}) {
  // as an icon (on its tile or full) the mark fills more of the square and its tubes are thicker, for 16 and 32 px
  const icon = tile || full, s = scale ?? (full ? 0.86 : icon ? 1.12 : 1), w = icon ? 46 : 38, t = `translate(${256 - 256 * s} ${256 - 256 * s}) scale(${s})`;
  const bg = full ? `<rect width="512" height="512" fill="url(#${id}-bg)"/>` : tile ? `<rect width="512" height="512" rx="104" fill="url(#${id}-bg)"/>` : '';
  const pl = plate ? `<path d="M120 52H460V392L392 460H52V120Z" fill="#050916" fill-opacity=".72" stroke="${CY}" stroke-opacity=".38" stroke-width="6" stroke-linejoin="round"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${title}">${defs(id, 16)}${bg}${pl}`
    + `<g transform="${t}" ${G0}>${tubes([[D, MG, w], [N, CY, w]], id)}</g></svg>`;
}

/** the full lockup, 420 high (as wide as the words): the plated mark, then NEON / DISTRICT and a small KESTREL STREET */
export function lockup({ id = 'ndl', bg = true, title = 'Neon District' } = {}) {
  const x = 440, neon = word('NEON', x, 70, 120, 34), dist = word('DISTRICT', x, 236, 92, 30), tag = word('KESTREL STREET', x + 4, 360, 22, 34, 70);
  const end = Math.max(neon.width, dist.width) + x, W = Math.round(end + 70);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 420" role="img" aria-label="${title}">${defs(id, 12)}`
    + (bg ? `<rect width="${W}" height="420" fill="url(#${id}-bg)"/>` : '')
    + `<g transform="translate(20 20) scale(.74)">${mark({ id: id + 'm', tile: false, plate: true }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`
    + `<g ${G0}>${tubes([[neon.d, CY, 16], [dist.d, MG, 14]], id)}</g>`
    + `<path d="M${x} 348H${end}" stroke="${CY}" stroke-opacity=".35" stroke-width="2"/>`
    + `<path d="${tag.d}" ${G0} stroke="#bfefff" stroke-opacity=".78" stroke-width="3.2"/></svg>`;
}
