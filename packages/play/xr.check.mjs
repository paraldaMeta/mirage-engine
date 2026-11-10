// Node checks of the XR mode's pure parts: the built-in glyph font and its rasteriser (labels without Canvas 2D),
// the hand gestures replayed on recorded joint poses (Meta's captured hand poses from iwer, hand-poses.fixture.json),
// and the allocation-free grade against its closed form.
import fs from 'node:fs';
import { FONT_SOURCE, createImage, drawText, fillRoundRect, textWidth, glyphText, canvasTextWorks, resetCanvasTextCheck } from './src/glyphs.js';
import { encode } from './scripts/glyph-font.mjs';
import { createHandGesture, handMeasures, indexRay, HAND_JOINTS } from './src/xr-hands.js';
import { setGrade, XR_FIT } from './src/xr.js';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('  ok', m); };

// ---- glyphs
ok(FONT_SOURCE === encode(), 'glyphs.js FONT is scripts/glyph-font.mjs encoded (95 glyphs, 5 x 9)');
{
  const img = createImage(400, 80);
  drawText(img, 'Pick up', 10, 40, 5.6, [246, 236, 216, 1]);
  let lit = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, partial = 0;
  for (let y = 0; y < 80; y++) for (let x = 0; x < 400; x++) {
    const a = img.data[(y * 400 + x) * 4 + 3];
    if (a > 127) { lit++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (a > 0 && a < 255) partial++;
  }
  ok(lit > 600 && partial > 100, `drawText fills the glyphs and anti-aliases their edges (${lit} solid, ${partial} edge pixels)`);
  ok(minX >= 10 && maxX < 10 + textWidth('Pick up', 5.6), `drawn within textWidth (x ${minX}..${maxX} of ${10 + textWidth('Pick up', 5.6)})`);
  // caps 7 cells centred on yMid; the descender of p goes 2 cells further
  ok(Math.abs(minY - (40 - 3.5 * 5.6)) <= 2 && Math.abs(maxY - (40 + 5.5 * 5.6)) <= 2, `caps centred on yMid, descenders below (y ${minY}..${maxY})`);
  const space = createImage(100, 40); drawText(space, '   ', 0, 20, 4, [255, 255, 255, 1]);
  ok(space.data.every((v) => v === 0), 'spaces draw nothing');
  const box = createImage(100, 60); fillRoundRect(box, 4, 4, 92, 52, 12, [27, 18, 10, 0.9]); fillRoundRect(box, 4, 4, 92, 52, 12, [255, 207, 110, 0.6], 4);
  const at = (x, y) => box.data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4);
  ok(at(50, 30)[3] === 230 && at(0, 0)[3] === 0 && at(50, 4)[0] > 150, `rounded panel: fill ${at(50, 30)}, outside ${at(0, 0)}, edge ${at(50, 4)}`);
}
ok(glyphText('Café — “key”…') === 'Cafe - "key"...' && glyphText('Ω') === '?', `non-ASCII folded without Intl ("${glyphText('Café — “key”…')}")`);
resetCanvasTextCheck();
ok(canvasTextWorks() === false, 'no canvas (Node): canvasTextWorks() is false, so labels use the glyphs');

// ---- hand gestures on recorded poses
const { poses } = JSON.parse(fs.readFileSync(new URL('./hand-poses.fixture.json', import.meta.url), 'utf8'));
ok(Object.values(poses).every((p) => p.length === HAND_JOINTS.length * 3), `${Object.keys(poses).length} recorded poses of ${HAND_JOINTS.length} joints`);
// the hand somewhere in front of the user, turned: the gestures must not depend on where the hand is
const place = (src, out) => {
  const a = 0.7, b = -0.4, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  for (let k = 0; k < src.length; k += 3) {
    const x = src[k], y = src[k + 1], z = src[k + 2];
    const x1 = x * ca + z * sa, z1 = -x * sa + z * ca, y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
    out[k] = x1 + 0.2; out[k + 1] = y1 + 1.1; out[k + 2] = z2 - 0.35;
  }
  return out;
};
const meas = (id) => handMeasures(poses[id]);
ok(meas('pinch').pinch < 0.02 && meas('ok').pinch < 0.02 && meas('default').pinch > 0.04 && meas('fist').pinch > 0.04, 'pinch distance: pinch and ok under 2 cm, relaxed and fist over 4 cm');
// a script of segments: [pose, seconds] holds; [from, to, seconds] blends (fingers move, not jump)
function run(script, gesture = createHandGesture()) {
  const j = new Float32Array(75), mix = new Float32Array(75), events = [];
  let t = 0, aimed = 0;
  for (const seg of script) {
    const [a, b, secs] = seg.length === 3 ? seg : [seg[0], seg[0], seg[1]];
    const n = Math.max(1, Math.round(secs * 60));
    for (let f = 1; f <= n; f++, t += 1 / 60) {
      const k = seg.length === 3 ? f / n : 0;
      for (let i = 0; i < 75; i++) mix[i] = poses[a][i] * (1 - k) + poses[b][i] * k;
      const ev = gesture.update(place(mix, j), t);
      if (gesture.aiming) aimed++;
      if (ev) events.push([ev, +t.toFixed(2)]);
    }
  }
  return { events, aimed, gesture };
}
let r = run([['default', 0.5], ['default', 'pinch', 0.12], ['pinch', 0.3], ['pinch', 'default', 0.12], ['default', 0.3]]);
ok(r.events.length === 1 && r.events[0][0] === 'act' && r.aimed === 0, `relaxed hand, pinch, release: one act ${JSON.stringify(r.events)}`);
r = run([['default', 0.3], ['default', 'point', 0.15], ['point', 0.6], ['point', 'pinch', 0.15], ['pinch', 0.2], ['pinch', 'default', 0.12]]);
ok(r.events.length === 1 && r.events[0][0] === 'teleport' && r.aimed > 30, `point (aims after 0.15 s), then pinch: one teleport ${JSON.stringify(r.events)}, aimed ${r.aimed} frames`);
r = run([['default', 'point', 0.15], ['point', 0.5], ['point', 'open', 0.15], ['open', 1.0], ['open', 'pinch', 0.12], ['pinch', 'open', 0.12]]);
ok(r.events.length === 1 && r.events[0][0] === 'act', `point, open the hand, pinch a second later: the aim lapsed, an act ${JSON.stringify(r.events)}`);
r = run([['default', 'point', 0.05], ['point', 'default', 0.05], ['default', 'pinch', 0.1]]);
ok(r.events.length === 1 && r.events[0][0] === 'act', `a point shorter than 0.15 s never aims: the pinch acts ${JSON.stringify(r.events)}`);
r = run([['default', 'fist', 0.2], ['fist', 0.6], ['fist', 'finger-gun', 0.2], ['finger-gun', 0.3], ['finger-gun', 'peace', 0.2], ['peace', 0.3], ['peace', 'default', 0.2]]);
ok(r.events.length === 0, `fist, finger gun, peace sign, relax: no pinch, nothing fires ${JSON.stringify(r.events)}`);
{ // tracking jitter around the thresholds: hysteresis gives one act per real pinch
  const g = createHandGesture(), j = new Float32Array(75), base = poses.default, pin = poses.pinch;
  let acts = 0, t = 0;
  for (let f = 0; f < 240; f++, t += 1 / 60) {
    const k = f < 60 ? 0 : f < 180 ? 0.86 + 0.02 * Math.sin(f * 1.7) : 0;   // hovering near 2 cm for two seconds
    for (let i = 0; i < 75; i++) j[i] = base[i] * (1 - k) + pin[i] * k;
    const d = handMeasures(j).pinch;
    if (f === 120) ok(d > 0.008 && d < 0.03, `jitter sits around the pinch threshold (${(d * 100).toFixed(1)} cm)`);
    if (g.update(j, t) === 'act') acts++;
  }
  ok(acts <= 1, `jitter at the threshold: ${acts} act (hysteresis: on under 2 cm, off over 4 cm)`);
}
{
  const ray = indexRay(poses.point, new Float32Array(6)), m = poses.point;
  ok(Math.abs(Math.hypot(ray[3], ray[4], ray[5]) - 1) < 1e-6 && ray[0] === Math.fround(m[27]) && ray[5] < -0.8, `index ray: from the fingertip along the finger (dir ${Array.from(ray.slice(3)).map((v) => v.toFixed(2))})`);
}

// ---- the grade, allocation-free, against the closed form it replaced
{
  const world = { post: { exposure: 1.1, temperature: 0.2, bloom: 0.25, bloomRadius: 0.4, saturation: 1.05, contrast: 1.02, lift: 0.01 }, exposure: 0.9, light: { warmth: 0.1 }, scene: { fog: { color: { r: 0.4, g: 0.5, b: 0.6 } } } };
  const ref = (mean) => {
    const P = world.post, E = P.exposure * world.exposure, t = P.temperature + world.light.warmth;
    const B = (P.bloom || 0) * [1.0, 0.8, 0.6, 0.4, 0.2].reduce((s, f) => s + f + (1.2 - 2 * f) * (P.bloomRadius ?? 0), 0);
    const f = mean ? { r: mean[0], g: mean[1], b: mean[2] } : world.scene.fog.color, l = 0.2126 * f.r + 0.7152 * f.g + 0.0722 * f.b;
    const veil = [f.r, f.g, f.b].map((c) => (l + (c - l) * XR_FIT.VEIL_SAT) * B * XR_FIT.VEIL);
    return Float32Array.from([E * (1 + 0.1 * t), E, E * (1 - 0.12 * t), 1 + B * XR_FIT.GAIN, ...veil, P.saturation, P.contrast, P.lift, 0, 0]);
  };
  const a = setGrade(world, { out: new Float32Array(12) }), b = setGrade(world, { mean: [0.3, 0.2, 0.1], out: new Float32Array(12) });
  ok(a.every((v, i) => v === ref(null)[i]) && b.every((v, i) => v === ref([0.3, 0.2, 0.1])[i]), 'setGrade: bit-identical to the closed form (haze and measured mean)');
}
console.log('xr checks passed');
