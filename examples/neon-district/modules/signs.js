// signs: every neon sign in the district, built in finalize from the `signs` anchors the other modules offer
// (blocks: the plan's sign tables; street, bar, relay, plaza: their own). A sign is a face drawn into a canvas
// (lib.js signTexture: text, no image files) on a glow material, a dark box behind it, and one clustered lamp of its
// colour in front, so the wet street under it takes the colour and the reflections find the tubes.
// Also consumes `beacons` (a red lamp on each mast, blinking on the scene clock) and the skyline's `holos` board.
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, signTexture, decor } from './lib.js';

const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(255 * Math.pow(v, 1 / 2.2)).toString(16).padStart(2, '0')).join('');

export default {
  name: 'signs',
  consumes: { required: ['signs'], optional: ['beacons', 'holos'] },
  build() {},
  finalize(ctx) {
    const { geom, root, mat, anchors } = ctx, M = materials(ctx);
    const backs = new geom.MeshBatch(), group = new THREE.Group(); group.name = 'sign-faces'; decor(group);
    const face = (tex, w, h, m, gain = 2.6) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat.glow([1, 1, 1], gain, { map: tex }));
      mesh.applyMatrix4(m); mesh.castShadow = mesh.receiveShadow = false; group.add(mesh);
    };
    for (const s of anchors.signs) {
      const col = M.NEON[s.color] || M.NEON.pink, css = hex(col), m = geom.compose(s.pos, [0, s.rotY, 0]);
      const out = new THREE.Vector3(Math.sin(s.rotY), 0, Math.cos(s.rotY)), area = s.w * s.h;
      const px = (v) => Math.min(1024, Math.max(128, 2 ** Math.round(Math.log2(v * 110))));
      if (s.kind === 'blade') {
        // sticking out of the wall: glyphs stacked, read from both ways along the street
        const tex = signTexture(s.text, { color: css, vertical: true, w: px(s.w), h: px(s.h) }), off = s.w / 2 + 0.25;
        backs.add(new THREE.BoxGeometry(0.16, s.h + 0.14, s.w + 0.14), M.blackMetal, m.clone().multiply(geom.compose([0, 0, off])));
        for (const y of [-0.3, 0.3]) backs.add(new THREE.BoxGeometry(0.06, 0.06, 0.3), M.darkMetal, m.clone().multiply(geom.compose([0, y * s.h, 0.12])));
        for (const k of [-1, 1]) face(tex, s.w, s.h, m.clone().multiply(geom.compose([k * 0.085, 0, off], [0, k * Math.PI / 2, 0])));
        lamp(ctx, { pos: [s.pos[0] + out.x * (off + 0.2), s.pos[1] - 0.2, s.pos[2] + out.z * (off + 0.2)], color: new THREE.Color().setRGB(...col), intensity: 3.2, range: 8 });
      } else {
        const tex = signTexture(s.text, { color: css, vertical: s.vertical, second: s.second, w: px(s.w), h: px(s.h), frame: !s.bare });
        if (!s.bare) backs.add(new THREE.BoxGeometry(s.w + 0.18, s.h + 0.18, 0.14), M.blackMetal, m.clone().multiply(geom.compose([0, 0, 0.07])));
        face(tex, s.w, s.h, m.clone().multiply(geom.compose([0, 0, s.bare ? 0.03 : 0.145])), s.bare ? 2.2 : 2.6);
        const big = Math.sqrt(area), d = 0.8 + big * 0.25;
        lamp(ctx, { pos: [s.pos[0] + out.x * d, s.pos[1] - Math.min(1, s.h * 0.2), s.pos[2] + out.z * d], color: new THREE.Color().setRGB(...col), intensity: Math.min(9, 1.5 + 1.1 * big), range: Math.min(22, 5 + 2.6 * big), vol: area > 20 });
      }
    }
    root.add(decor(backs.finish({ name: 'sign-backs', castShadow: false })), group);

    // beacons: a red bulb on each mast; the near ones light the roof they stand on
    const red = mat.glow([1, 0.08, 0.05], 10), bulbs = new geom.MeshBatch();
    for (const a of anchors.beacons || []) bulbs.add(new THREE.SphereGeometry(a.pos[1] > 40 ? 0.5 : 0.14, 10, 8), red, geom.compose(a.pos));
    root.add(decor(bulbs.finish({ name: 'beacons', castShadow: false })));
    const base = red.color.clone();
    ctx.onUpdate((t) => { const k = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.2), 6); red.color.copy(base).multiplyScalar(k); });

    // the skyline board: a wide scan-lined advert, additive, far enough that nothing reaches it
    for (const h of (anchors.holos || []).filter((a) => a.kind === 'board')) {
      const tex = signTexture(['MIRAGE', '幻境 1.0'], { color: '#22e0ff', second: '#ff3c96', w: 1024, h: 512, frame: true });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(h.w, h.h), mat.patch(new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), {
        output: 'outgoingLight *= (0.75 + 0.25 * sin(mgWorldPos.y * 14.0 - uTime * 3.0)) * (0.85 + 0.15 * step(0.1, mgHash(vec2(floor(uTime * 9.0), 2.0)))) * 3.2 * max(uLampGain, 0.03);',
      }));
      board.position.set(h.pos[0], h.pos[1], h.pos[2] + 0.4); board.rotation.y = h.rotY; board.name = 'billboard';
      root.add(decor(board));
    }
  },
};
