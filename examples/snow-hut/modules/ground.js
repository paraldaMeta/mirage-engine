// ground: the snow terrain (level yard, the slope rising north into ridges, falling south into the valley), the
// split-rail fence on the yard edge (with proxies: nobody leaves the yard) and the falling snow (points in a box
// that follows the camera; the game advances `snow.time`).
// Reads plan: ground, fence, snow. Offers: ctx.modules.ground.heightAt(x, z) (for pines). Anchors: none.
import * as THREE from 'three';
import { fbm2, PROC } from '@mirage/core';
import { materials, withSnow } from './materials.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const outside = ([x0, z0, x1, z1], x, z) => Math.hypot(Math.max(0, x0 - x, x - x1), Math.max(0, z0 - z, z - z1));

// axis samples: 0.5 m inside ±40 m, then cells growing by 10 % out to the extent
function axis(extent) {
  const a = []; for (let x = -40; x <= 40; x += 0.5) a.push(x);
  for (let x = 40, s = 0.6; x < extent; s *= 1.1) { x = Math.min(extent, x + s); a.push(x); a.unshift(-x); }
  return a;
}

export default {
  name: 'ground',
  build(ctx) {
    const { geom, mat, root, plan } = ctx;
    const G = plan.ground, Fc = plan.fence, S = plan.snow;
    if (!G || !G.yard || !G.calm || !G.grade || !G.ridges) throw new Error('ground: plan.ground (yard, calm, grade, ridges) is missing');
    if (!Fc || !S) throw new Error('ground: plan.fence / plan.snow is missing');
    const M = materials(ctx);
    const [yx0, yz0, yx1, yz1] = G.yard, g = G.grade;

    const heightAt = (x, z) => {
      const dn = Math.max(0, yz0 - z), ds = Math.max(0, z - yz1), dside = Math.max(0, yx0 - x, x - yx1);
      let h = g.north * dn + 0.0008 * dn * dn + g.south * ds + g.side * dside;
      h += 0.25 * ss(0, 4, outside(G.calm, x, z)) * (2 * fbm2(x * 0.12, z * 0.12, 3, 7) - 1);          // drifts
      const r = Math.hypot(x, z), ridge = 1 - Math.abs(2 * fbm2(x * 0.004, z * 0.004, 4, 11) - 1);
      h += ss(G.ridges.from, G.ridges.from + 500, r) * G.ridges.height * (0.35 + ridge) * (z < 0 ? 1 : 0.55);
      return h;
    };

    // terrain: one indexed heightfield (≈ 58 k vertices)
    const xs = axis(G.extent), nx = xs.length, pos = new Float32Array(nx * nx * 3), idx = [];
    for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3; pos[k] = xs[i]; pos[k + 1] = heightAt(xs[i], xs[j]); pos[k + 2] = xs[j];
    }
    for (let j = 0; j < nx - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setIndex(idx); tg.computeVertexNormals();
    const terrain = new THREE.Mesh(tg, M.snow);
    terrain.name = 'ground:terrain'; terrain.receiveShadow = true; terrain.userData.surface = 'gravel';
    root.add(terrain);

    // fence: posts every `post` m along the yard edge, two rails, snow on the tops; a 1.5 m proxy per side
    const b = new geom.MeshBatch(), [fx0, fz0, fx1, fz1] = Fc.rect, H = Fc.h, R = ctx.R;
    const rail = mat.std({ roughness: 0.85 }, withSnow(PROC.wood('vec3(0.19, 0.13, 0.08)', 'x')));
    const sides = [[[fx0, fz0], [fx1, fz0]], [[fx1, fz0], [fx1, fz1]], [[fx1, fz1], [fx0, fz1]], [[fx0, fz1], [fx0, fz0]]];
    for (const [[ax, az], [bx, bz]] of sides) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.round(L / Fc.post), rot = Math.atan2(-(bz - az), bx - ax);
      for (let i = 0; i <= n; i++) {
        const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n, y = heightAt(x, z), lean = R.range(-0.04, 0.04);
        b.box(M.post, [0.13, H + 0.35, 0.13], [x, y + (H - 0.35) / 2, z], [lean, R.range(0, 1), lean]);
        b.box(M.snow, [0.17, 0.06, 0.17], [x, y + H + 0.02, z], [0, R.range(0, 1), 0], 0.02);
        if (i < n) {
          const x2 = ax + (bx - ax) * (i + 1) / n, z2 = az + (bz - az) * (i + 1) / n, y2 = heightAt(x2, z2), seg = Math.hypot(x2 - x, z2 - z);
          const tilt = Math.atan2(y2 - y, seg);
          for (const h of [0.45, 0.95]) b.add(new THREE.CylinderGeometry(0.05, 0.05, seg + 0.2, 7).rotateZ(Math.PI / 2), rail,
            geom.compose([(x + x2) / 2, (y + y2) / 2 + h * H, (z + z2) / 2], [0, rot, tilt]));
        }
      }
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const p = new THREE.Mesh(new THREE.BoxGeometry(L + 0.6, 2, 0.4).rotateY(rot).translate(cx, heightAt(cx, cz) + 0.5, cz));
      ctx.collider(p);
    }
    const fence = b.finish({ name: 'ground:fence' });
    fence.userData.collide = false;            // rails are thin; the proxies block
    root.add(fence);

    // falling snow: points wrapped in a box around the camera; `time` drives fall and drift (no Math.random)
    const SR = ctx.rng('snow'), n = S.flakes, B = S.box, fp = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) fp[i] = SR.range(0, B);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const uSnowT = { value: 0 };
    const flakes = mat.patch(new THREE.PointsMaterial({ color: new THREE.Color(0.7, 0.74, 0.82), size: 0.035, sizeAttenuation: true, transparent: true, depthWrite: false }), {
      uniforms: { uSnowT },
      vertexDecl: 'uniform float uSnowT;',
      vertexWorld: /* glsl */ `{
        float B = ${B.toFixed(1)}, t = uSnowT, ph = mgHash(mgWorld.xz) * 6.283;
        vec3 q = mgWorld + vec3(0.35 * sin(t * 0.6 + ph) + 0.25 * t, -${S.fall.toFixed(2)} * t * (0.8 + 0.4 * fract(ph)), 0.3 * cos(t * 0.5 + ph));
        mgWorld = cameraPosition + mod(q - cameraPosition, B) - 0.5 * B;
      }`,
      output: 'if (length(gl_PointCoord - 0.5) > 0.5) discard;',
    });
    const snow = new THREE.Points(pg, flakes);
    snow.name = 'ground:snowfall'; snow.frustumCulled = false; snow.userData.collide = false; snow.renderOrder = 3;
    root.add(snow);

    return { heightAt, snow: uSnowT, terrain };
  },
};
