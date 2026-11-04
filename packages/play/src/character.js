import { buildCharacterModel } from './character-model.js';

const DEFAULT_PALETTE = {
  jacket: 0x436d65, trousers: 0x414c52, scarf: 0xd98645, leather: 0x69503d, skin: 0xb77d58, hair: 0x332b29,
};
const TAU = 2 * Math.PI;
const approach = (from, to, amount) => from + Math.sign(to - from) * Math.min(Math.abs(to - from), amount);

/** A reusable, code-built traveller. Position and heading belong to the host, articulation to this controller. */
export function createCharacter(world, { palette = {} } = {}) {
  const { root, body, mesh, spine, head, limbs } = buildCharacterModel(world, { ...DEFAULT_PALETTE, ...palette });
  let phase, stride, sprint, impact, grounded, lastVy, state;

  function pose(air) {
    let lowestAnkle = Infinity;
    for (const leg of limbs) {
      const wave = Math.sin(phase) * leg.side, swing = Math.max(0, Math.cos(phase) * leg.side);
      const thigh = air ? -0.30 + leg.side * (state === 'jump' ? 0.23 : 0.12) : -wave * stride * (0.46 + 0.28 * sprint) - 0.31 * impact;
      const knee = air ? 0.54 + leg.side * 0.16 : 0.04 + stride * swing * (0.56 + 0.49 * sprint) + 0.68 * impact;
      leg.hip.rotation.x = thigh;
      leg.knee.rotation.x = knee;
      leg.ankle.rotation.x = air ? 0.16 : -thigh - knee;
      leg.shoulder.rotation.set(air ? -0.27 : wave * stride * (0.39 + 0.29 * sprint),
        0, leg.side * (0.035 + (air ? 0.25 : 0)));
      leg.elbow.rotation.x = -0.14 - (air ? 0.62 : stride * (0.18 + 0.63 * sprint));
      lowestAnkle = Math.min(lowestAnkle, 0.89 - 0.405 * Math.cos(thigh) - 0.39 * Math.cos(thigh + knee));
    }
    body.position.y = air ? 0 : 0.095 - lowestAnkle;
    const twist = Math.sin(phase) * stride;
    spine.rotation.set(0.035 + 0.12 * stride * sprint + 0.12 * impact, twist * 0.12, twist * 0.025);
    head.rotation.set(-0.04 - 0.08 * stride * sprint, -twist * 0.07, 0);
    root.userData.phase = phase;
  }

  function reset() {
    phase = stride = sprint = impact = lastVy = 0; grounded = true; state = 'idle';
    pose(false);
  }
  reset();
  function update(dt, { distance = 0, run = false, onGround = true, verticalSpeed = 0 } = {}) {
    if (!(dt > 0)) return false;
    distance = Math.max(0, distance);
    const speed = distance / dt;
    if (state === 'idle' && onGround && speed < 0.03) return false;
    const elapsed = Math.min(dt, 0.1);
    if (onGround && !grounded) impact = Math.min(1, Math.max(0, -lastVy) / 5);
    else impact = approach(impact, 0, 4.8 * elapsed);
    const target = speed < 0.03 ? 0 : Math.min(1, speed / (run ? 3.3 : 1.35));
    stride = approach(stride, onGround ? target : 0, 7 * elapsed);
    sprint = approach(sprint, onGround && run && target ? 1 : 0, 6 * elapsed);
    if (onGround) phase = (phase + TAU * Math.min(distance, 0.75) / (1.30 + 0.65 * sprint)) % TAU;
    if (!onGround) state = verticalSpeed > 0 ? 'jump' : 'fall';
    else if (impact > 0) state = 'land';
    else if (stride > 0) state = sprint > 0.5 ? 'run' : 'walk';
    else { state = 'idle'; phase = sprint = 0; }
    grounded = onGround; lastVy = verticalSpeed;
    pose(!onGround);
    return true;
  }
  return { root, mesh, update, reset, get state() { return state; },
    dispose() { root.removeFromParent(); mesh.geometry.dispose(); } };
}
