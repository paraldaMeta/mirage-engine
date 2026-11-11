// Mirage original code. The XR options of this example, from the URL (every one off without its flag; docs/xr.md):
//   ?xrpost=1            the engine's post chain per eye (AO, bloom, exposure, tone map, LUT) [&xrmsaa=N &xrao=0 &xrbloom=0]
//   ?xrbudget=1          the frame-time governor: quality steps down before frames are dropped
//   ?xrprofile=auto | quest-2 | quest-3 | vision-pro | pcvr     the device's default quality (untested on hardware)
//   ?xrposture=seated | standing     height calibration (seated also ignores room movement)
//   ?xrbounds=1 | always             the play area's fence near its edge (bounded-floor)
//   ?xrsmooth=1          smooth turn instead of the 30 degree snap
//   ?xrdemo=1            things to do by the spawn: a ball to throw, a two-handed crate to turn and scale, a snap
//                        zone, a poke button and a canvas UI panel (ray + trigger / pinch, or a fingertip)
//   ?xrar=1              AR: anchors, plane shadows, light estimation, a shadows-only ground, a DOM overlay
import * as THREE from 'three';
import { createXRInteraction } from '@miragekit/play';
import { createCanvasUI, cv } from '@miragekit/game/ui-canvas';
import { signal } from '@miragekit/game/ui-reactive';

export function xrDemo(Q, world, play, plan) {
  const on = (k) => Q.has(k) && Q.get(k) !== '0';
  const o = {};
  if (on('xrpost')) o.post = { msaa: +Q.get('xrmsaa') || 4, ao: Q.get('xrao') !== '0', bloom: Q.get('xrbloom') !== '0' };
  if (on('xrbudget')) o.budget = true;
  if (Q.get('xrprofile')) o.profile = Q.get('xrprofile');
  if (Q.get('xrposture')) o.posture = Q.get('xrposture');
  if (on('xrbounds')) o.bounds = Q.get('xrbounds') === 'always' ? 'always' : true;
  if (on('xrsmooth')) o.snapTurn = 0;
  if (on('xrar')) o.arFeatures = { anchors: true, planes: 'shadow', light: true, shadowGround: true, domOverlay: overlay() };
  if (on('xrdemo')) o.interact = things(world, play, plan);
  return o;
}

// the AR session's DOM overlay: a line of help, shown only while it is the overlay (:xr-overlay)
function overlay() {
  const st = document.createElement('style'), el = document.createElement('div');
  st.textContent = '.xr-ar-tip{display:none;position:fixed;left:0;right:0;bottom:24px;text-align:center;font:600 15px system-ui,sans-serif;color:#fff;text-shadow:0 1px 4px #000}';
  document.head.appendChild(st);
  try { st.sheet.insertRule('.xr-ar-tip:xr-overlay{display:block}'); } catch { /* no :xr-overlay here: it stays hidden */ }
  el.className = 'xr-ar-tip'; el.textContent = 'Look at the floor and tap to place the garden';
  document.body.appendChild(el);
  return el;
}

// a stand 1.3 m in front of the spawn (the player looks down -z): everything within arm's reach
function things(world, play, plan) {
  const [sx, , sz] = plan.spawn.eye, gy = play.grid.groundAt(sx, sz - 1.3, 3) || 0;
  const ix = createXRInteraction({ ground: (x, z) => play.grid.groundAt(x, z, 4) || gy });
  const g = new THREE.Group(); g.name = 'xr-demo'; g.position.set(sx, gy, sz - 1.3); g.userData.collide = false;
  const mat = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const add = (mesh, x, y, z, name) => { mesh.position.set(x, y, z); mesh.name = name; mesh.castShadow = true; g.add(mesh); return mesh; };
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.4), mat(0x6f6658, 0.85)), 0, 0.45, 0, 'stand').receiveShadow = true;
  const ball = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), mat(0xc8502c, 0.4)), 0.45, 0.96, 0.05, 'ball');
  const crate = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat(0x8a6a3a)), -0.45, 0.98, 0.05, 'crate');
  const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 8, 32).rotateX(Math.PI / 2), mat(0x2f6d4f, 0.3)), 0.15, 0.905, 0.05, 'socket');
  const knob = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 20), mat(0xb8b0a0, 0.3)), -0.15, 0.9125, 0.1, 'button');
  world.scene.add(g); g.updateMatrixWorld(true);
  const state = { pressed: signal(0), size: signal(0.5), lit: signal(true), snapped: signal('empty') };
  ix.grabbable(ball, { radius: 0.06 });
  ix.grabbable(crate, { radius: 0.1, twoHanded: true, scale: [0.5, 3] });
  ix.snapZone({ position: ring.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0)).toArray(), radius: 0.14,
    onSnap: (obj) => { state.snapped.value = obj.name; }, onUnsnap: () => { state.snapped.value = 'empty'; } });
  ix.pokeable(knob, { radius: 0.04, onPress: () => { state.pressed.value++; knob.position.y = 0.905; }, onRelease: () => { knob.position.y = 0.9125; } });
  const ui = createCanvasUI({ width: 512, height: 352, description: () => cv.panel({ title: 'XR panel' },
    cv.text({ text: () => `presses ${state.pressed.value}   socket: ${state.snapped.value}` }),
    cv.toggle({ value: state.lit, label: 'Ball glows', onChange: (v) => { ball.material.emissive.set(v ? 0x802000 : 0x000000); } }),
    cv.slider({ value: state.size, label: 'Ball size', onChange: (v) => { ball.scale.setScalar(0.5 + v); } }),
    cv.button({ label: 'Reset', primary: true, onPress: () => { state.pressed.value = 0; ball.position.set(0.45, 0.96, 0.05); ball.quaternion.identity(); crate.position.set(-0.45, 0.98, 0.05); crate.quaternion.identity(); crate.scale.setScalar(1); } })) });
  ball.material.emissive.set(0x802000);
  const screen = ui.mesh({ width: 0.56 });
  screen.position.set(0, 1.32, -0.12); screen.rotation.x = -0.25; screen.userData.collide = false; g.add(screen);
  ix.panel(ui, screen);
  ix.demo = { group: g, ball, crate, ring, knob, screen, ui, state };   // the emulated-session check reads these
  return ix;
}
