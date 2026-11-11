// Mirage original code.
// ---------------------------------------------------------------------------
// The runtime half of the editor: the few lines a project adds so that what the editor saved is what it loads.
//
//   import { editable } from '@miragekit/editor/runtime';
//   import edits from './plan.edits.json';                 // written by the editor; {} until the first save
//   const ed = editable(plan, edits);
//   const world = createWorldRenderer({ ..., lighting: ed.lighting(lighting) });
//   const built = await buildWorld(world, { plan: ed.plan, modules, shared });
//   await ed.apply(world, built);                           // placed objects, node overrides, environment
//   const play = createPlay(world, { plan: built.plan, ... });
//   ed.attach({ world, built, play, modules, shared, makePlay: () => createPlay(world, { ... }) });
//
// With an empty layer and no editor attached every call above is a no-op: ed.plan is the plan object itself,
// lighting(cfg) returns cfg, apply() adds nothing to the scene (docs/editor.md has the before/after stills).
// Under `mirage-editor` the server injects the layer being edited (globalThis.__MIRAGE_EDITOR__), which then wins
// over the imported file, and attach() hands the live world to the editor's client.
//
// Placed objects (plan.objects): model (glTF through @miragekit/core/assets), primitive, wall, light
// (world.lighting.addLight when the world has clustered lights, a stock three light otherwise), vfx (VFX_LIBRARY by
// name). probe / gi / audioZone / sound / nav / trigger / spawnPoint are data: applyEdits turns them into the plan
// fields their systems read (plan.lighting, plan.audio.zones, plan.nav.areas, plan.triggers, plan.spawns).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { applyEdits, normalizeLayer, isEmptyLayer, planHash, equal } from './layer.js';

const RAD = Math.PI / 180;
const v3 = (v, d) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v : d);
/** Write a { position, rotation (degrees, XYZ), scale } pose onto an object. */
export function setPose(o, def) {
  const p = v3(def.position), r = v3(def.rotation), s = v3(def.scale);
  if (p) o.position.set(p[0], p[1], p[2]);
  if (r) o.rotation.set(r[0] * RAD, r[1] * RAD, r[2] * RAD, 'XYZ');
  if (s) o.scale.set(s[0], s[1], s[2]);
  o.updateMatrixWorld(true);
  return o;
}
const r4 = (n) => +n.toFixed(4);
const _e = new THREE.Euler();
/** The pose of an object as layer data. */
export function getPose(o) {
  _e.setFromQuaternion(o.quaternion, 'XYZ');
  return { position: o.position.toArray().map(r4), rotation: [_e.x, _e.y, _e.z].map((a) => +(a / RAD).toFixed(3)), scale: o.scale.toArray().map(r4) };
}

// ---- scene paths: "walls/3/0" = child 0 of child 3 of the scene child named "walls"
/** The path of a scene node, or null when its root has no name of its own (then an override could not find it again). */
export function nodePath(obj, scene) {
  const parts = [];
  let o = obj;
  for (; o && o.parent && o.parent !== scene; o = o.parent) parts.unshift(o.parent.children.indexOf(o));
  if (!o || o.parent !== scene || !o.name || o.name.includes('/') || scene.children.filter((c) => c.name === o.name).length !== 1) return null;
  return [o.name, ...parts].join('/');
}
export function resolveNode(scene, path) {
  const [name, ...idx] = String(path).split('/');
  let o = scene.children.find((c) => c.name === name);
  for (const i of idx) o = o?.children[+i];
  return o || null;
}
const MAT_KEYS = ['color', 'emissive', 'roughness', 'metalness', 'emissiveIntensity', 'opacity', 'envMapIntensity'];
const matOf = (o) => [].concat(o.material || [])[0];
const readMat = (m) => Object.fromEntries(MAT_KEYS.filter((k) => m[k] !== undefined).map((k) => [k, m[k]?.isColor ? '#' + m[k].getHexString() : m[k]]));
/** A node's editable material values (the first material of a mesh), or null. */
export const nodeMaterial = (o) => (matOf(o) ? readMat(matOf(o)) : null);
/** Apply one override ({ position, rotation, scale, visible, material } | undefined) to a node. What the node was
 *  before the first override is kept on it, so taking the override away (undo) gives the built node back. */
export function applyNodeOverride(o, ov) {
  const m = matOf(o);
  const base = o.userData.__built ??= { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone(), visible: o.visible, material: m ? readMat(m) : null, transparent: m?.transparent };
  o.position.copy(base.position); o.quaternion.copy(base.quaternion); o.scale.copy(base.scale); o.visible = base.visible;
  if (ov) { setPose(o, ov); if (typeof ov.visible === 'boolean') o.visible = ov.visible; }
  if (m && base.material) {
    const want = { ...base.material, ...(ov?.material || {}) };
    for (const k of MAT_KEYS) if (want[k] !== undefined && m[k] !== undefined) { if (m[k]?.isColor) m[k].set(want[k]); else m[k] = want[k]; }
    const tr = base.transparent || want.opacity < 1;
    if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
  }
  o.updateMatrixWorld(true);
}
/** Apply a layer's node overrides to a built scene. Returns the paths that matched nothing. */
export function applyNodes(scene, nodes = {}) {
  const missing = [];
  for (const [path, ov] of Object.entries(nodes)) { const o = resolveNode(scene, path); if (o) applyNodeOverride(o, ov); else missing.push(path); }
  return missing;
}

// ---- placed objects
const UNIT = { box: () => new THREE.BoxGeometry(1, 1, 1), sphere: () => new THREE.SphereGeometry(0.5, 32, 20), cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32), plane: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
const POSE_KEYS = ['position', 'rotation', 'scale', 'name'];
const samePoseOnly = (a, b) => { const ka = Object.keys(a).filter((k) => !POSE_KEYS.includes(k)), kb = Object.keys(b).filter((k) => !POSE_KEYS.includes(k)); return ka.length === kb.length && ka.every((k) => equal(a[k], b[k])); };

/**
 * The objects of plan.objects, live in the world: placed.set(id, def | undefined) adds, changes or removes one.
 * opts.resolve(url) maps a project URL to a fetchable one (default: as written).
 */
export function createPlaced(world, { resolve = (u) => u, onError = (id, e) => console.error('[editor] object "' + id + '":', e) } = {}) {
  const group = new THREE.Group();
  group.name = 'placed';
  world.scene.add(group);
  const items = new Map(), pending = new Set();
  let assets = null, vfx = null, textures = null;
  const std = (p) => (world.mat?.std ? world.mat.std(p) : new THREE.MeshStandardMaterial(p));
  const solid = (mesh, def) => { mesh.castShadow = mesh.receiveShadow = true; if (def.collide === false) mesh.userData.collide = false; return mesh; };
  const wait = (p, id) => { const q = p.catch((e) => onError(id, e)).finally(() => pending.delete(q)); pending.add(q); };
  const surface = (def) => {
    const m = std({ color: def.color || '#b9ab98', roughness: def.roughness ?? 0.85, metalness: def.metalness ?? 0 });
    if (def.map) { textures ??= new THREE.TextureLoader(); m.map = textures.load(resolve(def.map)); m.map.colorSpace = THREE.SRGBColorSpace; m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; }
    return m;
  };
  const makers = {
    primitive(def, it) { it.root.add(solid(new THREE.Mesh((UNIT[def.shape] || UNIT.box)(), surface(def)), def)); },
    wall(def, it) {
      const pts = Array.isArray(def.points) ? def.points : [], h = def.height ?? 2.4, th = def.thickness ?? 0.3, mat = surface(def);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
        if (!(len > 1e-4)) continue;
        // each run is as long as the segment plus one thickness, so corners close
        const m = solid(new THREE.Mesh(new THREE.BoxGeometry(len + th, h, th), mat), def);
        m.position.set((ax + bx) / 2, h / 2, (az + bz) / 2); m.rotation.y = -Math.atan2(bz - az, bx - ax);
        it.root.add(m);
      }
    },
    model(def, it) {
      if (!def.url) return;
      wait((async () => {
        assets ??= (await import('@miragekit/core/assets')).createAssets(world);
        const model = await assets.load(resolve(def.url), { collide: def.collide === false ? false : 'mesh' });
        if (items.get(it.id) !== it) return;   // changed or removed while loading
        const inst = assets.instantiate(model);
        if (def.collide === false) inst.traverse((o) => { o.userData.collide = false; });
        it.root.add(inst); it.root.userData.bounds = model.bounds; it.root.updateMatrixWorld(true);
        it.free.push(() => assets.release(inst));
      })(), it.id);
    },
    light(def, it) {
      const l = def.kind === 'spot'
        ? new THREE.SpotLight(def.color || '#ffd9a8', def.intensity ?? 30, def.distance ?? 12, (def.angle ?? 40) * RAD, def.penumbra ?? 0.4, 2)
        : new THREE.PointLight(def.color || '#ffd9a8', def.intensity ?? 30, def.distance ?? 12, 2);
      it.root.add(l);
      if (l.isSpotLight) { l.target.position.set(0, -1, 0); l.add(l.target); }   // a spot points down its own -Y; rotate the object
      const clustered = world.lighting?.addLight?.(l, { shadow: !!def.shadow });
      if (!clustered && def.shadow) l.castShadow = true;
      it.light = l;
      it.free.push(() => { world.lighting?.removeLight?.(l); l.dispose?.(); });
    },
    vfx(def, it) {
      wait((async () => {
        vfx ??= (await import('@miragekit/core/vfx')).createVfx(world);
        const { VFX_LIBRARY } = await import('@miragekit/core/vfx-library');
        if (items.get(it.id) !== it) return;
        const p = it.root.getWorldPosition(new THREE.Vector3());
        // a name of the library only: an effect is looked up, never built from what the layer file says
        it.handle = vfx.spawn(Object.hasOwn(VFX_LIBRARY, def.effect) ? VFX_LIBRARY[def.effect] : VFX_LIBRARY.fire, { position: [p.x, p.y, p.z] });
        it.free.push(() => it.handle.stop());
      })(), it.id);
    },
  };
  function make(id, def) {
    const root = new THREE.Group();
    root.name = id; root.userData.placed = id;
    const it = { id, def, root, free: [] };
    items.set(id, it);
    setPose(root, def);
    group.add(root);
    try { makers[def.type]?.(def, it); } catch (e) { onError(id, e); }
    root.updateMatrixWorld(true);
    return it;
  }
  function drop(it) {
    for (const f of it.free) { try { f(); } catch (e) { onError(it.id, e); } }
    group.remove(it.root);
    if (it.def.type !== 'model') it.root.traverse((o) => o.geometry?.dispose?.());   // a model's geometry is the asset cache's: assets.release above
    items.delete(it.id);
  }
  const placed = {
    group, items,
    get: (id) => items.get(id)?.root || null,
    /** Add, change (a pose-only change moves the object, anything else rebuilds it) or, with undefined, remove. */
    set(id, def) {
      const it = items.get(id);
      if (!def) { if (it) drop(it); world.lighting?.invalidate?.(); return null; }
      if (it && it.def.type === def.type && samePoseOnly(it.def, def)) {
        it.def = def; setPose(it.root, def);
        if (it.handle) { const p = it.root.position; it.handle.move({ position: [p.x, p.y, p.z] }); }
        return it.root;
      }
      if (it) drop(it);
      return make(id, def).root;
    },
    /** every model and effect asked for so far has arrived */
    async ready() { while (pending.size) await Promise.all([...pending]); },
    get vfx() { return vfx; }, get assets() { return assets; },
    dispose() { for (const it of [...items.values()]) drop(it); world.scene.remove(group); },
  };
  return placed;
}

// ---- environment: time of day, weather, post, lighting switches
/** Apply a layer's `env` map to a world. Keys: time ("HH:MM" | "golden"), date ("YYYY-MM-DD"), wet, rain,
 *  post.<setting>, light2.<part>.<setting>. Only the keys given are touched; a key whose value is undefined gets the
 *  value the world had before the first write back (time and date have no such value: they wait for a reload). */
const ENV_BASE = new WeakMap();
// the settings object and key a dotted env key names; only fields the world already has (a layer is a file)
function envSlot(world, k) {
  const parts = k.split('.'), root = parts[0] === 'post' ? world.post : parts[0] === 'light2' ? world.light2 : null;
  let o = root;
  for (const s of parts.slice(1, -1)) o = o && typeof o === 'object' && Object.hasOwn(o, s) ? o[s] : null;
  const last = parts[parts.length - 1];
  return o && typeof o === 'object' && parts.length > 1 && Object.hasOwn(o, last) && typeof o[last] !== 'object' ? [o, last] : null;
}
export async function applyEnv(world, env = {}, only) {
  const keys = only || Object.keys(env);
  if (!keys.length) return;
  // the two modules it needs, not the whole of @miragekit/core: a build keeps them out of the page's first load
  const [sky, wetm] = await Promise.all([import('@miragekit/core/sky-time'), import('@miragekit/core/wet')]), core = { ...sky, ...wetm };
  let base = ENV_BASE.get(world);
  if (!base) ENV_BASE.set(world, base = {});
  for (const k of keys) {
    let v = env[k];
    if (k === 'time' || k === 'date') {
      if (k === 'date' && keys.includes('time')) continue;   // set once, with the time
      // what the project itself had set, kept the first time it is replaced: undo and "As the plan" go back to it
      if (!('time' in base)) { const st = world.state; base.time = st?.date ?? (st?.sun ? { elevation: st.sun.elevation, azimuth: st.sun.azimuth } : 'golden'); }
      if (env.time === undefined && env.date === undefined) { world.setTime(base.time); continue; }
      const t = env.time ?? 'golden';
      world.setTime(t === 'golden' ? 'golden' : core.placeDate(env.date || '2026-10-25', t, world.ctx?.place?.tzHours ?? 0));
    } else if (k === 'wet' || k === 'rain') {
      const u = k === 'wet' ? core.WET.uWet : core.WET.uRain;
      if (!(k in base)) base[k] = u.value;
      (k === 'wet' ? core.setWetness : core.setRain)(+(v ?? base[k]));
    } else {
      const slot = envSlot(world, k);
      if (!slot) continue;
      if (!(k in base)) base[k] = slot[0][slot[1]];
      if (v === undefined) v = base[k];
      if (typeof v === typeof base[k]) slot[0][slot[1]] = v;
    }
  }
  world.lighting?.invalidate?.();
}

/** plan.lighting (reflection probes and a GI volume placed in the editor) merged into the `lighting` option of
 *  createWorldRenderer. Returns `cfg` itself when the plan places none. */
export function lightingFromPlan(plan, cfg) {
  const L = plan?.lighting;
  if (!L || (!L.probes?.length && !L.gi)) return cfg;
  const base = cfg && typeof cfg === 'object' ? cfg : {};
  return { ...base, ...(L.probes?.length ? { probes: [...(Array.isArray(base.probes) ? base.probes : []), ...L.probes] } : {}), ...(L.gi ? { gi: { ...(typeof base.gi === 'object' ? base.gi : {}), ...L.gi } } : {}) };
}

/** plan.triggers as a tester: update([x, y, z]) calls onEnter / onLeave(trigger) as the point crosses the boxes. */
export function createTriggers(plan, { onEnter = () => {}, onLeave = () => {} } = {}) {
  const list = (plan?.triggers || []).map((t) => ({ ...t, inside: false, fired: false }));
  const within = (b, p) => p[0] >= b[0] && p[0] <= b[3] && p[1] >= b[1] && p[1] <= b[4] && p[2] >= b[2] && p[2] <= b[5];
  return {
    triggers: list,
    update(p) {
      for (const t of list) {
        const now = within(t.box, p);
        if (now && !t.inside && !(t.once && t.fired)) { t.fired = true; onEnter(t); }
        if (!now && t.inside) onLeave(t);
        t.inside = now;
      }
    },
  };
}

/** plan.timelines as live timelines: { name: Timeline }. Tracks name their target ("obj:<id>", "node:<path>" or
 *  "camera"); rotations are in degrees like everywhere else in the layer. */
export async function createTimelines(plan, world, placed) {
  const defs = plan?.timelines || {}, out = {};
  if (!Object.keys(defs).length) return out;
  const { createTimeline } = await import('@miragekit/play/timeline');
  const target = (t) => (t === 'camera' ? world.camera : String(t).startsWith('obj:') ? placed?.get(t.slice(4)) : String(t).startsWith('node:') ? resolveNode(world.scene, t.slice(5)) : null);
  for (const [name, d] of Object.entries(defs)) {
    const tracks = [];
    for (const tr of d.tracks || []) {
      if (tr.type === 'event') { tracks.push({ type: 'event', keys: tr.keys || [] }); continue; }
      const o = target(tr.target);
      if (!o || !(tr.keys || []).length) continue;
      tracks.push({ type: tr.type === 'camera' ? 'camera' : 'transform', target: o, curve: tr.curve || 'linear',
        keys: [...tr.keys].sort((a, b) => a.t - b.t).map((k) => ({ ...k, ...(k.rotation ? { rotation: k.rotation.map((a) => a * RAD) } : {}) })) });
    }
    out[name] = createTimeline({ tracks, duration: d.duration ?? null, loop: !!d.loop });
  }
  return out;
}

/**
 * One call for a project: the plan with the saved layer applied, and the hooks that make the rest of it live.
 * See the usage block at the top of this file.
 */
export function editable(plan, fileLayer, { resolve } = {}) {
  const E = globalThis.__MIRAGE_EDITOR__ || null;
  const layer = normalizeLayer(E?.layer ?? fileLayer);
  const edited = applyEdits(plan, layer);
  const state = { placed: null, timelines: {} };
  return {
    base: plan, layer, plan: edited, editor: !!E,
    hash: () => planHash(edited),
    lighting: (cfg) => lightingFromPlan(edited, cfg),
    /** After buildWorld: placed objects, node overrides, environment. Nothing happens with an empty layer. */
    async apply(world, built) {
      if (isEmptyLayer(layer) && !E) return state;
      if (E || Object.keys(layer.objects).length) {
        state.placed = createPlaced(world, { resolve });
        for (const [id, def] of Object.entries(layer.objects)) state.placed.set(id, def);
        await state.placed.ready();
      }
      state.missing = applyNodes(world.scene, layer.nodes);
      if (state.missing.length) console.warn('[editor] node overrides without a node (the modules changed?): ' + state.missing.join(', '));
      await applyEnv(world, layer.env);
      state.timelines = await createTimelines(edited, world, state.placed);
      return state;
    },
    /** Hand the live world to the editor's client. Does nothing unless the page is served by mirage-editor. */
    attach(host) {
      if (!E) return false;
      globalThis.__mirageEditorHost = { ...host, base: plan, layer, placed: state.placed, resolve };
      globalThis.dispatchEvent?.(new Event('mirage-editor-host'));
      return true;
    },
  };
}

export { applyEdits, planHash, normalizeLayer, isEmptyLayer } from './layer.js';
