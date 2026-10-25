// terraces: the land around (flat by the walls, hills far off), the three terrace levels, the retaining walls
// with parapets, and the stairs on the axis with their cheek walls.
// Offers `posts` (lamp posts at each stair head: { pos: ground point }) and `urns` (at each stair foot).
import * as THREE from 'three';
import { fbm2 } from '@mirage/core';
import { materials } from './materials.js';

export default {
  name: 'terraces',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx);
    const A = plan.enclosure.half, inner = A - plan.enclosure.thickness / 2, RT = plan.retaining.thickness;
    // the land: flat near the garden, small bumps a few metres out, hills that the haze turns blue far away
    const landGeo = new THREE.PlaneGeometry(2400, 2400, 240, 240).rotateX(-Math.PI / 2);
    const lp = landGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), z = lp.getZ(i), d = Math.hypot(Math.max(Math.abs(x) - A, 0), Math.max(Math.abs(z) - A, 0));
      lp.setY(i, -0.02 + (fbm2(x / 9, z / 9, 3) - 0.5) * 0.4 * geom.smoothstep(3, 10, d) + Math.pow(geom.smoothstep(50, 700, Math.hypot(x, z)), 1.4) * (fbm2(x / 260, z / 260, 5) * 160 - 20));
    }
    landGeo.computeVertexNormals();
    root.add(Object.assign(new THREE.Mesh(landGeo, M.land), { receiveShadow: true, name: 'land' }));

    const b = new geom.MeshBatch();
    // terrace fills: gravel tops; the lower terrace is a thin layer over the land
    for (const t of plan.terraces) {
      const [z0, z1] = [Math.max(t.z[0], -inner), Math.min(t.z[1], inner)];
      const y0 = t.y > 0 ? 0 : -0.1;
      b.box(M.gravel, [2 * inner, t.y - y0, z1 - z0], [0, (t.y + y0) / 2, (z0 + z1) / 2]);
    }
    // retaining walls between terraces, parapets (open where the stairs arrive), coping
    for (const s of plan.stairs) {
      const half = s.width / 2 + 0.4;
      b.box(M.ashlar, [2 * inner, s.to - s.from + 0.1, RT], [0, (s.to + s.from - 0.1) / 2, s.z]);
      for (const side of [-1, 1]) {
        const x0 = s.x + side * half, x1 = side * inner, w = Math.abs(x1 - x0), cx = (x0 + x1) / 2;
        b.box(M.ashlar, [w, plan.retaining.parapet, 0.4], [cx, s.to + plan.retaining.parapet / 2, s.z]);
        b.box(M.ashlar, [w, 0.08, 0.52], [cx, s.to + plan.retaining.parapet + 0.04, s.z], [0, 0, 0], 0.02);
      }
      // the flight: `steps` risers, the last one up onto the terrace; cheek walls follow it
      const r = (s.to - s.from) / s.steps, face = s.z + RT / 2;
      for (let i = 0; i < s.steps - 1; i++) {
        const top = s.from + (i + 1) * r, zA = face + (s.steps - 2 - i) * s.tread, zB = zA + s.tread;
        b.box(M.ashlar, [s.width, top - s.from, s.tread + 0.02], [s.x, (top + s.from) / 2, (zA + zB) / 2]);
        for (const side of [-1, 1]) b.box(M.ashlar, [0.4, top - s.from + 0.55, s.tread], [s.x + side * (s.width / 2 + 0.2), (top + 0.55 + s.from) / 2, (zA + zB) / 2]);
      }
    }
    root.add(b.finish({ name: 'terraces' }));
  },
  anchors: (ctx) => {
    const { plan } = ctx;
    const posts = [], urns = [];
    for (const s of plan.stairs) {
      const head = s.z - plan.retaining.thickness / 2 - 0.45, foot = s.z + plan.retaining.thickness / 2 + (s.steps - 1) * s.tread + 0.6;
      for (const side of [-1, 1]) {
        posts.push({ pos: [s.x + side * (s.width / 2 + 0.6), s.to, head], rotY: Math.PI });
        urns.push({ pos: [s.x + side * (s.width / 2 + 0.25), s.from, foot], rotY: 0 });
      }
    }
    return { posts, urns };
  },
};
