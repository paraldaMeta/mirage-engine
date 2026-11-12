// The yard: plain Mirage modules. Walls, roofs and the yard wall are marked with the cutaway (shared.cut), so the
// iso camera sees the player through them; the ground is not. Colours go in through `color` (one program per
// surface, whatever the colour).
import * as THREE from 'three';
import { addPerimeter } from '@miragekit/world/kits/edge';

const col = (c) => new THREE.Color().setRGB(c[0], c[1], c[2]);

const ground = {
  name: 'ground',
  build(ctx) {
    const [x0, z0, x1, z1] = ctx.plan.bounds, pad = 6;
    const slab = new THREE.BoxGeometry(x1 - x0 + pad * 2, 0.5, z1 - z0 + pad * 2).translate((x0 + x1) / 2, -0.25, (z0 + z1) / 2);
    const mat = ctx.mat.std({ roughness: 0.95 }, {
      albedo: `{ vec3 p = mgWorldPos; float n = mgFbm3(p * 0.45, 3), g = mgFbm3(p * 3.2, 2);
        float dirt = smoothstep(0.1, 0.6, n + 0.35 - 0.08 * length(p.xz));
        vec3 grass = vec3(0.16, 0.22, 0.07) * (0.8 + 0.4 * g), earth = vec3(0.34, 0.27, 0.18) * (0.85 + 0.3 * g);
        diffuseColor.rgb *= mix(grass, earth, dirt); }`,
    });
    const mesh = new THREE.Mesh(slab, mat);
    mesh.receiveShadow = true; mesh.name = 'ground';
    ctx.root.add(mesh);
  },
};

const houses = {
  name: 'houses',
  build(ctx) {
    const { cut } = ctx.shared, { PROC } = ctx.mat;
    for (const h of ctx.plan.houses) {
      const [x, z] = h.at, [w, d] = h.size;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h.height, d).translate(x, h.height / 2, z),
        ctx.mat.std({ roughness: 0.92, color: col(h.wall) }, cut.hooks(PROC.plaster('vec3(1.0)'))));
      // a hipped roof: a closed four-sided pyramid over the walls, overhanging 0.4 m
      const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).toNonIndexed();
      roofGeo.computeVertexNormals();
      roofGeo.scale(w + 0.8, h.roof, d + 0.8).translate(x, h.height + h.roof / 2, z);
      const roof = new THREE.Mesh(roofGeo, ctx.mat.std({ roughness: 0.75, color: col(h.tile) }, cut.hooks(PROC.terracotta('vec3(1.0)'))));
      for (const m of [body, roof]) { m.castShadow = m.receiveShadow = true; ctx.root.add(m); }
    }
  },
};

const props = {
  name: 'props',
  build(ctx) {
    const { cut } = ctx.shared, { PROC } = ctx.mat, P = ctx.plan;
    // crates: flat tops a body fits on but nobody can climb to (a click there walks beside them)
    const crate = ctx.mat.std({ roughness: 0.8, color: col([0.42, 0.29, 0.17]) }, PROC.wood('vec3(1.0)', 'x'));
    for (const [x, z] of P.crates) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9).translate(x, 0.45, z), crate);
      m.castShadow = m.receiveShadow = true; ctx.root.add(m);
    }
    // a low stone wall along a polyline (marked: the cutaway opens it too)
    const stone = ctx.mat.std({ roughness: 0.88, color: col([0.55, 0.52, 0.47]) }, cut.hooks(PROC.stone('vec3(1.0)')));
    for (let i = 0; i < P.wall.length - 1; i++) {
      const [ax, az] = P.wall[i], [bx, bz] = P.wall[i + 1], len = Math.hypot(bx - ax, bz - az);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, len + 0.45).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2, 0.55, (az + bz) / 2), stone);
      m.castShadow = m.receiveShadow = true; ctx.root.add(m);
    }
    // a lamp: a post, a glowing glass, a real light (dim by day: its intensity follows the lamp level)
    const [lx, lz] = P.lamp;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 8).translate(lx, 1.3, lz), ctx.mat.std({ color: 0x1c1a18, roughness: 0.6, metalness: 0.6 }));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26).translate(lx, 2.75, lz), ctx.mat.glow([1.0, 0.66, 0.32], 10));
    post.castShadow = true; glass.userData.collide = false;
    ctx.root.add(post, glass);
    const light = new THREE.PointLight(0xffb070, 0, 12, 2);
    light.position.set(lx, 2.6, lz);
    ctx.root.add(light);
    ctx.onUpdate(() => { light.intensity = 9 * ctx.G.uLampGain.value; });
    // the map's edge: the walk grid ends just inside the bounds
    addPerimeter(ctx, P.bounds);
  },
};

export default [ground, houses, props];
