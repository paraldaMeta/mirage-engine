// Mirage original code. WCAG contrast of the text a game draws over its scene (prompts, the objective, toasts,
// dialogs): what a player has to read against whatever the world shows behind it. Technique: hide the glyphs of
// every visible text element (colour transparent, no text-shadow; layout and the element's own panel stay), take
// one screenshot, and measure the pixels inside each text box, i.e. exactly what is behind the letters: the panel
// where there is one, the scene where there is not. The ratio is the text colour against the 10th-percentile-worst
// backdrop pixel in the box (a speck of sky does not fail a prompt; a bright half does).
//   const { items } = await contrastAudit(page)   items: [{ text, selector, size, bold, large, color, ratio, need, pass, backdrop }]
// WCAG 2.x AA: 4.5:1, or 3:1 for large text (>= 24 px, or >= 18.66 px bold). A text-shadow helps a reader but is not
// counted (the message says when an element relies on one).

/** Runs in the page: marks the candidates, hides their glyphs; returns their boxes and colours. */
export function contrastPrepareInPage(root) {
  const scope = (root && document.querySelector(root)) || document.body;
  const out = [];
  const visible = (el) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) return false;
      if (a.tagName === 'DIALOG' && !a.open) return false;
    }
    return true;
  };
  // any CSS colour (rgb(), oklch(), color(display-p3 ...), a name) as sRGB 0..255 + alpha, through a 2D canvas
  const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); cx.canvas.width = cx.canvas.height = 1;
  const rgba = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return d[3] ? [d[0] / (d[3] / 255), d[1] / (d[3] / 255), d[2] / (d[3] / 255), d[3] / 255] : [0, 0, 0, 0]; };
  const opacity = (el) => { let o = 1; for (let a = el; a && a !== document.documentElement; a = a.parentElement) o *= +getComputedStyle(a).opacity; return o; };
  for (const el of scope.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'CANVAS', 'svg', 'NOSCRIPT'].includes(el.tagName)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && /\S/.test(n.nodeValue)).map((n) => n.nodeValue.trim()).join(' ');
    if (!own || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    const cs = getComputedStyle(el), m = rgba(cs.color);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    // children that paint their own panel (a <kbd> chip inside a prompt) are not this text's backdrop
    const holes = [...el.children].filter((k) => { const c = getComputedStyle(k); return c.backgroundImage !== 'none' || rgba(c.backgroundColor)[3] > 0; })
      .map((k) => { const q = k.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; });
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    out.push({ id: out.length, text: own.slice(0, 60), selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls, size, bold,
      large: size >= 24 || (bold && size >= 18.66), rgb: m.slice(0, 3), alpha: (m[3] ?? 1) * opacity(el), shadow: cs.textShadow !== 'none',
      holes, box: [Math.max(0, r.left), Math.max(0, r.top), Math.min(innerWidth, r.right), Math.min(innerHeight, r.bottom)].map(Math.round) });
    el.setAttribute('data-mg-contrast', '');
    // color: transparent would also hide what is drawn in currentColor (borders, outlines, an icon's fill): pin those
    // to their computed colours for the screenshot, inline, and put the inline values back afterwards
    const keep = {};
    for (const prop of ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'fill', 'stroke']) {
      keep[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
      el.style.setProperty(prop, cs.getPropertyValue(prop), 'important');
    }
    el.__mgContrastKeep = keep;
  }
  const st = document.createElement('style');
  st.id = 'mg-contrast-hide';
  // ::before / ::after text is glyphs too (an icon font, a bullet): hidden the same way, so it is not read as backdrop
  st.textContent = '[data-mg-contrast],[data-mg-contrast]::before,[data-mg-contrast]::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}';
  document.head.appendChild(st);
  return out;
}

/** Runs in the page: puts the glyphs back. */
export function contrastRestoreInPage() {
  document.getElementById('mg-contrast-hide')?.remove();
  for (const el of document.querySelectorAll('[data-mg-contrast]')) {
    el.removeAttribute('data-mg-contrast');
    for (const [prop, [v, pri]] of Object.entries(el.__mgContrastKeep || {})) { if (v) el.style.setProperty(prop, v, pri); else el.style.removeProperty(prop); }
    delete el.__mgContrastKeep;
  }
}

/** Runs in the page: the measurement of each candidate over the screenshot (a PNG data URL of the viewport). */
export async function contrastMeasureInPage(png, items) {
  const img = new Image(); img.src = png; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const sx = c.width / innerWidth, sy = c.height / innerHeight;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  return items.map((it) => {
    const [x0, y0, x1, y1] = it.box, w = Math.max(1, Math.round((x1 - x0) * sx)), h = Math.max(1, Math.round((y1 - y0) * sy));
    const d = g.getImageData(Math.round(x0 * sx), Math.round(y0 * sy), w, h).data, ratios = [];
    let sr = 0, sg = 0, sb = 0;
    const X0 = Math.round(x0 * sx), Y0 = Math.round(y0 * sy);
    for (let i = 0; i < d.length; i += 4) {
      const px = (X0 + ((i / 4) % w)) / sx, py = (Y0 + Math.floor(i / 4 / w)) / sy;
      if (it.holes.some(([a, b, c2, e]) => px >= a && px < c2 && py >= b && py < e)) continue;
      // the text colour over this backdrop pixel (a translucent colour is mixed with what it is drawn on)
      const a = it.alpha, t = it.rgb.map((v, k) => v * a + d[i + k] * (1 - a));
      const L1 = lum(...t), L2 = lum(d[i], d[i + 1], d[i + 2]);
      ratios.push((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
      sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
    }
    if (!ratios.length) ratios.push(21);
    ratios.sort((p, q) => p - q);
    const n = ratios.length, ratio = +ratios[Math.floor(0.1 * (n - 1))].toFixed(2), need = it.large ? 3 : 4.5;
    const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
    return { text: it.text, selector: it.selector, size: it.size, bold: it.bold, large: it.large, shadow: it.shadow, box: it.box,
      color: '#' + it.rgb.map(hex).join('') + (it.alpha < 1 ? hex(it.alpha * 255) : ''), backdrop: '#' + [sr, sg, sb].map((v) => hex(v / (n || 1))).join(''),
      ratio, median: +ratios[Math.floor(0.5 * (n - 1))].toFixed(2), need, pass: ratio >= need };
  });
}

/** The audit of the page as it is now (puppeteer page). root: a CSS selector to audit under (default the body). */
export async function contrastAudit(page, { root } = {}) {
  const t0 = Date.now();
  const cand = await page.evaluate(contrastPrepareInPage, root || null);
  let png;
  try {
    // two frames so the style change is painted before the screenshot
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    png = 'data:image/png;base64,' + (await page.screenshot({ encoding: 'base64' }));
  } finally { await page.evaluate(contrastRestoreInPage); }
  const items = cand.length ? await page.evaluate(contrastMeasureInPage, png, cand) : [];
  return { items, ms: Date.now() - t0, min: items.length ? Math.min(...items.map((i) => i.ratio / i.need)) : null };
}
