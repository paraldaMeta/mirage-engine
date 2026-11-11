// streetlife: the machines and the trade of the street (plan.streetlife). The street life is robots (machines.js):
// service androids in soft liveries standing under the awnings in twos and threes, talking (heads turn, a hand
// gestures), at the noodle cart, the stall and the vending machines, some under umbrellas with lit rims; androids and
// a wheeled parcel courier on a loop along the far pavement east of the fight; a vendor on a rail in the stall and one
// on a pedestal behind the cart; a sweeper on the north kerb; a queue totem by the clinic; units that broke down
// against a wall. A converted shipping container under the plaza's gallery is a yakitori stall (real corrugated
// walls, the side flap propped up as an awning, a lit inside, lanterns, a pot that steams). Two rows of vending
// machines with lit faces: in the alley by the spawn and by the plaza. The machines are decor (walked and shot
// through, out of the walk grid); the container and the vending machines are solid.
// Offers `steam` (the stall's pot).
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, decor, signTexture } from './lib.js';
import { detail, thin, corrugated, worn, textAtlas, atlasQuad } from './kit.js';
import { buildMachines } from './machines.js';

export default {
  name: 'streetlife',
  build(ctx) {
    const { geom, root, plan, mat } = ctx, M = materials(ctx), K = plan.levels.kerb, L = plan.streetlife || {}, D = detail(ctx);
    const group = new THREE.Group(); group.name = 'street-life'; decor(group);

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
      for (let i = 0; i < 9; i++) fx.add(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), M.neonSoft[['amber', 'red', 'green', 'white'][i % 4]], at([-wid / 2 + 0.25, 1.42 + (i % 2) * 0.32, 0.5 + (i >> 1) * 0.45]));
      b.add(new THREE.BoxGeometry(0.6, 0.85, 1.6), M.steel, at([0.2, 0.5, 0.8]));
      fx.add(new THREE.BoxGeometry(0.5, 0.02, 1.4), M.neon.amber, at([0.2, 0.94, 0.8]));                     // the coals
      b.add(new THREE.CylinderGeometry(0.22, 0.2, 0.3, 14), M.steel, at([0.2, 1.08, -1.0]));
      fx.add(new THREE.BoxGeometry(wid - 0.4, 0.03, 0.25), M.neonSoft.warm, at([0, hh - 0.12, 0]));            // the strip light inside
      steam = new THREE.Vector3(0.2, 1.3, -1.0).applyMatrix4(cm).toArray();
      // lanterns along the flap's edge, the name on the roof
      const edge = (z) => new THREE.Vector3(wid / 2 + 1.25, hh + 0.3, z).applyMatrix4(cm);
      const lantern = [mat.glow([1.0, 0.45, 0.2], 1.1), mat.glow([1.0, 0.12, 0.08], 1.1)];
      for (let z = -2.4; z <= 2.41; z += 0.8) { const p = edge(z); fx.add(new THREE.SphereGeometry(0.14, 10, 8).scale(1, 1.3, 1), lantern[Math.abs(Math.round(z / 0.8)) % 2], geom.compose([p.x, p.y - 0.55, p.z])); fx.add(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 3), M.blackMetal, geom.compose([p.x, p.y - 0.25, p.z])); }
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

    // ---- vending machines in rows: a rounded body, a lit face of goods, a slot; one lamp a row
    const faces = textAtlas(['UMIKURA', 'KAPPA KOLA', 'NEUROFIZZ', '熱咖啡 HOT', 'お茶 TEA'].map((t, i) => ({ text: [t], style: 'neon', color: ['#5ff7ff', '#ff4060', '#b6ff3a', '#ffb347', '#7dff9a'][i], w: 256, h: 96 })));
    const vfMat = mat.patch(new THREE.MeshBasicMaterial({ color: 0xffffff }), {
      vertexDecl: 'varying vec2 ndUv;', vertexWorld: 'ndUv = uv;', fragmentDecl: 'varying vec2 ndUv;',
      output: `{ vec2 g = ndUv * vec2(8.0, 7.0), id = floor(g), f = fract(g);
        float can = step(0.2, f.x) * step(f.x, 0.8) * step(0.12, f.y) * step(f.y, 0.88) * step(0.2, ndUv.y);
        vec3 h = mgHash3(vec3(id.x, id.y, floor(mgWorldPos.x + mgWorldPos.z)));
        vec3 c = h.x < 0.25 ? vec3(1.0, 0.15, 0.2) : h.x < 0.5 ? vec3(0.1, 0.8, 1.0) : h.x < 0.7 ? vec3(1.0, 0.75, 0.1) : h.x < 0.85 ? vec3(0.3, 1.0, 0.4) : vec3(0.95);
        c *= 0.55 + 0.45 * smoothstep(0.2, 0.5, f.x) * (1.0 - smoothstep(0.55, 0.8, f.x));          // a highlight down each can
        vec3 bg = vec3(0.06, 0.08, 0.1) + vec3(0.5, 0.6, 0.7) * smoothstep(0.86, 0.95, f.y);          // the shelf lights
        outgoingLight = mix(bg, c * 0.7, can) * (0.9 * max(uLampGain, 0.3)); }`,
    });
    const nameMat = mat.patch(new THREE.MeshBasicMaterial({ map: faces.texture }), { output: 'outgoingLight *= 2.0 * max(uLampGain, 0.25);' });
    const bodyMats = [M.car.white, mat.std({ color: new THREE.Color(0.35, 0.02, 0.03), roughness: 0.35, metalness: 0.4 }), mat.std({ color: new THREE.Color(0.02, 0.12, 0.2), roughness: 0.35, metalness: 0.4 })];
    (L.vending || []).forEach(([x0, z0, dx, dz, nV, rotY, tint], r) => {
      for (let i = 0; i < nV; i++) {
        const m = geom.compose([x0 + dx * i, K * (z0 < 10 ? 1 : 0), z0 + dz * i], [0, rotY, 0]), at = (p) => m.clone().multiply(geom.compose(p));
        b.add(new geom.RoundedBoxGeometry(1.0, 1.95, 0.75, 3, 0.06), bodyMats[(i + r) % 3], at([0, 0.975, 0]));
        fx.add(new THREE.PlaneGeometry(0.82, 1.05), vfMat, at([0, 1.2, 0.381]));
        fx.add(atlasQuad(0.82, 0.3, faces.rect((i + r * 2) % 5)), nameMat, at([0, 1.84, 0.381]));
        fx.add(new geom.RoundedBoxGeometry(0.6, 0.2, 0.06, 2, 0.02), M.blackMetal, at([0, 0.3, 0.38]));
        fx.add(new THREE.BoxGeometry(0.12, 0.25, 0.03), M.neon.green, at([0.3, 0.72, 0.385]));
      }
      const mid = [x0 + dx * (nV - 1) / 2, 0, z0 + dz * (nV - 1) / 2], n2 = [Math.sin(rotY), 0, Math.cos(rotY)];
      lamp(ctx, { pos: [mid[0] + n2[0] * 1.1, 1.3, mid[2] + n2[2] * 1.1], color: tint, intensity: 3.2, range: 5, normal: n2, back: 1.1 });
    });
    // ---- the machines (machines.js): bystanders, walkers and a courier on the east pavement's loop, the vendors, a
    //      sweeper, the clinic's queue totem, units that broke down. Decor: walked and shot through, out of the walk grid.
    const people = thin(ctx, L.people || [], 4), walkers = thin(ctx, L.walkers || [], 1), w0 = (L.walkers || [])[0];
    const machines = buildMachines(ctx, {
      stand: people.map((p) => ({ x: p[0], z: p[1], yaw: p[2], umb: !!p[3], y: p[4] ?? K })),
      // one loop (the first walker's), one pace, evenly spaced: nobody walks through anybody at the ends
      walkers: w0 && { loop: w0, y: K, n: walkers.length, speed: walkers.reduce((s, w) => s + w.speed, 0) / walkers.length, courier: walkers.length > 1 ? 1 : -1 },
      stall: S && { m: geom.compose([S.at[0], K, S.at[1]], [0, S.rotY ?? 0, 0]) },
      cart: L.cartVendor && { m: geom.compose([L.cartVendor[0], K, L.cartVendor[1]], [0, L.cartVendor[2], 0]) },
      sweeper: L.sweeper && D > 0.5 && { a: L.sweeper[0], b: L.sweeper[1], y: K },   // not at low detail
      totem: L.totem && [L.totem[0], K, L.totem[1], L.totem[2]],
      broken: thin(ctx, L.broken || [], 1).map(([x, z, yaw, y]) => [x, y ?? K, z, yaw]),
      detail: D,
    });
    group.add(machines.group);
    ctx.onUpdate(machines.update);
    root.add(group, b.finish({ name: 'street-life-solid', castShadow: false }), decor(fx.finish({ name: 'street-life-decor', castShadow: false })));
    return { steam, n: machines.count, tris: machines.tris, D };
  },
  anchors: (ctx, built) => ({ steam: built.steam ? [{ pos: built.steam, rotY: 0 }] : [] }),
};
