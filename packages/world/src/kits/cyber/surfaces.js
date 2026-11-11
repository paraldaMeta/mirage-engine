// Mirage original code. Surfaces for a dense street (part of @miragekit/world/kits/cyber): corrugated sheet as real
// geometry (roller shutters, container walls), a canopy, worn painted metal (chips, rust streaks under fixings, water
// stains, a wet foot) as material hooks, a shop's interior drawn by ray-casting a box behind a pane (interior mapping:
// depth without geometry), and text atlases (many labels, one texture, one draw call). No image files: every label is
// drawn into a canvas.
//   const sheet = corrugated(2.4, 2.6, { ribs: 'h' });            // a roller shutter, uv 0..1
//   const paint = ctx.mat.std({ color: 0xffffff, metalness: 0.4 }, worn('vec3(0.2, 0.35, 0.3)'));
//   const shop = interiorMaterial(ctx, { W: 2.6, H: 2.3, D: 3.2 }); // on a plane W x H behind the glass
//   const A = textAtlas([{ text: '拉麵', style: 'neon', color: '#ff2a80', w: 256, h: 128 }]);  // A.texture, A.rect(0)
import * as THREE from 'three';

const FONT = '"PingFang TC", "Hiragino Sans", "Noto Sans TC", "Noto Sans JP", "Microsoft JhengHei", system-ui, sans-serif';

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
/** A shop's interior seen through its window: a box `W` x `H` x `D` behind a plane (uv 0..1 over W x H, facing out of
 *  the wall), ray-cast per pixel: shelves of goods on the back wall, a lit ceiling, a tiled floor, a counter and
 *  someone behind it. The shop's look comes from a hash of where it stands. `kind`: 'shop' | 'clinic'. */
export function interiorMaterial(ctx, { W = 2.6, H = 2.3, D = 3.2, kind = 'shop' } = {}) {
  return ctx.mat.patch(new THREE.MeshBasicMaterial({ color: 0xffffff }), {
    vertexDecl: 'varying vec2 ndUv;', vertexWorld: 'ndUv = uv;',
    fragmentDecl: 'varying vec2 ndUv;',
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
      vec3 tm = (step(0.0, d) * vec3(W, H, D) - o) / d;
      float tt = min(min(tm.x, tm.y), tm.z);
      vec3 hp = o + d * tt;
      // the shop's light: warm, cool, pink or green; a clinic is cold white and cyan
      #ifdef ND_CLINIC
        vec3 tint = vec3(0.55, 0.95, 1.0);
      #else
        vec3 tint = seed < 0.4 ? vec3(1.0, 0.72, 0.42) : seed < 0.65 ? vec3(0.6, 0.85, 1.0) : seed < 0.85 ? vec3(1.0, 0.45, 0.75) : vec3(0.55, 1.0, 0.7);
      #endif
      vec3 col;
      if (tt == tm.z) {   // the back wall: shelves of goods
        float sh = fract(hp.y / 0.42), row = floor(hp.y / 0.42);
        float cellW = 0.09 + 0.12 * mgHash(vec2(row, seed * 91.0));
        float cid = floor(hp.x / cellW);
        vec3 good = 0.25 + 0.75 * mgHash3(vec3(cid, row, seed * 37.0));
        float has = step(0.25, mgHash(vec2(cid * 1.7, row + seed * 13.0))) * step(0.08, sh) * step(sh, 0.62 + 0.3 * mgHash(vec2(cid, row)));
        col = mix(vec3(0.12, 0.11, 0.1), good, has * step(0.5, hp.y) * step(hp.y, H - 0.35));
        col = mix(col, vec3(0.05), smoothstep(0.03, 0.0, sh) * step(0.5, hp.y));            // the shelf boards
        #ifdef ND_CLINIC
          float scr = step(abs(hp.x - W * 0.7), 0.4) * step(abs(hp.y - 1.6), 0.28);          // a monitor and an empty chair-shape
          col = mix(col, vec3(0.2, 1.0, 0.8) * (0.6 + 0.4 * step(0.5, fract(hp.y * 30.0))), scr);
        #endif
      } else if (tt == tm.y) {
        if (d.y > 0.0) { // the ceiling: a light panel
          float panel = step(abs(hp.x - W * 0.5), W * 0.3) * step(abs(hp.z - D * 0.45), 0.25);
          col = vec3(0.08) + tint * 4.0 * panel;
        } else {         // the floor: tiles
          vec2 g = hp.xz / 0.4; float chk = mod(floor(g.x) + floor(g.y), 2.0);
          col = mix(vec3(0.14), vec3(0.22), chk) * (1.0 - 0.5 * smoothstep(0.92, 1.0, max(abs(fract(g.x) - 0.5), abs(fract(g.y) - 0.5)) * 2.0));
        }
      } else {             // the side walls: racks
        float sh = fract(hp.y / 0.5);
        col = mix(vec3(0.1), 0.2 + 0.5 * mgHash3(vec3(floor(hp.z / 0.15), floor(hp.y / 0.5), seed)), step(0.2, sh) * step(0.6, hp.y) * step(hp.y, 2.0) * 0.8);
      }
      // the counter, and someone behind it (a silhouette)
      float tc = (D * 0.38 - o.z) / d.z;
      vec3 cp = o + d * tc;
      if (tc < tt && cp.y < 1.0 && cp.x > W * 0.15 && cp.x < W * 0.85) { col = vec3(0.07, 0.07, 0.08) + tint * 1.4 * smoothstep(0.96, 1.0, cp.y); tt = tc; }
      // the keeper is a shop robot: a pale egg body on a column, a wide screen head with two glyph eyes that blink, an
      // antenna bead, a lit band, one arm wiping the counter; it sways a little on its column
      float tf = (D * 0.62 - o.z) / d.z;
      vec3 fp = o + d * tf;
      float fx = W * (0.35 + 0.3 * fract(seed * 7.3)) + 0.05 * sin(uTime * 0.31 + seed * 40.0);
      vec2 q = vec2(fp.x - fx, fp.y);
      float torso = step(length(vec2(q.x / 0.2, (q.y - 1.2) / 0.25)), 1.0), column = step(abs(q.x), 0.05) * step(q.y, 1.0);
      vec2 hq = vec2(q.x / 0.2, (q.y - 1.6) / 0.12); float head = step(length(max(abs(hq) - vec2(0.45, 0.2), 0.0)), 0.55);
      float ant = step(abs(q.x - 0.08 - (q.y - 1.66) * 0.25), 0.007) * step(1.66, q.y) * step(q.y, 1.82), bead = step(length(q - vec2(0.12, 1.83)), 0.02);
      float hx = 0.2 * sin(uTime * 1.4 + seed * 9.0);
      vec2 a0 = vec2(0.17, 1.3), a1 = vec2(hx, 1.02), ab = a1 - a0; float arm = step(length(q - a0 - ab * clamp(dot(q - a0, ab) / dot(ab, ab), 0.0, 1.0)), 0.035);
      float shape = max(max(torso, column), max(max(head, ant), arm));
      if (tf < tt && shape > 0.0) {
        float lit = 0.5 + 0.5 * smoothstep(1.0, 1.75, q.y);                                   // the shop's ceiling light from above
        col = mix(vec3(0.42, 0.43, 0.46), vec3(0.06), column * (1.0 - torso)) * lit;
        float blink = step(0.05, fract(uTime * 0.23 + seed * 3.0));
        float screen = head * step(abs(hq.x), 0.85) * step(abs(hq.y), 0.62);
        float eyes = screen * step(length(vec2(abs(q.x) - 0.065, (q.y - 1.6) * mix(8.0, 1.2, blink))), 0.03);
        col = mix(col, vec3(0.02, 0.025, 0.03), screen);
        col += (vec3(0.5, 1.0, 1.0) * 3.0 * eyes + tint * 2.5 * step(abs(q.y - 1.12), 0.012) * torso + vec3(1.0, 0.6, 0.3) * 3.0 * bead) / (tint * 1.3 + 0.05);
        tt = tf;
      }
      // light falls off into the room; the near part catches the window's own light
      col *= tint * (1.3 - 0.18 * hp.z) + 0.05;
      col *= 0.55 + 0.45 * smoothstep(0.0, 0.3, ndUv.y);
      outgoingLight = col * (1.25 * max(uLampGain, 0.35));
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
