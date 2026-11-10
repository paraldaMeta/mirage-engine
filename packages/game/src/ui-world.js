// Mirage original code. World-space UI on the DOM: labels, markers and health bars that follow 3D positions, with
// distance fade, occlusion and edge clamping. The elements are ordinary kit descriptions (so they theme, translate
// and mirror like the rest); one update per frame projects every anchor with plain arithmetic and writes a
// transform / opacity only where the rounded value changed: no layout is read, none is caused, and a still camera
// writes nothing at all.
// ---------------------------------------------------------------------------
// import { createWorldUI } from '@mirage/game/ui-world';
// const world = createWorldUI({ kit, camera, occluders: [wallsMesh], maxDistance: 40 });
// const tag = world.label({ object: npc, offset: [0, 1.9, 0], text: 'Ana' });          // follows an Object3D
// const goal = world.marker({ position: [4, 1, -12], icon: '◆', label: 'Gate', clamp: true });   // sticks to the screen edge when off screen
// const hp = world.healthBar({ object: enemy, offset: [0, 2.1, 0], value: enemyHp, max: 50 });
// const any = world.add({ position: p, content: h('div', null, 'anything') });
// in the loop, after the camera moved: world.update();      tag.remove();      world.dispose();
// Occlusion: `occluders` (meshes; a few rays per frame, round robin, eased) or `occlude(point, eye) -> boolean` (a
// physics ray of your own). Pure parts (Node-tested): projectPoint, worldFade, clampToEdge.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { h, signal } from './ui-kit.js';
import { Bar } from './ui-widgets.js';

/** Project a world point with a view-projection matrix (16 numbers, column-major) to pixels of a w x h viewport
 *  (y down). out: { x, y, depth (NDC z), w (clip w: the distance along the view for a perspective camera), front }. */
export function projectPoint(m, x, y, z, w, h2, out = {}) {
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  const k = 1 / (Math.abs(cw) < 1e-6 ? 1e-6 : Math.abs(cw));   // behind the eye the point mirrors: |w| keeps its side of the screen
  const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) * k, ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) * k;
  out.x = (nx * 0.5 + 0.5) * w; out.y = (0.5 - ny * 0.5) * h2;
  out.depth = (m[2] * x + m[6] * y + m[10] * z + m[14]) * k; out.w = cw; out.front = cw > 0;
  return out;
}
/** Opacity by distance: 1 up to fadeStart x max, falling to 0 at max. */
export const worldFade = (dist, max, fadeStart = 0.75) => (dist >= max ? 0 : dist <= max * fadeStart ? 1 : 1 - (dist - max * fadeStart) / (max * (1 - fadeStart)));
/** Keep a projected point inside the viewport less `margin`: { x, y, clamped, angle } (angle: where the real point
 *  lies from the clamped one, radians, 0 = right, clockwise on screen). A point behind the eye goes to the edge it
 *  is nearest to turning towards. */
export function clampToEdge(x, y, front, w, h2, margin = 24, out = {}) {
  const cx = w / 2, cy = h2 / 2;
  let dx = x - cx, dy = y - cy;
  if (!front) { dx = -dx; dy = -dy; if (!dx && !dy) dy = 1; const s = (w + h2) / Math.hypot(dx, dy); dx *= s; dy *= s; }
  const inside = front && x >= margin && x <= w - margin && y >= margin && y <= h2 - margin;
  out.clamped = !inside; out.angle = Math.atan2(dy, dx);
  if (inside) { out.x = x; out.y = y; return out; }
  const k = Math.min((cx - margin) / Math.max(1e-6, Math.abs(dx)), (cy - margin) / Math.max(1e-6, Math.abs(dy)), front ? 1e9 : 1e9);
  out.x = cx + dx * Math.min(k, 1e6); out.y = cy + dy * Math.min(k, 1e6);
  return out;
}

const CSS = `
.mk-world{position:absolute;left:0;top:0;will-change:transform,opacity;pointer-events:none;contain:layout style;white-space:nowrap}
.mk-layer>.mk-world{pointer-events:none}
.mk-world-in{transform:translate(-50%,-100%)}
.mk-world.mk-edge>.mk-world-in{transform:translate(-50%,-50%)}
.mk-wlabel{padding:.15em .6em;font-size:.85em;font-weight:600;color:var(--mk-text);background:var(--mk-scrim);border:.06em solid var(--mk-border);border-radius:1em;text-shadow:0 .06em .15em #000a}
.mk-wmarker{display:flex;flex-direction:column;align-items:center;gap:.1em;text-shadow:0 .06em .2em #000}
.mk-wmarker-icon{font-size:1.4em;line-height:1;color:var(--mk-accent)}
.mk-wmarker-text{font-size:.75em;font-weight:600}
.mk-wmarker-dist{font-size:.7em;color:var(--mk-muted);font-variant-numeric:tabular-nums}
.mk-warrow{display:none;width:0;height:0;border-block:.35em solid transparent;border-inline-start:.6em solid var(--mk-accent);position:absolute;left:50%;top:50%;margin:-.35em 0 0 -.3em}
.mk-world.mk-edge .mk-warrow{display:block}
.mk-wbar{width:5em}.mk-wbar .mk-bar{height:.5em;min-width:0}
`;

/** options: kit, camera, occluders (Object3D[] raycast against), occlude(point: Vector3, eye: Vector3) -> boolean
 *  (instead of occluders), maxDistance (60 m), fadeStart (0.75), raysPerFrame (4), occludedAlpha (0: hidden behind
 *  walls; 0.25 for a ghost), margin (px from the edge for clamped markers, 28), minScale (0.6: far labels shrink to
 *  it), viewport: () => [w, h] (default: the window, read on resize only). */
export function createWorldUI({ kit, camera, occluders = null, occlude = null, maxDistance = 60, fadeStart = 0.75, raysPerFrame = 4, occludedAlpha = 0, margin = 28, minScale = 0.6, viewport = null } = {}) {
  if (!kit || !camera) throw new Error('createWorldUI: kit and camera are required');
  kit.addStyles('mk-world-css', CSS);
  const win = kit.doc.defaultView, layer = kit.layers.world;
  const items = [], vp = new THREE.Matrix4(), eye = new THREE.Vector3(), point = new THREE.Vector3(), dir = new THREE.Vector3();
  const ray = new THREE.Raycaster(), hits = [], P = {}, C = {};
  let size = viewport ? viewport() : [win.innerWidth, win.innerHeight], cursor = 0, lastT = 0;
  const onResize = () => { size = viewport ? viewport() : [win.innerWidth, win.innerHeight]; };
  win.addEventListener('resize', onResize);
  const stats = { items: 0, visible: 0, writes: 0, rays: 0 };

  function add({ position = null, object = null, offset = null, content, clamp = false, occlude: occ = true, maxDistance: max = maxDistance, minDistance = 0, scale = true, class: c } = {}) {
    const it = { position, object, offset, clamp, occ, max, minDistance, scale, el: null, vis: null, tf: '', op: -1, edge: false, hidden: 0, target: 1, distance: signal(0), stop: null, removed: false };
    it.stop = kit.mount(h('div', { class: ['mk-world', c], style: 'visibility:hidden', ref: (e) => { it.el = e; } }, h('div', { class: 'mk-world-in' }, typeof content === 'function' ? content(it) : content)), layer);
    items.push(it);
    return { el: it.el, /** metres from the camera, rounded (a signal: a marker prints it) */ distance: it.distance,
      /** move a fixed anchor */ set(x, y, z) { it.position = [x, y, z]; },
      remove() { if (it.removed) return; it.removed = true; items.splice(items.indexOf(it), 1); it.stop(); } };
  }

  /** once per frame, after the camera has moved (its matrices are updated here) */
  function update(now = win.performance.now()) {
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000)); lastT = now;
    camera.updateMatrixWorld();
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    eye.setFromMatrixPosition(camera.matrixWorld);
    const m = vp.elements, [W, H] = size;
    stats.items = items.length; stats.visible = 0; stats.writes = 0; stats.rays = 0;
    let budget = (occluders && occluders.length) || occlude ? raysPerFrame : 0;
    const n = items.length;
    if (cursor >= n) cursor = 0;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      let x, y, z;
      if (it.object) { const e = it.object.matrixWorld.elements; x = e[12]; y = e[13]; z = e[14]; } else { const p = it.position; x = p.x ?? p[0]; y = p.y ?? p[1]; z = p.z ?? p[2]; }
      if (it.offset) { x += it.offset[0]; y += it.offset[1]; z += it.offset[2]; }
      const dist = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
      projectPoint(m, x, y, z, W, H, P);
      let sx = P.x, sy = P.y, edge = false, on = dist <= it.max && dist >= it.minDistance;
      if (on && it.clamp) { clampToEdge(P.x, P.y, P.front, W, H, margin, C); sx = C.x; sy = C.y; edge = C.clamped; }
      else if (on) on = P.front && sx > -200 && sx < W + 200 && sy > -200 && sy < H + 200;
      // occlusion: a few rays a frame, in turn; an edge-clamped marker is never hidden (that is its point)
      if (on && it.occ && !edge && budget > 0 && ((i - cursor + n) % n) < raysPerFrame) {
        budget--; stats.rays++;
        point.set(x, y, z);
        if (occlude) it.target = occlude(point, eye) ? 0 : 1;
        else { dir.subVectors(point, eye).multiplyScalar(1 / (dist || 1)); ray.set(eye, dir); ray.near = 0.05; ray.far = Math.max(0.05, dist - 0.15); hits.length = 0; ray.intersectObjects(occluders, true, hits); it.target = hits.length ? 0 : 1; }
      }
      if (edge) it.target = 1;
      // eased so a label does not blink at a wall's edge; snapped when motion is reduced
      const k = kit.motion.peek() === 'reduced' ? 1 : Math.min(1, dt * 8);
      it.hidden += ((1 - it.target) - it.hidden) * k;
      if (it.hidden < 0.01) it.hidden = 0; else if (it.hidden > 0.99) it.hidden = 1;
      const alpha = on ? worldFade(dist, it.max, fadeStart) * (1 - it.hidden * (1 - occludedAlpha)) : 0;
      const vis = alpha > 0.01;
      if (vis !== it.vis) { it.vis = vis; it.el.style.visibility = vis ? 'visible' : 'hidden'; stats.writes++; }
      if (!vis) continue;
      stats.visible++;
      const s = it.scale && !edge ? Math.max(minScale, Math.min(1, 8 / Math.max(dist, 0.01))) : 1;
      // tenths of a pixel and hundredths of a scale: a still camera produces the same string and nothing is written
      const tf = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) scale(${s.toFixed(2)})`;
      if (tf !== it.tf) { it.tf = tf; it.el.style.transform = tf; stats.writes++; }
      const op = Math.round(alpha * 50) / 50;
      if (op !== it.op) { it.op = op; it.el.style.opacity = op; stats.writes++; }
      if (edge !== it.edge) { it.edge = edge; it.el.classList.toggle('mk-edge', edge); stats.writes++; }
      if (edge) { const a = C.angle.toFixed(2); if (a !== it.angle) { it.angle = a; it.el.style.setProperty('--mk-angle', a + 'rad'); stats.writes++; } }
      const d = Math.round(dist); if (d !== it.distance.peek()) it.distance.value = d;
    }
    cursor += raysPerFrame;
    return stats;
  }

  const api = {
    add, update, stats,
    /** a name tag: { text (reactive), ...anchor options } */
    label: ({ text, ...o }) => add({ ...o, content: h('div', { class: 'mk-wlabel' }, text) }),
    /** a waypoint: { icon: '◆', label, showDistance: true, clamp: true } */
    marker: ({ icon = '◆', label, showDistance = true, clamp = true, occlude: occ = false, ...o }) => add({ ...o, clamp, occlude: occ, content: (it) => h('div', { class: 'mk-wmarker', role: 'img', 'aria-label': label },
      h('span', { class: 'mk-wmarker-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'mk-warrow', 'aria-hidden': 'true', style: 'transform:rotate(var(--mk-angle,0rad)) translateX(1.4em)' }),
      label != null ? h('span', { class: 'mk-wmarker-text' }, label) : null,
      showDistance ? h('span', { class: 'mk-wmarker-dist' }, () => kit.i18n.number(it.distance.value, { style: 'unit', unit: 'meter' })) : null) }),
    /** a bar over a head: { value, max, tone: 'health', label } */
    healthBar: ({ value, max = 100, tone = 'health', label, ...o }) => add({ ...o, content: h(Bar, { value, max, tone, label: label || kit.tx('ui.health'), showValue: false, ghost: false, class: 'mk-wbar' }) }),
    get count() { return items.length; },
    dispose() { win.removeEventListener('resize', onResize); for (const it of items.splice(0)) { it.removed = true; it.stop(); } },
  };
  return api;
}
