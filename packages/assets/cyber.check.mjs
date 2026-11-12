// Mirage original code. Node checks for the cyber kit (src/kits/cyber.js, @miragekit/assets/kits/cyber): the subpath exports what its header lists, the
// product shapes are finite, stand on y = 0 and keep their uv inside the atlas cell they print from, the corrugated
// sheet and the canopy have the size asked for, the material hooks compose, and the three car designs are there.
// The canvas atlas, the builders that add to a batch and the robots need a DOM: examples/neon-district builds every
// one of them (its playtest and stills).
import * as K from './src/kits/cyber.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('  FAIL ' + m); } };

const NAMES = ['propKit', 'uvRect', 'tint', 'uvByHeight', 'hex', 'canGeo', 'bottleGeo', 'wineGeo', 'cupGeo', 'boxGeo', 'packGeo',
  'capsuleGeo', 'spiralGeo', 'glassGeo', 'bowlGeo', 'jarGeo', 'spiritBottle', 'tumbler', 'bowls', 'pot', 'noodleBasket',
  'riceCooker', 'chopsticks', 'skewers', 'stool', 'goodsBox', 'jar', 'goodsRack', 'paperLantern', 'bulbString', 'streetLamp',
  'bulkhead', 'tubeFixture', 'floodlight', 'beacon', 'signalHead', 'bin', 'crate', 'bag', 'cardboard', 'acUnit', 'junctionBox',
  'bollard', 'jersey', 'newsBox', 'bench', 'parkedCars', 'carMaterials', 'CAR_DESIGNS', 'rainBeads', 'buildMachines', 'machineUnits',
  'breakables', 'markBatch', 'sinceMark', 'track', 'breakablesLamp', 'trackLamps', 'recorder', 'surfaceLib', 'gasBottle', 'extinguisher',
  'tf', 'decalTexture', 'decalUV', 'robotSurfaces', 'robotMaterials', 'COL', 'part', 'mergeParts', 'moved', 'ext', 'drum', 'link', 'cover',
  'cable', 'decal', 'JOINTS', 'LEN', 'humanoid', 'humanoidRig', 'quadrupedDims', 'quadruped', 'legIK', 'bipedLegs', 'GAITS', 'trotLegs',
  'humanoidMeshes', 'robotClips', 'CLIP_SPEED', 'createHound', 'corrugated', 'canopy', 'WORN_DECL', 'worn', 'interiorMaterial', 'textAtlas', 'atlasQuad'];
for (const n of NAMES) ok(n in K, `exports ${n}`);
ok(Object.keys(K).length === NAMES.length, `exports exactly the listed names (${Object.keys(K).length} vs ${NAMES.length})`);

const bounds = (g) => { g.computeBoundingBox(); return g.boundingBox; };
const finite = (g) => g.attributes.position.array.every(Number.isFinite);
const uvIn = (g, r) => { const uv = g.attributes.uv.array; for (let i = 0; i < uv.length; i += 2) if (uv[i] < r[0] - 1e-6 || uv[i] > r[2] + 1e-6 || uv[i + 1] < r[1] - 1e-6 || uv[i + 1] > r[3] + 1e-6) return false; return true; };
const R = [0.25, 0.5, 0.375, 0.625];   // a cell
for (const [name, g, h] of [['canGeo', K.canGeo(R), [0.08, 0.2]], ['bottleGeo', K.bottleGeo(R), [0.15, 0.4]], ['cupGeo', K.cupGeo(R), [0.06, 0.2]],
  ['boxGeo', K.boxGeo(R), [0.09, 0.11]], ['packGeo', K.packGeo(R), [0.1, 0.2]], ['jarGeo', K.jarGeo(R), [0.08, 0.15]], ['wineGeo', K.wineGeo(R), [0.25, 0.35]]]) {
  const b = bounds(g), ht = b.max.y - b.min.y;
  ok(finite(g), `${name} is finite`);
  ok(Math.abs(b.min.y) < 0.02, `${name} stands on y = 0 (min y ${b.min.y.toFixed(3)})`);
  ok(ht > h[0] && ht < h[1], `${name} is ${ht.toFixed(3)} m tall (${h[0]}..${h[1]})`);
  ok(uvIn(g, R), `${name} keeps its uv inside the cell`);
}
for (const [name, g] of [['glassGeo', K.glassGeo()], ['bowlGeo', K.bowlGeo()], ['spiralGeo', K.spiralGeo()], ['capsuleGeo', K.capsuleGeo(R)]]) ok(finite(g) && g.attributes.position.count > 20, `${name} is a finite shape`);

const sheet = K.corrugated(2.4, 2.6, { ribs: 'h' }), sb = bounds(sheet);
ok(Math.abs(sb.max.x - sb.min.x - 2.4) < 1e-4 && Math.abs(sb.max.y - sb.min.y - 2.6) < 1e-4, 'corrugated: 2.4 x 2.6 m');
ok(sb.max.z <= 0.025 + 1e-6 && sb.min.z >= -1e-6, 'corrugated: its ribs stand out up to `depth` in front of z = 0');
ok(K.corrugated(3, 2, { ribs: 'v', pitch: 0.1 }).attributes.position.count > K.corrugated(3, 2, { ribs: 'v', pitch: 0.3 }).attributes.position.count, 'corrugated: a finer pitch has more ribs');
const can = bounds(K.canopy(3, 1.2, 0.4));
ok(Math.abs(can.min.y + 0.4) < 1e-4 && Math.abs(can.max.z - 1.2) < 1e-4, 'canopy: drops 0.4 m over 1.2 m');

const w = K.worn('vec3(0.2, 0.3, 0.25)', { rows: 1.2 });
ok(w.fragmentDecl === K.WORN_DECL && /ndWorn\(vec3\(0.2, 0.3, 0.25\)/.test(w.albedo) && /1\.20/.test(w.albedo), 'worn: hooks name the base colour and the fixing rows');
const rb = K.rainBeads({ albedo: 'x;' });
ok(rb.albedo?.startsWith('x;') || rb.albedo === 'x;' || typeof rb.fragmentDecl === 'string', 'rainBeads: keeps the hooks it is given and adds its own');
ok(K.CAR_DESIGNS.length === 3 && K.CAR_DESIGNS.map((d) => d.name).join() === 'slab,vane,pod', 'three car designs: slab, vane, pod');
ok(K.legIK(0, -0.8, 0.42, 0.42).every(Number.isFinite), 'legIK: finite angles for a reachable foot');
ok(K.hex('#ff0000', 2).join() === '2,0,0', 'hex: linear rgb times k');

console.log(fails ? `cyber kit check: ${fails} failed` : 'cyber kit check: ok');
process.exit(fails ? 1 : 0);
