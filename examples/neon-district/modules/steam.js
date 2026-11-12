// steam: the street's steam as lit, slow volumetric plumes (core createPlumes: Nizwa's sliced plume, one instanced
// draw), in place of the unlit particle puffs: the vent grates and manholes, the noodle stall's and the cart's pots,
// and the jets of a steam pipe that was shot (shared.plumes.jet, game/destruct.js). Each takes the sun by day (its
// visibility measured by a ray toward the sun from its foot, middle and top whenever the sun moves), the nearest lamp
// or sign by night, the air's fill, and leans with the wind. Budget by tier (plumes drawn, slices each).
import * as THREE from 'three';
import { createPlumes } from '@miragekit/core';

const TIER = { low: { budget: 4, slices: 10, far: 28 }, medium: { budget: 6, slices: 14, far: 36 }, high: { budget: 8, slices: 16, far: 40 } };

export default {
  name: 'steam',
  build() {},
  finalize(ctx) {
    const { world, root, anchors, shared } = ctx, T = TIER[shared.tier] || TIER.high;
    const P = createPlumes(world, T);
    root.add(P.mesh);
    const wind = world.G.uWind.value, lean = (h, k = 1) => [wind.x * wind.z * 0.22 * h * k, wind.y * wind.z * 0.22 * h * k];
    // the vents (ground.js: grates and manholes) breathe a broad column; a pot a thin one
    const ids = [];
    for (const a of anchors.steam || []) {
      const pot = a.pos[1] > 0.5;
      ids.push(P.add({ pos: a.pos, height: pot ? 1.3 : 2.6, radius: pot ? 0.28 : 0.6, density: pot ? 0.9 : 0.7, rise: pot ? 0.5 : 0.7, lean: lean(pot ? 1.3 : 2.6) }));
    }
    // light: the sun's visibility by rays through what casts shadows (when the sun moves), the nearest lamp (once lit)
    const casters = [], rc = new THREE.Raycaster(), last = new THREE.Vector3();
    world.scene.traverse((o) => { if (o.isMesh && o.castShadow) casters.push(o); });
    const sunVis = (p) => {
      const d = world.keyDir;
      return [0.05, 0.5, 0.95].map((t) => { rc.set(new THREE.Vector3(p.pos[0] + p.lean[0] * t * t, p.pos[1] + p.height * t, p.pos[2] + p.lean[1] * t * t), d); rc.far = 300; return rc.intersectObjects(casters, false).length ? 0.08 : 1; });
    };
    const lampOf = (p) => {
      let best = null, score = 0;
      const at = (pos, color, power, range) => { const d2 = (pos[0] - p.pos[0]) ** 2 + (pos[1] - p.pos[1] - p.height * 0.4) ** 2 + (pos[2] - p.pos[2]) ** 2; if (d2 > range * range) return; const s = power / Math.max(d2, 0.5); if (s > score) { score = s; best = { pos, color, power, range }; } };
      for (const l of shared.pool || []) at(l.pos, l.color, l.power, l.range);
      for (const { light } of shared.lamps || []) if (!light.userData.indoor) at(light.position.toArray(), [light.color.r, light.color.g, light.color.b], light.userData.nd, light.distance);
      return best;
    };
    let lit = false;
    const amb = new THREE.Vector3();
    // a jet from a cut pipe: a plume along its direction for its duration, fading out over its last two seconds
    const jets = [];
    shared.plumes = {
      api: P,
      jet(point, dir, duration = 10) {
        const id = P.add({ pos: point, height: 2.2, radius: 0.5, density: 1.4, rise: 1.4, lean: [dir[0] * 1.2 + lean(2.2)[0], dir[2] * 1.2 + lean(2.2)[1]] });
        const p = P.get(id); p.sun = sunVis(p); p.lamp = lampOf(p);
        jets.push({ id, t: duration > 0 ? duration : Infinity });
        return id;
      },
      clear() { for (const j of jets) P.remove(j.id); jets.length = 0; },
    };
    let prev = 0;
    world.ctx.onUpdate((t) => {
      const dt = Math.max(0, Math.min(0.1, t - prev)); prev = t;
      if (!lit) { for (const id of ids) { const p = P.get(id); p.lamp = lampOf(p); } lit = true; }
      if (last.lengthSq() === 0 || last.angleTo(world.keyDir) > 0.01) { last.copy(world.keyDir); for (const id of ids) { const p = P.get(id); p.sun = sunVis(p); } }
      for (let i = jets.length - 1; i >= 0; i--) { const j = jets[i]; j.t -= dt; P.set(j.id, { strength: Math.min(1, Math.max(0, j.t / 2)) }); if (j.t <= 0) { P.remove(j.id); jets.splice(i, 1); } }
      // the fill: the air's own colour (the haze: blue-grey by day, the city's glow by night)
      const f = world.scene.fog?.color; if (f) P.uniforms.uAmbient.value.copy(amb.set(f.r, f.g, f.b).multiplyScalar(0.5));
      P.update(world.camera);
    });
  },
};
