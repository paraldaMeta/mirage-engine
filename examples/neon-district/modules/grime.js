// grime: the infrastructure and dirt of a block nobody maintains (plan.grime). Thick cable bundles sagging across
// the alley between junction boxes, a duct and pipes along its walls that drip (drops falling on the scene clock),
// rubbish bags and crates, glossy puddles on the asphalt where the planar mirror shows the signs, hazard-striped
// barricades, yellow-and-black wayfinding painted on walls and floor, district numbers stencilled large, manhole
// covers with a cast pattern. Bags, paint and cables are decor; the barricades and crates are solid.
import * as THREE from 'three';
import { materials } from './materials.js';
import { decor } from './lib.js';
import { detail, thin, worn, textAtlas, atlasQuad } from './kit.js';

export default {
  name: 'grime',
  build(ctx) {
    const { geom, root, plan, mat, R } = ctx, M = materials(ctx), G = plan.grime || {}, K = plan.levels.kerb, D = detail(ctx);
    const b = new geom.MeshBatch(), fx = new geom.MeshBatch(), Q = R.fork('grime');
    const [ax0, , ax1] = plan.alley.rect;

    // ---- cable bundles across the alley: four to six cables each, one junction box at each wall
    const jbox = mat.std({ roughness: 0.5, metalness: 0.6 }, worn('vec3(0.3, 0.32, 0.3)', { rows: 0.5, chip: 0.4, rust: 0.6 }));
    for (const [z, y, n] of G.alleyCables || []) {
      for (const [x, s] of [[ax0, 1], [ax1, -1]]) {
        b.add(new geom.RoundedBoxGeometry(0.22, 0.5, 0.38, 2, 0.03), jbox, geom.compose([x + s * 0.11, y + 0.1, z]));
        fx.cylinder(M.darkMetal, 0.03, 0.03, y + 0.1, [x + s * 0.06, (y + 0.1) / 2, z + 0.12], [0, 0, 0], 6);       // a conduit down to the ground
      }
      for (let i = 0; i < n; i++) {
        const pts = [], sag = 0.5 + Q.range(0, 0.7), dz = Q.range(-0.15, 0.15), r = Q.pick([0.022, 0.03, 0.04, 0.018]);
        for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([ax0 + 0.2 + (ax1 - ax0 - 0.4) * t, y + 0.05 * i - sag * 4 * t * (1 - t), z + dz * Math.sin(t * Math.PI) + (i - n / 2) * 0.05]); }
        fx.add(geom.taperedTube(pts, pts.map(() => r), { radial: 5, segments: 18 }), i % 3 ? M.rubber : M.blackMetal);
      }
    }
    // ---- a duct along the alley's west wall on brackets, pipes that end in elbows and drip
    const duct = mat.std({ roughness: 0.4, metalness: 0.8 }, worn('vec3(0.42, 0.43, 0.44)', { rows: 1.2, chip: 0.25, rust: 0.5 }));
    if (G.duct) {
      const { x, side, z: [z0, z1], y } = G.duct;
      for (let z = z0; z < z1 - 0.1; z += 2.4) { fx.add(new geom.RoundedBoxGeometry(0.5, 0.42, Math.min(2.38, z1 - z), 2, 0.04), duct, geom.compose([x + side * 0.3, y, z + Math.min(2.38, z1 - z) / 2])); fx.box(M.blackMetal, [0.56, 0.06, 0.06], [x + side * 0.3, y + 0.24, z]); fx.box(M.blackMetal, [0.06, 0.5, 0.06], [x + side * 0.56, y, z]); }
    }
    const drips = [];
    for (const [x, z, top, out] of G.dripPipes || []) {
      const ox = out[0], oz = out[1];
      fx.cylinder(M.darkMetal, 0.06, 0.06, top - 2.6, [x, 2.6 + (top - 2.6) / 2, z], [0, 0, 0], 8);
      fx.add(new THREE.TorusGeometry(0.18, 0.06, 6, 8, Math.PI / 2), M.darkMetal, geom.compose([x + ox * 0.18, 2.6, z + oz * 0.18], [0, Math.atan2(ox, oz) + Math.PI / 2, Math.PI]));
      fx.cylinder(M.darkMetal, 0.06, 0.06, 0.12, [x + ox * 0.3, 2.42, z + oz * 0.3], [0, 0, 0], 8);
      for (let k = 0; k < 3; k++) drips.push(geom.compose([x + ox * 0.3, 2.34, z + oz * 0.3 + k * 0.001]));
    }
    if (drips.length && D >= 0.5) {
      const dm = mat.patch(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.62, 0.7), transparent: true, opacity: 0.85, depthWrite: false }), {
        vertexWorld: `#ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3]); float ph = fract(sin(dot(ip, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float f = fract(uTime * 0.7 + ph); mgWorld.y -= f * f * 2.3;
        #endif`,
      });
      const dmesh = geom.instances(new THREE.SphereGeometry(0.018, 5, 4).scale(1, 2.6, 1), dm, drips, { castShadow: false, receiveShadow: false });
      dmesh.frustumCulled = false; dmesh.name = 'drips'; root.add(decor(dmesh));
    }

    // ---- rubbish: bags in a heap, crates (solid when big)
    const bag = mat.std({ color: new THREE.Color(0.01, 0.01, 0.012), roughness: 0.18, metalness: 0.0 });
    const bagBlue = mat.std({ color: new THREE.Color(0.02, 0.05, 0.12), roughness: 0.2 });
    const bagGeo = new THREE.IcosahedronGeometry(0.32, 1);
    { const p = bagGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y < 0 ? y * 0.7 : y * (1 + 0.25 * Math.sin(p.getX(i) * 9))); p.setX(i, p.getX(i) * (1 + 0.12 * Math.sin(p.getZ(i) * 11))); } bagGeo.computeVertexNormals(); }
    const crateMat = mat.std({ roughness: 0.6, metalness: 0.3 }, worn('vec3(0.08, 0.2, 0.14)', { rows: 0.4, chip: 0.5, rust: 0.4 }));
    for (const [x, z, y, n] of thin(ctx, G.heaps || [], 2)) {
      const H = R.fork('h' + x + z);
      for (let i = 0; i < n; i++) fx.add(bagGeo, H.chance(0.75) ? bag : bagBlue, geom.compose([x + H.range(-0.6, 0.6), y + 0.2 + (i > 3 ? 0.3 : 0), z + H.range(-0.35, 0.35)], [H.range(-0.3, 0.3), H.range(0, 6), 0], [H.range(0.8, 1.2), H.range(0.75, 1.0), H.range(0.8, 1.1)]));
    }
    for (const [x, z, y, s, rot] of G.crates || []) {
      b.add(new geom.RoundedBoxGeometry(s * 1.2, s, s, 2, 0.03), crateMat, geom.compose([x, y + s / 2, z], [0, rot, 0]));
      fx.add(new THREE.BoxGeometry(s * 1.22, 0.04, s * 1.02), M.darkMetal, geom.compose([x, y + s * 0.75, z], [0, rot, 0]));
    }

    // ---- puddles on the asphalt: a glassy film, shaped by noise (cut out, not blended: the planar mirror sees it)
    const puddle = mat.std({ color: new THREE.Color(0.006, 0.007, 0.009), roughness: 0.03, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -3 }, {
      vertexDecl: 'varying vec2 ndUv;', vertexWorld: 'ndUv = uv;', fragmentDecl: 'varying vec2 ndUv;',
      albedo: `{ vec2 q = ndUv - 0.5; float r = length(q * vec2(1.0, 1.0)) + 0.18 * mgFbm2(mgWorldPos.xz * 1.3, 3) + 0.05 * mgFbm2(mgWorldPos.xz * 6.0, 2);
        if (r > 0.42) discard; }`,
      roughness: 'roughnessFactor = 0.02;',
    });
    // (low has no mirror and no SSR: no puddle films there)
    if (D >= 0.5) for (const [x, z, sx, sz, rot] of G.puddles || []) fx.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), puddle, geom.compose([x, (z > 3.6 && z < 8.4) || (x > ax0 && x < ax1 && z > 10) ? 0.004 : K + 0.004, z], [0, rot, 0], [sx, 1, sz]));

    // ---- hazard barricades: an A-frame with two striped boards (M.yellow is the striped paint)
    for (const [x, z, rot] of G.barricades || []) {
      const m = geom.compose([x, (z > 3.6 && z < 8.4) ? 0 : K, z], [0, rot, 0]), at = (p, r = [0, 0, 0]) => m.clone().multiply(geom.compose(p, r));
      for (const y of [0.55, 0.95]) b.add(new geom.RoundedBoxGeometry(1.6, 0.22, 0.04, 2, 0.015), M.yellow, at([0, y, 0.0]));
      for (const sx of [-0.7, 0.7]) for (const sz of [-1, 1]) fx.add(new THREE.BoxGeometry(0.05, 1.15, 0.05), M.darkMetal, at([sx, 0.55, sz * 0.18], [sz * 0.32, 0, 0]));
      fx.add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8).rotateX(Math.PI / 2), M.neon.amber, at([0, 1.14, 0.03]));
      const px = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 0.5)); px.applyMatrix4(at([0, 0.55, 0])); ctx.collider(px);
    }

    // ---- wayfinding: yellow and black panels on the walls, chevrons and words on the floor, big stencilled numbers
    const way = G.way || [], stencils = G.stencils || [], floor = G.floorMarks || [];
    const atlas = textAtlas([...way.map((w) => ({ text: w.text, style: 'way', w: 512, h: 160 })), ...stencils.map((s) => ({ text: s.text, style: 'stencil', color: '#ffd23a', w: 512, h: 512 })), ...floor.map((f) => ({ text: f.text, style: 'stencil', color: '#ffd23a', w: 512, h: 256 }))], { width: 2048 });
    const paint = mat.std({ map: atlas.texture, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }, {
      albedo: '{ diffuseColor.rgb *= 0.85 * (0.75 + 0.35 * mgFbm3(mgWorldPos * 1.7, 3)); }',
    });
    const cut = mat.std({ map: atlas.texture, alphaTest: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }, {
      albedo: '{ diffuseColor.a = smoothstep(0.08, 0.25, max(diffuseColor.r, diffuseColor.g)) * step(0.15, 0.6 + 0.5 * mgFbm3(mgWorldPos * 3.1, 3)); diffuseColor.rgb *= 0.8; }',
    });
    way.forEach((w, i) => fx.add(atlasQuad(w.w || 1.6, (w.w || 1.6) * 0.3125, atlas.rect(i)), paint, geom.compose(w.pos, [0, w.rotY, 0])));
    stencils.forEach((s, i) => fx.add(atlasQuad(s.size, s.size, atlas.rect(way.length + i)), cut, geom.compose(s.pos, [0, s.rotY, 0])));
    floor.forEach((f, i) => fx.add(atlasQuad(f.size, f.size / 2, atlas.rect(way.length + stencils.length + i)).rotateX(-Math.PI / 2), cut, geom.compose(f.pos, [0, f.rotY, 0])));

    // ---- manhole covers: a cast pattern drawn in a canvas, its light parts raised
    const mc = document.createElement('canvas'); mc.width = mc.height = 256;
    const g = mc.getContext('2d'); g.fillStyle = '#555'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#aaa'; g.lineWidth = 6; for (const r of [122, 100]) { g.beginPath(); g.arc(128, 128, r, 0, 7); g.stroke(); }
    g.save(); g.beginPath(); g.arc(128, 128, 96, 0, 7); g.clip(); g.lineWidth = 5; for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(128 + i * 16 - 200, 0); g.lineTo(128 + i * 16 + 200, 256); g.stroke(); g.beginPath(); g.moveTo(128 + i * 16 + 200, 0); g.lineTo(128 + i * 16 - 200, 256); g.stroke(); } g.restore();
    g.fillStyle = '#444'; g.fillRect(58, 104, 140, 48); g.fillStyle = '#bbb'; g.font = '900 34px "PingFang TC", "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('下水 07', 128, 129);
    const mtex = new THREE.CanvasTexture(mc); mtex.anisotropy = 8;
    const manhole = mat.std({ map: mtex, roughness: 0.45, metalness: 0.9, color: new THREE.Color(0.12, 0.12, 0.13) }, {
      normal: 'normal = mgBump(normal, texture2D(map, vMapUv).r, 0.03);',
      roughness: 'roughnessFactor = mix(0.6, 0.25, texture2D(map, vMapUv).r);',
    });
    for (const [x, z] of G.manholes || []) fx.cylinder(manhole, 0.43, 0.43, 0.025, [x, 0.014, z], [0, Q.range(0, 6), 0], 28);

    root.add(b.finish({ name: 'grime', castShadow: false }), decor(fx.finish({ name: 'grime-decor', castShadow: false })));
    return {};
  },
};
