// Mirage original code. Brought in from a game built on Mirage, where it let the game run before its art existed.
// ---------------------------------------------------------------------------
// Placeholder sprite atlases drawn in code, in the exact atlas format (docs/sprites-25d.md): a game runs before its
// art exists, and the real art replaces a placeholder by adding two files. Each figure is a plain shape with a
// chevron on its chest pointing where it faces on screen (dir 0 = toward the viewer), so the direction convention
// can be checked by eye. Layout: one row per (animation, drawn direction), one column per frame.
//
//   const { json, canvas } = makePlaceholderAtlas({ id: 'hero', shape: 'humanoid', dirs: 5, body: '#3f6fb5' });
//   const atlas = makeAtlas(json, canvas);            // sprites.js
// Shapes: 'humanoid', 'blob' (one direction is enough), 'bird', 'crab', 'item' (one frame). Animations: idle, walk,
// attack (hit on frame 2), hurt, die. Needs a 2D canvas: `canvas(w, h)` makes one (default: OffscreenCanvas, else
// a DOM canvas).
// ---------------------------------------------------------------------------

const ANIMS = {
  idle: { fps: 4, loop: true, n: 2 },
  walk: { fps: 8, loop: true, n: 4 },
  attack: { fps: 10, loop: false, n: 4, hit: 2 },
  hurt: { fps: 8, loop: false, n: 2 },
  die: { fps: 6, loop: false, n: 4 },
};

const SHAPES = {
  humanoid: { cell: [128, 192], feet: [64, 184], height: 1.75, dirs: 5 },
  blob: { cell: [96, 112], feet: [48, 106], height: 0.8, dirs: 1 },
  bird: { cell: [112, 128], feet: [56, 122], height: 1.1, dirs: 5 },
  crab: { cell: [128, 112], feet: [64, 104], height: 0.85, dirs: 5 },
  item: { cell: [64, 64], feet: [32, 58], height: 0.5, dirs: 1, anims: ['idle'] },
};

/** a stable colour for a string */
function hashColor(s, sat = 55, light = 52) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return `hsl(${(h >>> 0) % 360}, ${sat}%, ${light}%)`;
}

function newCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  throw new Error('makePlaceholderAtlas: no canvas here; pass { canvas: (w, h) => ... }');
}

/**
 * { json, canvas }: a placeholder atlas for `spec` ({ id, shape, cell, feet, height, dirs, anims, body, trim, skin,
 * hair, weapon }; everything but `shape` has a default, colours are CSS colours).
 */
export function makePlaceholderAtlas(spec = {}, { canvas: make = newCanvas } = {}) {
  const shape = SHAPES[spec.shape] ? spec.shape : 'humanoid', base = SHAPES[shape];
  const id = spec.id ?? shape;
  const s = {
    body: hashColor(id), trim: '#2e2a33', skin: '#f2c9a0', hair: '#5a3a2a', weapon: null,
    ...base, ...spec, shape,
  };
  const [cw, ch] = s.cell, D = s.dirs;
  const names = (s.anims || base.anims || Object.keys(ANIMS)).filter((a) => ANIMS[a]);
  const frameCount = (name) => (shape === 'item' ? 1 : ANIMS[name].n);
  const cols = Math.max(...names.map(frameCount));
  const canvas = make(cols * cw, names.length * D * ch);
  const g = canvas.getContext('2d');
  const anims = {};
  names.forEach((name, ai) => {
    const A = ANIMS[name], n = frameCount(name);
    const frames = [];
    for (let d = 0; d < D; d++) {
      const list = [];
      for (let f = 0; f < n; f++) {
        const x = f * cw, y = (ai * D + d) * ch;
        list.push([x, y]);
        g.save(); g.beginPath(); g.rect(x, y, cw, ch); g.clip();
        g.translate(x, y);
        draw(g, s, name, d, n > 1 ? f / (n - 1) : 0, f);
        g.restore();
      }
      frames.push(list);
    }
    anims[name] = { fps: A.fps, loop: A.loop, frames, ...(A.hit != null && n > A.hit ? { hit: A.hit } : {}) };
  });
  const json = { id, cell: [cw, ch], feet: s.feet, height: s.height, dirs: D, anims, placeholder: true };
  return { json, canvas };
}

// screen vector of a drawn direction: 0 = toward the viewer (down), 2 = right, 4 = away (up)
const dirVec = (d, D) => (D === 1 ? [0, 1] : [Math.sin((d * Math.PI) / 4), Math.cos((d * Math.PI) / 4)]);

function chevron(g, cx, cy, v, s, color) {
  g.save(); g.translate(cx, cy); g.rotate(Math.atan2(v[1], v[0]) - Math.PI / 2);
  g.beginPath(); g.moveTo(-s, -s * 0.4); g.lineTo(0, s * 0.6); g.lineTo(s, -s * 0.4); g.lineTo(0, 0); g.closePath();
  g.fillStyle = color; g.fill(); g.restore();
}
function ellipse(g, x, y, rx, ry, fill, stroke) {
  g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 3; g.stroke(); }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

function draw(g, s, anim, d, p, f) {
  const [cw, ch] = s.cell, [fx, fy] = s.feet;
  const v = dirVec(d, s.dirs);
  g.lineJoin = g.lineCap = 'round';
  // die: tip over round the feet and sink; hurt: recoil
  if (anim === 'die') { g.translate(fx, fy); g.rotate((v[0] >= 0 ? -1 : 1) * p * 1.25); g.globalAlpha = 1 - p * 0.35; g.translate(-fx, -fy + p * ch * 0.05); }
  if (anim === 'hurt') g.translate(-v[0] * 6, -4 + v[1] * 2);
  if (s.shape === 'humanoid') humanoid(g, s, anim, v, p, f, fx, fy, ch);
  else if (s.shape === 'blob') blob(g, s, anim, p, f, cw, fx, fy);
  else if (s.shape === 'crab') crab(g, s, anim, v, p, cw, ch, fx, fy, f);
  else if (s.shape === 'item') item(g, s, cw, fx, fy);
  else bird(g, s, anim, v, p, f, ch, fx, fy);
  if (anim === 'hurt' && f === 0) {
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,60,40,0.45)'; g.fillRect(0, 0, cw, ch); g.globalCompositeOperation = 'source-over';
  }
}

function humanoid(g, s, anim, v, p, f, fx, fy, ch) {
  const H = ch * 0.86, side = Math.abs(v[0]), back = v[1] < -0.2;
  const bob = anim === 'idle' ? f * 2 : anim === 'walk' ? (f % 2) * 3 : 0;
  const hip = fy - H * 0.46 + bob, sh = fy - H * 0.78 + bob, head = fy - H * 0.89 + bob, hr = H * 0.1;
  const halfW = H * (0.16 - 0.05 * side);
  // legs: apart seen from the front, one before the other seen from the side
  const stride = anim === 'walk' ? Math.sin((f / 4) * Math.PI * 2) : 0;
  g.strokeStyle = '#3a3340'; g.lineWidth = H * 0.075;
  for (const k of [-1, 1]) {
    const sx = fx + k * halfW * 0.5 * (1 - side) + side * k * stride * H * 0.12 * Math.sign(v[0] || 1);
    const lift = (1 - side) * Math.max(0, k * stride) * H * 0.05;
    g.beginPath(); g.moveTo(fx + k * halfW * 0.45 * (1 - side), hip); g.lineTo(sx, fy - 4 - lift); g.stroke();
  }
  // the arm (and what it holds) behind the body when facing away
  const swing = anim === 'attack' ? (p < 0.5 ? -0.9 + p * 0.6 : -0.6 + (p - 0.5) * 4.2) : anim === 'walk' ? stride * 0.4 : 0.15;
  const handSide = v[0] >= 0 ? 1 : -1;
  const shoulder = [fx + handSide * halfW * (1 - side * 0.6), sh + H * 0.04];
  const armLen = H * 0.3, ang = Math.PI / 2 - swing * handSide;
  const hand = [shoulder[0] + Math.cos(ang) * armLen * handSide * (side ? 0.7 : 0.35) + v[0] * armLen * 0.5 * Math.sin(swing), shoulder[1] + Math.sin(ang) * armLen];
  const held = () => {
    if (!s.weapon) return;
    const wa = -Math.PI / 2 - swing * 1.4 * handSide;
    g.strokeStyle = s.weapon; g.lineWidth = H * 0.035;
    g.beginPath(); g.moveTo(hand[0], hand[1]); g.lineTo(hand[0] + Math.cos(wa) * H * 0.42 * handSide, hand[1] + Math.sin(wa) * H * 0.42); g.stroke();
  };
  const arm = () => { g.strokeStyle = s.body; g.lineWidth = H * 0.07; g.beginPath(); g.moveTo(...shoulder); g.lineTo(...hand); g.stroke(); ellipse(g, hand[0], hand[1], H * 0.035, H * 0.035, s.skin); };
  if (back) { held(); arm(); }
  g.fillStyle = s.body; roundRect(g, fx - halfW, sh, halfW * 2, hip - sh + H * 0.06, H * 0.06); g.fill();
  g.fillStyle = s.trim; g.fillRect(fx - halfW, hip - H * 0.03, halfW * 2, H * 0.045);   // belt
  // a cape seen from behind, the chevron on the chest otherwise (pointing where the figure faces on screen)
  if (back) { g.fillStyle = s.trim; g.globalAlpha *= 0.85; roundRect(g, fx - halfW * 0.8, sh + 2, halfW * 1.6, (hip - sh) * 0.95, 6); g.fill(); g.globalAlpha /= 0.85; }
  else chevron(g, fx + v[0] * halfW * 0.4, (sh + hip) / 2, v, H * 0.07, s.trim);
  ellipse(g, fx, head, hr, hr * 1.05, back ? s.hair : s.skin);
  if (!back) {
    g.fillStyle = s.hair; g.beginPath(); g.ellipse(fx - v[0] * hr * 0.3, head - hr * 0.35, hr * 1.02, hr * 0.7, 0, Math.PI, Math.PI * 2); g.fill();
    const ex = v[0] * hr * 0.55;
    if (side < 0.9) ellipse(g, fx + ex - hr * 0.35 * (1 - side), head + hr * 0.1, hr * 0.12, hr * 0.16, '#1d1b22');
    ellipse(g, fx + ex + hr * 0.35 * (1 - side), head + hr * 0.1, hr * 0.12, hr * 0.16, '#1d1b22');
    arm(); held();
  }
}

function blob(g, s, anim, p, f, cw, fx, fy) {
  let sx = 1, sy = 1, dy = 0;
  if (anim === 'idle') { sy = 1 - f * 0.06; sx = 1 + f * 0.05; }
  if (anim === 'walk') { const k = Math.sin((f / 4) * Math.PI * 2); sy = 1 + k * 0.12; sx = 1 - k * 0.08; dy = Math.max(0, k) * 8; }
  if (anim === 'attack') { const k = p < 0.6 ? -p : (p - 0.6) * 3; sy = 1 + k * 0.4; sx = 1 - k * 0.2; dy = Math.max(0, k) * 10; }
  if (anim === 'die') { sy = 1 - p * 0.6; sx = 1 + p * 0.4; }
  const r = cw * 0.38, cy = fy - r * sy - dy;
  ellipse(g, fx, cy, r * sx, r * sy, s.body, s.trim);
  ellipse(g, fx - r * 0.3 * sx, cy - r * 0.35 * sy, r * 0.25, r * 0.12, 'rgba(255,255,255,0.35)');
  g.fillStyle = s.trim; g.beginPath(); g.ellipse(fx + 6, cy - r * sy - 4, 10, 4, -0.5, 0, Math.PI * 2); g.fill();
  for (const k of [-1, 1]) ellipse(g, fx + k * r * 0.3 * sx, cy - r * 0.05, 5, anim === 'die' ? 1.5 : 7, '#1d1b22');
}

function bird(g, s, anim, v, p, f, ch, fx, fy) {
  const H = ch * 0.85, side = Math.abs(v[0]), back = v[1] < -0.2;
  const hop = anim === 'walk' ? Math.abs(Math.sin((f / 4) * Math.PI * 2)) * 8 : anim === 'idle' ? f * 2 : 0;
  const lunge = anim === 'attack' ? (p < 0.5 ? -p * 0.3 : (p - 0.5) * 1.4) : 0;
  const by = fy - H * 0.42 - hop, br = H * 0.3;
  g.strokeStyle = s.trim; g.lineWidth = 4;
  for (const k of [-1, 1]) { g.beginPath(); g.moveTo(fx + k * br * 0.3 * (1 - side * 0.7), by + br * 0.6); g.lineTo(fx + k * br * 0.35 * (1 - side * 0.7), fy - 3); g.stroke(); }
  g.fillStyle = s.trim; g.beginPath(); g.moveTo(fx - v[0] * br * 0.6, by - v[1] * br * 0.2); g.lineTo(fx - v[0] * br * 1.5, by - br * 0.6 - v[1] * br * 0.4); g.lineTo(fx - v[0] * br * 1.2, by - br * 0.1); g.fill();
  ellipse(g, fx, by, br * (1 - side * 0.15), br * 0.95, s.body, s.trim);
  const hx = fx + v[0] * br * (0.55 + lunge), hy = by - br * 0.85 + v[1] * br * 0.15 + lunge * br * 0.4, hr = br * 0.5;
  ellipse(g, hx, hy, hr, hr, s.body, s.trim);
  g.fillStyle = s.trim;
  for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(hx + i * 7 - 4, hy - hr * 0.8); g.lineTo(hx + i * 9 - v[0] * 6, hy - hr * 1.6); g.lineTo(hx + i * 7 + 4, hy - hr * 0.8); g.fill(); }
  if (!back) {
    g.fillStyle = '#f2d23a';
    g.beginPath(); g.moveTo(hx + v[0] * hr * 0.6 - 7, hy + hr * 0.1); g.lineTo(hx + v[0] * hr * 1.7, hy + hr * 0.25 + v[1] * hr * 0.5); g.lineTo(hx + v[0] * hr * 0.6 + 7, hy + hr * 0.35); g.fill();
    ellipse(g, hx + v[0] * hr * 0.3 - (1 - side) * hr * 0.35, hy - hr * 0.15, 4, 5, '#1d1b22');
    if (side < 0.9) ellipse(g, hx + v[0] * hr * 0.3 + (1 - side) * hr * 0.35, hy - hr * 0.15, 4, 5, '#1d1b22');
    chevron(g, fx + v[0] * br * 0.3, by + br * 0.25, v, 9, s.trim);
  }
}

function crab(g, s, anim, v, p, cw, ch, fx, fy, f) {
  const H = ch * 0.8, side = Math.abs(v[0]), back = v[1] < -0.2;
  const step = anim === 'walk' ? Math.sin((f / 4) * Math.PI * 2) : 0;
  const snap = anim === 'attack' ? (p < 0.5 ? 0.2 : 1) : 0.4 + (anim === 'idle' ? f * 0.1 : 0);
  const by = fy - H * 0.38, rx = cw * 0.34 * (1 - side * 0.3), ry = H * 0.27;
  g.strokeStyle = s.trim; g.lineWidth = 4;
  for (let i = 0; i < 3; i++) for (const k of [-1, 1]) {
    const lx = fx + k * rx * (0.5 + i * 0.2);
    g.beginPath(); g.moveTo(lx, by + ry * 0.4); g.lineTo(lx + k * 12, fy - 2 - (i % 2 ? step : -step) * 4); g.stroke();
  }
  ellipse(g, fx, by, rx, ry, s.body, s.trim);
  for (const k of [-1, 1]) {
    if (back && side < 0.5) continue;
    const cx = fx + k * rx * 0.9 * (1 - side) + v[0] * rx * 0.9, cy = by - ry * 0.3 + v[1] * ry * 0.5 - (anim === 'attack' && p >= 0.5 ? 10 : 0);
    ellipse(g, cx, cy, 13, 10, s.body, s.trim);
    g.strokeStyle = s.trim; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + v[0] * 10 + k * 6 * snap, cy + v[1] * 8 - 6 * snap); g.stroke();
  }
  if (!back) {
    for (const k of [-1, 1]) {
      if (side > 0.9 && k !== Math.sign(v[0])) continue;
      const ex = fx + v[0] * rx * 0.4 + k * 9 * (1 - side * 0.5);
      g.strokeStyle = s.trim; g.lineWidth = 3; g.beginPath(); g.moveTo(ex, by - ry * 0.6); g.lineTo(ex, by - ry - 8); g.stroke();
      ellipse(g, ex, by - ry - 10, 5, 5, '#f4f1e8', '#1d1b22');
    }
    chevron(g, fx + v[0] * rx * 0.3, by + ry * 0.2, v, 10, s.trim);
  } else ellipse(g, fx, by - ry * 0.2, rx * 0.6, ry * 0.5, null, s.trim);
}

function item(g, s, cw, fx, fy) {
  const r = cw * 0.3, cy = fy - r - 6;
  ellipse(g, fx, cy, r, r, s.body, s.trim);
  ellipse(g, fx - r * 0.35, cy - r * 0.35, r * 0.3, r * 0.18, 'rgba(255,255,255,0.55)');
}
