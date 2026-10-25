// shore: the sea and seabed, the seawall and stone promenade with its parapet (pier opening left open), the land-side
// retaining wall, the land rising into low hills east, coastal flanks with rocks north and south, three benches
// and the two lamp posts at the pier entrance (numbers in NOTES.md § shore).
// Reads plan: shore, bounds. Offers anchors: lamps (pos = top ring of each entrance lamp post, kind 'post'),
// seats (pos = ground point under each bench centre, rotY faces west). Consumes: none.
import * as THREE from 'three';
import { PROC } from '@mirage/core';
import { materials } from './materials.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// an indexed heightfield over sorted xs / zs (normals up)
function heightfield(xs, zs, f) {
  const nx = xs.length, nz = zs.length, pos = new Float32Array(nx * nz * 3), idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = (j * nx + i) * 3; pos[k] = xs[i]; pos[k + 1] = f(xs[i], zs[j]); pos[k + 2] = zs[j];
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + nx, c = a + 1, d = b + 1;
    idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export default {
  name: 'shore',
  build(ctx) {
    const { geom, mat, root, plan } = ctx;
    const S = plan.shore, POST_H = plan.lampPost.h;   // lamp post ring height above the paving
    if (!S) throw new Error('shore: plan.shore is missing');
    for (const k of ['y', 'x0', 'x1', 'z', 'seawall', 'parapet', 'opening', 'landWall', 'land', 'benches', 'lamps'])
      if (S[k] === undefined) throw new Error(`shore: plan.shore.${k} is missing`);
    const Y = S.y, [z0, z1] = S.z, [o0, o1] = S.opening, P = S.parapet, LW = S.landWall;
    const M = materials(ctx), stone = M.stone, timber = M.timber, iron = M.iron;

    // module-only materials (3; with stone, timber, iron = 6)
    const sw = PROC.stone('vec3(0.36, 0.35, 0.33)', { course: 0.42, block: 0.9 });
    const wall = mat.std({ roughness: 0.9 }, { ...sw,
      albedo: sw.albedo + ' diffuseColor.rgb *= mix(vec3(0.32, 0.36, 0.30), vec3(1.0), smoothstep(-0.1, 1.1, mgWorldPos.y + 0.3 * mgFbm3(mgWorldPos * 1.3, 2)));' });
    const water = mat.phys({ color: new THREE.Color(0.018, 0.034, 0.045), roughness: 0.07, metalness: 0, ior: 1.33 }, {
      fragmentDecl: 'float wH;',
      albedo: 'wH = mgFbm2(mgWorldPos.xz * vec2(0.22, 0.5) + uTime * vec2(0.05, 0.02), 3) + 0.5 * mgFbm2(mgWorldPos.xz * 1.1 - uTime * vec2(0.03, 0.07), 2);',
      normal: 'normal = mgBump(normal, wH, 0.05 / (1.0 + 0.06 * length(mgWorldPos - cameraPosition)));',
    });
    const land = mat.std({ roughness: 0.95 }, {
      fragmentDecl: 'float lH;',
      albedo: /* glsl */ `{
        vec3 p = mgWorldPos; float ny = normalize(mgWorldNormal).y;
        float g = mgFbm3(p * 0.06, 3), f = mgFbm3(p * 0.8, 2);
        vec3 grass = mix(vec3(0.07, 0.085, 0.04), vec3(0.15, 0.13, 0.07), g);
        vec3 rock = vec3(0.19, 0.18, 0.17) * (0.7 + 0.5 * f);
        float gr = smoothstep(0.74, 0.9, ny) * smoothstep(2.0, 3.0, p.y + 0.8 * g);
        vec3 c = mix(rock, grass, gr);
        c = mix(c, vec3(0.045, 0.05, 0.045), 1.0 - smoothstep(-0.3, 0.7, p.y));
        diffuseColor.rgb *= c; lH = f;
      }`,
      normal: 'normal = mgBump(normal, lH, 0.02);',
    });

    // --- the sea and the seabed (never walkable)
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), water);
    sea.receiveShadow = true; sea.userData.collide = false; sea.name = 'shore:sea'; root.add(sea);
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2).translate(-600, S.seawall.bottom - 0.02, 0), land);
    bed.userData.collide = false; bed.name = 'shore:seabed'; root.add(bed);

    // --- seawall, promenade, coping, parapet, land wall
    const b = new geom.MeshBatch();
    const zc = (z0 + z1) / 2, zl = z1 - z0;
    b.box(wall, [P.t, Y - 0.01 - S.seawall.bottom, zl], [S.x0 + P.t / 2, (Y - 0.01 + S.seawall.bottom) / 2, zc]);   // face, top 1 cm under the paving
    b.box(stone, [LW.x - S.x0 - 0.01, 1.4, zl], [(S.x0 + 0.01 + LW.x) / 2, Y - 0.7, zc]);                          // paving slab, top = shore.y
    for (const [a, c] of [[z0, o0], [o1, z1]]) {
      const l = c - a, m = (a + c) / 2;
      b.box(stone, [0.16, 0.18, l], [S.x0 - 0.06, Y - 0.15, m]);                          // coping string course under the edge
      b.box(stone, [P.t, P.h - 0.1, l], [S.x0 + P.t / 2, Y + (P.h - 0.1) / 2, m]);        // parapet body
      b.box(stone, [P.t + 0.08, 0.1, l], [S.x0 + P.t / 2, Y + P.h - 0.05, m]);            // parapet cap, top = y + h
      // no jumping over; wide enough to cover the cap's overhang and the end piers (an overhang reachable by a jump
      // is a 0.8 m 'ceiling' the walker cannot land under: it falls through the world)
      const pa = a === z0 ? a : a - 0.01, pc = c === z1 ? c : c + 0.01;
      ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(P.t + 0.14, 1.3, pc - pa).translate(S.x0 + P.t / 2, Y + 0.65, (pa + pc) / 2)));
    }
    // end piers of the parapet at the opening (1 cm proud of the parapet end, no coplanar faces)
    for (const z of [o0 - 0.24, o1 + 0.24]) b.box(stone, [P.t + 0.12, P.h + 0.18, 0.5], [S.x0 + P.t / 2, Y + (P.h + 0.18) / 2, z]);
    const wallTop = Y + LW.h;
    b.box(stone, [LW.t, LW.h - 0.12, zl], [LW.x + LW.t / 2, Y + (LW.h - 0.12) / 2, zc]);
    b.box(stone, [LW.t + 0.1, 0.14, zl + 0.1], [LW.x + LW.t / 2, wallTop - 0.05, zc]);       // cap 2 cm proud of the land
    ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(plan.bounds[2] + 1 - (LW.x - 0.05), 3, zl + 1)
      .translate((LW.x - 0.05 + plan.bounds[2] + 1) / 2, Y + 1.5, zc)));                      // land strip in bounds: a wall

    // --- benches against the land wall (seat 1.8 m along z, facing west)
    for (const [bx, bz] of S.benches) {
      for (let i = 0; i < 3; i++) b.box(timber, [0.13, 0.035, 1.8], [bx - 0.15 + i * 0.15, Y + 0.44, bz], [0, 0, 0], 0.008);
      for (let i = 0; i < 2; i++) b.box(timber, [0.035, 0.12, 1.8], [bx + 0.27 + i * 0.03, Y + 0.6 + i * 0.16, bz], [0, 0, -0.18], 0.008);
      // proxies: solid from the paving up to the seat and to the backrest, so no low gap is left under them
      ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(LW.x - (bx - 0.26), 0.46, 1.84).translate((bx - 0.26 + LW.x) / 2, Y + 0.23, bz)));
      ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(LW.x - (bx + 0.2), 0.94, 1.84).translate((bx + 0.2 + LW.x) / 2, Y + 0.47, bz)));
      for (const s of [-0.8, 0.8]) {
        b.box(iron, [0.05, 0.42, 0.05], [bx - 0.18, Y + 0.21, bz + s]);
        b.box(iron, [0.05, 0.86, 0.05], [bx + 0.24, Y + 0.43, bz + s], [0, 0, -0.1]);
        b.box(iron, [0.5, 0.04, 0.05], [bx + 0.03, Y + 0.405, bz + s]);
        b.box(iron, [0.42, 0.04, 0.06], [bx + 0.01, Y + 0.66, bz + s]);                  // armrest
      }
    }

    // --- the two lamp posts at the pier entrance (lathe closed at the axis)
    const postGeo = geom.lathe([[0, 0], [0.17, 0], [0.17, 0.08], [0.14, 0.12], [0.14, 0.45], [0.09, 0.55], [0.07, 0.62],
      [0.055, POST_H - 0.3], [0.08, POST_H - 0.2], [0.08, POST_H - 0.08], [0.12, POST_H - 0.04], [0.12, POST_H], [0, POST_H]], 10);
    for (const [lx, lz] of S.lamps) {
      b.add(postGeo, iron, geom.compose([lx, Y, lz]));
      ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(0.34, POST_H, 0.34).translate(lx, Y + POST_H / 2, lz)));
    }
    root.add(b.finish({ name: 'shore' }));

    // --- land: low hills east of the land wall, coarse and fogged
    const R2 = ctx.rng('hills'), waves = [];
    for (let k = 0; k < 7; k++) {
      const a = R2.range(0, Math.PI * 2), f = 0.004 * Math.pow(1.9, k) * R2.range(0.8, 1.2);
      waves.push({ dx: Math.cos(a) * f, dz: Math.sin(a) * f, ph: R2.range(0, Math.PI * 2), amp: Math.pow(0.5, k) });
    }
    const ampSum = waves.reduce((s, w) => s + w.amp, 0);
    const hill = (x, z) => 0.5 + 0.5 * waves.reduce((s, w) => s + w.amp * Math.sin(x * w.dx + z * w.dz + w.ph), 0) / ampSum;
    const hx0 = LW.x + LW.t;
    const xsH = [], zsH = [];
    for (let i = 0; i <= 64; i++) xsH.push(hx0 + 1190 * Math.pow(i / 64, 2));
    for (let j = -60; j <= 60; j++) zsH.push(Math.sign(j) * 1200 * Math.pow(Math.abs(j) / 60, 1.7));
    const hills = new THREE.Mesh(heightfield(xsH, zsH, (x, z) =>
      S.land + 1.3 * ss(hx0, 40, x) + ss(30, 150, x) * (10 + 55 * Math.pow(hill(x, z), 1.5) + 25 * hill(x * 0.37 + 300, z * 0.41))), land);
    hills.userData.collide = false; hills.receiveShadow = true; hills.name = 'shore:hills'; root.add(hills);

    // --- coastal flanks north and south of the promenade, with rocks along the waterline
    const R3 = ctx.rng('coast');
    const ph = [R3.range(0, 6.28), R3.range(0, 6.28)];
    const coast = (z) => {
      const az = Math.abs(z), s = z < 0 ? 0 : 1;
      return S.x0 - 0.05 * Math.max(0, az - z1) - 5 * ss(z1, z1 + 60, az) * (0.5 + 0.5 * Math.sin(az * 0.045 + ph[s]));
    };
    const flankH = (x, z) => {
      const az = Math.abs(z), t = ss(z1, z1 + 14, az), xc = coast(z);
      const near = Y - 0.02 + (S.land - Y + 0.02) * ss(LW.x - 1.5, hx0, x);
      const far = 2.7 + (S.land - 2.7) * ss(xc + 4, hx0, x);
      const top = near + (far - near) * t;
      return -2.8 + (top + 2.8) * ss(xc - 3 - 3 * t, xc + 2 * t, x);
    };
    const xsF = [];
    for (let x = -110; x < -40; x += 14) xsF.push(x);
    for (let x = -40; x < hx0 - 0.01; x += 1.5) xsF.push(x);
    xsF.push(hx0);
    for (const side of [-1, 1]) {
      const zs = [];
      for (let j = 0; j <= 90; j++) zs.push(side * (z1 + 1170 * Math.pow(j / 90, 2.2)));
      if (side < 0) zs.reverse();
      const fl = new THREE.Mesh(heightfield(xsF, zs, flankH), land);
      fl.userData.collide = false; fl.receiveShadow = true; fl.name = 'shore:flank'; root.add(fl);
    }
    const rb = new geom.MeshBatch(), ico = new THREE.IcosahedronGeometry(1, 1);
    for (let n = 0; n < 90; n++) {
      const side = n % 2 ? 1 : -1, az = z1 + 1 + Math.pow(R3.range(0, 1), 1.4) * 240, z = side * az;
      const s = R3.range(0.6, 2.4), x = coast(z) + R3.range(-3, 1);
      const g = ico.clone(), p = g.attributes.position, a = [R3.range(1, 3), R3.range(1, 3), R3.range(0, 6)];
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        const r = 1 + 0.22 * Math.sin(vx * a[0] + vz * a[1] + a[2]) + 0.12 * Math.sin(vy * 3.1 + vx * 2.3 + a[2]);
        p.setXYZ(i, vx * r, vy * r * 0.7, vz * r);
      }
      g.computeVertexNormals();
      rb.add(g, land, geom.compose([x, R3.range(-0.8, 0.4) + s * 0.3, z], [R3.range(-0.3, 0.3), R3.range(0, 6.28), R3.range(-0.3, 0.3)],
        [s, s * R3.range(0.6, 1), s * R3.range(0.8, 1.3)]));
    }
    const rocks = rb.finish({ name: 'shore:rocks' }); rocks.userData.collide = false; root.add(rocks);

    return { benches: S.benches.length, lamps: S.lamps.length };
  },
  // facing: rotY turns local +Z to (sin rotY, 0, cos rotY)
  anchors: (ctx) => {
    const S = ctx.plan.shore, POST_H = ctx.plan.lampPost.h;
    return {
      lamps: S.lamps.map(([x, z]) => ({ pos: [x, S.y + POST_H, z], rotY: z < 0 ? 0 : Math.PI, kind: 'post' })),
      seats: S.benches.map(([x, z]) => ({ pos: [x, S.y, z], rotY: -Math.PI / 2 })),
    };
  },
};
