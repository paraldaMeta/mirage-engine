// pier: the timber pier on piles from the promenade (x −2) to the square pier head (x −70 … −58): plank deck over
// joists and a closed collision slab, piles with caps and X-bracing, timber rails with proxies, iron lamp posts.
// Reads plan: pier, footprints.pierHead. Offers anchors: lamps (pos = the lantern ring on top of each pier lamp
// post, kind 'post'). Consumes: none. Numbers in NOTES.md § pier.
import * as THREE from 'three';
import { PROC } from '@mirage/core';
import { materials } from './materials.js';

const PLANK_T = 0.05, GAP = 0.01, PLANK_W = 0.2;       // deck boards: thickness, gap, nominal width
const JOIST = [0.1, 0.2];                              // joist width, depth under the planks
const CAP = [0.26, 0.3];                               // pile cap (bent beam) width, depth under the joists
const RAIL_POST = 0.12, RAIL_EVERY = 2, RAIL_IN = 0.08; // rail post size, spacing, inset from the deck edge

function lampXs(P) {
  const xs = [];
  for (let x = P.x0 - 6; x > P.end + 1; x -= P.lampEvery) xs.push(x);   // −8, −20, −32, −44, −56
  return xs;
}

export default {
  name: 'pier',
  build(ctx) {
    const { geom, mat, root, plan, R } = ctx;
    const P = plan.pier, head = plan.footprints && plan.footprints.pierHead;
    const LAMP_H = plan.lampPost.h;                     // lamp post height above the deck (lantern ring on top)
    if (!P) throw new Error('pier: plan.pier is missing');
    if (!head || !head.rect) throw new Error('pier: plan.footprints.pierHead.rect is missing');
    for (const k of ['y', 'x0', 'end', 'width', 'bay', 'rail', 'lampEvery', 'pile', 'seabed'])
      if (typeof P[k] !== 'number') throw new Error(`pier: plan.pier.${k} must be a number`);
    const [hx0, hz0, hx1, hz1] = head.rect;
    const Y = P.y, hw = P.width / 2;
    const M = materials(ctx);
    const deckWood = M.timber;                                             // grain along z: the boards run across
    const railWood = mat.std({ roughness: 0.8 }, PROC.wood('vec3(0.23, 0.19, 0.15)', 'x'));   // module-only: grain along x
    const pileWood = M.post, iron = M.iron;

    const b = new geom.MeshBatch();
    const yPlankC = Y - PLANK_T / 2, yJoistTop = Y - PLANK_T - 0.002;
    const yJoistC = yJoistTop - JOIST[1] / 2, yCapTop = yJoistTop - JOIST[1] - 0.002;
    const yCapC = yCapTop - CAP[1] / 2, yPileTop = yCapTop - CAP[1];

    // --- run deck: boards across the run (along z), x from x0 to end, 1 cm gaps ---
    const runLen = P.x0 - P.end;
    const nRun = Math.round(runLen / (PLANK_W + GAP)), pitch = runLen / nRun;
    for (let i = 0; i < nRun; i++) {
      const x = P.x0 - pitch * (i + 0.5), dy = -R.range(0, 0.004);
      b.box(deckWood, [pitch - GAP, PLANK_T, P.width], [x, yPlankC + dy, 0], [0, R.range(-0.004, 0.004), 0]);
    }
    for (const z of [-hw + 0.15, -hw / 2, 0, hw / 2, hw - 0.15])              // joists along the run
      b.box(railWood, [runLen, JOIST[1], JOIST[0]], [(P.x0 + P.end) / 2, yJoistC, z]);
    for (const s of [-1, 1])                                                 // fascia boards on the deck edges
      b.box(railWood, [runLen, 0.24, 0.04], [(P.x0 + P.end) / 2, Y - 0.02 - 0.12, s * (hw + 0.02)]);

    // --- run piles: bents every bay, both sides, cap beam, X-bracing, waling ---
    const pileGeo = new THREE.CylinderGeometry(P.pile, P.pile * 1.08, yPileTop - P.seabed, 10, 1);
    const pileZ = hw - 0.25, braceTop = yPileTop - 0.15, braceBot = 0.3;
    const bents = [];
    for (let x = P.x0 - P.bay; x > P.end + 0.5; x -= P.bay) bents.push(x);
    for (const x of bents) {
      for (const s of [-1, 1]) b.add(pileGeo, pileWood, geom.compose([x, (yPileTop + P.seabed) / 2, s * pileZ], [0, R.range(0, 6), 0]));
      b.box(pileWood, [CAP[0], CAP[1], P.width + 0.3], [x, yCapC, 0]);
      const dz = 2 * pileZ, dy = braceTop - braceBot, len = Math.hypot(dz, dy), a = Math.atan2(dy, dz);
      b.box(pileWood, [0.06, 0.16, len], [x + 0.21, (braceTop + braceBot) / 2, 0], [a, 0, 0]);
      b.box(pileWood, [0.06, 0.16, len], [x - 0.21, (braceTop + braceBot) / 2, 0], [-a, 0, 0]);
    }
    for (const s of [-1, 1])                                                 // waling just above the water
      b.box(pileWood, [runLen - 2, 0.2, 0.08], [(P.x0 + P.end) / 2 - 1, 0.9, s * (pileZ + P.pile + 0.05)]);

    // --- pier head: boards along z spanning the head, joists along x, piles on a 4 × 4 grid ---
    const hLenX = hx1 - hx0, hLenZ = hz1 - hz0, hcx = (hx0 + hx1) / 2, hcz = (hz0 + hz1) / 2;
    const nHead = Math.round(hLenX / (PLANK_W + GAP)), hp = hLenX / nHead;
    for (let i = 0; i < nHead; i++)
      b.box(deckWood, [hp - GAP, PLANK_T, hLenZ], [hx0 + hp * (i + 0.5), yPlankC - R.range(0, 0.004), hcz]);
    for (let j = 0; j <= 8; j++)
      b.box(railWood, [hLenX, JOIST[1], JOIST[0]], [hcx, yJoistC, hz0 + 0.15 + j * (hLenZ - 0.3) / 8]);
    for (const s of [-1, 1]) b.box(railWood, [hLenX + 0.08, 0.24, 0.04], [hcx, Y - 0.14, s > 0 ? hz1 + 0.02 : hz0 - 0.02]);
    b.box(railWood, [0.04, 0.24, hLenZ], [hx0 - 0.02, Y - 0.14, hcz]);
    for (const s of [-1, 1]) b.box(railWood, [0.04, 0.24, hz1 - hw], [hx1 + 0.02, Y - 0.14, s * (hw + (hz1 - hw) / 2)]);
    const hcols = [0, 1, 2, 3].map((i) => hx0 + 0.3 + i * (hLenX - 0.6) / 3);
    const hrows = [0, 1, 2, 3].map((i) => hz0 + 0.3 + i * (hLenZ - 0.6) / 3);
    for (const x of hcols) {
      for (const z of hrows) b.add(pileGeo, pileWood, geom.compose([x, (yPileTop + P.seabed) / 2, z], [0, R.range(0, 6), 0]));
      b.box(pileWood, [CAP[0], CAP[1], hLenZ - 0.2], [x, yCapC, hcz]);
      for (let j = 0; j < 3; j++) {                                          // bracing between rows, alternating
        const z0 = hrows[j], z1 = hrows[j + 1], dz = z1 - z0, dy = braceTop - braceBot;
        const len = Math.hypot(dz, dy), a = Math.atan2(dy, dz), s = j % 2 ? 1 : -1;
        b.box(pileWood, [0.06, 0.16, len], [x + s * 0.21, (braceTop + braceBot) / 2, (z0 + z1) / 2], [s * a, 0, 0]);
      }
    }

    // --- rails: posts every 2 m, top rail at pier.rail, mid and kick rails; lamp posts replace some rail posts ---
    const lamps = lampXs(P);
    const railH = P.rail, postGeo = new THREE.BoxGeometry(RAIL_POST, railH - 0.07, RAIL_POST);
    const rz = hw - RAIL_IN;
    const lampZ = (i) => (i % 2 ? -1 : 1) * rz;
    const isLamp = (x, z) => lamps.some((l, i) => Math.abs(l - x) < 0.6 && Math.abs(lampZ(i) - z) < 0.01);
    const segs = [                                                           // [x0, z0, x1, z1] rail lines
      [P.x0 - 0.1, -rz, hx1 - RAIL_IN, -rz], [P.x0 - 0.1, rz, hx1 - RAIL_IN, rz],                 // the run
      [hx1 - RAIL_IN, -rz, hx1 - RAIL_IN, hz0 + RAIL_IN], [hx1 - RAIL_IN, rz, hx1 - RAIL_IN, hz1 - RAIL_IN],   // head east, open on the pier
      [hx1 - RAIL_IN, hz0 + RAIL_IN, hx0 + RAIL_IN, hz0 + RAIL_IN],                                 // head north
      [hx1 - RAIL_IN, hz1 - RAIL_IN, hx0 + RAIL_IN, hz1 - RAIL_IN],                                 // head south
      [hx0 + RAIL_IN, hz0 + RAIL_IN, hx0 + RAIL_IN, hz1 - RAIL_IN],                                 // head west
    ];
    for (const [x0, z0, x1, z1] of segs) {
      const len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rotY = Math.atan2(ux, uz);   // local +z along the segment
      const n = Math.max(1, Math.round(len / RAIL_EVERY));
      for (let i = 0; i <= n; i++) {
        const x = x0 + ux * len * i / n, z = z0 + uz * len * i / n;
        if (isLamp(x, z)) continue;
        b.add(postGeo, railWood, geom.compose([x, Y + (railH - 0.07) / 2, z]));
      }
      b.box(railWood, [0.16, 0.07, len + 0.16], [cx, Y + railH - 0.035, cz], [0, rotY, 0]);   // top rail (handrail)
      b.box(railWood, [0.05, 0.1, len], [cx, Y + 0.5, cz], [0, rotY, 0]);                     // mid rail
      b.box(railWood, [0.04, 0.08, len], [cx, Y + 0.14, cz], [0, rotY, 0]);                    // kick rail
      ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(0.24, railH + 0.1, len + 0.24)
        .rotateY(rotY).translate(cx, Y + (railH + 0.1) / 2, cz)));
    }

    // --- iron lamp posts on alternating sides, standing in the rail line ---
    const lb = new geom.MeshBatch();
    const shaft = geom.lathe([[0, 0], [0.13, 0], [0.13, 0.08], [0.09, 0.14], [0.075, 0.5], [0.055, 0.56], [0.05, LAMP_H - 0.12],
      [0.075, LAMP_H - 0.08], [0.1, LAMP_H - 0.02], [0.1, LAMP_H], [0, LAMP_H]], 12);
    const lampOut = lamps.map((x, i) => {
      const z = lampZ(i);
      lb.add(shaft, iron, geom.compose([x, Y + 0.001, z]));
      return { pos: [x, Y + LAMP_H, z], rotY: z > 0 ? 0 : Math.PI, kind: 'post' };
    });
    root.add(b.finish({ name: 'pier' }));
    root.add(lb.finish({ name: 'pier-lamps' }));

    // --- the floor: closed slabs whose top is the deck (the plank gaps never become holes) ---
    ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(runLen + 0.2, 0.3, P.width).translate((P.x0 + P.end) / 2 + 0.1, Y - 0.15, 0)));
    ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(hLenX, 0.3, hLenZ).translate(hcx, Y - 0.15, hcz)));

    return { lamps: lampOut, deckY: Y };
  },
  anchors: (ctx, built) => ({ lamps: built.lamps }),
};
