// The quest of garden-quest, as entities spawned from the world's anchors:
//   the key       on the bench (a `seats` anchor) nearest plan.quest.keySeat
//   the door      two kinematic leaves hung in the pavilion's `doors` anchor (locked until you carry the key)
//   the taper     a lit candle on the pavilion's bench
//   the lanterns  one on every `questLamps` anchor (the pavilion's two hooks, the two stands): light them all
//   crates, ball  dynamic props to push around
// plus ambience (wind and birds, the basin's water, a pad on the music bus) and the objective text.
import * as THREE from 'three';

export const VERSION = 1;

export function setupQuest({ game, physics, audio, root, plan, anchors, world }, mats) {
  const { mat } = world;
  const iron = mats.iron, wood = mats.planks;
  const gold = mat.std({ color: new THREE.Color(0.75, 0.52, 0.2), roughness: 0.32, metalness: 1 });
  const add = (o) => { o.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; }); root.add(o); return o; };
  const at = (o) => o.getWorldPosition(new THREE.Vector3()).toArray();
  const lamps = anchors.questLamps || [];

  // ---- the key, on a bench
  const [kx, kz] = plan.quest.keySeat;
  const seat = anchors.seats.reduce((a, s) => (Math.hypot(s.pos[0] - kx, s.pos[2] - kz) < Math.hypot(a.pos[0] - kx, a.pos[2] - kz) ? s : a));
  const key = new THREE.Group();
  key.add(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 20), gold));
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.018, 0.018), gold); shaft.position.x = 0.12; key.add(shaft);
  for (const x of [0.17, 0.2]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.04, 0.016), gold); t.position.set(x, -0.025, 0); key.add(t); }
  key.position.set(seat.pos[0], seat.pos[1] + 0.56, seat.pos[2]);
  add(key);
  game.add({
    id: 'key', object: key,
    interact: { label: 'Pick up the key', use: (g, e) => {
      g.inventory.add({ id: 'key', name: 'Pavilion key', text: 'heavy iron, warm from the sun' });
      audio.play('pickup', { at: at(key) }); g.remove(e); game.ui.toast('You found the pavilion key');
    } },
    update: (dt) => {   // spins and bobs; only near the viewer does it count as motion (still frames refine elsewhere)
      key.rotation.y += dt * 1.2; key.position.y = seat.pos[1] + 0.56 + Math.sin(game.time * 2) * 0.02;
      if (world.camera.position.distanceTo(key.position) < 25) game.dirty = true;
    },
  });

  // ---- the door: two leaves on kinematic hinges
  const d = anchors.doors[0], w = d.width / 2;
  const leaves = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(d.pos[0] + s * w, d.pos[1] + d.height / 2 + 0.01, d.pos[2]);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, d.height, 0.07), wood);
    leaf.position.x = -s * w / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), iron);
    ring.position.set(-s * (w - 0.16), -0.15, 0.05);
    pivot.add(leaf, ring);
    add(pivot);
    return physics.hinge(pivot, { half: [w / 2 - 0.01, d.height / 2, 0.035], offset: [-s * w / 2, 0, 0], swing: -s * d.swing, speed: 1.3 });
  });
  const doorAt = [d.pos[0], d.pos[1] + 1.3, d.pos[2] + 0.2];
  game.add({
    id: 'door', pos: doorAt,
    interact: {
      reach: 2.8,
      label: (g) => (g.flags.doorOpen ? 'Close the door' : g.inventory.has('key') ? 'Unlock the door' : 'The door is locked'),
      use: (g) => {
        if (!g.inventory.has('key')) { audio.play('locked', { at: doorAt }); game.ui.toast('Locked. The key must be somewhere in the garden.'); return; }
        const open = !g.flags.doorOpen;
        for (const l of leaves) (open ? l.open() : l.close());
        audio.play('door', { at: doorAt }); g.set('doorOpen', open);
      },
    },
    save: () => ({ open: !!game.flags.doorOpen }),
    load: (s) => { for (const l of leaves) l.set(s.open); },
  });

  // ---- the taper, on the bench inside
  const P = plan.pavilion, [cx, y0, cz] = P.center, F = y0 + P.plinth;
  const taper = new THREE.Group();
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.32, 10), mat.std({ color: new THREE.Color(0.85, 0.8, 0.68), roughness: 0.6 }));
  candle.position.y = 0.16;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6).scale(1, 2, 1), mat.std({ color: 0x000000, emissive: new THREE.Color(1, 0.6, 0.25), emissiveIntensity: 40 }));
  flame.position.y = 0.35;
  const glow = new THREE.PointLight(0xff9a50, 0.6, 4, 2); glow.position.y = 0.4;
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.02, 14), iron);
  taper.add(dish, candle, flame, glow);
  taper.position.set(cx + 0.6, F + 0.455, cz - P.size / 2 + P.thickness + 0.3);
  add(taper);
  game.add({
    id: 'taper', object: taper,
    interact: { label: 'Take the taper', use: (g, e) => {
      g.inventory.add({ id: 'taper', name: 'Lit taper', text: 'a flame for the lanterns' });
      audio.play('pickup', { at: at(taper), rate: 0.8 }); g.remove(e); game.ui.toast('A flame. Now the lanterns.');
    } },
  });

  // ---- the lanterns: frame + glass + a light, all off until lit
  lamps.forEach((a, i) => {
    const g = new THREE.Group();
    const y = a.kind === 'hanging' ? a.pos[1] - (a.drop || 0.6) - 0.25 : a.pos[1] + 0.2;
    if (a.kind === 'hanging') { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, a.drop || 0.6, 4), iron); ch.position.y = a.pos[1] - (a.drop || 0.6) / 2 - y; g.add(ch); }
    const glass = mat.std({ color: new THREE.Color(0.25, 0.2, 0.15), roughness: 0.3, emissive: new THREE.Color(1, 0.58, 0.26), emissiveIntensity: 0 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.26, 8), glass);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.14, 8), iron); cap.position.y = 0.2;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 8), iron); base.position.y = -0.14;
    g.add(body, cap, base);
    const light = new THREE.PointLight(0xff9a50, 0, 10, 2); light.position.y = 0.02; g.add(light);
    g.position.set(a.pos[0], y, a.pos[2]);
    add(g);
    const lit = () => !!game.flags['lit' + i];
    const show = (on) => { glass.emissiveIntensity = on ? 5 : 0; light.intensity = on ? 3.2 : 0; game.dirty = true; };
    game.add({
      id: 'lantern' + i, object: g,
      interact: {
        reach: 2.6, can: () => !lit(),
        label: (gm) => (gm.inventory.has('taper') ? 'Light the lantern' : 'An unlit lantern'),
        use: (gm) => {
          if (!gm.inventory.has('taper')) { game.ui.toast('It needs a flame.'); return; }
          show(true); audio.play('ignite', { at: at(g) }); gm.set('lit' + i, true);
          const n = litCount();
          if (n === lamps.length) { gm.set('done', true); audio.play('done', { bus: 'sfx', gain: 0.9 }); game.ui.message('The lanterns are lit', `All ${n} lanterns glow in and around the pavilion. Done, in ${Math.round(gm.time)} s.`, 'Keep wandering'); }
          else game.ui.toast(`Lantern ${n} of ${lamps.length}`);
        },
      },
      save: () => ({ lit: lit() }),
      load: (s) => show(s.lit),
    });
  });
  const litCount = () => lamps.filter((_, i) => game.flags['lit' + i]).length;

  // ---- props to push around
  const crates = plan.quest.crates.map(([x, y, z, r], i) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), wood);
    c.position.set(x, y + 0.35, z); c.rotation.y = r;
    add(c);
    const b = physics.body(c, { mass: 12 });
    game.add({ id: 'crate' + i, object: c, save: () => b.state, load: (s) => { b.state = s; } });
    return b;
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), mats.clay);
  ball.position.set(...plan.quest.ball); add(ball);
  const bb = physics.body(ball, { shape: 'ball', mass: 3, restitution: 0.5, damping: 0.4 });
  game.add({ id: 'ball', object: ball, save: () => bb.state, load: (s) => { bb.state = s; } });

  // ---- ambience: wind and birds everywhere, water at the basin and the pools, a pad on the music bus
  audio.loop('wind', { bus: 'ambience', gain: 0.8 });
  audio.loop('water', { at: [plan.basin.center[0], plan.basin.center[1] + 0.8, plan.basin.center[2]], gain: 0.9, ref: 2.5 });
  for (const p of plan.pools) audio.loop('water', { at: [(p.rect[0] + p.rect[2]) / 2, p.y + 0.4, (p.rect[1] + p.rect[3]) / 2], gain: 0.35, ref: 3 });
  audio.loop('pad', { bus: 'music', gain: 0.8 });

  return { crates, leaves, litCount, lamps };
}

/** the HUD's objective from the flags and the inventory */
export function objective(g, n = 4) {
  const lit = Object.keys(g.flags).filter((k) => /^lit\d/.test(k) && g.flags[k]).length;
  if (g.flags.done) return ['Done', 'Every lantern is lit. Wander as long as you like.'];
  if (g.inventory.has('taper')) return [`Lanterns ${lit} / ${n}`, 'Light the lanterns in and outside the pavilion.'];
  if (g.flags.doorOpen) return ['The pavilion', 'Inside, on the bench, a taper is burning. Take it.'];
  if (g.inventory.has('key')) return ['The pavilion', 'Climb to the upper terrace and unlock the pavilion door.'];
  return ['Find the key', 'Someone left the pavilion key on a bench in the lower garden.'];
}
export const summary = (g) => objective(g)[0];
