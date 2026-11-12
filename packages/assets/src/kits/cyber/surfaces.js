// Mirage original code. Surfaces for a dense street (part of @miragekit/assets/kits/cyber): corrugated sheet as real
// geometry (roller shutters, container walls), a canopy, worn painted metal (chips, rust streaks under fixings, water
// stains, a wet foot) as material hooks, a shop's interior drawn by ray-casting a box behind a pane (interior mapping:
// depth without geometry), and text atlases (many labels, one texture, one draw call). No image files: every label is
// drawn into a canvas.
//   const sheet = corrugated(2.4, 2.6, { ribs: 'h' });            // a roller shutter, uv 0..1
//   const paint = ctx.mat.std({ color: 0xffffff, metalness: 0.4 }, worn('vec3(0.2, 0.35, 0.3)'));
//   const shop = interiorMaterial(ctx, { W: 2.6, H: 2.3, D: 3.2 }); // on a plane W x H behind the glass
//   const A = textAtlas([{ text: '拉麵', style: 'neon', color: '#ff2a80', w: 256, h: 128 }]);  // A.texture, A.rect(0)
import * as THREE from 'three';
import { FONT } from './kit.js';

// ---------------------------------------------------------------------------------------------------------------
/** A corrugated sheet, w (x) by h (y), facing +z, its back at z = 0. `ribs: 'h'` horizontal slats (a roller shutter,
 *  a rounded profile), 'v' vertical trapezoid ribs (a container wall). uv 0..1 over the sheet. */
export function corrugated(w, h, { pitch = 0.1, depth = 0.025, ribs = 'v' } = {}) {
  const along = ribs === 'v' ? w : h, n = Math.max(2, Math.round(along / pitch));
  // the profile across one pitch: [t 0..1, z 0..1]
  const prof = ribs === 'v' ? [[0, 0], [0.18, 0], [0.32, 1], [0.68, 1], [0.82, 0]] : [[0, 0.15], [0.12, 0.85], [0.3, 1], [0.5, 0.75], [0.62, 0.1], [0.88, 0.05]];
  const ts = [];
  for (let i = 0; i < n; i++) for (const [t, z] of prof) ts.push([(i + t) / n, z]);
  ts.push([1, prof[0][1]]);
  const pos = [], uv = [], idx = [];
  ts.forEach(([t, z], i) => {
    for (const s of [0, 1]) {
      if (ribs === 'v') { pos.push(-w / 2 + t * w, s * h, z * depth); uv.push(t, s); }
      else { pos.push(-w / 2 + s * w, t * h, z * depth); uv.push(s, t); }
    }
    if (i > 0) { const a = (i - 1) * 2, b = i * 2; if (ribs === 'v') idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const flat = g.toNonIndexed(); flat.computeVertexNormals();   // hard creases between the facets
  return flat;
}

/** A canopy: a sheet `w` wide that leaves the wall at y = 0 and drops `drop` over `d` metres out (+z), curved. */
export function canopy(w, d, drop, seg = 6) {
  const g = new THREE.PlaneGeometry(w, d, 1, seg).rotateX(-Math.PI / 2).translate(0, 0, d / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = p.getZ(i) / d; p.setY(i, -drop * (0.35 * t + 0.65 * t * t)); }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// worn paint on metal: chips to primer and bare steel, rust bleeding down from rows of fixings, water stains, a wet
// foot. `base` a GLSL vec3 (linear albedo); `rows` the spacing of the fixing rows (m); uv-free (world space).
export const WORN_DECL = /* glsl */ `
float ndWornH; float ndBare; float ndRust;
vec3 ndWorn(vec3 base, vec3 p, vec3 n, float rows, float chipAmt, float rustAmt){
  vec2 w = abs(n.x) > 0.5 ? vec2(p.z, p.y) : abs(n.z) > 0.5 ? vec2(p.x, p.y) : p.xz;
  float big = mgFbm3(p * 0.9, 2), fine = mgValue3(p * 31.0);
  // paint chips: islands of a cellular noise, a primer ring round the bare metal
  float c = mgFbm3(p * 1.4 + 5.0, 3) * 0.75 + (mgValue3(p * 7.0) - 0.5) * 0.35 + 0.18 * chipAmt * (1.0 - smoothstep(0.0, 1.2, p.y - floor(p.y / 50.0) * 50.0));
  float th = 0.62 - 0.3 * chipAmt;
  float chip = smoothstep(th, th + 0.03, c), primer = smoothstep(th - 0.07, th - 0.02, c) - chip;
  // rust: streaks running down from each row of fixings, longer where the noise says so, and the lower edge
  float row = fract(w.y / rows), bolt = step(0.75, fract(w.x / 0.55 + 0.25 * floor(w.y / rows)));
  float streak = smoothstep(0.55, 0.95, mgValue2(vec2(w.x * 7.5, floor(w.y / rows)))) * smoothstep(0.0, 0.05, 1.0 - row) * (1.0 - smoothstep(0.0, 0.85, 1.0 - row));
  streak *= 0.6 + 0.4 * mgValue2(vec2(w.x * 40.0, w.y * 2.0));
  float foot = 1.0 - smoothstep(0.0, 0.5 + 0.3 * big, p.y);
  ndRust = clamp(streak * rustAmt + chip * 0.7 * rustAmt + foot * 0.5 * rustAmt, 0.0, 1.0) * (0.6 + 0.4 * fine);
  ndBare = chip;
  vec3 rust = mix(vec3(0.16, 0.055, 0.02), vec3(0.32, 0.12, 0.04), fine);
  vec3 c0 = base * (0.82 + 0.3 * big) * (0.92 + 0.12 * fine);
  c0 = mix(c0, vec3(0.32, 0.31, 0.28), primer * 0.85);
  c0 = mix(c0, vec3(0.2, 0.2, 0.21) * (0.7 + 0.5 * fine), chip);
  c0 = mix(c0, rust, ndRust);
  // water stains: a tide line or two, darker below
  float tide = smoothstep(0.02, 0.0, abs(p.y - (0.55 + 0.25 * mgValue2(vec2(w.x * 0.7, 3.0)))));
  c0 *= 1.0 - 0.18 * tide - 0.22 * smoothstep(0.9, 0.0, p.y);
  ndWornH = 0.5 * big + 0.3 * chip - 0.2 * primer + 0.15 * fine;
  return c0;
}`;
/** hooks for a worn painted metal surface (corrugation is in the geometry) */
export const worn = (base, { rows = 0.9, chip = 0.5, rust = 0.6 } = {}) => ({
  fragmentDecl: WORN_DECL,
  albedo: `diffuseColor.rgb *= ndWorn(${base}, mgWorldPos, normalize(mgWorldNormal), ${rows.toFixed(2)}, ${chip.toFixed(2)}, ${rust.toFixed(2)});`,
  roughness: 'roughnessFactor = mix(mix(roughnessFactor, 0.45, ndBare), 0.92, ndRust);',
  metalness: 'metalnessFactor = mix(mix(metalnessFactor, 0.85, ndBare), 0.1, ndRust);',
  normal: 'normal = mgBump(normal, ndWornH, 0.004);',
});

// ---------------------------------------------------------------------------------------------------------------
/** A shop's interior seen through its window (interior mapping: a room W x H x D behind a plane, uv 0..1 over W x H,
 *  facing out of the wall, ray-cast per pixel; no geometry, one draw for every window that shares it). Which shop it is
 *  comes from a hash of where the pane stands: a convenience store (gondolas of packets, a lit fridge wall), a noodle
 *  bar (white tiles, a lit menu board, a counter and stools), a pawn shop (pegboard of goods, a glass case, dim and
 *  warm) or an arcade (rows of glowing cabinets in the dark); `kind: 'clinic'` is a cold white room (cabinets, a screen,
 *  a curtain, a privacy film on the glass). Each has its own light colour; the room is lit from its ceiling (brighter
 *  up, corners darker); blinds and posters are drawn on the glass. The keeper is a shop robot behind the counter. */
export function interiorMaterial(ctx, { W = 2.6, H = 2.3, D = 3.2, kind = 'shop' } = {}) {
  return ctx.mat.patch(new THREE.MeshBasicMaterial({ color: 0xffffff }), {
    vertexDecl: 'varying vec2 ndUv;', vertexWorld: 'ndUv = uv;',
    fragmentDecl: /* glsl */ `varying vec2 ndUv;
// goods on a shelf: packets of their own widths and heights in saturated prints, a pale label band
vec3 ndGoods(vec2 p, float rowH, float seed, out float has){
  float row = floor(p.y / rowH), sh = fract(p.y / rowH);
  float w = 0.06 + 0.1 * mgHash(vec2(row, seed * 91.0));
  float cid = floor(p.x / w), fx = fract(p.x / w);
  vec3 hc = mgHash3(vec3(cid, row, seed * 37.0));
  float tall = 0.45 + 0.4 * hc.z;
  has = step(0.12, mgHash(vec2(cid * 1.7, row + seed * 13.0))) * step(0.06, sh) * step(sh, tall) * step(0.04, fx) * step(fx, 0.96);
  vec3 c = mix(vec3(0.9, 0.2, 0.15), vec3(0.15, 0.4, 0.9), hc.x);
  c = mix(c, vec3(0.95, 0.8, 0.2), step(0.7, hc.y)); c = mix(c, vec3(0.85), step(0.88, hc.x));
  c = mix(c, vec3(0.9, 0.88, 0.82), step(abs(sh - tall * 0.55), 0.06) * 0.8);
  return c * (0.75 + 0.25 * fx);
}`,
    defines: kind === 'clinic' ? { ND_CLINIC: 1 } : {},
    output: /* glsl */ `{
      const float W = ${W.toFixed(2)}, H = ${H.toFixed(2)}, D = ${D.toFixed(2)};
      // the pane's normal from the screen-space derivatives (an unlit material gets no world normal: up)
      vec3 n = normalize(cross(dFdx(mgWorldPos), dFdy(mgWorldPos))); n.y = 0.0; n = normalize(n);
      n *= sign(dot(n, cameraPosition - mgWorldPos) + 1e-6);
      vec3 t = vec3(n.z, 0.0, -n.x);
      vec3 V = normalize(mgWorldPos - cameraPosition);
      vec3 d = vec3(dot(V, t), V.y, -dot(V, n));
      d = sign(d + 1e-6) * max(abs(d), vec3(1e-4));
      vec3 o = vec3(ndUv.x * W, ndUv.y * H, 0.0);
      vec3 org = mgWorldPos - t * o.x - vec3(0.0, o.y, 0.0);
      float seed = mgHash(floor(org.xz * 0.5 + 0.25) + 7.0);
      #ifdef ND_CLINIC
        float ty = 4.0;
        vec3 tint = vec3(0.75, 0.95, 1.0);
      #else
        float ty = floor(seed * 4.0);                     // 0 convenience, 1 noodle bar, 2 pawn shop, 3 arcade
        vec3 tint = ty < 0.5 ? vec3(0.85, 0.95, 1.0) : ty < 1.5 ? vec3(1.0, 0.72, 0.42) : ty < 2.5 ? vec3(1.0, 0.62, 0.32) : vec3(0.75, 0.35, 1.0);
      #endif
      bool conv = ty < 0.5, noodle = ty > 0.5 && ty < 1.5, pawn = ty > 1.5 && ty < 2.5, arc = ty > 2.5 && ty < 3.5;
      float s2 = fract(seed * 17.3);
      vec3 tm = (step(0.0, d) * vec3(W, H, D) - o) / d;
      float tt = min(min(tm.x, tm.y), tm.z);
      vec3 hp = o + d * tt;
      vec3 col; float emit = 0.0;
      if (tt == tm.z) {                                    // the back wall
        if (conv) {
          float has; vec3 g = ndGoods(hp.xy, 0.36, seed, has);
          float fr = step(W * 0.6, hp.x);                  // the fridge wall: lit glass doors, bottles behind
          col = mix(vec3(0.22), g, has * step(0.25, hp.y) * step(hp.y, 1.9));
          col = mix(col, vec3(0.06), smoothstep(0.03, 0.0, fract(hp.y / 0.36)) * step(0.25, hp.y) * step(hp.y, 1.95));
          float door = step(0.03, fract((hp.x - W * 0.6) / 0.6)) * step(0.15, hp.y) * step(hp.y, 2.0);
          vec3 bott = mix(vec3(0.3, 0.6, 0.25), vec3(0.8, 0.3, 0.2), mgHash(vec2(floor(hp.x / 0.07), floor(hp.y / 0.3)))) * step(0.3, fract(hp.x / 0.07)) * step(fract(hp.y / 0.3), 0.75);
          col = mix(col, mix(vec3(0.15), vec3(0.45, 0.48, 0.5) + bott, door), fr);
          emit = fr * door * 0.8;
        } else if (noodle) {
          vec2 tg = abs(fract(hp.xy / vec2(0.15, 0.075)) - 0.5);
          col = vec3(0.6, 0.58, 0.54) * (1.0 - 0.35 * step(0.44, max(tg.x, tg.y)));     // white tiles, grey grout
          vec2 mb = abs(hp.xy - vec2(W * 0.5, 1.95)) - vec2(W * 0.38, 0.22);
          float board = step(max(mb.x, mb.y), 0.0);       // the menu board: lit, rows of dishes and prices
          float line = step(0.5, fract(hp.y / 0.07)) * step(0.3, mgHash(vec2(floor(hp.x / 0.05), floor(hp.y / 0.07) + seed)));
          col = mix(col, mix(vec3(0.95, 0.85, 0.6), vec3(0.2, 0.05, 0.03), line * step(fract(hp.x / (W * 0.25)), 0.85)), board);
          emit = board * 1.2;
          float pots = step(abs(hp.y - 1.4), 0.12) * step(0.3, fract(hp.x / 0.35)) * (1.0 - board);
          col = mix(col, vec3(0.5, 0.48, 0.45) * (0.6 + 0.4 * fract(hp.x / 0.35)), pots);
        } else if (pawn) {
          vec2 pg = abs(fract(hp.xy / 0.025) - 0.5);
          col = vec3(0.32, 0.24, 0.16) * (1.0 - 0.4 * step(length(pg), 0.12));          // pegboard
          vec3 ih = mgHash3(vec3(floor(hp.xy / vec2(0.32, 0.4)), seed * 11.0));
          vec2 ic = fract(hp.xy / vec2(0.32, 0.4)) - 0.5;
          float item = step(length(ic * vec2(1.0, 0.7 + ih.z)), 0.25 + 0.15 * ih.y) * step(0.3, ih.x) * step(0.3, hp.y) * step(hp.y, 2.1);
          float longOne = step(0.85, ih.x) * step(abs(ic.x), 0.08) * step(abs(ic.y), 0.45);   // guitars, a bat
          col = mix(col, mix(vec3(0.15, 0.12, 0.1), vec3(0.75, 0.6, 0.3), ih.y) * (0.6 + 0.6 * ih.z), max(item, longOne));
        } else if (arc) {
          col = vec3(0.04, 0.02, 0.06);
          float fx = fract(hp.x / 0.7);
          float cab = step(0.12, fx) * step(fx, 0.88) * step(hp.y, 1.75);
          float scr = cab * step(0.22, fx) * step(fx, 0.78) * step(1.05, hp.y) * step(hp.y, 1.55);
          vec3 sc = 0.5 + 0.5 * cos(6.2832 * (mgHash(vec2(floor(hp.x / 0.7), seed)) + vec3(0.0, 0.33, 0.67)));
          col = mix(col, vec3(0.08, 0.07, 0.1), cab);
          col = mix(col, sc * (0.7 + 0.3 * step(0.5, fract(hp.y * 60.0 + uTime * 0.5))), scr);
          emit = scr * 2.0 + cab * step(abs(hp.y - 1.72), 0.025) * 2.0;                   // screens and marquee strips
        } else {
          col = vec3(0.62, 0.64, 0.64);
          float cabs = step(hp.x, W * 0.45) * step(hp.y, 0.95);
          col = mix(col, vec3(0.75, 0.78, 0.8) * (1.0 - 0.4 * step(0.97, fract(hp.x / 0.3)) - 0.4 * step(0.95, fract(hp.y / 0.3))), cabs);
          float scr = step(abs(hp.x - W * 0.72), 0.32) * step(abs(hp.y - 1.55), 0.2);
          col = mix(col, vec3(0.2, 0.95, 0.8) * (0.6 + 0.4 * step(0.5, fract(hp.y * 30.0))), scr); emit = scr * 1.5;
          float crt = step(abs(hp.x - W * 0.3), 0.5) * step(0.3, hp.y) * step(hp.y, 1.9) * step(0.5, s2);   // a curtain on a rail
          col = mix(col, vec3(0.55, 0.8, 0.82) * (0.8 + 0.2 * sin(hp.x * 60.0)), crt);
        }
      } else if (tt == tm.y) {
        if (d.y > 0.0) {                                   // the ceiling: tubes or panels
          float tube = arc ? step(abs(hp.z - D * 0.5), 0.04) * step(0.3, fract(hp.x / 0.8))
                           : step(abs(fract(hp.z / 1.0) - 0.5), 0.05) * step(abs(hp.x - W * 0.5), W * 0.32);
          col = vec3(arc ? 0.06 : 0.3); emit = tube * 4.0;
        } else {                                           // the floor
          vec2 g = hp.xz / (ty > 3.5 ? 0.3 : 0.4);
          float chk = mod(floor(g.x) + floor(g.y), 2.0);
          col = arc ? vec3(0.08, 0.03, 0.1) * (0.6 + 0.8 * step(0.8, mgHash(floor(hp.xz / 0.06))))           // carpet
              : pawn ? vec3(0.22, 0.15, 0.09) * (0.8 + 0.2 * sin(hp.x * 40.0 + mgHash(vec2(floor(hp.z / 0.15), 3.0)) * 9.0))   // boards
              : mix(vec3(0.16), vec3(0.26), chk) * (ty > 3.5 ? 1.6 : 1.0);
        }
      } else {                                             // the side walls
        if (conv) { float has; vec3 g = ndGoods(hp.zy, 0.36, seed + 1.0, has); col = mix(vec3(0.2), g, has * step(0.25, hp.y) * step(hp.y, 1.9)); }
        else if (noodle) { vec2 tg = abs(fract(hp.zy / vec2(0.15, 0.075)) - 0.5); col = vec3(0.58, 0.56, 0.52) * (1.0 - 0.35 * step(0.44, max(tg.x, tg.y))); }
        else if (pawn) { vec3 ih = mgHash3(vec3(floor(hp.zy / vec2(0.3, 0.35)), seed)); col = mix(vec3(0.3, 0.22, 0.15), vec3(0.6, 0.5, 0.3) * ih.y, step(0.5, ih.x) * step(length(fract(hp.zy / vec2(0.3, 0.35)) - 0.5), 0.3)); }
        else if (arc) { col = vec3(0.05, 0.02, 0.07); float pst = step(abs(fract(hp.z / 1.1) - 0.5), 0.25) * step(abs(hp.y - 1.5), 0.35); col = mix(col, 0.5 + 0.5 * cos(6.2832 * (fract(hp.z * 0.3 + seed) + vec3(0.0, 0.33, 0.67))), pst); emit = pst * 0.6; }
        else col = vec3(0.62, 0.64, 0.64);
      }
      // what stands in the room: a counter (a glass case in the pawn shop, a row of cabinets in the arcade), the
      // convenience store's gondola, the noodle bar's stools
      float zc = conv ? D * 0.3 : arc ? D * 0.45 : D * 0.42;
      float tc = (zc - o.z) / d.z;
      vec3 cp = o + d * tc;
      float x0 = conv ? W * 0.62 : W * 0.12, x1 = conv ? W * 0.97 : W * 0.88;
      float inC = step(x0, cp.x) * step(cp.x, x1) * step(cp.y, arc ? 1.7 : 1.0);
      if (arc) inC *= step(0.1, fract(cp.x / 0.7)) * step(fract(cp.x / 0.7), 0.9);
      if (tc > 0.0 && tc < tt && inC > 0.5) {
        emit = 0.0;
        if (arc) {                                         // a cabinet's back: dark, its glow spilling round it
          col = vec3(0.05, 0.04, 0.07) + vec3(0.7, 0.3, 1.0) * 0.6 * smoothstep(0.25, 0.45, abs(fract(cp.x / 0.7) - 0.5));
        } else if (pawn) {                                 // the glass case: lit inside, rings and watches
          float inside = step(0.45, cp.y) * (1.0 - step(0.85, cp.y));
          vec3 jw = mix(vec3(0.9, 0.75, 0.35), vec3(0.85), step(0.5, mgHash(floor(cp.xy / 0.05))));
          col = mix(vec3(0.1, 0.08, 0.06), jw * step(0.6, mgHash(floor(cp.xy / 0.05) + 3.0)) + vec3(0.2, 0.15, 0.1), inside);
          emit = inside * 0.6;
        } else {
          col = (noodle ? vec3(0.35, 0.18, 0.08) : vec3(0.12, 0.12, 0.13)) * (0.8 + 0.2 * step(0.96, cp.y));
        }
        tt = tc; hp = cp;
      }
      if (conv) {
        float tg2 = (D * 0.6 - o.z) / d.z; vec3 gp = o + d * tg2;
        if (tg2 > 0.0 && tg2 < tt && gp.x > W * 0.08 && gp.x < W * 0.52 && gp.y < 1.45) {
          float has; vec3 g = ndGoods(gp.xy, 0.34, seed + 5.0, has); col = mix(vec3(0.55), g, has * step(0.15, gp.y)); emit = 0.0; tt = tg2; hp = gp;
        }
      }
      if (noodle) {
        float ts = (D * 0.3 - o.z) / d.z; vec3 sp = o + d * ts;
        float stool = step(abs(fract(sp.x / 0.55) - 0.5) * 0.55, mix(0.02, 0.17, step(0.62, sp.y))) * step(sp.y, 0.7) * step(W * 0.15, sp.x) * step(sp.x, W * 0.85);
        if (ts > 0.0 && ts < tt && stool > 0.5) { col = sp.y > 0.62 ? vec3(0.6, 0.1, 0.06) : vec3(0.3); emit = 0.0; tt = ts; hp = sp; }
      }
      // the keeper is a shop robot: a pale egg body on a column, a screen head with two glyph eyes that blink, one arm
      // wiping the counter; it sways a little on its column (none in the arcade)
      if (!arc) {
        float tf = (zc + 0.3 - o.z) / d.z;
        vec3 fp = o + d * tf;
        float fx = mix(x0, x1, 0.3 + 0.4 * fract(seed * 7.3)) + 0.05 * sin(uTime * 0.31 + seed * 40.0);
        vec2 q = vec2(fp.x - fx, fp.y);
        float torso = step(length(vec2(q.x / 0.2, (q.y - 1.2) / 0.25)), 1.0), column = step(abs(q.x), 0.05) * step(q.y, 1.0);
        vec2 hq = vec2(q.x / 0.2, (q.y - 1.6) / 0.12); float head = step(length(max(abs(hq) - vec2(0.45, 0.2), 0.0)), 0.55);
        float hx = 0.2 * sin(uTime * 1.4 + seed * 9.0);
        vec2 a0 = vec2(0.17, 1.3), a1 = vec2(hx, 1.02), ab = a1 - a0; float arm = step(length(q - a0 - ab * clamp(dot(q - a0, ab) / dot(ab, ab), 0.0, 1.0)), 0.035);
        if (tf > 0.0 && tf < tt && max(max(torso, column), max(head, arm)) > 0.0) {
          col = mix(vec3(0.42, 0.43, 0.46), vec3(0.06), column * (1.0 - torso)) * (0.5 + 0.5 * smoothstep(1.0, 1.75, q.y));
          float blink = step(0.05, fract(uTime * 0.23 + seed * 3.0));
          float screen = head * step(abs(hq.x), 0.85) * step(abs(hq.y), 0.62);
          float eyes = screen * step(length(vec2(abs(q.x) - 0.065, (q.y - 1.6) * mix(8.0, 1.2, blink))), 0.03);
          col = mix(mix(col, vec3(0.02, 0.025, 0.03), screen), vec3(0.5, 1.0, 1.0), eyes);
          emit = eyes * 3.0; tt = tf; hp = fp;
        }
      }
      // the room's light: from its ceiling (brighter up, the far end and the corners darker) in its own colour; what
      // glows (tubes, screens, the fridge, the menu) adds its own
      float lit = (0.45 + 0.55 * smoothstep(-0.3, H, hp.y)) * (1.15 - 0.25 * clamp(hp.z / D, 0.0, 1.0));
      vec3 e3 = min(hp, vec3(W, H, D) - hp); e3 += step(e3, vec3(2e-3)) * 9.0;
      lit *= 0.55 + 0.45 * smoothstep(0.0, 0.45, min(min(e3.x, e3.y), e3.z));
      if (arc) lit *= 0.35;
      col = col * tint * lit + col * emit;
      // on the glass: blinds part-way down (slats backlit by the room), sale posters, the clinic's privacy film
      float blind = step(0.35, fract(seed * 5.1)) * step(H * (0.55 + 0.4 * s2), o.y) * step(0.25, fract(o.y / 0.05)) * (arc ? 0.0 : 1.0);
      col = mix(col, vec3(0.5, 0.48, 0.44) * tint * (0.35 + 0.15 * fract(o.y / 0.05)), blind);
      vec2 pp = vec2(fract(o.x / 0.62), o.y);
      float pst = step(0.6, mgHash(vec2(floor(o.x / 0.62), seed * 3.0))) * step(0.1, pp.x) * step(pp.x, 0.9) * step(0.25, pp.y) * step(pp.y, 0.95);
      vec3 pc = mix(vec3(0.9, 0.85, 0.2), vec3(0.95, 0.25, 0.2), step(0.5, fract(seed * 9.0 + floor(o.x / 0.62) * 0.37)));
      pc = mix(pc, vec3(0.08), step(0.5, fract(pp.y / 0.09)) * step(abs(pp.x - 0.5), 0.3) * step(pp.y, 0.7));
      col = mix(col, pc * (0.15 + 0.35 * tint), pst * 0.95);
      #ifdef ND_CLINIC
        col = mix(col, vec3(0.7, 0.85, 0.88) * (0.45 + 0.1 * sin(o.x * 3.0)), step(0.9, o.y) * step(o.y, 1.75) * 0.85);
      #endif
      outgoingLight = col * (0.32 * max(uLampGain, 0.35));   // (a lit room, not a light box: its walls stay below the street's signs)
    }`,
  });
}

// ---------------------------------------------------------------------------------------------------------------
/** Text labels packed in one canvas: entries [{ text: string|string[], style: 'neon'|'box'|'plate'|'way', color, bg,
 *  w, h (cell px) }] in rows. Returns { texture, rect(i) -> [u0, v0, u1, v1] }. */
export function textAtlas(entries, { width = 2048 } = {}) {
  let x = 0, y = 0, rowH = 0;
  const at = entries.map((e) => { if (x + e.w > width) { x = 0; y += rowH; rowH = 0; } const r = [x, y, e.w, e.h]; x += e.w; rowH = Math.max(rowH, e.h); return r; });
  const height = 2 ** Math.ceil(Math.log2(y + rowH));
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, width, height);
  entries.forEach((e, i) => { const [ex, ey, w, h] = at[i]; g.save(); g.translate(ex, ey); g.beginPath(); g.rect(0, 0, w, h); g.clip(); drawLabel(g, e, w, h); g.restore(); });
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return { texture, rect: (i) => { const [ex, ey, w, h] = at[i]; return [ex / width, 1 - (ey + h) / height, (ex + w) / width, 1 - ey / height]; } };
}
function fit(g, rows, w, h, weight, pad) {
  let size = (h - 2 * pad) / rows.length;
  g.font = `${weight} ${size}px ${FONT}`;
  for (const r of rows) size = Math.min(size, size * (w - 2 * pad) / Math.max(g.measureText(r).width, 1));
  return size;
}
function drawLabel(g, e, w, h) {
  const rows = [].concat(e.text), color = e.color || '#ffd23a', pad = Math.min(w, h) * 0.1;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (e.style === 'box') {          // a light box: a coloured face, dark letters, a yellow corner cut
    g.fillStyle = e.bg || color; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, w, h * 0.12);
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(w, h); g.lineTo(w - h * 0.5, h); g.lineTo(w, h * 0.5); g.fill();
    g.fillStyle = '#ffd23a'; g.beginPath(); g.moveTo(0, 0); g.lineTo(h * 0.35, 0); g.lineTo(0, h * 0.35); g.fill();
    const s = fit(g, rows, w, h, 900, pad);
    g.fillStyle = e.ink || '#101010';
    rows.forEach((r, i) => { g.font = `900 ${s * 0.9}px ${FONT}`; g.fillText(r, w / 2, pad + (h - 2 * pad) * (i + 0.5) / rows.length); });
  } else if (e.style === 'way') {   // wayfinding: yellow on black, angular, an arrow and a code box
    g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd23a';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.86, 0); g.lineTo(w, h * 0.3); g.lineTo(w, h); g.lineTo(w * 0.14, h); g.lineTo(0, h * 0.7); g.closePath(); g.lineWidth = h * 0.05; g.strokeStyle = '#ffd23a'; g.stroke();
    // chevrons
    for (let k = 0; k < 3; k++) { const x0 = w * 0.08 + k * h * 0.22; g.beginPath(); g.moveTo(x0, h * 0.25); g.lineTo(x0 + h * 0.16, h * 0.5); g.lineTo(x0, h * 0.75); g.lineTo(x0 + h * 0.08, h * 0.75); g.lineTo(x0 + h * 0.24, h * 0.5); g.lineTo(x0 + h * 0.08, h * 0.25); g.fill(); }
    const s = fit(g, rows, w * 0.62, h * 0.9, 900, pad);
    rows.forEach((r, i) => { g.font = `900 ${s * 0.9}px ${FONT}`; g.textAlign = 'left'; g.fillText(r, w * 0.32, h * 0.05 + (h * 0.9) * (i + 0.5) / rows.length); });
    g.fillRect(w * 0.32, h * 0.86, w * 0.5, h * 0.025);
  } else if (e.style === 'stencil') { // big painted numbers: transparent-free, so painted on black and used as a mask
    const s = fit(g, rows, w, h, 900, pad * 0.3);
    g.fillStyle = color;
    rows.forEach((r, i) => { g.font = `900 ${s}px ${FONT}`; g.fillText(r, w / 2, pad * 0.3 + (h - pad * 0.6) * (i + 0.5) / rows.length); });
    let s0 = 12345; const rnd = () => ((s0 = (s0 * 16807) % 2147483647) / 2147483647);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { g.globalAlpha = rnd() * 0.8; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 6, 1 + rnd() * 3); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#000'; for (let i = 0; i < 6; i++) g.fillRect(w * (0.1 + 0.8 * rnd()), 0, w * 0.012, h);   // the stencil's bridges
  } else {                          // neon: glowing letters on black
    const s = fit(g, rows, w, h, 800, pad);
    for (const [blur, a, fill] of [[pad * 0.8, 0.9, color], [pad * 0.25, 1, color], [0, 0.7, '#fff']]) {
      g.shadowColor = color; g.shadowBlur = blur; g.globalAlpha = a; g.fillStyle = fill;
      rows.forEach((r, i) => { g.font = `800 ${s * 0.9}px ${FONT}`; g.fillText(r, w / 2, pad + (h - 2 * pad) * (i + 0.5) / rows.length); });
    }
    g.shadowBlur = 0; g.globalAlpha = 1;
  }
}
/** a plane w x h facing +z whose uv shows atlas rect r */
export function atlasQuad(w, h, r) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  return g;
}
