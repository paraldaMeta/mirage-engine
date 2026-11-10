// Mirage original code.
// ---------------------------------------------------------------------------
// The editor's viewport: camera, picking, helpers, the selection outline and the transform gizmo.
//
//   const vp = createViewport({ world, view, pickRoots, onPick, onDrawPoint, onTransformEnd, onChange });
//   vp.sync({ plan: [{ id, kind, value }], objects: [{ id, def, root }] })   // helpers for what has no mesh
//   vp.select([{ id, handle, plan }], primaryIndex)                         // outline + gizmo
//   vp.update(dt) -> moving     vp.render()
//
// Nothing of the editor is in the world's scene or its canvas: helpers, grid, gizmo and outline are drawn by a
// second transparent canvas over it with the same camera, so a still of the world is the world (the round-trip
// check compares those). The price: overlays are not hidden by walls (they are x-ray, which is what a helper wants
// anyway) and the grid shows through geometry, so it is faint.
// Camera: right drag looks, with WASD / QE flying while it is held; Alt + left drag or middle drag orbits the
// focus point; Shift + middle drag pans; the wheel dollies. The gizmo is three's TransformControls on a pivot: its
// delta is applied to every selected handle, which is how one gizmo moves a multi-selection and plan entries alike.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { elementPose } from '../schema.js';
import { nodePath } from '../runtime.js';

const COLORS = { point: 0xc8e04a, shape: 0x4ad0e0, path: 0xe04ad0, view: 0xffffff, light: 0xffd479, probe: 0x7fb4ff, gi: 0x8affc1, audioZone: 0xc79bff, sound: 0xc79bff, vfx: 0xff8a5a, nav: 0x5ae07a, trigger: 0xff5a5a, spawnPoint: 0x5ac8ff, model: 0xdddddd };
const SELECTED = 0xffa726;
const VOLUMES = new Set(['probe', 'gi', 'audioZone', 'nav', 'trigger']);
const SOLID = new Set(['primitive', 'wall', 'model']);
const lineMat = (color) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
const pickMat = new THREE.MeshBasicMaterial({ visible: false });
const loop = (pts, mat) => new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
const line = (pts, mat) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
const edges = (geo, mat) => { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat); geo.dispose(); return e; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function createViewport({ world, view, pickRoots = new Set(), onPick = () => {}, onDrawPoint = () => {}, onTransformEnd = () => {}, onChange = () => {} }) {
  const { camera, scene } = world, worldCanvas = world.renderer.domElement;
  const canvas = document.createElement('canvas');
  canvas.className = 'mg-over'; canvas.tabIndex = 0;
  view.append(worldCanvas, canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  const over = new THREE.Scene(), helpers = new THREE.Group(), preview = new THREE.Group();
  const grid = new THREE.GridHelper(200, 200, 0x9aa4b0, 0x6a727c);
  grid.material.transparent = true; grid.material.opacity = 0.16; grid.material.depthTest = false;
  over.add(grid, helpers, preview);
  let dirty = true;
  const touch = () => { dirty = true; onChange(); };

  // ---- size: the world renders at the viewport's size, the overlay follows it
  let W = 0, H = 0;
  const maskRT = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
  function resize(force = false) {
    const w = Math.max(64, view.clientWidth | 0), h = Math.max(64, view.clientHeight | 0);
    if (w === W && h === H && !force) return false;
    W = w; H = h;
    worldCanvas.style.width = w + 'px'; worldCanvas.style.height = h + 'px';
    world.resize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(w, h);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    maskRT.setSize(db.x, db.y); outline.uniforms.texel.value.set(1 / db.x, 1 / db.y);
    touch();
    return true;
  }

  // ---- outline: selected meshes drawn flat into a mask, its edge drawn over the overlay
  const maskScene = new THREE.Scene(), maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const outline = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { tMask: { value: maskRT.texture }, texel: { value: new THREE.Vector2(1, 1) }, color: { value: new THREE.Color(SELECTED) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tMask; uniform vec2 texel; uniform vec3 color; varying vec2 vUv;
      void main() {
        float c = texture2D(tMask, vUv).r, m = 0.0;
        for (int i = 0; i < 8; i++) { float a = float(i) * 0.7853982; m = max(m, texture2D(tMask, vUv + vec2(cos(a), sin(a)) * texel * 2.5).r); }
        float a = max((1.0 - c) * m, c * 0.07);
        if (a < 0.01) discard;
        gl_FragColor = vec4(color, a);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), outline), quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false; quadScene.add(quad);

  // ---- helpers for what has no mesh of its own
  const byId = new Map();     // id -> { root, lines: [material], follow?: Object3D }
  const freeTree = (g) => { g.traverse((o) => { o.geometry?.dispose(); if (o.material && o.material !== pickMat) o.material.dispose(); }); g.clear(); };
  function planHelper({ id, kind, value }) {
    const pose = elementPose(kind, value), mat = lineMat(COLORS[kind]), root = new THREE.Group();
    const [cx, cy, cz] = pose.position, rel = (p, y = 0) => V(p[0] - cx, y, p[1] - cz);
    root.position.set(cx, cy, cz);
    if (kind === 'point' || kind === 'view') {
      root.add(edges(new THREE.OctahedronGeometry(kind === 'view' ? 0.22 : 0.16), mat));
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), pickMat); root.add(hit);
      if (kind === 'view' && Array.isArray(value.look)) root.add(line([V(0, 0, 0), V(value.look[0] - cx, value.look[1] - cy, value.look[2] - cz).setLength(0.9)], mat));   // a stub towards the look point: the full line crossed the whole view
      if (kind === 'point') root.add(line([V(0, 0, 0), V(0, -cy, 0)], mat));
    } else if (kind === 'path') root.add(line(value.points.map((p) => rel(p)), mat));
    else if (value.rect) { const [a, b, c, d] = value.rect; root.add(loop([[a, b], [c, b], [c, d], [a, d]].map((p) => rel(p)), mat)); }
    else if (value.circle) { const r = value.circle[2]; root.add(loop(Array.from({ length: 48 }, (_, i) => V(Math.cos(i / 48 * 2 * Math.PI) * r, 0, Math.sin(i / 48 * 2 * Math.PI) * r)), mat)); }
    else if (value.poly) root.add(loop(value.poly.map((p) => rel(p)), mat));
    return { root, lines: [mat], color: COLORS[kind] };
  }
  function objectHelper({ id, def, root: target }) {
    const color = COLORS[def.type] ?? 0xdddddd, mat = lineMat(color), root = new THREE.Group();
    root.matrixAutoUpdate = false;
    if (VOLUMES.has(def.type)) root.add(edges(new THREE.BoxGeometry(1, 1, 1), mat));
    else {
      root.add(edges(def.type === 'light' ? new THREE.IcosahedronGeometry(0.18, 0) : new THREE.OctahedronGeometry(0.2), mat), new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), pickMat));
      if (def.type === 'light' && def.kind === 'spot') { const r = Math.tan((def.angle ?? 40) * Math.PI / 180); root.add(line([V(-r, -1, 0), V(0, 0, 0), V(r, -1, 0), V(0, 0, 0), V(0, -1, r), V(0, 0, 0), V(0, -1, -r)], mat)); }
      if (def.type === 'spawnPoint') root.add(line([V(0, 0, 0), V(0, 0, -0.7)], mat));
      if (def.type === 'sound') root.add(loop(Array.from({ length: 32 }, (_, i) => V(Math.cos(i / 16 * Math.PI) * (def.radius ?? 8), 0, Math.sin(i / 16 * Math.PI) * (def.radius ?? 8))), mat));
    }
    return { root, lines: [mat], color, follow: target };
  }
  /** Rebuild the helpers: every plan entry, and every placed object that is not a mesh of its own. */
  function sync({ plan = [], objects = [] }) {
    freeTree(helpers); byId.clear();
    for (const p of plan) { let it; try { it = planHelper(p); } catch { continue; } it.root.userData.item = p.id; byId.set(p.id, it); helpers.add(it.root); }
    for (const o of objects) { if (SOLID.has(o.def.type)) continue; const it = objectHelper(o); it.root.userData.item = o.id; byId.set(o.id, it); helpers.add(it.root); }
    paint(); touch();
  }
  const handleOf = (id) => byId.get(id)?.root || null;

  // ---- gizmo
  const pivot = new THREE.Object3D();
  over.add(pivot);
  const tc = new TransformControls(camera, canvas);
  tc.setSize(0.9);
  over.add(tc.getHelper());
  const G = { sel: [], primary: -1, space: 'world', mode: 'translate', snap: false, surface: false, steps: { move: 0.5, rotate: 15, scale: 0.1 }, start: null };
  const m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4(), q = new THREE.Quaternion(), p3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  function placePivot() {
    const it = G.sel[G.primary];
    if (!it?.handle) { tc.detach(); return; }
    it.handle.updateWorldMatrix(true, false);
    it.handle.matrixWorld.decompose(pivot.position, q, s3);
    if (G.space === 'local' && !it.plan) pivot.quaternion.copy(q); else pivot.quaternion.identity();
    pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld(true);
    if (tc.object !== pivot) tc.attach(pivot);
  }
  function paint() {
    const on = new Set(G.sel.map((s) => s.id));
    for (const [id, it] of byId) for (const m of it.lines) m.color.setHex(on.has(id) ? SELECTED : it.color);
  }
  function applyGizmo() {
    tc.setMode(G.mode); tc.setSpace(G.space);
    tc.setTranslationSnap(G.snap ? G.steps.move : null); tc.setRotationSnap(G.snap ? G.steps.rotate * Math.PI / 180 : null); tc.setScaleSnap(G.snap ? G.steps.scale : null);
    placePivot(); touch();
  }
  /** Outline and gizmo for a selection: [{ id, handle (Object3D), plan (true for a plan entry's proxy) }]. */
  function select(sel, primary = sel.length - 1) {
    G.sel = sel.filter((s) => s.handle); G.primary = Math.min(primary, G.sel.length - 1);
    for (const c of [...maskScene.children]) maskScene.remove(c);
    let n = 0;
    for (const s of G.sel) if (!s.plan) s.handle.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry || n++ > 600) return;
      const proxy = new THREE.Mesh(o.geometry, maskMat);
      proxy.matrixAutoUpdate = false; proxy.frustumCulled = false; proxy.userData.src = o;
      maskScene.add(proxy);
    });
    paint(); placePivot(); touch();
  }
  const ray = new THREE.Raycaster();
  ray.params.Line.threshold = 0.14;
  const ndc = new THREE.Vector2();
  const aim = (x, y) => { const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera); };
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  // the first hit on the built world or a placed object: { id, point, object }
  function worldHit(skip) {
    for (const hit of ray.intersectObjects(scene.children, true)) {
      let o = hit.object, top = o;
      if (!shown(o) || !(o.isMesh || o.isLine)) continue;
      for (; top.parent && top.parent !== scene; top = top.parent) if (top.userData.placed) break;
      const placed = top.userData.placed ? 'obj:' + top.userData.placed : null;
      // only what the modules built and what the editor placed: not the sky, the sun's helpers or a rain sheet
      if (!placed && !pickRoots.has(top.name)) continue;
      const path = placed ? null : nodePath(o, scene), id = placed || (path ? 'node:' + path : null);
      if (!id || (skip && (skip.has(id) || [...skip].some((s) => s.startsWith('node:') && id.startsWith(s + '/'))))) continue;
      return { id, point: hit.point, object: o, distance: hit.distance };
    }
    return null;
  }
  /** What is under a client position: a helper first (they are drawn over everything), then the world. */
  function pick(x, y) {
    aim(x, y);
    // the nearest of a helper and the world wins (0.5 m in the helper's favour: markers sit half in the ground); a
    // helper the camera is inside of (the viewpoint being looked through) would otherwise swallow every click
    const w = worldHit();
    for (const hit of ray.intersectObjects(helpers.children, true)) {
      if (hit.distance < 0.6) continue;
      if (w && hit.distance > w.distance + 0.5) break;
      let o = hit.object; while (o && !o.userData.item) o = o.parent;
      if (o) return o.userData.item;
    }
    return w?.id ?? null;
  }
  /** The point of the world under a client position, or of the ground plane y = 0 when there is none. */
  function groundPoint(x, y, skip) {
    aim(x, y);
    const hit = worldHit(skip);
    if (hit) return hit.point.toArray();
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    return t > 0 && t < 2000 ? ray.ray.at(t, p3).toArray() : null;
  }
  const down = new THREE.Vector3(0, -1, 0);
  function dropY(pos, skip) {
    ray.set(p3.set(pos.x, pos.y + 50, pos.z), down);
    return worldHit(skip)?.point.y ?? null;
  }
  tc.addEventListener('dragging-changed', (e) => {
    if (e.value) {
      pivot.updateMatrixWorld(true);
      G.start = { inv: pivot.matrixWorld.clone().invert(), items: G.sel.map((s) => { s.handle.updateWorldMatrix(true, false); return { s, world: s.handle.matrixWorld.clone(), position: s.handle.position.clone(), scale: s.handle.scale.clone() }; }) };
    } else if (G.start) { const start = G.start; G.start = null; onTransformEnd(start.items.map((i) => ({ id: i.s.id, handle: i.s.handle, from: i.position, fromScale: i.scale })), G.mode); placePivot(); }
    touch();
  });
  tc.addEventListener('objectChange', () => {
    if (!G.start) return;
    pivot.updateMatrixWorld(true);
    m4.multiplyMatrices(pivot.matrixWorld, G.start.inv);
    const skip = new Set(G.sel.map((s) => s.id));
    for (const { s, world: w0 } of G.start.items) {
      const o = s.handle;
      m4b.multiplyMatrices(m4, w0);
      if (o.parent) { o.parent.updateWorldMatrix(true, false); m4b.premultiply(new THREE.Matrix4().copy(o.parent.matrixWorld).invert()); }
      m4b.decompose(p3, q, s3);
      o.position.copy(p3);
      if (!s.plan) o.quaternion.copy(q);
      o.scale.copy(s3);
      // surface snap: a moved object stands on whatever is under it (not on itself)
      if (G.surface && G.mode === 'translate' && !s.plan) { const y = dropY(o.getWorldPosition(new THREE.Vector3()), skip); if (y !== null) o.position.y += y - o.getWorldPosition(new THREE.Vector3()).y; }
      o.updateMatrixWorld(true);
    }
    touch();
  });
  tc.addEventListener('change', touch);

  // ---- camera
  const nav = { yaw: 0, pitch: 0, dist: 12, drag: null, keys: new Set(), moved: false, enabled: true };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ'), fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const readCamera = () => { euler.setFromQuaternion(camera.quaternion, 'YXZ'); nav.yaw = euler.y; nav.pitch = euler.x; };
  const writeCamera = () => { camera.quaternion.setFromEuler(euler.set(nav.pitch, nav.yaw, 0, 'YXZ')); camera.updateMatrixWorld(); nav.moved = true; };
  const axes = () => { camera.getWorldDirection(fwd); right.crossVectors(fwd, camera.up).normalize(); up.crossVectors(right, fwd); };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!nav.enabled) return;
    canvas.focus();
    const gizmo = e.button === 0 && !e.altKey && tc.object && tc.axis !== null;
    if (gizmo) return;
    readCamera();
    const kind = e.button === 2 ? 'look' : e.button === 1 ? (e.shiftKey ? 'pan' : 'orbit') : e.altKey ? 'orbit' : 'click';
    nav.drag = { kind, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId };
    if (kind === 'orbit') { axes(); nav.focus = camera.position.clone().addScaledVector(fwd, nav.dist); }
    canvas.setPointerCapture(e.pointerId);
    if (kind !== 'click') e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const d = nav.drag;
    if (!d || d.kind === 'click') return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    if (d.kind === 'pan') { axes(); camera.position.addScaledVector(right, -dx * nav.dist * 0.0016).addScaledVector(up, dy * nav.dist * 0.0016); camera.updateMatrixWorld(); nav.moved = true; return; }
    nav.yaw -= dx * 0.005; nav.pitch = Math.max(-1.55, Math.min(1.55, nav.pitch - dy * 0.005));
    writeCamera();
    if (d.kind === 'orbit') { camera.getWorldDirection(fwd); camera.position.copy(nav.focus).addScaledVector(fwd, -nav.dist); camera.updateMatrixWorld(); }
  });
  const release = (e) => {
    const d = nav.drag;
    if (!d || d.id !== e.pointerId) return;
    nav.drag = null; nav.keys.clear();
    if (d.kind === 'click' && e.type === 'pointerup' && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4 && !tc.dragging) {
      if (draw) { const p = groundPoint(e.clientX, e.clientY); if (p) onDrawPoint(p); } else onPick(pick(e.clientX, e.clientY), { add: e.shiftKey || e.ctrlKey || e.metaKey });
    }
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    if (!nav.enabled) return;
    e.preventDefault();
    const step = nav.dist * (1 - Math.exp(-e.deltaY * -0.0012));
    camera.getWorldDirection(fwd); camera.position.addScaledVector(fwd, step); camera.updateMatrixWorld();
    nav.dist = Math.max(0.5, nav.dist - step); nav.moved = true;
  }, { passive: false });
  // fly keys count only while the right button is held: W / E / R are the gizmo modes otherwise
  const FLY = { KeyW: [0, 0, 1], KeyS: [0, 0, -1], KeyA: [-1, 0, 0], KeyD: [1, 0, 0], KeyE: [0, 1, 0], KeyQ: [0, -1, 0] };
  const key = (e) => { if (nav.drag?.kind !== 'look' || !FLY[e.code]) return; e.preventDefault(); e.stopImmediatePropagation(); if (e.type === 'keydown') nav.keys.add(e.code); else nav.keys.delete(e.code); nav.fast = e.shiftKey; };
  addEventListener('keydown', key, true); addEventListener('keyup', key, true);
  /** Advance the camera; true when it moved since the last call. */
  function update(dt) {
    if (nav.keys.size) {
      axes();
      const v = p3.set(0, 0, 0);
      for (const k of nav.keys) { const [r, u, f] = FLY[k]; v.addScaledVector(right, r).addScaledVector(camera.up, u).addScaledVector(fwd, f); }
      if (v.lengthSq()) { camera.position.addScaledVector(v.normalize(), (nav.fast ? 24 : 6) * Math.min(dt, 0.1)); camera.updateMatrixWorld(); nav.moved = true; }
    }
    const moved = nav.moved;
    nav.moved = false;
    if (moved) dirty = true;
    return moved;
  }
  /** Move the camera so a box (or the handles given) fills the view. */
  function focus(handles) {
    const box = new THREE.Box3();
    for (const o of handles) { o.updateWorldMatrix(true, true); const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) box.expandByPoint(o.getWorldPosition(new THREE.Vector3())); else box.union(b); }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.6, box.getSize(new THREE.Vector3()).length() / 2);
    nav.dist = Math.min(400, r / Math.tan(camera.fov * Math.PI / 360) * 1.25);
    camera.getWorldDirection(fwd); camera.position.copy(c).addScaledVector(fwd, -nav.dist); camera.updateMatrixWorld(); nav.moved = true;
  }

  // ---- draw tool: clicks become ground points until it is finished
  let draw = null;
  function setDraw(points) {
    draw = points;
    freeTree(preview);
    if (points?.length) {
      const mat = lineMat(SELECTED);
      preview.add(line(points.map((p) => V(p[0], p[1] + 0.03, p[2])), mat));
      for (const p of points) { const d = edges(new THREE.OctahedronGeometry(0.1), mat.clone()); d.position.set(p[0], p[1], p[2]); preview.add(d); }
    }
    canvas.style.cursor = points ? 'crosshair' : '';
    touch();
  }

  function render() {
    for (const it of byId.values()) if (it.follow) { it.follow.updateWorldMatrix(true, false); it.root.matrix.copy(it.follow.matrixWorld); it.root.matrixWorldNeedsUpdate = true; }
    for (const p of maskScene.children) { p.userData.src.updateWorldMatrix(true, false); p.matrix.copy(p.userData.src.matrixWorld); p.matrixWorldNeedsUpdate = true; p.visible = shown(p.userData.src); }
    renderer.setRenderTarget(maskRT); renderer.setClearColor(0x000000, 0); renderer.clear();
    if (maskScene.children.length) renderer.render(maskScene, camera);
    renderer.setRenderTarget(null); renderer.clear();
    renderer.render(over, camera);
    if (maskScene.children.length) renderer.render(quadScene, quadCam);
    dirty = false;
  }
  const toClient = (v) => { const r = canvas.getBoundingClientRect(), p = p3.copy(v).project(camera); return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height]; };
  resize(); readCamera();
  return {
    canvas, sync, select, pick, groundPoint, update, render, resize, focus, handleOf, setDraw, dropY,
    get dirty() { return dirty; }, touch, invalidate() { dirty = true; },   // invalidate: redraw the overlay only (touch also asks for a world frame)
    get dragging() { return tc.dragging; }, get flying() { return nav.drag?.kind === 'look'; }, get drawing() { return !!draw; },
    gizmo: G, applyGizmo, placePivot,
    set gridVisible(v) { grid.visible = !!v; touch(); }, get gridVisible() { return grid.visible; },
    set enabled(v) { nav.enabled = !!v; tc.enabled = !!v; canvas.style.display = v ? '' : 'none'; },
    /** client position of a world point, and of the middle of a translate / scale handle of the gizmo (for tests) */
    screenOf: (p) => toClient(V(p[0], p[1], p[2])),
    handlePoint(axis = 'X', at = 0.3) {
      pivot.updateMatrixWorld(true);
      const pos = pivot.getWorldPosition(new THREE.Vector3());
      const factor = pos.distanceTo(camera.position) * Math.min(1.9 * Math.tan(Math.PI * camera.fov / 360) / camera.zoom, 7) * tc.size / 4;
      const dir = V(axis === 'X' ? 1 : 0, axis === 'Y' ? 1 : 0, axis === 'Z' ? 1 : 0);
      if (G.space === 'local' || G.mode === 'scale') dir.applyQuaternion(pivot.quaternion);
      if (dir.dot(camera.position.clone().sub(pos)) < 0) dir.negate();   // the gizmo draws an axis that points away from the camera on its other side
      return toClient(pos.addScaledVector(dir, at * factor));
    },
    dispose() { removeEventListener('keydown', key, true); removeEventListener('keyup', key, true); tc.dispose(); renderer.dispose(); maskRT.dispose(); canvas.remove(); },
  };
}
