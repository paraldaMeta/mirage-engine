// lighthouse: a round white harbour light on the pier head: stone plinth (one step up), tapering plaster shaft
// with one red band, two small windows, a shut timber door facing east and the lever plate beside it, a corbelled
// gallery with an iron railing, the lantern room (glazing between mullions, dark dome, vane) and the lens inside.
// Numbers in NOTES.md § lighthouse.
// Reads plan: lighthouse, pier.y, points.lighthouseDoor, points.lever. Offers anchors: levers (pos = the lever's
// pivot on the wall plate = points.lever), beacon (pos = the lens centre in the lantern room). Consumes: none.
import * as THREE from 'three';
import { materials } from './materials.js';

const SEG = 48;                 // shaft / plinth segments (seen up close from the pier head)

export default {
  name: 'lighthouse',
  build(ctx) {
    const { geom, mat, root, plan, R } = ctx;
    const L = plan.lighthouse, pier = plan.pier, pts = plan.points || {};
    if (!L || !L.center || !L.plinth || !L.lantern || !L.band) throw new Error('lighthouse: plan.lighthouse (center, plinth, band, lantern) is missing');
    if (!pier || typeof pier.y !== 'number') throw new Error('lighthouse: plan.pier.y is missing');
    if (!pts.lighthouseDoor || !pts.lever) throw new Error('lighthouse: plan.points.lighthouseDoor / plan.points.lever is missing');
    const [cx, , cz] = L.center, Y = pier.y;
    const P = L.plinth, y0 = Y + P.h;                         // shaft foot (plinth top)
    const G = Y + L.gallery;                                   // gallery floor top
    const rAt = (y) => L.base + (L.top - L.base) * THREE.MathUtils.clamp((y - y0) / (G - y0), 0, 1);   // shaft radius at height y
    const at = (x, y, z) => [cx + x, y, cz + z];
    const C0 = geom.compose(at(0, 0, 0));

    const M = materials(ctx);
    const red = mat.std({ roughness: 0.88 }, mat.PROC.plaster('vec3(0.42, 0.06, 0.05)', { wear: 0.7, foot: 0 }));
    const glass = mat.std({ color: new THREE.Color(0.55, 0.62, 0.62), roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false });

    const b = new geom.MeshBatch();       // the solid tower (blocks the walk)
    const top = new geom.MeshBatch();     // the gallery and above (above walk.yMax: left out of the bake)

    // plinth: one 0.3 m step, sunk 2 cm into the deck (no coplanar faces with the deck top)
    b.cylinder(M.stone, P.r, P.r, P.h + 0.02, at(0, Y + P.h / 2 - 0.01, 0), [0, 0, 0], SEG);
    // shaft: a lathe closed at the axis (a closed solid for the bake), tapering base -> top
    const sTop = G - 0.6;
    b.add(geom.lathe([[0, y0 - 0.02], [L.base, y0 - 0.02], [rAt(sTop), sTop], [0, sTop]], SEG), M.plaster, C0);
    // a stone foot course (4 cm proud) and the red band (2 cm proud)
    b.add(geom.lathe([[0, y0 - 0.01], [L.base + 0.04, y0 - 0.01], [rAt(y0 + 0.25) + 0.04, y0 + 0.25], [rAt(y0 + 0.33), y0 + 0.33], [0, y0 + 0.33]], SEG), M.stone, C0);
    const [b0, b1] = L.band;
    b.add(geom.lathe([[0, Y + b0], [rAt(Y + b0) + 0.02, Y + b0], [rAt(Y + b1) + 0.02, Y + b1], [0, Y + b1]], SEG), red, C0);

    // door (east, +X): a shut plank door 1.0 x 2.1 m in a stone surround, sill on the plinth top
    const [, dy, dz] = pts.lighthouseDoor;                     // floor centre of the door on the shaft face
    const DW = 1.0, DH = 2.1;
    const dc = cx + Math.sqrt(Math.max(0, rAt(dy) ** 2 - (dz - cz) ** 2));   // shaft face at the door's centre line
    b.box(M.timber, [0.32, DH, DW], [dc + 0.08 - 0.16, dy + DH / 2, dz]);          // leaf, 8 cm proud
    for (const s of [-1, 1]) b.box(M.stone, [0.4, DH, 0.18], [dc + 0.14 - 0.2, dy + DH / 2, dz + s * (DW / 2 + 0.09)]);   // jambs
    b.box(M.stone, [0.44, 0.26, DW + 0.5], [dc + 0.16 - 0.22, dy + DH + 0.13, dz]);  // lintel
    b.box(M.iron, [0.06, 0.05, 0.16], [dc + 0.1, dy + 1.0, dz - DW / 2 + 0.18]);      // handle
    for (const h of [0.3, 1.75]) b.box(M.iron, [0.03, 0.06, DW * 0.8], [dc + 0.09, dy + h, dz + 0.05]);   // strap hinges
    // lever plate: an iron plate on the shaft beside the door, its face 5 cm behind the pivot (points.lever)
    const [lx, ly, lz] = pts.lever;
    b.box(M.iron, [0.22, 0.42, 0.26], [lx - 0.05 - 0.11, ly, lz], [0, 0, 0], 0.01);
    b.box(M.iron, [0.06, 0.08, 0.08], [lx - 0.03 + 0.0, ly, lz]);                    // pivot boss (ends at the pivot)

    // two small windows up the shaft (east above the door; south-west higher): stone frame round a dark pane
    for (const [ang, h] of [[0, 5.6], [Math.PI * 1.2, 10.6]]) {
      const y = Y + h, r = rAt(y) - 0.12;
      const n = [Math.cos(ang), -Math.sin(ang)], t = [Math.sin(ang), Math.cos(ang)];   // outward normal, tangent (x, z)
      const place = (size, o, yy, s, m) => b.add(new THREE.BoxGeometry(...size), m,
        geom.compose([cx + n[0] * (r + o) + t[0] * s, yy, cz + n[1] * (r + o) + t[1] * s], [0, ang, 0]));
      place([0.34, 0.9, 0.5], 0.08, y, 0, M.iron);             // pane, 8 cm behind the frame face
      place([0.34, 0.12, 0.74], 0.16, y - 0.51, 0, M.stone);   // sill
      place([0.34, 0.14, 0.7], 0.16, y + 0.52, 0, M.stone);    // lintel
      for (const s of [-1, 1]) place([0.34, 0.9, 0.1], 0.16, y, s * 0.3, M.stone);   // jambs
    }
    root.add(b.finish({ name: 'lighthouse' }));

    // gallery: corbelled stone ring under a stone floor slab, iron railing
    const GR = L.top + 0.65;                                   // gallery floor radius
    top.add(geom.lathe([[0, G - 0.9], [rAt(G - 0.9) + 0.03, G - 0.9], [rAt(G - 0.6) + 0.15, G - 0.6], [GR - 0.1, G - 0.26], [0, G - 0.26]], SEG), M.stone, C0);
    top.cylinder(M.stone, GR, GR, 0.25, at(0, G - 0.125, 0), [0, 0, 0], SEG);
    const NC = 20;
    for (let i = 0; i < NC; i++) {                              // corbel brackets
      const a = (i / NC) * Math.PI * 2, r = L.top + 0.32;
      top.box(M.stone, [0.55, 0.42, 0.2], [cx + Math.cos(a) * r, G - 0.47, cz - Math.sin(a) * r], [0, a, 0]);
    }
    const RR = GR - 0.1, RH = 1.05, NP = 24;
    for (let i = 0; i < NP; i++) {
      const a = (i / NP) * Math.PI * 2;
      top.cylinder(M.iron, 0.025, 0.025, RH, [cx + Math.cos(a) * RR, G + RH / 2, cz + Math.sin(a) * RR], [0, 0, 0], 6);
    }
    for (const [h, tr] of [[RH, 0.035], [RH * 0.5, 0.02]]) top.add(new THREE.TorusGeometry(RR, tr, 6, 64).rotateX(Math.PI / 2), M.iron, geom.compose(at(0, G + h, 0)));

    // lantern room: a white drum, glazing between iron mullions, a dark dome, ball and vane
    const LR = L.lantern.r, DR = 0.6, g0 = G + DR, g1 = g0 + L.lantern.h;
    top.add(geom.lathe([[0, G - 0.02], [LR + 0.08, G - 0.02], [LR + 0.08, g0 - 0.06], [LR + 0.14, g0 - 0.06], [LR + 0.14, g0], [0, g0]], 32), M.plaster, C0);
    const NM = 10;
    for (let i = 0; i < NM; i++) {
      const a = (i / NM) * Math.PI * 2 + Math.PI / NM;
      top.box(M.iron, [0.07, L.lantern.h, 0.07], [cx + Math.cos(a) * LR, (g0 + g1) / 2, cz - Math.sin(a) * LR], [0, a, 0]);
    }
    for (const yy of [g0 + 0.03, g0 + L.lantern.h * 0.5, g1 - 0.03]) top.add(new THREE.TorusGeometry(LR, 0.035, 6, 40).rotateX(Math.PI / 2), M.iron, geom.compose(at(0, yy, 0)));
    top.add(geom.lathe([[0, g1 - 0.02], [LR + 0.22, g1 - 0.02], [LR + 0.18, g1 + 0.12], [LR * 0.85, g1 + 0.55], [LR * 0.45, g1 + 0.95], [0.18, g1 + 1.12], [0, g1 + 1.14]], 32), M.iron, C0);
    top.add(new THREE.SphereGeometry(0.14, 12, 8), M.iron, geom.compose(at(0, g1 + 1.26, 0)));
    top.cylinder(M.iron, 0.02, 0.025, 1.3, at(0, g1 + 1.85, 0), [0, 0, 0], 6);
    const vaneRot = R.range(0, Math.PI * 2);                    // the vane points where the last wind left it
    top.add(new THREE.BoxGeometry(0.9, 0.025, 0.02), M.iron, geom.compose(at(0, g1 + 2.2, 0), [0, vaneRot, 0]));
    top.add(new THREE.BoxGeometry(0.3, 0.28, 0.02).translate(-0.42, 0, 0), M.iron, geom.compose(at(0, g1 + 2.2, 0), [0, vaneRot, 0]));
    // lamp: a pedestal and the lens (the game lights it at the beacon anchor)
    const lc = (g0 + g1) / 2;                                   // lens centre height
    const ped = lc - 0.5 - G;
    top.cylinder(M.iron, 0.12, 0.2, ped, at(0, G + ped / 2, 0), [0, 0, 0], 12);
    const topGroup = top.finish({ name: 'lighthouse:top' });
    topGroup.userData.collide = false;                          // above walk.yMax; thin rails would only add noise to the bake
    root.add(topGroup);

    const lens = new THREE.Mesh(geom.lathe([[0.001, -0.5], [0.3, -0.48], [0.46, -0.25], [0.5, 0], [0.46, 0.25], [0.3, 0.48], [0.001, 0.5]], 24), glass);
    lens.position.set(cx, lc, cz); lens.name = 'lighthouse:lens'; lens.userData.collide = false; lens.renderOrder = 1;
    // glazing: an open cylinder, transparent, never solid
    const pane = new THREE.Mesh(new THREE.CylinderGeometry(LR - 0.01, LR - 0.01, L.lantern.h - 0.06, NM * 2, 1, true), glass);
    pane.position.set(cx, (g0 + g1) / 2, cz); pane.name = 'lighthouse:glazing'; pane.userData.collide = false; pane.castShadow = false; pane.renderOrder = 2;
    root.add(lens, pane);

    return { beacon: [cx, lc, cz], gallery: G, lens };
  },
  // facing: rotY turns local +Z to (sin rotY, 0, cos rotY); π/2 = east, out toward the pier
  anchors: (ctx, built) => ({
    levers: [{ pos: [...ctx.plan.points.lever], rotY: Math.PI / 2 }],
    beacon: [{ pos: [...built.beacon], rotY: Math.PI / 2 }],
  }),
};
