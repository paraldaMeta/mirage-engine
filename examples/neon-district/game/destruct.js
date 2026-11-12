// Destructible props in neon-district: the engine's registry (createDestructibles, docs/destructibles.md) over what
// the modules already draw. The modules record each prop as they build it (modules/props-kit.js recorder: its id, its
// family, its box, the vertex ranges it added to their merged batches, its lamps, its collider proxies; ctx.shared.
// breakables); this file turns each family into the registry's spec, wires the weapon, the enemies' rounds, the lamps,
// the dark zones, the civilians and the score. docs/destructibles-neon-district.md is the plan it follows.
//   reacts       glass (shop windows, vending fronts, car windows, bottles, bulbs), small goods (cans roll, bottles
//                break and spill), lights (lanterns, bulb strings, neon tubes, sign faces, lamp lenses: the pool lamp,
//                the clustered light and the glow all go out; enough of them out and the place is a dark zone, as the
//                light hack makes one: hack.js reads `extraDark`)
//   the fight    cover that wears (crates, boxes, bag heaps) or holds (jersey barriers: chips, blocks blasts), vending
//                machines that burst (cans, sometimes ammunition or a med pack), the stall's gas bottle (burns, goes
//                off), an extinguisher (a white cloud), steam and water pipes (a jet no sentinel sees through, a wet
//                floor), blade signs cut loose (they fall and crush), cars (glass, tyres that sink a corner, an alarm
//                that lures, fire, an explosion)
//   heavy        the rocket throws scooters, folds the stall's flap down, blows a dent into a shutter; the gatling
//                sweeps glass and lights (its rounds count 1.6 x on props)
//   protected    the relay door, the pass, the uplink terminal, the stairs (none registered or protected) and the
//                owner's five wall signs (protected, tag `owner`)
//   civilians    the street's robots (machines.js units) are actors: a hit fells one (sparks, it folds over), its
//                neighbours cower; the player's rounds, blasts and props he set off are charged (points, a warning, a
//                radio line), the robots' rounds are not. A civilian between the player and a target takes the round.
// Saves: the registry is the game's 'destructibles' entity; 'destructScore' keeps whose casualties were whose.
import * as THREE from 'three';
import { createDestructibles } from '@miragekit/game';
import { machineUnits } from '../modules/machines.js';

/** the price of each family (the end card's property damage); civilians cost the most by far */
export const PRICE = {
  vending: 1500, 'vending-glass': 150, can: 3, bottle: 4, cup: 2, box: 3, pack: 2, cap: 2,
  'shop-glass': 400, lightbox: 600, shutter: 1200, ac: 350, neon: 300, tube: 120, streetlamp: 900, bulb: 2, lantern: 20,
  sign: 400, blade: 1200, led: 2500, 'bar-window': 400, barBottle: 18, glassware: 6, bowls: 12, jar: 8,
  crate: 25, cardboard: 4, bag: 1, bin: 40, beacon: 30, scooter: 1800, car: 18000, 'car-glass': 300, tyre: 150,
  gas: 80, extinguisher: 60, canopy: 700, steampipe: 200, waterpipe: 120,
};
export const CIVILIAN = { value: 25000, points: 500 };
/** property damage remarks: from this total on */
export const REMARK_AT = [0, 2000, 20000, 100000];

/** the vfx the robots get, with a tap on its tracers: every round they fire is a line the props on it take */
export function shotTap(vfx) {
  const tap = Object.create(vfx);
  tap.hook = null;
  tap.beam = (o) => { const r = vfx.beam(o); if (tap.hook && !o.jitter) tap.hook(o); return r; };
  return tap;
}

const GONE = new Set(['crate', 'bin', 'bar-window']);
const smooth = (x) => x * x * (3 - 2 * x);

/** a set of merged ranges whose vertices the game moves (a car's corner, a dent, a flap, a pane it hides): the
 *  positions saved once, written again from them by a function of the original point */
function vertexSet(handles) {
  const list = (handles || []).filter((h) => h.mesh && h.range).map(({ mesh, range: [first, count] }) => {
    const p = mesh.geometry.attributes.position;
    return { mesh, first, count, p, p0: p.array.slice(first * 3, (first + count) * 3) };
  });
  const v = new THREE.Vector3();
  return {
    list,
    /** fn(v: the original point, i) moves v; hidden: every vertex onto the range's first (nothing drawn) */
    apply(fn, hidden = false) {
      for (const r of list) {
        const a = r.p.array, o = r.first * 3;
        for (let i = 0; i < r.count; i++) {
          if (hidden) { a[o + i * 3] = r.p0[0]; a[o + i * 3 + 1] = r.p0[1]; a[o + i * 3 + 2] = r.p0[2]; if (fn) { v.set(r.p0[0], r.p0[1], r.p0[2]); fn(v, i); a[o + i * 3] = v.x; a[o + i * 3 + 1] = v.y; a[o + i * 3 + 2] = v.z; } continue; }
          v.set(r.p0[i * 3], r.p0[i * 3 + 1], r.p0[i * 3 + 2]);
          if (fn) fn(v, i);
          a[o + i * 3] = v.x; a[o + i * 3 + 1] = v.y; a[o + i * 3 + 2] = v.z;
        }
        if (r.p.addUpdateRange) r.p.addUpdateRange(o, r.count * 3);
        r.p.needsUpdate = true;
      }
    },
    restore() { for (const r of list) { r.p.array.set(r.p0, r.first * 3); if (r.p.addUpdateRange) r.p.addUpdateRange(r.first * 3, r.count * 3); r.p.needsUpdate = true; } },
    /** a world box round the ranges { center, half } */
    box() { const b = new THREE.Box3(); for (const r of list) for (let i = 0; i < r.count; i++) b.expandByPoint(v.set(r.p0[i * 3], r.p0[i * 3 + 1], r.p0[i * 3 + 2])); const c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5); return { center: c.toArray(), half: [Math.max(h.x, 0.02), Math.max(h.y, 0.02), Math.max(h.z, 0.02)] }; },
  };
}

/** glowing ranges (the props kit's glow and lantern materials take their light from the vertex colour): dimmed by k */
function glowSet(handles) {
  const list = (handles || []).filter((h) => h.mesh?.geometry.attributes.color).map(({ mesh, range: [first, count] }) => {
    const c = mesh.geometry.attributes.color;
    return { c, first, count, c0: c.array.slice(first * c.itemSize, (first + count) * c.itemSize) };
  });
  let k0 = 1;
  return {
    get size() { return list.length; },
    set(k) {
      if (k === k0) return; k0 = k;
      for (const r of list) { const a = r.c.array, n = r.c.itemSize, o = r.first * n; for (let i = 0; i < r.count * n; i++) a[o + i] = r.c0[i] * k; if (r.c.addUpdateRange) r.c.addUpdateRange(o, r.count * n); r.c.needsUpdate = true; }
    },
  };
}

export function setupDestruct({ ctx, shared, vfx, sfx, player, weapon, enemies, drones, hud, stats, kit, T, holdout, tap, assist = false }) {
  const { game, physics, root, world, audio, plan } = ctx;
  const { lamps, hack, ammo } = kit;
  const entries = shared.breakables?.list || [];
  const lampGroups = shared.breakables?.lampGroups || {};
  const detail = Math.max(0.3, Math.min(1, shared.detail ?? 1)), tier = shared.tier || shared.quality || 'high';
  const X = T.dx;

  // ---- what rounds and blasts are stopped by: the world (Rapier), stepping over the props' own proxies (tagged
  // userData.destructible) and the characters (a capsule with no object: the player, robots): the props themselves
  // are the registry's
  const occluder = (from, dir, max) => {
    let o = from, left = max, travelled = 0;
    for (let k = 0; k < 8; k++) {
      const h = physics.ray(o, dir, left);
      if (!h) return null;
      if (h.object && h.object.userData?.destructible == null) { if (travelled) { h.distance += travelled; } return h; }
      const step = h.distance + 0.01; travelled += step; left -= step; if (left <= 0) return null;
      o = [o[0] + dir[0] * step, o[1] + dir[1] * step, o[2] + dir[2] * step];
    }
    return null;
  };

  // ---- lamp channels: what a prop's light is (pool lamps, clustered lights, glowing ranges, sign faces, a hidden neon
  // range, a material); the registry calls lamps(channel, k) and the channel sets every part of it
  const faceOf = new Map((hack.faces || []).map((f) => [f.mesh, f]));
  const chans = [];
  const chan = (o) => { const c = { pool: [], lights: [], glow: null, faces: [], neon: null, objects: [], mats: [], floor: 0.02, k: 1, ...o }; chans.push(c); return chans.length - 1; };
  const setChan = (c, k) => {
    if (c.k === k) return; c.k = k;
    for (const i of c.pool) { lamps.off[i] = k; } if (c.pool.length) lamps.touch();
    for (const l of c.lights) l.userData.ndOff = k;
    c.glow?.set(Math.max(c.floor, k));
    for (const f of c.faces) f.off = Math.max(0.025, k);
    if (c.neon) { if (k < 0.35) c.neon.dark(); else c.neon.lit(); }
    for (const o of c.objects) o.visible = k > 0.35;
    for (const m of c.mats) { m.mat.color.copy(m.c0).multiplyScalar(Math.max(0.03, k)); }
  };
  const lampsOf = (L) => ({ pool: L?.pool || [], lights: L?.lights || [] });

  // ---- the dead neon tube: one instanced mesh of dark glass tubes, a slot per broken tube (no draw until one breaks)
  const deadMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.25, metalness: 0.1 });
  const dead = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), deadMat, 64);
  dead.name = 'destruct:dead-tubes'; dead.count = 0; dead.visible = false; dead.castShadow = false; dead.userData.collide = false; dead.userData.mgNoCapture = true; dead.frustumCulled = false; root.add(dead);
  const deadFree = [], ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  let deadUsed = 0;
  const neonHandle = (draw, box) => {
    const hide = vertexSet(draw); let slot = -1, isDark = false;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...box.center), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), box.yaw || 0), new THREE.Vector3(box.half[0] * 2, box.half[1] * 2, box.half[2] * 2));
    return {
      dark() { if (isDark) return; isDark = true; hide.apply(null, true); slot = deadFree.length ? deadFree.pop() : deadUsed++; if (slot < 64) { dead.setMatrixAt(slot, m); dead.count = Math.max(dead.count, slot + 1); dead.instanceMatrix.needsUpdate = true; dead.visible = true; } },
      lit() { if (!isDark) return; isDark = false; hide.restore(); if (slot >= 0 && slot < 64) { dead.setMatrixAt(slot, ZERO); dead.instanceMatrix.needsUpdate = true; deadFree.push(slot); } slot = -1; },
    };
  };

  // ---- the registry
  const d = createDestructibles(ctx, {
    seed: plan.name + ':props', vfx, audio, detail,
    maxDebris: tier === 'low' ? 160 : tier === 'medium' ? 380 : 600, maxDecals: tier === 'low' ? 32 : tier === 'medium' ? 64 : 96,
    maxEmitters: tier === 'low' ? 4 : 8, maxMovers: tier === 'low' ? 24 : 48,
    lamps: (i, k) => { const c = chans[i]; if (c) setChan(c, k); },
    occluder,
    materials: {
      // broken glass reads as glass: dark, tinted, small (the light catches it as glints), not pale confetti
      glass: { debris: { shape: 'glass', count: 54, size: [0.012, 0.085], colors: ['#2c3a40', '#46585e', '#1c2428', '#7a9298'] } },
      // poured concrete: chips, never goes, blocks a blast like heavy metal
      concrete: { health: 6000, armour: { bullet: 0.15, pellet: 0.1, blast: 0.4, melee: 0.1, emp: 0, fire: 0 }, pierce: 0, value: 0, sound: 'heavy', blocks: true, hitSound: 'thud',
        stages: [{ at: 0.0001, mark: 'hole' }], debris: { shape: 'chunk', count: 10, size: [0.03, 0.12], speed: [1, 3], spread: 0.6, up: 1, bounce: 0.2, friction: 0.8, spin: 6, rest: 5, colors: ['#8a8986', '#6f6e6b'] }, fx: { hit: 'dust', break: 'dust' } },
    },
    effects: {
      // an extinguisher's discharge: a dense white cloud that rolls out from the hole
      extinguisher: { name: 'nd-extinguisher', rate: 60, life: [1.4, 2.4], shape: { type: 'point' }, velocity: { speed: [3, 5], spread: 22 }, gravity: 0.1, drag: 2.2, wind: 0.4,
        turbulence: { strength: 0.6, scale: 0.9, speed: 0.5 }, size: [0.35, 0.6], sizeOverLife: [[0, 0.4], [1, 3.6]], color: '#f4f6f8', alpha: [[0, 0], [0.08, 0.6], [1, 0]], rotation: [0, 360], spin: [-30, 30],
        render: { blend: 'alpha', lit: 1, soft: 0.5, flipbook: { sheet: 'smoke', fps: 0, blend: true } } },
    },
  });
  const brokenWood = new THREE.MeshStandardMaterial({ color: 0x5c4129, roughness: 0.9 });
  brokenWood.name = 'destruct:broken-wood';

  // ---- props by family -------------------------------------------------------------------------------------------
  const byId = new Map(), groupsOf = new Map(), cars = new Map(), anims = [], fams = {};
  const count = (f) => { fams[f] = (fams[f] || 0) + 1; };
  const proxyOff = (e) => { for (const px of e.proxies || []) setProxy(px, false); };
  const proxyOn = (e) => { for (const px of e.proxies || []) setProxy(px, true); };
  const proxyHandles = new Map();
  for (const [h, inf] of physics.info) if (inf.object?.userData?.collider) proxyHandles.set(inf.object, h);
  function setProxy(px, on) { const h = proxyHandles.get(px); if (h == null) return; const c = physics.world.getCollider(h); if (c) c.setEnabled(on); }
  for (const e of entries) for (const px of e.proxies || []) px.userData.destructible = e.id;
  const add = (e, spec) => {
    const it = d.add({ id: e.id, value: PRICE[e.fam] ?? 0, ...spec, tags: [e.fam, ...(spec.tags || [])] });
    it.entry = e; byId.set(e.id, it); count(spec.countAs || e.fam);
    // (only what is gone when it breaks stops colliding: a crate, a bin, a scooter thrown, a window; a machine, a car, a
    // barrier stand where they were)
    if (e.proxies?.length && GONE.has(e.fam)) { const was = it.onBreak; it.onBreak = (ev, api) => { proxyOff(e); was?.(ev, api); }; }
    if (e.lampGroup) { if (!groupsOf.has(e.lampGroup)) groupsOf.set(e.lampGroup, []); groupsOf.get(e.lampGroup).push(it); }
    return it;
  };
  const glowChan = (e, extra = {}) => chan({ ...lampsOf(e.lamps), glow: glowSet(e.glow), ...extra });
  const products = { can: { material: 'thinMetal', mover: { shape: 'cylinder', breakable: false, mass: 0.35 } }, bottle: { material: 'glass', health: 6, mover: { shape: 'cylinder', mass: 0.6 } },
    cup: { material: 'plastic', health: 5, mover: { shape: 'cylinder', mass: 0.15 } }, box: { material: 'cardboard', health: 8, mover: { shape: 'box', mass: 0.3 } },
    pack: { material: 'fabric', health: 6, mover: { shape: 'box', mass: 0.12 } }, cap: { material: 'plastic', health: 5, mover: { shape: 'cylinder', mass: 0.08 } } };
  const machinesOf = new Map();   // a vending machine's id -> its glass and goods
  const owner = [];
  for (const e of entries) {
    const f = e.fam;
    if (f === 'vending') {
      const it = add(e, { material: 'electronics', health: 140, box: e.box, lamps: [glowChan(e, { floor: 0.03 })], lampMode: 'flicker', armour: { bullet: 0.8 },
        behave: { ...(e.kind === 'drinks' || e.kind === 'hot' ? { spillLiquid: { radius: 0.8, conductive: true, color: '#141a1e' } } : {}), dropLoot: { chance: e.kind === 'parts' ? 1 : 0.55, table: e.kind === 'parts' ? [{ id: 'ammo', weight: 1 }] : [{ id: 'ammo', weight: 2 }, { id: 'med', weight: 1 }] } },
        broken: null, onBreak: (ev) => burst(it, ev) });
      machinesOf.set(e.id, { it, glass: null, goods: [] });
    } else if (f === 'vending-glass') {
      const it = add(e, { material: 'glass', health: 30, draw: e.draw, broken: 'pane' });
      const mc = machinesOf.get(e.of); if (mc) mc.glass = it;
    } else if (f === 'product') {
      const p = products[e.shape]; if (!p) continue;
      const it = add(e, { ...p, draw: e.inst, value: PRICE[e.shape] ?? 2, countAs: 'product' });
      machinesOf.get(e.of)?.goods.push(it);
    } else if (f === 'shop-glass') add(e, { material: 'glass', health: 40, draw: e.draw, box: e.box, broken: 'pane' });
    else if (f === 'lightbox') add(e, { material: 'glass', health: 30, draw: e.draw, box: e.box, broken: null, sound: 'glass' });
    else if (f === 'shutter') add(e, shutterSpec(e));
    else if (f === 'ac') add(e, { material: 'thinMetal', health: 90, box: e.box, stages: [{ at: 0.01, mark: 'dent' }], broken: null, behave: { ventSteam: { duration: 3, radius: 0.5, height: 1.4, density: 1.2 } } });
    else if (f === 'neon') {
      const nh = neonHandle(e.draw, e.box);
      add(e, { material: 'glass', health: 12, box: e.box, lamps: [chan({ ...lampsOf(e.lamps), neon: nh })], lampMode: 'flicker', broken: null });
    } else if (f === 'tube') add(e, { material: 'glass', health: 15, box: e.box, lamps: [glowChan(e)], lampMode: 'flicker', broken: null });
    else if (f === 'streetlamp') add(e, { material: 'glass', health: 15, box: e.box, lamps: [glowChan(e)], lampMode: 'flicker', broken: null, tags: ['light'] });
    else if (f === 'bulb') add(e, { material: 'glass', health: 4, sphere: e.sphere, draw: e.draw, group: e.group, behave: { chain: { delay: 0.08, index: e.chainIndex } }, tags: ['light'] });
    else if (f === 'lantern') add(e, { material: 'paper', health: 8, sphere: e.sphere, lamps: e.lamps?.pool?.length || e.lamps?.lights?.length || e.glow.length ? [glowChan(e, { floor: 0.1 })] : [], lampMode: 'off', tags: ['light'] });
    else if (f === 'sign') {
      if (!e.box && e.kind !== 'blade' && e.object) { const b3 = new THREE.Box3().setFromObject(e.object), h = b3.getSize(new THREE.Vector3()).multiplyScalar(0.5); e.box = { center: b3.getCenter(new THREE.Vector3()).toArray(), half: [Math.max(h.x, 0.05), Math.max(h.y, 0.05), Math.max(h.z, 0.05)] }; }
      if (e.owner) { add(e, { material: 'glass', protected: true, box: e.box || undefined, draw: e.box ? undefined : e.object, tags: ['owner'], countAs: 'owner-sign' }); owner.push(e.id); continue; }
      const faces = (e.faces || []).map((m) => faceOf.get(m)).filter(Boolean), area = (e.w || 2) * (e.h || 1);
      const c = chan({ ...lampsOf(e.lamps), faces, mats: !faces.length && e.object?.material ? [{ mat: e.object.material, c0: e.object.material.color.clone() }] : [] });
      if (e.kind === 'blade') {
        const back = vertexSet([...(e.back || []), ...(e.brackets || [])]);
        add(e, { material: 'glass', health: 45, value: PRICE.blade, draw: e.object, lamps: [c], lampMode: 'flicker', behave: { fall: { damage: 140, radius: 1.3, bounce: 0.1 } }, countAs: 'blade',
          onBreak: () => back.apply(null, true), tags: ['light'] }).back = back;
      } else add(e, { material: 'glass', health: 30, value: Math.min(2500, Math.round(150 * area)), box: e.box || undefined, draw: e.box ? undefined : e.object, lamps: [c], lampMode: 'flicker', broken: null, tags: ['light'] });
    } else if (f === 'led') add(e, { material: 'electronics', health: 200, box: e.box, lamps: [chan({ ...lampsOf(e.lamps), objects: [e.object] })], lampMode: 'flicker', broken: null });
    else if (f === 'bar-window') add(e, { material: 'glass', health: 40, draw: e.object, broken: 'pane' });
    else if (f === 'bottle') add(e, { material: 'glass', health: 6, value: PRICE.barBottle, box: e.box, draw: e.draw, broken: null, behave: { spillLiquid: { radius: 0.32, grow: 0.8, color: '#2a1a0c' } } });
    else if (f === 'glassware') add(e, { material: 'glass', health: 4, box: e.box, draw: e.draw, broken: null });
    else if (f === 'bowls') add(e, { material: 'ceramic', health: 10, box: e.box, draw: e.draw, broken: null });
    else if (f === 'jar') add(e, { material: 'glass', health: 6, box: e.box, draw: e.draw, broken: null });
    else if (f === 'crate') add(e, { material: 'wood', health: 70, pierce: 0.15, box: e.box, draw: e.draw, broken: 'crate', brokenMaterial: brokenWood, solid: false, onBreak: () => { if (e.id === 'crate-alley-0') d.damage('crate-alley-1', 999, 'blast'); } });
    else if (f === 'cardboard') add(e, { material: 'cardboard', health: 25, pierce: 0.5, box: e.box, draw: e.draw, broken: null, behave: { dropLoot: { chance: 0.12, table: [{ id: 'ammo', weight: 1 }] } } });
    else if (f === 'bag') add(e, { material: 'fabric', health: 30, pierce: 0.35, box: e.box, draw: e.draw, broken: null });
    else if (f === 'bin') add(e, { material: 'plastic', health: 50, pierce: 0.3, box: e.box, draw: e.draw, broken: null });
    else if (f === 'jersey') add(e, { material: 'concrete', box: e.box, countAs: 'jersey' });
    else if (f === 'barricade') add(e, { material: 'plastic', health: 1e7, pierce: 0.4, box: e.box, value: 0 });
    else if (f === 'beacon') add(e, { material: 'glass', health: 6, sphere: e.sphere, lamps: [glowChan(e)], broken: null, tags: ['light'] });
    else if (f === 'scooter') add(e, scooterSpec(e));
    else if (f === 'car') carSpecs(e);
    else if (f === 'car-glass' || f === 'tyre') cars.get(e.of)?.parts.push(e);
    else if (f === 'gas') add(e, { material: 'thinMetal', health: 45, box: e.box, draw: e.draw, broken: null, sound: 'metal',
      behave: { burn: { duration: 2.6, then: 'explode', at: 0.25, catch: ['blast', 'fire'] }, explosive: { delay: 0.2, radius: 5.5, damage: 230, falloff: 'linear' } } });
    else if (f === 'extinguisher') add(e, { material: 'thinMetal', health: 18, box: e.box, draw: e.draw, broken: null,
      behave: { ventSteam: { duration: 9, radius: 1.7, height: 2.4, density: 3.2, effect: 'extinguisher' } } });
    else if (f === 'canopy') add(e, canopySpec(e));
    else if (f === 'steampipe') add(e, { material: 'thinMetal', health: 40, box: e.box, stages: [{ at: 0.01, mark: 'dent' }], broken: null, behave: { ventSteam: { duration: 25, radius: 0.75, height: 2.6, density: 2.6 } } });
    else if (f === 'waterpipe') add(e, { material: 'thinMetal', health: 30, box: e.box, stages: [{ at: 0.01, mark: 'dent' }], broken: null, behave: { sprayWater: { duration: 30, radius: 0.6, height: 1.8, density: 1.1 }, spillLiquid: { radius: 1.6, grow: 6, slippery: true, color: '#0b1216' } } });
  }
  for (const [, car] of cars) carParts(car);
  // the shared lamps: a row of machines, a string of bulbs, a cart's or the stall's lanterns, the bar's door pair
  const groupChans = new Map();
  for (const [g, L] of Object.entries(lampGroups)) groupChans.set(g, chan(lampsOf(L)));
  const groupLit = () => {
    for (const [g, list] of groupsOf) { const c = chans[groupChans.get(g)]; if (c) setChan(c, list.every((it) => it.broken) ? 0 : 1); }
  };
  // the protected: the pass on the counter, the uplink terminal (a round or a blast near them does nothing)
  if (plan.bar?.pass) { d.add({ id: 'pass', protected: true, sphere: { center: plan.bar.pass, radius: 0.15 }, material: 'plastic', tags: ['route'] }); count('protected'); }
  const con = ctx.anchors?.consoles?.[0];
  if (con) { d.add({ id: 'uplink', protected: true, box: { center: con.pos, half: [0.6, 0.5, 0.25], yaw: con.rotY || 0 }, material: 'electronics', tags: ['route'] }); count('protected'); }

  // ---- a vending machine bursts: its glass goes, its goods fly out of the front, sparks and smoke
  function burst(it, ev) {
    const mc = machinesOf.get(it.id); if (!mc) return;
    if (mc.glass && !mc.glass.broken) d.break(mc.glass, { kind: 'blast', point: mc.glass.vol.c, source: it });
    const out = [Math.sin(it.entry.box.yaw || 0), 0, Math.cos(it.entry.box.yaw || 0)];
    // the cans are thrown out of the front (they roll on the pavement); what breaks, breaks where it stood
    let n = 0;
    for (const g of mc.goods) {
      if (g.broken || n > (tier === 'low' ? 6 : 14) || (g.index * 7) % 3) continue;
      const can = g.mover?.spec.breakable === false;
      d.damage(g, can ? 45 : 99, can ? 'melee' : 'blast', { dir: [out[0] + Math.sin(g.index) * 0.35, 0.25, out[2] + Math.cos(g.index) * 0.35], point: g.vol.c.slice(), source: ev.source ?? it });
      n++;
    }
  }

  // ---- shutters: a blast pushes the ribs in round where it hit and scorches them (a hole look); rounds only mark
  function shutterSpec(e) {
    const vs = vertexSet(e.shutter); let at = null;
    const n = [Math.sin(e.box.yaw || 0), 0, Math.cos(e.box.yaw || 0)];
    const dent = (P) => {
      const R = 1.1, depth = 0.38;
      vs.apply((v) => {
        const dx = v.x - P[0], dy = v.y - P[1], dz = v.z - P[2], along = dx * n[0] + dz * n[2], r = Math.hypot(dx - along * n[0], dy, dz - along * n[2]);
        if (r > R) return;
        const k = Math.pow(1 - r / R, 1.6), jag = 0.75 + 0.25 * Math.sin(v.x * 37 + v.y * 23) * Math.sin(v.z * 41 + v.y * 11);
        v.x -= n[0] * depth * k * jag; v.z -= n[2] * depth * k * jag; v.y -= 0.08 * k * Math.sign(dy || 1);
      });
    };
    return { material: 'heavyMetal', health: 180, armour: { bullet: 0.01, pellet: 0.01, blast: 1, melee: 0.05 }, box: e.box, stages: [{ at: 0.0001, mark: 'dent' }], broken: null, sound: 'heavy',
      draw: { hide() { dent(at || e.box.center); }, show() { vs.restore(); }, box: () => false },
      onHit: (ev) => { if (ev.kind === 'blast') at = ev.point.slice ? ev.point.slice() : [...ev.point]; },
      onBreak: (ev) => { const P = at || e.box.center; d.marks.add('scorch', [P[0] + n[0] * 0.02, P[1], P[2] + n[2] * 0.02], n, [2.2, 2.2], -1, ev.time * 3.1, null, 0.95); } };
  }

  // ---- scooters: a rocket throws one (its ranges lifted out into a copy that flies, bounces and lies on its side);
  // rounds dent it and leave it standing
  function scooterSpec(e) {
    const vs = vertexSet(e.draw); let thrown = null, lastKind = 'bullet', lastDir = [0, 0, 1];
    const lift = (P, dir, quiet) => {
      if (thrown) { thrown.removeFromParent(); thrown = null; }
      const g = new THREE.Group(), c = new THREE.Vector3(...e.box.center);
      for (const r of vs.list) {
        const src = r.mesh.geometry, geo = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(src.attributes)) { const n = a.itemSize; const arr = a.array.slice(r.first * n, (r.first + r.count) * n); if (k === 'position') arr.set(r.p0); geo.setAttribute(k, new THREE.BufferAttribute(arr, n)); }
        geo.translate(-c.x, -c.y, -c.z); geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, r.mesh.material); m.castShadow = false; m.userData.collide = false; g.add(m);
      }
      g.position.copy(c); g.name = 'destruct:thrown'; g.userData.collide = false; root.add(g); thrown = g;
      const floor = e.box.center[1] - e.box.half[1] + 0.3;
      if (quiet) { g.position.set(c.x + 1.2, floor, c.z + 0.4); g.rotation.set(0, (e.box.yaw || 0) + 0.6, 1.45); return; }
      const L = Math.hypot(dir[0], dir[2]) || 1;
      anims.push({ kind: 'throw', o: g, v: [dir[0] / L * 5.5, 6.5, dir[2] / L * 5.5], w: [3.1, 1.2, 5.3], floor, t: 0 });
    };
    vs.thrownOf = () => thrown;
    return { material: 'thinMetal', health: 150, armour: { blast: 1.6 }, box: e.box, stages: [{ at: 0.01, mark: 'dent' }], broken: null,
      draw: { hide() { if (lastKind === 'blast' || restoring) { vs.apply(null, true); lift(e.box.center, lastDir, restoring); proxyOff(e); } }, show() { vs.restore(); proxyOn(e); if (thrown) { thrown.removeFromParent(); thrown = null; } }, box: () => false },
      onHit: (ev) => { lastKind = ev.kind; lastDir = ev.dir ? [ev.dir[0], ev.dir[1], ev.dir[2]] : lastDir; } };
  }

  // ---- the stall's flap: a rocket knocks the struts out and it swings down on its hinge; its lanterns go with it
  function canopySpec(e) {
    const flap = vertexSet(e.flap), struts = vertexSet(e.draw), H = e.hinge, ax = new THREE.Vector3(...H.axis), q = new THREE.Quaternion(), p = new THREE.Vector3(...H.at);
    const fold = (k) => { q.setFromAxisAngle(ax, -1.05 * k); flap.apply((v) => { v.sub(p).applyQuaternion(q).add(p); }); };
    return { material: 'thinMetal', health: 150, armour: { bullet: 0.08, pellet: 0.05, blast: 1.3 }, box: e.box, stages: [{ at: 0.01, mark: 'dent' }], broken: null,
      draw: { hide() { struts.apply(null, true); if (restoring) fold(1); else anims.push({ kind: 'fold', fn: fold, t: 0 }); }, show() { flap.restore(); struts.restore(); }, box: () => false },
      onBreak: () => { for (const it of d.items) if (it.entry?.hangs === e.id && !it.broken) d.damage(it, 50, 'blast'); } };
  }

  // ---- cars: glass panes (tempered: they crumble), tyres (flat: that corner sinks), the body (dents, the alarm, fire
  // under it past half its health, then it goes off), a cabin box above the belt line that passes its hits to the body
  function carSpecs(e) {
    const M = new THREE.Matrix4().fromArray(e.matrix), inv = M.clone().invert();
    const car = { e, M, inv, flat: new Set(), parts: [], body: null, panes: [], tyres: [], shape: vertexSet(e.car) };
    cars.set(e.id, car);
    car.body = add(e, { material: 'thinMetal', health: 620, box: e.box, stages: [{ at: 0.01, mark: 'dent' }], broken: null, lamps: [chan(lampsOf(e.lamps))], lampMode: 'flicker',
      behave: { alarm: { radius: 35, duration: 10 }, burn: { duration: 5, then: 'explode', at: 0.55, catch: ['blast', 'fire'] }, explosive: { delay: 0.15, radius: 7, damage: 300, falloff: 'linear' } },
      onBreak: () => { car.batch = true; for (const it of [...car.panes.map((p) => p.it), ...car.tyres]) if (!it.broken) d.break(it, { kind: 'blast', source: car.body }); car.batch = false; car.reshape(); car.char.set(0.16); burnOn(car, 14); } });
    car.char = glowSet(e.car);
    add({ id: e.id + '-cabin', fam: 'car-cabin' }, { material: 'thinMetal', health: 1e9, value: 0, box: e.cabin, stages: [], countAs: 'car-cabin',
      onHit: (ev) => { if (ev.kind !== 'blast' && !car.body.broken) d.damage(car.body, ev.damage / 0.6, ev.kind, { point: ev.point, dir: ev.dir, source: ev.source }); } });
  }
  function carParts(car) {
    const lv = new THREE.Vector3();
    const reshape = () => {
      if (car.batch) return;   // (a car going off breaks every pane and tyre: one reshape after them)
      const drops = [...car.flat].map((it) => it.entry);
      const sink = (v) => {
        if (!drops.length) return;
        lv.copy(v).applyMatrix4(car.inv);
        let dy = 0;
        for (const t of drops) { const [sx, sz] = t.corner, ax = Math.abs(t.local[0]) || 1, hw = Math.abs(t.local[2]) || 1; const w = Math.max(0, (1 + sx * lv.x / ax) / 2) * Math.max(0, (1 + sz * lv.z / hw) / 2); dy += 0.075 * Math.min(1, w); }
        lv.y -= dy; v.copy(lv.applyMatrix4(car.M));
      };
      car.shape.apply(sink);
      for (const p of car.panes) p.vs.apply(sink, p.hidden);
      for (const t of car.tyres) {
        const flat = car.flat.has(t), [cx, cy] = t.entry.local, r = cy + 0.012;
        t.vs.apply((v) => { if (flat) { lv.copy(v).applyMatrix4(car.inv); const low = cy - r * 0.55; if (lv.y < low) lv.y = low + (lv.y - low) * 0.32; lv.x = cx + (lv.x - cx) * (lv.y < cy ? 1.06 : 1); v.copy(lv.applyMatrix4(car.M)); } sink(v); });
      }
    };
    car.reshape = reshape;
    for (const e of car.parts) {
      if (e.fam === 'car-glass') {
        const vs = vertexSet(e.pane), p = { vs, hidden: false, it: null };
        p.it = add(e, { material: 'glass', health: 30, box: vs.box(), broken: null, draw: { hide() { p.hidden = true; reshape(); }, show() { p.hidden = false; reshape(); }, box: () => false } });
        car.panes.push(p);
      } else {
        const vs = vertexSet(e.tyre);
        const it = add(e, { material: 'plastic', health: 40, armour: { bullet: 0.7, pellet: 0.7, blast: 1.2 }, box: e.box, broken: null, sound: 'fabric',
          draw: { hide() { car.flat.add(it); reshape(); }, show() { car.flat.delete(it); reshape(); }, box: () => false } });
        it.vs = vs; car.tyres.push(it);
      }
    }
  }

  // a wreck burns on for a while after it went off (an emitter of the registry's fire, then its smoke)
  const wrecks = [];
  function burnOn(car, sec) {
    const c = car.e.box.center, h = vfx.spawn(d.effects.fire, { position: [c[0], c[1] + car.e.box.half[1] + 0.2, c[2]] });
    wrecks.push({ h, until: performance.now() + sec * 1000 });
  }
  game.system(() => { for (let i = wrecks.length - 1; i >= 0; i--) if (performance.now() > wrecks[i].until) { wrecks[i].h.stop(); wrecks.splice(i, 1); } });

  // ---- civilians: the street's robots as actors ------------------------------------------------------------------
  const machines = world.scene.getObjectByName('machines'), B = machines?.userData.batches;
  const civ = [];
  const HEIGHT = { pedestrian: 1.45, walker: 1.45, courier: 0.7, vendor: 1.0, sweeper: 1.1 };
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4();
  for (const u of machineUnits(machines)) {
    if (!HEIGHT[u.kind]) continue;   // the totem is a kiosk, the broken units are broken already
    u.frame.decompose(_p, _q, _s);
    const ground = (() => { const h = occluder([_p.x, _p.y + 0.5, _p.z], [0, -1, 0], 6); return h ? _p.y + 0.5 - h.distance : _p.y - 0.9; })();
    const c = { u, ground, pos: [_p.x, ground, _p.z], k: 0, dir: [0, 0, 1], cower: 0, cowerT: 0, last: new Map(), ids: [], moving: u.kind === 'walker' || u.kind === 'courier' || u.kind === 'sweeper' };
    for (const [mesh, ids] of [[B.shell, u.shell], [B.lights, u.lights], [B.decals, u.decals]]) for (const id of ids) if (mesh && id != null) c.ids.push([mesh, id]);
    if (B.canopy && u.canopy[0] != null) { c.ids.push([B.canopy, u.canopy[0]]); if (u.canopy[1] != null) c.ids.push([B.shell, u.canopy[1]]); if (u.canopy[2] != null) c.ids.push([B.lights, u.canopy[2]]); }
    c.item = d.actor({ id: 'civ-' + u.id, pos: c.pos, height: HEIGHT[u.kind], radius: u.kind === 'courier' ? 0.4 : 0.3, health: 45, value: CIVILIAN.value, tags: ['civilian', u.kind], panicRadius: 11,
      collapse: (it, k, dir) => { c.k = k; c.dir = dir; }, onPanic: () => { if (!c.item.broken) { c.cower = Math.max(c.cower, 0.01); c.cowerT = 7 + (civ.length % 3); } } });
    c.item.civ = c; civ.push(c); count('civilian');
  }
  // after the machines have posed every unit this frame: a fallen one folds over its feet where it fell, a scared
  // one crouches (written onto the instances machines.js wrote; a matrix it did not write again is left alone)
  const post = (dt) => {
    for (const c of civ) {
      const fallen = c.k > 0, cower = c.cower > 0;
      if (c.moving && !fallen) { c.u.frame.copy(B.shell.getMatrixAt(c.u.shell[0], _m)); _p.setFromMatrixPosition(_m); c.pos[0] = _p.x; c.pos[2] = _p.z; d.place(c.item, c.pos); }
      if (!fallen && !cower) { if (c.last.size) c.last.clear(); continue; }
      if (cower) { c.cowerT -= dt; c.cower = c.cowerT > 0 ? Math.min(1, c.cower + dt * 4) : Math.max(0, c.cower - dt * 1.5); }
      B.shell.getMatrixAt(c.u.shell[0], _m); _p.setFromMatrixPosition(_m);
      const at = fallen ? (c.at ||= c.pos.slice()) : c.pos;
      // the fold: about the feet, across the way the round came; pinned where it fell
      const e = smooth(Math.min(1, c.k)), ax = new THREE.Vector3(c.dir[2], 0, -c.dir[0]).normalize();
      _c.makeTranslation(at[0], c.ground, at[2]).multiply(_r.makeRotationAxis(ax, fallen ? e * 1.42 : 0)).multiply(_t.makeScale(1, fallen ? 1 - 0.05 * e : 1 - 0.22 * c.cower, 1)).multiply(_m.makeTranslation(-_p.x, -c.ground, -_p.z));
      for (const [mesh, id] of c.ids) {
        mesh.getMatrixAt(id, _t);
        const key = mesh.id * 100000 + id, was = c.last.get(key);
        if (was && was.equals(_t)) continue;   // not written again by the machines this frame: already ours
        _t.premultiply(_c); mesh.setMatrixAt(id, _t);
        if (was) was.copy(_t); else c.last.set(key, _t.clone());
      }
    }
  };
  let lastT = -1;
  const offPost = world.ctx.onUpdate((t) => { const dt = lastT < 0 ? 0 : Math.min(0.05, Math.max(0, t - lastT)); lastT = t; post(dt); if (anims.length) stepAnims(dt); });

  // ---- animations of our own: a thrown scooter, a folding flap
  function stepAnims(dt) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i]; a.t += dt;
      if (a.kind === 'fold') { a.fn(Math.min(1, smooth(Math.min(1, a.t / 0.7)) * (1 + 0.08 * Math.sin(Math.min(1, a.t / 0.7) * 9) * (1 - Math.min(1, a.t / 0.7))))); if (a.t > 0.9) { a.fn(1); anims.splice(i, 1); } continue; }
      const o = a.o; a.v[1] -= 9.8 * dt;
      o.position.x += a.v[0] * dt; o.position.y += a.v[1] * dt; o.position.z += a.v[2] * dt;
      o.rotation.x += a.w[0] * dt; o.rotation.y += a.w[1] * dt; o.rotation.z += a.w[2] * dt;
      if (o.position.y < a.floor) { o.position.y = a.floor; a.v[1] = Math.abs(a.v[1]) * 0.25; a.v[0] *= 0.55; a.v[2] *= 0.55; a.w = a.w.map((w) => w * 0.5); if (Math.abs(a.v[1]) < 0.6) { o.rotation.x = Math.round(o.rotation.x / (Math.PI / 2)) * Math.PI / 2; o.rotation.z = Math.round(o.rotation.z / (Math.PI / 2)) * Math.PI / 2 || Math.PI / 2; anims.splice(i, 1); sfx.play('nd_impact', { at: o.position.toArray(), gain: 0.8, ref: 5, rate: 0.6 }); } }
    }
  }

  // ---- dark zones: a lamp-owning prop that broke darkens round it once most of the light there is gone (the lamps
  // still lit near it, weighted by distance, against all of them); the robots there see as in a hacked dark zone
  const lightProps = d.items.filter((it) => it.lamps.length && !it.protected);
  const zoneOf = (it) => {
    // a street lamp: the light hack's own zone for it (shot out, it is that hack for free, for good)
    const hz = it.entry?.hack ? hack.targets.find((t) => t.id === it.entry.hack)?.zone : null;
    if (hz?.c) return { c: [hz.c[0], it.vol.c[1], hz.c[1]], r: hz.r, y1: hz.y1, always: true };
    const c = it.vol.type === 2 ? it.vol.a : it.vol.c, ch = chans[it.lamps[0]];
    let r = 4;
    for (const i of ch?.pool || []) r = Math.max(r, Math.min(9, lamps.base[i].range * 0.55));
    for (const l of ch?.lights || []) r = Math.max(r, Math.min(9, l.distance * 0.55));
    return { c: [c[0], c[1], c[2]], r, y1: c[1] + 3 };
  };
  const zones = [];
  let darkList = [];
  const litNear = (z) => {
    let lit = 0, all = 0;
    const w = (p, power) => { const dd = Math.hypot(p[0] - z.c[0], p[1] - z.c[1], p[2] - z.c[2]); if (dd > z.r * 1.4) return 0; return power * (1 - dd / (z.r * 1.4)); };
    for (let i = 0; i < lamps.base.length; i++) { const L = lamps.base[i], k = w(L.pos, L.power); if (!k) continue; all += k; lit += k * lamps.off[i] * lamps.scale[i]; }
    for (const c of hack.clustered || []) { const k = w(c.pos, c.nd); if (!k) continue; all += k; lit += k * (c.light.userData.ndOff ?? 1); }
    return all > 0 ? lit / all : 1;
  };
  const rezone = (quiet) => {
    zones.length = 0;
    for (const it of lightProps) if (it.broken) zones.push({ ...zoneOf(it), it });
    const before = new Set(darkList.map((z) => z.it.id));
    darkList = zones.filter((z) => z.always || litNear(z) < 0.45);
    if (!quiet) for (const z of darkList) if (!before.has(z.it.id)) { enemies.darken(z.c, z.r); game.set('shotDark', (game.flags.shotDark || 0) + 1); }
    game.flags.darkProps = darkList.length;
  };
  hack.extraDark = (p) => { for (const z of darkList) if (Math.hypot(p[0] - z.c[0], p[2] - z.c[2]) < z.r && p[1] < z.y1) return 1; return 0; };
  hack.extraBlind = (from, to) => d.occluders.length > 0 && d.blocksSight([from[0], from[1] + 1.5, from[2]], [to[0], to[1] + 1.2, to[2]], 0.4);

  // ---- score: what the player broke (the bill), whose casualties are whose
  const score = { bill: 0, civilians: 0, others: 0, charged: new Set(), billed: new Set() };
  const blame = (src, it, depth = 0) => {
    if (src === 'player') return true;
    if (depth > 6) return false;
    if (src && typeof src === 'object' && src.lastHit !== undefined) return blame(src.lastHit?.source, src, depth + 1);
    if (src == null && it?.lastHit) return blame(it.lastHit.source, null, depth + 1);
    return false;
  };
  const sayCiv = () => { const L = X.civRadio; hud.radio(L[(score.civilians - 1) % L.length]); };
  d.on('break', (e) => {
    const it = e.item;
    if (it.lamps.length || it.entry?.lampGroup) { groupLit(); rezone(false); }
    if (blame(e.source, it)) { score.bill += it.value; score.billed.add(it.id); }
    if (it.tags.includes('light')) game.set('lightsOut', (game.flags.lightsOut || 0) + 1);
    game.set('propsBroken', d.tally.count);
  });
  d.on('casualty', (e) => {
    const it = e.item;
    if (blame(e.source, it)) {
      score.charged.add(it.id); score.civilians++;
      stats.civilians = score.civilians; stats.penalty = score.civilians * CIVILIAN.points;
      hud.warn?.(X.warn(CIVILIAN.points));
      sayCiv();
      sfx.play('nd_hurt', { gain: 0.35, rate: 0.6 });
      game.set('civilians', score.civilians);
    } else { score.others++; game.set('civiliansOther', score.others); }
  });
  d.on('panic', () => { game.flags.panics = (game.flags.panics || 0) + 1; });
  // a car alarm, a burst machine, a falling sign: the robots that are awake come to look (as the car hack's lure)
  d.on('noise', (e) => {
    if (e.kind === 'alarm') { const n = enemies.lure(e.point, Math.min(30, e.radius)); game.set('lured', (game.flags.lured || 0) + n); game.set('alarms', (game.flags.alarms || 0) + 1); }
    else enemies.noise(e.point, Math.min(e.radius, 22));
  });
  // a prop that goes off (the gas bottle, a car): the robots and the player in reach, behind cover less (the same
  // cover test the props get)
  d.on('blast', (e) => {
    if (!e.source || typeof e.source !== 'object' || !e.source.id) return;   // the player's own rockets: weapon.js
    const P = e.point, r = e.radius, fall = (dd) => Math.max(0.1, 1 - dd / r);
    let kills = 0;
    const at = (list, owner, cy) => { for (const en of list) { if (en.dead || (en.rig && !en.rig.root.visible) || (en.o && !en.o.visible)) continue; const c = [en.pos[0], en.pos[1] + cy(en), en.pos[2]], dd = Math.hypot(c[0] - P[0], c[1] - P[1], c[2] - P[2]); if (dd > r) continue; const k = e.cover(c); if (k <= 0) continue; stats.lastHead = false; if (owner.damage(en, e.damage * fall(dd) * k, false, c, [(c[0] - P[0]) / (dd || 1), (c[1] - P[1]) / (dd || 1), (c[2] - P[2]) / (dd || 1)], { splash: true })) kills++; } };
    at(enemies.list, enemies, (en) => 1.0 * en.K.scale); at(drones.list, drones, () => 0);
    const pc = [player.feet[0], player.feet[1] + 1, player.feet[2]], dp = Math.hypot(pc[0] - P[0], pc[1] - P[1], pc[2] - P[2]);
    let hurt = 0;
    if (dp < r) { const k = e.cover(pc); hurt = e.damage * 0.45 * fall(dp) * k * (assist ? 0.15 : 1); if (hurt > 0.5) player.hurt(hurt, P); }
    weapon.addShake(3 * Math.max(0, 1 - dp / 30));
    game.set('propBlasts', (game.flags.propBlasts || 0) + 1); if (hurt > 0.5) game.set('propBlastHurt', Math.round((game.flags.propBlastHurt || 0) + hurt)); if (kills) game.set('propBlastKills', (game.flags.propBlastKills || 0) + kills);
    sfx.play(['nd_rkt_boom_open'], { at: P, gain: 1, ref: 8 });
  });
  d.on('crush', (e) => {
    // a sign that fell: whoever was under it
    for (const en of enemies.list) { if (en.dead || !en.rig?.root.visible) continue; if (Math.hypot(en.pos[0] - e.point[0], en.pos[2] - e.point[2]) < e.radius + 0.4) { enemies.damage(en, e.damage * 2.5, false, [en.pos[0], en.pos[1] + 1, en.pos[2]], [0, -1, 0], { splash: true }); game.set('crushed', (game.flags.crushed || 0) + 1); } }
    if (Math.hypot(player.feet[0] - e.point[0], player.feet[2] - e.point[2]) < e.radius) player.hurt(e.damage * 0.5, e.point);
  });
  // loot: a cell of ammunition on the ground, or a med can
  const meds = Array.from({ length: 3 }, () => {
    const o = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), new THREE.MeshStandardMaterial({ color: 0xd8dde0, roughness: 0.4 }));
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.06, 0.165), new THREE.MeshStandardMaterial({ color: 0x103a18, emissive: 0x30ff70, emissiveIntensity: 2 }));
    o.add(box, cross); o.visible = false; o.traverse((m) => { m.userData.collide = false; m.castShadow = false; }); root.add(o);
    return { o, live: false, t: 0 };
  });
  d.on('loot', (e) => {
    const p = [e.point[0], e.point[1], e.point[2]], it = e.item, yaw = it.entry?.box?.yaw;
    if (yaw != null) { p[0] += Math.sin(yaw) * 0.8; p[2] += Math.cos(yaw) * 0.8; }
    const floor = occluder([p[0], p[1] + 0.2, p[2]], [0, -1, 0], 4); if (floor) p[1] = p[1] + 0.2 - floor.distance;
    if (e.loot.id === 'ammo') ammo?.drop(p, 24);
    else { const m = meds.find((x) => !x.live) || meds[0]; m.live = true; m.t = 0; m.o.position.set(p[0], p[1] + 0.12, p[2]); m.o.visible = true; }
    game.set('loot', (game.flags.loot || 0) + 1);
  });
  game.system((dt) => {
    for (const m of meds) {
      if (!m.live) continue;
      m.t += dt; m.o.rotation.y = m.t * 1.6;
      if (player.dead || player.hp >= 100) continue;
      if (Math.hypot(player.feet[0] - m.o.position.x, player.feet[2] - m.o.position.z) < 0.9 && Math.abs(player.feet[1] - m.o.position.y) < 1.2) {
        player.hp = Math.min(100, player.hp + 25); m.live = false; m.o.visible = false; sfx.play('nd_med', { gain: 0.8 }); game.ui.toast(T.med); game.set('medTaken', (game.flags.medTaken || 0) + 1);
      }
    }
  });

  // ---- the robots' rounds: every tracer a robot or a kite draws is a round fired (props on its line take it; a
  // civilian in the way is hit, not charged to the player)
  if (tap) tap.hook = (o) => {
    const from = o.from, to = o.to, dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], L = Math.hypot(dx, dy, dz);
    if (L < 0.5) return;
    const r = d.hit({ ray: { origin: from, dir: [dx / L, dy / L, dz / L], max: L + 0.05 }, kind: 'bullet', damage: 14, source: 'enemy' });
    if (r.count) game.flags.enemyPropHits = (game.flags.enemyPropHits || 0) + r.count;
  };

  // ---- saves: the registry saves itself; the score and our own looks (a thrown scooter, a folded flap, a sunk car)
  // come back from the broken set
  let restoring = false;
  d.on('reset', () => { anims.length = 0; for (const e of entries) proxyOn(e); for (const w of wrecks) w.h.stop(); wrecks.length = 0; for (const car of cars.values()) car.char?.set(1); for (const c of civ) { c.k = 0; c.at = null; c.cower = 0; c.cowerT = 0; c.last.clear(); } for (const car of cars.values()) { car.flat.clear(); car.reshape?.(); } darkList = []; groupLit(); for (const m of meds) { m.live = false; m.o.visible = false; } });
  d.on('restore', () => { groupLit(); rezone(true); for (const car of cars.values()) if (car.body.broken) car.char.set(0.16); for (const it of d.items) if (it.broken && it.entry && GONE.has(it.entry.fam)) proxyOff(it.entry); });
  const restoreOf = d.restore;
  d.restore = (s) => { restoring = true; try { return restoreOf(s); } finally { restoring = false; } };
  game.add({ id: 'destructScore', save: () => ({ bill: score.bill, civ: [...score.charged], billed: [...score.billed], others: score.others }),
    load: (s) => { score.bill = s?.bill || 0; score.charged = new Set(s?.civ || []); score.billed = new Set(s?.billed || []); score.others = s?.others || 0; score.civilians = score.charged.size; stats.civilians = score.civilians; stats.penalty = score.civilians * CIVILIAN.points; } });
  // the game's load: the registry's entity is loaded with the others (and its restore runs quietly)
  // (hack.js resets its own lights on load: ours are a separate factor, lamps.off / ndOff / face.off, so they stay)

  // ---- the weapon's side -----------------------------------------------------------------------------------------
  const kindOf = (pellets) => (pellets > 1 ? 'pellet' : 'bullet');
  const api = {
    d, score, fams, civ, cars, chans, occluder, PRICE,
    /** the world's distance along a ray for a round (the props' proxies and the characters stepped over) */
    worldRay: (o, dir, max) => occluder(o, dir, max),
    /** a round along a ray up to `max` (an enemy's distance or the wall's): the props on it, nearest first.
     *  Returns the registry's result (left: the damage that goes on to what is behind) */
    shoot(o, dir, max, damage, pellets = 1, gun = '') {
      const k = gun === 'gatling' ? 1.6 : gun === 'shotgun' ? 1.2 : 1;
      const r = d.hit({ ray: { origin: o, dir, max }, kind: kindOf(pellets), damage: damage * k, source: 'player' });
      r.frac = r.count ? r.left / (damage * k) : 1;   // the share that goes on to the robot behind
      return r;
    },
    /** the rocket's blast on the props: wider and harder than on the robots (it throws, folds and dents) */
    blast(p, radius, damage) { return d.blast({ point: p, radius: radius * 1.25, damage: damage * 1.15, falloff: (x) => Math.max(0.15, 1 - Math.pow(x, 1.2)), source: 'player' }); },
    melee(o, dir, max = 2.3) { return d.hit({ ray: { origin: o, dir, max }, kind: 'melee', damage: 85, pierce: false, source: 'player' }); },
    /** the nearest prop a rocket would touch this step */
    touch(o, dir, max) { const h = d.ray(o, dir, max); return h && !h.item.actor ? { t: h.t, point: h.point.slice() } : h ? { t: h.t, point: h.point.slice(), actor: true } : null; },
    /** the impact by what was hit: a sound name for weapon.js */
    impactSound(cls) { return cls === 'glass' || cls === 'ceramic' ? 'nd_imp_glass' : cls === 'thinMetal' || cls === 'heavyMetal' || cls === 'electronics' ? 'nd_imp_metal' : cls === 'actor' ? 'nd_imp_armour' : 'nd_imp_concrete'; },
    /** the end card's lines: property damage (the bill), civilians (count, points) and the remark */
    card() {
      const tierN = REMARK_AT.filter((v) => score.bill >= v).length - 1;
      return { bill: Math.round(score.bill), civilians: score.civilians, points: score.civilians * CIVILIAN.points, remark: tierN };
    },
    /** the rating after the casualties: none -> as earned; any -> never the top, one step down per two more */
    rate(points, top = 3) { if (!score.civilians) return points; return Math.max(0, Math.min(points, top - 1) - Math.floor((score.civilians - 1) / 2)); },
    get dark() { return darkList.length; },
    /** what the registry costs when nothing is broken: ms per fixed step and per frame's civilian pass (means of n) */
    idleCost(n = 600) { let t = performance.now(); for (let i = 0; i < n; i++) d.step(); const step = (performance.now() - t) / n; t = performance.now(); for (let i = 0; i < n; i++) post(1 / 60); return { step, post: (performance.now() - t) / n }; },
    /** the tests: the score back to nothing */
    resetScore() { score.bill = 0; score.civilians = 0; score.others = 0; score.charged.clear(); score.billed.clear(); stats.civilians = 0; stats.penalty = 0; },
    /** a robot's round from `from` to `to` (what the tap does with every tracer; the tests call it) */
    enemyShot(from, to) { tap?.hook?.({ from, to }); },
    /** the dark zones now ({ c, r }) */
    get zones() { return darkList.map((z) => ({ c: z.c, r: z.r, id: z.it.id })); },
    count: () => ({ ...fams, total: d.items.length }),
    dispose() { offPost?.(); dead.removeFromParent(); dead.geometry.dispose(); deadMat.dispose(); d.dispose(); },
  };
  // ---- no hitch at the first break: the programs of what breaking shows (a pane's rim in each glass, a split crate, a
  // dead tube, the extinguisher's cloud) are made while the game loads: a few hidden instances drawn for 20 frames
  d.prewarm(); vfx.prewarm?.(d.effects.extinguisher);
  {
    const warm = new THREE.Group(), box = new THREE.BoxGeometry(1, 1, 1), tiny = new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4);
    const mk = (mat, shadow) => { const m = new THREE.InstancedMesh(box, mat, 1); m.setMatrixAt(0, tiny); m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true; m.userData.collide = false; warm.add(m); };
    for (const mat of new Set(d.items.filter((x) => x.brokenKind === 'pane' && x.handle.material?.transparent).map((x) => x.handle.material))) mk(mat, false);
    mk(brokenWood, true); mk(deadMat, false);
    warm.name = 'destruct:warm'; warm.userData.collide = false; root.add(warm);
    let n = 0;
    const off = world.ctx.onUpdate(() => { if (++n < 20) return; warm.removeFromParent(); box.dispose(); off?.(); });
  }
  return api;
}
