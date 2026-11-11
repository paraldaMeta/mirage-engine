// machines: the district's civilian robots, for streetlife.js (not a module itself). Service machines in soft liveries
// (off-white, mint, peach, butter, sky, lilac), round shells, dark joints, a face screen with glyph eyes that change
// slowly, a lit ID band: nothing like the sentinels (black armour, slit visors, rifles).
//   android   a slim biped: egg torso, a capsule head (a face screen, ear discs, an antenna with a lit bead), arms in two
//             pieces; some carry an umbrella with a lit rim, some wear a rain hat plate
//   vendor    an upper body on a ceiling rail (the yakitori container) or a pedestal (the noodle cart), an apron panel
//   courier   a wheeled parcel carrier: a low shell, a lit parcel box, a whip mast with a pennant
//   sweeper   low and wide, two spinning side brushes, a turning amber beacon, a wet-floor sign on its back
//   totem     a queue / notice post: a thin column, a screen head paging through notices (English, 繁中, kana), an arm
//   broken    an android slumped against a wall, grimy, one eye flickering
// Every part is an instance of one of three THREE.BatchedMesh: the shells (lit, one canvas atlas for printed decals),
// the lights (faces, bands, rims, beacons: unlit, the same atlas) and the umbrella canopies (translucent). Parts move
// by their instance matrices, faces change by swapping the instance's geometry: three draws for every machine.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const FONT = '"PingFang TC", "Hiragino Sans", "Noto Sans TC", "Noto Sans JP", "Microsoft JhengHei", system-ui, sans-serif';

// ---------------------------------------------------------------------------------------------------------------
// the atlas: printed decals (on the shells) and lit glyphs (faces, notices) in one 1024 canvas
const AT = 1024, RECT = { white: [0, 0, 32, 32] };
export const FACES = ['neutral', 'happy', 'blink', 'curious', 'talk', 'smile', 'sleepy', 'broken', 'star', 'note'];
FACES.forEach((k, i) => { RECT['face_' + k] = [32 + 192 * (i % 5), 32 + 128 * Math.floor(i / 5), 192, 128]; });
for (let i = 0; i < 4; i++) RECT['page' + i] = [256 * i, 288, 256, 352];
for (let i = 0; i < 4; i++) RECT['id' + i] = [128 * i, 640, 128, 64];
Object.assign(RECT, { broken: [512, 640, 128, 64], parcelGlow: [640, 640, 256, 128], apron0: [0, 704, 192, 256], apron1: [192, 704, 192, 256], wet: [384, 704, 192, 256], parcel: [576, 768, 256, 128] });
/** [u0, v0, u1, v1] of an atlas cell, inset so mip levels do not bleed in from the neighbours */
const uvOf = (k, inset = 3) => { const [x, y, w, h] = RECT[k]; return [(x + inset) / AT, 1 - (y + h - inset) / AT, (x + w - inset) / AT, 1 - (y + inset) / AT]; };

function drawAtlas() {
  const c = document.createElement('canvas'); c.width = c.height = AT;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, AT, AT);
  g.fillStyle = '#fff'; g.fillRect(...RECT.white);
  const cell = (k, fn) => { const [x, y, w, h] = RECT[k]; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); fn(w, h); g.restore(); };
  const text = (s, x, y, size, color, { weight = 800, max = 0, align = 'center' } = {}) => {
    g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
    if (max) { const m = g.measureText(s).width; if (m > max) g.font = `${weight} ${size * max / m}px ${FONT}`; }
    g.fillText(s, x, y);
  };
  const pill = (x, y, w, h) => { g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2); g.fill(); };
  const barcode = (x, y, w, h, seed) => { let s = seed; for (let i = 0; i < w;) { s = (s * 16807) % 2147483647; const bw = 1 + (s % 3); if ((s >> 3) % 2) g.fillRect(x + i, y, bw, h); i += bw + 1; } };
  // ---- faces: white glyphs on a dark screen (tinted per machine), soft glow, faint scan lines
  const face = (k, draw) => cell('face_' + k, (w, h) => {
    g.fillStyle = '#05080c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 10;
    draw(w, h, w * 0.31, w * 0.69, h * 0.46);
    g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let yy = 0; yy < h; yy += 4) g.fillRect(0, yy, w, 1.5);
  });
  const arc = (x, y, r, a0, a1, lw) => { g.lineWidth = lw; g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
  face('neutral', (w, h, l, r, y) => { pill(l, y, 24, 40); pill(r, y, 24, 40); });
  face('happy', (w, h, l, r, y) => { arc(l, y + 10, 18, Math.PI * 1.1, Math.PI * 1.9, 9); arc(r, y + 10, 18, Math.PI * 1.1, Math.PI * 1.9, 9); });
  face('blink', (w, h, l, r, y) => { g.lineWidth = 8; for (const x of [l, r]) { g.beginPath(); g.moveTo(x - 17, y + 4); g.lineTo(x + 17, y + 4); g.stroke(); } });
  face('curious', (w, h, l, r, y) => { g.beginPath(); g.arc(l, y, 15, 0, 7); g.fill(); arc(r, y - 2, 19, 0, 7, 7); g.beginPath(); g.arc(r, y - 2, 6, 0, 7); g.fill(); });
  face('talk', (w, h, l, r, y) => { pill(l, y - 6, 22, 34); pill(r, y - 6, 22, 34); pill(w / 2, h * 0.8, 34, 12); });
  face('smile', (w, h, l, r, y) => { pill(l, y - 8, 22, 32); pill(r, y - 8, 22, 32); arc(w / 2, h * 0.58, 24, Math.PI * 0.2, Math.PI * 0.8, 7); });
  face('sleepy', (w, h, l, r, y) => { arc(l, y - 4, 17, Math.PI * 0.12, Math.PI * 0.88, 7); arc(r, y - 4, 17, Math.PI * 0.12, Math.PI * 0.88, 7); text('z', w * 0.88, h * 0.22, 26, '#fff'); });
  face('broken', (w, h, l, r, y) => {
    g.lineWidth = 8; g.beginPath(); g.moveTo(l - 14, y - 14); g.lineTo(l + 14, y + 14); g.moveTo(l + 14, y - 14); g.lineTo(l - 14, y + 14); g.stroke();
    g.globalAlpha = 0.45; g.beginPath(); g.arc(r, y, 10, 0, 7); g.fill(); g.globalAlpha = 0.35;
    for (let i = 0; i < 5; i++) g.fillRect(10 + (i * 37) % (w - 60), 14 + i * 21, 30 + (i * 13) % 40, 4);
    g.globalAlpha = 1;
  });
  face('star', (w, h, l, r, y) => { for (const x of [l, r]) { g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? 7 : 21; g.lineTo(x + Math.sin(a) * rr, y + Math.cos(a) * rr); } g.closePath(); g.fill(); } });
  face('note', (w, h, l, r, y) => { arc(l, y + 10, 17, Math.PI * 1.1, Math.PI * 1.9, 8); arc(r, y + 10, 17, Math.PI * 1.1, Math.PI * 1.9, 8); text('♪', w * 0.86, h * 0.24, 34, '#fff'); });
  // ---- notices for the queue totem (invented)
  const page = (i, head, headInk, draw) => cell('page' + i, (w, h) => {
    g.fillStyle = '#071219'; g.fillRect(0, 0, w, h);
    g.fillStyle = head; g.fillRect(0, 0, w, 54);
    text(headInk[0], w / 2, 28, 26, headInk[1], { weight: 900, max: w - 20 });
    draw(w, h);
    g.fillStyle = 'rgba(0,0,0,0.3)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  });
  page(0, '#2fe0c5', ['義體診所 · CLINIC 24', '#05202a'], (w, h) => {
    text('診療中', w / 2, 112, 62, '#ffffff', { weight: 900 }); text('OPEN', w / 2, 170, 44, '#5ff7ff', { weight: 900 });
    text('どうぞ お入りください', w / 2, 214, 22, '#cfeff2', { max: w - 24 });
    text('義肢保養 ¥980 / 30分', w / 2, 256, 22, '#ffd27a', { max: w - 24 });
    g.fillStyle = '#ffb347'; g.fillRect(16, 292, w - 32, 40); text('NO. 047 → 窓口 2', w / 2, 312, 24, '#1a0d00', { weight: 900, max: w - 40 });
  });
  page(1, '#ffb347', ['PLEASE QUEUE', '#221000'], (w, h) => {
    text('請排隊', w / 2, 110, 60, '#fff', { weight: 900 }); text('順番にお並びください', w / 2, 160, 22, '#ffe2b8', { max: w - 24 });
    g.fillStyle = '#ffb347';
    for (let k = 0; k < 3; k++) { const x = 52 + k * 58; g.beginPath(); g.arc(x, 222, 15, 0, 7); g.fill(); g.beginPath(); g.roundRect(x - 17, 242, 34, 44, 10); g.fill(); }
    g.beginPath(); g.moveTo(206, 236); g.lineTo(238, 262); g.lineTo(206, 288); g.fill();
    text('NEXT  048', w / 2, 320, 26, '#5ff7ff', { weight: 900 });
  });
  page(2, '#ffd23a', ['注意 CAUTION', '#111'], (w, h) => {
    g.strokeStyle = '#ffd23a'; g.fillStyle = '#ffd23a'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w / 2, 76); g.lineTo(w / 2 + 62, 186); g.lineTo(w / 2 - 62, 186); g.closePath(); g.stroke();
    g.beginPath(); g.arc(w / 2 + 6, 114, 9, 0, 7); g.fill();
    g.lineWidth = 7; g.beginPath(); g.moveTo(w / 2 + 2, 126); g.lineTo(w / 2 - 10, 152); g.lineTo(w / 2 + 14, 168); g.moveTo(w / 2 - 10, 152); g.lineTo(w / 2 - 30, 170); g.stroke();
    text('小心地滑', w / 2, 224, 44, '#fff', { weight: 900 }); text('MIND THE WET FLOOR', w / 2, 266, 22, '#ffd23a', { weight: 900, max: w - 24 });
    text('足元にご注意ください', w / 2, 304, 20, '#e8e8e8', { max: w - 24 });
  });
  page(3, '#ff7fb0', ['歡迎光臨', '#2a0614'], (w, h) => {
    g.strokeStyle = '#5ff7ff'; g.lineWidth = 12; g.lineCap = 'round';
    for (const x of [w * 0.33, w * 0.67]) { g.beginPath(); g.arc(x, 140, 26, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    g.beginPath(); g.arc(w / 2, 150, 46, Math.PI * 0.25, Math.PI * 0.75); g.stroke();
    text('WELCOME', w / 2, 240, 40, '#fff', { weight: 900 }); text('いらっしゃいませ', w / 2, 284, 24, '#ffd0e4', { max: w - 24 });
    text('雨天傘架 → 左', w / 2, 322, 20, '#9fe8ff', { max: w - 24 });
  });
  // ---- printed decals: ID labels, an out-of-order sticker, aprons, the wet-floor sign, parcel labels
  [['SV-0417', '#2fd1c5'], ['GD-0031', '#ff8a2a'], ['DL-2207', '#ff4f6d'], ['CL-0815', '#ffd23a']].forEach(([s, col], i) => cell('id' + i, (w, h) => {
    g.fillStyle = '#f1efe9'; g.fillRect(0, 0, w, h); g.fillStyle = col; g.fillRect(0, 0, 14, h);
    text(s, 72, 20, 22, '#16181c', { weight: 900, max: w - 30 }); g.fillStyle = '#16181c'; barcode(22, 36, w - 32, 20, 97 + i * 31);
  }));
  cell('broken', (w, h) => {
    g.fillStyle = '#ffd23a'; g.fillRect(0, 0, w, h); g.fillStyle = '#111';
    for (let x = -h; x < w; x += 22) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 11, h); g.lineTo(x + 11 + h, 0); g.lineTo(x + h, 0); g.fill(); }
    g.fillStyle = '#f4f0e6'; g.fillRect(14, 12, w - 28, h - 24); text('故障 OUT OF ORDER', w / 2, h / 2, 16, '#a01010', { weight: 900, max: w - 34 });
  });
  for (const [k, bg, ink, big, small] of [['apron0', '#f4b39a', '#6e1a10', '焼鳥', 'YAKITORI · 07'], ['apron1', '#a8dcc8', '#0f3a32', '牛肉麵', 'NOODLE · 24']]) cell(k, (w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = ink;
    for (let x = 0; x < w; x += 24) g.fillRect(x, 0, 12, 22);
    text(big, w / 2, h * 0.47, 58, ink, { weight: 900, max: w - 24 }); text(small, w / 2, h * 0.75, 20, ink, { weight: 800, max: w - 24 });
    g.globalAlpha = 0.18; g.fillStyle = '#000'; for (let i = 0; i < 9; i++) g.fillRect(20 + i * 17, h * 0.85 + (i % 3) * 7, 8, 18); g.globalAlpha = 1;   // sauce spots
  });
  cell('wet', (w, h) => {
    g.fillStyle = '#ffd23a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#111'; g.beginPath(); g.arc(w / 2 + 14, 52, 13, 0, 7); g.fill();
    g.lineWidth = 11; g.lineCap = 'round'; g.beginPath(); g.moveTo(w / 2 + 8, 70); g.lineTo(w / 2 - 10, 110); g.lineTo(w / 2 + 26, 134); g.moveTo(w / 2 - 10, 110); g.lineTo(w / 2 - 40, 132); g.moveTo(w / 2 + 4, 84); g.lineTo(w / 2 + 40, 92); g.stroke();
    g.lineWidth = 5; g.beginPath(); g.moveTo(30, 150); g.quadraticCurveTo(w / 2, 140, w - 30, 150); g.stroke();
    text('小心地滑', w / 2, 184, 34, '#111', { weight: 900, max: w - 30 }); text('濡れた床', w / 2, 214, 22, '#111', { weight: 800 }); text('WET FLOOR', w / 2, 238, 20, '#111', { weight: 900 });
  });
  cell('parcel', (w, h) => {
    g.fillStyle = '#efece4'; g.fillRect(0, 0, w, h); g.fillStyle = '#2fb9a5'; g.fillRect(0, 0, w, 18); g.fillRect(0, h - 10, w, 10);
    text('速達 EXPRESS', 98, 44, 26, '#14181c', { weight: 900, max: 170 }); text('便 07-B · 2F', 98, 74, 18, '#14181c', { max: 170 });
    g.fillStyle = '#14181c'; barcode(14, 88, 150, 26, 4711); g.font = `900 64px ${FONT}`; g.textAlign = 'center'; g.fillText('↑', 214, 70);
  });
  cell('parcelGlow', (w, h) => { g.fillStyle = '#04070a'; g.fillRect(0, 0, w, h); g.shadowColor = '#fff'; g.shadowBlur = 12; text('速達', w / 2, h * 0.4, 52, '#fff', { weight: 900 }); text('EXPRESS', w / 2, h * 0.8, 24, '#fff', { weight: 900 }); g.shadowBlur = 0; });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// parts: non-indexed geometries with position, normal, uv and colour (one layout for every geometry of a batch)
const KEEP = ['position', 'normal', 'uv', 'color'];
function std(g, color = null, uv = 'white') {
  if (g.index) g = g.toNonIndexed();
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.color) { const a = new Float32Array(n * 3), c = color || WHITE; for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], 3 * i); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
  if (uv) { const r = uvOf(uv, 8), a = new Float32Array(n * 2); for (let i = 0; i < n; i++) a.set([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], 2 * i); g.setAttribute('uv', new THREE.BufferAttribute(a, 2)); }
  for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
  return g;
}
const WHITE = new THREE.Color(1, 1, 1);
const merge = (list) => { const out = new THREE.BufferGeometry(), n = list.reduce((s, g) => s + g.attributes.position.count, 0);
  for (const [k, w] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) { const a = new Float32Array(n * w); let o = 0; for (const g of list) { a.set(g.attributes[k].array, o); o += g.attributes[k].array.length; } out.setAttribute(k, new THREE.BufferAttribute(a, w)); }
  return out; };
/** a turned shell: pts [r, y, colour key] round the y axis; pal maps keys to colours; scaled (sx, sz) into an oval */
function lathe(pts, seg, pal, sx = 1, sz = 1) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) { const c = pal[pts[v % pts.length][2] || 's']; col.set([c.r, c.g, c.b], 3 * v); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  return std(g);
}
const tf = (g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
const ball = (r, c, p, s = [1, 1, 1], w = 6, h = 4) => tf(std(new THREE.SphereGeometry(r, w, h), c), p, [0, 0, 0], s);
const rod = (r0, r1, len, c, p, rot = [0, 0, 0], seg = 6, open = true) => tf(std(new THREE.CylinderGeometry(r1, r0, len, seg, 1, open), c), p, rot);
/** a decal / screen: a w x h plane facing +z showing atlas cell `key` */
function quad(w, h, key, c = WHITE) {
  const g = new THREE.PlaneGeometry(w, h), r = uvOf(key), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  return std(g, c, null);
}
/** a screen bent round the y axis (radius r, +-phi either side of +z) from y0 to y1, showing atlas cell `key` */
function bent(r, y0, y1, phi, key, seg = 4, chamfer = 0.22) {
  const R = uvOf(key), pos = [], nor = [], uv = [];
  const v = (i, j) => {   // the two outer columns are shorter: the screen's corners are cut
    const a = -phi + 2 * phi * i / seg, c = i === 0 || i === seg ? chamfer : 0, f = j ? 1 - c : c;
    pos.push(r * Math.sin(a), y0 + (y1 - y0) * f, r * Math.cos(a)); nor.push(Math.sin(a), 0, Math.cos(a)); uv.push(R[0] + (R[2] - R[0]) * i / seg, R[1] + (R[3] - R[1]) * f);
  };
  for (let i = 0; i < seg; i++) { v(i, 0); v(i + 1, 0); v(i + 1, 1); v(i, 0); v(i + 1, 1); v(i, 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return std(g, WHITE, null);
}
const rgb = (hex) => new THREE.Color(hex);
const JOINT = new THREE.Color(0.045, 0.047, 0.052), TRIM = new THREE.Color(0.3, 0.31, 0.33);
const palette = (s) => ({ s, j: JOINT, t: TRIM, w: WHITE, k: new THREE.Color(0.012, 0.012, 0.014) });

// ---- the android: feet at the origin, facing +z, 1.75 m to the antenna's bead. Dark mechanical struts for the thighs
//      and upper arms, coloured shells over the shins (boots), forearms (gauntlets), shoulders, chest and the head.
//      Pivots: hips (+-0.09, 0.82), shoulders (+-0.235, 1.33), elbows 0.26 under them, the neck (0, 1.43)
const ANDROID = { hip: 0.82, hipX: 0.09, shoulder: [0.235, 1.33], elbow: 0.26, neck: 1.43, hand: 0.25 };
const HEAD_X = 1.18;
export function androidParts(lod) {
  if (lod === 2) return androidFar();
  const P = palette(WHITE), hemi = (r, w) => std(new THREE.SphereGeometry(r, w, 2, 0, Math.PI * 2, 0, Math.PI / 2));
  const torso = (sticker) => merge(lod ? [
    lathe([[0, 0.78, 'j'], [0.14, 0.84], [0.2, 1.12], [0.15, 1.38], [0, 1.455, 'j']], 5, P, 1, 0.78),
    tf(std(new THREE.BoxGeometry(0.24, 0.28, 0.1), TRIM), [0, 1.17, -0.19]),
  ] : [
    lathe([[0, 0.78, 'j'], [0.145, 0.82], [0.138, 0.9], [0.09, 0.93, 'j'], [0.09, 0.97, 'j'], [0.155, 0.995], [0.2, 1.12], [0.192, 1.27], [0.14, 1.37], [0.04, 1.42, 'j'], [0, 1.455, 'j']], 7, P, 1, 0.78),
    tf(std(new THREE.BoxGeometry(0.26, 0.3, 0.12), TRIM), [0, 1.17, -0.185]),                                         // the battery pack
    ...[-1, 1].map((s) => tf(hemi(0.088, 6), [s * 0.205, 1.335, 0], [0, 0, -s * 0.42], [1, 0.8, 1])),               // shoulder caps
    tf(quad(0.11, 0.055, sticker), [0.07, 1.2, 0.153], [-0.03, 0.36, 0]),
  ]);
  const leg = merge(lod ? [
    lathe([[0, 0.02, 'j'], [0.035, -0.02, 'j'], [0.035, -0.34, 'j'], [0.09, -0.76], [0, -0.82, 'j']], 4, P),
  ] : [
    rod(0.033, 0.03, 0.36, JOINT, [0, -0.17, 0], [0, 0, 0], 5),
    ball(0.048, JOINT, [0, -0.37, 0], [1, 1, 1], 5, 3),
    lathe([[0, -0.34, 'j'], [0.055, -0.38], [0.066, -0.5], [0.085, -0.7], [0.088, -0.775, 'j'], [0, -0.78, 'j']], 6, P),
    ball(0.08, JOINT, [0, -0.79, 0.035], [0.9, 0.42, 1.45], 6, 3),
  ]);
  const upper = lod ? rod(0.03, 0.03, 0.26, JOINT, [0, -0.13, 0], [0, 0, 0], 3) : merge([rod(0.03, 0.027, 0.24, JOINT, [0, -0.12, 0], [0, 0, 0], 5), ball(0.043, JOINT, [0, -0.255, 0], [1, 1, 1], 5, 3)]);
  const fore = lod ? lathe([[0, 0, 'j'], [0.055, -0.04], [0.05, -0.2], [0, -0.29, 'j']], 4, P) : merge([
    lathe([[0, 0.012, 'j'], [0.04, -0.004, 'j'], [0.05, -0.04], [0.06, -0.18], [0.036, -0.215, 'j'], [0, -0.22, 'j']], 6, P),
    ball(0.042, JOINT, [0, -0.255, 0.006], [0.72, 1.2, 1], 5, 3),
  ]);
  const headShell = lod ? [[0, 0, 'j'], [0.15, 0.03], [0.16, 0.2], [0, 0.278]] : [[0, -0.005, 'j'], [0.09, 0.005, 'j'], [0.145, 0.04], [0.161, 0.11], [0.157, 0.2], [0.128, 0.247], [0.07, 0.272], [0, 0.278]];
  const ear = (s) => merge([rod(0.058, 0.058, 0.05, TRIM, [s * 0.19, 0.125, -0.005], [0, 0, Math.PI / 2], 7), tf(std(new THREE.CircleGeometry(0.058, 7), TRIM), [s * 0.215, 0.125, -0.005], [0, s * Math.PI / 2, 0])]);
  const head = (hood) => merge([
    lathe(headShell, lod ? 6 : 8, P, HEAD_X, 1),
    ...(lod ? [] : [ear(-1), ear(1), rod(0.006, 0.006, 0.13, JOINT, [0.09, 0.31, -0.03], [0, 0, -0.25], 3)]),
    ...(hood ? [lathe([[0, 0.345, 's'], [0.27, 0.235, 's'], [0.28, 0.22, 'j'], [0, 0.29, 'j']], lod ? 6 : 10, P)] : []),
  ]);
  return { torso: torso('id0'), torsoB: torso('broken'), mk: torso, leg, upper, fore, head: head(false), hood: head(true) };
}
/** the android across the street (past 25 m): the same silhouette in a hundred-odd triangles */
function androidFar() {
  const P = palette(WHITE);
  const torso = lathe([[0, 0.78, 'j'], [0.15, 0.85], [0.19, 1.15], [0.13, 1.4], [0, 1.455, 'j']], 4, P, 1, 0.78);
  const head = lathe([[0, 0, 'j'], [0.16, 0.06], [0.15, 0.22], [0, 0.278]], 4, P, HEAD_X, 1);
  return { torso, torsoB: torso, leg: lathe([[0, 0, 'j'], [0.04, -0.3, 'j'], [0.085, -0.75], [0, -0.82, 'j']], 3, P), upper: rod(0.03, 0.03, 0.26, JOINT, [0, -0.13, 0], [0, 0, 0], 3),
    fore: lathe([[0, 0, 'j'], [0.055, -0.1], [0, -0.29, 'j']], 3, P), head, hood: merge([head.clone(), lathe([[0, 0.345, 's'], [0.27, 0.23, 's'], [0, 0.29, 'j']], 5, P)]) };
}
/** a face in an android head's frame: the bent screen, lit rings on the ear discs and the antenna's bead (near); the
 *  screen alone (far) */
export const androidFace = (k, lod) => merge([
  tf(bent(0.166, 0.052, 0.21, 0.72, 'face_' + k, [6, 3, 2][lod]), [0, 0, 0], [0, 0, 0], [HEAD_X, 1, 1]),
  ...(lod ? [] : [...[-1, 1].map((s) => tf(std(new THREE.RingGeometry(0.03, 0.046, 10, 1)), [s * 0.217, 0.125, -0.005], [0, s * Math.PI / 2, 0])), ball(0.018, WHITE, [0.123, 0.373, -0.03], [1, 1, 1], 4, 3)]),
]);

// ---------------------------------------------------------------------------------------------------------------
/** A batch collected before it is built: geometries and instances (with a colour), then one THREE.BatchedMesh. */
class Batch {
  constructor() { this.geos = []; this.inst = []; }
  geo(g) { this.geos.push(g); return this.geos.length - 1; }
  add(geo, color = WHITE) { this.inst.push({ geo, color: color.clone() }); return this.inst.length - 1; }
  finish(material, name) {
    const v = this.geos.reduce((s, g) => s + g.attributes.position.count, 0);
    const m = new THREE.BatchedMesh(Math.max(1, this.inst.length), Math.max(3, v), 0, material);
    const ids = this.geos.map((g) => m.addGeometry(g));
    for (const { geo, color } of this.inst) m.setColorAt(m.addInstance(ids[geo]), color);
    m.name = name; m.sortObjects = !!material.transparent; m.perObjectFrustumCulled = true; m.frustumCulled = false;
    m.castShadow = false; m.receiveShadow = false; m.userData.collide = false; m.userData.occlude = false;
    this.mesh = m;
    return m;
  }
}

const LIVERY = ['#ece8df', '#a9dcc9', '#f3c0a6', '#f2d46e', '#aac9ea', '#cdb9e6', '#f2aac0'].map(rgb);
const BAND = [[0.35, 1.0, 0.75], [1.0, 0.72, 0.38], [1.0, 0.4, 0.72], [0.4, 0.8, 1.0], [1.0, 0.9, 0.35]];
const EYES = [[0.55, 0.95, 1.0], [0.6, 1.0, 0.8], [1.0, 0.85, 0.55], [0.95, 0.95, 1.0]];
const glowC = (c, k) => new THREE.Color(c[0] * k, c[1] * k, c[2] * k);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mod = (a, n) => ((a % n) + n) % n;   // the clock can start a hair under 0 (the motion-blur shutter)

/**
 * Build the machines. `spec`: { stand: [{ x, y, z, yaw, umb }], walkers: { loop: { x0, x1, z0, z1 }, speed, n, courier },
 * stall: { m (Matrix4: the container's frame) }, cart: { m }, sweeper: { a, b, y }, totem: [x, y, z, yaw], broken: [[x, y, z, yaw]], detail }.
 * Returns { group, update(t), count, tris }.
 */
export function buildMachines(ctx, spec) {
  const { mat } = ctx, cam = ctx.camera;
  // how near a machine is drawn in full, and from where in a hundred-odd triangles: closer in at lower detail
  const det = (spec.detail ?? 1) ** 2, LN = Math.max(7, 13 * det), LF = Math.max(18, 32 * det);   // (far enough that a switch is a few pixels, not a jump)
  const atlas = drawAtlas();
  const S = new Batch(), G = new Batch(), U = new Batch();
  // ---- shared geometries (two levels of detail for the android: switched by distance)
  const A = [androidParts(0), androidParts(1), androidParts(2)];
  const gA = A.map((a) => ({ torso: S.geo(a.torso), torsoB: S.geo(a.torsoB), leg: S.geo(a.leg), upper: S.geo(a.upper), fore: S.geo(a.fore), head: S.geo(a.head), hood: S.geo(a.hood) }));
  const idTorso = [1, 2, 3].map((i) => S.geo(A[0].mk('id' + i)));
  const gFaces = [0, 1, 2].map((lod) => Object.fromEntries(FACES.map((k) => [k, G.geo(androidFace(k, lod))]))), gFace = gFaces[0];
  const gBandFar = G.geo(rod(0.176, 0.176, 0.026, WHITE, [0, 1.03, 0], [0, 0, 0], 6).scale(1, 1, 0.79));
  const gBand = G.geo(merge([rod(0.176, 0.176, 0.026, WHITE, [0, 1.03, 0], [0, 0, 0], 12).scale(1, 1, 0.79), tf(quad(0.03, 0.03, 'white'), [-0.075, 1.27, 0.148], [0, -0.4, 0]),
    ...[-0.07, 0.07].map((x) => tf(quad(0.035, 0.12, 'white'), [x, 1.17, -0.247], [0, Math.PI, 0]))]));   // the band, a status light, the pack's two lamps
  // an umbrella in the hand's frame (the shaft up from the hand): canopy, rim, shaft
  const gCanopy = U.geo(lathe([[0, 0.86], [0.3, 0.82], [0.56, 0.69], [0.57, 0.67]], 10, palette(WHITE)));
  const gRim = G.geo(std(new THREE.TorusGeometry(0.565, 0.011, 3, 12).rotateX(Math.PI / 2).translate(0, 0.675, 0)));
  const gShaft = S.geo(merge([rod(0.009, 0.009, 0.92, JOINT, [0, 0.42, 0], [0, 0, 0], 4), rod(0.016, 0.016, 0.12, JOINT, [0, -0.02, 0], [0, 0, 0], 5), ball(0.02, JOINT, [0, 0.89, 0], [1, 1, 1], 4, 3)]));

  const robots = [], m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), sc = new THREE.Vector3();
  const TR = (out, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => out.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), sc.setScalar(s));
  const set = (B, id, m) => B.mesh.setMatrixAt(id, m);

  // ---- an android: instances of every part; pose() puts them from a body frame and joint angles
  function android(o) {
    const n = robots.length, liv = o.livery ?? LIVERY[n % LIVERY.length], geoTorso = o.broken ? null : (n % 4 ? idTorso[(n % 4) - 1] : null);
    const r = { kind: 'android', o, lod: 0, faceK: 'neutral', geoTorso,
      torso: S.add(geoTorso ?? gA[0][o.broken ? 'torsoB' : 'torso'], liv), head: S.add(gA[0][o.hood ? 'hood' : 'head'], liv),
      legs: [S.add(gA[0].leg, liv), S.add(gA[0].leg, liv)], upper: [S.add(gA[0].upper, liv), S.add(gA[0].upper, liv)], fore: [S.add(gA[0].fore, liv), S.add(gA[0].fore, liv)],
      face: G.add(gFace.neutral, glowC(o.eyes ?? EYES[n % EYES.length], o.broken ? 1.6 : 2.6)), band: G.add(gBand, glowC(o.band ?? BAND[(n * 3) % BAND.length], o.broken ? 0 : 2.2)),
      eyes: glowC(o.eyes ?? EYES[n % EYES.length], 2.6), seed: hash(n + 3.7) * 100 };
    if (o.umb) { const k = n % 3; r.canopy = U.add(gCanopy, [rgb('#f2b8c8'), rgb('#b8e0f2'), rgb('#f2e2a8')][k]); r.rim = G.add(gRim, glowC([[1.0, 0.3, 0.6], [0.2, 0.85, 1.0], [1.0, 0.75, 0.3]][k], 3.2)); r.shaft = S.add(gShaft, WHITE); }
    robots.push(r);
    return r;
  }
  const tTorso = new THREE.Matrix4(), tBody = new THREE.Matrix4(), tUp = new THREE.Matrix4(), tFore = new THREE.Matrix4(), tHead = new THREE.Matrix4();
  /** B: the body frame (feet at the origin); p: { hipY, pitch, roll, bob, head: [rx, ry, rz], arms: [[ax, ay, az, elbow] x2], legs: [[rx, ry] x2] } */
  function poseAndroid(r, B, p) {
    tBody.copy(B).multiply(TR(m4, 0, (p.hipY ?? ANDROID.hip) + (p.bob || 0), 0, p.pitch || 0, p.twist || 0, p.roll || 0)).multiply(TR(m4, 0, -ANDROID.hip, 0));
    tTorso.copy(tBody);
    set(S, r.torso, tTorso); set(G, r.band, tTorso);
    const h = p.head || [0, 0, 0];
    tHead.copy(tTorso).multiply(TR(m4, 0, ANDROID.neck, 0, h[0], h[1], h[2]));
    set(S, r.head, tHead); set(G, r.face, tHead);
    for (const k of [0, 1]) {
      const s = k ? 1 : -1, a = p.arms?.[k] || [0, 0, 0.06, -0.12];
      tUp.copy(tTorso).multiply(TR(m4, s * ANDROID.shoulder[0], ANDROID.shoulder[1], 0, a[0], s * a[1], s * a[2]));
      set(S, r.upper[k], tUp);
      tFore.copy(tUp).multiply(TR(m4, 0, -ANDROID.elbow, 0, a[3], 0, 0));
      set(S, r.fore[k], tFore);
      if (k === 1 && r.canopy !== undefined) {   // the umbrella stands up out of the right hand
        v.set(0, -ANDROID.hand, 0).applyMatrix4(tFore); const hp = v.clone();
        e.setFromRotationMatrix(B, 'YXZ');
        m4.compose(hp, q.setFromEuler(e.set(0.1, e.y, -0.12, 'YXZ')), one);
        set(U, r.canopy, m4); set(G, r.rim, m4); set(S, r.shaft, m4);
      }
      const l = p.legs?.[k] || [0, 0];
      m4.copy(B).multiply(TR(m5, s * ANDROID.hipX, (p.hipY ?? ANDROID.hip) + (p.bob || 0), 0, l[0], l[1], s * 0.02));
      set(S, r.legs[k], m4);
    }
  }
  /** the slow life of a face: an expression from the robot's repertoire every few seconds, a blink now and then */
  function faceAt(r, t, rep) {
    const per = 5 + 4 * hash(r.seed), slot = Math.floor((t + r.seed) / per);
    let k = rep[Math.floor(hash(slot * 7.1 + r.seed) * rep.length)];
    if (mod(t + r.seed * 1.3, 3.9) < 0.14 && k !== 'broken') k = 'blink';
    return k;
  }
  const setFace = (r, k, force) => { if (r.faceK !== k || force) { r.faceK = k; G.mesh.setGeometryIdAt(r.face, gFaces[r.lod][k]); } };
  const setLod = (r, d) => {
    const want = d > (r.lod === 2 ? LF - 5 : LF) ? 2 : d > (r.lod ? LN - 2.5 : LN) ? 1 : 0;   // near: the full machine; with hysteresis
    if (want === r.lod) return;
    r.lod = want; const g = gA[want];
    S.mesh.setGeometryIdAt(r.torso, r.o.broken ? g.torsoB : (want || r.geoTorso === null ? g.torso : r.geoTorso));
    S.mesh.setGeometryIdAt(r.head, r.o.hood ? g.hood : g.head);
    for (const k of [0, 1]) { S.mesh.setGeometryIdAt(r.legs[k], g.leg); S.mesh.setGeometryIdAt(r.upper[k], g.upper); S.mesh.setGeometryIdAt(r.fore[k], g.fore); }
    setFace(r, r.faceK, true);
    G.mesh.setGeometryIdAt(r.band, want ? gBandFar : gBand);
  };
  /** the arms of a vendor or the totem: android arms, near or far */
  const armLod = (r, d) => {
    const want = d > (r.lod ? 10 : 12) ? 1 : 0;
    if (want === r.lod) return;
    r.lod = want;
    for (const k of [0, 1]) if (r.upper[k] !== undefined) { S.mesh.setGeometryIdAt(r.upper[k], gA[want].upper); S.mesh.setGeometryIdAt(r.fore[k], gA[want].fore); }
  };

  // ---- standing androids: pairs and threes talk (heads turn to each other, a hand gesture), the rest look about
  const stand = (spec.stand || []).map((p, i) => android({ ...p, hood: !p.umb && i % 3 === 1, livery: LIVERY[(i * 5 + 2) % LIVERY.length] }));
  stand.forEach((r) => {
    let best = null, bd = 1.7;
    for (const o of stand) { if (o === r) continue; const d = Math.hypot(o.o.x - r.o.x, o.o.z - r.o.z); if (d < bd) { bd = d; best = o; } }
    r.partner = best; r.B = TR(new THREE.Matrix4(), r.o.x, r.o.y, r.o.z, 0, r.o.yaw, 0, r.o.scale ?? 1);
  });
  // ---- walkers: one loop, one speed, evenly spaced (they never meet); the courier rides it too
  const W = spec.walkers, walkers = [];
  let courier = null;
  if (W && W.n > 0) {
    const L = W.loop, len = Math.abs(L.x1 - L.x0), rr = Math.abs(L.z1 - L.z0) / 2, per = 2 * len + 2 * Math.PI * rr;
    const at = (s0) => {   // position and heading at arc length s along the loop
      const s = ((s0 % per) + per) % per, dir = Math.sign(L.x1 - L.x0), sz = Math.sign(L.z1 - L.z0), zc = (L.z0 + L.z1) / 2, half = Math.PI * rr;
      if (s < len) return [L.x0 + dir * s, L.z0, Math.atan2(dir, 0)];
      if (s < len + half) { const th = (s - len) / rr; return [L.x1 + dir * rr * Math.sin(th), zc - sz * rr * Math.cos(th), Math.atan2(dir * Math.cos(th), sz * Math.sin(th))]; }
      if (s < 2 * len + half) return [L.x1 - dir * (s - len - half), L.z1, Math.atan2(-dir, 0)];
      const th = (s - 2 * len - half) / rr; return [L.x0 - dir * rr * Math.sin(th), zc + sz * rr * Math.cos(th), Math.atan2(-dir * Math.cos(th), -sz * Math.sin(th))];
    };
    W.at = at; W.per = per;
    for (let i = 0; i < W.n; i++) {
      if (i === W.courier) { courier = { s0: per * i / W.n }; continue; }
      walkers.push(Object.assign(android({ umb: i % 2 === 0, hood: i % 2 === 1, livery: LIVERY[(i * 3 + 1) % LIVERY.length] }), { s0: per * i / W.n, gait: 0.92 + 0.16 * hash(i + 11) }));
    }
  }
  // ---- broken units: grimy, sat against a wall, one eye flickering
  const grime = [rgb('#6f6a60'), rgb('#7d8078')];
  const broken = (spec.broken || []).map(([x, y, z, yaw], i) => { const r = android({ broken: true, livery: grime[i % 2], eyes: [1.0, 0.45, 0.25], band: [0, 0, 0] }); r.B = TR(new THREE.Matrix4(), x, y, z, 0, yaw, 0); return r; });

  // ---- the one-off machines' far versions: [instance, near geometry, far geometry] swapped past LF from the camera
  const swaps = [];
  const farSwap = (key, list) => swaps.push({ key, list, far: false });

  // ---- the vendors: an upper body (torso, apron, head) on a rail or a pedestal, android arms
  const vendorParts = (apron, livery) => {
    const P = palette(livery);
    const torso = merge([
      lathe([[0, 0, 'j'], [0.1, 0, 'j'], [0.14, 0.035], [0.188, 0.13], [0.2, 0.25], [0.19, 0.33], [0.15, 0.39], [0.08, 0.42], [0.045, 0.425, 'j'], [0.04, 0.48, 'j'], [0, 0.485, 'j']], 9, P, 1, 0.78),
      ball(0.064, JOINT, [-0.21, 0.33, 0]), ball(0.064, JOINT, [0.21, 0.33, 0]),
      tf(quad(0.25, 0.3, apron), [0, 0.17, 0.154], [-0.08, 0, 0]),
    ]);
    const head = merge([lathe(headShellWide, 9, P, 1.55, 0.95), ...[-1, 1].map((s) => rod(0.05, 0.05, 0.04, TRIM, [s * 0.228, 0.13, 0], [0, 0, Math.PI / 2], 8, false)),
      ...[-1, 1].map((s) => rod(0.005, 0.005, 0.09, JOINT, [s * 0.1, 0.3, -0.02], [0, 0, -s * 0.35], 4))]);
    const torsoFar = merge([lathe([[0, 0, 'j'], [0.19, 0.1], [0.2, 0.26], [0.15, 0.39], [0, 0.485, 'j']], 5, P, 1, 0.78), tf(quad(0.25, 0.3, apron), [0, 0.17, 0.158], [-0.08, 0, 0])]);
    return { torso: S.geo(torso), head: S.geo(head), torsoFar: S.geo(torsoFar), headFar: S.geo(lathe([[0, 0, 'j'], [0.136, 0.05], [0.14, 0.19], [0, 0.262]], 5, P, 1.55, 0.95)) };
  };
  const headShellWide = [[0, -0.005, 'j'], [0.07, 0, 'j'], [0.118, 0.022], [0.136, 0.06], [0.14, 0.13], [0.136, 0.19], [0.115, 0.235], [0.065, 0.258], [0, 0.262]];
  const vFace = Object.fromEntries(FACES.map((k) => [k, G.geo(merge([tf(bent(0.143, 0.06, 0.2, 0.7, 'face_' + k, 5), [0, 0, 0], [0, 0, 0], [1.55, 1, 0.95]), ball(0.014, WHITE, [0.116, 0.345, -0.02], [1, 1, 1], 5, 3), ball(0.014, WHITE, [-0.116, 0.345, -0.02], [1, 1, 1], 5, 3)]))]));
  const vBand = G.geo(rod(0.2, 0.2, 0.024, WHITE, [0, 0.29, 0], [0, 0, 0], 12).scale(1, 1, 0.8));
  const vendors = [];
  const vendor = (kind, frame, apron, livery, eyes) => {
    const g = vendorParts(apron, livery), r = { kind, frame, faceK: 'neutral', lod: 0, seed: hash(vendors.length + 40) * 100,
      torso: S.add(g.torso), head: S.add(g.head), face: G.add(vFace.neutral, glowC(eyes, 2.6)), band: G.add(vBand, glowC([1.0, 0.72, 0.38], 2.0)),
      upper: [S.add(gA[0].upper, livery), S.add(gA[0].upper, livery)], fore: [S.add(gA[0].fore, livery), S.add(gA[0].fore, livery)] };
    farSwap(r.torso, [[r.torso, g.torso, g.torsoFar], [r.head, g.head, g.headFar]]);
    if (kind === 'rail') {
      r.rail = S.add(S.geo(merge([rod(0.022, 0.022, 3.2, JOINT, [0, 0, 0], [Math.PI / 2, 0, 0], 6, false), ...[-1.4, 0, 1.4].map((z) => rod(0.012, 0.012, 0.2, JOINT, [0, 0.1, z], [0, 0, 0], 4))])));
      r.mount = S.add(S.geo(merge([tf(std(new THREE.BoxGeometry(0.12, 0.07, 0.2), TRIM), [0, -0.045, 0]), rod(0.026, 0.026, 0.86, JOINT, [0, -0.5, 0], [0, 0, 0], 6, false), ball(0.035, JOINT, [0, -0.93, 0], [1, 1, 1], 6, 4)])));
    } else {
      r.mount = S.add(S.geo(merge([lathe([[0, 0.002, 'j'], [0.23, 0.002, 'j'], [0.25, 0.03], [0.21, 0.075], [0.08, 0.1, 'j'], [0, 0.1, 'j']], 12, palette(livery)),
        rod(0.045, 0.04, 0.86, JOINT, [0, 0.52, 0], [0, 0, 0], 8, false), ...[0.3, 0.42, 0.54, 0.66, 0.78].map((y) => rod(0.052, 0.052, 0.025, TRIM, [0, y, 0], [0, 0, 0], 8, false))])));
      const near = S.inst[r.mount].geo, far = S.geo(merge([lathe([[0, 0.002, 'j'], [0.25, 0.03], [0, 0.1, 'j']], 5, palette(livery)), rod(0.045, 0.04, 0.86, JOINT, [0, 0.52, 0], [0, 0, 0], 4)]));
      swaps.at(-1).list.push([r.mount, near, far]);
    }
    vendors.push(r); return r;
  };
  if (spec.stall) vendor('rail', spec.stall.m, 'apron0', rgb('#f2f0ea'), [1.0, 0.82, 0.5]);
  if (spec.cart) vendor('pedestal', spec.cart.m, 'apron1', rgb('#f3c0a6'), [0.55, 0.95, 1.0]);

  // ---- the courier: a low shell on four wheels, a lit parcel box, a whip mast with a pennant
  let cr = null;
  if (courier) {
    const P = palette(rgb('#eef0ec')), mint = rgb('#7fd6bf');
    const body = merge([
      lathe([[0, 0.1, 'j'], [0.24, 0.1, 'j'], [0.29, 0.13, 'j'], [0.3, 0.17, 'j'], [0.295, 0.19], [0.285, 0.29], [0.25, 0.34], [0.15, 0.36], [0, 0.365]], 10, P, 0.82, 1.22),
      tf(std(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 12, 1, false), mint), [0, 0.355, 0], [0, 0, 0], [0.82, 1, 1.22]),
      tf(std(new RoundedBoxGeometry(0.36, 0.3, 0.46, 1, 0.03), rgb('#f2ede0')), [0, 0.52, -0.03]),
      tf(std(new THREE.BoxGeometry(0.372, 0.04, 0.472), mint), [0, 0.6, -0.03]),
      ...[-1, 1].map((s) => tf(quad(0.26, 0.13, 'parcel'), [s * 0.181, 0.47, -0.1], [0, s * Math.PI / 2, 0])),
      rod(0.006, 0.004, 1.0, JOINT, [-0.13, 1.0, -0.22], [0, 0, 0], 4),
      tf(std(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.14, 0, 0, -0.07, -0.2, 0, 0, 0, 0, -0.07, -0.2, 0, -0.14, 0], 3)), rgb('#ff7a2a')), [-0.13, 1.42, -0.22]),
    ]);
    const glow = merge([
      ...[-1, 1].map((s) => tf(quad(0.14, 0.09, 'parcelGlow'), [s * 0.182, 0.48, 0.12], [0, s * Math.PI / 2, 0])),
      tf(quad(0.2, 0.1, 'parcelGlow'), [0, 0.48, -0.262], [0, Math.PI, 0]),
      ...[-1, 1].map((s) => tf(std(new THREE.BoxGeometry(0.012, 0.012, 0.47)), [s * 0.186, 0.625, -0.03])),
      ...[-1, 1].map((s) => tf(std(new THREE.BoxGeometry(0.37, 0.012, 0.012)), [0, 0.625, -0.03 + s * 0.236])),
      ball(0.016, WHITE, [-0.13, 1.5, -0.22], [1, 1, 1], 5, 3),
      ...[-1, 1].map((s) => tf(std(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8)), [s * 0.17, 0.2, 0.262], [Math.PI / 2, 0, 0])),   // headlamps
    ]);
    const axle = merge([-1, 1].flatMap((s) => [rod(0.1, 0.1, 0.06, JOINT, [s * 0.255, 0, 0], [0, 0, Math.PI / 2], 10, false), tf(std(new THREE.CircleGeometry(0.1, 10), TRIM), [s * 0.286, 0, 0], [0, s * Math.PI / 2, 0]), tf(std(new THREE.CircleGeometry(0.045, 6), rgb('#7fd6bf')), [s * 0.288, 0, 0], [0, s * Math.PI / 2, 0])]));
    const cFace = Object.fromEntries(FACES.map((k) => [k, G.geo(tf(bent(0.302, 0.2, 0.29, 0.48, 'face_' + k, 4), [0, 0, 0], [0, 0, 0], [0.82, 1, 1.22]))]));
    const gAxle = S.geo(axle);
    const bodyFar = merge([lathe([[0, 0.1, 'j'], [0.3, 0.17, 'j'], [0.285, 0.29], [0, 0.365]], 6, P, 0.82, 1.22), tf(std(new THREE.BoxGeometry(0.36, 0.3, 0.46), rgb('#f2ede0')), [0, 0.52, -0.03]),
      ...[-1, 1].map((s) => tf(quad(0.26, 0.13, 'parcel'), [s * 0.182, 0.47, -0.1], [0, s * Math.PI / 2, 0]))]);
    cr = Object.assign(courier, { faceK: 'neutral', seed: 77.3, cFace, body: S.add(S.geo(body)), glow: G.add(G.geo(glow), glowC([0.4, 1.0, 0.85], 2.6)), face: G.add(cFace.neutral, glowC([0.55, 1.0, 0.85], 2.6)), axles: [S.add(gAxle), S.add(gAxle)] });
    farSwap(cr.body, [[cr.body, S.inst[cr.body].geo, S.geo(bodyFar)]]);
  }

  // ---- the sweeper: low and wide, butter-yellow, two side brushes, a turning amber beacon, a wet-floor sign
  let sw = null;
  if (spec.sweeper) {
    const yel = rgb('#f2c94a'), P = palette(yel);
    const body = merge([
      lathe([[0, 0.05, 'j'], [0.4, 0.05, 'j'], [0.445, 0.085, 'j'], [0.45, 0.13, 'j'], [0.44, 0.15], [0.415, 0.235], [0.35, 0.3], [0.22, 0.338], [0, 0.345]], 12, P, 1, 0.72),
      tf(std(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 8, 1, false), JOINT), [0.14, 0.36, -0.06]),
      rod(0.03, 0.03, 0.72, JOINT, [0, 0.04, -0.34], [0, 0, Math.PI / 2], 6, false),
      ...[-1, 1].map((s) => rod(0.012, 0.012, 0.1, JOINT, [s * 0.3, 0.08, -0.3], [0.5, 0, 0], 4)),
      ...[-1, 1].map((s) => tf(quad(0.15, 0.2, 'wet'), [0, 0.44, -0.14 + s * 0.025], s > 0 ? [-0.24, 0, 0] : [0.24, Math.PI, 0])),
      ...[-1, 1].map((s) => tf(quad(0.12, 0.06, 'id3'), [s * 0.437, 0.2, 0.02], [0, s * Math.PI / 2, 0])),
    ]);
    const brush = merge([rod(0.12, 0.12, 0.014, JOINT, [0, 0, 0], [0, 0, 0], 8, false), tf(std(new THREE.CircleGeometry(0.12, 8), TRIM), [0, 0.007, 0], [-Math.PI / 2, 0, 0]),
      ...Array.from({ length: 4 }, (_, i) => tf(std(new THREE.BoxGeometry(0.014, 0.012, 0.11), rgb('#3c3a30')), [Math.sin(i * Math.PI / 2) * 0.16, -0.006, Math.cos(i * Math.PI / 2) * 0.16], [0.18, i * Math.PI / 2, 0]))]);
    const beacon = merge([tf(std(new THREE.CylinderGeometry(0.052, 0.058, 0.085, 8), new THREE.Color(0.25, 0.25, 0.25)), [0, 0.042, 0]), ball(0.052, new THREE.Color(0.25, 0.25, 0.25), [0, 0.085, 0], [1, 0.6, 1], 8, 3), ...[0, Math.PI].map((a) => tf(std(new THREE.BoxGeometry(0.03, 0.075, 0.012)), [Math.sin(a) * 0.058, 0.042, Math.cos(a) * 0.058], [0, a, 0]))]);
    const sFace = Object.fromEntries(FACES.map((k) => [k, G.geo(tf(bent(0.425, 0.15, 0.235, 0.3, 'face_' + k, 4), [0, 0, 0], [0, 0, 0], [1, 1, 0.72]))]));
    const gBrush = S.geo(brush);
    const bodyFar = merge([lathe([[0, 0.05, 'j'], [0.45, 0.13, 'j'], [0.4, 0.24], [0, 0.345]], 6, P, 1, 0.72), ...[-1, 1].map((s) => tf(quad(0.15, 0.2, 'wet'), [0, 0.44, -0.14 + s * 0.025], s > 0 ? [-0.24, 0, 0] : [0.24, Math.PI, 0]))]);
    sw = { faceK: 'neutral', seed: 12.9, sFace, body: S.add(S.geo(body)), brushes: [S.add(gBrush), S.add(gBrush)], beacon: G.add(G.geo(beacon), glowC([1.0, 0.55, 0.1], 7)), face: G.add(sFace.neutral, glowC([1.0, 0.85, 0.5], 2.4)), ...spec.sweeper };
    farSwap(sw.body, [[sw.body, S.inst[sw.body].geo, S.geo(bodyFar)]]);
  }

  // ---- the queue totem: a column on a round base, a pod with a lit band, a screen head that pages, one arm
  let tt = null;
  if (spec.totem) {
    const liv = rgb('#e9ecef'), P = palette(liv);
    const shape = new THREE.Shape(); const rw = 0.25, rh = 0.33, rad = 0.07;
    shape.moveTo(-rw + rad, -rh); shape.lineTo(rw - rad, -rh); shape.quadraticCurveTo(rw, -rh, rw, -rh + rad); shape.lineTo(rw, rh - rad); shape.quadraticCurveTo(rw, rh, rw - rad, rh); shape.lineTo(-rw + rad, rh); shape.quadraticCurveTo(-rw, rh, -rw, rh - rad); shape.lineTo(-rw, -rh + rad); shape.quadraticCurveTo(-rw, -rh, -rw + rad, -rh);
    const screenBox = tf(std(new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 3 }), liv), [0, 1.86, -0.04]);
    const body = merge([
      lathe([[0, 0.003, 'j'], [0.26, 0.003, 'j'], [0.28, 0.035], [0.24, 0.085], [0.09, 0.11, 'j'], [0, 0.11, 'j']], 10, P),
      rod(0.05, 0.042, 0.8, JOINT, [0, 0.5, 0], [0, 0, 0], 8, false),
      lathe([[0, 0.86, 'j'], [0.06, 0.865, 'j'], [0.12, 0.92], [0.14, 1.05], [0.135, 1.2], [0.1, 1.3], [0.04, 1.33, 'j'], [0, 1.335, 'j']], 10, P, 1, 0.8),
      rod(0.03, 0.03, 0.28, JOINT, [0, 1.45, 0], [0, 0, 0], 6, false),
      screenBox,
      ...[-1, 1].map((s) => rod(0.012, 0.012, 0.12, JOINT, [s * 0.2, 2.24, 0], [0, 0, s * -0.2], 4)),
      tf(quad(0.12, 0.06, 'id1'), [0, 1.1, 0.113], [-0.05, 0, 0]),
    ]);
    const band = merge([rod(0.142, 0.142, 0.026, WHITE, [0, 1.2, 0], [0, 0, 0], 12).scale(1, 1, 0.8), ...[-1, 1].map((s) => ball(0.022, WHITE, [s * 0.212, 2.3, 0], [1, 1, 1], 5, 3))]);
    const pages = [0, 1, 2, 3].map((i) => G.geo(tf(quad(0.44, 0.6, 'page' + i), [0, 1.86, 0.027])));
    tt = { pages, page: 0, body: S.add(S.geo(body)), band: G.add(G.geo(band), glowC([0.35, 1.0, 0.85], 2.4)), screen: G.add(pages[0], glowC([1, 1, 1], 1.5)),
      lod: 0, upper: [S.add(gA[0].upper, liv)], fore: [S.add(gA[0].fore, liv)], B: TR(new THREE.Matrix4(), ...spec.totem.slice(0, 3), 0, spec.totem[3], 0) };
    const bodyFar = merge([lathe([[0, 0.003, 'j'], [0.28, 0.035], [0, 0.11, 'j']], 5, P), rod(0.05, 0.042, 0.8, JOINT, [0, 0.5, 0], [0, 0, 0], 4),
      lathe([[0, 0.86, 'j'], [0.14, 1.05], [0.1, 1.3], [0, 1.335, 'j']], 5, P, 1, 0.8), rod(0.03, 0.03, 0.28, JOINT, [0, 1.45, 0], [0, 0, 0], 3), tf(std(new THREE.BoxGeometry(0.53, 0.69, 0.08), liv), [0, 1.86, -0.015])]);
    farSwap(tt.body, [[tt.body, S.inst[tt.body].geo, S.geo(bodyFar)]]);
  }

  // ---- the batches
  const shell = mat.std({ map: atlas, vertexColors: true, roughness: 0.3, metalness: 0.08 });
  const lights = mat.patch(new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true }), { output: 'outgoingLight *= max(uLampGain, 0.35);' });
  const canopy = mat.std({ vertexColors: true, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const group = new THREE.Group(); group.name = 'machines';
  group.add(S.finish(shell, 'machines-shell'), G.finish(lights, 'machines-lights'));
  if (U.inst.length) group.add(U.finish(canopy, 'machines-umbrellas'));
  for (const r of broken) setFace(r, 'broken');

  // ---- the poses
  const camPos = new THREE.Vector3(), B = new THREE.Matrix4(), Bv = new THREE.Matrix4();
  let lastT = Infinity;
  const update = (t) => {
    // a jump of the view (play.place sets the scene clock back to 0): the LODs are chosen afresh, not through the
    // hysteresis of where the eye was before, so a still of a view does not depend on the view before it
    if (t < lastT - 0.25) for (const r of [...stand, ...walkers, ...broken, ...vendors, ...(tt ? [tt] : [])]) r.lod = undefined;
    lastT = t;
    if (cam) camPos.setFromMatrixPosition(cam.matrixWorld);
    for (const r of stand) {
      const o = r.o, ph = r.seed;
      setLod(r, camPos.distanceTo(v.set(o.x, o.y + 1, o.z)));
      let hy = 0.55 * Math.sin(t * 0.17 + ph) + 0.25 * Math.sin(t * 0.41 + ph * 2), hp = 0.06 * Math.sin(t * 0.23 + ph), gest = 0, rep = ['neutral', 'curious', 'happy', 'smile'];
      if (r.partner) {
        const rel = wrap(Math.atan2(r.partner.o.x - o.x, r.partner.o.z - o.z) - o.yaw);
        const speaking = Math.sin(t * 0.45 + (r.seed > r.partner.seed ? 0 : Math.PI)) > 0;
        hy = Math.max(-1.0, Math.min(1.0, rel)) * 0.85 + 0.12 * Math.sin(t * 0.37 + ph); hp = speaking ? 0.04 * Math.sin(t * 2.3 + ph) : 0.08;
        gest = speaking ? 0.55 + 0.45 * Math.sin(t * 1.9 + ph) : 0;
        rep = speaking ? ['talk', 'smile', 'happy', 'talk'] : ['neutral', 'happy', 'curious'];
      }
      const free = r.canopy !== undefined ? 0 : 1, g2 = gest;
      const arms = [[-0.12 * g2, 0.1 * g2, 0.08 + 0.1 * g2, -0.15 - 1.15 * g2], free ? [0.02, 0, 0.07, -0.12 - 0.08 * Math.sin(t * 0.5 + ph)] : [-0.4, 0.15, 0.12, -1.2]];
      poseAndroid(r, r.B, { bob: 0.005 * Math.sin(t * 0.8 + ph), twist: 0.03 * Math.sin(t * 0.13 + ph), head: [hp, hy, 0.05 * Math.sin(t * 0.29 + ph)], arms, legs: [[0, 0.04], [0, -0.04]] });
      setFace(r, faceAt(r, t, rep));
    }
    if (W && W.n > 0) {
      const sp = W.speed;
      for (const r of walkers) {
        const s = t * sp + r.s0, [x, z, yaw] = W.at(s), ph = s / 1.15 * Math.PI * 2 * r.gait;
        setLod(r, camPos.distanceTo(v.set(x, W.y + 1, z)));
        TR(B, x, W.y, z, 0, yaw, 0);
        const sw2 = Math.sin(ph) * 0.42, bob = Math.abs(Math.cos(ph)) * 0.028;
        const arms = [[sw2 * 0.6, 0, 0.07, -0.25], r.canopy !== undefined ? [-0.4, 0.15, 0.12, -1.2] : [-sw2 * 0.6, 0, 0.07, -0.25]];
        poseAndroid(r, B, { bob, pitch: 0.04, head: [0.03, 0.25 * Math.sin(t * 0.3 + r.seed), 0], arms, legs: [[-sw2, 0], [sw2, 0]] });
        setFace(r, faceAt(r, t, ['neutral', 'happy', 'neutral', 'curious']));
      }
      if (cr) {
        const s = t * sp + cr.s0, [x, z, yaw] = W.at(s);
        TR(B, x, W.y + 0.1 + 0.004 * Math.sin(t * 9), z, 0, yaw, 0);
        set(S, cr.body, B); set(G, cr.glow, B); set(G, cr.face, B);
        for (const k of [0, 1]) { m4.copy(B).multiply(TR(m5, 0, 0, k ? 0.2 : -0.22, s / 0.1, 0, 0)); set(S, cr.axles[k], m4); }
        const k = faceAt(cr, t, ['happy', 'neutral', 'note', 'smile']);
        if (cr.faceK !== k) { cr.faceK = k; G.mesh.setGeometryIdAt(cr.face, cr.cFace[k]); }
      }
    }
    for (const r of broken) {
      setLod(r, camPos.distanceTo(v.setFromMatrixPosition(r.B)));
      Bv.copy(r.B);
      const tw = Math.sin(t * 0.07 + r.seed) * 0.03;   // a servo that still twitches now and then
      const jerk = hash(Math.floor(t * 1.3 + r.seed)) > 0.93 ? 0.06 : 0;
      poseAndroid(r, Bv, { hipY: 0.12, pitch: -0.32, roll: 0.08, head: [0.5 + jerk, 0.35 + tw, 0.38], arms: [[0.05, 0, 0.32, -0.05], [-0.75, 0.2, 0.1, -0.7]], legs: [[-1.42, -0.22], [-1.5, 0.3]] });
      const f = hash(Math.floor(t * 9 + r.seed)) > 0.35 ? (hash(Math.floor(t * 2.3) + r.seed) > 0.2 ? 1 : 0.15) : 0.05;
      G.mesh.setColorAt(r.face, v.set(r.eyes.r, r.eyes.g * 0.4, r.eyes.b * 0.3).multiplyScalar(0.55 * f));
    }
    for (const r of vendors) {
      const cyc = r.kind === 'rail' ? 18 : 14, u = mod(t + r.seed, cyc);
      let pos = 0, arms, head = [0.25, 0, 0], rep = ['note', 'happy'];
      if (r.kind === 'rail') {   // the grill (z 0.8) .. the pot (z -1.0): turning skewers, then stirring
        const w = sstep(6, 8.5, u) - sstep(14, 16.5, u); pos = 0.8 - 1.8 * w;
        const atGrill = u < 6 || u > 16.5, atPot = u > 8.5 && u < 14;
        if (atGrill) { const k = Math.sin(t * 3.2); arms = [[-0.9, 0.05, 0.05, -0.45 + 0.25 * k], [-0.9, 0.05, 0.05, -0.45 - 0.25 * k]]; head = [0.45, 0.1 * Math.sin(t * 0.7), 0]; }
        else if (atPot) { const a = t * 2.4; arms = [[-0.2, 0, 0.1, -0.5], [-0.75 + 0.12 * Math.sin(a), 0.15 * Math.cos(a), 0.05, -0.55]]; head = [0.35, -0.2, 0]; rep = ['happy', 'smile']; }
        else { arms = [[-0.1, 0, 0.12, -0.6], [-0.1, 0, 0.12, -0.6]]; head = [0.05, -0.6 * Math.sin((u - 6) * 0.4), 0]; rep = ['neutral', 'smile']; }
        if (u > 3 && u < 4.6) { head = [0.0, 0.0, 0.1]; rep = ['smile']; }   // a look at the customers
        B.copy(r.frame).multiply(TR(m4, -0.3, 2.37, 0));
        set(S, r.rail, B);
        B.multiply(TR(m4, 0, 0, pos, 0, Math.PI / 2, 0));
        set(S, r.mount, B);
        Bv.copy(B).multiply(TR(m4, 0, -0.93 - 0.42, 0.15, 0.0, 0, 0.03 * Math.sin(t * 1.1)));
      } else {   // the pedestal behind the cart: stirring the big pot, wiping the counter, a look at the customers
        B.copy(r.frame); set(S, r.mount, B);
        const stir = u < 6, wipe = u > 7 && u < 12;
        if (stir) { const a = t * 2.2; arms = [[-0.25, 0, 0.12, -0.6], [-1.1 + 0.1 * Math.sin(a), 0.12 * Math.cos(a), 0.1, -0.3]]; head = [0.32, 0.4, 0]; }
        else if (wipe) { const k = Math.sin(t * 2.6); arms = [[-0.95, 0.35 * k, 0.15, -0.25], [-0.2, 0, 0.1, -0.5]]; head = [0.35, -0.25 + 0.2 * k, 0]; rep = ['neutral', 'happy']; }
        else { arms = [[-0.15, 0, 0.1, -0.5], [-0.15, 0, 0.1, -0.5]]; head = [0.0, 0.3 * Math.sin(t * 0.5), 0]; rep = ['smile', 'talk']; }
        Bv.copy(B).multiply(TR(m4, 0, 0.95, 0, 0, 0.12 * Math.sin(t * 0.21 + r.seed), 0));
      }
      set(S, r.torso, Bv); set(G, r.band, Bv);
      armLod(r, camPos.distanceTo(v.setFromMatrixPosition(Bv)));
      tHead.copy(Bv).multiply(TR(m4, 0, 0.485, 0.0, head[0], head[1], head[2]));
      set(S, r.head, tHead); set(G, r.face, tHead);
      for (const k of [0, 1]) {
        const s = k ? 1 : -1, a = arms[k];
        tUp.copy(Bv).multiply(TR(m4, s * 0.235, 0.33, 0, a[0], s * a[1], s * a[2])); set(S, r.upper[k], tUp);
        tFore.copy(tUp).multiply(TR(m4, 0, -ANDROID.elbow, 0, a[3], 0, 0)); set(S, r.fore[k], tFore);
      }
      const k = faceAt(r, t, rep);
      if (r.faceK !== k) { r.faceK = k; G.mesh.setGeometryIdAt(r.face, vFace[k]); }
    }
    if (sw) {   // up and down its beat at a walking pace's third, turning on the spot at each end
      const L = Math.hypot(sw.b[0] - sw.a[0], sw.b[1] - sw.a[1]), vv = 0.3, tl = L / vv, tr = 3, cyc = 2 * (tl + tr), u = mod(t, cyc);
      const base = Math.atan2(sw.b[0] - sw.a[0], sw.b[1] - sw.a[1]);
      let f, yaw;
      if (u < tl) { f = u / tl; yaw = base; } else if (u < tl + tr) { f = 1; yaw = base + Math.PI * sstep(0, 1, (u - tl) / tr); } else if (u < 2 * tl + tr) { f = 1 - (u - tl - tr) / tl; yaw = base + Math.PI; } else { f = 0; yaw = base + Math.PI + Math.PI * sstep(0, 1, (u - 2 * tl - tr) / tr); }
      TR(B, sw.a[0] + (sw.b[0] - sw.a[0]) * f, sw.y, sw.a[1] + (sw.b[1] - sw.a[1]) * f, 0, yaw, 0);
      set(S, sw.body, B); set(G, sw.face, B);
      for (const k of [0, 1]) { const s = k ? 1 : -1; m4.copy(B).multiply(TR(m5, s * 0.3, 0.025, 0.25, 0, s * t * 5.5, 0)); set(S, sw.brushes[k], m4); }
      m4.copy(B).multiply(TR(m5, 0.14, 0.385, -0.06, 0, t * 4.2, 0)); set(G, sw.beacon, m4);
      const k = faceAt(sw, t, ['star', 'happy', 'neutral']);
      if (sw.faceK !== k) { sw.faceK = k; G.mesh.setGeometryIdAt(sw.face, sw.sFace[k]); }
    }
    if (tt) {
      B.copy(tt.B).multiply(TR(m4, 0, 0, 0, 0, 0.22 * Math.sin(t * 0.19), 0));
      armLod(tt, camPos.distanceTo(v.setFromMatrixPosition(B)));
      set(S, tt.body, B); set(G, tt.band, B); set(G, tt.screen, B);
      const pg = mod(Math.floor(t / 5), tt.pages.length);
      if (pg !== tt.page) { tt.page = pg; G.mesh.setGeometryIdAt(tt.screen, tt.pages[pg]); }
      const wave = sstep(0, 0.6, mod(t, 9) - 5) * (1 - sstep(2.4, 3, mod(t, 9) - 5)), wv = Math.sin(t * 5.5);
      tUp.copy(B).multiply(TR(m4, 0.17, 1.24, 0, -0.35 - 0.6 * wave, 0, 0.55 + 0.35 * wave)); set(S, tt.upper[0], tUp);
      tFore.copy(tUp).multiply(TR(m4, 0, -ANDROID.elbow, 0, -0.5 - 0.6 * wave - 0.35 * wave * wv, 0, 0)); set(S, tt.fore[0], tFore);
    }
    for (const w of swaps) {
      S.mesh.getMatrixAt(w.key, m4);
      const far = camPos.distanceTo(v.setFromMatrixPosition(m4)) > (w.far ? LF - 3 : LF);
      if (far !== w.far) { w.far = far; for (const [id, near, farGeo] of w.list) S.mesh.setGeometryIdAt(id, far ? farGeo : near); }
    }
  };
  update(0);
  // where a machine is now (for scripts: close-ups, tests): 'sweeper' | 'courier' | 'walker' | 'totem' | 'vendor' | 'broken'
  const pos = (B0, id) => { B0.mesh.getMatrixAt(id, m4); return v.setFromMatrixPosition(m4).toArray().map((x) => +x.toFixed(2)); };
  group.userData.where = (kind, i = 0) => ({ sweeper: () => sw && pos(S, sw.body), courier: () => cr && pos(S, cr.body), walker: () => walkers[i] && pos(S, walkers[i].torso),
    totem: () => tt && pos(S, tt.body), vendor: () => vendors[i] && pos(S, vendors[i].torso), broken: () => broken[i] && pos(S, broken[i].torso) })[kind]?.();
  let tris = 0; for (const b of [S, G, U]) for (const i of b.inst) tris += b.geos[i.geo].attributes.position.count / 3;
  return { group, update, count: stand.length + walkers.length + broken.length + vendors.length + (cr ? 1 : 0) + (sw ? 1 : 0) + (tt ? 1 : 0), tris: Math.round(tris) };
}
