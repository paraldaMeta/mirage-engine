#!/usr/bin/env node
// The strip reserved for the water channel (plan.js waterStrip) at the golden hour: is it in the sun, and is it free?
// The game at ?time=day; from points 5 cm over the strip (every 0.5 m, three lines across it) a ray toward the sun
// through the physics world (buildings, props, parked cars: the colliders), then through every drawn shadow caster from
// the water's surface (signs, roofs, awnings), and vertical rays for anything standing on it. Prints the sun's direction and elevation too.
//   node scripts/strip-check.mjs [dist]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, open } from '../../../packages/tools/src/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../dist'));
const srv = await serve(dist), b = await launch({ w: 800, h: 500 });
const { page, errors } = await open(b, `${srv.url}?w=800&h=500&start=1&assist=1&quality=low&time=day`);
await new Promise((r) => setTimeout(r, 3000));
const r = await page.evaluate(() => {
  const m = window.__mirage, s = m.world.state.sun, d = s.dir, ph = m.g.physics, [x0, z0, x1, z1] = m.built.plan.waterStrip.rect;
  const lines = [];
  for (const z of [z0 + 0.05, (z0 + z1) / 2, z1 - 0.05]) {
    let lit = 0, n = 0; const shade = [];
    for (let x = x0; x <= x1 + 1e-6; x += 0.5) { const h = ph.ray([x, 0.05, z], [d[0], d[1], d[2]], 500); n++; if (!h) lit++; else shade.push(`${x}: ${h.distance.toFixed(1)} m`); }
    lines.push({ z: +z.toFixed(2), lit: `${lit}/${n}`, shade });
  }
  const on = [];
  for (let x = x0; x <= x1 + 1e-6; x += 0.25) for (const z of [z0, (z0 + z1) / 2, z1]) { const h = ph.ray([x, 3, z], [0, -1, 0], 3.2); if (h && h.point[1] > 0.05) on.push([x, z, +h.point[1].toFixed(2)]); }
  // and what the eye sees cast shadows (signs, roofs, awnings: not in the physics): a ray through every shadow caster
  const THREE = m.world.ctx.THREE, rc = new THREE.Raycaster(), casters = [], drawn = [];
  m.world.scene.traverse((o) => { if (o.isMesh && o.castShadow && o.visible) casters.push(o); });
  for (let x = x0; x <= x1 + 1e-6; x += 1) { rc.set(new THREE.Vector3(x, -0.2, (z0 + z1) / 2), new THREE.Vector3(d[0], d[1], d[2])); rc.far = 500; const h = rc.intersectObjects(casters, false)[0]; if (h) drawn.push(`${x}: ${h.object.name} at ${h.point.toArray().map((v) => v.toFixed(1))}`); }
  return { rect: [x0, z0, x1, z1], drawnShade: drawn, sun: { elevation: +s.elevation.toFixed(2), azimuth: +s.azimuth.toFixed(1), dir: d.map((v) => +v.toFixed(4)) }, lines, standing: on };
});
console.log(JSON.stringify(r, null, 1));
if (errors.length) console.log('page errors:', errors.slice(0, 3));
await b.close(); srv.close?.();
process.exit(0);
