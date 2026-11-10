// Mirage original code. The contact sheet the tools draw (snap, playtest, variant grids): thumbnails in a grid with a
// numbered label under each, composed in the page's 2D canvas (no image library in node).
//   const png = await page.evaluate(sheetInPage, items, { cols, tw })   items: [{ label, data: 'data:image/png...', color? }]

/** A phone held upright: snap / playtest `--phone` shoot at this size and lay sheets out one phone wide per tile,
 *  so what cannot be read on the sheet cannot be read on a phone. */
export const PHONE = { w: 375, h: 812 };

/** Runs in the page: returns the sheet as a PNG data URL. tw = tile width (px); tiles keep the shots' aspect. */
export async function sheetInPage(items, { cols, tw, title } = {}) {
  cols = Math.max(1, cols || 3);   // the caller clamps to the item count if it wants (snap keeps its --cols width)
  const first = new Image(); first.src = items[0].data; await first.decode();
  const th = Math.round((tw * first.naturalHeight) / first.naturalWidth), pad = 8, lab = 22, top = title ? 26 : 0;
  const c = document.createElement('canvas');
  c.width = cols * (tw + pad) + pad; c.height = top + Math.ceil(items.length / cols) * (th + lab + pad) + pad;
  const g = c.getContext('2d');
  g.fillStyle = '#16130f'; g.fillRect(0, 0, c.width, c.height);
  if (title) { g.fillStyle = '#f0e2c4'; g.font = '600 14px system-ui, sans-serif'; g.fillText(title, pad + 2, 18); }
  for (const [k, it] of items.entries()) {
    const img = new Image(); img.src = it.data; await img.decode();
    const x = pad + (k % cols) * (tw + pad), y = top + pad + Math.floor(k / cols) * (th + lab + pad);
    g.drawImage(img, x, y, tw, th);
    g.fillStyle = it.color || '#f0e2c4'; g.font = '13px system-ui, sans-serif'; g.fillText(`${k + 1}  ${it.label}`, x + 2, y + th + 16, tw - 4);
  }
  return c.toDataURL('image/png');
}
