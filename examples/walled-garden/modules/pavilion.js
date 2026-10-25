// pavilion: on the upper terrace, a square plastered pavilion on a stone plinth with steps, an arched door
// south, round-arched windows, corner pilasters, a cornice, a tiled pyramid roof with a finial; inside a paved
// floor, a ceiling, a bench and two hanging lanterns.
// Offers `lamps` (kind 'hanging', inside; under `plan.pavilion.lampKey` if set), `doors` (the doorway) and an
// ambient volume for the interior (the sky light stays outside). `plan.pavilion.leaves: false` leaves the door
// leaves out (a game supplies moving ones).
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'pavilion',
  build(ctx) {
    const { geom, root, plan, mat } = ctx, M = materials(ctx), P = plan.pavilion;
    const [cx, y0, cz] = P.center, h = P.size / 2, T = P.thickness, F = y0 + P.plinth;   // F: the floor
    const b = new geom.MeshBatch();
    b.box(M.ashlar, [P.size + 0.6, P.plinth, P.size + 0.6], [cx, y0 + P.plinth / 2, cz]);
    const r = P.plinth / 3, front = cz + h + 0.3;
    for (let i = 0; i < 3; i++) b.box(M.ashlar, [3.2, (i + 1) * r, 0.32], [cx, y0 + ((i + 1) * r) / 2, front + (2 - i) * 0.3 + 0.15]);
    b.box(M.paving, [P.size - 2 * T, 0.03, P.size - 2 * T], [cx, F + 0.005, cz]);
    // walls: local +X along the wall; rotY turns it to face each side
    const side = [
      { rot: 0, off: [0, h - T / 2], open: [{ x: 0, width: P.door, height: 2.6, arch: 'round' }] },
      { rot: Math.PI, off: [0, -h + T / 2], open: [{ x: 0, width: 1.3, height: 2.3, sill: 0.9, arch: 'round' }] },
      { rot: Math.PI / 2, off: [h - T / 2, 0], open: [-2.1, 2.1].map((x) => ({ x, width: 1.3, height: 2.3, sill: 0.9, arch: 'round' })) },
      { rot: -Math.PI / 2, off: [-h + T / 2, 0], open: [-2.1, 2.1].map((x) => ({ x, width: 1.3, height: 2.3, sill: 0.9, arch: 'round' })) },
    ];
    for (const s of side) {
      const m = geom.compose([cx + s.off[0], F, cz + s.off[1]], [0, s.rot, 0]);
      b.add(geom.wall({ length: P.size, height: P.wall, thickness: T, openings: s.open }), M.pavilion, m);
      for (const o of s.open) if (o.sill) b.add(new THREE.BoxGeometry(o.width + 0.2, 0.08, T + 0.12), M.ashlar, m.clone().multiply(geom.compose([o.x, o.sill, 0])));
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(M.ashlar, [0.7, P.wall, 0.7], [cx + sx * (h - 0.2), F + P.wall / 2, cz + sz * (h - 0.2)]);   // pilasters
    const top = F + P.wall;
    b.box(M.ashlar, [P.size + 0.5, 0.28, P.size + 0.5], [cx, top + 0.14, cz], [0, 0, 0], 0.03);                      // cornice
    b.box(M.pavilion, [P.size - 2 * T, 0.16, P.size - 2 * T], [cx, top - 0.08, cz]);                                  // ceiling
    for (const s of [-1, 1]) b.box(M.planks, [0.2, 0.26, P.size - 2 * T], [cx + s * 1.6, top - 0.29, cz]);   // two beams under it
    b.box(M.ashlar, [5, 0.45, 0.5], [cx, F + 0.225, cz - h + T + 0.3], [0, 0, 0], 0.04);                             // bench
    if (P.leaves !== false) for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(1.0, 2.55, 0.07), M.planks, geom.compose([cx + s * (P.door / 2), F + 1.28, cz + h - T - 0.05], [0, -s * 1.45, 0]).multiply(geom.compose([-s * 0.5, 0, 0])));   // door leaves, swung in
    root.add(b.finish({ name: 'pavilion' }));
    // the roof: a four-sided pyramid with an overhang, tiles in courses, a finial
    const tiles = mat.std({ roughness: 0.7 }, {
      fragmentDecl: 'float gH;',
      albedo: `{ vec3 p = mgWorldPos; float u = (abs(p.x - ${cx.toFixed(2)}) > abs(p.z - ${cz.toFixed(2)}) ? p.z : p.x) * 4.5, v = p.y * 5.0;
        float row = floor(v), t = fract(u + 0.5 * mod(row, 2.0)); gH = smoothstep(0.0, 0.3, fract(v)) * (0.6 + 0.4 * sin(t * 3.14159));
        vec3 c = vec3(0.40, 0.16, 0.08) * (0.7 + 0.5 * mgHash(vec2(floor(u + 0.5 * mod(row, 2.0)), row))) * (0.85 + 0.2 * mgFbm3(p * 2.0, 3));
        diffuseColor.rgb *= c * mix(1.0, 0.7, gH * 0.4); }`,
      normal: 'normal = mgBump(normal, gH, 0.012);',
    });
    const roof = new THREE.Mesh(new THREE.ConeGeometry((h + 0.55) * Math.SQRT2, P.roof, 4, 1).rotateY(Math.PI / 4).translate(cx, top + 0.28 + P.roof / 2, cz), tiles);
    roof.castShadow = roof.receiveShadow = true;
    const finial = new THREE.Mesh(geom.lathe([[0.3, 0], [0.22, 0.2], [0.1, 0.4], [0.18, 0.6], [0.04, 0.95], [0.01, 1.1]], 16), M.ashlar);
    finial.position.set(cx, top + 0.28 + P.roof - 0.1, cz); finial.castShadow = true;
    root.add(roof, finial);
  },
  anchors: (ctx) => {
    const P = ctx.plan.pavilion, [cx, y0, cz] = P.center, top = y0 + P.plinth + P.wall;
    return {
      [P.lampKey || 'lamps']: [-1, 1].map((s) => ({ pos: [cx + s * 1.6, top - 0.4, cz + 0.8], rotY: 0, kind: 'hanging', drop: 1.1 })),
      // the doorway: pos = floor centre of the opening on the wall's inner face; a game hangs moving leaves here
      doors: [{ pos: [cx, y0 + P.plinth, cz + P.size / 2 - P.thickness - 0.05], rotY: 0, width: P.door, height: 2.55, leaves: 2, swing: 1.45 }],
    };
  },
  ambientVolumes: (ctx) => {
    const P = ctx.plan.pavilion, [cx, y0, cz] = P.center, h = P.size / 2 - P.thickness, F = y0 + P.plinth;
    return [{ min: [cx - h, F - 0.1, cz - h], max: [cx + h, F + P.wall, cz + h], factor: 0.38, soft: 0.7 }];
  },
};
