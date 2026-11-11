// Mirage original code. Page-side probes behind the diagnostics (diagnostics.mjs turns their numbers into words):
//
//   worldChecks(page)  at load: the spawn and every plan viewpoint against the walk grid (eye or body inside a solid,
//                      no floor, dropping on load), objects floating above the floor under them, coplanar surfaces
//                      (z-fighting), what each viewpoint shows (nothing, one surface, none of its subjects), the light.
//   probe(page, o)     after a failed step: why the walker stopped (narrow opening, high step, low ceiling, the object
//                      in the way) or why it walked on (the barrier it crossed and why the walk grid ignores it, or
//                      the gap in the geometry), and where a `see` subject is and where to look from.
//
// The functions named *InPage run inside the page (page.evaluate serialises them): they use nothing from this
// module's scope except what is passed in. classifyEye and freeSpot are pure (any grid with layers / support / idx,
// e.g. makeGrid from @miragekit/play/walkgrid) and are passed into the page as source text, so node tests run them too.

const BODY = { eye: 1.62, head: 1.8, step: 0.4, radius: 0.28 };

/** Where an eye stands in the walk grid. walk: the body (feet = eye - 1.62, head room 1.8, step 0.4) must fit;
 *  otherwise only the eye point must be in air. -> { state: ok | inside | head | floating | nofloor | outside | unknown, ... } */
export function classifyEye(grid, eye, walk, yMax = Infinity) {
  const [x, y, z] = eye;
  if (grid.idx(x, z) < 0) return { state: 'outside' };
  const L = grid.layers(x, z);
  if (!L.length) return { state: 'nofloor' };
  const r = (v) => +v.toFixed(2);
  if (walk) {
    const feet = y - 1.62, s = grid.support(x, z, feet, 0.4);
    if (!s) return { state: 'inside', floors: L.map(([f]) => r(f)), top: r(L[L.length - 1][0]) };
    if (s[1] < y + 0.05) return { state: 'head', floor: r(s[0]), ceil: r(s[1]) };
    if (feet - s[0] > 0.5) return { state: 'floating', floor: r(s[0]), drop: r(feet - s[0]) };
    return { state: 'ok', floor: r(s[0]) };
  }
  if (y > yMax) return { state: 'unknown' };
  if (L.some(([f, c]) => y >= f && y <= c)) return { state: 'ok' };
  return { state: 'inside', floors: L.map(([f]) => r(f)), top: r(L[L.length - 1][0]) };
}

/** The nearest spot within 4 m where the eye fits (walk: a body on a floor near the same height; else air at the
 *  same height), as an eye [x, y, z], or null. With `look` (the point the eye looks at) a spot must also do what the
 *  eye is for, because agents apply the fix as written (the repair eval caught both): it sees `look` through air,
 *  and a walking body can walk 1.5 m toward it. The nearest spot that only fits is used when none does more; then
 *  the result carries `fitsOnly: true`. -> [x, y, z] (+ .fitsOnly) or null */
export function freeSpot(grid, eye, walk, yMax = Infinity, { look = null } = {}) {
  const [x, y, z] = eye, feet = y - 1.62;
  const cell = grid.cell || 0.125, R = 0.28 + 0.12, n = Math.ceil(R / cell), disc = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (Math.hypot(i, j) * cell <= R) disc.push([i * cell, j * cell]);
  const air = (px, py, pz) => { if (grid.idx(px, pz) < 0) return true; const L = grid.layers(px, pz); return !L.length || L.some(([f, c]) => py >= f && py <= c); };
  // the eye sees the look point: air all the way, stopping 0.8 m short (the look point is often inside its subject)
  const sees = (ex, ey, ez) => {
    const dx = look[0] - ex, dy = look[1] - ey, dz = look[2] - ez, d = Math.hypot(dx, dy, dz);
    for (let t = 0.2; t < d - 0.8; t += 0.2) if (!air(ex + (dx * t) / d, ey + (dy * t) / d, ez + (dz * t) / d)) return false;
    return true;
  };
  const fitsAt = (px, pz) => {
    if (grid.idx(px, pz) < 0) return null;
    if (!walk) { const L = grid.layers(px, pz); return y <= yMax && L.some(([f, c]) => y >= f + 0.3 && y <= c - 0.3) ? y : null; }
    // the walker's own test (walker.js fits): every grid cell of a disc of its radius, here with 0.12 m to spare.
    // Four probes at 0.3 m (the first version) passed a spot 0.19 m from a crate, where the walker was wedged.
    let floor = -Infinity;
    for (const [dx, dz] of disc) {
      const s = grid.support(px + dx, pz + dz, feet, 0.4);
      if (!s || s[1] < Math.max(feet, s[0]) + 1.8 || Math.abs(s[0] - feet) > 0.45) return null;
      floor = Math.max(floor, s[0]);
    }
    return floor + 1.62;
  };
  // a walking body can walk 1.5 m toward the look point from here
  const walksAhead = (px, pz) => {
    let dx = look[0] - px, dz = look[2] - pz; const d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    dx /= d; dz /= d;
    for (let t = 0.25; t <= Math.min(1.5, d - 0.5) + 1e-6; t += 0.25) if (fitsAt(px + dx * t, pz + dz * t) === null) return false;
    return true;
  };
  let fallback = null;
  for (let r = 0.25; r <= 4.001; r += 0.25) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.25));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI, px = x + r * Math.cos(a), pz = z + r * Math.sin(a), ey = fitsAt(px, pz);
      if (ey === null) continue;
      const spot = [+px.toFixed(2), +ey.toFixed(2), +pz.toFixed(2)];
      if (!look || (sees(px, ey, pz) && (!walk || walksAhead(px, pz)))) return spot;
      if (!fallback) fallback = spot;
    }
  }
  if (fallback) fallback.fitsOnly = true;
  return fallback;
}

/** Load-time checks in the page; returns raw findings (see worldDiagnostics in diagnostics-world.mjs). */
export function worldChecksInPage(opts, lib) {
  const t0 = performance.now();
  const { play, built } = window.__mirage, w = play.world, T = w.ctx.THREE, scene = w.scene, grid = play.grid;
  const plan = (built && built.plan) || null;
  const out = { ms: 0, eyes: [], floating: [], zfight: [], views: [], light: null };
  out.light = { postExposure: w.post && w.post.exposure, autoExposure: w.exposure !== undefined ? +(+w.exposure).toFixed(4) : undefined,
    sunElevation: w.state && w.state.sun ? +w.state.sun.elevation.toFixed(1) : undefined, lamp: w.light ? +(+w.light.lamp).toFixed(2) : undefined };
  if (!plan) { out.ms = +(performance.now() - t0).toFixed(1); return out; }
  const classifyEye = lib.classifyEye, freeSpot = lib.freeSpot;
  const yMax = plan.walk ? plan.walk.yMax : 12;
  const label = (o) => {
    const chain = []; for (let p = o; p && p !== scene; p = p.parent) if (p.name) chain.push(p.name);
    const mod = (chain.at(-1) || '(unnamed)').replace(/:finalize$/, ''), leaf = chain[0];
    return leaf && leaf !== chain.at(-1) ? `${mod}/${leaf}` : mod;
  };
  const moduleOf = (o) => label(o).split('/')[0];
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible || p.userData.collide === false) return false; return true; };
  const visibleChain = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const solids = [], visibles = [];
  scene.traverse((o) => {
    if (!o.isMesh || o === w.sky || o === w.stars || o.isSkinnedMesh) return;
    const ms = [o.material].flat();
    if (o.userData.collider) { solids.push(o); return; }
    if (!visibleChain(o) || ms.every((m) => !m || m.visible === false || m.colorWrite === false)) return;
    visibles.push(o);
    if (shown(o) && (o.layers.mask & 1) && ms.some((m) => m && m.depthWrite !== false && !m.transparent)) solids.push(o);
  });
  const boxOf = new Map(), box = (o) => { let b = boxOf.get(o); if (!b) { b = new T.Box3().setFromObject(o); boxOf.set(o, b); } return b; };
  const r2 = (v) => +(+v).toFixed(2), P = (v) => [r2(v.x), r2(v.y), r2(v.z)];

  // ---- the spawn and the viewpoints against the walk grid
  const views = [];
  if (plan.spawn) views.push({ path: 'spawn', name: 'spawn', v: plan.spawn, mode: plan.spawn.mode || 'walk' });
  (plan.viewpoints || []).forEach((v, i) => {
    const above = v.eye[1] - (grid.groundAt(v.eye[0], v.eye[2], v.eye[1]) || 0);
    views.push({ path: `viewpoints[${i}]`, name: v.name || `view ${i}`, v, mode: v.mode || (above > 3 ? 'fly' : 'walk') });
  });
  for (const e of views) {
    const walk = e.mode === 'walk' || e.mode === 'game';
    const c = classifyEye(grid, e.v.eye, walk, yMax);
    if (c.state === 'ok' || c.state === 'unknown' || (!walk && c.state !== 'inside')) continue;   // a free camera may hang over void
    const row = { path: e.path, name: e.name, mode: e.mode, eye: e.v.eye, ...c };
    if (c.state === 'inside' || c.state === 'head') {
      // which solid: the smallest box holding the eye (or the body's middle)
      const p = new T.Vector3(e.v.eye[0], walk && c.state === 'inside' ? e.v.eye[1] - 1.0 : e.v.eye[1], e.v.eye[2]);
      const hold = solids.filter((o) => box(o).containsPoint(p)).sort((a, b) => { const s = (o) => { const v = box(o).getSize(new T.Vector3()); return v.x * v.y * v.z; }; return s(a) - s(b); });
      if (hold.length) row.inside = label(hold[0]);
      row.free = freeSpot(grid, e.v.eye, walk, yMax, { look: e.v.look || null });
      if (row.free && row.free.fitsOnly) row.freeFitsOnly = true;
    }
    out.eyes.push(row);
  }

  // ---- floating objects: every sampled column under the object has a gap >= 0.25 m to the floor below it,
  // nothing touches it from the side, nothing is just above it (hanging), and it is not marked userData.float
  if (opts.floating !== false) {
    const [bx0, bz0, bx1, bz1] = plan.bounds;
    const ray = new T.Raycaster(), DOWN = new T.Vector3(0, -1, 0);
    for (const o of solids) {
      if (o.userData.collider) continue;
      let marked = false; for (let p = o; p; p = p.parent) if (p.userData.float) marked = true;
      if (marked) continue;
      const b = box(o), size = b.getSize(new T.Vector3());
      if (!Number.isFinite(b.min.y) || size.x * size.z < 0.01 || b.min.y > yMax || b.min.y < (plan.walk ? plan.walk.yMin : -1)) continue;
      if (b.min.x < bx0 || b.max.x > bx1 || b.min.z < bz0 || b.max.z > bz1) continue;
      const nx = Math.min(8, Math.max(2, Math.ceil(size.x / 0.25))), nz = Math.min(8, Math.max(2, Math.ceil(size.z / 0.25)));
      let gap = Infinity, floorAt = null;
      for (let i = 0; i < nx && gap >= 0.25; i++) for (let j = 0; j < nz; j++) {
        const x = b.min.x + ((i + 0.5) / nx) * size.x, z = b.min.z + ((j + 0.5) / nz) * size.z;
        let f = grid.groundAt(x, z, b.min.y + 0.02, 0);
        // the walk grid keeps no air thinner than its MIN_GAP (0.3 m): no floor under a box 0.3 m up is still a gap,
        // measured with a ray down to the first other solid (from just above the bottom: a ray that starts inside a
        // supporting box would not see that box's top face)
        if (Number.isNaN(f)) { ray.set(new T.Vector3(x, b.min.y + 0.01, z), DOWN); const hit = ray.intersectObjects(solids, false).find((h) => h.object !== o && !o.getObjectById(h.object.id)); if (hit) f = hit.point.y; }
        const g = Number.isNaN(f) ? 0 : b.min.y - f;
        if (g < gap) { gap = g; floorAt = f; }
        if (gap < 0.25) break;
      }
      if (!(gap >= 0.25) || gap === Infinity) continue;
      // hanging: a solid within 1.5 m above its top at the centre
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const above = grid.layers(cx, cz).find(([f]) => f > b.max.y + 0.05);
      const lay = grid.layers(cx, cz).find(([f, c]) => f <= b.max.y + 0.05 && c > b.max.y);
      if ((lay && lay[1] - b.max.y < 1.5) || (above && above[0] - b.max.y < 1.5 && !lay)) continue;
      // touching another solid from the side (a balcony on a wall, a roof on walls)
      const grown = b.clone().expandByScalar(0.05);
      if (solids.some((q) => q !== o && !q.userData.collider && box(q).intersectsBox(grown) && box(q).max.y > b.min.y + 0.02 && !o.getObjectById(q.id) && !q.getObjectById(o.id))) continue;
      out.floating.push({ label: label(o), module: moduleOf(o), bottom: r2(b.min.y), floor: r2(floorAt), gap: r2(gap), center: [r2(cx), r2(b.min.y), r2(cz)], size: P(size) });
    }
  }

  // ---- coplanar surfaces: flat-ish solids (slabs, tiles, rugs, decals) whose top coincides with another surface
  if (opts.zfight !== false) {
    const rc = new T.Raycaster(); rc.layers.enableAll();
    const down = new T.Vector3(0, -1, 0), seen = new Set(), n = new T.Vector3();
    const opaque = solids.filter((o) => !o.userData.collider && ![o.material].flat().some((m) => m.polygonOffset));
    for (const o of opaque) {
      const b = box(o), size = b.getSize(new T.Vector3());
      if (size.y > 0.3 || size.x * size.z < 0.25) continue;
      const others = opaque.filter((q) => q !== o && box(q).max.y >= b.max.y - 0.01 && box(q).min.y <= b.max.y + 0.01 && box(q).intersectsBox(b));
      if (!others.length) continue;
      for (const [fx, fz] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const x = b.min.x + fx * size.x, z = b.min.z + fz * size.z;
        rc.set(new T.Vector3(x, b.max.y + 0.5, z), down);
        const h = rc.intersectObject(o, false)[0];
        if (!h || !h.face || n.copy(h.face.normal).transformDirection(o.matrixWorld).y < 0.9) continue;
        for (const q of others) {
          const k = [o.id, q.id].sort().join('-');
          if (seen.has(k)) continue;
          const hq = rc.intersectObject(q, false).find((i) => Math.abs(i.point.y - h.point.y) < 0.003);
          if (hq && hq.face && n.copy(hq.face.normal).transformDirection(q.matrixWorld).y > 0.9) {
            seen.add(k);
            out.zfight.push({ a: label(o), b: label(q), moduleA: moduleOf(o), moduleB: moduleOf(q), y: +h.point.y.toFixed(3), at: [r2(x), +h.point.y.toFixed(3), r2(z)] });
          }
        }
      }
    }
  }

  // ---- what each view shows: an ID pass (flat colour per mesh, 320 px wide) from a camera at the view
  if (opts.views !== false && views.length) {
    const r = w.renderer, cam0 = w.camera, gl = r.getContext();
    const W = 320, H = Math.max(1, Math.round((W * gl.drawingBufferHeight) / gl.drawingBufferWidth));
    const meshes = visibles.filter((o) => o.layers.test(cam0.layers) && ![o.material].flat().some((m) => m.transparent || m.depthWrite === false || (m.transmission || 0) > 0));
    const inPass = new Set(meshes), nothing = new T.MeshBasicMaterial({ visible: false });
    const hide = [], saved = [], made = [];
    scene.traverseVisible((o) => {
      if (o.isPoints || o.isLine || o.isSprite || o === w.sky || o === w.stars) hide.push(o);
      else if (o.isMesh && !inPass.has(o) && !o.userData.collider) { saved.push([o, o.material]); o.material = Array.isArray(o.material) ? o.material.map(() => nothing) : nothing; }
    });
    meshes.forEach((o, k) => {
      const ids = [o.material].flat().map((m) => {
        const id = new T.MeshBasicMaterial({ fog: false, toneMapped: false, side: m.side });
        id.color.setRGB(((k + 1) & 255) / 255, (((k + 1) >> 8) & 255) / 255, (((k + 1) >> 16) & 255) / 255, T.LinearSRGBColorSpace);
        if (m.alphaTest > 0 || m.alphaHash) Object.assign(id, { map: m.map || null, alphaMap: m.alphaMap || null, alphaTest: m.alphaTest, alphaHash: !!m.alphaHash });
        const hk = (m.userData && m.userData.hooks) || {}, hooks = { output: 'outgoingLight = diffuse;' };
        for (const key of ['vertexDecl', 'vertexWorld', 'uniforms', 'defines']) if (hk[key]) hooks[key] = hk[key];
        if (w.mat && w.mat.patch) w.mat.patch(id, hooks);
        made.push(id); return id;
      });
      saved.push([o, o.material]); o.material = Array.isArray(o.material) ? ids : ids[0];
    });
    for (const o of hide) o.visible = false;
    const keep = { target: r.getRenderTarget(), clear: r.getClearColor(new T.Color()), alpha: r.getClearAlpha(), shadow: r.shadowMap.autoUpdate, bg: scene.background, env: scene.environment, over: scene.overrideMaterial, fog: scene.fog };
    const rt = new T.WebGLRenderTarget(W, H, { depthBuffer: true }), px = new Uint8Array(W * H * 4);
    const cam = new T.PerspectiveCamera(cam0.fov, gl.drawingBufferWidth / gl.drawingBufferHeight, Math.max(0.05, cam0.near), cam0.far);
    cam.layers.mask = cam0.layers.mask;
    const rc = new T.Raycaster(); rc.layers.mask = cam0.layers.mask;
    const matches = (o, nm) => { for (let p = o; p && p !== scene; p = p.parent) if (p.name === nm || p.name === nm + ':finalize') return true; return false; };
    // a view's subjects: its own `see` list, else the object it is named after (a view "rail" must show the rail)
    const named = (nm) => typeof nm === 'string' && meshes.some((o) => matches(o, nm));
    try {
      Object.assign(scene, { background: null, environment: null, overrideMaterial: null, fog: null });
      r.shadowMap.autoUpdate = false;
      for (const e of views) {
        const v = e.v;
        cam.position.set(...v.eye); cam.lookAt(new T.Vector3(...v.look)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, cam);
        r.readRenderTargetPixels(rt, 0, 0, W, H, px);
        const count = new Map(); let empty = 0;
        for (let i = 0; i < W * H; i++) { const id = px[4 * i] | (px[4 * i + 1] << 8) | (px[4 * i + 2] << 16); if (!id) empty++; else count.set(id, (count.get(id) || 0) + 1); }
        const N = W * H, by = new Map();
        for (const [id, c] of count) { const o = meshes[id - 1]; if (o) { const l = label(o); by.set(l, (by.get(l) || 0) + c); } }
        const top = [...by].sort((a, b) => b[1] - a[1])[0];
        rc.set(cam.position, cam.getWorldDirection(new T.Vector3())); rc.far = 50;
        const hit = rc.intersectObjects(meshes, false)[0];
        const shareOf = (nm) => { let c = 0; for (const [id, k] of count) if (meshes[id - 1] && matches(meshes[id - 1], nm)) c += k; return +(c / N).toFixed(4); };
        const centreOf = (nm) => { const bb = new T.Box3(); for (const o of meshes) if (matches(o, nm)) bb.union(box(o)); return bb.isEmpty() ? null : P(bb.getCenter(new T.Vector3())); };
        const subjects = Array.isArray(v.see) ? v.see : null;
        const want = subjects || (e.path !== 'spawn' && named(v.name) ? [v.name] : []);
        const shares = Object.fromEntries(want.map((nm) => [nm, shareOf(nm)]));
        out.views.push({ path: e.path, name: e.name, empty: +(empty / N).toFixed(4), top: top ? [top[0], +(top[1] / N).toFixed(4)] : null,
          ahead: hit ? [label(hit.object), +hit.distance.toFixed(2)] : null, subjects: !!subjects, shares,
          centres: Object.fromEntries(want.map((nm) => [nm, centreOf(nm)])) });
      }
    } finally {
      for (const [o, m] of saved) o.material = m;
      for (const o of hide) o.visible = true;
      for (const m of made) m.dispose();
      rt.dispose(); nothing.dispose();
      Object.assign(scene, { background: keep.bg, environment: keep.env, overrideMaterial: keep.over, fog: keep.fog });
      r.shadowMap.autoUpdate = keep.shadow; r.setClearColor(keep.clear, keep.alpha); r.setRenderTarget(keep.target);
    }
  }
  out.ms = +(performance.now() - t0).toFixed(1); out.counted = { solids: solids.length, views: views.length };
  return out;
}

/** After a failed step. o = { kind: 'stuck' | 'through', from: [x,y,z], to: [x,y,z], toward?: [x, z], axis?: 0 | 2,
 *  stop?: number } or { kind: 'see', names: { name: { alone, need } } }. Returns words-ready numbers. */
export function probeInPage(o) {
  const { play } = window.__mirage, w = play.world, T = w.ctx.THREE, scene = w.scene, grid = play.grid;
  const r2 = (v) => +(+v).toFixed(2);
  const label = (m) => {
    const chain = []; for (let p = m; p && p !== scene; p = p.parent) if (p.name) chain.push(p.name);
    const mod = (chain.at(-1) || '(unnamed)').replace(/:finalize$/, ''), leaf = chain[0];
    return leaf && leaf !== chain.at(-1) ? `${mod}/${leaf}` : mod;
  };
  const visibleChain = (m) => { for (let p = m; p; p = p.parent) if (!p.visible) return false; return true; };
  const all = [];
  scene.traverse((m) => { if (m.isMesh && m !== w.sky && m !== w.stars && !m.isSkinnedMesh && (m.userData.collider || visibleChain(m))) all.push(m); });
  const boxOf = (m) => new T.Box3().setFromObject(m);
  const rc = new T.Raycaster(); rc.layers.enableAll();
  const solidWhy = (m) => {   // why the walk grid does not see this mesh as solid, or null if it does
    if (m.userData.collider) return null;
    for (let p = m; p; p = p.parent) if (p.userData.collide === false) return `${p === m ? 'it has' : `its parent "${p.name || '?'}" has`} userData.collide = false`;
    const ms = [m.material].flat();
    if (!(m.layers.mask & 1)) return 'it is not on layer 0';
    if (ms.every((x) => !x || x.transparent || x.depthWrite === false)) return 'its material is transparent / does not write depth (the walk grid skips those)';
    return null;
  };
  if (o.kind === 'see') {
    const res = {};
    const eye = w.camera.position.clone();
    for (const [nm, { alone, need }] of Object.entries(o.names)) {
      const matches = (m) => { for (let p = m; p && p !== scene; p = p.parent) if (p.name === nm || p.name === nm + ':finalize') return true; return false; };
      const bb = new T.Box3(); const mine = all.filter((m) => !m.userData.collider && matches(m)); for (const m of mine) bb.union(boxOf(m));
      if (bb.isEmpty()) continue;
      const c = bb.getCenter(new T.Vector3()), dist = eye.distanceTo(c);
      const row = { center: [r2(c.x), r2(c.y), r2(c.z)], eye: [r2(eye.x), r2(eye.y), r2(eye.z)], dist: r2(dist) };
      if (alone > 0 && need > alone) { const k = Math.max(0.2, Math.sqrt(alone / need) * 0.9); const e = c.clone().lerp(eye, k); row.closer = [r2(e.x), r2(e.y), r2(e.z)]; }
      // a clear eye: same distance and height, around the object, from which the first hit toward the centre is it
      const others = all.filter((m) => !m.userData.collider);
      for (let i = 0; i < 16 && !row.freeEye; i++) {
        const a = Math.atan2(eye.z - c.z, eye.x - c.x) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
        const hd = Math.hypot(eye.x - c.x, eye.z - c.z) || 4, e = new T.Vector3(c.x + hd * Math.cos(a), eye.y, c.z + hd * Math.sin(a));
        rc.set(e, c.clone().sub(e).normalize()); rc.far = e.distanceTo(c) + 1;
        const hit = rc.intersectObjects(others, false)[0];
        if (i > 0 && hit && matches(hit.object)) row.freeEye = [r2(e.x), r2(e.y), r2(e.z)];
      }
      res[nm] = row;
    }
    return res;
  }
  const [fx, fy, fz] = o.from, feet = fy;
  if (o.kind === 'stuck') {
    const tx = o.toward ? o.toward[0] : o.to[0], tz = o.toward ? o.toward[1] : o.to[2];
    let dx = tx - fx, dz = tz - fz; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const res = { dir: [r2(dx), r2(dz)] };
    // the walker itself inside a solid (it started there)
    const here = grid.support(fx, fz, feet, 0.4);
    if (!here || here[1] - Math.max(feet, here[0]) < 1.0) {
      res.self = [r2(fx), r2(feet), r2(fz)];
      const pt = new T.Vector3(fx, feet + 0.5, fz), inBox = all.filter((m) => boxOf(m).containsPoint(pt));
      if (inBox.length) res.selfIn = label(inBox[0]);
      return res;
    }
    // the object ahead (knee, waist, head)
    let hitObj = null;
    for (const h of [0.25, 1.0, 1.7]) {
      rc.set(new T.Vector3(fx, feet + h, fz), new T.Vector3(dx, 0, dz)); rc.far = 1.5;
      const hit = rc.intersectObjects(all, false)[0];
      if (hit && (!res.hit || hit.distance < res.hit[1])) { res.hit = [label(hit.object), r2(hit.distance), h]; hitObj = hit.object; }
    }
    if (hitObj) {
      // what it is: its box; for an (invisible) collision proxy also the box of the visible meshes of its module, so a
      // proxy that does not line up with what it stands in for shows
      const B = (b) => [r2(b.min.x), r2(b.min.y), r2(b.min.z), r2(b.max.x), r2(b.max.y), r2(b.max.z)];
      res.hitBox = B(boxOf(hitObj));
      if (hitObj.userData.collider) {
        res.hitCollider = true;
        const m0 = label(hitObj).split('/')[0], vb = new T.Box3();
        for (const m of all) if (!m.userData.collider && label(m).split('/')[0] === m0) vb.union(boxOf(m));
        if (!vb.isEmpty()) res.visibleBox = B(vb);
      }
    }
    // a step too high, a ceiling too low, just ahead
    for (const d of [0.35, 0.5, 0.7]) {
      const ax = fx + dx * d, az = fz + dz * d, Ls = grid.layers(ax, az);
      const rise = Ls.map(([f]) => f).find((f) => f > feet + 0.4 && f < feet + 1.8);
      if (rise !== undefined && res.rise === undefined) { res.rise = r2(rise - feet); res.riseAt = [r2(ax), r2(az)]; }
      const s = grid.support(ax, az, feet, 0.4);
      if (s && s[1] - Math.max(feet, s[0]) < 1.8 && res.headroom === undefined) { res.headroom = r2(s[1] - Math.max(feet, s[0])); res.headAt = [r2(ax), r2(az)]; }
    }
    // the width of the opening ahead: walkable cells across the route, nearest the route line
    const walkable = (x, z) => { const s = grid.support(x, z, feet, 0.4); return !!s && s[1] - Math.max(feet, s[0]) >= 1.8 && Math.abs(s[0] - feet) <= 0.4; };
    let width = Infinity, widthAt = null;
    for (const d of [0.35, 0.5, 0.7, 0.9]) {
      const cx = fx + dx * d, cz = fz + dz * d, step = 0.03125, runs = []; let run = null;
      for (let t = -2; t <= 2.0001; t += step) {
        const ok = walkable(cx - dz * t, cz + dx * t);
        if (ok && !run) run = [t, t]; else if (ok) run[1] = t; else if (run) { runs.push(run); run = null; }
      }
      if (run) runs.push(run);
      const near = runs.filter(([a, b]) => b - a > 0.01 && a > -1.5 && b < 1.5 && !(a <= -2 + 1e-6 || b >= 2 - 1e-6)).sort((p, q) => Math.min(Math.abs(p[0]), Math.abs(p[1])) - Math.min(Math.abs(q[0]), Math.abs(q[1])))[0];
      if (near && near[1] - near[0] + step < width) {
        width = near[1] - near[0] + step; const m = (near[0] + near[1]) / 2; widthAt = [r2(cx - dz * m), r2(cz + dx * m)];
        // what stands either side of the opening
        res.sides = [];
        for (const t of [near[0] - 0.15, near[1] + 0.15]) {
          const pt = new T.Vector3(cx - dz * t, feet + 1.0, cz + dx * t), m2 = all.find((q) => !q.userData.collider && boxOf(q).containsPoint(pt));
          if (m2 && !res.sides.includes(label(m2))) res.sides.push(label(m2));
        }
      }
    }
    if (width < 1.2) { res.width = r2(width); res.widthAt = widthAt; } else delete res.sides;
    return res;
  }
  if (o.kind === 'through') {
    // what the walker passed through, between where it started and where it ended, at knee and chest height
    let dx = o.to[0] - fx, dz = o.to[2] - fz; const L = Math.hypot(dx, dz);
    const res = { crossed: [] };
    if (L < 0.05) return res;
    dx /= L; dz /= L;
    const seen = new Set();
    for (const h of [0.3, 1.0, 1.5]) {
      rc.set(new T.Vector3(fx, feet + h, fz), new T.Vector3(dx, 0, dz)); rc.far = L + 0.3;
      for (const hit of rc.intersectObjects(all.filter((m) => !m.userData.collider), false)) {
        if (seen.has(hit.object)) continue; seen.add(hit.object);
        const m = hit.object, b = boxOf(m), size = b.getSize(new T.Vector3());
        // the proxy should cover the whole thing it belongs to (a railing, not one post): its group under the module
        let whole = m; while (whole.parent && whole.parent !== scene && whole.parent.parent && whole.parent.parent !== scene) whole = whole.parent;
        const wb = boxOf(whole);
        const thick = Math.abs(dx) > Math.abs(dz) ? size.x : size.z;
        let why = solidWhy(m);
        if (!why && thick < 0.125) why = `it is only ${r2(thick)} m thick along the walk (walk-grid cells are 0.125 m, sampled at their centres)`;
        if (!why && m.geometry && /Plane/.test(m.geometry.type)) why = 'it is an open surface (a plane): the top-down bake never sees a vertical face';
        if (!why) why = 'it should block: check its collider and plan.walk range';
        // collision proxies the module already has (they miss this crossing, or it would have stopped)
        const m0 = label(m).split('/')[0];
        const proxies = all.filter((q) => q.userData.collider && label(q).split('/')[0] === m0).map((q) => { const qb = boxOf(q); return [r2(qb.min.x), r2(qb.min.y), r2(qb.min.z), r2(qb.max.x), r2(qb.max.y), r2(qb.max.z)]; });
        res.crossed.push({ label: label(m), why, at: [r2(hit.point.x), r2(hit.point.y), r2(hit.point.z)], box: [r2(wb.min.x), r2(wb.min.y), r2(wb.min.z), r2(wb.max.x), r2(wb.max.y), r2(wb.max.z)], proxies });
      }
    }
    if (!res.crossed.length && o.axis !== undefined && Number.isFinite(o.stop)) {
      // nothing there: find the gap. The line the walker should have stopped at, a walker radius on.
      const ax = o.axis, sgn = Math.sign((ax === 0 ? dx : dz)) || 1, line = o.stop + sgn * 0.35;
      const t = (line - (ax === 0 ? fx : fz)) / (ax === 0 ? dx : dz);
      const cx = fx + dx * Math.max(0, Math.min(L, t)), cz = fz + dz * Math.max(0, Math.min(L, t));
      res.cross = [r2(cx), r2(feet), r2(cz)];
      const perp = ax === 0 ? 2 : 0, pv = perp === 0 ? cx : cz;
      let left = null, right = null;
      for (const m of all) {
        if (m.userData.collider || solidWhy(m)) continue;
        const b = boxOf(m);
        if (b.max.y < feet + 0.3 || b.min.y > feet + 1.8) continue;
        const along = ax === 0 ? [b.min.x, b.max.x] : [b.min.z, b.max.z], acr = perp === 0 ? [b.min.x, b.max.x] : [b.min.z, b.max.z];
        if (line < along[0] - 0.6 || line > along[1] + 0.6) continue;    // not on the barrier line
        if (acr[1] <= pv && (!left || acr[1] > left[1])) left = [label(m), r2(acr[1])];
        if (acr[0] >= pv && (!right || acr[0] < right[1])) right = [label(m), r2(acr[0])];
      }
      res.gap = { axis: perp === 0 ? 'x' : 'z', left, right, at: res.cross };
    }
    return res;
  }
  return null;
}

/** Run the load-time checks in a puppeteer page. */
export const worldChecks = (page, opts = {}) =>
  page.evaluate(`(${worldChecksInPage})(${JSON.stringify(opts)}, { classifyEye: ${classifyEye}, freeSpot: ${freeSpot} })`);

/** Run one probe in a puppeteer page. */
export const probe = (page, o) => page.evaluate(`(${probeInPage})(${JSON.stringify(o)})`);

export { BODY };
