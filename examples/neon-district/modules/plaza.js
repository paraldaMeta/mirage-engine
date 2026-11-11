// plaza: the square north of the street (plan.plaza). A round plinth with a hologram turning over it, two kiosks,
// benches, two advertising pylons with live screens, light strips let into the paving.
// Offers `holos` (the hologram's centre: the game adds motes round it) and `signs` (the kiosks' boards).
import * as THREE from 'three';
import { materials, holoMaterial } from './materials.js';
import { lamp, decor } from './lib.js';
import { propKit, recorder, track, trackLamps } from './props-kit.js';

export default {
  name: 'plaza',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), K = plan.levels.kerb;
    const [mx, mz] = plan.plaza.monument, R0 = plan.plaza.plinth;
    const b = new geom.MeshBatch(), fx = new geom.MeshBatch(), P = propKit(ctx), pb = new geom.MeshBatch(), rec = recorder(ctx);
    // the plinth: two steps and a dark drum with a projector ring
    b.cylinder(M.concrete, R0 + 0.7, R0 + 0.7, 0.22, [mx, K + 0.11, mz], [0, 0, 0], 48);
    b.cylinder(M.blackMetal, R0, R0 + 0.1, 0.5, [mx, K + 0.47, mz], [0, 0, 0], 48);
    fx.add(new THREE.TorusGeometry(R0 - 0.35, 0.035, 8, 64).rotateX(Math.PI / 2), M.neon.cyan, geom.compose([mx, K + 0.74, mz]));
    fx.add(new THREE.TorusGeometry(R0 + 0.72, 0.02, 6, 72).rotateX(Math.PI / 2), M.neon.pink, geom.compose([mx, K + 0.03, mz]));
    // light strips in the paving, radiating from the plinth
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.39; fx.box(M.neon.cyan, [4.2, 0.012, 0.035], [mx + Math.cos(a) * 5.4, K + 0.012, mz + Math.sin(a) * 5.4], [0, -a, 0]); }
    // kiosks: a counter under a canopy
    for (const [x, z, rot, tint] of [[10.4, -10.6, Math.PI / 2, 'amber'], [25.4, -8.6, -Math.PI / 2, 'green']]) {
      const m = geom.compose([x, K, z], [0, rot, 0]), add = (bt, mat, size, p, bev = 0) => bt.add(bev ? new geom.RoundedBoxGeometry(...size, 2, bev) : new THREE.BoxGeometry(...size), mat, m.clone().multiply(geom.compose(p)));
      add(b, M.sheet, [2.6, 1.05, 1.3], [0, 0.525, 0], 0.03);
      add(b, M.blackMetal, [2.8, 0.06, 1.5], [0, 1.08, 0]);
      for (const sx of [-1.25, 1.25]) add(b, M.darkMetal, [0.1, 2.5, 0.1], [sx, 1.25, -0.55]);
      add(b, M.sheetRed, [3.0, 0.08, 1.9], [0, 2.52, 0.1]);
      const tube = track(fx, () => add(fx, M.neon[tint], [2.7, 0.04, 0.04], [0, 2.44, 0.98]));
      add(b, M.screenAmber, [1.6, 0.6, 0.04], [0, 2.0, -0.58]);
      const p = new THREE.Vector3(0, 2.1, 0.5).applyMatrix4(m);
      // destructibles (game/destruct.js): the canopy's tube is the kiosk's light
      rec.add({ id: `kiosk-neon-${x}`, fam: 'neon', color: tint, box: { center: new THREE.Vector3(0, 2.44, 0.98).applyMatrix4(m).toArray(), half: [1.35, 0.03, 0.03], yaw: rot }, parts: [[fx, tube, 'draw']],
        lamps: trackLamps(ctx, () => lamp(ctx, { pos: p.toArray(), color: new THREE.Color().setRGB(...M.NEON[tint]), intensity: 3, range: 7 })) });
      const px = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3)); px.position.copy(new THREE.Vector3(0, 1.25, -0.55).applyMatrix4(m)); px.scale.x = 9; px.rotation.y = rot; ctx.collider(px);
    }
    // benches
    for (const [x, z, rot] of [[14.2, -3.2, 0], [21.8, -3.2, 0], [13.5, -17.6, 0], [22.6, -17.8, 0]]) {
      b.box(M.concrete, [2.2, 0.42, 0.6], [x, K + 0.21, z], [0, rot, 0], 0.04);
      const strip = track(fx, () => fx.box(M.neon.violet, [2.0, 0.02, 0.02], [x, K + 0.06, z + 0.31], [0, rot, 0]));
      rec.add({ id: `bench-neon-${x}-${z}`, fam: 'neon', color: 'violet', box: { center: [x, K + 0.06, z + 0.31], half: [1.0, 0.02, 0.02], yaw: rot }, parts: [[fx, strip, 'draw']] });
      for (let i = 0; i < 4; i++) P.put(pb, new geom.RoundedBoxGeometry(2.1, 0.035, 0.12, 1, 0.012), P.mats.paint, geom.compose([x, K + 0.44, z - 0.2 + i * 0.135], [0, rot, 0]), [0.3, 0.17, 0.08]);   // the seat's slats
    }
    // advertising pylons: four live faces each
    for (const [x, z, mat, col] of [[8.2, -18.2, M.screenPink, 0xff3090], [27.8, -1.4, M.screenCyan, 0x30d0ff]]) {
      b.box(M.blackMetal, [0.9, 5.2, 0.9], [x, K + 2.6, z], [0, 0, 0], 0.04);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; b.add(new THREE.BoxGeometry(0.72, 4.2, 0.03), mat, geom.compose([x + Math.sin(a) * 0.46, K + 2.8, z + Math.cos(a) * 0.46], [0, a, 0])); }
      lamp(ctx, { pos: [x + (x < 18 ? 1 : -1), K + 3, z + (z < -9 ? 1 : -1)], color: col, intensity: 4.5, range: 10, vol: true });
    }
    root.add(b.finish({ name: 'plaza' }));
    root.add(decor(rec.finished(fx, fx.finish({ name: 'plaza-decor', castShadow: false }))), decor(pb.finish({ name: 'plaza-props', castShadow: false })));

    // ---- the hologram: a knot inside two tilted rings and a cone of light from the projector, turning on the scene clock
    const holo = new THREE.Group(); holo.name = 'hologram'; holo.position.set(mx, K + 3.6, mz); decor(holo);
    const cy = holoMaterial(ctx, 'vec3(0.12, 0.85, 1.0)', 1.3), pk = holoMaterial(ctx, 'vec3(1.0, 0.2, 0.6)', 1.1);
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.05, 0.2, 180, 14, 2, 3), cy);
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.03, 6, 96), pk), ringB = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.03, 6, 96), cy);
    ringA.rotation.x = 1.2; ringB.rotation.set(0.5, 0, 0.9);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 0.5, 2.9, 40, 1, true), holoMaterial(ctx, 'vec3(0.1, 0.6, 0.9)', 0.22));
    cone.position.y = -1.6;
    holo.add(knot, ringA, ringB, cone);
    for (const o of holo.children) { o.castShadow = o.receiveShadow = false; o.userData.occlude = false; }
    root.add(holo);
    ctx.onUpdate((t) => { knot.rotation.set(t * 0.21, t * 0.35, 0); ringA.rotation.z = t * 0.5; ringB.rotation.y = -t * 0.4; holo.position.y = K + 3.6 + Math.sin(t * 0.8) * 0.08; });
    lamp(ctx, { pos: [mx, K + 3.2, mz], color: 0x30d8ff, intensity: 7, range: 15, vol: true, shadow: true });
  },
  anchors: (ctx) => {
    const [mx, mz] = ctx.plan.plaza.monument, K = ctx.plan.levels.kerb;
    return {
      holos: [{ pos: [mx, K + 3.6, mz], rotY: 0, kind: 'figure' }],
      signs: [
        { pos: [10.4 + 1.05, K + 2.86, -10.6], rotY: Math.PI / 2, w: 2.4, h: 0.5, text: '茶 TEA', color: 'amber', kind: 'board', bare: true },
        { pos: [25.4 - 1.05, K + 2.86, -8.6], rotY: -Math.PI / 2, w: 2.4, h: 0.5, text: '修理 FIX', color: 'green', kind: 'board', bare: true },
      ],
    };
  },
};
