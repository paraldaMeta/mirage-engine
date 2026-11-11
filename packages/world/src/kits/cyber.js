// Mirage original code. The cyber kit: a library of street props for a dense, rain-wet neon city, all made in code (no
// model or image files: every shape is three.js geometry, every printed label, menu and number plate is drawn into a
// canvas at start-up). Grown out of examples/neon-district, which builds its whole district from it.
//
//   import { propKit, paperLantern, streetLamp, bin, parkedCars, buildMachines } from '@miragekit/world/kits/cyber';
//   build(ctx) {
//     const P = propKit(ctx), b = new ctx.geom.MeshBatch();            // P: { R (atlas rects), mats, put, instanced, texture }
//     paperLantern(P, b, ctx.geom, [0, 3, 0], { print: 1 });           // most builders: (P, batch, geom, matrix | position, opts)
//     bin(P, b, ctx.geom, ctx.geom.compose([2, 0, 1], [0, 0.4, 0]));
//     ctx.root.add(b.finish({ name: 'props' }));
//   }
//
// What is in it (each file's header says more):
//   kit.js         propKit(ctx): the shared label atlas (cans, bottles, cartons, snacks, price tags, stickers, warnings,
//                  stencils, plates, menus, lantern paper, tyre walls...) and the six materials that read it; put()
//                  fits a geometry into an atlas cell and tints it so a whole module merges into one draw per material
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
//   robots.js      buildMachines(ctx, spec): civilian robots (androids with umbrellas, vendors, couriers, sweepers,
//                  notice totems, broken ones), animated, three draws for all of them
//   surfaces.js    corrugated sheet, canopies, worn painted metal, shop interiors behind glass, text atlases
//
// All brands, names and plates are invented. Text is English, Traditional Chinese and Japanese (the fonts of the
// system: PingFang / Hiragino / Noto). Needs a DOM canvas (a browser or a worker with OffscreenCanvas is not enough:
// document.createElement is used).
export { propKit, uvRect, tint, uvByHeight, hex } from './cyber/kit.js';
export { canGeo, bottleGeo, wineGeo, cupGeo, boxGeo, packGeo, capsuleGeo, spiralGeo, glassGeo, bowlGeo, jarGeo } from './cyber/shapes.js';
export { spiritBottle, tumbler, bowls, pot, noodleBasket, riceCooker, chopsticks, skewers, stool, goodsBox, jar, goodsRack } from './cyber/goods.js';
export { paperLantern, bulbString, streetLamp, bulkhead, tubeFixture, floodlight, beacon, signalHead } from './cyber/lights.js';
export { bin, crate, bag, cardboard, acUnit, junctionBox, bollard, jersey, newsBox, bench } from './cyber/street.js';
export { parkedCars, carMaterials, CAR_DESIGNS } from './cyber/cars.js';
export { rainBeads } from './cyber/rain-beads.js';
export { buildMachines, FACES, androidParts, androidFace } from './cyber/robots.js';
export { corrugated, canopy, WORN_DECL, worn, interiorMaterial, textAtlas, atlasQuad } from './cyber/surfaces.js';
