// hut: a one-room log hut on a stone footing: log walls (corners crossing), a gabled plank roof under 0.22 m of
// snow, three lit windows, an open plank door in the south wall with a stone step, the porch lantern, inside a
// timber floor, a table with a hanging lamp, a bench, a bunk, the iron stove with its pipe through the roof, and
// a woodpile against the east wall. The stove is unlit: the game lights it (anchor `stoves`, `fire` material).
// Reads plan: hut, points.door / stove / lantern / lamp, woodpile. Anchors: stoves (pos = the fire door's centre,
// rotY 0: faces +Z). Ambient volume: the room.
import * as THREE from 'three';
import { PROC } from '@mirage/core';
import { materials, withSnow } from './materials.js';

const LOG = 0.26;                       // log course height
const logs = (axis) => {                // wood along `axis` with rounded log courses and dark chinks between them
  const w = PROC.wood('vec3(0.22, 0.14, 0.08)', axis);
  return { ...w, fragmentDecl: w.fragmentDecl + ' float lgC;',
    albedo: w.albedo + ` lgC = fract((mgWorldPos.y - 0.30) / ${LOG}); diffuseColor.rgb *= 0.45 + 0.55 * smoothstep(0.0, 0.1, lgC) * smoothstep(1.0, 0.9, lgC);`,
    normal: 'normal = mgBump(normal, sin(lgC * 3.14159), 0.02);' };
};

export default {
  name: 'hut',
  build(ctx) {
    const { geom, mat, root, plan } = ctx;
    const Hp = plan.hut, P = plan.points || {};
    if (!Hp || !Hp.rect || !Hp.door || !Hp.windows) throw new Error('hut: plan.hut (rect, door, windows) is missing');
    for (const k of ['door', 'stove', 'lantern', 'lamp']) if (!P[k]) throw new Error(`hut: plan.points.${k} is missing`);
    const M = materials(ctx);
    const [x0, z0, x1, z1] = Hp.rect, T = Hp.wall, F = Hp.floor, W0 = F;            // walls stand on the floor slab
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, run = (z1 - z0) / 2, rise = Hp.ridge - Hp.eaves, pitch = Math.atan2(rise, run);
    const logX = mat.std({ roughness: 0.85 }, logs('x')), logZ = mat.std({ roughness: 0.85 }, logs('z'));
    const plank = mat.std({ roughness: 0.8 }, PROC.wood('vec3(0.16, 0.10, 0.06)', 'z'));
    plank.userData.surface = 'wood';
    const roofWood = mat.std({ roughness: 0.85 }, withSnow(PROC.wood('vec3(0.12, 0.08, 0.05)', 'x')));
    const glass = mat.std({ color: new THREE.Color(0.05, 0.04, 0.03), roughness: 0.15, emissive: new THREE.Color(1, 0.55, 0.22), emissiveIntensity: 1.6 });
    const cloth = mat.std({ roughness: 0.95 }, { albedo: 'diffuseColor.rgb *= mix(vec3(0.35, 0.05, 0.04), vec3(0.5, 0.42, 0.3), step(0.5, fract(mgWorldPos.x * 2.5 + mgWorldPos.z * 2.5)));' });
    const b = new geom.MeshBatch();

    // footing (stone, sunk into the snow), one plank floor slab running out through the door as a porch deck
    // (one box: no seam for the character to catch on), one step down to the snow
    const D = Hp.door, PD = 0.9;
    b.box(M.stone, [x1 - x0 + 0.3, 0.3 + F - 0.06, z1 - z0 + 0.3], [cx, (F - 0.06 - 0.3) / 2, cz]);
    b.box(plank, [x1 - x0 + 0.3, 0.1, z1 - z0 + 0.15 + PD], [cx, F - 0.05, (z0 - 0.15 + z1 + PD) / 2]);
    b.box(M.stone, [D.w + 0.6, 0.37, 0.5], [D.x, F / 2 - 0.2 + 0.0, z1 + PD + 0.2], [0, 0, 0], 0.03);
    // walls: geom.wall along local +X; south / north 0.15 m proud at the corners, east / west 0.15 m proud too
    // (log ends cross), east / west tops 3 cm higher (no coplanar tops)
    const H = Hp.eaves - W0, ext = 0.15;
    const open = (wall) => Hp.windows.filter((w) => w[0] === wall).map(([, c, w, s, t]) => ({ c, width: w, sill: s + F - W0, height: t + F - W0, arch: 'flat' }));
    const walls = [
      ['south', [cx, W0, z1 - T / 2], 0, x1 - x0 + 2 * ext, H - 0.03, (c) => c - cx, logX, [{ x: D.x - cx, width: D.w, height: D.h + F - W0, arch: 'flat' }]],
      ['north', [cx, W0, z0 + T / 2], Math.PI, x1 - x0 + 2 * ext, H - 0.03, (c) => cx - c, logX, []],
      ['west', [x0 + T / 2, W0, cz], -Math.PI / 2, z1 - z0 + 2 * ext, H, (c) => c - cz, logZ, []],
      ['east', [x1 - T / 2, W0, cz], Math.PI / 2, z1 - z0 + 2 * ext, H, (c) => cz - c, logZ, []],
    ];
    const panes = [];
    for (const [name, pos, rotY, length, height, local, m, doors] of walls) {
      const ops = open(name).map((o) => ({ ...o, x: local(o.c) }));
      b.add(geom.wall({ length, height, thickness: T, openings: [...doors, ...ops] }), m, geom.compose(pos, [0, rotY, 0]));
      for (const o of ops) {                // pane in the middle of the wall, a cross mullion, a trim on the outside
        const at = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).add(new THREE.Vector3(...pos));
        const ym = W0 + (o.sill + o.height) / 2, hh = o.height - o.sill;
        panes.push([at(o.x, ym, 0), rotY, o.width, hh]);
        b.add(new THREE.BoxGeometry(o.width, 0.05, 0.06), plank, geom.compose(at(o.x, ym, 0.02).toArray(), [0, rotY, 0]));
        b.add(new THREE.BoxGeometry(0.05, hh, 0.06), plank, geom.compose(at(o.x, ym, 0.02).toArray(), [0, rotY, 0]));
        b.add(new THREE.BoxGeometry(o.width + 0.24, 0.08, 0.2), M.snow, geom.compose(at(o.x, W0 + o.sill - 0.04, T / 2 + 0.06).toArray(), [0, rotY, 0]));
        b.add(new THREE.BoxGeometry(o.width + 0.2, 0.1, 0.06), plank, geom.compose(at(o.x, W0 + o.height + 0.05, T / 2 + 0.03).toArray(), [0, rotY, 0]));
      }
    }
    for (const [p, rotY, w, h] of panes) b.add(new THREE.BoxGeometry(w + 0.02, h + 0.02, 0.03), glass, geom.compose(p.toArray(), [0, rotY, 0]));

    // gables (east, west): triangles from the eaves to the ridge, logs
    const gable = new THREE.Shape([new THREE.Vector2(-run - ext, 0), new THREE.Vector2(run + ext, 0), new THREE.Vector2(0, rise + ext * Math.tan(pitch))]);
    const gg = new THREE.ExtrudeGeometry(gable, { depth: T, bevelEnabled: false }).translate(0, 0, -T / 2);
    for (const [x, r] of [[x0 + T / 2, -Math.PI / 2], [x1 - T / 2, Math.PI / 2]]) b.add(gg, logZ, geom.compose([x, Hp.eaves, cz], [0, r, 0]));

    // roof: two plank slabs from the ridge past the eaves, snow on each, a snow roll on the ridge
    const ov = Hp.overhang, len = x1 - x0 + 2 * ov, slope = (run + ov) / Math.cos(pitch);
    for (const s of [-1, 1]) {
      const mid = (run + ov) / 2, nrm = [0, Math.cos(pitch), -s * Math.sin(pitch) * -1];
      const base = [cx, Hp.ridge - mid * Math.tan(pitch), cz + s * mid];
      const off = (d) => [base[0], base[1] + nrm[1] * d, base[2] + s * Math.sin(pitch) * d];
      b.box(roofWood, [len, 0.12, slope], off(0.06), [s * pitch, 0, 0]);
      b.box(M.snow, [len - 0.08, 0.22, slope - 0.1], off(0.12 + 0.1), [s * pitch, 0, 0], 0.08);
    }
    b.add(new THREE.CylinderGeometry(0.2, 0.2, len - 0.1, 12).rotateZ(Math.PI / 2), M.snow, geom.compose([cx, Hp.ridge + 0.2, cz]));

    // door: plank leaf swung right back against the inside of the wall, hinged at the doorway's west jamb
    b.box(plank, [D.w - 0.06, D.h - 0.04, 0.05], [D.x - D.w / 2 - (D.w - 0.06) / 2, F + D.h / 2, z1 - T - 0.035]);

    // inside: table, bench, bunk with a blanket
    const [lx, , lz] = P.lamp;
    b.box(plank, [1.2, 0.05, 0.75], [lx, F + 0.74, lz]);
    for (const [dx, dz] of [[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]]) b.box(plank, [0.06, 0.72, 0.06], [lx + dx, F + 0.36, lz + dz]);
    b.box(plank, [1.1, 0.05, 0.3], [lx, F + 0.44, lz + 0.65]); b.box(plank, [1.0, 0.42, 0.06], [lx, F + 0.21, lz + 0.65]);
    b.box(plank, [0.85, 0.42, 1.95], [x1 - T - 0.45, F + 0.21, z0 + T + 1.05]);
    b.box(cloth, [0.8, 0.12, 1.4], [x1 - T - 0.45, F + 0.48, z0 + T + 1.3], [0, 0, 0], 0.04);

    // stove: an iron box on a stone hearth, fire door facing +Z, pipe up through the north roof slope
    const [sx, , sz] = P.stove;
    b.box(M.stone, [0.9, 0.06, 0.85], [sx, F + 0.03, sz + 0.1]);
    b.box(M.iron, [0.6, 0.66, 0.55], [sx, F + 0.06 + 0.33, sz], [0, 0, 0], 0.02);
    b.box(M.iron, [0.66, 0.04, 0.6], [sx, F + 0.74, sz]);
    const pipeTop = Hp.ridge + 0.5;
    b.cylinder(M.iron, 0.08, 0.08, pipeTop - (F + 0.76), [sx, (pipeTop + F + 0.76) / 2, sz - 0.05], [0, 0, 0], 12);
    b.cylinder(M.iron, 0.16, 0.12, 0.12, [sx, pipeTop + 0.08, sz - 0.05], [0, 0, 0], 12);
    const fire = mat.std({ color: 0x000000, emissive: new THREE.Color(1, 0.42, 0.12), emissiveIntensity: 0 });
    b.box(fire, [0.32, 0.22, 0.03], [sx, F + 0.36, sz + 0.27]);

    // woodpile: split logs stacked along the east wall, snow on top
    const [wx0, wz0, wx1, wz1] = plan.woodpile.rect, R = ctx.R;
    for (let row = 0; row < 6; row++) for (let z = wz0 + 0.1; z < wz1 - 0.08; z += 0.19) {
      b.add(new THREE.CylinderGeometry(0.09, 0.09, wx1 - wx0 - R.range(0, 0.08), 7).rotateZ(Math.PI / 2), M.log,
        geom.compose([(wx0 + wx1) / 2, 0.09 + row * 0.175, z + (row % 2) * 0.09], [R.range(0, 6.28), 0, 0]));
    }
    b.box(M.snow, [wx1 - wx0 + 0.04, 0.12, wz1 - wz0], [(wx0 + wx1) / 2, 6 * 0.175 + 0.03, (wz0 + wz1) / 2], [0, 0, 0], 0.05);

    // porch lantern on its bracket, the lamp over the table (glow + a light each, following the lamp level)
    const [px, py, pz] = P.lantern, glow = mat.glow([1, 0.6, 0.28], 10);
    b.box(M.iron, [0.04, 0.04, 0.32], [px, py + 0.32, pz - 0.14]);
    b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8), glow, geom.compose([px, py, pz]));
    b.add(new THREE.ConeGeometry(0.13, 0.12, 8), M.iron, geom.compose([px, py + 0.16, pz]));
    b.add(new THREE.SphereGeometry(0.09, 12, 8), glow, geom.compose([lx, P.lamp[1], lz]));
    b.cylinder(M.iron, 0.006, 0.006, Hp.eaves - P.lamp[1] + 0.3, [lx, (Hp.eaves + 0.3 + P.lamp[1]) / 2, lz], [0, 0, 0], 4);
    root.add(b.finish({ name: 'hut' }));

    const porch = new THREE.PointLight(0xffa060, 0, 9, 1.6); porch.position.set(px, py, pz + 0.12);
    const room = new THREE.PointLight(0xffb070, 0, 4.2, 1.6); room.position.set(lx, P.lamp[1] - 0.1, lz);
    const spill = new THREE.PointLight(0xff9a50, 0, 5, 2); spill.position.set(cx - 1.4, F + 1.3, z1 + 0.5);   // light through the south window
    root.add(porch, room, spill);
    ctx.onUpdate(() => { const k = ctx.world.G.uLampGain.value; porch.intensity = 3.2 * k; room.intensity = 4 * k; spill.intensity = 1.2 * k; glass.emissiveIntensity = 0.2 + 1.4 * k; });

    return { fire, stove: [sx, F + 0.36, sz + 0.3], room };
  },
  anchors: (ctx, built) => ({ stoves: [{ pos: [...built.stove], rotY: 0 }] }),
  ambientVolumes: (ctx) => {
    const [x0, z0, x1, z1] = ctx.plan.hut.rect, T = ctx.plan.hut.wall;
    return [{ min: [x0 + T, ctx.plan.hut.floor - 0.1, z0 + T], max: [x1 - T, ctx.plan.hut.ridge, z1 - T], factor: 0.25, soft: 0.4 }];
  },
};

