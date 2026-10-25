// <name>: what this module builds, in one or two lines (numbers in NOTES.md § <name>).
// Reads plan: <fields>. Offers anchors: <key> (pos = <what exactly>). Consumes: <key> from <module> | none.
import * as THREE from 'three';
import { materials } from './materials.js';         // shared materials (lead-owned)

export default {
  name: '<name>',
  build(ctx) {
    const { geom, mat, root, plan, R } = ctx;
    const P = plan.<field>;                                   // every shared number comes from the plan
    if (!P) throw new Error('<name>: plan.<field> is missing');
    const M = materials(ctx), stone = M.stone;
    // const tar = mat.std({ roughness: 0.6 }, { albedo: 'diffuseColor.rgb *= vec3(0.1) * (0.8 + 0.4 * mgFbm3(mgWorldPos * 4.0, 3));' });   // module-only

    const b = new geom.MeshBatch();                           // one draw call per material
    b.box(stone, [P.width, 0.4, P.length], [P.x, P.y - 0.2, P.z]);   // closed solids: walkable / blocking
    for (let i = 0; i < 6; i++) b.box(stone, [0.3, 1.0, 0.3], [P.x + R.range(-2, 2), P.y + 0.5, P.z + i * 2]);
    root.add(b.finish({ name: '<name>' }));

    // something open or thin that must still block: render it with collide = false, add a closed proxy
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, P.length, 6, 1, true).rotateX(Math.PI / 2), stone);
    rail.position.set(P.x + P.width / 2, P.y + 1.0, P.z); rail.userData.collide = false; root.add(rail);
    ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, P.length).translate(P.x + P.width / 2, P.y + 0.55, P.z)));

    return { count: 6 };                                      // others may read ctx.modules['<name>']
  },
  // facing: rotY turns local +Z (out of the surface, into the open air) to (sin rotY, 0, cos rotY)
  anchors: (ctx) => {
    const P = ctx.plan.<field>;
    return { lamps: [{ pos: [P.x, P.y + 1.2, P.z], rotY: 0 }] };
  },
  // finalize(ctx) { for (const a of ctx.anchors.seats || []) { /* consume another module's anchors */ } },
};
