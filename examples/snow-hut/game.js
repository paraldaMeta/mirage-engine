// The game of snow-hut (lead-owned): the stove on the hut's `stoves` anchor (light it / bank it), its fire light
// with a slow flicker, the falling snow's clock, wind and the stove's crackle-less hum (procedural sounds only).
import * as THREE from 'three';

export function setupGame({ game, audio, root, anchors }, { built }) {
  const hut = built.modules.hut, ground = built.modules.ground;
  const dirty = () => { game.dirty = true; };
  const snow = ground && ground.snow;
  const fireLight = new THREE.PointLight(0xff7a30, 0, 5, 1.8);
  let t = 0;
  game.system((dt) => {                            // snow falls and the fire breathes: the scene moves every frame
    t += dt;
    if (snow) { snow.value = t; dirty(); }
    if (fireLight.intensity > 0) fireLight.intensity = 2.4 * (0.85 + 0.1 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 17.1));
  });
  const [s] = anchors.stoves || [];
  if (!s || !hut) return { stove: false };
  fireLight.position.set(s.pos[0], s.pos[1], s.pos[2] + 0.15); root.add(fireLight);
  const setLit = (on) => { hut.fire.emissiveIntensity = on ? 6 : 0; fireLight.intensity = on ? 2.4 : 0; dirty(); };
  game.add({
    id: 'stove', pos: s.pos,
    interact: {
      reach: 2.2,
      label: (g) => (g.flags.lit ? 'Bank the fire' : 'Light the stove'),
      use: (g) => {
        const on = !g.flags.lit;
        g.set('lit', on); setLit(on);
        audio.play(on ? 'ignite' : 'locked', { at: s.pos });
        if (on && !g.flags.done) { g.set('done', true); audio.play('done', { bus: 'sfx', gain: 0.7 }); game.ui.message('The stove is lit', 'The iron ticks as it warms. Outside, the snow keeps falling.', 'Stay a while'); }
        else game.ui.toast(on ? 'The stove is lit' : 'The fire is banked');
      },
    },
    save: () => ({ lit: !!game.flags.lit }),
    load: (v) => setLit(!!v.lit),
  });
  audio.loop('wind', { bus: 'ambience', gain: 0.5 });
  audio.loop('pad', { bus: 'music', gain: 0.4 });
  return { stove: true };
}

export const objective = (g) => (g.flags.lit
  ? ['The stove is lit', 'Stay by the fire, or walk out into the snow.']
  : ['Warm the hut', 'Go inside and light the stove.']);
