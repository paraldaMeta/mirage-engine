// Helpers the modules share: a lamp (a PointLight handed to the clustered path and listed for the volumetric
// pass), sign faces drawn into a canvas (text, no image files), and small geometry shorthands.
import * as THREE from 'three';

/** A local light. `intensity` is display-referred (what a lantern of that number looks like at the reference
 *  exposure); it is scaled by the world's lamp gain so a night scene does not blow out at its high exposure.
 *  shadow: a tile of the clustered shadow atlas. vol: also a candidate for the volumetric pass and its lamp shadows.
 *  Returns the light; ctx.shared.lamps collects every one (main.js registers the table with light2). */
export function lamp(ctx, { pos, color = 0xffffff, intensity = 4, range = 8, shadow = false, vol = false, decay = 2 }) {
  const { world } = ctx, gain = ctx.G.uLampGain.value;
  const l = new THREE.PointLight(color, intensity * gain, range, decay);
  l.position.set(pos[0], pos[1], pos[2]);
  l.userData.base = intensity * gain;          // the game dims and flickers around this
  ctx.root.add(l);
  const q = ctx.shared.quality || 'high';
  if (world.lighting?.lights) world.lighting.addLight(l, { shadow: shadow && q !== 'low' });
  (ctx.shared.lamps ||= []).push({ light: l, vol });
  return l;
}

const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Heiti TC", system-ui, sans-serif';
const textures = new Map();
/** A sign face: glowing text on black, as a texture for a glow material's `map`.
 *  lines: string | string[]; vertical: one glyph per row (CJK shop signs); frame: a tube outline round it. */
export function signTexture(lines, { color = '#ff2a80', vertical = false, frame = true, weight = 800, w = 512, h = 256, second = null } = {}) {
  const key = JSON.stringify([lines, color, vertical, frame, weight, w, h, second]);
  if (textures.has(key)) return textures.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const rows = vertical ? [...[].concat(lines).join('')] : [].concat(lines);
  const pad = Math.min(w, h) * 0.12;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  // the largest size at which every row fits
  let size = (h - 2 * pad) / rows.length;
  g.font = `${weight} ${size}px ${FONT}`;
  for (const r of rows) size = Math.min(size, size * (w - 2 * pad) / Math.max(g.measureText(r).width, 1));
  const draw = (blur, alpha, fill) => {
    g.shadowColor = color; g.shadowBlur = blur; g.globalAlpha = alpha; g.fillStyle = fill; g.strokeStyle = color;
    rows.forEach((r, i) => {
      g.font = `${weight} ${size * 0.92}px ${FONT}`;
      if (second && i % 2 === 1) { g.fillStyle = fill === '#fff' ? '#fff' : second; g.shadowColor = second; }
      else { g.fillStyle = fill; g.shadowColor = color; }
      g.fillText(r, w / 2, pad + (h - 2 * pad) * (i + 0.5) / rows.length + size * 0.04);
    });
    if (frame) { g.shadowColor = color; g.lineWidth = Math.max(3, pad * 0.16); g.strokeRect(pad * 0.42, pad * 0.42, w - pad * 0.84, h - pad * 0.84); }
  };
  draw(pad * 0.9, 0.9, color);       // the halo
  draw(pad * 0.3, 1, color);
  draw(0, 0.75, '#fff');             // a hot core
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  textures.set(key, t);
  return t;
}

/** a rect [x0, z0, x1, z1] as { cx, cz, w, d } */
export const rc = ([x0, z0, x1, z1]) => ({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
/** add a box by its corner ranges: b.box needs a centre and a size */
export const slab = (b, material, [x0, z0, x1, z1], y0, y1, bevel = 0) => b.box(material, [x1 - x0, y1 - y0, z1 - z0], [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [0, 0, 0], bevel);
/** every mesh under `o` stays out of the walk grid and the physics (decor: signs, tubes, cables) */
export const decor = (o) => { o.userData.collide = false; return o; };
