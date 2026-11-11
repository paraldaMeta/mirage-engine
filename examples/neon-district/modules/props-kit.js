// props-kit: what the close-up props share (not a module itself). One canvas atlas for every printed thing a player
// can read from a metre away (drink labels in English / Traditional Chinese / kana, price tags, stickers, warning
// labels, stencils, number plates, menus, lantern paper, drive bays, keyboards, tyre walls), and five materials
// that read it: painted / plastic (`paint`), metal (`metal`), lit (`glow`, intensity in the vertex colour, so one
// material serves a dim LED and a hot lens), a paper lantern (`lantern`: brighter where it faces you), clear glass
// (`clear`) and instanced products (`product`: a per-instance label offset, `ndLab`, into the atlas). Everything a
// prop builder adds goes through put(): its uv is fitted into an atlas cell and its tint is written as a vertex
// colour, so a whole prop (and every prop of a module) merges into one draw per material.
// All brands are invented.
import * as THREE from 'three';
import { surfaceLib } from './materials.js';

const FONT = '"PingFang TC", "Hiragino Sans", "Noto Sans TC", "Noto Sans JP", "Microsoft JhengHei", system-ui, sans-serif';

// ---------------------------------------------------------------------------------------------------------------
// the atlas: cells packed in shelves, each drawn by a function (g, w, h)
const CAN = [   // [name, sub, colour, ink, accent]
  ['UMIKURA', '海藏 ソーダ', '#0f4fa8', '#ffffff', '#5ff7ff'], ['KAPPA KOLA', 'カッパ 可樂', '#c0142a', '#fff4e0', '#ffd23a'],
  ['NEUROFIZZ', '神經 ⚡ 汽水', '#9be22a', '#10200a', '#ffffff'], ['RAIDEN', '雷電 エナジー', '#121212', '#ffd400', '#ff2a40'],
  ['MOMO', '桃 ピーチ SODA', '#ff8fb6', '#5a0a2a', '#ffffff'], ['黒 BLK', 'COFFEE 無糖', '#2a1a10', '#e8c070', '#c08040'],
  ['SORA', '蘇打 そら', '#7fd0ff', '#0a2a50', '#ffffff'], ['GINGER', 'ジンジャー 薑', '#e8a020', '#3a1a00', '#fff'],
  ['おでん', 'ODEN 關東煮 HOT', '#f2e2b0', '#7a1a0a', '#d02010'], ['CORN', 'コーン 粟米湯 HOT', '#ffd84a', '#5a3a00', '#2a8a20'],
  ['COCOA', '熱可可 ココア', '#5a2a18', '#ffe0c0', '#ff6040'], ['CELL·7', '電池 POWER CELL', '#1a1d22', '#5ff7ff', '#ffd23a'],
  ['STIM+', '興奮劑 スティム', '#e8e8e8', '#c01020', '#202020'],
];
const BOTTLE = [   // [name, sub, liquid, label, ink, cap]
  ['お茶', 'GREEN TEA 綠茶', '#6a8a20', '#e8f0d0', '#2a5a10', '#2a7a30'], ['AQUA 7', '天然水 water', '#bfe8ff', '#2a8ad0', '#ffffff', '#1a5ab0'],
  ['荔枝', 'LYCHEE ライチ', '#f0d0d8', '#ff5a8a', '#ffffff', '#ff2a6a'], ['麦茶', 'MUGI TEA 大麥', '#8a4a10', '#f8e8c8', '#6a2a00', '#c08020'],
  ['ION ZERO', 'イオン 電解質', '#e0f0ff', '#0a3aa0', '#ffffff', '#0a3aa0'], ['檸檬', 'LEMON レモン', '#f0f080', '#ffd800', '#204000', '#f0c000'],
  ['烏龍', 'OOLONG ウーロン', '#a0501a', '#2a1208', '#e8c070', '#7a1a0a'], ['COLA Z', 'カッパ ZERO', '#2a0a06', '#101010', '#ff2a40', '#c0142a'],
];
const BOX = [   // [name, sub, colour, ink]
  ['牛乳', 'MILK ミルク', '#f4f4f0', '#1a4aa0'], ['豆漿', 'SOY 豆乳', '#e8d8a0', '#5a3a10'], ['COFFEE', 'ミルク 咖啡', '#6a3a1a', '#fff0d0'],
  ['いちご', 'STRAWBERRY', '#ffb0c8', '#c0103a'], ['9×19', 'RNDS ×20 子彈', '#3a4020', '#e8d070'], ['FUSE', '保險絲 ×10', '#c02010', '#ffffff'],
  ['醬油', 'SOY SAUCE', '#2a0a04', '#f0c060'], ['辣油', 'CHILI OIL', '#c03010', '#fff0a0'],
];
const PACK = [   // snack packs: [name, sub, colour, ink]
  ['えびせん', 'SHRIMP CHIPS 蝦片', '#ff7a20', '#ffffff'], ['海苔', 'NORI のり', '#1a3a1a', '#9be22a'], ['辛麵', 'HOT RAMEN SNACK', '#d01010', '#ffd23a'],
  ['CHOCO', 'チョコ 朱古力', '#4a2010', '#ffb0c0'], ['魷魚絲', 'SQUID イカ', '#f0e0a0', '#a01010'], ['花生', 'PEANUT ピーナッツ', '#c08a30', '#2a1000'],
];
const CAPS = [['#ff3060', '#ffe0e8'], ['#30b0ff', '#e0f4ff'], ['#ffd020', '#fff8d0'], ['#60e080', '#e0ffe8']];
const PRICES = [['¥120', '#1a5ad0'], ['¥150', '#1a5ad0'], ['¥180', '#1a5ad0'], ['¥200', '#1a5ad0'], ['¥130', '#d01a1a'], ['¥160', '#d01a1a'], ['¥220', '#d01a1a'], ['¥500', '#202020']];
const STICK = [['防犯カメラ', '作動中 CCTV'], ['COINS', '只收硬幣 ONLY'], ['⚠ 高溫', 'HOT 注意'], ['リサイクル', '回收 ♻ CANS']];
const PLATES = ['新城 47-21', 'KSR·0729', '夜 ND-88'];
const BAR_LABELS = [['山霧', 'WHISKY 12', '#c08a30'], ['獺祭', 'SAKE 清酒', '#f0f0e8'], ['梅酒', 'UME 梅', '#d04060'], ['焼酎', 'SHOCHU', '#e0e8f0'], ['高粱', 'KAOLIANG', '#c02010'], ['GIN 07', '琴酒', '#60b0a0']];
const LANTERN = [['祭', '#d01a10'], ['麵', '#e8d8b0'], ['酒', '#d01a10'], ['福', '#f0c040']];

function text(g, s, x, y, size, color, { weight = 900, align = 'center', maxW = 0, font = FONT } = {}) {
  g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
  if (maxW) g.fillText(s, x, y, maxW); else g.fillText(s, x, y);
}
const DRAW = {
  white: (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); },
  // a can's wrap (u around, v up the barrel): silver at both ends, the brand twice round
  can: ([name, sub, c, ink, acc]) => (g, w, h) => {
    g.fillStyle = c; g.fillRect(0, 0, w, h);
    g.fillStyle = acc; g.globalAlpha = 0.55; for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(i * w / 2, h * 0.72); for (let x = 0; x <= w / 2; x += 8) g.lineTo(i * w / 2 + x, h * 0.72 + Math.sin(x / 12) * 5); g.lineTo(i * w / 2 + w / 2, h * 0.86); g.lineTo(i * w / 2, h * 0.86); g.fill(); }
    g.globalAlpha = 1;
    for (let i = 0; i < 2; i++) { const x = w / 4 + i * w / 2; text(g, name, x, h * 0.42, h * 0.27, ink, { maxW: w * 0.42 }); text(g, sub, x, h * 0.64, h * 0.1, ink, { weight: 700, maxW: w * 0.42 }); }
    const sil = g.createLinearGradient(0, 0, 0, 10); sil.addColorStop(0, '#d8dce0'); sil.addColorStop(1, '#8a9098');
    g.fillStyle = sil; g.fillRect(0, 0, w, 10); g.fillStyle = '#b8bcc0'; g.fillRect(0, h - 10, w, 10);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(w * 0.6, h * 0.8, w * 0.08, h * 0.06);        // the barcode's place
  },
  // a bottle by height (v up): base, the label band, liquid, neck, cap
  bottle: ([name, sub, liq, lab, ink, cap]) => (g, w, h) => {
    g.fillStyle = liq; g.fillRect(0, 0, w, h);
    const sh = g.createLinearGradient(0, 0, w, 0); for (let i = 0; i <= 8; i++) sh.addColorStop(i / 8, i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)');
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
    g.fillStyle = lab; g.fillRect(0, h * 0.45, w, h * 0.36);
    for (let i = 0; i < 2; i++) { const x = w / 4 + i * w / 2; text(g, name, x, h * 0.6, h * 0.08, ink, { maxW: w * 0.45 }); text(g, sub, x, h * 0.72, h * 0.035, ink, { weight: 700, maxW: w * 0.45 }); }
    g.fillStyle = cap; g.fillRect(0, 0, w, h * 0.09); g.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h * 0.09);
  },
  box: ([name, sub, c, ink]) => (g, w, h) => {
    g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = ink; g.fillRect(0, h * 0.78, w, h * 0.06);
    text(g, name, w / 2, h * 0.38, h * 0.26, ink, { maxW: w * 0.86 }); text(g, sub, w / 2, h * 0.62, h * 0.1, ink, { weight: 700, maxW: w * 0.9 });
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
  },
  pack: ([name, sub, c, ink]) => (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c); gr.addColorStop(1, '#000'); g.fillStyle = c; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.35; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(w * 0.7, h * 0.72, h * 0.16, 0, 7); g.fill();
    text(g, name, w / 2, h * 0.32, h * 0.22, ink, { maxW: w * 0.86 }); text(g, sub, w / 2, h * 0.5, h * 0.08, ink, { weight: 700, maxW: w * 0.9 });
    g.fillStyle = 'rgba(0,0,0,0.4)'; for (let x = 0; x < w; x += 5) { g.fillRect(x, 0, 2, h * 0.06); g.fillRect(x, h * 0.94, 2, h * 0.06); }   // crimped ends
  },
  capsule: ([c, top]) => (g, w, h) => { g.fillStyle = top; g.fillRect(0, 0, w, h / 2); g.fillStyle = c; g.fillRect(0, h / 2, w, h / 2); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, h / 2 - 2, w, 4); },
  price: ([p, c]) => (g, w, h) => { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.fillStyle = c; g.fillRect(0, 0, w, h * 0.34); text(g, c === '#d01a1a' ? 'あったか〜い' : 'つめた〜い', w / 2, h * 0.17, h * 0.24, '#fff', { weight: 700, maxW: w * 0.92 }); text(g, p, w / 2, h * 0.68, h * 0.5, '#111', { maxW: w * 0.9 }); },
  sticker: ([a, b], i) => (g, w, h) => {
    const bg = ['#ffd23a', '#1a5ad0', '#d01a1a', '#2a8a30'][i];
    g.fillStyle = '#f4f4ee'; g.fillRect(0, 0, w, h); g.fillStyle = bg; g.fillRect(4, 4, w - 8, h * 0.5);
    text(g, a, w / 2, h * 0.28, h * 0.22, i === 0 ? '#111' : '#fff', { maxW: w * 0.88 }); text(g, b, w / 2, h * 0.74, h * 0.15, '#111', { maxW: w * 0.9 });
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.6; for (let k = 0; k < 40; k++) g.fillRect(((k * 7919 + i * 131) % 997) / 997 * w, ((k * 104729 + i * 17) % 991) / 991 * h, 3, 2); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  },
  header: ([name, sub, c1, c2]) => (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    text(g, name, w * 0.5, h * 0.42, h * 0.48, '#fff', { maxW: w * 0.9 }); text(g, sub, w * 0.5, h * 0.82, h * 0.16, 'rgba(255,255,255,0.85)', { weight: 700, maxW: w * 0.9 });
  },
  // the back of a vending machine's window: a light box, brighter in the middle, faint logo stripes
  backlit: (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.7); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#556'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.4)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 6); },
  coin: (g, w, h) => {   // the payment panel: coin slot, note slot, card pad, return lever
    g.fillStyle = '#2a2d33'; g.fillRect(0, 0, w, h); g.fillStyle = '#c0c4c8';
    g.fillRect(w * 0.15, h * 0.08, w * 0.7, h * 0.12); g.fillStyle = '#050505'; g.fillRect(w * 0.47, h * 0.1, w * 0.06, h * 0.08);   // coin slot
    g.fillStyle = '#c0c4c8'; g.fillRect(w * 0.1, h * 0.3, w * 0.8, h * 0.1); g.fillStyle = '#050505'; g.fillRect(w * 0.18, h * 0.335, w * 0.64, h * 0.03);
    g.fillStyle = '#0a1a2a'; g.fillRect(w * 0.15, h * 0.5, w * 0.7, h * 0.22); g.strokeStyle = '#5ff7ff'; g.lineWidth = 3; g.strokeRect(w * 0.15, h * 0.5, w * 0.7, h * 0.22);
    text(g, 'IC ◉ 卡', w / 2, h * 0.61, h * 0.07, '#5ff7ff', { weight: 700 });
    text(g, '硬幣 COIN ¥10-500', w / 2, h * 0.24, h * 0.04, '#ddd', { weight: 600, maxW: w * 0.9 }); text(g, '返却 RETURN', w / 2, h * 0.86, h * 0.05, '#ddd', { weight: 700 });
  },
  lcd: (g, w, h) => { g.fillStyle = '#062010'; g.fillRect(0, 0, w, h); text(g, '¥  0120', w * 0.94, h * 0.5, h * 0.62, '#6aff8a', { align: 'right', font: 'monospace' }); },
  keypad: (g, w, h) => { g.fillStyle = '#d8dade'; g.fillRect(0, 0, w, h); },
  push: (g, w, h) => { g.fillStyle = '#16181c'; g.fillRect(0, 0, w, h); text(g, '押 PUSH 取出口', w / 2, h / 2, h * 0.42, '#c8ccd0', { weight: 700, maxW: w * 0.9 }); },
  warn: ([a, b], i) => (g, w, h) => {
    g.fillStyle = i ? '#ffd23a' : '#f4f4ee'; g.fillRect(0, 0, w, h); g.fillStyle = '#111';
    g.beginPath(); g.moveTo(h * 0.5, h * 0.12); g.lineTo(h * 0.9, h * 0.86); g.lineTo(h * 0.1, h * 0.86); g.closePath(); g.lineWidth = 8; g.strokeStyle = '#111'; g.fillStyle = '#ffd23a'; g.fill(); g.stroke();
    text(g, '⚡', h * 0.5, h * 0.6, h * 0.36, '#111'); text(g, a, h + (w - h) / 2, h * 0.34, h * 0.28, i ? '#111' : '#c01010', { maxW: w - h - 10 }); text(g, b, h + (w - h) / 2, h * 0.7, h * 0.15, '#111', { weight: 700, maxW: w - h - 10 });
  },
  stencil: ([a, b]) => (g, w, h) => { g.fillStyle = '#7a7a70'; g.fillRect(0, 0, w, h); text(g, a, w / 2, h * 0.38, h * 0.36, '#111', { maxW: w * 0.9 }); text(g, b, w / 2, h * 0.76, h * 0.16, '#111', { maxW: w * 0.9 }); },
  plate: (s) => (g, w, h) => { g.fillStyle = '#e8e8e0'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8); text(g, s, w / 2, h * 0.55, h * 0.62, '#111', { maxW: w * 0.86 }); g.fillStyle = '#1a5ad0'; g.fillRect(8, 8, w * 0.07, h - 16); },
  menu: (rows, bg, ink) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = ink; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    rows.forEach(([a, p], i) => { const y = h * (0.16 + i * 0.84 / rows.length); text(g, a, 30, y, h / rows.length * 0.42, ink, { align: 'left', maxW: w * 0.68 }); text(g, p, w - 30, y, h / rows.length * 0.4, ink, { align: 'right' }); });
  },
  barLabel: ([a, b, c]) => (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(w * 0.08, h * 0.1, w * 0.84, h * 0.8); text(g, a, w / 2, h * 0.42, h * 0.32, c, { maxW: w * 0.7 }); text(g, b, w / 2, h * 0.74, h * 0.12, '#eee', { weight: 700, maxW: w * 0.75 }); },
  // lantern paper (u round, v up): ribs, a printed character either side, darker toward the caps
  lantern: ([ch, ink]) => (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a2a10'); gr.addColorStop(0.18, '#ffd0a0'); gr.addColorStop(0.5, '#fff4e0'); gr.addColorStop(0.82, '#ffd0a0'); gr.addColorStop(1, '#5a2a10');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.85; for (let i = 0; i < 2; i++) text(g, ch, w / 4 + i * w / 2, h * 0.52, h * 0.42, ink, { maxW: w * 0.4 }); g.globalAlpha = 1;
    g.fillStyle = 'rgba(80,30,10,0.45)'; for (let y = 0; y < h; y += h / 14) g.fillRect(0, y, w, 2);
  },
  drives: (g, w, h) => {   // a rack's front: 4 rows of drive sleds with handles and a label slot
    g.fillStyle = '#0c0d10'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) { const x = 6 + c * (w - 12) / 4, y = 6 + r * (h - 12) / 8, cw = (w - 12) / 4 - 4, ch = (h - 12) / 8 - 4; g.fillStyle = '#23262c'; g.fillRect(x, y, cw, ch); g.fillStyle = '#3a3e46'; g.fillRect(x + 3, y + ch * 0.35, cw * 0.55, ch * 0.3); g.fillStyle = '#d8d8d0'; g.fillRect(x + cw * 0.66, y + ch * 0.3, cw * 0.28, ch * 0.4); for (let k = 0; k < 6; k++) { g.fillStyle = '#000'; g.fillRect(x + 3 + k * 5, y + 3, 2, ch * 0.2); } }
  },
  keys: (g, w, h) => { g.fillStyle = '#16181c'; g.fillRect(0, 0, w, h); for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) { g.fillStyle = r === 4 && c > 3 && c < 11 ? '#2c3038' : '#2c3038'; if (r === 4 && c > 4 && c < 10) continue; g.fillRect(4 + c * (w - 8) / 15, 4 + r * (h - 8) / 5, (w - 8) / 15 - 3, (h - 8) / 5 - 3); } g.fillRect(4 + 5 * (w - 8) / 15, 4 + 4 * (h - 8) / 5, 5 * (w - 8) / 15 - 3, (h - 8) / 5 - 3); },
  tyre: (g, w, h) => {   // u round, v across the section: sidewall lettering at both ends, grooved tread in the middle
    g.fillStyle = '#121214'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#060607'; for (let x = 0; x < w; x += 16) { g.fillRect(x, h * 0.3, 6, h * 0.4); g.save(); g.translate(x, h * 0.5); g.rotate(0.6); g.fillRect(0, -h * 0.15, 3, h * 0.3); g.restore(); }
    g.fillRect(0, h * 0.42, w, 3); g.fillRect(0, h * 0.56, w, 3);
    for (const y of [h * 0.12, h * 0.88]) for (let x = 0; x < w; x += w / 3) text(g, 'KESTREL TR-7 245/40R20', x + w / 6, y, h * 0.07, '#3a3a3e', { weight: 700 });
  },
  lens: (g, w, h) => {   // a light's lens: a reflector pattern behind a bright strip
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) { const gr = g.createRadialGradient(x + 6, h / 2, 1, x + 6, h / 2, 10); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#333'); g.fillStyle = gr; g.fillRect(x, 0, 12, h); }
    g.fillStyle = '#fff'; g.fillRect(0, h * 0.42, w, h * 0.16);
  },
  vent: (g, w, h) => { g.fillStyle = '#2a2c30'; g.fillRect(0, 0, w, h); g.fillStyle = '#050506'; for (let y = 6; y < h; y += 12) g.fillRect(6, y, w - 12, 6); },
  door: (g, w, h) => { g.fillStyle = '#8a8c90'; g.fillRect(0, 0, w, h); g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12); text(g, '⚡ 電 07', w / 2, h * 0.3, h * 0.12, '#111'); g.fillStyle = '#222'; g.fillRect(w * 0.7, h * 0.5, w * 0.12, h * 0.16); },
  goods: ([a, b, c], i) => (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(w * 0.1, h * 0.25, w * 0.8, h * 0.5); text(g, a, w / 2, h * 0.43, h * 0.2, '#111', { maxW: w * 0.75 }); text(g, b, w / 2, h * 0.64, h * 0.09, '#333', { weight: 700, maxW: w * 0.75 }); if (i % 2) { g.fillStyle = '#111'; g.fillRect(0, h * 0.85, w, h * 0.04); } },
};
const GOODS = [['乾麵', 'DRY NOODLE', '#d8b060'], ['茶葉', 'TEA LEAF', '#2a6a30'], ['米', 'RICE 5KG', '#f0ece0'], ['味噌', 'MISO', '#a05a20'], ['電池', 'CELLS AA', '#202024'], ['膠帶', 'TAPE', '#e0c020']];

function buildAtlas() {
  const cells = [];   // [name, w, h, draw]
  const fam = (name, list, w, h, mk) => list.forEach((e, i) => cells.push([`${name}${i}`, w, h, mk(e, i)]));
  cells.push(['white', 32, 32, DRAW.white]);
  fam('can', CAN, 256, 128, DRAW.can);
  fam('bottle', BOTTLE, 128, 256, DRAW.bottle);
  fam('box', BOX, 128, 128, DRAW.box);
  fam('pack', PACK, 128, 128, DRAW.pack);
  fam('cap', CAPS, 32, 32, DRAW.capsule);
  fam('price', PRICES, 96, 40, DRAW.price);
  fam('sticker', STICK, 128, 96, DRAW.sticker);
  fam('header', [['冷 COLD DRINKS', 'UMIKURA · KAPPA · NEUROFIZZ', '#0a5ad0', '#062a6a'], ['あったか HOT', 'おでん · CORN · COCOA 熱食', '#d02010', '#5a0a04'], ['SNACK 零食', 'えびせん · 海苔 · CHOCO', '#ff7a10', '#7a2a00'], ['ガチャ CAPSULE', '扭蛋 ¥200 · 1 PLAY', '#c020c0', '#3a0a5a'], ['PARTS 零件', 'CELLS · FUSES · RNDS 24H', '#2a2a2a', '#0a0a0a']], 512, 128, DRAW.header);
  cells.push(['backlit', 128, 128, DRAW.backlit], ['coin', 128, 256, DRAW.coin], ['lcd', 128, 40, DRAW.lcd], ['keypad', 16, 16, DRAW.keypad], ['push', 256, 64, DRAW.push]);
  fam('warn', [['危險 高壓', 'DANGER HIGH VOLTAGE 400V'], ['注意 CAUTION', '帯電 LIVE PARTS 勿觸']], 256, 96, DRAW.warn);
  fam('stencil', [['NDX-07', '易碎 FRAGILE ↑↑'], ['KESTREL 7-B', 'HANDLE WITH CARE 小心']], 256, 128, DRAW.stencil);
  fam('plate', PLATES, 256, 64, DRAW.plate);
  cells.push(['menuA', 512, 384, DRAW.menu([['拉麵 RAMEN', '¥680'], ['叉燒麵 CHASHU', '¥880'], ['餃子 GYOZA', '¥380'], ['啤酒 BEER', '¥450'], ['清酒 SAKE', '¥550']], '#151210', '#f0d8a0')]);
  cells.push(['menuB', 512, 384, DRAW.menu([['本日 TODAY', ''], ['味噌拉麵', '¥720'], ['辛 SPICY', '¥760'], ['替玉 EXTRA', '¥150']], '#f2e6c8', '#3a0a04')]);
  cells.push(['menuC', 512, 192, DRAW.menu([['焼鳥 YAKITORI', '¥180'], ['つくね TSUKUNE', '¥200'], ['啤酒 BEER', '¥400']], '#f2e6c8', '#5a1a08')]);
  fam('bar', BAR_LABELS, 128, 128, DRAW.barLabel);
  fam('lantern', LANTERN, 256, 128, DRAW.lantern);
  fam('goods', GOODS, 128, 128, DRAW.goods);
  cells.push(['drives', 256, 256, DRAW.drives], ['keys', 256, 96, DRAW.keys], ['tyre', 512, 64, DRAW.tyre], ['lens', 256, 32, DRAW.lens], ['vent', 128, 128, DRAW.vent], ['jdoor', 128, 192, DRAW.door]);
  // shelf packing, 2 px gutters
  const W = 2048; let x = 0, y = 0, rowH = 0;
  const at = cells.map(([, w, h]) => { if (x + w + 2 > W) { x = 0; y += rowH + 2; rowH = 0; } const r = [x + 1, y + 1, w, h]; x += w + 2; rowH = Math.max(rowH, h); return r; });
  const H = 2 ** Math.ceil(Math.log2(y + rowH + 2));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  const rects = {};
  cells.forEach(([name, w, h, draw], i) => {
    const [cx, cy] = at[i];
    g.save(); g.translate(cx, cy); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, w, h); g.restore();
    // a small inset keeps the mips of a cell from bleeding into its neighbours
    const e = 1.5;
    rects[name] = [(cx + e) / W, 1 - (cy + h - e) / H, (cx + w - e) / W, 1 - (cy + e) / H];
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  return { texture: t, rects };
}

// ---------------------------------------------------------------------------------------------------------------
/** fit a geometry's uv (0..1) into atlas rect r (a cell) */
export function uvRect(geo, r) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  return geo;
}
/** a vertex colour over the whole geometry (values above 1 are fine: the glow material reads them as intensity) */
export function tint(geo, c) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
/** uv from the height of each vertex between y0 and y1 (v) and the angle round the y axis (u): lathes and labels */
export function uvByHeight(geo, y0, y1) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2), old = geo.attributes.uv;   // a lathe keeps its own u (seam vertices doubled)
  for (let i = 0; i < p.count; i++) { uv[i * 2] = old ? old.getX(i) : (Math.atan2(p.getX(i), p.getZ(i)) / (Math.PI * 2) + 0.5); uv[i * 2 + 1] = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0))); }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export const hex = (h, k = 1) => { const c = new THREE.Color(h); return [c.r * k, c.g * k, c.b * k]; };

/** The shared kit of this world: { R (atlas rects), mats, put(batch, geo, mat, matrix, color, rect) } */
export function propKit(ctx) {
  if (ctx.shared.props) return ctx.shared.props;
  const { mat } = ctx, A = buildAtlas(), map = A.texture;
  // the surfaces under the vertex colours and the atlas (the library's, docs/surfaces.md): a near-white surface so the
  // colour a part is painted keeps its albedo, and the surface adds the grain, the roughness and the wear.
  //   paint    a satin coating (dielectric; steel at worn edges): painted sheet, boxes, frames
  //   metal    bare steel whose F0 is the vertex colour; a part coloured darker than ~0.15 is not a dark metal (a
  //            black mirror) but black powder coat: brackets, handles, bezels
  //   plastic, cardboard, wood: the parts that are those (bins, crates, slats, boxes)
  const { surf, shade, SURFACES } = surfaceLib(ctx);
  const own = { params: { map, vertexColors: true }, size: 'small' };
  const SPLIT = /* glsl */ `{ float vl = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722)), d = 1.0 - smoothstep(0.1, 0.22, vl);
    msAlb = mix(msAlb / 0.56, vec3(0.85), d); msM *= 1.0 - d; msR = mix(msR, 0.5, d); }`;
  const mats = {
    paint: shade('coat', null, own),
    metal: surf(SURFACES.metal({ metal: 'steel', variant: 'worn', roughness: 0.32 }), own, { post: SPLIT }),
    plastic: shade('plastic', null, own),
    cardboard: shade('board', null, own),
    wood: shade('sawn', null, { ...own, mapping: 'grain', grain: [1, 0, 0] }),
    concrete: surf(SURFACES.concrete({ variant: 'precast', panel: [2.4, 0.9], color: [0.82, 0.82, 0.8] }), own),
    ceramic: surf(SURFACES.ceramic({ variant: 'glazed', color: [0.85, 0.85, 0.85], roughness: 0.08 }), own),
    glow: mat.patch(new THREE.MeshBasicMaterial({ map, vertexColors: true }), { output: 'outgoingLight *= max(uLampGain, 0.06);' }),
    // a lantern: brighter where the paper faces you (the light behind it), dimmer toward the outline
    lantern: mat.patch(new THREE.MeshBasicMaterial({ map, vertexColors: true }), {
      output: '{ vec3 V = normalize(cameraPosition - mgWorldPos); float f = abs(dot(V, normalize(mgWorldNormal))); outgoingLight *= (0.25 + 1.1 * f * f) * max(uLampGain, 0.08); }',
    }),
    clear: mat.std({ map, vertexColors: true, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false }),
    // products: one instanced mesh per shape; ndLab moves each one's uv to its own label; lit by the machine inside
    // (printed cans and cartons: dielectric, the print's gloss)
    product: mat.std({ map, roughness: 0.35, metalness: 0 }, {
      vertexDecl: 'attribute vec2 ndLab;',
      vertexWorld: '#ifdef USE_MAP\n vMapUv += ndLab;\n#endif',
      emissive: 'totalEmissiveRadiance += diffuseColor.rgb * 0.5 * max(uLampGain, 0.3);',
    }),
  };
  for (const m of [mats.paint, mats.metal]) m.userData.surface = 'gravel';
  mats.wood.userData.surface = 'wood';
  const R = A.rects;
  const put = (batch, geo, m, matrix = null, color = [1, 1, 1], rect = R.white) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (rect) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); uvRect(g, rect); }
    tint(g, color);
    batch.add(g, m, matrix);
    return g;
  };
  /** an instanced set with a label per instance: items [{ m: Matrix4, lab: rect name }]; base: the rect the geometry was fitted to */
  const instanced = (geo, base, items, { name = 'products', material = mats.product } = {}) => {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(geo, material, items.length), lab = new Float32Array(items.length * 2), b = R[base];
    items.forEach((it, i) => { im.setMatrixAt(i, it.m); const r = R[it.lab] || b; lab[i * 2] = r[0] - b[0]; lab[i * 2 + 1] = r[1] - b[1]; });
    geo.setAttribute('ndLab', new THREE.InstancedBufferAttribute(lab, 2));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = name;
    im.castShadow = false; im.receiveShadow = true; im.userData.collide = false;
    return im;
  };
  return (ctx.shared.props = { R, mats, put, instanced, texture: map, names: { CAN, BOTTLE, BOX, PACK, CAPS, BAR_LABELS, LANTERN, GOODS } });
}
