// streetlife: the people and the trade of the street (plan.streetlife). Low-poly silhouettes with emissive accents
// (visors, lit strips down a cyber arm, umbrellas with glowing rims) standing under the awnings, at the noodle cart,
// at the vending machines; a few walking a loop along the far pavement east of the fight, their legs swinging on
// the scene clock. A converted shipping container under the plaza's gallery is a yakitori stall (real corrugated
// walls, the side flap propped up as an awning, a lit inside, lanterns, a pot that steams). Two rows of vending
// machines with lit faces: in the alley by the spawn and by the plaza. People are decor (walked and shot through,
// out of the walk grid); the container and the machines are solid.
// Offers `steam` (the stall's pot).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials } from './materials.js';
import { lamp, decor, signTexture } from './lib.js';
import { detail, thin, corrugated, worn, textAtlas, atlasQuad } from './kit.js';
import { propKit } from './props-kit.js';
import { paperLantern } from './props-lights.js';
import { spiritBottle, jar, pot, skewers, bowls, chopsticks, riceCooker } from './props-goods.js';

const strip = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
// a person, feet at the origin, facing +z: a coat that flares, shoulders, arms, a head; legs apart (for the walkers)
function bodyGeo() {
  const parts = [
    new THREE.CylinderGeometry(0.2, 0.25, 0.66, 7).translate(0, 1.2, 0),            // the chest
    new THREE.CylinderGeometry(0.25, 0.3, 0.42, 7).translate(0, 0.78, 0),            // the coat's skirt
    new THREE.SphereGeometry(0.115, 8, 6).scale(1, 1.15, 1).translate(0, 1.67, 0.01),
    new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6).translate(0, 1.54, 0),
    new THREE.BoxGeometry(0.5, 0.09, 0.22).translate(0, 1.5, 0),                     // shoulders
  ];
  for (const s of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.05, 0.045, 0.62, 5).translate(0, -0.31, 0).rotateZ(s * 0.12).translate(s * 0.25, 1.5, 0));
  return mergeGeometries(parts.map(strip));
}
const legGeo = () => mergeGeometries([new THREE.CylinderGeometry(0.075, 0.055, 0.84, 5).translate(0, -0.42, 0), new THREE.BoxGeometry(0.11, 0.07, 0.24).translate(0, -0.84, 0.05)].map(strip));
// accents in the body's frame: a visor, a strip down the left arm, a collar light
const accentGeo = () => mergeGeometries([new THREE.BoxGeometry(0.2, 0.035, 0.05).translate(0, 1.69, 0.1), new THREE.BoxGeometry(0.02, 0.4, 0.03).rotateZ(-0.12).translate(-0.27, 1.25, 0.04), new THREE.BoxGeometry(0.3, 0.02, 0.02).translate(0, 1.04, 0.24)].map(strip));
const umbrellaGeo = () => mergeGeometries([new THREE.ConeGeometry(0.55, 0.22, 8, 1, true).translate(0, 2.1, 0), new THREE.CylinderGeometry(0.01, 0.01, 0.9, 4).translate(0.2, 1.65, 0.12)].map(strip));
const rimGeo = () => strip(new THREE.TorusGeometry(0.55, 0.012, 4, 16).rotateX(Math.PI / 2).translate(0, 1.99, 0));

export default {
  name: 'streetlife',
  build(ctx) {
    const { geom, root, plan, mat, R } = ctx, M = materials(ctx), K = plan.levels.kerb, L = plan.streetlife || {}, D = detail(ctx);
    const group = new THREE.Group(); group.name = 'street-life'; decor(group);

    // ---- people standing about: [x, z, yaw (they face +z turned by it), umbrella?]
    const people = thin(ctx, L.people || [], 4), walkers = thin(ctx, L.walkers || [], 1);
    const all = [...people.map((p) => ({ x: p[0], z: p[1], yaw: p[2], umb: !!p[3], y: p[4] ?? K, walk: null })), ...walkers.map((w, i) => ({ ...w, walk: w, y: K, yaw: 0, umb: i % 2 === 0 }))];
    const n = all.length, coat = mat.std({ color: 0xffffff, roughness: 0.55 }), tint = [[0.012, 0.012, 0.015], [0.035, 0.014, 0.014], [0.01, 0.022, 0.03], [0.03, 0.026, 0.022], [0.02, 0.02, 0.024]];
    const bodies = new THREE.InstancedMesh(bodyGeo(), coat, n), legs = new THREE.InstancedMesh(legGeo(), coat, n * 2);
    const accents = new THREE.InstancedMesh(accentGeo(), mat.glow([1, 1, 1], 6), n);
    const umbs = all.filter((p) => p.umb), umbIdx = new Map(umbs.map((p, i) => [p, i]));
    const ub = new THREE.InstancedMesh(umbrellaGeo(), mat.std({ color: 0xffffff, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.75, side: THREE.DoubleSide }), Math.max(1, umbs.length));
    const ur = new THREE.InstancedMesh(rimGeo(), mat.glow([1, 1, 1], 9), Math.max(1, umbs.length));
    const glowC = [[1.0, 0.16, 0.5], [0.1, 0.85, 1.0], [1.0, 0.55, 0.12], [0.55, 0.25, 1.0], [0.2, 1.0, 0.55]];
    all.forEach((p, i) => {
      const c = new THREE.Color().setRGB(...tint[i % tint.length]);
      bodies.setColorAt(i, c); legs.setColorAt(2 * i, c); legs.setColorAt(2 * i + 1, c);
      accents.setColorAt(i, new THREE.Color().setRGB(...glowC[(i * 3) % glowC.length]));
      if (p.umb) { const k = umbIdx.get(p); ub.setColorAt(k, new THREE.Color().setRGB(...[[0.1, 0.1, 0.12], [0.5, 0.05, 0.1], [0.05, 0.2, 0.3]][k % 3])); ur.setColorAt(k, new THREE.Color().setRGB(...glowC[(k * 2 + 1) % glowC.length])); }
      p.scale = 0.92 + 0.16 * R.fork('p' + i).next();
    });
    const meshes = [bodies, legs, accents, ub, ur];
    if (!umbs.length) ub.count = ur.count = 0;
    for (const m of meshes) { m.castShadow = false; m.frustumCulled = false; m.userData.occlude = false; group.add(m); }
    const m4 = new THREE.Matrix4(), base = new THREE.Matrix4(), leg = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const pose = (t) => {
      all.forEach((p, i) => {
        let x = p.x, z = p.z, yaw = p.yaw, swing = 0, bob = 0;
        if (p.walk) {   // along [x0 .. x1] at z0 one way, back at z1 the other
          const w = p.walk, len = Math.abs(w.x1 - w.x0), u = ((t * w.speed / (2 * len + 1.2)) + w.phase) % 1, s = u * (2 * len + 1.2), dir = Math.sign(w.x1 - w.x0);
          if (s < len) { x = w.x0 + dir * s; z = w.z0; yaw = dir * Math.PI / 2; } else if (s < len + 0.6) { x = w.x1; z = w.z0 + (w.z1 - w.z0) * (s - len) / 0.6; yaw = 0; } else if (s < 2 * len + 0.6) { x = w.x1 - dir * (s - len - 0.6); z = w.z1; yaw = -dir * Math.PI / 2; } else { x = w.x0; z = w.z1 + (w.z0 - w.z1) * (s - 2 * len - 0.6) / 0.6; yaw = Math.PI; }
          const ph = t * w.speed * 4.2 + i;
          swing = Math.sin(ph) * 0.42; bob = Math.abs(Math.cos(ph)) * 0.035;
        } else bob = Math.sin(t * 0.6 + i * 1.3) * 0.006;   // breathing
        base.compose(v.set(x, p.y + bob, z), q.setFromEuler(e.set(0, yaw, 0)), sc.setScalar(p.scale));
        bodies.setMatrixAt(i, base); accents.setMatrixAt(i, base);
        for (const s of [-1, 1]) { leg.compose(v.set(s * 0.1, 0.9, 0), q.setFromEuler(e.set(s * swing, 0, 0)), sc.set(1, 1, 1)); legs.setMatrixAt(2 * i + (s > 0 ? 1 : 0), m4.multiplyMatrices(base, leg)); }
        if (p.umb) { leg.compose(v.set(0, 0, 0), q.setFromEuler(e.set(0.08 + swing * 0.05, 0, -0.1)), sc.set(1, 1, 1)); const k = umbIdx.get(p); m4.multiplyMatrices(base, leg); ub.setMatrixAt(k, m4); ur.setMatrixAt(k, m4); }
      });
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    };
    pose(0);
    if (walkers.length) ctx.onUpdate(pose);

    const b = new geom.MeshBatch(), fx = new geom.MeshBatch();
    // ---- the yakitori container under the gallery
    const S = L.stall;
    let steam = null;
    if (S) {
      const [sx, sz] = S.at, len = 6.0, wid = 2.44, hh = 2.6, rot = S.rotY ?? 0, cm = geom.compose([sx, K, sz], [0, rot, 0]), at = (p, r = [0, 0, 0]) => cm.clone().multiply(geom.compose(p, r));
      // local frame: +x the open long side (towards the plaza), z along its length
      const paint = mat.std({ roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide }, worn('vec3(0.36, 0.08, 0.05)', { rows: 0.62, chip: 0.65, rust: 0.85 }));
      const blue = mat.std({ roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide }, worn('vec3(0.06, 0.16, 0.28)', { rows: 0.62, chip: 0.55, rust: 0.7 }));
      const ribsV = corrugated(len, hh - 0.2, { pitch: 0.28, depth: 0.04, ribs: 'v' }), ribsE = corrugated(wid - 0.2, hh - 0.2, { pitch: 0.28, depth: 0.035, ribs: 'v' });
      b.add(ribsV, paint, at([-wid / 2 + 0.04, 0.1, 0], [0, Math.PI / 2, 0]));            // the back wall
      for (const s of [-1, 1]) b.add(ribsE, paint, at([0, 0.1, s * (len / 2 - 0.04)], [0, s > 0 ? 0 : Math.PI, 0]));   // the ends
      b.add(corrugated(len, 1.0, { pitch: 0.28, depth: 0.04, ribs: 'v' }), paint, at([wid / 2 - 0.04, 0.1, 0], [0, -Math.PI / 2 + Math.PI, 0]));  // under the counter
      // the frame: corner posts, rails, the roof
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add(new geom.RoundedBoxGeometry(0.16, hh, 0.16, 2, 0.02), paint, at([x * (wid / 2 - 0.08), hh / 2, z * (len / 2 - 0.08)]));
      for (const y of [0.06, hh - 0.06]) for (const x of [-1, 1]) b.add(new THREE.BoxGeometry(0.14, 0.12, len), paint, at([x * (wid / 2 - 0.07), y, 0]));
      b.add(corrugated(len, wid, { pitch: 0.3, depth: 0.025, ribs: 'v' }).translate(0, -wid / 2, 0).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), paint, at([0, hh, 0]));
      b.add(new THREE.BoxGeometry(wid - 0.1, 0.05, len - 0.1), M.wood, at([0, 0.08, 0]));
      // the flap, propped up as an awning; struts; the counter
      fx.add(corrugated(len - 0.3, 1.4, { pitch: 0.28, depth: 0.04, ribs: 'v' }), blue, at([wid / 2, hh - 0.05, 0], [Math.PI / 2 - 0.35, Math.PI / 2, 0]));
      for (const z of [-2.4, 2.4]) fx.add(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 5), M.darkMetal, at([wid / 2 + 0.55, hh - 0.6, z], [0, 0, 0.75]));
      b.add(new geom.RoundedBoxGeometry(0.5, 0.06, len - 0.4, 2, 0.02), M.wood, at([wid / 2 + 0.05, 1.12, 0]));
      // inside: a back wall of shelves and a lit menu, a grill, pots
      const menu = textAtlas([{ text: ['焼鳥 YAKITORI', 'つくね ¥180 · 皮 ¥150', '啤酒 BEER ¥400'], style: 'box', bg: '#f2e6c8', w: 1024, h: 384 }]);
      fx.add(atlasQuad(2.4, 0.9, menu.rect(0)), mat.patch(new THREE.MeshBasicMaterial({ map: menu.texture }), { output: 'outgoingLight *= 1.4 * max(uLampGain, 0.35);' }), at([-wid / 2 + 0.12, 1.85, -1.2], [0, Math.PI / 2, 0]));
      for (const y of [1.3, 1.62]) fx.add(new THREE.BoxGeometry(0.3, 0.03, 2.2), M.wood, at([-wid / 2 + 0.25, y, 1.4]));
      const PK = propKit(ctx), pb = new geom.MeshBatch();   // the stall's goods (props-goods.js)
      for (let i = 0; i < 12; i++) { const m0 = at([-wid / 2 + 0.25, 1.315 + (i % 2) * 0.32, 0.45 + (i >> 1) * 0.36], [0, i, 0]); if (i % 3 === 2) jar(PK, pb, geom, m0, i); else spiritBottle(PK, pb, geom, m0, { r: 0.032, h: 0.24, label: i, liquid: [[0.45, 0.18, 0.03], [0.9, 0.9, 0.85], [0.6, 0.08, 0.1]][i % 3], glass: [0.45, 0.55, 0.4], fill: 0.4 + 0.1 * (i % 5) }); }
      skewers(PK, pb, geom, at([0.2, 0.96, 0.8], [0, Math.PI / 2, 0]), 10, 1.3);
      pot(PK, pb, geom, at([0.2, 0.93, -1.0]), 0.2, 0.26, false);
      riceCooker(PK, pb, geom, at([-0.5, 0.13, -2.2], [0, 1.2, 0]));
      bowls(PK, pb, geom, at([wid / 2 + 0.05, 1.15, -1.9]), 5, [0.88, 0.85, 0.78], 0.075);
      for (const z of [-0.6, 0.9, 2.1]) chopsticks(PK, pb, geom, at([wid / 2 + 0.12, 1.15, z]));
      b.add(new geom.RoundedBoxGeometry(0.6, 0.85, 1.6, 2, 0.03), M.steel, at([0.2, 0.5, 0.8]));
      fx.add(new THREE.BoxGeometry(0.5, 0.02, 1.4), mat.glow([1.0, 0.32, 0.06], 2.2), at([0.2, 0.92, 0.8]));   // the coals, under a grate
      for (let k = 0; k < 15; k++) fx.add(new THREE.BoxGeometry(0.54, 0.008, 0.008), M.steel, at([0.2, 0.945, 0.1 + k * 0.1]));
      fx.add(new THREE.BoxGeometry(wid - 0.4, 0.03, 0.25), M.neonSoft.warm, at([0, hh - 0.12, 0]));            // the strip light inside
      steam = new THREE.Vector3(0.2, 1.3, -1.0).applyMatrix4(cm).toArray();
      // lanterns along the flap's edge, the name on the roof
      const edge = (z) => new THREE.Vector3(wid / 2 + 1.25, hh + 0.3, z).applyMatrix4(cm);
      for (let z = -2.4, i = 0; z <= 2.41; z += 0.8, i++) { const p = edge(z); paperLantern(PK, pb, geom, [p.x, p.y - 0.05, p.z], { r: 0.15, h: 0.36, print: i % 4, color: i % 2 ? [1.0, 0.16, 0.08] : [1.0, 0.5, 0.22], k: 1.7, cord: 0.27, tilt: ((i * 5) % 3 - 1) * 0.05, yaw: i }); }
      root.add(decor(pb.finish({ name: 'stall-goods', castShadow: false })));
      const tex = signTexture(['屋台 · やきとり', 'YATAI 07'], { color: '#ffb347', second: '#ffffff', w: 1024, h: 256 });
      const nm = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), mat.glow([1, 1, 1], 2.4, { map: tex }));
      nm.applyMatrix4(at([wid / 2 - 0.3, hh + 0.55, 0], [0, Math.PI / 2, 0])); group.add(nm);
      b.add(new THREE.BoxGeometry(0.12, 1.0, 3.8), M.blackMetal, at([wid / 2 - 0.38, hh + 0.55, 0]));
      // a stencilled code on each end
      const code = textAtlas([{ text: ['NDXU 207318 4', '22G1  MAX 30480'], style: 'neon', color: '#e8e2d0', w: 512, h: 160 }]);
      const codeMat = mat.std({ map: code.texture, transparent: true, depthWrite: false, roughness: 0.8, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const s of [-1, 1]) fx.add(atlasQuad(1.5, 0.47, code.rect(0)), codeMat, at([0, 2.05, s * (len / 2 + 0.01)], [0, s > 0 ? 0 : Math.PI, 0]));
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(wid, hh, len)); proxy.applyMatrix4(at([0, hh / 2, 0])); ctx.collider(proxy);
      lamp(ctx, { pos: new THREE.Vector3(wid / 2 + 1.2, 2.0, 0).applyMatrix4(cm).toArray(), color: 0xffa050, intensity: 6, range: 6.5 });
    }

    // (the vending machines are vending.js's)
    root.add(group, b.finish({ name: 'street-life-solid', castShadow: false }), decor(fx.finish({ name: 'street-life-decor', castShadow: false })));
    return { steam, n, D };
  },
  anchors: (ctx, built) => ({ steam: built.steam ? [{ pos: built.steam, rotY: 0 }] : [] }),
};
