// facades: what was bolted onto the buildings after they were built. For every face of plan.blocks that looks onto
// ground the player can stand on (lib.js openFaces): balconies with railings, window ledges, air-conditioning units,
// drain pipes on brackets, a sagging cable bundle with junction boxes, vertical fins on the glass towers, fire
// escapes on six faces, scaffolded billboards on the lower roofs, and on the ground storey posters, sprayed tags and
// stencils (drawn into canvases: lib.js artTexture). Repeated parts are instanced: one unit box per material, scaled
// per instance, so a few thousand parts are a handful of draw calls. None of it is in the walk grid (it starts
// above head height or is paper on a wall).
// Offers `signs` (the roof billboards) and `ledWalls` (two advertising walls high on the towers).
import * as THREE from 'three';
import { materials } from './materials.js';
import { openFaces, faceYaw, onFace, artTexture, decor } from './lib.js';
import { signRects, inFrontOfSign, detail } from './kit.js';

const FLOOR = { concrete: 3.3, panel: 3.6, glass: 3.9 }, BAY = { concrete: 2.6, panel: 3.4, glass: 1.8 };
const ESCAPES = { sw: 'e', s1: 'n', c: 's', s3: 'n', e: 'w', w: 's' };

export default {
  name: 'facades',
  build(ctx) {
    const { geom, root, plan, mat } = ctx, M = materials(ctx), R = ctx.R;
    const faces = openFaces(plan), inst = { concrete: [], darkMetal: [], sheet: [], grate: [], blackMetal: [] };
    let mute = false;   // while set, a part is not built (it would stand in front of a sign); the random stream goes on
    const box = (m, pos, yaw, scale, tilt = 0) => { if (!mute) inst[m].push(geom.compose(pos, [tilt, yaw, 0], scale)); };
    const loose = new geom.MeshBatch(), art = new THREE.Group(); art.name = 'wall-art'; decor(art);
    const signs = [], ledWalls = [{ pos: [5, 14, 9.9], rotY: Math.PI, w: 12, h: 6.5 }, { pos: [6.1, 14, -9], rotY: Math.PI / 2, w: 12, h: 5.5 }];
    // what must stay clear: every wall sign of the plan, the LED walls, the plan's other screens on walls (adverts)
    const clearRects = signRects(plan, [...ledWalls.map((a) => { const nx = Math.round(Math.sin(a.rotY)), nz = Math.round(Math.cos(a.rotY)), al = nx ? a.pos[2] : a.pos[0];
      return { x: a.pos[0] - nx * 0.1, z: a.pos[2] - nz * 0.1, nx, nz, u0: al - a.w / 2, u1: al + a.w / 2, y0: a.pos[1] - a.h / 2, y1: a.pos[1] + a.h / 2 }; }),
    ...(plan.adverts?.walls || []).map((a) => ({ x: a.x, z: a.z, nx: a.n[0], nz: a.n[1], u0: a.u[0], u1: a.u[1], y0: a.y[0], y1: a.y[1] }))]);
    const blocked = (f, u, half, y0, y1, below = 0) => inFrontOfSign(clearRects, { plane: f.nx ? f.x0 : f.z0, nx: f.nx, nz: f.nz, along: f.nx ? f.z0 + (f.z1 - f.z0) * u / f.len : f.x0 + (f.x1 - f.x0) * u / f.len, half, y0, y1, below });
    // balcony life: laundry, dishes, plants under grow lights (instanced; their own random stream)
    const life = { cloth: [], dish: [], plant: [], grow: [] }, D = detail(ctx);

    for (const f of faces) {
      const k = f.block, yaw = faceYaw(f), fh = FLOOR[k.style], bw = BAY[k.style], Q = R.fork(k.name + f.face + Math.round(f.x0) + Math.round(f.z0));
      const top = Math.min(k.h - 1.5, 4.4 + fh * 6), floors = Math.max(0, Math.floor((top - 4.4) / fh)), bays = Math.max(1, Math.floor(f.len / bw));
      const u0 = (f.len - bays * bw) / 2;
      // ---- per window: a balcony, an AC unit or a ledge
      for (let i = 0; i < floors; i++) {
        const y = 4.4 + i * fh;
        if (k.style === 'panel') for (let b = 0; b < bays; b++) { mute = blocked(f, u0 + (b + 0.5) * bw, bw / 2, y + fh * 0.3, y + fh * 0.42, 1.5); box('darkMetal', onFace(f, u0 + (b + 0.5) * bw, y + fh * 0.36, 0.09), yaw, [bw, 0.07, 0.18]); }   // a rib under each strip window
        for (let b = 0; b < bays; b++) {
          const u = u0 + (b + 0.5) * bw, r = Q.next();
          mute = k.style === 'glass' ? blocked(f, u0 + b * bw, 0.15, 4.4, top) : blocked(f, u, bw * 0.45, y + fh * 0.3 - 0.8, y + fh * 0.3 + 1.1, 2.4);
          if (k.style === 'concrete') {
            const sill = y + fh * 0.3;
            if (r < 0.3) {   // a balcony: slab, three rails, sometimes a unit standing on it
              box('concrete', onFace(f, u, sill - 0.06, 0.42), yaw, [bw * 0.72, 0.12, 0.84]);
              for (const h of [0.35, 0.7, 1.0]) box('darkMetal', onFace(f, u, sill + h, 0.82), yaw, [bw * 0.72, 0.035, 0.035]);
              for (const s of [-1, 1]) { box('darkMetal', onFace(f, u + s * bw * 0.36, sill + 0.5, 0.82), yaw, [0.035, 1.0, 0.035]); box('darkMetal', onFace(f, u + s * bw * 0.36, sill + 1.0, 0.42), yaw, [0.035, 0.035, 0.8]); }
              if (Q.chance(0.5)) box('sheet', onFace(f, u + Q.range(-0.5, 0.5), sill + 0.28, 0.4), yaw, [0.7, 0.5, 0.36]);
              const L = ctx.R.fork('life' + k.name + f.face + i + '-' + b), lr = L.next();
              if (!mute && L.next() < D) {
                if (lr < 0.4) for (let c = 0; c < 4; c++) life.cloth.push([onFace(f, u - bw * 0.3 + c * bw * 0.2 + L.range(-0.05, 0.05), sill + 0.98, 0.86), yaw, [L.range(0.3, 0.5), L.range(0.4, 0.7), 1], L.int(0, 5)]);
                else if (lr < 0.65) life.dish.push([onFace(f, u + L.range(-0.6, 0.6), sill + 1.25, 0.7), yaw + L.range(-0.5, 0.5), L.range(0.35, 0.55)]);
                else if (lr < 0.9) { for (let c = 0; c < 4; c++) life.plant.push([onFace(f, u - bw * 0.27 + c * bw * 0.18, sill + 0.18, 0.62), L.range(0.18, 0.3)]); life.grow.push([onFace(f, u, sill + 0.98, 0.62), yaw, bw * 0.6]); }
              }
            } else if (r < 0.62) {   // an AC unit on brackets under the window, its drain down the wall
              box('sheet', onFace(f, u + Q.range(-0.4, 0.4), sill - 0.36, 0.22), yaw, [0.82, 0.54, 0.4]);
              box('blackMetal', onFace(f, u, sill - 0.66, 0.2), yaw, [0.9, 0.04, 0.4]);
            } else box('concrete', onFace(f, u, sill - 0.02, 0.07), yaw, [bw * 0.66, 0.08, 0.16]);
          } else if (k.style === 'panel') {
            if (r < 0.3) box('sheet', onFace(f, u + Q.range(-0.8, 0.8), y + fh * 0.2, 0.22), yaw, [0.9, 0.56, 0.4]);
          } else if (b % 2 === 0) box('darkMetal', onFace(f, u0 + b * bw, 4.4 + (top - 4.4) / 2, 0.12), yaw, [0.07, top - 4.4, 0.24]);   // fins
        }
      }
      mute = false;
      // ---- pipes: one every 7 m or so, the full height dressed, three brackets
      const base = k.y ? k.y + 0.8 : 0.6;   // a block that starts above another (the floors over the bar) is dressed from there up
      for (let u = Q.range(1.2, 3); u < f.len - 0.5; u += Q.range(5.5, 8.5)) {
        const h = Math.min(k.h, 26), r = Q.range(0.05, 0.085);
        if (blocked(f, u, r + 0.05, base, h)) { Q.chance(0.3); continue; }
        loose.add(new THREE.CylinderGeometry(r, r, h - base, 8), Q.chance(0.3) ? M.sheet : M.darkMetal, geom.compose(onFace(f, u, base + (h - base) / 2, 0.16 + r)));
        for (const y of [1.2, 4.6, 9, 14, 19]) if (y < h && y > base) box('blackMetal', onFace(f, u, y, 0.12), yaw, [r * 2 + 0.1, 0.06, 0.24]);
      }
      // ---- a cable bundle along the wall over the shop fronts, sagging between its brackets, with junction boxes
      const cy = 4.72, pts = [];
      for (let u = 0.4; u <= f.len - 0.3; u += 0.9) { const span = (u % 4.5) / 4.5; pts.push(onFace(f, u, cy - 0.22 * 4 * span * (1 - span) - 0.02, 0.2)); }
      const runs = [[]];
      pts.forEach((p, i) => { if (blocked(f, 0.4 + i * 0.9, 0.5, cy - 0.3, cy + 0.1)) { if (runs.at(-1).length) runs.push([]); } else runs.at(-1).push(p); });
      for (const run of runs) if (run.length > 3) {
        loose.add(geom.taperedTube(run, run.map(() => 0.028), { radial: 5 }), M.blackMetal);
        loose.add(geom.taperedTube(run.map(([x, y, z]) => [x + f.nx * 0.05, y - 0.07, z + f.nz * 0.05]), run.map(() => 0.016), { radial: 4 }), M.rubber);
      }
      if (pts.length > 3) for (let u = 2.5; u < f.len - 1; u += 9) { mute = blocked(f, u, 0.3, cy - 0.2, cy + 0.4); box('sheet', onFace(f, u, cy + 0.1, 0.14), yaw, [0.42, 0.52, 0.2]); }
      mute = false;
      // ---- a fire escape: a landing at each of four floors, a stair between them, rails, a ladder that stops short
      const escU = [0.68, 0.32, 0.86, 0.14, 0.5].map((t) => f.len * t).find((u) => !blocked(f, u, 1.6, 3.4, 4.4 + Math.min(floors, 4) * fh + 1.2, 0));
      if (ESCAPES[k.name] === f.face && f.len > 9 && floors >= 3 && escU !== undefined) {
        const u = escU, w = 2.8, n = Math.min(floors, 4);
        for (let i = 0; i < n; i++) {
          const y = 4.4 + i * fh + 0.2;
          box('grate', onFace(f, u, y, 0.62), yaw, [w, 0.06, 1.1]);
          for (const h of [0.5, 1.0]) { box('darkMetal', onFace(f, u, y + h, 1.15), yaw, [w, 0.035, 0.035]); for (const s of [-1, 1]) box('darkMetal', onFace(f, u + s * w / 2, y + h, 0.62), yaw, [0.035, 0.035, 1.1]); }
          for (const s of [-1, -0.33, 0.33, 1]) box('darkMetal', onFace(f, u + s * w / 2, y + 0.5, 1.15), yaw, [0.035, 1.0, 0.035]);
          for (const s of [-1, 1]) box('blackMetal', onFace(f, u + s * (w / 2 - 0.1), y - 0.25, 0.4), yaw, [0.06, 0.06, 0.9], 0.5);   // struts back to the wall
          if (i < n - 1) {   // the flight to the next landing, leaning along the wall, alternate ways
            const dir = i % 2 ? -1 : 1, run = w * 0.62, slope = Math.atan2(fh, run), len = Math.hypot(fh, run);
            const m = geom.compose(onFace(f, u, y + fh / 2, 0.36), [0, yaw, dir * slope], [len, 0.07, 0.5]);
            inst.grate.push(m);
            inst.darkMetal.push(geom.compose(onFace(f, u, y + fh / 2 + 0.9, 0.6), [0, yaw, dir * slope], [len, 0.035, 0.035]));
          }
        }
        box('darkMetal', onFace(f, u - w / 2 + 0.3, 3.6, 0.9), yaw, [0.4, 1.9, 0.04]);
      }
      // ---- the ground storey: bills, tags and stencils on the wall between the shop fronts
      const palette = ['#ff2a80', '#19d8ff', '#ffb347', '#8f5cff', '#3dff9a', '#ff3b30', '#f2f2f2'];
      const words = ['通緝', '出租', '夜市', 'VOTE', '拆', '禁止', 'NO SIGNAL', '現金', '修理', 'LOST', '徵人', '99', '灰叔'];
      for (let u = Q.range(0.8, 2.2); u < f.len - 1 && !k.y; u += Q.range(1.6, 4.2)) {
        const kind = Q.pick(['poster', 'poster', 'tag', 'tag', 'stencil']), s = kind === 'poster' ? Q.range(0.55, 0.85) : kind === 'tag' ? Q.range(1.1, 2.0) : Q.range(0.4, 0.7);
        const tex = artTexture(kind, Q.fork('art' + Math.round(u * 10)), { text: Q.pick(words), color: Q.pick(palette) });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(s, kind === 'poster' ? s * 1.35 : kind === 'tag' ? s * 0.6 : s),
          mat.std({ map: tex, color: new THREE.Color().setScalar(kind === 'poster' ? 0.3 : 0.15), transparent: true, depthWrite: false, roughness: kind === 'poster' ? 0.85 : 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
        m.position.set(...onFace(f, u, kind === 'tag' ? Q.range(0.9, 1.7) : Q.range(1.3, 2.2), 0.125)); m.rotation.set(0, yaw, Q.range(-0.08, 0.08));
        m.castShadow = false; m.renderOrder = 2; art.add(m);
      }
    }

    // ---- scaffolded billboards on the lower roofs, facing the street
    for (const [name, x, z, yaw, w, h, text, color] of [['s1', -12, 10.9, Math.PI, 9, 3.6, ['夜城牛肉麵', 'OPEN 24H'], 'amber'], ['barUpper', -16, 1.1, 0, 8, 3.2, ['KIRIN·機械義體', 'UPGRADE'], 'cyan'], ['s3', 26, 10.9, Math.PI, 8.5, 3.4, ['黑市 · MARKET'], 'pink'], ['e', 30.9, -10, -Math.PI / 2, 8, 3.2, ['資料港', 'DATA PORT'], 'green']]) {
      const k = plan.blocks.find((b) => b.name === name), y = k.h + 0.9;
      for (const s of [-1, -0.33, 0.33, 1]) {
        const px = x + Math.cos(yaw) * s * w / 2, pz = z - Math.sin(yaw) * s * w / 2;
        box('darkMetal', [px, y + (h + 1.2) / 2, pz], yaw, [0.1, h + 1.2, 0.1]);
        box('darkMetal', [px - Math.sin(yaw) * 0.8, y + (h + 1.2) / 2 - 0.3, pz - Math.cos(yaw) * 0.8], yaw, [0.07, h + 1.6, 0.07], 0.42);
      }
      for (const t of [0.15, 0.55, 0.95]) box('darkMetal', [x - Math.sin(yaw) * 0.06, y + (h + 1.2) * t, z - Math.cos(yaw) * 0.06], yaw, [w, 0.07, 0.07]);
      signs.push({ pos: [x + Math.sin(yaw) * 0.08, y + 1.0 + h / 2, z + Math.cos(yaw) * 0.08], rotY: yaw, w, h, text, color, kind: 'board', second: '#ffffff' });
    }

    const unit = new THREE.BoxGeometry(1, 1, 1), group = new THREE.Group(); group.name = 'facade-kit';
    mute = false;
    // balcony life: laundry (one colour per instance), dishes, potted plants and the grow light over them
    const clothM = mat.std({ roughness: 0.85, side: THREE.DoubleSide }), clothC = [[0.55, 0.52, 0.46], [0.18, 0.28, 0.45], [0.55, 0.14, 0.14], [0.75, 0.7, 0.6], [0.15, 0.36, 0.3], [0.62, 0.5, 0.12]];
    if (life.cloth.length) {
      const cm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1, 1, 2).translate(0, -0.5, 0), clothM, life.cloth.length);
      life.cloth.forEach(([p, yw, sc, c], i) => { cm.setMatrixAt(i, geom.compose(p, [0.05, yw, 0], sc)); cm.setColorAt(i, new THREE.Color().setRGB(...clothC[c])); });
      cm.castShadow = false; cm.name = 'balcony-laundry'; group.add(cm);
    }
    if (life.dish.length) {
      const dg = geom.lathe([[0.001, -0.02], [0.25, 0.0], [0.48, 0.1], [0.5, 0.12]], 14).rotateX(Math.PI / 2 - 0.5);
      group.add(Object.assign(geom.instances(dg, M.steel, life.dish.map(([p, yw, s]) => geom.compose(p, [0, yw, 0], s)), { castShadow: false }), { name: 'balcony-dishes' }));
    }
    if (life.plant.length) {
      const leaf = mat.std({ color: new THREE.Color(0.05, 0.16, 0.05), roughness: 0.7 });
      group.add(Object.assign(geom.instances(new THREE.IcosahedronGeometry(1, 0), leaf, life.plant.map(([p, s]) => geom.compose(p, [s * 7, s * 13, 0], [s, s * 1.2, s])), { castShadow: false }), { name: 'balcony-plants' }));
      group.add(Object.assign(geom.instances(new THREE.BoxGeometry(1, 1, 1), mat.glow([1.0, 0.2, 0.85], 5), life.grow.map(([p, yw, w]) => geom.compose(p, [0, yw, 0], [w, 0.03, 0.06])), { castShadow: false }), { name: 'balcony-growlights' }));
    }
    for (const [m, list] of Object.entries(inst)) if (list.length) { const mesh = geom.instances(unit, M[m], list, { castShadow: m === 'concrete' }); mesh.name = 'kit:' + m; group.add(mesh); }   // only the balcony slabs cast
    group.add(loose.finish({ name: 'facade-pipes', castShadow: false }));
    root.add(decor(group), art);
    return { signs, ledWalls, parts: Object.values(inst).reduce((a, l) => a + l.length, 0) };
  },
  anchors: (ctx, built) => ({ signs: built.signs, ledWalls: built.ledWalls }),
};
