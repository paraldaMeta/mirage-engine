// Experiment: gait numbers for a clip on createRigModel's skeleton (rest rotations identity, +Z forward, metres).
//   foot slide   horizontal speed of a planted foot's lowest point (heel, ball or toe tip), cm/s
//   planted      that point within 2 cm of the lowest any foot point reaches over the cycle
//   knee         flexion = angle between thigh and shin directions, degrees (0 = straight)
//   bob          Hips world height range over the cycle, cm
import * as THREE from 'three';

// points on the sole, in the bone's frame (the rig's foot block: heel at z -0.07, toe tip at z 0.2, sole y 0)
const POINTS = [['Foot', [0, -0.08, -0.07], 'heel'], ['Toe', [0, -0.02, 0], 'ball'], ['Toe', [0, -0.02, 0.07], 'tip']];

/** samples one cycle; returns per-frame feet / knees / hips and the summary */
export function gaitMetrics(rigRoot, clip, { hz = 120, plantTol = 0.02, travel = true } = {}) {
  const saved = [];
  rigRoot.traverse((o) => { if (o.isBone) saved.push({ o, p: o.position.clone(), q: o.quaternion.clone() }); });
  const mixer = new THREE.AnimationMixer(rigRoot), act = mixer.clipAction(clip);
  act.play();
  const bone = (n) => rigRoot.getObjectByName(n), v = new THREE.Vector3(), N = Math.max(2, Math.round(clip.duration * hz));
  const root = bone('Root'), hips = bone('Hips');
  const frames = [];
  for (let i = 0; i < N; i++) {
    mixer.setTime((i / N) * clip.duration);
    if (!travel) root.position.set(0, 0, 0);
    rigRoot.updateMatrixWorld(true);
    const f = { feet: {}, knee: {}, hipY: hips.getWorldPosition(v).y };
    for (const s of ['Left', 'Right']) {
      f.feet[s] = POINTS.map(([b, off, name]) => ({ name, p: new THREE.Vector3(...off).applyMatrix4(bone(s + b).matrixWorld) }));
      const a = bone(s + 'UpLeg').getWorldPosition(new THREE.Vector3()), k = bone(s + 'Leg').getWorldPosition(new THREE.Vector3()), an = bone(s + 'Foot').getWorldPosition(new THREE.Vector3());
      f.knee[s] = THREE.MathUtils.radToDeg(k.clone().sub(a).angleTo(an.clone().sub(k)));
    }
    frames.push(f);
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rigRoot);
  for (const s of saved) { s.o.position.copy(s.p); s.o.quaternion.copy(s.q); }
  rigRoot.updateMatrixWorld(true);
  let ground = Infinity;
  for (const f of frames) for (const s of ['Left', 'Right']) for (const p of f.feet[s]) ground = Math.min(ground, p.p.y);
  const dt = clip.duration / N, slides = [], vz = [];
  let planted = 0;
  for (let i = 1; i < N; i++) for (const s of ['Left', 'Right']) {
    const a = frames[i - 1].feet[s], b = frames[i].feet[s];
    const la = a.reduce((m, p) => (p.p.y < m.p.y ? p : m)), lb = b.reduce((m, p) => (p.p.y < m.p.y ? p : m));
    if (la.p.y > ground + plantTol || lb.p.y > ground + plantTol) continue;
    planted++;
    // the point that is lowest now, compared with itself a frame ago
    const prev = a.find((p) => p.name === lb.name).p;
    slides.push(Math.hypot(lb.p.x - prev.x, lb.p.z - prev.z) / dt * 100);
    vz.push((lb.p.z - prev.z) / dt);
  }
  // foot-down moments: a foot's lowest point reaching the ground band (for footL / footR events)
  const downs = [];
  for (const s of ['Left', 'Right']) {
    const low = (f) => Math.min(...f.feet[s].map((p) => p.p.y)) <= ground + plantTol;
    for (let i = 0; i < N; i++) if (low(frames[i]) && !low(frames[(i - 1 + N) % N])) downs.push({ time: +(i * dt).toFixed(3), name: s === 'Left' ? 'footL' : 'footR' });
  }
  downs.sort((a, b) => a.time - b.time);
  slides.sort((x, y) => x - y);
  const kneeAll = (s) => frames.map((f) => f.knee[s]);
  const hy = frames.map((f) => f.hipY);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return {
    slideMean: +mean(slides).toFixed(1), slideMedian: +(slides[slides.length >> 1] ?? 0).toFixed(1), lockedFrac: +(slides.filter((x) => x < 10).length / Math.max(1, slides.length)).toFixed(2), slideP95: +(slides[Math.floor(slides.length * 0.95)] ?? 0).toFixed(1), slidePeak: +(slides[slides.length - 1] ?? 0).toFixed(1),
    plantedFrac: +(planted / (2 * (N - 1))).toFixed(2), plantedVz: +mean(vz).toFixed(3), plantedVzMedian: +([...vz].sort((x, y) => x - y)[vz.length >> 1] ?? 0).toFixed(3),
    kneeL: [Math.min(...kneeAll('Left')), Math.max(...kneeAll('Left'))].map((x) => +x.toFixed(1)),
    kneeR: [Math.min(...kneeAll('Right')), Math.max(...kneeAll('Right'))].map((x) => +x.toFixed(1)),
    bobCm: +((Math.max(...hy) - Math.min(...hy)) * 100).toFixed(1), groundCm: +(ground * 100).toFixed(1), downs,
  };
}
