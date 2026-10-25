// pines: snow-laden spruces, a few inside the yard (plan.pines.yard) and a band on the slope around it; one
// drooping-tier lathe instanced (needles, snow on the upward faces, a noise wobble so no two look turned copies),
// trunks instanced. Trunks are solid (the yard ones block), needles are not.
// Reads plan: pines, ground.yard; ctx.modules.ground.heightAt (ground builds first). Anchors: none.
import * as THREE from 'three';
import { PROC } from '@mirage/core';
import { withSnow } from './materials.js';

function spruce(tiers = 7) {            // unit height 1, radius ~0.36 at the bottom tier
  const p = [[0, 0.1]];
  for (let k = 0; k < tiers; k++) {
    const y = 0.12 + (k / tiers) * 0.8, r = 0.36 * (1 - k / tiers) + 0.04, th = 0.8 / tiers;
    p.push([r, y], [r * 0.3, y + th * 1.05]);
  }
  p.push([0, 1]);
  return p;
}

export default {
  name: 'pines',
  build(ctx) {
    const { geom, mat, root, plan } = ctx;
    const P = plan.pines, ground = ctx.modules.ground;
    if (!P || !P.yard || !P.r) throw new Error('pines: plan.pines (yard, count, r) is missing');
    if (!ground || !ground.heightAt) throw new Error('pines: needs the ground module (heightAt); build it first');
    const R = ctx.R, [yx0, yz0, yx1, yz1] = plan.ground.yard;

    const hooks = withSnow({
      vertexWorld: 'mgWorld.xz += (vec2(mgFbm3(mgWorld * 1.3, 2), mgFbm3(mgWorld * 1.3 + 7.1, 2)) - 0.5) * 0.5;',
      albedo: 'diffuseColor.rgb *= mix(vec3(0.020, 0.040, 0.028), vec3(0.05, 0.07, 0.04), mgFbm3(mgWorldPos * 2.0, 2));',
    });
    const needles = mat.std({ roughness: 0.9 }, hooks);
    const bark = mat.std({ roughness: 0.9 }, PROC.wood('vec3(0.10, 0.07, 0.05)', 'y'));
    const crown = geom.lathe(spruce(), 9), trunk = new THREE.CylinderGeometry(0.6, 1, 1, 7).translate(0, 0.5, 0);

    const trees = [];   // [x, z, height]
    for (const [x, z] of P.yard) trees.push([x, z, R.range(5, 8)]);
    for (let tries = 0; trees.length < P.yard.length + P.count && tries < P.count * 20; tries++) {
      const a = R.range(0, Math.PI * 2), d = P.r[0] + (P.r[1] - P.r[0]) * Math.pow(R.range(0, 1), 1.6);
      const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.8 - 10;
      if (x > yx0 - 2 && x < yx1 + 2 && z > yz0 - 2 && z < yz1 + 2) continue;
      trees.push([x, z, R.range(6, 14)]);
    }
    const cm = [], tm = [];
    for (const [x, z, h] of trees) {
      const y = ground.heightAt(x, z) - 0.1, w = h * R.range(0.85, 1.1), r = R.range(0, Math.PI * 2);
      cm.push(geom.compose([x, y + h * 0.08, z], [0, r, 0], [w, h, w]).clone());
      const tr = 0.012 * h + 0.06;
      tm.push(geom.compose([x, y, z], [0, r, 0], [tr, h * 0.35, tr]).clone());
    }
    const c = geom.instances(crown, needles, cm), t = geom.instances(trunk, bark, tm);
    c.customDepthMaterial = mat.depth(hooks); c.name = 'pines:crowns'; c.userData.collide = false; t.name = 'pines:trunks';
    root.add(c, t);
    return { count: trees.length };
  },
};
