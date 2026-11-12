// Mirage original code. The cyber kit: a library of street props for a dense, rain-wet neon city, all made in code (no
// model or image files: every shape is three.js geometry, every printed label, menu and number plate is drawn into a
// canvas at start-up). Grown out of examples/neon-district, which builds its whole district from it.
//
//   import { propKit, paperLantern, streetLamp, bin, parkedCars, buildMachines } from '@miragekit/assets/kits/cyber';
//   build(ctx) {
//     const P = propKit(ctx), b = new ctx.geom.MeshBatch();            // P: { R (atlas rects), mats, put, instanced, texture }
//     paperLantern(P, b, ctx.geom, [0, 3, 0], { print: 1 });           // most builders: (P, batch, geom, matrix | position, opts)
//     bin(P, b, ctx.geom, ctx.geom.compose([2, 0, 1], [0, 0.4, 0]));
//     ctx.root.add(b.finish({ name: 'props' }));
//   }
//
// What is in it (each file's header says more):
//   kit.js         propKit(ctx): the shared label atlas (cans, bottles, cartons, snacks, price tags, stickers, warnings,
//                  stencils, plates, menus, lantern paper, tyre walls...) and the materials that read it; put()
//                  fits a geometry into an atlas cell and tints it so a whole module merges into one draw per material;
//                  recorder / track / trackLamps: what a builder records for destructibles (vertex ranges, lamps)
//   surface-lib.js surfaceLib(ctx): core's surface library per world, bake sizes per quality, surf / painted / shade
//   shapes.js      product geometry: cans, PET bottles, wine bottles, cups, cartons, snack packs, capsules, spiral feeders,
//                  glasses, bowls, jars
//   goods.js       counter and shop goods: spirit bottles, tumblers, bowls, pots, noodle baskets, rice cookers, chopsticks,
//                  skewers, stools, shop boxes, jars, a goods rack
//   lights.js      fixtures: paper lanterns, bulb strings, street lamps, bulkheads, tube fixtures, floodlights, beacons,
//                  signal heads (only the lens or the paper glows; the light itself is the host's)
//   street.js      street furniture: bins, crates, bin bags, cardboard boxes, AC units, junction boxes, bollards, jersey
//                  barriers, news boxes, benches
//   cars.js        parkedCars(): three designs of an invented marque in brushed steel, pearlescent paint and tinted glass,
//                  with rain beads and running water
//   rain-beads.js  rainBeads(hooks, opts): water drops, runs and a film on any lit material (under core's wet layer)
//   robots.js      buildMachines(ctx, spec): civilian robots (domestic humanoids, some with umbrellas, rail and
//                  pedestal vendors, a robot-dog courier, a floor scrubber, a notice totem, a broken one), animated,
//                  four batched draws for all of them; machineUnits(group) lists each unit's instances
//   robot-kit.js   the robot parts kit: humanoid / quadruped bodies at three levels of detail, parts, decals, the
//                  robot materials, gaits and leg IK (the neon district's enemies are built from it too)
//   robot-rig.js   the robot kit's bodies skinned to @miragekit/play's rig (humanoidMeshes), walk / run / idle clips
//                  from its gait (robotClips, CLIP_SPEED), a robot dog on its own skeleton (createHound)
//   motion-clips.js borrowed motion capture for the rig (motionClips, samplePose: idle, walk, jog, crouch walk, a
//                  broken walk, hits, a death, a knockdown; Quaternius' Universal Animation Library, CC0, retargeted;
//                  motion-data.js says where from): the only data in the kit that was not made in code
//   surfaces.js    corrugated sheet, canopies, worn painted metal, shop interiors behind glass, text atlases
//
// All brands, names and plates are invented. Text is English, Traditional Chinese and Japanese (the fonts of the
// system: PingFang / Hiragino / Noto). Needs a DOM canvas (a browser or a worker with OffscreenCanvas is not enough:
// document.createElement is used).
export { propKit, uvRect, tint, uvByHeight, hex, breakables, markBatch, sinceMark, track, breakablesLamp, trackLamps, recorder } from './cyber/kit.js';
export { surfaceLib } from './cyber/surface-lib.js';
export { canGeo, bottleGeo, wineGeo, cupGeo, boxGeo, packGeo, capsuleGeo, spiralGeo, glassGeo, bowlGeo, jarGeo } from './cyber/shapes.js';
export { spiritBottle, tumbler, bowls, pot, noodleBasket, riceCooker, chopsticks, skewers, stool, goodsBox, jar, goodsRack, gasBottle, extinguisher } from './cyber/goods.js';
export { paperLantern, bulbString, streetLamp, bulkhead, tubeFixture, floodlight, beacon, signalHead } from './cyber/lights.js';
export { bin, crate, bag, cardboard, acUnit, junctionBox, bollard, jersey, newsBox, bench } from './cyber/street.js';
export { parkedCars, carMaterials, CAR_DESIGNS } from './cyber/cars.js';
export { rainBeads } from './cyber/rain-beads.js';
export { buildMachines, machineUnits } from './cyber/robots.js';
export { tf, decalTexture, decalUV, surfaceLib as robotSurfaces, robotMaterials, COL, part, mergeParts, moved, ext, drum, link, cover, cable, decal,
  JOINTS, LEN, humanoid, humanoidRig, quadrupedDims, quadruped, legIK, bipedLegs, GAITS, trotLegs } from './cyber/robot-kit.js';
export { humanoidMeshes, robotClips, CLIP_SPEED, createHound } from './cyber/robot-rig.js';
export { motionClips, samplePose, MOTION_BONES } from './cyber/motion-clips.js';
export { corrugated, canopy, WORN_DECL, worn, interiorMaterial, textAtlas, atlasQuad } from './cyber/surfaces.js';
