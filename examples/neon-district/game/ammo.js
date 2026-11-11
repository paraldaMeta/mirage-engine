// Ammunition the player can find: never a dead end.
//   cells    a destroyed sentinel drops an ammo cell (24 rounds) on a 35 % chance (every third kill at the latest);
//            always when the reserve is under two magazines, and always for a kill with the stock; a destroyed or
//            burnt-out kite drops a small one (12) where it lands. A cell glows, bobs, slides to a player who comes
//            within 2.2 m, is taken by walking over it, and blinks out after 40 s. Eight at most (a pool).
//   crates   plan.crates: an ammo crate with a lamp and a holo glyph over it, read from across the street; walking
//            over a full one gives 48 rounds, and it refills 30 s later (the glyph turns red meanwhile)
//   marker   under two magazines in reserve the HUD's ammo counter goes amber and a waypoint (and a tick on the
//            compass) points at the nearest full crate, cell or the route's one-off pickups; with nothing left at
//            all it pulses, a hint line shows, and the radio says so once
// Test hooks (playtest): flags.drops, cellsTaken, cratesTaken, crateRefills, ammoLow, ammoTarget; the entity
// 'lastcell' (lookAt) is the newest cell.
import * as THREE from 'three';
import { FX } from './fx.js';

const CELL = 24, SMALL = 12, CRATE = 48, REFILL = 30, LIFE = 40, LOW = 48;

function glyphTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffb020'; g.fillStyle = '#ffb020'; g.lineWidth = 6; g.shadowColor = '#ffb020'; g.shadowBlur = 10;
  g.strokeRect(10, 10, 108, 108);
  for (const x of [34, 64, 94]) { g.beginPath(); g.moveTo(x - 9, 98); g.lineTo(x - 9, 50); g.quadraticCurveTo(x, 26, x + 9, 50); g.lineTo(x + 9, 98); g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createAmmo({ world, game, plan, weapon, player, vfx, sfx, lamps, root, stats, hud, T, overlay }) {
  const X = T.xt, mat = world.mat;
  let rnd = 0x3c6ef372, since = 0, grid = null, radioDry = false;
  const R = () => ((rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) ^ (rnd << 7)) >>> 0) / 4294967296);
  // ---- cells
  const cellMat = mat.glow([1, 0.6, 0.12], 5), caseMat = mat.std({ color: new THREE.Color(0.08, 0.08, 0.07), roughness: 0.4, metalness: 0.8 });
  const cells = Array.from({ length: 8 }, (_, i) => {
    const o = new THREE.Group();
    o.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.12), caseMat));
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.04, 0.125), cellMat); o.add(core);
    o.traverse((m) => { m.userData.collide = false; m.castShadow = false; }); o.visible = false; root.add(o);
    return { i, o, live: false, pos: [0, 0, 0], n: 0, t: 0 };
  });
  let last = null;
  game.add({ id: 'lastcell', interact: { can: () => false, label: '', at: () => (last ? [last.pos[0], last.pos[1] + 0.15, last.pos[2]] : player.feet) } });
  function drop(at, n) {
    const c = cells.find((k) => !k.live) || cells.reduce((a, b) => (a.t > b.t ? a : b));
    let y = at[1];
    if (grid) { const gy = grid.groundAt(at[0], at[2], at[1] + 0.5); if (!Number.isNaN(gy)) y = gy; }
    c.live = true; c.pos = [at[0], y, at[2]]; c.n = n; c.t = 0; c.o.visible = true; c.o.scale.setScalar(n < CELL ? 0.75 : 1);
    last = c; vfx.burst(FX.take, [c.pos[0], c.pos[1] + 0.2, c.pos[2]]);
    game.set('drops', (game.flags.drops || 0) + 1);
  }
  game.on('kill', (e) => {
    if (e.K.name === 'drone' || e.K.name === 'mender') return drop(e.pos, SMALL);
    const low = weapon.S.reserve < LOW, melee = !!stats.meleeNow;
    since++;
    if (low || melee || since >= 3 || R() < 0.35) { since = 0; drop(e.pos, CELL); }
  });
  // ---- crates
  const tex = glyphTexture();
  const crateMat = mat.std({ color: new THREE.Color(0.1, 0.11, 0.09), roughness: 0.5, metalness: 0.6 }), band = mat.glow([1, 0.6, 0.1], 4), bandOff = mat.glow([1, 0.12, 0.08], 3);
  const crates = (plan.crates || []).map((d) => {
    const o = new THREE.Group(); o.position.set(...d.at);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.45), crateMat); box.position.y = 0.21; box.castShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.71, 0.05, 0.46), band); strip.position.y = 0.3;
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.2, 2.2, 2.2) }));
    glyph.position.y = 1.35; glyph.renderOrder = 3;
    o.add(box, strip, glyph); o.traverse((m) => { m.userData.collide = false; }); root.add(o);
    const lamp = lamps.add({ pos: [d.at[0], d.at[1] + 1.1, d.at[2]], range: 5, power: 3, color: [1, 0.6, 0.15] });
    return { id: d.id, at: d.at, o, strip, glyph, lamp, full: true, t: 0 };
  });
  const oneOff = plan.pickups.filter((p) => p.kind === 'ammo');
  /** the nearest ammo the player can go to: { id, pos, dist, label, dx, dz } */
  function nearest() {
    const p = player.feet; let best = null;
    const see = (id, pos, label) => { const dx = pos[0] - p[0], dz = pos[2] - p[2], d = Math.hypot(dx, dz, (pos[1] - p[1]) * 2); if (!best || d < best.dist) best = { id, pos: [pos[0], pos[1] + 0.9, pos[2]], dist: d, label, dx, dz }; };
    for (const c of crates) if (c.full) see(c.id, c.at, X.crate);
    for (const c of cells) if (c.live) see('cell' + c.i, c.pos, X.cell);
    for (const o of oneOff) if (game.entities.has(o.id)) see(o.id, o.at, X.ammo);
    return best;
  }
  let target = null;
  function update(dt) {
    const p = player.feet, chest = [p[0], p[1] + 0.6, p[2]];
    for (const c of cells) {
      if (!c.live) continue;
      c.t += dt;
      const d = Math.hypot(c.pos[0] - chest[0], (c.pos[1] - p[1]) * 0.5, c.pos[2] - chest[2]);
      if (!player.dead && d < 2.2 && weapon.S.reserve < 168) { const k = Math.min(1, dt * 7); c.pos[0] += (p[0] - c.pos[0]) * k; c.pos[2] += (p[2] - c.pos[2]) * k; c.pos[1] += (p[1] - c.pos[1]) * k; }
      if (!player.dead && d < 0.9) {
        const got = weapon.give(c.n);
        if (got > 0) { c.live = false; c.o.visible = false; sfx.play('nd_cell', { gain: 0.8 }); game.ui.toast(`${X.ammo} +${got}`); game.set('cellsTaken', (game.flags.cellsTaken || 0) + 1); continue; }
      }
      if (c.t > LIFE) { c.live = false; c.o.visible = false; continue; }
      c.o.position.set(c.pos[0], c.pos[1] + 0.22 + Math.sin(c.t * 3) * 0.05, c.pos[2]); c.o.rotation.y = c.t * 1.8;
      c.o.visible = c.t < LIFE - 6 || Math.sin(c.t * 18) > 0;
    }
    for (const c of crates) {
      c.glyph.lookAt(world.camera.position.x, c.glyph.getWorldPosition(new THREE.Vector3()).y, world.camera.position.z);
      c.glyph.position.y = 1.35 + Math.sin(game.time * 2 + c.at[0]) * 0.05;
      if (!c.full) {
        if ((c.t -= dt) <= 0) { c.full = true; c.strip.material = band; c.glyph.material.color.setScalar(2.2); c.lamp.power = 3; c.lamp.color = [1, 0.6, 0.15]; lamps.touch(); vfx.burst(FX.take, [c.at[0], c.at[1] + 0.5, c.at[2]]); game.set('crateRefills', (game.flags.crateRefills || 0) + 1); }
        continue;
      }
      if (!player.dead && Math.hypot(p[0] - c.at[0], p[2] - c.at[2]) < 1.05 && Math.abs(p[1] - c.at[1]) < 1.2) {
        const got = weapon.give(CRATE);
        if (got > 0) {
          c.full = false; c.t = REFILL; c.strip.material = bandOff; c.glyph.material.color.setRGB(1.6, 0.25, 0.2); c.lamp.power = 0.8; c.lamp.color = [1, 0.15, 0.1]; lamps.touch();
          sfx.play('nd_ammo', { gain: 0.8 }); game.ui.toast(`${X.crate} +${got} · ${X.refill(REFILL)}`); game.set('cratesTaken', (game.flags.cratesTaken || 0) + 1);
        }
      }
    }
    // the marker, when the reserve is low
    const S = weapon.S, state = S.mag + S.reserve <= 0 ? 'dry' : S.reserve < LOW ? 'low' : 'ok';
    target = state === 'ok' ? null : nearest();
    if (state !== 'ok') { game.set('ammoLow', true); if (target && game.flags.ammoTarget !== target.id) game.set('ammoTarget', target.id); }
    else if (game.flags.ammoLow) game.set('ammoLow', false);
    if (state === 'dry' && !radioDry) { radioDry = true; hud.radio(X.radio.dry); }
    if (state !== 'dry') radioDry = false;
    api.state = state;
  }
  const api = {
    state: 'ok', update, nearest, cells, crates,
    start(g) { grid = g; },
    /** once a display frame */
    draw(yaw) { overlay.ammo(api.state, target, yaw); },
    get target() { return target; },
  };
  return api;
}
