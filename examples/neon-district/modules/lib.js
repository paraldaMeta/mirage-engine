// Helpers the modules share: a lamp (a PointLight handed to the clustered path and listed for the volumetric
// pass), sign faces drawn into a canvas (text, no image files), and small geometry shorthands.
import * as THREE from 'three';

/** A local light. `intensity` is display-referred (what a lantern of that number looks like at the reference
 *  exposure): the engine's lamp gain scales it, so it holds its look at any hour's exposure and goes out by day.
 *  Two paths:
 *  - the lamp pool (world.lampPool, core's opt-in): a lamp is three texels of data, shaded inside the lit materials
 *    and binned per view cell. Every sign, strip and screen goes here: hundreds cost what the few near a pixel cost.
 *    `normal` (the wall's outward normal) and `back` (metres from the lamp to that wall's face) stop the light at
 *    the wall it hangs on.
 *  - a clustered PointLight (world.lighting.addLight): for a lamp that casts a shadow (`shadow`), one the game
 *    moves or flickers (`live`) or one indoors that stays lit by day (`indoor`). Returns the light.
 *  vol: also scattered by the volumetric pass. ctx.shared.lamps / ctx.shared.pool collect them (main.js). */
export function lamp(ctx, { pos, color = 0xffffff, intensity = 4, range = 8, shadow = false, vol = false, decay = 2, live = false, indoor = false, normal = null, back = 0.3 }) {
  const { world } = ctx, c = new THREE.Color(color), q = ctx.shared.quality || 'high';
  // the street's key light is white and warm-white (LED street and shop lighting, sodium and tungsten windows); a
  // saturated colour (a neon sign, a screen) is an accent: it tints what is right by it, it does not wash the street.
  // Outdoors such a lamp keeps 55 % of its power and 65 % of its reach (and the view cells hold fewer lamps)
  const sat = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / Math.max(c.r, c.g, c.b, 1e-6);
  if (!indoor && sat > 0.55) { intensity *= 0.55; range *= 0.65; }
  if (world.lampPool && !live && !indoor && !(shadow && q !== 'low')) {
    (ctx.shared.pool ||= []).push({ pos: pos.slice(), range, power: intensity, color: [c.r, c.g, c.b], decay, ...(normal ? { normal, back } : {}) });
    return null;
  }
  const l = new THREE.PointLight(c, 0, range, decay);
  l.position.set(pos[0], pos[1], pos[2]);
  l.userData.nd = intensity; l.userData.indoor = indoor;   // main.js sets the intensity from the hour's lamp gain
  ctx.root.add(l);
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

/** The faces of plan.blocks that look onto ground the player can stand on (the street, the plaza, the alley):
 *  [{ block, face, x0, z0, x1, z1 (the face's line on the ground), nx, nz (its outward normal), len }].
 *  A face is cut where another building stands against it. */
export function openFaces(plan) {
  const B = plan.bounds, solid = [...plan.blocks.filter((k) => !k.y).map((k) => k.rect), plan.bar.rect, plan.relay.rect];
  const free = (x, z) => x > B[0] && x < B[2] && z > B[1] && z < B[3] && !solid.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
  const out = [];
  for (const k of plan.blocks) {
    const [x0, z0, x1, z1] = k.rect;
    for (const [face, ax, az, bx, bz, nx, nz] of [['n', x0, z0, x1, z0, 0, -1], ['s', x0, z1, x1, z1, 0, 1], ['w', x0, z0, x0, z1, -1, 0], ['e', x1, z0, x1, z1, 1, 0]]) {
      // walk the face in 1 m steps and keep the runs that have open ground in front
      const len = Math.hypot(bx - ax, bz - az), n = Math.round(len);
      let from = -1;
      for (let i = 0; i <= n; i++) {
        const t = (i + 0.5) / n, ok = i < n && free(ax + (bx - ax) * t + nx * 1.2, az + (bz - az) * t + nz * 1.2);
        if (ok && from < 0) from = i;
        if (!ok && from >= 0) {
          if (i - from >= 3) out.push({ block: k, face, nx, nz, len: i - from, x0: ax + (bx - ax) * from / n, z0: az + (bz - az) * from / n, x1: ax + (bx - ax) * i / n, z1: az + (bz - az) * i / n });
          from = -1;
        }
      }
    }
  }
  return out;
}
/** rotY that turns local +Z to a face's outward normal */
export const faceYaw = (f) => Math.atan2(f.nx, f.nz);
/** a point on a face: `u` metres along it from its start, `y` up, `out` metres off the wall */
export const onFace = (f, u, y, out = 0) => [f.x0 + (f.x1 - f.x0) * u / f.len + f.nx * out, y, f.z0 + (f.z1 - f.z0) * u / f.len + f.nz * out];

/** Wall art drawn into a canvas with a seeded stream: 'tag' (sprayed letters and drips), 'poster' (a pasted bill with
 *  a headline and small print), 'stencil' (one bold glyph). Transparent where there is no paint. */
export function artTexture(kind, R, { text = '', color = '#ff2a80', w = 256, h = 256 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineCap = g.lineJoin = 'round';
  if (kind === 'poster') {
    g.fillStyle = `hsl(${Math.floor(R.range(20, 60))} 30% ${Math.floor(R.range(55, 75))}%)`; g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = color; g.fillRect(6, 6, w - 12, h * 0.34);
    g.fillStyle = '#111'; g.font = `900 ${h * 0.2}px ${FONT}`; g.fillText(text, w / 2, h * 0.19, w - 30);
    g.font = `600 ${h * 0.05}px ${FONT}`;
    for (let i = 0; i < 7; i++) { g.globalAlpha = 0.55; g.fillRect(24, h * (0.44 + i * 0.065), (w - 48) * R.range(0.5, 1), h * 0.022); }
    g.globalAlpha = 1; g.fillStyle = color; g.fillRect(24, h * 0.9 - 8, w * 0.3, 10);
    // torn corners and rain streaks
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(R.chance(0.5) ? 0 : w, R.chance(0.5) ? 0 : h, R.range(14, 44), 0, 7); g.fill(); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.18; g.fillStyle = '#000';
    for (let i = 0; i < 12; i++) g.fillRect(R.range(8, w - 8), R.range(8, h * 0.5), 2, R.range(20, h * 0.5));
  } else if (kind === 'stencil') {
    g.fillStyle = color; g.font = `900 ${h * 0.8}px ${FONT}`; g.globalAlpha = 0.85; g.fillText(text, w / 2, h / 2, w - 10);
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.5;
    for (let i = 0; i < 160; i++) g.fillRect(R.range(0, w), R.range(0, h), R.range(1, 4), R.range(1, 4));
  } else {
    // a tag: two passes of fat marker strokes for each letter-like squiggle, an outline, a few drips
    const n = 3 + Math.floor(R.range(0, 3)), cw = (w - 30) / n, sd = 'k' + Math.floor(R.range(0, 1e6));
    for (const [lw, col, a] of [[h * 0.11, '#000', 0.5], [h * 0.075, color, 0.95], [h * 0.02, '#fff', 0.7]]) {
      g.strokeStyle = col; g.lineWidth = lw; g.globalAlpha = a;
      const S = R.fork('tag' + text + sd);   // the same squiggles for the three passes
      for (let i = 0; i < n; i++) {
        const x = 15 + cw * (i + 0.5);
        g.beginPath(); g.moveTo(x - cw * 0.35, h * 0.72);
        g.bezierCurveTo(x - cw * 0.4, h * S.range(0.1, 0.3), x + cw * 0.4, h * S.range(0.15, 0.4), x + cw * S.range(-0.2, 0.3), h * 0.5);
        g.bezierCurveTo(x - cw * 0.3, h * S.range(0.5, 0.65), x + cw * 0.45, h * S.range(0.55, 0.7), x + cw * 0.3, h * 0.74);
        g.stroke();
      }
    }
    g.globalAlpha = 0.8; g.strokeStyle = color; g.lineWidth = 3;
    for (let i = 0; i < 5; i++) { const x = R.range(20, w - 20); g.beginPath(); g.moveTo(x, h * 0.72); g.lineTo(x, h * R.range(0.78, 0.98)); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
