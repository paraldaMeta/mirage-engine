// Mirage original code. Step time of the physics kit in Node: piles of 500 / 2000 / 5000 boxes and 20 ragdolls
// dropped on one spot. Not part of `npm test`; run it by hand:   node packages/game/physics-bench.mjs [rounds=3]
// The scenarios are run interleaved, round after round, and each line gives the median of the rounds with the
// lowest and highest round. 'falling' is the median step of the first 3 s (everything awake and colliding),
// 'worst' the slowest single step, 'late' the median step of the last second of 10 (asleep by then, or still a moving heap: see 'awake').
import * as THREE from 'three';
import { createPhysics } from './src/physics.js';
import { createPhysicsKit } from './src/physics-kit.js';
import { createRagdoll } from './src/ragdoll.js';
import { createRigModel } from '@mirage/play/rig-model';

const rounds = +process.argv[2] || 3, STEPS = 600, M = new THREE.MeshBasicMaterial();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

async function scene() {
  const sc = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(200, 1, 200), M); floor.position.y = -0.5; sc.add(floor);
  const phys = await createPhysics(sc); phys.addStatic(sc);
  return { sc, phys, kit: createPhysicsKit(phys, { layers: ['default', 'rag'], interpolate: false }) };
}
function time(kit, each) {
  const t = [];
  for (let i = 0; i < STEPS; i++) { const t0 = performance.now(); kit.advance(1 / 60); each?.(); t.push(performance.now() - t0); }
  const s = kit.stats();
  return { falling: med(t.slice(0, 180)), worst: Math.max(...t), resting: med(t.slice(-60)), awake: s.awake, bodies: s.dynamic };
}
async function boxes(n) {
  const { phys, kit } = await scene();
  // a loose column 10 x 10 wide: it collapses into a heap
  for (let i = 0; i < n; i++) {
    const x = (i % 10) - 4.5, z = (Math.floor(i / 10) % 10) - 4.5, y = 0.6 + Math.floor(i / 100) * 1.1;
    kit.rigid(null, { shape: 'box', half: [0.4, 0.4, 0.4], pos: [x * 1.05 + (i % 7) * 0.01, y, z * 1.05 + (i % 5) * 0.01], material: 'wood' });
  }
  const r = time(kit); kit.dispose(); phys.dispose?.(); return r;
}
async function ragdolls(n) {
  const { sc, phys, kit } = await scene();
  const rags = [];
  for (let i = 0; i < n; i++) {
    const rig = createRigModel(); sc.add(rig.root);
    rig.root.position.set((i % 3) * 0.3 - 0.3, 1 + i * 2.2, (i % 2) * 0.3); rig.root.rotation.set(0.4 * (i % 4), i, 0.2 * (i % 3));
    const rag = createRagdoll(kit, rig.root, { layer: 'rag', settle: {} }); rag.ragdoll(); rags.push(rag);
  }
  const r = time(kit, () => { for (const g of rags) g.update(1 / 60); });
  kit.dispose(); phys.dispose?.(); return r;
}

const cases = [['500 boxes', () => boxes(500)], ['2000 boxes', () => boxes(2000)], ['5000 boxes', () => boxes(5000)], ['20 ragdolls', () => ragdolls(20)]];
const out = cases.map(() => []);
await boxes(200);   // warm the WASM and the JIT
for (let r = 0; r < rounds; r++) for (let c = 0; c < cases.length; c++) out[c].push(await cases[c][1]());
const col = (rs, k) => { const v = rs.map((x) => x[k]); return `${med(v).toFixed(2)} (${Math.min(...v).toFixed(2)}-${Math.max(...v).toFixed(2)})`; };
console.log(`node ${process.version}, ${rounds} rounds interleaved, ms per 1/60 s step: median of rounds (lowest-highest)`);
for (let c = 0; c < cases.length; c++) {
  const rs = out[c];
  console.log(`${cases[c][0].padEnd(12)} falling ${col(rs, 'falling')}  worst ${col(rs, 'worst')}  late ${col(rs, 'resting')}  awake at the end ${rs.map((x) => x.awake).join('/')} of ${rs[0].bodies}`);
}
