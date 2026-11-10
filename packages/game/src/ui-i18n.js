// Mirage original code. Localisation for the UI toolkit: string tables, ICU-style messages (interpolation, plural,
// selectordinal, select, number, date) formatted with the platform's Intl, a runtime language switch that every
// bound text follows, text direction, line breaking for scripts without spaces, and font stacks per script.
// No DOM here: ui-kit.js puts `lang` / `dir` on the root and the CSS mirrors itself through logical properties.
// ---------------------------------------------------------------------------
// const i18n = createI18n({ locale: 'en', tables: { en: { 'bag.count': '{n, plural, one {# item} other {# items}}' },
//                                                   'zh-Hant': { 'bag.count': '{n} 件物品' } } });
// i18n.t('bag.count', { n: 3 })          -> '3 items'   (reads the locale signal: inside an effect it re-runs on switch)
// i18n.setLocale('ar')                   -> i18n.dir.value === 'rtl', i18n.lang.value === 'ar'
// i18n.add('fr', table)  i18n.locales()  i18n.missing  (keys asked for and not found: Set of 'locale:key')
// i18n.number(1234.5)  i18n.date(d, { dateStyle: 'medium' })  i18n.list(['a','b'])  i18n.relative(-3, 'day')
// wrapText(text, maxWidth, measure, locale) -> lines   (canvas panels: Intl.Segmenter words + kinsoku rules)
// graphemes(text, locale) -> user-perceived characters (the typewriter never splits a cluster or a surrogate pair)
// Message syntax (a subset of ICU MessageFormat): {name}  {n, number}  {n, number, percent}  {d, date, short}
//   {n, plural, =0 {none} one {# item} other {# items}}  {n, selectordinal, one {#st} other {#th}}
//   {g, select, f {she} m {he} other {they}}; '{' and '}' are written '{ and '} ; nesting is allowed.
// Fallback: 'zh-Hant-TW' -> 'zh-Hant' -> 'zh' -> options.fallback -> the key itself.
// ---------------------------------------------------------------------------
import { signal, computed } from './ui-reactive.js';

const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Syrc', 'Nkoo', 'Adlm', 'Rohg']);
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);
/** 'rtl' or 'ltr' for a BCP 47 tag: the locale's own text info where the runtime has it, else by script / language. */
export function textDirection(locale) {
  try {
    const l = new Intl.Locale(locale), info = l.getTextInfo ? l.getTextInfo() : l.textInfo;
    if (info && info.direction) return info.direction;
    const script = l.maximize().script;
    if (script) return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  } catch { /* an odd tag: by its language subtag below */ }
  return RTL_LANGS.has(String(locale).split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';
}

// font stacks: the Latin UI font first, then the script's own system and Noto faces, so one string that mixes
// scripts still finds every glyph (the browser falls through the list per character)
const LATIN = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';
const FONTS = {
  Hant: '"PingFang TC","Microsoft JhengHei","Noto Sans TC","Noto Sans CJK TC","Heiti TC"',
  Hans: '"PingFang SC","Microsoft YaHei","Noto Sans SC","Noto Sans CJK SC","Heiti SC"',
  Jpan: '"Hiragino Sans","Yu Gothic UI","Meiryo","Noto Sans JP","Noto Sans CJK JP"',
  Kore: '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","Noto Sans CJK KR"',
  Arab: '"Geeza Pro","Segoe UI","Noto Sans Arabic","Noto Naskh Arabic","Tahoma"',
  Hebr: '"Arial Hebrew","Segoe UI","Noto Sans Hebrew"', Thai: '"Thonburi","Leelawadee UI","Noto Sans Thai"',
  Deva: '"Kohinoor Devanagari","Nirmala UI","Noto Sans Devanagari"',
};
const scriptOf = (locale) => { try { return new Intl.Locale(locale).maximize().script || 'Latn'; } catch { return 'Latn'; } };
/** A CSS font-family list for a locale: its script's faces before the generic fallback. */
export function fontStack(locale) {
  const s = FONTS[scriptOf(locale)];
  return s ? (['Arab', 'Hebr'].includes(scriptOf(locale)) ? `${s},${LATIN}` : `${LATIN.replace(',sans-serif', '')},${s},sans-serif`) : LATIN;
}

// ---- messages: parsed once per string into a small tree, then formatted with Intl
// node: string | { arg, type, style, options: { key: nodes } }
function parse(src) {
  let i = 0;
  const fail = (m) => { throw new Error(`ui-i18n: ${m} at ${i} in "${src}"`); };
  function nodes(inPlural) {
    const out = []; let text = '';
    const push = () => { if (text) { out.push(text); text = ''; } };
    while (i < src.length) {
      const c = src[i];
      if (c === "'" && (src[i + 1] === '{' || src[i + 1] === '}' || src[i + 1] === "'")) { text += src[i + 1]; i += 2; continue; }
      if (c === '}') break;
      if (c === '#' && inPlural) { push(); out.push({ hash: true }); i++; continue; }
      if (c !== '{') { text += c; i++; continue; }
      push(); i++;
      const head = /^\s*([\w.$-]+)\s*(?:,\s*(\w+)\s*)?(?:,\s*)?/.exec(src.slice(i));
      if (!head) fail('bad argument');
      i += head[0].length;
      const node = { arg: head[1], type: head[2] || '', style: '', options: null };
      if (node.type === 'plural' || node.type === 'selectordinal' || node.type === 'select') {
        node.options = {};
        for (;;) {
          const k = /^\s*(=\d+|[\w-]+)\s*\{/.exec(src.slice(i));
          if (!k) break;
          i += k[0].length;
          node.options[k[1]] = nodes(node.type !== 'select' ? node.arg : inPlural);
          if (src[i] !== '}') fail('unclosed option');
          i++;
        }
        if (!node.options.other) fail(`{${node.arg}, ${node.type}} needs an "other" option`);
        const tail = /^\s*/.exec(src.slice(i)); i += tail[0].length;
      } else {
        const end = src.indexOf('}', i);
        if (end < 0) fail('unclosed argument');
        node.style = src.slice(i, end).trim(); i = end;
      }
      if (src[i] !== '}') fail('unclosed argument');
      i++; out.push(node);
    }
    push();
    return out;
  }
  const tree = nodes(null);
  if (i < src.length) fail('unexpected }');
  return tree;
}

const NUMBER_STYLES = { percent: { style: 'percent' }, integer: { maximumFractionDigits: 0 }, compact: { notation: 'compact' } };
const FSI = '⁨', PDI = '⁩';

/** A localiser. `locale` may be changed at any time; texts bound through t() inside effects follow. */
export function createI18n({ locale = 'en', fallback = 'en', tables = {}, isolate = true, onMissing } = {}) {
  const loc = signal(locale), version = signal(0);   // version: a table was added (bound texts re-read)
  const all = new Map(Object.entries(tables)), parsed = new Map(), fmt = new Map(), missing = new Set();
  const cache = (key, make) => { let f = fmt.get(key); if (!f) fmt.set(key, f = make()); return f; };
  const plural = (l, type) => cache(`p|${l}|${type}`, () => new Intl.PluralRules(l, { type }));
  const numFmt = (l, o) => cache(`n|${l}|${JSON.stringify(o || {})}`, () => new Intl.NumberFormat(l, o));
  const dateFmt = (l, o) => cache(`d|${l}|${JSON.stringify(o || {})}`, () => new Intl.DateTimeFormat(l, o));
  // 'zh-Hant-TW' -> ['zh-Hant-TW', 'zh-Hant', 'zh', fallback]
  const chain = (l) => { const parts = String(l).split('-'), out = []; while (parts.length) { out.push(parts.join('-')); parts.pop(); } if (!out.includes(fallback)) out.push(fallback); return out; };
  function lookup(key, l) {
    for (const c of chain(l)) { const t = all.get(c); if (t && t[key] != null) return [t[key], c]; }
    return null;
  }
  function render(tree, params, l, n, dir) {
    let s = '';
    for (const node of tree) {
      if (typeof node === 'string') { s += node; continue; }
      if (node.hash) { s += numFmt(l).format(n); continue; }
      const v = params ? params[node.arg] : undefined;
      if (node.type === 'plural' || node.type === 'selectordinal') {
        const num = Number(v);
        const pick = node.options['=' + num] || node.options[plural(l, node.type === 'plural' ? 'cardinal' : 'ordinal').select(num)] || node.options.other;
        s += render(pick, params, l, num, dir);
      } else if (node.type === 'select') {
        s += render(node.options[String(v)] || node.options.other, params, l, n, dir);
      } else if (node.type === 'number') {
        s += numFmt(l, NUMBER_STYLES[node.style] || (node.style ? { style: 'currency', currency: node.style } : undefined)).format(Number(v));
      } else if (node.type === 'date' || node.type === 'time') {
        const style = node.style || 'medium';
        s += dateFmt(l, node.type === 'date' ? { dateStyle: style } : { timeStyle: style }).format(v instanceof Date ? v : new Date(v));
      } else {
        // a name or a number from the game dropped into a sentence of another direction keeps its own order
        // (first-strong isolate): "Ana (3)" inside Arabic does not get its brackets flipped
        const text = v == null ? `{${node.arg}}` : typeof v === 'number' ? numFmt(l).format(v) : String(v);
        s += isolate && typeof v === 'string' && v && needsIsolate(text, dir) ? FSI + text + PDI : text;
      }
    }
    return s;
  }
  const i18n = {
    /** the current tag (a signal: assign through setLocale) */
    locale: loc,
    lang: computed(() => loc.value),
    dir: computed(() => textDirection(loc.value)),
    font: computed(() => fontStack(loc.value)),
    missing,
    setLocale(l) { loc.value = l; },
    /** merge a table in; under = true keeps the strings already there (a toolkit's defaults beneath a game's) */
    add(l, table, under = false) { all.set(l, under ? { ...table, ...(all.get(l) || {}) } : { ...(all.get(l) || {}), ...table }); for (const k of [...parsed.keys()]) if (k.startsWith(l + '\n')) parsed.delete(k); version.value++; },
    locales: () => [...all.keys()],
    has: (key, l = loc.peek()) => !!lookup(key, l),
    /** the message `key` in the current language, formatted with params. Unknown keys return the key (and are
     *  recorded in `missing`), so a missing string is visible on screen and in tests. */
    t(key, params) {
      const l = loc.value; version.value;
      const hit = lookup(key, l);
      if (!hit) { if (!missing.has(l + ':' + key)) { missing.add(l + ':' + key); onMissing?.(key, l); } return String(key); }
      const [src, from] = hit;
      if (from !== l && from === fallback && !missing.has(l + ':' + key) && chain(l)[0] !== fallback) { missing.add(l + ':' + key); onMissing?.(key, l); }
      if (typeof src !== 'string') return String(src);
      if (!src.includes('{') && !src.includes("'")) return src;
      const id = from + '\n' + src;
      let tree = parsed.get(id);
      if (!tree) parsed.set(id, tree = parse(src));
      return render(tree, params, from, 0, textDirection(from));   // plural rules of the language the string is in
    },
    number: (v, o) => numFmt(loc.value, o).format(v),
    date: (v, o = { dateStyle: 'medium', timeStyle: 'short' }) => dateFmt(loc.value, o).format(v instanceof Date ? v : new Date(v)),
    list: (items, o = { type: 'conjunction' }) => cache(`l|${loc.value}|${JSON.stringify(o)}`, () => new Intl.ListFormat(loc.value, o)).format(items),
    relative: (v, unit, o = { numeric: 'auto' }) => cache(`r|${loc.value}|${JSON.stringify(o)}`, () => new Intl.RelativeTimeFormat(loc.value, o)).format(v, unit),
    /** the plural category of n in the current language: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other' */
    plural: (n, type = 'cardinal') => plural(loc.value, type).select(n),
  };
  return i18n;
}
const STRONG_RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/, STRONG_LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ぀-ヿ一-鿿]/;
// isolate only when the value's direction differs from the sentence's, or it has neutral edges that would attach
// to the wrong side (brackets, punctuation, digits next to RTL text)
function needsIsolate(text, dir) {
  const rtl = STRONG_RTL.test(text), ltr = STRONG_LTR.test(text);
  return dir === 'rtl' ? ltr || !rtl : rtl;
}

// ---- text without a layout engine (canvas panels, the typewriter)
let segmenters = new Map();
const segmenter = (locale, granularity) => {
  const k = locale + '|' + granularity;
  let s = segmenters.get(k);
  if (!s && typeof Intl !== 'undefined' && Intl.Segmenter) segmenters.set(k, s = new Intl.Segmenter(locale, { granularity }));
  return s || null;
};
/** User-perceived characters: a flag, a family emoji, a Devanagari cluster or a letter with combining marks is one. */
export function graphemes(text, locale = 'en') {
  const s = segmenter(locale, 'grapheme');
  if (s) return Array.from(s.segment(String(text)), (x) => x.segment);
  return Array.from(String(text));   // code points: no surrogate pair is split, clusters may be
}
// kinsoku shori: characters that may not start a line (closing punctuation, small kana, prolonged sound mark)
// and characters that may not end one (opening brackets). The same sets a browser applies with line-break: strict.
const NO_START = new Set([...'、。，．：；！？）］｝〉》」』】〕〗〙〟’”｠»ゝゞーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻‐゠–〜～‼⁇⁈⁉・,.:;!?)]}%…‥']);
const NO_END = new Set([...'（［｛〈《「『【〔〖〘〝‘“｟«([{$£¥＄￡￥']);
const CJK = /[⺀-鿿豈-﫿＀-￯　-ヿ]/;
/** The places `text` may break: an array of pieces whose concatenation is the text; a line ends between pieces.
 *  Spaced scripts break at spaces (the space stays at the end of its piece), CJK between characters except where
 *  kinsoku forbids it, other unspaced scripts (Thai) at Intl.Segmenter word boundaries. */
export function breakPieces(text, locale = 'en') {
  const s = String(text), out = [];   // [piece, wordLike]
  const seg = segmenter(locale, 'word');
  const words = seg ? Array.from(seg.segment(s), (x) => [x.segment, !!x.isWordLike]) : s.split(/(?<=\s)|(?=\s)/).map((w) => [w, !/^\s*$/.test(w)]);
  for (const [w, wordLike] of words) {
    if (!w) continue;
    if (CJK.test(w)) for (const ch of w) out.push([ch, !NO_START.has(ch) && !NO_END.has(ch)]);   // between any two, kinsoku permitting
    else out.push([w, wordLike]);
  }
  // glue what may not be separated: a space to the word before it, [piece][no-start char], [no-end char][piece],
  // and punctuation to its neighbour in spaced scripts; two word-like pieces with no space between them (Thai,
  // or CJK characters) stay separate: a line may end there
  const glued = [];
  let prevWord = false;
  for (const [p, wordLike] of out) {
    const prev = glued.length ? glued[glued.length - 1] : null;
    const space = /^\s+$/.test(p);
    const tail = prev === null ? '' : [...prev].pop();
    if (prev !== null && (space || (!/\s$/.test(prev) && (NO_START.has([...p][0]) || NO_END.has(tail) || (!CJK.test(p) && !CJK.test(tail) && !(wordLike && prevWord)))))) glued[glued.length - 1] += p;
    else glued.push(p);
    if (!space) prevWord = wordLike;
  }
  return glued;
}
/** Wrap `text` to lines no wider than maxWidth, measured by measure(string) -> px. '\n' forces a break; a piece
 *  wider than a line is split by grapheme. Trailing spaces are dropped from each line. */
export function wrapText(text, maxWidth, measure, locale = 'en') {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const piece of breakPieces(para, locale)) {
      if (!line || measure((line + piece).trimEnd()) <= maxWidth) { line += piece; }
      else { lines.push(line.trimEnd()); line = piece; }
      while (measure(line.trimEnd()) > maxWidth && graphemes(line, locale).length > 1) {   // one piece wider than the line
        const g = graphemes(line, locale); let n = g.length - 1;
        while (n > 1 && measure(g.slice(0, n).join('')) > maxWidth) n--;
        lines.push(g.slice(0, n).join('')); line = g.slice(n).join('');
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
