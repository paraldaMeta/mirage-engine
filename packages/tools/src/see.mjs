// Mirage original code. Two page-side checks for a shot that renders without error but may not show what it should.
// Both functions run inside the page (page.evaluate serialises them), so they use nothing from this module's scope.
//
// seeInPage(names): which share of the frame each named object covers, from an ID pass. Every visible mesh is
//   drawn once with a flat colour that encodes its index (no lights, fog, post or tone mapping, into an 8-bit
//   target without MSAA), at most 480 px wide, from the world camera. An object counts for name N when it or an
//   ancestor is called N (a module's root carries the module's name; `N:finalize` counts as N). Wind and other
//   vertex hooks are kept (the ID material is patched with the original's hooks) and so is alpha-tested foliage.
//   Transparent surfaces (glass, water) do not hide what is behind them; points, lines and sprites (rain, stars)
//   are left out. For each name it also draws the object alone, which tells "out of frame / too small" apart from
//   "hidden behind something" and names what is in front.
//   -> { w, h, ms, names: { N: { share, alone, objects, occluders: [[label, share of the alone pixels]] } } }
//      or { error } when a name matches no mesh (with the names that exist).
// frameStatsInPage(dataUrl): mean luma and the share of near-black / near-white pixels of a PNG, on a 64 x 64
//   copy. The thresholds (luma below 5/255 on 98 % of the frame = black, above 250/255 on 35 % = clipped) follow
//   67js (MIT, codepawl/67.js src/frame-checks.js).

export const DARK_SHARE = 0.98, CLIPPED_SHARE = 0.35;

/** Words for a `see` result an agent can act on. */
export function seeWhy(r, need) {
  if (!r) return '';
  const pct = (v) => (100 * v).toFixed(v < 0.01 ? 2 : 1) + ' %';
  if (r.alone === 0) return 'out of frame (nothing of it is in view even with everything else removed)';
  const hid = 1 - r.share / r.alone;
  const front = r.occluders.slice(0, 3).map(([n, s]) => `${n} ${pct(s)}`).join(', ');
  if (r.share === 0) return `hidden: ${pct(r.alone)} of the frame with nothing in front, all of it covered by ${front}`;
  if (hid > 0.5) return `mostly hidden (${pct(hid)} of it) by ${front}`;
  if (need !== undefined && r.alone < need) return `too small: ${pct(r.alone)} of the frame even with nothing in front; move closer or frame it`;
  return `${pct(r.share)} of the frame` + (front ? `; in front of it: ${front}` : '');
}

export function seeInPage(names) {
  const t0 = performance.now();
  const { play } = window.__mirage, w = play.world, T = w.ctx.THREE, r = w.renderer, scene = w.scene, cam = w.camera;
  const gl = r.getContext(), W = Math.min(480, gl.drawingBufferWidth), H = Math.max(1, Math.round((W * gl.drawingBufferHeight) / gl.drawingBufferWidth));
  const label = (o) => {
    const chain = []; for (let p = o; p && p !== scene; p = p.parent) if (p.name) chain.push(p.name);
    const mod = chain.at(-1) || '(unnamed)', leaf = chain[0];
    return leaf && leaf !== mod ? `${mod}/${leaf}` : mod;
  };
  const matches = (o, n) => { for (let p = o; p && p !== scene; p = p.parent) if (p.name === n || p.name === n + ':finalize') return true; return false; };
  const meshes = [], hide = [];
  scene.traverseVisible((o) => {
    if (o.isPoints || o.isLine || o.isSprite || o === w.sky || o === w.stars) { hide.push(o); return; }
    if (!o.isMesh || !o.layers.test(cam.layers)) return;
    const ms = [o.material].flat();
    if (ms.every((m) => !m || m.visible === false || m.colorWrite === false)) { hide.push(o); return; }
    meshes.push(o);
  });
  const want = {};
  for (const n of names) {
    want[n] = new Set(meshes.filter((o) => matches(o, n)));
    if (!want[n].size) {
      const all = new Set(); scene.traverse((o) => { if (o.name) all.add(o.name.replace(/:finalize$/, '')); });
      return { error: `see: nothing visible is called "${n}". Names in the scene: ${[...all].slice(0, 40).join(', ')}` };
    }
  }
  // the ID materials; index k + 1 (0 = nothing) in RGB, linear so it reads back exactly
  const saved = [], made = [];
  const idMaterial = (m, k, see) => {
    const id = new T.MeshBasicMaterial({ fog: false, toneMapped: false, side: m.side, depthWrite: !see });
    id.color.setRGB(((k + 1) & 255) / 255, (((k + 1) >> 8) & 255) / 255, (((k + 1) >> 16) & 255) / 255, T.LinearSRGBColorSpace);
    if (m.alphaTest > 0 || m.alphaHash) Object.assign(id, { map: m.map || null, alphaMap: m.alphaMap || null, alphaTest: m.alphaTest, alphaHash: !!m.alphaHash });
    const h = (m.userData && m.userData.hooks) || {}, hooks = { output: 'outgoingLight = diffuse;' };
    for (const k of ['vertexDecl', 'vertexWorld', 'uniforms', 'defines']) if (h[k]) hooks[k] = h[k];   // patch() reads only keys that are set
    w.mat.patch(id, hooks);
    made.push(id); return id;
  };
  const clear = new Set();   // transparent surfaces: seen where they are in front, but they hide nothing behind them
  meshes.forEach((o, k) => {
    const ms = [o.material].flat(), see = ms.some((m) => m.transparent || m.depthWrite === false || (m.transmission || 0) > 0);
    saved.push([o, o.material, o.renderOrder]);
    const ids = ms.map((m) => idMaterial(m, k, see));
    o.material = Array.isArray(o.material) ? ids : ids[0];
    if (see) { o.renderOrder = 1e9; clear.add(o); }   // after the solid ones, depth-tested, no depth write
  });
  for (const o of hide) o.visible = false;
  const keep = { target: r.getRenderTarget(), autoClear: r.autoClear, clear: r.getClearColor(new T.Color()), alpha: r.getClearAlpha(),
    shadow: r.shadowMap.autoUpdate, bg: scene.background, env: scene.environment, over: scene.overrideMaterial, view: cam.view && cam.view.enabled ? { ...cam.view } : null };
  const rt = new T.WebGLRenderTarget(W, H, { depthBuffer: true }), nothing = new T.MeshBasicMaterial({ visible: false });
  const px = new Uint8Array(W * H * 4);
  const pass = () => {
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, cam);
    r.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const ids = new Uint32Array(W * H);
    for (let i = 0; i < ids.length; i++) ids[i] = px[4 * i] | (px[4 * i + 1] << 8) | (px[4 * i + 2] << 16);
    return ids;
  };
  const out = { w: W, h: H, names: {} };
  try {
    Object.assign(scene, { background: null, environment: null, overrideMaterial: null });
    r.shadowMap.autoUpdate = false; r.autoClear = true;
    if (keep.view) cam.clearViewOffset();
    // two layers per pixel: the nearest solid surface, and the nearest transparent one in front of it (or the same)
    const off = (keepIn) => { const m = new Map(meshes.map((o) => [o, o.material])); for (const o of meshes) if (!keepIn(o)) o.material = Array.isArray(o.material) ? o.material.map(() => nothing) : nothing; return () => { for (const [o, x] of m) o.material = x; }; };
    let back = off((o) => !clear.has(o));
    const solid = pass(); back();
    const top = clear.size ? pass() : solid;
    for (const n of names) {
      const set = want[n], index = new Set(meshes.map((o, k) => (set.has(o) ? k + 1 : 0)).filter(Boolean));
      // the others draw nothing (material.visible, not object.visible: that would also hide a target below them)
      back = off((o) => set.has(o));
      const alone = pass(); back();
      let seen = 0, solo = 0; const front = new Map();
      for (let i = 0; i < solid.length; i++) {
        const hit = index.has(solid[i]) || index.has(top[i]);
        if (hit) seen++;
        if (index.has(alone[i])) { solo++; if (!hit && solid[i]) front.set(solid[i], (front.get(solid[i]) || 0) + 1); }
      }
      const by = new Map();
      for (const [id, c] of front) { const l = label(meshes[id - 1]); by.set(l, (by.get(l) || 0) + c); }
      out.names[n] = { share: +(seen / solid.length).toFixed(5), alone: +(solo / solid.length).toFixed(5), objects: set.size,
        occluders: [...by].sort((a, b) => b[1] - a[1]).filter(([, c]) => c / solo >= 0.0005).slice(0, 5).map(([l, c]) => [l, +(c / solo).toFixed(3)]) };
    }
  } finally {
    for (const [o, m, ro] of saved) { o.material = m; o.renderOrder = ro; }
    for (const o of hide) o.visible = true;
    for (const m of made) m.dispose();
    rt.dispose(); nothing.dispose();
    Object.assign(scene, { background: keep.bg, environment: keep.env, overrideMaterial: keep.over });
    r.shadowMap.autoUpdate = keep.shadow; r.autoClear = keep.autoClear;
    r.setClearColor(keep.clear, keep.alpha); r.setRenderTarget(keep.target);
    if (keep.view) cam.setViewOffset(keep.view.fullWidth, keep.view.fullHeight, keep.view.offsetX, keep.view.offsetY, keep.view.width, keep.view.height);
  }
  out.ms = +(performance.now() - t0).toFixed(1);
  return out;
}

export async function frameStatsInPage(dataUrl) {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  let sum = 0, dark = 0, clipped = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    sum += l; if (l < 5) dark++; if (l > 250) clipped++;
  }
  const n = d.length / 4;
  return { luma: +(sum / n).toFixed(1), dark: +(dark / n).toFixed(3), clipped: +(clipped / n).toFixed(3) };
}
