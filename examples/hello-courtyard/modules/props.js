// props: jars (seeded lathe profiles) in the north-west corner and by the gate; a lantern with a warm point
// light on every `lamps` anchor any module offers (consumed in finalize); with ctx.shared.detail, soot on the wall
// above the lamps that hang on a wall (anchors with `wall`: the ring's distance from the face).
// With the world's lamp pool on (?lamppool=1, @miragekit/core lamppool.js) the lanterns are pool lamps instead of
// PointLights (the same light, through the pool's loop); ctx.shared.lampReal keeps the PointLights as well.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'props',
  build(ctx) {
    const { geom, root, plan, R } = ctx, M = materials(ctx);
    const b = new geom.MeshBatch();
    for (let i = 0; i < 9; i++) {
      const h = R.range(0.7, 1.25), belly = R.range(0.26, 0.38), neck = belly * R.range(0.35, 0.5);
      const prof = [[0.001, 0], [belly * 0.55, 0.01], [belly, h * 0.38], [belly * 0.92, h * 0.6], [neck, h * 0.86], [neck * 0.9, h * 0.93], [neck * 1.25, h], [neck * 1.1, h * 1.02], [neck * 0.8, h * 0.96]];
      const [dx, dz] = R.inDisc(), [cx, , cz] = i < 6 ? plan.points.jarsNorthWest : plan.points.jarsGate;
      b.add(geom.lathe(prof, 28), M.clay, geom.compose([cx + dx * 0.9, 0, cz + dz * 0.6], [R.range(-0.04, 0.04), R.range(0, 6), 0]));
    }
    root.add(b.finish({ name: 'jars' }));
  },
  finalize(ctx) {
    const { geom, root, world } = ctx, M = materials(ctx);
    const b = new geom.MeshBatch();
    const pool = world.lampPool, colour = new THREE.Color(0xff9a50);
    for (const { pos: [x, y, z], rotY, wall } of ctx.anchors.lamps || []) {
      b.add(geom.lathe([[0.001, 0.36], [0.13, 0.3], [0.16, 0.26], [0.001, 0.26]], 8), M.iron, geom.compose([x, y - 0.13, z]));
      b.add(geom.lathe([[0.001, 0], [0.1, 0.04], [0.12, 0.13], [0.1, 0.24], [0.001, 0.26]], 8), M.glass, geom.compose([x, y - 0.13, z]));
      b.add(new THREE.TorusGeometry(0.115, 0.01, 4, 8).rotateX(Math.PI / 2), M.iron, geom.compose([x, y, z]));
      if (pool) pool.add({ pos: [x, y, z], range: 9, power: 2.2, color: [colour.r, colour.g, colour.b], ...(wall > 0 ? { normal: [Math.sin(rotY), 0, Math.cos(rotY)], back: wall + 0.05 } : {}) });
      if (pool && !ctx.shared.lampReal) continue;
      const l = new THREE.PointLight(0xff9a50, 0, 9, 2);
      l.position.set(x, y, z);
      root.add(l);
      ctx.onUpdate(() => { l.intensity = 2.2 * world.G.uLampGain.value; });
    }
    root.add(b.finish({ name: 'lanterns' }));
    if (ctx.shared.detail !== false) {
      const soot = geom.sootPlumes((ctx.anchors.lamps || []).filter((a) => a.wall > 0).map(({ pos, rotY, wall }) =>
        ({ pos: [pos[0] - Math.sin(rotY) * wall, pos[1], pos[2] - Math.cos(rotY) * wall], rotY })));
      if (soot) root.add(soot);
    }
  },
};
