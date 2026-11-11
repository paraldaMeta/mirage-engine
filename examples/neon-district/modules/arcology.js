// arcology: the megabuilding north of the relay (plan.arcology) and the far skyline. Seen from the plaza and the
// street it is what you look up at: four stacked setbacks to 230 m with lit terraces, a twin tower joined by three
// glazed sky-bridges, external lifts whose cabins ride up and down the south face, a corporate name running 80 m down
// that face, red aircraft-warning lights blinking at every corner and up the mast. Beyond everything a ring of far
// towers with tiny lit windows fades into the fog. All of it is out of reach: decor, no shadows.
import * as THREE from 'three';
import { materials } from './materials.js';
import { slab, decor } from './lib.js';
import { detail } from './kit.js';

const FONT = '"PingFang TC", "Hiragino Sans", "Noto Sans TC", system-ui, sans-serif';

// the vertical name: an emblem (an angular star in a cut-corner frame), four glyphs stacked, the latin name turned
function logoTexture() {
  const w = 256, h = 2048, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const Y = '#ffd23a';
  g.strokeStyle = Y; g.fillStyle = Y; g.lineWidth = 10; g.shadowColor = Y; g.shadowBlur = 16;
  g.beginPath(); g.moveTo(40, 30); g.lineTo(w - 20, 30); g.lineTo(w - 20, 210); g.lineTo(w - 60, 250); g.lineTo(20, 250); g.lineTo(20, 50); g.closePath(); g.stroke();
  g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, r = i % 2 ? 34 : 88; g.lineTo(w / 2 + Math.cos(a) * r, 140 + Math.sin(a) * r); } g.closePath(); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 200px ${FONT}`;
  ['北', '天', '重', '工'].forEach((ch, i) => { g.shadowBlur = 24; g.fillStyle = Y; g.fillText(ch, w / 2, 400 + i * 230); g.shadowBlur = 0; g.fillStyle = '#fff6d0'; g.globalAlpha = 0.6; g.fillText(ch, w / 2, 400 + i * 230); g.globalAlpha = 1; });
  g.save(); g.translate(w / 2, 1640); g.rotate(Math.PI / 2); g.font = `900 120px ${FONT}`; g.fillStyle = '#ffffff'; g.shadowColor = '#ffffff'; g.shadowBlur = 14; g.fillText('HOKUTEN', 0, 0); g.restore();
  g.fillStyle = Y; for (let i = 0; i < 12; i++) g.fillRect(30, 1900 + i * 10, w - 60 - (i % 3) * 40, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export default {
  name: 'arcology',
  build(ctx) {
    const { geom, root, plan, mat, R } = ctx, M = materials(ctx), A = plan.arcology, D = detail(ctx);
    const b = new geom.MeshBatch(), fx = new geom.MeshBatch(), warn = [];
    if (A) {
      const [x0, z0, x1, z1] = A.rect;
      // ---- four setbacks, alternating skins; a lit edge on every terrace
      const tiers = [[0, 0, 0.41], [2.5, 0.41, 0.65], [6, 0.65, 0.85], [9, 0.85, 1]], skins = ['panel', 'glass', 'concrete', 'glass'];
      tiers.forEach(([inset, f0, f1], i) => {
        const r = [x0 + inset, z0 + inset, x1 - inset, z1 - inset], y0 = A.h * f0, y1 = A.h * f1;
        slab(b, M.facade[skins[i]], r, y0, y1);
        slab(fx, M.neon[i % 2 ? 'amber' : 'cyan'], [r[0] - 0.15, r[3], r[2] + 0.15, r[3] + 0.15], y1 - 0.5, y1 - 0.3);   // the south edge of each terrace
        slab(b, M.darkMetal, [r[0] - 0.4, r[1] - 0.4, r[2] + 0.4, r[3] + 0.4], y1 - 0.2, y1 + 0.6);
        for (const [x, z] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) { warn.push([x, y1 + 1, z]); if (i === 0) for (let y = 30; y < y1 - 10; y += 32) warn.push([x, y, z]); }
      });
      // the crown: a mast with warning lights, a ring of light
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      b.cylinder(M.darkMetal, 0.4, 1.4, 38, [cx, A.h + 19, cz], [0, 0, 0], 8);
      for (let y = A.h + 8; y < A.h + 40; y += 10) warn.push([cx, y, cz]);
      fx.add(new THREE.TorusGeometry(5, 0.25, 6, 32).rotateX(Math.PI / 2), M.neon.red, geom.compose([cx, A.h + 2, cz]));
      // ---- the twin and three sky-bridges, glazed (their windows are lit by the facade shader)
      if (A.twin) {
        const [tx0, tz0, tx1, tz1] = A.twin, th = A.h * 0.8;
        slab(b, M.facade.panel, A.twin, 0, th * 0.6); slab(b, M.facade.glass, [tx0 + 2, tz0 + 2, tx1 - 2, tz1 - 2], th * 0.6, th);
        for (const [x, z] of [[tx0 + 2, tz0 + 2], [tx1 - 2, tz0 + 2], [tx0 + 2, tz1 - 2], [tx1 - 2, tz1 - 2]]) warn.push([x, th + 1, z]);
        const [ga, gb] = tx1 < x0 ? [tx1, x0] : [x1, tx0];   // the gap between the towers, along x
        for (const [y, h] of [[58, 7], [92, 5], [128, 9]]) {
          const zc = (Math.max(z0, tz0) + Math.min(z1, tz1)) / 2;
          slab(b, M.facade.glass, [ga - 4, zc - 4, gb + 4, zc + 4], y, y + h);
          slab(fx, M.neon.pink, [ga, zc + 4, gb, zc + 4.15], y - 0.3, y - 0.1);
          slab(b, M.darkMetal, [ga, zc - 4.3, gb, zc + 4.3], y - 0.8, y);
        }
      }
      // ---- the name down the south face of the second setback
      const face = z1 + 0.5, logo = new THREE.Mesh(new THREE.PlaneGeometry(8, 64), mat.glow([1, 1, 1], 3.2, { map: logoTexture() }));
      logo.position.set(x0 + 5.5, 62, face); logo.name = 'arcology-logo';
      b.box(M.blackMetal, [9, 65, 0.5], [x0 + 5.5, 62, face - 0.27]);
      // ---- external lifts: two shafts up the south face of the base, cabins riding on the clock
      const shafts = [x1 - 4, x1 - 8.5], cabins = [];
      for (const sx of shafts) {
        b.box(M.darkMetal, [0.3, A.h * 0.41, 0.3], [sx - 1.4, A.h * 0.205, z1 + 1.6]); b.box(M.darkMetal, [0.3, A.h * 0.41, 0.3], [sx + 1.4, A.h * 0.205, z1 + 1.6]);
        fx.box(M.neon.white, [0.08, A.h * 0.41, 0.08], [sx, A.h * 0.205, z1 + 0.15]);
        for (let k = 0; k < 2; k++) cabins.push({ x: sx, phase: k * Math.PI + sx });
      }
      const cabMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 3, 2.4), mat.glow([1.0, 0.78, 0.5], 4), cabins.length);
      cabMesh.frustumCulled = false; cabMesh.castShadow = false; cabMesh.name = 'arcology-lifts';
      const mtx = new THREE.Matrix4();
      const lift = (t) => { cabins.forEach((c, i) => { mtx.makeTranslation(c.x, 4 + (A.h * 0.41 - 10) * (0.5 - 0.5 * Math.cos(t * 0.05 + c.phase)), z1 + 1.6); cabMesh.setMatrixAt(i, mtx); }); cabMesh.instanceMatrix.needsUpdate = true; };
      lift(0); ctx.onUpdate(lift);
      root.add(decor(logo), decor(cabMesh));
    }

    // ---- red aircraft-warning lights, blinking slowly together
    const red = mat.glow([1, 0.06, 0.03], 16), base = red.color.clone();
    const warnMesh = geom.instances(new THREE.SphereGeometry(0.7, 8, 6), red, warn.map((p) => geom.compose(p)), { castShadow: false });
    warnMesh.name = 'warning-lights';
    ctx.onUpdate((t) => { red.color.copy(base).multiplyScalar(0.12 + 0.88 * Math.pow(Math.max(0, Math.sin(t * 1.4)), 8)); });

    // ---- the far skyline: a ring of towers 260 to 480 m out, dark with tiny lit windows, into the fog
    const Q = R.fork('far'), towers = [];
    const n = Math.round(150 * Math.max(0.35, D));
    for (let i = 0; i < n; i++) {
      const a = Q.range(0, Math.PI * 2), r = Q.range(260, 480), w = Q.range(18, 46), d = Q.range(18, 46), h = Q.range(50, 280) * (Q.chance(0.15) ? 1.4 : 1);
      towers.push(geom.compose([Math.cos(a) * r, h / 2, Math.sin(a) * r], [0, Q.range(0, 1.5), 0], [w, h, d]));
    }
    const farMat = mat.std({ color: new THREE.Color(0.05, 0.055, 0.07), roughness: 0.9 }, {
      fragmentDecl: 'vec3 ndW;',
      albedo: `{ vec3 p = mgWorldPos, n = normalize(mgWorldNormal); ndW = vec3(0.0);
        if (abs(n.y) < 0.5) { vec2 u = vec2(dot(p.xz, normalize(vec2(-n.z, n.x))), p.y) / vec2(3.2, 3.6), id = floor(u), f = fract(u);
          float h = mgHash(vec3(id, floor(dot(p.xz, n.xz)))), lit = step(0.8, h) * step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
          ndW = (h > 0.93 ? vec3(0.6, 0.85, 1.0) : vec3(1.0, 0.7, 0.4)) * lit * (0.4 + 0.6 * fract(h * 37.0)); }
        diffuseColor.rgb *= 0.8 + 0.4 * mgValue2(floor(p.xz / 40.0)); }`,
      emissive: 'totalEmissiveRadiance += ndW * (1.4 * uLampGain);',
    });
    const far = geom.instances(new THREE.BoxGeometry(1, 1, 1), farMat, towers, { castShadow: false, receiveShadow: false });
    far.name = 'far-skyline';
    const bm = b.finish({ name: 'arcology', castShadow: false }), fm = fx.finish({ name: 'arcology-lights', castShadow: false });
    for (const o of [bm, fm, far, warnMesh]) o.traverse((c) => { c.userData.occlude = false; });
    root.add(decor(bm), decor(fm), decor(warnMesh), decor(far));
  },
};
