// lamps: a lantern on every `lamps` anchor and warm point lights on the four nearest the camera. Mirage-side code
// (Nizwa's lanterns are part of its props module, which is not ported here); the light pool follows Nizwa's
// props.js updateLights (4 lights, no steps when a lamp hands over to the next), so both engines pay for the same
// number of lights. With light2 on, Mirage gives these lights shadow slots by itself.
// With the world's lamp pool on (?pools=1, main.js; @miragekit/core lamppool.js) every lantern is also a pool lamp:
// the pool lights the lanterns the four real lights do not reach (gap 3 of REPORT.md) and adds what a fading real
// light lacks, so the hand-off stays seamless. The wall a lantern hangs on stops its light (normal + back).
import * as THREE from 'three';

const ARM = 0.42, DROP = 0.14;   // the flame: this far out of the wall and below the bracket plate (Nizwa's wallLantern)

export default {
  name: 'lamps',
  consumes: { optional: ['lamps'] },
  build() {},
  finalize(ctx) {
    const { root, world, camera } = ctx, lamps = ctx.anchors.lamps || [];
    const iron = world.mat.std({ color: 0x15120f, roughness: 0.6, metalness: 0.7 });
    const glass = world.mat.glow([1.0, 0.58, 0.24], 9);
    const cap = new THREE.ConeGeometry(0.075, 0.07, 6), body = new THREE.CylinderGeometry(0.05, 0.04, 0.14, 6), arm = new THREE.BoxGeometry(0.016, 0.016, ARM);
    const points = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const caps = new THREE.InstancedMesh(cap, iron, lamps.length), bodies = new THREE.InstancedMesh(body, glass, lamps.length), arms = new THREE.InstancedMesh(arm, iron, lamps.length);
    lamps.forEach((a, i) => {
      const s = a.scale ?? 1, nx = Math.sin(a.rotY), nz = Math.cos(a.rotY);
      const p = new THREE.Vector3(a.pos[0] + nx * ARM * s, a.pos[1] - DROP * s, a.pos[2] + nz * ARM * s);
      q.setFromAxisAngle(Y, a.rotY);
      caps.setMatrixAt(i, m.compose(p.clone().setY(p.y + 0.105 * s), q, one.clone().multiplyScalar(s)));
      bodies.setMatrixAt(i, m.compose(p, q, one.clone().multiplyScalar(s)));
      arms.setMatrixAt(i, m.compose(new THREE.Vector3(a.pos[0] + nx * ARM * s / 2, a.pos[1] + 0.075 * s, a.pos[2] + nz * ARM * s / 2), q, one.clone().multiplyScalar(s)));
      points.push(p);
      if (world.lampPool) world.lampPool.add({ pos: [p.x, p.y, p.z], range: 6, power: 0.9 * 1.3, color: [1.0, 0.56, 0.25], normal: [nx, 0, nz], back: ARM * s + 0.05, near: 0.16 });
    });
    for (const im of [caps, bodies, arms]) { im.castShadow = im !== bodies; im.userData.collide = false; im.computeBoundingSphere(); root.add(im); }
    const pool = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(new THREE.Color().setRGB(1.0, 0.56, 0.25), 0, 6.0, 2);
      l.userData.lsNear = 0.16;   // light2: the lantern's own cage does not shadow its flame
      root.add(l); pool.push(l);
    }
    const order = points.map((_, i) => ({ i, d: 0 }));
    ctx.onUpdate(() => {
      const gain = world.G.uLampGain.value;
      for (const o of order) o.d = points[o.i].distanceTo(camera.position);
      order.sort((a, b) => a.d - b.d);
      const d5 = order.length > 4 ? order[4].d : Infinity;
      pool.forEach((l, k) => {
        if (k >= order.length) { l.intensity = 0; return; }
        const wr = d5 === Infinity ? 1 : Math.min(Math.max((d5 - order[k].d) / 2, 0), 1);
        l.position.copy(points[order[k].i]);
        l.intensity = 0.9 * 1.3 * wr * (1 - THREE.MathUtils.smoothstep(order[k].d, 16, 24)) * gain;
        l.updateMatrixWorld();
      });
    });
  },
};
