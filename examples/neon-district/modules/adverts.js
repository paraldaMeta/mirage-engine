// adverts: the advertising that saturates the district (plan.adverts). Every screen is drawn by a shader over a
// canvas atlas of invented brands (no image files): portrait totems on the walls at street level that change page
// with a glitch, an LED ticker that runs round the corner of block e, and a giant hologram over the plaza (a
// jellyfish selling a soda, its bell pulsing and its tentacles swaying on the scene clock, a ring of text turning
// round it). Every lit screen lights the ground through the lamp pool (one or two short lamps each).
// Nothing here is in the walk grid or the physics.
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, decor } from './lib.js';
import { detail } from './kit.js';

const FONT = '"PingFang TC", "Hiragino Sans", "Noto Sans TC", "Noto Sans JP", system-ui, sans-serif';
// [brand, tagline (vertical), small print, colours: background top, bottom, accent, ink], motif
const ADS = [
  ['UMIKURA', '海月ソーダ', '深海の一口 · ZERO SUGAR', ['#04253a', '#0a5f73', '#ff6fb5', '#e9fdff'], 'jelly'],
  ['北天 HOKUTEN', '明日を設計する', 'HEAVY INDUSTRY · 重工 · SINCE 2041', ['#121212', '#2a2a2a', '#ffd23a', '#ffd23a'], 'tri'],
  ['TSURU AIR', '空中計程車', '全線運行中 · 4 MIN TO SKYPORT', ['#2a0508', '#7a0d16', '#f4f1e8', '#f4f1e8'], 'chev'],
  ['NEUROFIZZ', 'ニューロ炭酸', 'FOCUS ×3 · 集中力', ['#140a2a', '#3d1a6e', '#b6ff3a', '#b6ff3a'], 'rings'],
  ['夢迴 DREAMLOOP', '睡眠艙 一晚¥88', 'SLEEP PODS · 夜の宿', ['#0e0820', '#38145a', '#ff8ce8', '#f8e9ff'], 'moon'],
  ['LUCKY 8', '招財 大吉', 'OPEN ALL NIGHT · 八番街', ['#2b0400', '#8a1200', '#ffd23a', '#ffd23a'], 'eight'],
  ['KAGI CLINIC', '義體 · 修理', 'NO QUESTIONS · 24H', ['#02161a', '#05434d', '#5ff7ff', '#e9fbff'], 'hex'],
  ['CLOUDSURE', '雲端保險', 'YOUR BODY · BACKED UP', ['#06142e', '#14408a', '#9fd8ff', '#ffffff'], 'cloud'],
  ['ZEPHYR-9', '義眼 オプティクス', 'SEE THE NIGHT IN 12K', ['#000000', '#1a1a1a', '#ff3b3b', '#ffffff'], 'eye'],
  ['麵屋 よるがお', '深夜ラーメン', '一杯 ¥680 · 替玉無料', ['#2a1200', '#6e3300', '#ffb347', '#fff2dc'], 'bowl'],
  ['SHIROI', '白肌 スキン', 'SYNTH-DERM · 新色', ['#2a2a30', '#7a6a78', '#ffffff', '#ffffff'], 'tri'],
  ['VOLT CELLS', '電池 快充', '9 MIN · 100%', ['#151500', '#3a3a00', '#ffd23a', '#ffd23a'], 'bolt'],
  ['第七區', '投票 VOTE', '區議會 · 11.30', ['#1a0000', '#5a0000', '#ff4040', '#ffffff'], 'chev'],
  ['KAPPA KOLA', 'カッパ · 冷', 'ICE COLD SINCE 2039', ['#2a0000', '#a00010', '#ffffff', '#ffffff'], 'rings'],
  ['MOTH 蛾', 'CLUB · 地下二階', 'LIVE TONIGHT · B2', ['#000000', '#3a0040', '#ff3cf0', '#ff3cf0'], 'moon'],
  ['新星銀行', 'NOVA BANK', 'CREDIT IN 3 SECONDS', ['#001a0c', '#00502a', '#3dff9a', '#e9fff2'], 'hex'],
];

function drawAd(g, [brand, tag, small, [c0, c1, acc, ink], motif], w, h, k) {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.save(); g.strokeStyle = acc; g.fillStyle = acc; g.lineWidth = 6; g.globalAlpha = 0.9;
  const cx = w / 2, cy = h * 0.38;
  if (motif === 'jelly') { g.beginPath(); g.arc(cx, cy, w * 0.3, Math.PI, 0); g.closePath(); g.stroke(); for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(cx - w * 0.25 + i * w * 0.083, cy); for (let y = 0; y < h * 0.25; y += 8) g.lineTo(cx - w * 0.25 + i * w * 0.083 + Math.sin(y * 0.08 + i) * 6, cy + y); g.stroke(); } }
  else if (motif === 'tri') { for (let i = 0; i < 4; i++) { g.globalAlpha = 0.25 + i * 0.2; g.beginPath(); g.moveTo(cx, cy - w * 0.38 + i * 22); g.lineTo(cx + w * 0.34 - i * 18, cy + w * 0.25); g.lineTo(cx - w * 0.34 + i * 18, cy + w * 0.25); g.closePath(); g.stroke(); } }
  else if (motif === 'chev') { for (let i = 0; i < 5; i++) { g.beginPath(); const y = cy - 80 + i * 34; g.moveTo(cx - 70, y); g.lineTo(cx, y + 26); g.lineTo(cx + 70, y); g.lineTo(cx + 70, y + 14); g.lineTo(cx, y + 40); g.lineTo(cx - 70, y + 14); g.closePath(); g.globalAlpha = 0.3 + i * 0.15; g.fill(); } }
  else if (motif === 'rings') { for (let i = 1; i < 6; i++) { g.globalAlpha = 1 - i * 0.15; g.beginPath(); g.arc(cx, cy, i * 17, 0, 7); g.stroke(); } }
  else if (motif === 'moon') { g.beginPath(); g.arc(cx, cy, 70, 0, 7); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(cx + 30, cy - 18, 62, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over'; }
  else if (motif === 'eight') { g.font = `900 ${h * 0.34}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('8', cx, cy); }
  else if (motif === 'hex') { for (let r = 30; r < 100; r += 22) { g.beginPath(); for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.globalAlpha = 1.1 - r / 100; g.stroke(); } }
  else if (motif === 'cloud') { for (const [x, y, r] of [[-40, 10, 40], [10, -15, 52], [55, 12, 36]]) { g.beginPath(); g.arc(cx + x, cy + y, r, 0, 7); g.stroke(); } }
  else if (motif === 'eye') { g.beginPath(); g.ellipse(cx, cy, 90, 44, 0, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, 30, 0, 7); g.fill(); g.fillStyle = c0; g.beginPath(); g.arc(cx, cy, 11, 0, 7); g.fill(); }
  else if (motif === 'bowl') { g.beginPath(); g.arc(cx, cy, 80, 0, Math.PI); g.closePath(); g.fill(); for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(cx - 30 + i * 30, cy - 10); g.bezierCurveTo(cx - 50 + i * 30, cy - 50, cx - 10 + i * 30, cy - 70, cx - 30 + i * 30, cy - 110); g.stroke(); } }
  else if (motif === 'bolt') { g.beginPath(); g.moveTo(cx + 20, cy - 100); g.lineTo(cx - 50, cy + 10); g.lineTo(cx, cy + 10); g.lineTo(cx - 20, cy + 100); g.lineTo(cx + 50, cy - 10); g.lineTo(cx, cy - 10); g.closePath(); g.fill(); }
  g.restore();
  // the brand, fitted; the tagline running down the right edge; small print and a code strip at the foot
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink;
  let s = h * 0.1; g.font = `900 ${s}px ${FONT}`; s = Math.min(s, s * (w * 0.86) / g.measureText(brand).width); g.font = `900 ${s}px ${FONT}`;
  g.fillText(brand, w / 2, h * 0.7);
  g.fillStyle = acc; g.font = `700 ${w * 0.07}px ${FONT}`;
  [...tag].forEach((ch, i) => g.fillText(ch, w * 0.9, h * 0.08 + i * w * 0.08));
  g.font = `600 ${w * 0.045}px ${FONT}`; g.fillStyle = ink; g.globalAlpha = 0.8; g.fillText(small, w / 2, h * 0.79, w * 0.9); g.globalAlpha = 1;
  // the yellow accent: an angled bar with a code, corner brackets, a barcode
  g.fillStyle = '#ffd23a'; g.beginPath(); g.moveTo(0, h * 0.86); g.lineTo(w * 0.62, h * 0.86); g.lineTo(w * 0.55, h * 0.9); g.lineTo(0, h * 0.9); g.fill();
  g.fillStyle = '#111'; g.font = `800 ${h * 0.025}px ui-monospace, Menlo, monospace`; g.textAlign = 'left'; g.fillText(`AD-${String(7 + k).padStart(2, '0')} / D07`, 8, h * 0.881);
  g.strokeStyle = '#ffd23a'; g.lineWidth = 4;
  for (const [x, y, dx, dy] of [[8, 8, 1, 1], [w - 8, 8, -1, 1], [8, h - 8, 1, -1], [w - 8, h - 8, -1, -1]]) { g.beginPath(); g.moveTo(x, y + dy * 26); g.lineTo(x, y); g.lineTo(x + dx * 26, y); g.stroke(); }
  g.fillStyle = ink; for (let i = 0, x = w * 0.62; x < w - 14; i++) { const bw = 1 + ((i * 7 + k * 3) % 4); g.fillRect(x, h * 0.925, bw, h * 0.04); x += bw + 2; }
}

// the screen shader: pages of the atlas by the clock, a glitch at each change and now and then, scan lines, an LED
// grid that fades with distance, a flicker. The quad's uv.x carries the screen's index in its integer part.
const SCREEN = (cols, rows, pages, gain) => /* glsl */ `{
  float id = floor(ndUv.x); vec2 u = vec2(fract(ndUv.x), ndUv.y);
  float T = uTime / 6.5 + id * 0.37, ph = fract(T);
  float page = mod(floor(T) + id * 5.0, ${pages.toFixed(1)}), prev = mod(page + ${(pages - 1).toFixed(1)}, ${pages.toFixed(1)});
  float rnd = step(0.975, mgHash(vec2(floor(uTime * 9.0), id)));
  float gl = max(step(ph, 0.06), rnd);
  float row = floor(u.y * 60.0);
  float use = mix(page, prev, gl * step(0.5, mgHash(vec2(row, floor(uTime * 24.0)))));
  u.x += gl * (mgHash(vec2(row * 1.3, floor(uTime * 30.0) + id)) - 0.5) * 0.18;
  vec2 cell = vec2(mod(use, ${cols.toFixed(1)}), ${(rows - 1).toFixed(1)} - floor(use / ${cols.toFixed(1)}));
  vec2 a = (cell + clamp(u, 0.002, 0.998)) / vec2(${cols.toFixed(1)}, ${rows.toFixed(1)});
  float dx = gl * 0.004 + 0.0006;
  vec3 c = vec3(texture2D(map, a + vec2(dx, 0.0)).r, texture2D(map, a).g, texture2D(map, a - vec2(dx, 0.0)).b);
  vec2 px = u * vec2(110.0, 220.0), f = abs(fract(px) - 0.5);
  // the LED dots and the scan lines fade to their mean before they get under ~3 px (no moire, no crawl far off)
  float dots = mix(1.0, smoothstep(0.5, 0.32, max(f.x, f.y)) * 1.25, 1.0 - smoothstep(0.18, 0.5, max(fwidth(px.x), fwidth(px.y))));
  float scan = 0.86 + 0.14 * sin(u.y * 700.0 - uTime * 5.0) * (1.0 - smoothstep(0.1, 0.3, fwidth(u.y * 111.4)));
  float flick = 0.93 + 0.07 * mgHash(vec2(floor(uTime * 22.0), id + 3.0));
  float edge = smoothstep(0.0, 0.015, u.x) * smoothstep(1.0, 0.985, u.x) * smoothstep(0.0, 0.01, u.y) * smoothstep(1.0, 0.99, u.y);
  outgoingLight = c * dots * scan * flick * edge * (1.0 + 0.6 * gl) * (${gain.toFixed(2)} * max(uLampGain, 0.16));
}`;

export default {
  name: 'adverts',
  build(ctx) {
    const { geom, root, plan, mat } = ctx, M = materials(ctx), A = plan.adverts, K = plan.levels.kerb;
    const group = new THREE.Group(); group.name = 'adverts'; decor(group);
    const backs = new geom.MeshBatch(), lit = new geom.MeshBatch();

    // ---- the atlas of portrait pages (8 x 2, 256 x 512 each)
    const PW = 256, PH = 512, cols = 8, rows = 2, c = document.createElement('canvas'); c.width = PW * cols; c.height = PH * rows;
    const g = c.getContext('2d');
    ADS.forEach((ad, i) => { g.save(); g.translate((i % cols) * PW, Math.floor(i / cols) * PH); g.beginPath(); g.rect(0, 0, PW, PH); g.clip(); drawAd(g, ad, PW, PH, i); g.restore(); });
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const screenMat = mat.patch(new THREE.MeshBasicMaterial({ map: tex }), {
      vertexDecl: 'varying vec2 ndUv;', vertexWorld: 'ndUv = uv;', fragmentDecl: 'varying vec2 ndUv;', output: SCREEN(cols, rows, ADS.length, 2.2),
    });

    // ---- totems: a portrait screen in a bevelled housing on the wall, a yellow foot plate, a lamp on the ground
    const screens = new geom.MeshBatch();
    (A.totems || []).forEach(([x, z, rotY], i) => {
      const w = Math.abs(x + 23.1) < 0.2 ? 0.78 : 1.1, h = w * 2.1, y = K + 0.75 + h / 2, m = geom.compose([x, 0, z], [0, rotY, 0]);
      const at = (p) => m.clone().multiply(geom.compose(p));
      backs.add(new geom.RoundedBoxGeometry(w + 0.16, h + 0.3, 0.2, 2, 0.04), M.blackMetal, at([0, y, 0.1]));
      backs.add(new geom.RoundedBoxGeometry(w * 0.6, 0.6, 0.16, 2, 0.03), M.darkMetal, at([0, K + 0.4, 0.08]));
      lit.add(new THREE.BoxGeometry(w + 0.16, 0.04, 0.03), M.neon.amber, at([0, y + h / 2 + 0.17, 0.2]));
      const q = new THREE.PlaneGeometry(w, h), uv = q.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, i + 0.001 + uv.getX(k) * 0.998);
      screens.add(q, screenMat, at([0, y, 0.205]));
      const out = [Math.sin(rotY), 0, Math.cos(rotY)];
      lamp(ctx, { pos: [x + out[0] * 1.0, K + 1.6, z + out[2] * 1.0], color: [0xff5cb0, 0x2fe0ff, 0xffb347, 0x9b7bff][i % 4], intensity: 4, range: 5, normal: out, back: 1.0 });
    });

    // ---- the ticker: a band of LED text round the corner of block e, scrolling on the clock
    if (A.ticker) {
      const T = A.ticker, tc = document.createElement('canvas'); tc.width = 4096; tc.height = 128;
      const tg = tc.getContext('2d'); tg.fillStyle = '#000'; tg.fillRect(0, 0, 4096, 128); tg.textBaseline = 'middle';
      const items = [['▲ HOKUTEN 北天 +3.2%', '#ffd23a'], ['◆ 今夜降雨確率 92%', '#e9f4ff'], ['◆ 第七區 23:00 計画停電', '#ff5c5c'], ['◆ UMIKURA 海月ソーダ 新発売', '#5ff7ff'],
        ['▼ NOVA BANK 新星 -1.4%', '#3dff9a'], ['◆ TSURU AIR 全線運行中', '#ffd23a'], ['◆ 夜市 NIGHT MARKET OPEN', '#ff8ce8']];
      let x = 20; tg.font = `800 84px ${FONT}`;
      for (let rep = 0; x < 4096; rep++) for (const [t, col] of items) { if (x > 4096) break; tg.fillStyle = col; tg.fillText(t, x, 66); x += tg.measureText(t).width + 70; }
      const ttex = new THREE.CanvasTexture(tc); ttex.colorSpace = THREE.SRGBColorSpace; ttex.wrapS = THREE.RepeatWrapping; ttex.anisotropy = 8;
      const rep = 32 * T.h;   // metres of band per repeat of the strip (4096 / 128 at the band's height)
      const tickMat = mat.patch(new THREE.MeshBasicMaterial({ map: ttex }), {
        vertexDecl: 'varying vec2 ndUv;', vertexWorld: 'ndUv = uv;', fragmentDecl: 'varying vec2 ndUv;',
        output: /* glsl */ `{
          vec2 px = vec2(ndUv.x / 0.035, ndUv.y * ${(T.h / 0.035).toFixed(1)}), f = abs(fract(px) - 0.5);
          vec2 cu = (mix(floor(px) + 0.5, px, smoothstep(0.18, 0.5, max(fwidth(px.x), fwidth(px.y))))) / vec2(${rep.toFixed(2)} / 0.035, ${(T.h / 0.035).toFixed(1)}) + vec2(uTime * 0.045, 0.0);
          vec3 c = texture2D(map, vec2(cu.x, mix(0.08, 0.92, cu.y))).rgb;
          float dots = mix(1.0, smoothstep(0.5, 0.3, length(f)) * 1.6, 1.0 - smoothstep(0.18, 0.5, max(fwidth(px.x), fwidth(px.y))));
          float rule = step(abs(ndUv.y - 0.5), 0.47);
          outgoingLight = (c * dots * rule + vec3(0.06, 0.04, 0.0) * dots) * (2.6 * max(uLampGain, 0.16));
        }`,
      });
      let dist = 0;
      for (let i = 0; i + 1 < T.path.length; i++) {
        const [ax, az] = T.path[i], [bx, bz] = T.path[i + 1], len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len, yaw = Math.atan2(-dz, dx);
        const nx = -dz, nz = dx, mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const q = new THREE.PlaneGeometry(len, T.h), uv = q.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setX(k, dist + uv.getX(k) * len);
        lit.add(q, tickMat, geom.compose([mx, T.y, mz], [0, yaw, 0]));
        backs.add(new THREE.BoxGeometry(len + 0.1, T.h + 0.24, 0.18), M.blackMetal, geom.compose([mx - nx * 0.1, T.y, mz - nz * 0.1], [0, yaw, 0]));
        for (const s of [-1, 1]) lit.add(new THREE.BoxGeometry(len + 0.1, 0.035, 0.03), M.neon.amber, geom.compose([mx + nx * 0.005, T.y + s * (T.h / 2 + 0.1), mz + nz * 0.005], [0, yaw, 0]));
        if (len > 6) lamp(ctx, { pos: [ax + (bx - ax) * 0.5 + nx * 1.6, T.y - 1.2, az + (bz - az) * 0.5 + nz * 1.6], color: 0xffb030, intensity: 6, range: 9, normal: [nx, 0, nz], back: 1.6 });   // one lamp a long run
        dist += len;
      }
    }
    group.add(decor(backs.finish({ name: 'advert-housings', castShadow: false })), decor(lit.finish({ name: 'advert-lit', castShadow: false })), decor(screens.finish({ name: 'advert-screens', castShadow: false })));

    // ---- the giant hologram: a jellyfish over the plaza, selling a soda
    if (A.jelly) {
      const [jx, jy, jz] = A.jelly, C = `vec3(${jx.toFixed(1)}, ${jy.toFixed(1)}, ${jz.toFixed(1)})`;
      const holo = (tint, gain, wave, side = THREE.DoubleSide) => mat.patch(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side, fog: false }), {
        vertexWorld: wave === 'bell'
          ? `{ vec3 r = mgWorld - ${C}; float k = 1.0 + 0.07 * sin(uTime * 1.25 - r.y * 0.25); mgWorld = ${C} + vec3(r.x * k, r.y * (2.0 - k), r.z * k); }`
          : `{ vec3 r = mgWorld - ${C}; float d = max(-r.y - 0.5, 0.0), a = atan(r.z, r.x);
               mgWorld.x += sin(uTime * 0.9 + d * 0.32 + a * 3.0) * d * 0.07; mgWorld.z += cos(uTime * 0.7 + d * 0.27 + a * 2.0) * d * 0.07;
               float k = 1.0 + 0.07 * sin(uTime * 1.25 + 0.5); mgWorld.xz = ${C}.xz + (mgWorld.xz - ${C}.xz) * mix(k, 1.0, clamp(d / 6.0, 0.0, 1.0)); }`,
        output: /* glsl */ `{
          vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal), r = mgWorldPos - ${C};
          float rim = pow(1.0 - abs(dot(V, N)), 1.6);
          float mer = smoothstep(0.86, 1.0, cos(atan(r.z, r.x) * 16.0)) * step(-1.0, r.y);
          float scan = 0.6 + 0.4 * sin(mgWorldPos.y * 7.0 - uTime * 4.0);
          float pulse = 0.5 + 0.5 * sin(uTime * 1.25 - r.y * 0.25);
          float flick = 0.85 + 0.15 * step(0.08, mgHash(vec2(floor(uTime * 12.0), 9.0)));
          vec3 col = mix(vec3(1.0, 0.25, 0.7), ${tint}, smoothstep(-14.0, 3.0, r.y));
          outgoingLight = col * (0.12 + 0.9 * rim + 0.7 * mer + 0.25 * pulse) * scan * flick * (${gain.toFixed(2)} * max(uLampGain, 0.05));
        }`,
      });
      const J = new THREE.Group(); J.name = 'jelly-hologram'; decor(J);
      const bellMat = holo('vec3(0.2, 0.9, 1.0)', 1.0, 'bell'), armMat = holo('vec3(0.4, 0.8, 1.0)', 0.9, 'arm', THREE.FrontSide);
      const bell = new THREE.Mesh(geom.lathe([[0.01, 3.4], [2.6, 3.15], [4.9, 2.3], [6.5, 0.9], [7.1, -0.4], [6.7, -1.0], [6.2, -0.7]], 56), bellMat);
      const inner = new THREE.Mesh(geom.lathe([[0.01, 1.8], [2.2, 1.6], [3.6, 0.6], [3.9, -0.6]], 40), holo('vec3(1.0, 0.5, 0.9)', 0.6, 'bell', THREE.BackSide));
      bell.position.set(jx, jy, jz); inner.position.set(jx, jy, jz);
      J.add(bell, inner);
      const D = detail(ctx), arms = new geom.MeshBatch();
      const nT = Math.round(28 * Math.max(0.5, D));
      for (let i = 0; i < nT; i++) {   // tentacles from the rim
        const a = (i / nT) * Math.PI * 2, L = 15 + 4 * Math.sin(i * 2.7), pts = [];
        for (let k = 0; k <= 10; k++) { const t = k / 10, rr = 6.6 - t * 1.5; pts.push([jx + Math.cos(a) * rr + Math.sin(t * 6 + i) * 0.4, jy - 0.9 - t * L, jz + Math.sin(a) * rr]); }
        arms.add(geom.taperedTube(pts, (t) => 0.09 * (1 - t) + 0.02, { radial: 4, segments: 24 }), armMat);
      }
      for (let i = 0; i < 4; i++) {    // four frilled oral arms from the centre
        const a = (i / 4) * Math.PI * 2 + 0.4, pts = [];
        for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([jx + Math.cos(a) * (0.8 + t * 1.6) + Math.sin(t * 9 + i) * 0.5, jy - 0.5 - t * 12, jz + Math.sin(a) * (0.8 + t * 1.6) + Math.cos(t * 7 + i) * 0.5]); }
        arms.add(geom.taperedTube(pts, (t) => 0.55 * (1 - t) + 0.12, { radial: 6, segments: 36 }), armMat);
      }
      const armMesh = arms.finish({ name: 'jelly-arms', castShadow: false });
      J.add(armMesh);
      // a ring of text turning round the bell
      const rc = document.createElement('canvas'); rc.width = 2048; rc.height = 128;
      const rg = rc.getContext('2d'); rg.fillStyle = '#000'; rg.fillRect(0, 0, 2048, 128); rg.font = `900 86px ${FONT}`; rg.textBaseline = 'middle';
      rg.fillStyle = '#7ff6ff'; rg.fillText('UMIKURA  海月ソーダ  ◆  深海の一口  ◆  ', 20, 66);
      rg.fillStyle = '#ff7fc8'; rg.fillText('ZERO', 1780, 66);
      const rtex = new THREE.CanvasTexture(rc); rtex.colorSpace = THREE.SRGBColorSpace; rtex.wrapS = THREE.RepeatWrapping; rtex.repeat.x = 2;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 1.6, 72, 1, true), mat.patch(new THREE.MeshBasicMaterial({ map: rtex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
        { output: 'outgoingLight *= (0.8 + 0.2 * sin(mgWorldPos.y * 30.0 - uTime * 6.0)) * 2.4 * max(uLampGain, 0.05);' }));
      ring.position.set(jx, jy - 3.2, jz); ring.rotation.x = 0.06;
      J.add(ring);
      for (const o of J.children) { o.castShadow = o.receiveShadow = false; o.userData.occlude = false; o.frustumCulled = false; o.traverse((c2) => { c2.frustumCulled = false; c2.userData.occlude = false; }); }
      root.add(J);
      ctx.onUpdate((t) => { bell.rotation.y = t * 0.05; inner.rotation.y = -t * 0.08; ring.rotation.y = -t * 0.12; });
      lamp(ctx, { pos: [jx, 11, jz], color: 0x9a90ff, intensity: 5, range: 15 });
    }
    root.add(group);
  },
};
