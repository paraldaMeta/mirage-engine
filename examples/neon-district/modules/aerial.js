// aerial: the traffic over the district (plan.traffic, plan.transport). Lanes of small flying cars cross between the
// towers at three heights, both ways, each craft a faceted hull with head and tail lights and a fading light trail;
// one large, slow corporate transport circles the block with two searchlight cones swinging under it. Instanced
// (one draw call per part for all the cars), moved on the scene clock in onUpdate. Decor, never in the walk grid.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signTexture, decor } from './lib.js';
import { detail } from './kit.js';

// a car's hull (nose along +x): a side profile pushed across with a chamfer, so its facets catch the signs
function hullGeometry() {
  const side = [[-2.1, 0.15], [1.7, 0.1], [2.25, 0.32], [2.0, 0.5], [0.9, 0.62], [0.2, 1.0], [-1.2, 1.02], [-2.0, 0.7]];
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(side.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 1.3, bevelEnabled: true, bevelSize: 0.22, bevelThickness: 0.22, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, -0.5, -0.65);
  const pods = [];   // two engine pods under the flanks
  for (const s of [-1, 1]) pods.push(new THREE.CylinderGeometry(0.28, 0.34, 1.9, 6).rotateZ(Math.PI / 2).translate(-0.6, -0.5, s * 1.05));
  return mergeGeometries([g.toNonIndexed(), ...pods.map((p) => p.toNonIndexed())].map((x) => { x.deleteAttribute('uv'); return x; }));
}

export default {
  name: 'aerial',
  build(ctx) {
    const { geom, root, plan, mat } = ctx, D = detail(ctx);
    const lanes = [];
    for (const L of plan.traffic || []) {
      const [[ax, az], [bx, bz]] = L.pts, len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len, n = Math.max(2, Math.round(L.n * D));
      for (const dir of [1, -1]) for (let i = 0; i < n; i++) lanes.push({ L, ax, az, dx, dz, len, dir, phase: (i + (dir > 0 ? 0 : 0.5)) / n, y: L.y + (dir > 0 ? 0 : 1.6) + ((i * 7) % 3) * 0.5, side: dir * L.wide / 2, k: lanes.length });
    }
    const N = lanes.length;
    const paint = mat.std({ color: 0xffffff, roughness: 0.28, metalness: 0.75 });
    const hull = new THREE.InstancedMesh(hullGeometry(), paint, N);
    const head = new THREE.InstancedMesh(mergeGeometries([-1, 1].map((s) => new THREE.BoxGeometry(0.06, 0.08, 0.5).translate(2.3, -0.1, s * 0.5))), mat.glow([0.9, 0.95, 1.0], 26), N);
    const tail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.07, 1.6).translate(-2.34, 0.1, 0), mat.glow([1.0, 0.08, 0.06], 22), N);
    const strip = new THREE.InstancedMesh(mergeGeometries([-1, 1].map((s) => new THREE.BoxGeometry(2.8, 0.04, 0.03).translate(0, -0.12, s * 0.88))), mat.glow([1, 1, 1], 8), N);
    // the trail: two crossed ribbons behind the tail, fading out along their length
    const trailGeo = mergeGeometries([0, Math.PI / 2].map((r) => new THREE.PlaneGeometry(16, 0.5).rotateX(r).translate(-2.4 - 8, 0.1, 0)));
    const trail = new THREE.InstancedMesh(trailGeo, mat.patch(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true }), {
      vertexDecl: 'varying vec2 ndUv;', vertexWorld: 'ndUv = uv;', fragmentDecl: 'varying vec2 ndUv;',
      output: 'outgoingLight = vec3(1.0, 0.18, 0.12) * pow(ndUv.x, 2.2) * smoothstep(0.0, 0.5, 1.0 - abs(ndUv.y - 0.5) * 2.0) * (1.6 * max(uLampGain, 0.02));',
    }), N);
    const tints = [[1.0, 0.16, 0.5], [0.1, 0.85, 1.0], [1.0, 0.55, 0.12], [0.55, 0.25, 1.0], [0.9, 0.9, 0.95]], bodies = [[0.06, 0.065, 0.075], [0.25, 0.04, 0.04], [0.02, 0.15, 0.17], [0.4, 0.36, 0.3], [0.3, 0.22, 0.03]];
    lanes.forEach((c, i) => { hull.setColorAt(i, new THREE.Color().setRGB(...bodies[(i * 3) % bodies.length])); strip.setColorAt(i, new THREE.Color().setRGB(...tints[(i * 7) % tints.length])); });
    const meshes = [hull, head, tail, strip, trail];
    const group = new THREE.Group(); group.name = 'air-traffic'; decor(group);
    for (const m of meshes) { m.castShadow = m.receiveShadow = false; m.frustumCulled = false; m.userData.occlude = false; group.add(m); }
    root.add(group);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const move = (t) => {
      for (let i = 0; i < N; i++) {
        const c = lanes[i], s = ((t * c.L.speed / c.len + c.phase) % 1) * c.len, u = c.dir > 0 ? s : c.len - s;
        const fx = c.dx * c.dir, fz = c.dz * c.dir;
        p.set(c.ax + c.dx * u - c.dz * c.side, c.y + Math.sin(t * 0.7 + i) * 0.25, c.az + c.dz * u + c.dx * c.side);
        e.set(Math.sin(t * 0.5 + i * 1.7) * 0.05, Math.atan2(-fz, fx), 0.04 * Math.sin(t * 0.9 + i), 'YXZ');
        mtx.compose(p, q.setFromEuler(e), one);
        for (const m of meshes) m.setMatrixAt(i, mtx);
      }
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    };
    move(0);
    ctx.onUpdate(move);

    // ---- the corporate transport: a long hull, engine pods, a lit name on each flank, two searchlights swinging
    const T = plan.transport;
    if (T) {
      const ship = new THREE.Group(); ship.name = 'transport'; decor(ship);
      const b = new geom.MeshBatch(), dark = mat.std({ color: new THREE.Color(0.04, 0.042, 0.05), roughness: 0.4, metalness: 0.8 });
      const plate = mat.std({ color: new THREE.Color(0.16, 0.16, 0.17), roughness: 0.35, metalness: 0.85 });
      b.add(new geom.RoundedBoxGeometry(20, 3.2, 5.2, 2, 0.6), dark, geom.compose([0, 0, 0]));
      b.add(new geom.RoundedBoxGeometry(12, 1.6, 4.0, 2, 0.4), plate, geom.compose([-1.5, 2.1, 0]));
      b.add(new THREE.ConeGeometry(2.6, 5, 6).rotateZ(-Math.PI / 2), dark, geom.compose([12.4, -0.2, 0], [0, 0, 0], [1, 0.62, 1]));
      for (const s of [-1, 1]) for (const x of [-6, 5]) { b.add(new THREE.CylinderGeometry(1.1, 1.3, 3.4, 8).rotateZ(Math.PI / 2), plate, geom.compose([x, -1.2, s * 3.6])); b.box(dark, [1.2, 0.4, 1.2], [x, -0.7, s * 3.0]); }
      const glowRed = mat.glow([1, 0.1, 0.05], 30), glowWhite = mat.glow([1, 1, 1], 30), glowCyan = mat.glow([0.2, 0.9, 1], 10);
      for (const s of [-1, 1]) for (const x of [-6, 5]) b.add(new THREE.CircleGeometry(1.0, 10).rotateY(Math.PI / 2), glowCyan, geom.compose([x - 1.71, -1.2, s * 3.6], [0, Math.PI, 0]));
      b.box(glowWhite, [0.2, 0.2, 0.2], [-10, 1.8, 0]);
      b.box(glowRed, [0.25, 0.25, 0.25], [0, -0.2, -2.7]); b.box(mat.glow([0.1, 1, 0.3], 30), [0.25, 0.25, 0.25], [0, -0.2, 2.7]);
      for (const z of [-2.61, 2.61]) b.box(mat.glow([1.0, 0.8, 0.15], 6), [17, 0.08, 0.02], [0, -1.0, z]);
      ship.add(b.finish({ name: 'transport-hull', castShadow: false }));
      const tex = signTexture(['北天 HOKUTEN', 'LOGISTICS'], { color: '#ffd23a', second: '#ffffff', w: 1024, h: 256 });
      for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.6), mat.glow([1, 1, 1], 1.8, { map: tex })); f.position.set(-1, 0.1, s * 2.62); f.rotation.y = s > 0 ? 0 : Math.PI; ship.add(f); }
      // searchlights: additive cones from two turrets under the hull, brightest in the core, fading with depth
      const coneMat = mat.patch(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false }), {
        vertexDecl: 'varying vec2 ndUv;', vertexWorld: 'ndUv = uv;', fragmentDecl: 'varying vec2 ndUv;',
        output: `{ vec3 V = normalize(cameraPosition - mgWorldPos), N = normalize(mgWorldNormal); float core = pow(abs(dot(V, N)), 2.0);
          outgoingLight = vec3(0.85, 0.92, 1.0) * core * pow(ndUv.y, 1.6) * 0.7 * max(uLampGain, 0.03); }`,
      });
      const beams = [];
      for (const x of [-7, 7]) {
        const pivot = new THREE.Group(); pivot.position.set(x, -1.8, 0);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 6.5, 36, 20, 1, true).translate(0, -18, 0), coneMat);
        cone.visible = D >= 0.5;   // phones: the transport without its beams
        pivot.add(cone, new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), glowWhite));
        ship.add(pivot); beams.push(pivot);
      }
      ship.traverse((o) => { o.castShadow = o.receiveShadow = false; o.frustumCulled = false; o.userData.occlude = false; });
      root.add(ship);
      const [cx, cz] = T.center, [rx, rz] = T.radius;
      const fly = (t) => {
        const a = (t / T.period) * Math.PI * 2, x = cx + Math.cos(a) * rx, z = cz + Math.sin(a) * rz;
        const tx = -Math.sin(a) * rx, tz = Math.cos(a) * rz;
        ship.position.set(x, T.y + Math.sin(t * 0.3) * 0.8, z); ship.rotation.set(0, Math.atan2(-tz, tx), Math.sin(t * 0.2) * 0.03);
        beams.forEach((bm, i) => bm.rotation.set(0.35 * Math.sin(t * 0.37 + i * 2.1), 0, 0.45 * Math.sin(t * 0.23 + i)));
      };
      fly(0); ctx.onUpdate(fly);
    }
  },
};
