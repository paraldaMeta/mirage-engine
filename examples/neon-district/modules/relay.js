// relay: the low building on the plaza's north side (plan.relay). A server room behind a double door, a stairwell
// of two flights in its east end, and the roof (y = plan.relay.roof) with plant, a mast and the uplink console.
// Offers `doors` (the plaza door: the game hangs the leaves and locks them), `signs` (the board on the parapet),
// `beacons` (the mast), `consoles` (the uplink) and `strobes` (the red lamp over the door, inside).
// Ambient volumes: the room and the stairwell (the reflection probe is set in main.js from plan.relay.room).
import * as THREE from 'three';
import { materials } from './materials.js';
import { lamp, slab, decor } from './lib.js';
import { propKit, recorder, track, beacon, tubeFixture, floodlight, bulkhead, crate } from '@miragekit/world/kits/cyber';
import { detail } from './kit.js';

export default {
  name: 'relay',
  build(ctx) {
    const { geom, root, plan } = ctx, M = materials(ctx), P = plan.relay, F = plan.levels.floor;
    const [x0, z0, x1, z1] = P.rect, T = P.wall, H = P.height, RF = P.roof, PT = RF + P.parapet;
    const S = P.stair, [s0, t0, s1, t1] = S.rect, TOP = S.top, part = P.room[2];          // part: the partition's west face
    const b = new geom.MeshBatch(), fx = new geom.MeshBatch(), PK = propKit(ctx), pb = new geom.MeshBatch(), D = detail(ctx), rec = recorder(ctx);   // rec: the crates (game/destruct.js)
    const at = (p, r = [0, 0, 0], s = 1) => geom.compose(p, r, s), leds = [];
    const box = (size, pos) => { const c = new THREE.Mesh(new THREE.BoxGeometry(...size)); c.position.set(...pos); ctx.collider(c); };

    // ---- the shell
    slab(b, M.concrete, [x0, z0, part, z0 + T], 0, PT);                                   // north wall (room part)
    slab(b, M.concrete, [x0, z0 + T, x0 + T, z1 - T], 0, PT);                             // west wall
    b.add(geom.wall({ length: x1 - x0, height: H, thickness: T, openings: [{ x: P.door.x - (x0 + x1) / 2, width: P.door.width, height: P.door.height, arch: 'flat' }] }),
      M.concrete, geom.compose([(x0 + x1) / 2, 0, z1 - T / 2]));                          // south wall with the plaza door
    slab(b, M.concrete, [x0, z1 - T, part, z1], H, PT);                                   // over it: fascia and parapet
    slab(b, M.relayFloor, [x0 + T, z0 + T, part, z1 - T], -0.2, F);                       // the room's floor
    slab(b, M.relayFloor, [P.door.x - P.door.width / 2, z1 - T, P.door.x + P.door.width / 2, z1], -0.2, F);   // threshold
    slab(b, M.plastic, [x0 + T, z0 + T, part, z1 - T], H - 0.1, H);                       // ceiling panels
    slab(b, M.roofing, [x0, z0, part, z1], H, RF);                                        // the roof slab (plant floor inside it)
    // the stairwell's box: walls up to TOP, a lid, and the partition toward the room with a door at each level
    slab(b, M.concreteDry, [part, z0, x1, t0], 0, TOP);
    slab(b, M.concreteDry, [s1, t0, x1, t1], 0, TOP);
    slab(b, M.concreteDry, [part, t1, x1, z1], H, TOP);
    slab(b, M.roofing, [part, z0, x1, z1], TOP, TOP + 0.3);
    const dz0 = S.door.z - S.door.width / 2, dz1 = S.door.z + S.door.width / 2;
    slab(b, M.concreteDry, [part, t0, s0, dz0], 0, TOP);
    slab(b, M.concreteDry, [part, dz1, s0, t1], 0, TOP);
    slab(b, M.concreteDry, [part, dz0, s0, dz1], F + S.door.height, RF);                     // between the two doors: the roof door's sill
    slab(b, M.concreteDry, [part, dz0, s0, dz1], RF + S.door.height, TOP);
    slab(b, M.relayFloor, [part, dz0, s0, dz1], -0.2, F);
    slab(b, M.relayFloor, [s0, t0, s1, t1], -0.2, F);

    // ---- the stairs: flight A climbs north along the west side to a landing at half height, flight B back south
    const mid = RF / 2, xa = [s0, s0 + S.width], xb = [s1 - S.width, s1], landN = S.foot - (S.risers - 1) * S.tread;
    for (let i = 0; i < S.risers - 1; i++) {
      slab(b, M.concreteDry, [xa[0], S.foot - (i + 1) * S.tread, xa[1], S.foot - i * S.tread], 0, (i + 1) * S.rise);
      slab(b, M.concreteDry, [xb[0], landN + i * S.tread, xb[1], landN + (i + 1) * S.tread], 0, mid + (i + 1) * S.rise);
    }
    slab(b, M.concreteDry, [s0, t0, s1, landN], 0, mid);                                  // the half landing (cast concrete, as the flights)
    slab(b, M.concreteDry, [s0, S.foot, s1, t1], RF - 0.2, RF);                           // the top landing, over the way in
    slab(b, M.concreteDry, [xa[1], landN, xb[0], S.foot], 0, TOP);                           // the spine wall between the flights
    slab(b, M.yellow, [xa[0], S.foot - 0.2, xa[1], S.foot], RF, RF + 1.1);                // a guard at the top landing's open edge: hazard-striped painted steel
    // hand rails (decor) on the outer walls
    for (const [xr, zA, zB, yA, yB] of [[s0 + 0.06, S.foot, landN, 0.95, mid + 0.95], [s1 - 0.06, landN, S.foot, mid + 0.95, RF + 0.95]]) {
      fx.add(geom.taperedTube([[xr, yA, zA], [xr, yB, zB]], [0.025, 0.025], { radial: 6 }), M.steel);
    }

    // ---- the server room: two rows of racks with live fronts, a console desk, cable trays, floor strips
    const racks = [];
    for (const z of [-27.6, -24.6]) for (let x = x0 + T + 1.6; x < part - 4.2; x += 0.95) {
      if (z > -26 && Math.abs(x - P.door.x) < 1.6) continue;
      slab(b, M.rack, [x - 0.42, z - 0.5, x + 0.42, z + 0.5], F, F + 2.3, 0.02);
      // the front: a door frame with rack rails, drive sleds (printed), two handles, a status screen, LEDs (instanced, blinking)
      box([0.7, 1.9, 0.03], [x, F + 1.2, z + 0.515]);   // the old face's volume
      PK.put(pb, new THREE.PlaneGeometry(0.66, 1.5), PK.mats.paint, at([x, F + 1.05, z + 0.505]), [1.1, 1.1, 1.15], PK.R.drives);
      PK.put(pb, new THREE.PlaneGeometry(0.26, 0.12), Math.round(x * 3) % 4 === 0 ? M.screenAmber : M.screenCyan, at([x - 0.15, F + 1.98, z + 0.506]));
      for (const sx of [-1, 1]) {
        PK.put(pb, new THREE.BoxGeometry(0.05, 2.2, 0.03), PK.mats.metal, at([x + sx * 0.37, F + 1.15, z + 0.51]), [0.12, 0.12, 0.13]);
        PK.put(pb, new THREE.BoxGeometry(0.02, 0.22, 0.03), PK.mats.metal, at([x + sx * 0.3, F + 1.15, z + 0.53]), [0.5, 0.5, 0.52]);
      }
      PK.put(pb, new THREE.PlaneGeometry(0.62, 0.1), PK.mats.paint, at([x, F + 0.2, z + 0.505]), [1, 1, 1], PK.R.vent);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) if ((r * 4 + c + Math.round(x * 7)) % 3 !== 0) leds.push(at([x - 0.33 + 0.165 * (c + 0.5) + 0.05, F + 1.05 - 0.75 + 1.5 * (r + 0.5) / 8 + 0.04, z + 0.507]));
      // a loom of cables from its top up into the tray
      for (let k = 0; k < (D > 0.6 ? 3 : 1); k++) { const ox = -0.2 + k * 0.2; PK.put(pb, geom.taperedTube([[x + ox, F + 2.3, z - 0.2], [x + ox, F + 2.6, z - 0.15 + k * 0.05], [x + ox * 0.5, H - 0.42, z + 0.05 * k]], [0.018, 0.02, 0.02], { radial: 4, segments: 6 }), PK.mats.paint, null, [[0.02, 0.02, 0.02], [0.02, 0.06, 0.15], [0.12, 0.08, 0.01]][k]); }
      racks.push([x, z]);
    }
    for (const z of [-27.6, -24.6]) fx.box(M.darkMetal, [part - x0 - 4, 0.08, 0.5], [(x0 + part) / 2 - 0.6, H - 0.4, z]);         // trays
    for (const z of [-26.1, -22.9]) fx.box(M.neon.cyan, [part - x0 - 3, 0.012, 0.05], [(x0 + part) / 2 - 0.4, F + 0.008, z]);     // floor strips
    slab(b, M.rack, [part - 3.4, -29.2, part - 0.5, -28.4], F, F + 0.95, 0.03);                                                   // the desk
    b.add(new THREE.BoxGeometry(2.4, 0.9, 0.04).rotateX(-0.25), M.screenPink, geom.compose([part - 1.95, F + 1.5, -29.15]));
    // the desk's top: two keyboards with keys, a trackball, a mug, a stack of papers; a chair
    for (const dx of [-0.75, 0.55]) { PK.put(pb, new geom.RoundedBoxGeometry(0.5, 0.025, 0.18, 1, 0.008), PK.mats.paint, at([part - 1.95 + dx, F + 0.965, -28.65], [0.06, 0, 0]), [0.03, 0.032, 0.036]); PK.put(pb, new THREE.PlaneGeometry(0.46, 0.15).rotateX(-Math.PI / 2 + 0.06), PK.mats.glow, at([part - 1.95 + dx, F + 0.979, -28.65]), [0.5, 0.65, 0.8], PK.R.keys); }
    PK.put(pb, new THREE.SphereGeometry(0.03, 10, 8), PK.mats.metal, at([part - 1.0, F + 0.97, -28.65]), [0.1, 0.4, 0.6]);
    PK.put(pb, new THREE.CylinderGeometry(0.04, 0.036, 0.1, 12), PK.mats.paint, at([part - 3.0, F + 1.0, -28.7]), [0.8, 0.78, 0.7]);
    for (let i = 0; i < 6; i++) PK.put(pb, new THREE.BoxGeometry(0.21, 0.004, 0.3), PK.mats.paint, at([part - 2.6, F + 0.955 + i * 0.005, -28.75], [0, i * 0.08, 0]), [0.85, 0.85, 0.8]);
    PK.put(pb, new geom.RoundedBoxGeometry(0.5, 0.08, 0.5, 2, 0.03), PK.mats.paint, at([part - 1.9, F + 0.5, -27.9]), [0.05, 0.05, 0.06]);
    PK.put(pb, new geom.RoundedBoxGeometry(0.48, 0.55, 0.07, 2, 0.03), PK.mats.paint, at([part - 1.9, F + 0.85, -27.62], [-0.15, 0, 0]), [0.05, 0.05, 0.06]);
    PK.put(pb, new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), PK.mats.metal, at([part - 1.9, F + 0.25, -27.9]), [0.3, 0.3, 0.32]);
    for (let i = 0; i < 5; i++) { const a = i * 1.2566; PK.put(pb, new THREE.BoxGeometry(0.3, 0.03, 0.04), PK.mats.metal, at([part - 1.9 + Math.cos(a) * 0.15, F + 0.05, -27.9 + Math.sin(a) * 0.15], [0, -a, 0]), [0.2, 0.2, 0.22]); }
    // perforated tiles in the aisles (the raised floor's cold air)
    for (let x = x0 + T + 2.0; x < part - 4.5; x += 2.4) PK.put(pb, new THREE.PlaneGeometry(0.58, 0.58).rotateX(-Math.PI / 2), PK.mats.paint, at([x, F + 0.003, -26.1]), [0.6, 0.62, 0.66], PK.R.vent);
    for (const [x, z, s] of [[x0 + 1.2, -21.4, 0.8], [x0 + 1.25, -22.3, 0.6], [part - 0.9, -24.2, 0.8]]) { const rg = track(pb, () => crate(PK, pb, geom, at([x, F, z], [0, 0.2, 0], [1 / 1.2, 1, 1]), s, [0.1, 0.13, 0.11], 0)); const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s)); c.applyMatrix4(at([x, F + s / 2, z], [0, 0.2, 0])); ctx.collider(c); rec.add({ id: `relay-crate-${x}-${z}`, fam: 'crate', box: { center: [x, F + s / 2, z], half: [s / 2, s / 2, s / 2], yaw: 0.2 }, parts: [[pb, rg, 'draw']], proxies: [c] }); }
    const strobe = lamp(ctx, { indoor: true, live: true, pos: [P.door.x, H - 0.45, z1 - T - 0.5], color: 0xff1808, intensity: 3, range: 7 });
    beacon(PK, pb, geom, [P.door.x, H - 0.4, z1 - T - 0.2], [1, 0.08, 0.04], 4, 0.07);
    PK.put(pb, new THREE.BoxGeometry(0.04, 0.3, 0.04), PK.mats.metal, at([P.door.x, H - 0.25, z1 - T - 0.2]), [0.1, 0.1, 0.11]);
    for (const [x, z, sh] of [[x0 + 4, -23.6, true], [x0 + 10, -26.2, false], [part - 3, -23.4, false]]) {
      tubeFixture(PK, pb, geom, at([x, H - 0.3, z]), 1.6, M.NEON.cyan, 4, 0.18);
      lamp(ctx, { indoor: true, pos: [x, H - 0.5, z], color: 0x8fdcff, intensity: 3.2, range: 8, shadow: sh });
    }

    // ---- stairwell lights: one over each landing
    tubeFixture(PK, pb, geom, at([(s0 + s1) / 2, mid + 2.58, t0 + 0.3]), 0.9, M.NEON.white, 5);
    const lampA = lamp(ctx, { indoor: true, live: true, pos: [(s0 + s1) / 2, mid + 2.3, t0 + 0.7], color: 0xcfe6ff, intensity: 5, range: 8, shadow: true });
    tubeFixture(PK, pb, geom, at([(s0 + s1) / 2, TOP - 0.06, t1 - 0.4]), 0.9, M.NEON.amber, 5);
    lamp(ctx, { indoor: true, pos: [(s0 + s1) / 2, TOP - 0.5, t1 - 0.8], color: 0xffa040, intensity: 4.5, range: 8 });
    tubeFixture(PK, pb, geom, at([s0 + 1.25, RF - 0.25, t1 - 0.5]), 0.7, M.NEON.white, 5);
    lamp(ctx, { indoor: true, pos: [s0 + 1.25, 3.0, t1 - 0.8], color: 0xcfe6ff, intensity: 11, range: 9 });
    fx.box(M.neon.cyan, [0.03, 0.04, t1 - S.foot - 0.3], [s1 - 0.02, F + 1.0, (t1 + S.foot) / 2]);
    // caged bulkheads on the walls, one per landing and one over each flight (4000 K): no step of the stairwell is in
    // the dark, the landings stay brighter than the flights
    for (const [x, y, z, ry, k] of [[s1 - 0.02, F + 2.25, (t1 + S.foot) / 2 - 0.35, -Math.PI / 2, 4], [s0 + 0.02, mid / 2 + 1.9, (S.foot + landN) / 2, Math.PI / 2, 3],
      [s0 + 0.02, mid + 1.95, (t0 + landN) / 2, Math.PI / 2, 4], [s1 - 0.02, mid + mid / 2 + 1.9, (S.foot + landN) / 2, -Math.PI / 2, 3], [s1 - 0.02, RF + 2.0, (t1 + S.foot) / 2 - 0.35, -Math.PI / 2, 4]]) {
      bulkhead(PK, pb, geom, at([x, y, z], [0, ry, 0]), [1, 0.92, 0.8], 3);
      lamp(ctx, { indoor: true, pos: [x + Math.sin(ry) * 0.35, y - 0.1, z], color: 0xfff0dc, intensity: k, range: 6.5 });
    }
    lamp(ctx, { indoor: true, pos: [s1 - 0.6, F + 1.2, (t1 + S.foot) / 2], color: 0x30d8ff, intensity: 4, range: 6 });

    // ---- the roof: plant, pipes, a mast, dishes, the uplink console
    for (const [x, z, len, h] of plan.roofUnits) {
      b.box(M.sheet, [len, h, 1.2], [x, RF + h / 2, z], [0, 0, 0], 0.04);
      fx.cylinder(M.blackMetal, 0.42, 0.42, 0.04, [x - len * 0.2, RF + h + 0.02, z], [0, 0, 0], 20);
      fx.cylinder(M.blackMetal, 0.42, 0.42, 0.04, [x + len * 0.25, RF + h + 0.02, z], [0, 0, 0], 20);
    }
    fx.add(geom.taperedTube([[x0 + 1, RF + 0.2, z0 + 1.1], [part - 4, RF + 0.2, z0 + 1.1], [part - 3.2, RF + 0.2, z0 + 2.6]], [0.1, 0.1, 0.1], { radial: 8 }), M.sheet);
    const mast = [x0 + 1.6, z0 + 1.7], mh = 9.5;
    b.cylinder(M.darkMetal, 0.07, 0.16, mh, [mast[0], RF + mh / 2, mast[1]], [0, 0, 0], 10);
    for (const t of [0.3, 0.52, 0.74, 0.92]) fx.box(M.darkMetal, [1.6 * (1.1 - t), 0.05, 0.05], [mast[0], RF + mh * t, mast[1]], [0, t * 4, 0]);
    const pm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3, 0.34)); pm.position.set(mast[0], RF + 1.5, mast[1]); ctx.collider(pm);
    const dish = geom.lathe([[0.02, 0], [0.3, 0.05], [0.55, 0.17], [0.7, 0.34]], 20);
    for (const [x, z, ry, rx] of [[x0 + 3.4, z0 + 1.4, 0.4, 1.0], [part - 1.4, z0 + 1.2, -0.7, 0.8]]) {
      fx.add(dish, M.sheet, geom.compose([x, RF + 1.5, z], [rx, ry, 0]));
      b.cylinder(M.darkMetal, 0.05, 0.07, 1.4, [x, RF + 0.7, z], [0, 0, 0], 8);
    }
    // a line of light inside the parapet, and one round the stair head's door
    fx.box(M.neon.cyan, [part - x0 - 1.2, 0.04, 0.03], [(x0 + part) / 2, RF + 0.5, z1 - T - 0.02]);
    fx.box(M.neon.pink, [0.03, 0.04, z1 - z0 - 1.4], [x0 + T + 0.02, RF + 0.5, (z0 + z1) / 2]);
    lamp(ctx, { pos: [(x0 + part) / 2, RF + 0.8, z1 - T - 0.6], color: 0x30d8ff, intensity: 3, range: 9 });
    lamp(ctx, { pos: [x0 + T + 0.6, RF + 0.8, (z0 + z1) / 2], color: 0xff3090, intensity: 3, range: 9 });
    const [ux, uy, uz] = P.uplink;
    b.add(new geom.RoundedBoxGeometry(1.5, 1.05, 0.7, 2, 0.04), M.rack, geom.compose([ux, uy + 0.525, uz]));
    b.add(new THREE.BoxGeometry(1.3, 0.62, 0.04).rotateX(-0.5), M.screenCyan, geom.compose([ux, uy + 1.22, uz + 0.1]));
    lamp(ctx, { pos: [ux, uy + 1.5, uz + 0.9], color: 0x40d8ff, intensity: 4, range: 7 });
    for (const [x, z] of [[x0 + 6, z1 - 1.6], [part - 2.4, z0 + 2.6]]) {   // two work lights on short posts
      b.cylinder(M.darkMetal, 0.04, 0.05, 2.2, [x, RF + 1.1, z], [0, 0, 0], 8);
      floodlight(PK, pb, geom, at([x, RF + 2.3, z], [0, Math.atan2(18 - x, -24 - z), 0]), [1.0, 0.62, 0.25], 6, 0.5);
      lamp(ctx, { pos: [x, RF + 2.1, z], color: 0xffa040, intensity: 6, range: 12, shadow: x < 15, vol: true });
    }
    root.add(b.finish({ name: 'relay' }));
    if (leds.length) {   // rack LEDs: one instanced mesh, each blinking on its own rhythm (the scene clock)
      const ledMat = ctx.mat.patch(new THREE.MeshBasicMaterial({ color: 0xffffff }), {
        vertexDecl: 'varying float ndBlink; varying vec3 ndLedC;',
        vertexWorld: `#ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3]); float h = fract(sin(dot(ip, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          ndBlink = step(0.35, fract(uTime * (0.4 + 3.0 * h) + h * 7.0)); ndLedC = h < 0.7 ? vec3(0.2, 1.0, 0.4) : h < 0.9 ? vec3(0.2, 0.7, 1.0) : vec3(1.0, 0.6, 0.1);
        #endif`,
        fragmentDecl: 'varying float ndBlink; varying vec3 ndLedC;',
        output: 'outgoingLight = ndLedC * (0.4 + 5.0 * ndBlink) * max(uLampGain, 0.5);',
      });
      const lm = geom.instances(new THREE.BoxGeometry(0.008, 0.008, 0.004), ledMat, leds, { castShadow: false, receiveShadow: false });
      lm.name = 'rack-leds'; root.add(decor(lm));
    }
    root.add(decor(fx.finish({ name: 'relay-decor', castShadow: false })), decor(rec.finished(pb, pb.finish({ name: 'relay-props', castShadow: false }))));
    return { strobe, lampA, mast: [mast[0], RF + mh + 0.12, mast[1]], racks };
  },
  anchors: (ctx, built) => {
    const P = ctx.plan.relay, [x0, , , z1] = P.rect, F = ctx.plan.levels.floor;
    return {
      doors: [{ pos: [P.door.x, F, z1 - P.wall / 2], rotY: 0, width: P.door.width, height: P.door.height, leaves: 2, swing: 1.5 }],
      signs: [{ pos: [x0 + 8.5, P.height + 1.25, z1 + 0.01], rotY: 0, w: 6.2, h: 1.4, text: 'RELAY·7', color: 'cyan', kind: 'board' }],
      beacons: [{ pos: built.mast, rotY: 0 }],
      consoles: [{ pos: [P.uplink[0], P.uplink[1] + 1.2, P.uplink[2] + 0.4], rotY: 0 }],
      strobes: [{ pos: built.strobe.position.toArray(), rotY: 0, light: built.strobe }, { pos: built.lampA.position.toArray(), rotY: 0, light: built.lampA, flicker: true }],
    };
  },
  ambientVolumes: (ctx) => {
    const P = ctx.plan.relay, [x0, z0, x1, z1] = P.rect;
    return [{ min: [x0, 0, z0], max: [P.room[2], P.height, z1], factor: 0.22, soft: 0.6 }, { min: [P.room[2], 0, z0], max: [x1, P.stair.top, z1], factor: 0.4, soft: 0.5 }];
  },
};
