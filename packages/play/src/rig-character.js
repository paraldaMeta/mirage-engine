// Mirage original code.

// ---------------------------------------------------------------------------
// The play character as an imported rigged model: the same contract as createCharacter(), driven by the animator.
//
//   import { createAssets } from '@mirage/core/assets';
//   import { createPlay, createRigCharacter } from '@mirage/play';
//   const model = await createAssets(world).load('hero.glb');
//   let hero;
//   const play = createPlay(world, { character: () => (hero = createRigCharacter(assets.instantiate(model), model.animations)) });
//   hero.ground = (x, z, y) => play.grid.groundAt(x, z, y, 0.4);    // optional: feet follow steps and slopes
//
// Off unless `character` is passed to createPlay: without it the procedural traveller is built exactly as before.
// The walker still owns position (collision, steps, jumping); the clips' own travel is taken out of the pose and
// used to keep the feet from sliding: playback is scaled so the blend covers the ground the walker covered.
// Wants clips named idle, walk, run and (optionally) jump; `clipNames` renames them, `layers` replaces the whole
// controller (it must read the parameters speed, rate, grounded, vy).
// ---------------------------------------------------------------------------
import { createAnimator } from './anim.js';
import { createFootIK, solveLookAt } from './ik.js';
import { humanoidRoles } from './retarget.js';
import { BODY } from './walker.js';

const approach = (from, to, amount) => from + Math.sign(to - from) * Math.min(Math.abs(to - from), amount);

export function createRigCharacter(root, clips, { clipNames = {}, layers = null, rootBone = 'Root', ground = null, footIK = {}, look = { share: [0.35, 0.65], limit: 1.1 }, body = BODY, onDispose = null } = {}) {
  const N = { idle: 'idle', walk: 'walk', run: 'run', jump: 'jump', ...clipNames };
  const has = (n) => clips.some((c) => c.name === n);
  for (const n of [N.idle, N.walk]) if (!has(n)) throw new Error(`rig character: no clip "${n}"`);
  const hasRoot = !!root.getObjectByName(rootBone);
  // thresholds: how fast each clip itself travels, where it says; else the walker's speeds
  const travel = (n, fallback) => { const c = clips.find((x) => x.name === n), tr = hasRoot && c?.tracks.find((t) => t.name === `${rootBone}.position`); if (!tr) return fallback; const v = tr.values, k = v.length - 3; return Math.hypot(v[k] - v[0], v[k + 2] - v[2]) / c.duration || fallback; };
  const vWalk = travel(N.walk, body.walk), vRun = has(N.run) ? travel(N.run, body.run) : 0;
  const points = [[0, N.idle], [vWalk, N.walk]]; if (vRun > vWalk) points.push([vRun, N.run]);
  const states = { move: { blend1d: { param: 'speed', points }, speedParam: 'rate' } }, transitions = [];
  if (has(N.jump)) {
    states.air = { clip: N.jump, loop: false, time: 0.35 };   // enter past the crouch: the walker has already left the ground
    transitions.push({ from: 'move', to: 'air', when: ['!grounded'], duration: 0.12 }, { from: 'air', to: 'move', when: ['grounded'], duration: 0.15 });
  }
  const anim = createAnimator(root, clips, {
    parameters: { speed: 0, rate: 1, grounded: true, vy: 0 }, rootMotion: hasRoot ? { bone: rootBone } : null,
    layers: layers || [{ name: 'base', start: 'move', states, transitions }],
  });
  const roles = humanoidRoles(root);
  let mesh = null; root.traverse((o) => { if (!mesh && o.isSkinnedMesh) mesh = o; o.userData.collide = false; });
  const legs = ['L', 'R'].map((s) => [roles[`upperLeg${s}`], roles[`lowerLeg${s}`], roles[`foot${s}`]]);
  const feet = roles.hips && legs.every((l) => l.every(Boolean))
    ? createFootIK(root, { ground: (x, z, y) => (api.ground ? api.ground(x, z, y) : y), hips: roles.hips, legs, ...footIK }) : null;
  const lookChain = [roles.neck, roles.head].filter(Boolean);
  anim.post.push(() => {
    if (feet && api.ground && anim.get('grounded')) feet.update(anim.dt);
    if (api.lookTarget && lookChain.length) solveLookAt(lookChain, api.lookTarget, { ...look, share: lookChain.length === 2 ? look.share : null });
  });
  let speed = 0, state = 'idle', disposed = false;
  const api = {
    root, mesh, animator: anim, feet,
    /** (x, z, y) -> floor height under a body with feet at y; set it to turn foot placement on */
    ground,
    /** a world point for the head to face, or null */
    lookTarget: null,
    get state() { return state; },
    update(dt, { distance = 0, run = false, onGround = true, verticalSpeed = 0 } = {}) {
      if (!(dt > 0)) return false;
      const v = Math.max(0, distance) / dt;
      speed = approach(speed, onGround ? v : speed, 12 * Math.min(dt, 0.1));   // eased: a blend, not a switch
      // feet in step with the ground covered: the blend at `speed` travels at some other pace of its own
      let own = 0, dur = 0;
      for (const [n, w] of anim.weights()) { const cd = anim.clips.get(n); dur += w * cd.duration; if (cd.root) own += w * Math.hypot(cd.root.total[0], cd.root.total[2]); }
      const pace = dur > 0 ? own / dur : 0;
      anim.set('speed', speed).set('rate', pace > 0.3 && speed > 0.3 ? Math.min(1.6, Math.max(0.6, speed / pace)) : 1).set('grounded', onGround).set('vy', verticalSpeed);
      anim.update(dt);
      state = !onGround ? (verticalSpeed > 0 ? 'jump' : 'fall') : speed < 0.05 ? 'idle' : run && speed > (vWalk + (vRun || vWalk)) / 2 ? 'run' : 'walk';
      return true;   // an idle clip breathes: there is always a new pose to draw
    },
    reset() { speed = 0; state = 'idle'; feet?.reset(); anim.reset(); anim.update(0); },   // update(0): enter the start states, so a still drawn straight after a place() shows idle, not the bind pose
    dispose() { if (!disposed) { disposed = true; root.removeFromParent(); onDispose?.(api); } },
  };
  api.reset();
  return api;
}
