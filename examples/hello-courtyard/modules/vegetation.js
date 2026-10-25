// vegetation: the palm (a curved, tapering trunk with ring scars, a crown of fronds made of leaflets) and the
// cypresses outside the walls. Fronds do not collide; the trunk gets a closed collision proxy.
import * as THREE from 'three';
import { materials } from './materials.js';

export default {
  name: 'vegetation',
  build(ctx) {
    const { geom, root, mat, plan, R } = ctx;
    materials(ctx);
    const [px, , pz] = plan.points.palm;
    const trunkPts = [[px, 0, pz], [px + 0.15, 1.8, pz - 0.2], [px + 0.6, 3.8, pz - 0.6], [px + 1.2, 5.6, pz - 1.0]];
    const trunk = mat.std({ roughness: 0.9 }, { fragmentDecl: 'float gH;', albedo: `
      float ring = 0.5 + 0.5 * sin(mgWorldPos.y * 26.0 + mgFbm3(mgWorldPos * 3.0, 2) * 2.0);
      diffuseColor.rgb *= vec3(0.33, 0.27, 0.20) * (0.7 + 0.35 * ring); gH = ring;`, normal: 'normal = mgBump(normal, gH, 0.012);' });
    const tube = Object.assign(new THREE.Mesh(geom.taperedTube(trunkPts, [0.26, 0.2, 0.17, 0.16], { radial: 14 }), trunk), { castShadow: true, receiveShadow: true });
    tube.userData.collide = false;
    root.add(tube);
    // the tube is open and nearly vertical at its foot (the walk grid sees solids from above): a closed proxy instead
    ctx.collider(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 2.4, 10).translate(px + 0.05, 1.2, pz - 0.05)));
    const sway = 'mgWorld += mgWind(mgWorld, aFlex);';
    const leafHooks = { vertexDecl: 'attribute float aFlex; varying float vFlex;', vertexWorld: sway + ' vFlex = aFlex;', fragmentDecl: 'varying float vFlex;',
      albedo: 'diffuseColor.rgb *= mix(vec3(0.10, 0.14, 0.04), vec3(0.26, 0.30, 0.09), vFlex) * (0.8 + 0.3 * mgHash(floor(mgWorldPos * 9.0)));',
      lighting: 'reflectedLight.indirectDiffuse += diffuseColor.rgb * uKeyColor * 0.06 * max(dot(-normalize(mgWorldPos - cameraPosition), uKeyDir), 0.0);' };
    const leaf = mat.std({ roughness: 0.6, side: THREE.DoubleSide }, leafHooks);
    const crown = new THREE.Vector3(...trunkPts[3]);
    const pos = [], flex = [];
    for (let f = 0; f < 18; f++) {
      const az = f * 2.39996 + R.range(-0.2, 0.2), up = R.range(-0.3, 0.7), len = R.range(2.4, 3.2);
      const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az)), side = new THREE.Vector3(-dir.z, 0, dir.x);
      const at = (u) => crown.clone().addScaledVector(dir, u * len).add(new THREE.Vector3(0, (up * u - 0.55 * u * u) * len, 0));
      for (let i = 2; i < 44; i++) {
        const u = i / 44, p = at(u), d = at(u + 0.01).sub(p).normalize(), l = 0.85 * Math.sin(Math.PI * Math.min(u * 1.15, 1)) + 0.1;
        for (const s of [-1, 1]) {
          // a narrow leaflet: base on the rachis, tip swept forward, out and down
          const tip = p.clone().addScaledVector(side, s * l * 0.85).addScaledVector(d, 0.45 * l).add(new THREE.Vector3(0, -0.3 * l + 0.12 * l * R.range(-1, 1), 0));
          pos.push(...p.clone().addScaledVector(d, -0.03).toArray(), ...p.clone().addScaledVector(d, 0.03).toArray(), ...tip.toArray());
          flex.push(u * 0.7, u * 0.7, u * 0.7 + 0.3);
        }
      }
    }
    const frondGeo = new THREE.BufferGeometry();
    frondGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    frondGeo.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
    frondGeo.computeVertexNormals();
    const fronds = new THREE.Mesh(frondGeo, leaf);
    fronds.castShadow = fronds.receiveShadow = true;
    fronds.customDepthMaterial = mat.depth(leafHooks);
    fronds.userData.collide = false;
    root.add(fronds);
    // cypresses outside the walls (lathe), for silhouettes against the sky
    const cypress = mat.std({ roughness: 0.9 }, { fragmentDecl: 'float gH;', albedo: 'gH = mgFbm3(mgWorldPos * 2.5, 4); diffuseColor.rgb *= vec3(0.06, 0.09, 0.04) * (0.7 + 0.6 * gH);', normal: 'normal = mgBump(normal, gH, 0.05);' });
    for (const [x, z, h] of plan.cypresses) {
      const m = new THREE.Mesh(geom.lathe([[0.05, 0], [0.75, 0.5], [0.9, h * 0.3], [0.7, h * 0.65], [0.3, h * 0.92], [0.02, h]], 18), cypress);
      m.position.set(x, 0, z); m.castShadow = m.receiveShadow = true; root.add(m);
    }
  },
};
