// The game of agent-trial (lead-owned), spawned from the modules' anchors:
//   lanterns  one on every `lamps` anchor (shore's two entrance posts, pier's five posts), dark at first
//   lever     on the `levers` anchor beside the lighthouse door: pull it to light the lamp and every lantern
//   beacon    at the `beacon` anchor: a glowing lamp, a strong light and two slowly turning beams
// plus ambience (wind, the sea at the seawall and under the pier head) and the objective text.
import * as THREE from 'three';

export function setupGame({ game, audio, root, plan, anchors, world }, { built, mats }) {
  const { mat } = world;
  const iron = mats.iron;
  const lamps = anchors.lamps || [];
  const dirty = () => { game.dirty = true; };

  // ---- lanterns: glass + cap + a light, off until lit
  const lanterns = lamps.map((a) => {
    const g = new THREE.Group();
    const glass = mat.std({ color: new THREE.Color(0.22, 0.2, 0.17), roughness: 0.3, emissive: new THREE.Color(1, 0.58, 0.26), emissiveIntensity: 0 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.3, 8), glass); body.position.y = 0.17;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.16, 8), iron); cap.position.y = 0.4;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 8), iron); base.position.y = 0.015;
    const light = new THREE.PointLight(0xff9a50, 0, 11, 2); light.position.y = 0.18;
    g.add(body, cap, base, light);
    g.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    g.position.set(...a.pos); root.add(g);
    return (on) => { glass.emissiveIntensity = on ? 6 : 0; light.intensity = on ? 3.5 : 0; };
  });

  // ---- the beacon: a glowing lamp in the lens, a light, two beams turning once every 12 s
  const [b] = anchors.beacon || [];
  let beacon = () => {};
  if (b) {
    const glowMat = mat.std({ color: 0x000000, emissive: new THREE.Color(1, 0.78, 0.5), emissiveIntensity: 0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), glowMat);
    const light = new THREE.PointLight(0xffc890, 0, 60, 1.6);
    const beams = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd9a8, vertexColors: true, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beamGeo = new THREE.CylinderGeometry(0.25, 3.2, 70, 20, 8, true), bp = beamGeo.attributes.position, fade = [];
    for (let i = 0; i < bp.count; i++) { const k = Math.pow((bp.getY(i) + 35) / 70, 1.6); fade.push(k, k, k); }   // bright at the lamp, gone at 70 m
    beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(fade, 3));
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(beamGeo, beamMat);
      cone.rotation.z = s * Math.PI / 2; cone.position.x = s * 35.4;
      beams.add(cone);
    }
    beams.visible = false;
    const g = new THREE.Group(); g.add(bulb, light, beams); g.position.set(...b.pos); root.add(g);
    g.traverse((o) => { o.userData.collide = false; });
    const lens = built.modules.lighthouse && built.modules.lighthouse.lens;
    beacon = (on) => {
      glowMat.emissiveIntensity = on ? 40 : 0; light.intensity = on ? 40 : 0; beams.visible = on;
      if (lens && lens.material.emissive) { lens.material.emissive.setRGB(1, 0.7, 0.4); lens.material.emissiveIntensity = on ? 2 : 0; }
    };
    game.system((dt) => { if (beams.visible) { beams.rotation.y += dt * (Math.PI * 2 / 12); dirty(); } });
  }

  // ---- the lever: a handle on a pivot; up = off, down = on
  const [l] = anchors.levers || [];
  if (l) {
    const pivot = new THREE.Group();
    pivot.position.set(...l.pos); pivot.rotation.y = l.rotY;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.04).translate(0, 0.18, 0), iron);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), mat.std({ color: new THREE.Color(0.5, 0.08, 0.05), roughness: 0.5 }));
    knob.position.y = 0.36; handle.add(knob);
    const arm = new THREE.Group(); arm.add(handle); arm.rotation.x = 0.5; pivot.add(arm);
    pivot.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    root.add(pivot);
    let target = 0.5;
    const setLit = (on) => { target = on ? 2.4 : 0.5; for (const f of lanterns) f(on); beacon(on); dirty(); };
    game.add({
      id: 'lever', pos: [l.pos[0], l.pos[1] + 0.2, l.pos[2]],
      interact: {
        reach: 2.4,
        label: (g) => (g.flags.lit ? 'Put the light out' : 'Pull the lever: light the lamp'),
        use: (g) => {
          const on = !g.flags.lit;
          g.set('lit', on); setLit(on);
          audio.play(on ? 'ignite' : 'locked', { at: l.pos });
          if (on && !g.flags.done) { g.set('done', true); audio.play('done', { bus: 'sfx', gain: 0.8 }); game.ui.message('The lamp is lit', `The lighthouse turns its beam over the sea and ${lanterns.length} lanterns burn along the pier.`, 'Walk on'); }
          else game.ui.toast(on ? 'The lamp is lit' : 'Dark again');
        },
      },
      update: (dt) => { const d = target - arm.rotation.x; if (Math.abs(d) > 1e-3) { arm.rotation.x += d * Math.min(1, dt * 8); dirty(); } },
      save: () => ({ lit: !!game.flags.lit }),
      load: (s) => setLit(!!s.lit),
    });
  }

  // ---- ambience
  audio.loop('wind', { bus: 'ambience', gain: 0.7 });
  audio.loop('water', { at: [plan.shore.x0 - 0.5, 0.3, 0], gain: 0.8, ref: 6 });
  const [hx0, hz0, hx1, hz1] = plan.footprints.pierHead.rect;
  audio.loop('water', { at: [(hx0 + hx1) / 2, 0.3, (hz0 + hz1) / 2], gain: 0.6, ref: 6 });
  audio.loop('pad', { bus: 'music', gain: 0.5 });
  return { lanterns: lanterns.length, beacon: !!b, lever: !!l };
}

export const objective = (g) => (g.flags.lit
  ? ['The lamp is lit', 'Walk back along the lit pier, or put the light out at the lever.']
  : ['Light the lighthouse', 'Walk out along the pier to the lighthouse door and pull the lever.']);
