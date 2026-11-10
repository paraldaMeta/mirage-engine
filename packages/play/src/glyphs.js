// Mirage original code. Text for the headset without Canvas 2D: a built-in 5 x 9 glyph font (printable ASCII,
// drawn for Mirage: packages/play/scripts/glyph-font.mjs is its source) and a small rasteriser that draws it, with
// rounded panels, into an RGBA byte image (straight alpha) for a DataTexture.
// Why: native WebXR hosts that run a page without a browser (e.g. Srile/webxr-to-native on Quest: V8 + WebGL 2,
// no layout engine) offer a Canvas 2D subset whose fillText draws nothing and that has no roundRect, so a canvas
// label is blank or throws there. Glyphs are sampled bilinearly from their bitmap and cut at a threshold with
// a one-pixel smoothstep: a smooth outline (a distance field of the bitmap, in effect) at any size, anti-aliased.
// ---------------------------------------------------------------------------
// canvasTextWorks() -> does this page's Canvas 2D draw text (cached)? textWidth(text, cell) -> px
// const img = createImage(w, h); fillRoundRect(img, x, y, w, h, r, rgba, lineWidth?); drawText(img, text, x, yMid, cell, rgba, bold?)
// A cell is one font pixel: a 56 px canvas font matches cell 5.6 (caps 7 cells high, advance 6 cells).

const FONT = '000000000444440400aaa000000aavavaa004fke5u400op248j300cik8lid0044400000024888420084222480004lel4000044v44000' +
  '00000cc48000e0000000000cc0011248gg00ehjlphe004c4444e00eh1248v00v2421he0026aiv2200vgu11he0068guhhe00v12488800' +
  'ehhehhe00ehhf12c000cc0cc0000cc0cc480248g8420000v0v0000842124800eh1240400eh1dlle00ehhvhhh00uhhuhhu00ehggghe00' +
  'sihhhis00vgguggv00vgguggg00ehgnhhf00hhhvhhh00e44444e0072222ic00hikokih00ggggggv00hrllhhh00hhpljhh00ehhhhhe00' +
  'uhhuggg00ehhhlid00uhhukih00fgge11u00v44444400hhhhhhe00hhhhha400hhhllla00hha4ahh00hha444400v1248gv00e88888e00' +
  'gg8421100e22222e004ah0000000000000v084000000000e1fhf00ggmphhu0000egghe0011djhhf0000ehvge00698s8880000fhhhf1e' +
  'ggmphhh0040c444e002062222icggikoki00c44444e0000qllll0000mphhh0000ehhhe0000uhhhugg00fhhhf1100mpggg0000fge1u00' +
  '88s88960000hhhjd0000hhha40000hhlla0000ha4ah0000hhhhf1e00v248v00688g88600444444400c22122c00008l20000';
export const FONT_SOURCE = FONT;
export const GW = 5, GH = 9, ADVANCE = 6, CAP = 7;   // glyph cells: width, height, advance; caps and ascenders: rows 0-6

// bits[(code - 32) * 45 + row * 5 + col]: 1 where the glyph is drawn
const bits = new Uint8Array(95 * GW * GH);
for (let g = 0; g < 95; g++) for (let r = 0; r < GH; r++) {
  const v = parseInt(FONT[g * GH + r], 32);
  for (let c = 0; c < GW; c++) bits[g * 45 + r * GW + c] = (v >> (GW - 1 - c)) & 1;
}

// what the font lacks, folded to ASCII without Intl or String.prototype.normalize (a host's V8 may have no ICU)
const FOLD = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', '×': 'x',
  'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'î': 'i', 'ï': 'i',
  'ñ': 'n', 'ô': 'o', 'ö': 'o', 'ù': 'u', 'û': 'u', 'ü': 'u', 'É': 'E', 'À': 'A', 'ß': 'ss', '°': 'o' };
/** The text as the font can draw it: printable ASCII, other characters folded or shown as '?'. */
export function glyphText(text) {
  const s = String(text);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  let out = '';
  for (const ch of s) { const c = ch.charCodeAt(0); out += c >= 32 && c < 127 ? ch : ch === '\n' || ch === '\t' ? ' ' : FOLD[ch] ?? '?'; }
  return out;
}

/** The width in pixels of `text` drawn at `cell` px per font pixel (the advance of the last glyph included). */
export const textWidth = (text, cell) => String(text).length * ADVANCE * cell;

/** An RGBA byte image (straight alpha), row 0 at the top. */
export const createImage = (width, height) => ({ width, height, data: new Uint8Array(width * height * 4) });
export const clearImage = (img) => { img.data.fill(0); return img; };

// "over" in straight alpha: rgba 0-255 (alpha 0-1), times coverage k
function blend(d, i, rgba, k) {
  const a = rgba[3] * k;
  if (a <= 0) return;
  const da = d[i + 3] / 255, oa = a + da * (1 - a);
  for (let c = 0; c < 3; c++) d[i + c] = Math.round((rgba[c] * a + d[i + c] * da * (1 - a)) / oa);
  d[i + 3] = Math.round(oa * 255);
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A rounded rectangle, filled; with `lineWidth` its outline instead (centred on the edge, as Canvas 2D strokes). */
export function fillRoundRect(img, x, y, w, h, r, rgba, lineWidth = 0) {
  const { width: W, height: H, data } = img, cx = x + w / 2, cy = y + h / 2, hx = w / 2 - r, hy = h / 2 - r, pad = lineWidth / 2 + 1;
  const x0 = Math.max(0, Math.floor(x - pad)), x1 = Math.min(W, Math.ceil(x + w + pad)), y0 = Math.max(0, Math.floor(y - pad)), y1 = Math.min(H, Math.ceil(y + h + pad));
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
    const qx = Math.abs(px + 0.5 - cx) - hx, qy = Math.abs(py + 0.5 - cy) - hy;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;   // signed distance to the edge
    const k = lineWidth ? clamp01(0.5 - (Math.abs(d) - lineWidth / 2)) : clamp01(0.5 - d);
    if (k > 0) blend(data, (py * W + px) * 4, rgba, k);
  }
}

const bit = (base, i, j) => (i < 0 || j < 0 || i >= GW || j >= GH ? 0 : bits[base + j * GW + i]);
/** Draw `text` with its left edge at x and the middle of its capitals at yMid; `cell` px per font pixel. */
export function drawText(img, text, x, yMid, cell, rgba, bold = false) {
  const { width: W, height: H, data } = img, s = glyphText(text);
  const t = bold ? 0.3 : 0.42, aa = Math.min(0.3, 0.75 / cell), top = yMid - (CAP / 2) * cell;
  for (let n = 0; n < s.length; n++) {
    const g = s.charCodeAt(n) - 32;
    if (g <= 0 || g >= 95) continue;   // space (and anything glyphText let through)
    const gx = x + n * ADVANCE * cell, base = g * 45;
    const x0 = Math.max(0, Math.floor(gx - cell)), x1 = Math.min(W, Math.ceil(gx + (GW + 1) * cell)), y0 = Math.max(0, Math.floor(top - cell)), y1 = Math.min(H, Math.ceil(top + (GH + 1) * cell));
    for (let py = y0; py < y1; py++) {
      const v = (py + 0.5 - top) / cell - 0.5, j = Math.floor(v), fv = v - j;
      for (let px = x0; px < x1; px++) {
        const u = (px + 0.5 - gx) / cell - 0.5, i = Math.floor(u), fu = u - i;
        const val = (bit(base, i, j) * (1 - fu) + bit(base, i + 1, j) * fu) * (1 - fv) + (bit(base, i, j + 1) * (1 - fu) + bit(base, i + 1, j + 1) * fu) * fv;
        if (val <= t - aa) continue;
        const e = clamp01((val - (t - aa)) / (2 * aa)), k = e * e * (3 - 2 * e);
        blend(data, (py * W + px) * 4, rgba, k);
      }
    }
  }
}

let textWorks = null;
/** Whether Canvas 2D draws text here: 'M' filled on a small canvas must leave pixels (fillText is a no-op on
 *  some native hosts). Cached; false without a canvas at all. */
export function canvasTextWorks() {
  if (textWorks !== null) return textWorks;
  textWorks = false;
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(32, 32)
      : typeof document !== 'undefined' && document.createElement ? Object.assign(document.createElement('canvas'), { width: 32, height: 32 }) : null;
    const g = c && c.getContext('2d');
    if (g && typeof g.fillText === 'function' && typeof g.getImageData === 'function') {
      g.font = '24px sans-serif'; g.fillStyle = '#fff'; g.fillText('M', 4, 26);
      const d = g.getImageData(0, 0, 32, 32).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) { textWorks = true; break; }
    }
  } catch { textWorks = false; }
  return textWorks;
}
/** Tests: forget the cached answer. */
export const resetCanvasTextCheck = () => { textWorks = null; };
