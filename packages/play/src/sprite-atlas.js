// Mirage original code. Brought in from a game built on Mirage (2D sprites in a lit 3D world).
// ---------------------------------------------------------------------------
// Sprite atlases (docs/sprites-25d.md): the data half, no three and no DOM. An atlas answers one question: which
// cell to show for an animation, a screen direction and a time.
//
// Directions. World: +X east, +Y up, +Z south. A facing angle is a = atan2(dx, dz) (0 = facing +Z). A camera at
// yaw y sits at +Z of its target when y = 0 (the follow and iso cameras' convention). Seen on screen:
//   dir = round((a - y) / 2π * 8) mod 8
//   0 facing the viewer, 1 front-right, 2 screen right, 3 back-right, 4 away, 5 back-left, 6 screen left, 7 front-left
// An atlas draws 8 directions, 5 (0..4; 5, 6, 7 are 3, 2, 1 mirrored left-right) or 1 (the same for all).
//
//   const data = parseAtlas(json, { width, height });   // throws listing every problem
//   const anim = createSpriteAnim(data);
//   anim.play('attack', { onHit, onEnd });  each frame: const f = anim.update(dt, spriteDirection(facing, yaw));
// ---------------------------------------------------------------------------

/** The screen direction 0..7 of facing angle `a` (atan2(dx, dz)) seen from a camera at yaw `yaw`. */
export function spriteDirection(a, yaw = 0) {
  const d = Math.round(((a - yaw) / (Math.PI * 2)) * 8);
  return ((d % 8) + 8) % 8;
}

/** Which drawn direction shows screen direction `dir` with `dirs` drawn (8, 5 or 1): [drawn, mirrored]. */
export function drawnDirection(dirs, dir) {
  if (dirs === 1) return [0, false];
  if (dirs === 8) return [dir, false];
  return dir <= 4 ? [dir, false] : [8 - dir, true];
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pair = (v) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

/**
 * Check an atlas.json (the format in docs/sprites-25d.md) against its image size and wrap it: cell sizes in texture
 * space, the feet pivot, `frame(name, dir, t)`. Throws one Error listing every problem.
 */
export function parseAtlas(json, { width, height } = {}) {
  const bad = [];
  const j = json && typeof json === 'object' ? json : (bad.push('not an object'), {});
  const W = width ?? 0, H = height ?? 0;
  if (!(W > 0 && H > 0)) bad.push(`image size ${W} x ${H}: give { width, height } of the atlas image`);
  if (!pair(j.cell) || j.cell[0] <= 0 || j.cell[1] <= 0) bad.push('cell: [width, height] in pixels, both > 0');
  const [cw, ch] = pair(j.cell) ? j.cell : [1, 1];
  if (j.feet != null && (!pair(j.feet) || j.feet[0] < 0 || j.feet[0] > cw || j.feet[1] < 0 || j.feet[1] > ch)) bad.push(`feet: [x, y] in pixels inside the ${cw} x ${ch} cell`);
  if (j.height != null && !(isNum(j.height) && j.height > 0)) bad.push('height: metres the cell spans, > 0');
  const dirs = j.dirs ?? 1;
  if (![1, 5, 8].includes(dirs)) bad.push(`dirs: 1, 5 or 8 (got ${dirs})`);
  const drawn = dirs === 5 ? 5 : dirs === 8 ? 8 : 1;
  const anims = j.anims && typeof j.anims === 'object' ? j.anims : (bad.push('anims: an object { name: { fps, loop, frames, hit } }'), {});
  if (!Object.keys(anims).length) bad.push('anims: at least one animation');
  for (const [name, a] of Object.entries(anims)) {
    const at = `anims.${name}`;
    if (!a || typeof a !== 'object') { bad.push(`${at}: an object`); continue; }
    if (a.fps != null && !(isNum(a.fps) && a.fps > 0)) bad.push(`${at}.fps: > 0`);
    if (a.loop != null && typeof a.loop !== 'boolean') bad.push(`${at}.loop: true or false`);
    if (!Array.isArray(a.frames) || a.frames.length !== drawn) { bad.push(`${at}.frames: one list per drawn direction (${drawn} for dirs ${dirs})`); continue; }
    a.frames.forEach((list, d) => {
      if (!Array.isArray(list) || !list.length) { bad.push(`${at}.frames[${d}]: a non-empty list of [x, y] cell corners`); return; }
      list.forEach((c, i) => {
        if (!pair(c)) bad.push(`${at}.frames[${d}][${i}]: [x, y]`);
        else if (W > 0 && (c[0] < 0 || c[1] < 0 || c[0] + cw > W || c[1] + ch > H)) bad.push(`${at}.frames[${d}][${i}]: cell at [${c}] is outside the ${W} x ${H} image`);
      });
    });
    const n = Math.min(...a.frames.map((l) => (Array.isArray(l) ? l.length : 0)));
    if (a.hit != null && !(Number.isInteger(a.hit) && a.hit >= 0 && a.hit < n)) bad.push(`${at}.hit: a frame index 0..${n - 1}`);
  }
  if (bad.length) throw new Error(`atlas${j.id ? ' ' + j.id : ''}: ${bad.length} problem${bad.length > 1 ? 's' : ''}\n  ` + bad.join('\n  '));

  const idle = anims.idle || Object.values(anims)[0];
  const h = j.height ?? 1.75;
  const atlas = {
    id: j.id ?? null, json: j, cell: [cw, ch], size: [W, H], dirs, height: h,
    /** metres the cell spans across */
    width: h * (cw / ch),
    /** the feet in the cell: 0..1 from the left, 0..1 from the bottom (texture space, v up) */
    feetU: j.feet ? j.feet[0] / cw : 0.5,
    feetV: j.feet ? 1 - j.feet[1] / ch : 0.04,
    texel: [1 / W, 1 / H],
    names: Object.keys(anims),
    has: (name) => Object.prototype.hasOwnProperty.call(anims, name),
    /** the animation `name`, or idle (else the first) when the atlas has none of that name */
    anim: (name) => (atlas.has(name) ? anims[name] : idle),
    /** seconds one run of an animation lasts */
    duration(name) { const a = atlas.anim(name); return a.frames[0].length / (a.fps || 8); },
    /**
     * The cell for `name` at screen direction `dir`, `t` seconds in: { rect: [u, v, du, dv] (texture space, v up),
     * flip, index, count, done }. `out` is filled instead of a new object.
     */
    frame(name, dir, t, out = { rect: [0, 0, 0, 0], flip: false, index: 0, count: 1, done: false }) {
      const a = atlas.anim(name);
      const [d, flip] = drawnDirection(dirs, dir);
      const list = a.frames[d] || a.frames[0];
      const n = list.length, f = Math.floor(Math.max(0, t) * (a.fps || 8));
      const loop = a.loop !== false;
      const i = loop ? f % n : Math.min(f, n - 1);
      const [x, y] = list[i];
      out.rect[0] = x / W; out.rect[1] = 1 - (y + ch) / H; out.rect[2] = cw / W; out.rect[3] = ch / H;
      out.flip = flip; out.index = i; out.count = n; out.done = !loop && f >= n;
      return out;
    },
  };
  return atlas;
}

/**
 * The animation state of one sprite: which animation, how far in, and its events. `play(name, { restart, speed,
 * onHit, onEnd })`: playing the one already playing continues it (unless `restart` or new callbacks). onHit fires
 * once on the atlas's `hit` frame (a third of the way in without one), onEnd once when a non-looping run ends.
 * `update(dt, dir)` advances and returns the frame (atlas.frame's shape); callbacks run inside it.
 */
export function createSpriteAnim(atlas) {
  const st = { name: atlas.has('idle') ? 'idle' : atlas.names[0], t: 0, speed: 1, hitDone: false, endDone: false, cb: null };
  const frame = { rect: [0, 0, 0, 0], flip: false, index: 0, count: 1, done: false };
  const anim = {
    frame,
    get name() { return st.name; },
    get time() { return st.t; },
    play(name, { restart = false, speed = 1, onHit = null, onEnd = null } = {}) {
      if (st.name === name && !restart && !onHit && !onEnd) { st.speed = speed; return anim; }
      st.name = name; st.t = 0; st.speed = speed; st.hitDone = false; st.endDone = false;
      st.cb = onHit || onEnd ? { onHit, onEnd } : null;
      return anim;
    },
    update(dt, dir = 0) {
      st.t += dt * st.speed;
      const f = atlas.frame(st.name, dir, st.t, frame);
      const cb = st.cb;
      if (cb && cb.onHit && !st.hitDone) {
        const a = atlas.anim(st.name), at = a.hit != null ? a.hit : Math.floor(f.count / 3);
        if (f.index >= at || f.done) { st.hitDone = true; cb.onHit(); }
      }
      // the hit callback may have started another animation: its end belongs to that one
      if (cb === st.cb && cb && cb.onEnd && !st.endDone && f.done) { st.endDone = true; cb.onEnd(); }
      return f;
    },
  };
  return anim;
}
