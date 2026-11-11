// Demo: model import and the animation stack. The rigged figure is authored in code (createRigModel), written to
// a meshopt-compressed GLB in the page and read back through the importer, so everything on screen went through
// the same path as a downloaded file. You walk it (WASD, Shift runs, Space jumps) over a kerb, steps and a ramp.
// URL: ?player=rig (default) | procedural (the built-in traveller: the engine without this stack)
//      ?ik=0 (no foot placement or look-at)   ?npc=0 (no root-motion walker)   ?retarget=0 (no retargeted traveller)
//      ?timeline=1 (a scripted shot instead of play: camera, object, clips, events; ?t=seconds shows one moment)
//      ?src=<url> (your own .glb with clips named idle / walk / run [/ jump] as the player)   ?decoders=1 (probe)
//      ?mode=game | walk | orbit   ?time=golden (default: a June afternoon)   ?w=&h=  ?ui=0  ?grain=0  ?spp=N
import * as THREE from 'three';
import { createWorldRenderer, writeGLB } from '@miragekit/core';
import { createAssets } from '@miragekit/core/assets';
import { decoders } from '@miragekit/core/assets-decoders';
import { buildWorld, definePlan } from '@miragekit/world';
import { createPlay, createCharacter, createWalker, createRigModel, createAnimator, rootMotionInput, createFootIK, solveLookAt,
  retargetClip, createTimeline, createRigCharacter, RIG } from '@miragekit/play';

const Q = new URLSearchParams(location.search), on = (k) => Q.get(k) !== '0';
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight;
const canvas = document.querySelector('canvas'), hud = document.querySelector('#hud');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const world = createWorldRenderer({ canvas, width: W, height: H, place: { lat: 51.5, lon: -0.1, height: 30, tzHours: 0 }, time: Q.get('time') === 'golden' ? 'golden' : new Date(Date.UTC(2026, 5, 21, 15, 30)), preserveDrawingBuffer: true,
  quality: Q.get('quality') || 'high', shadow: { center: [0, 1, 0], radius: 16 }, envProbe: [0, 1.6, 4], fog: { groundDensity: 0.002, height: 30 }, post: { grain: Q.get('grain') === '0' ? 0 : 0.01 } });

// --- import: the rig and a crate, as GLB bytes through the asset cache
const assets = createAssets(world, { decoders });
const authored = createRigModel();
const rigBytes = writeGLB(authored.root, { clips: authored.clips, meshopt: true });
const model = await assets.load(Q.get('src') || rigBytes, { key: 'hero' });
const crateBytes = writeGLB(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8).translate(0, 0.4, 0), new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.85 })), { meshopt: true });
const crate = await assets.load(crateBytes, { key: 'crate', collide: 'box' });

const plan = definePlan({
  name: 'anim', seed: 'anim', bounds: [-16, -16, 16, 16], walk: { yMin: -1, yMax: 4 },
  spawn: { eye: [0, 1.62, 5], look: [0, 1, 0], mode: 'game' },
  viewpoints: [{ name: 'yard', eye: [6, 3.2, 8], look: [0, 0.9, 0] }, { name: 'kerb', eye: [1.6, 0.7, 4.2], look: [0.2, 0.5, 2.2] }],
});
const modules = [{
  name: 'yard',
  build(ctx) {
    const mesh = (geo, color, x, y, z) => { const m = new THREE.Mesh(geo, ctx.mat.std({ color, roughness: 0.9 })); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; ctx.root.add(m); return m; };
    mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), 0x6f6a58, 0, 0, 0).name = 'ground';
    mesh(new THREE.BoxGeometry(6, 0.15, 3), 0x8d8676, 0, 0.075, 1.5).name = 'kerb';                   // a pavement: one foot up, one down
    for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(2.4, 0.18 * (i + 1), 0.5), 0x9a9382, -5, 0.09 * (i + 1), 1 - 0.5 * i).name = 'step' + i;
    const ramp = mesh(new THREE.BoxGeometry(2.4, 0.2, 5), 0x7d7767, 5, 0.5, 0); ramp.rotation.x = -0.26; ramp.name = 'ramp';
    // imported static meshes are world geometry like any other: instanced, shadowed, solid through their box proxy
    const row = assets.instances(crate, [[-2.4, 0, -3.5, 0.3], [-1.3, 0, -3.8, -0.2], [-1.9, 0.8, -3.6, 0.9], [2.6, 0, -3.2, 0.5]].map(([x, y, z, a]) => new THREE.Matrix4().makeRotationY(a).setPosition(x, y, z)));
    ctx.root.add(row.root);
  },
}];
const built = await buildWorld(world, { plan, modules, shared: {} });
const { camera, scene } = world;
camera.aspect = W / H; camera.fov = 50; camera.near = 0.1; camera.far = 2000; camera.updateProjectionMatrix();
await world.prepare();

// --- the player: the imported rig behind createPlay's opt-in `character`, or the built-in traveller
const useRig = Q.get('player') !== 'procedural', ik = on('ik'), spp = +Q.get('spp') || 4;
let hero = null;
const actors = [];   // everything else that animates each frame: (dt) => void
const play = createPlay(world, {
  plan: built.plan, canvas, mode: Q.get('mode') || 'game', spp, ui: Q.get('ui') !== '0', fit: !Q.get('w'), hud: false,
  character: useRig ? () => (hero = createRigCharacter(assets.instantiate(model), model.animations)) : undefined,
  onStep(dt) { for (const a of actors) a(dt); return actors.length > 0; },
});
const groundAt = (x, z, y) => play.grid.groundAt(x, z, y, 0.4);
if (hero && ik) hero.ground = groundAt;

// --- a second instance walking a circle: its clips' root motion drives a walker on the same walk grid
let npc = null;
if (on('npc') && !Q.get('src')) {
  const root = assets.instantiate(model); scene.add(root);
  const anim = createAnimator(root, model.animations, { parameters: { speed: RIG.walk }, rootMotion: { bone: 'Root' },
    layers: [{ name: 'base', start: 'move', states: { move: { blend1d: { param: 'speed', points: [[0, 'idle'], [RIG.walk, 'walk'], [RIG.run, 'run']] } } } }] });
  const walker = createWalker(play.grid, { pos: [3, 0, 3] }), input = {}, steps = { footL: 0, footR: 0 };
  anim.on('footL', () => steps.footL++); anim.on('footR', () => steps.footR++);
  if (ik) {
    const feet = createFootIK(root, { ground: groundAt, hips: 'Hips', legs: [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']] });
    const neck = root.getObjectByName('Neck'), head = root.getObjectByName('Head'), eye = new THREE.Vector3();
    anim.post.push(() => { feet.update(anim.dt); solveLookAt([neck, head], eye.set(play.walker.pos[0], play.walker.pos[1] + 1.5, play.walker.pos[2]), { share: [0.35, 0.65], limit: 1.1 }); });   // it watches the player
  }
  npc = { root, anim, walker, steps, travelled: 0 };
  actors.push((dt) => {
    root.rotation.y += dt * 0.42;   // turning while the clip walks it forward: a circle of radius speed / turn rate
    const x = walker.pos[0], z = walker.pos[2];
    walker.update(dt, rootMotionInput(anim.update(dt), root.rotation.y, walker.body, dt, input));
    npc.travelled += Math.hypot(walker.pos[0] - x, walker.pos[2] - z);
    root.position.set(walker.pos[0], walker.pos[1], walker.pos[2]);
  });
}

// --- the built-in traveller playing the rig's walk: other bone names, other rest pose (arms down against a T)
let retargeted = null;
if (on('retarget') && !Q.get('src')) {
  const src = createRigModel(), figure = createCharacter(world);
  figure.root.position.set(-3, 0, 4); figure.root.rotation.y = 0.6; scene.add(figure.root); figure.root.updateMatrixWorld(true); src.root.updateMatrixWorld(true);
  const clip = retargetClip(src.clips.find((c) => c.name === 'walk'), src.root, figure.root);
  const anim = createAnimator(figure.root, [clip], { rootMotion: { bone: 'hips' }, layers: [{ name: 'base', start: 'walk', states: { walk: { clip: 'walk' } } }] });
  retargeted = { root: figure.root, anim, clip };
  actors.push((dt) => anim.update(dt));   // in place: its travel is returned, and here not used
}

// --- ?timeline=1: a scripted shot on one clock. Stops play and draws its own frames.
let tl = null, tlActor = null;
if (Q.get('timeline') === '1') {
  play.stop();
  // the shot has one actor: the walk-about figures are not stepped while play is stopped and would stand in their rest pose
  for (const o of [hero?.root, npc?.root, retargeted?.root]) if (o) o.visible = false;
  const actor = assets.instantiate(model); actor.position.set(-1, 0.15, 1.5); scene.add(actor); tlActor = actor;
  const anim = createAnimator(actor, model.animations, { layers: [] }), box = scene.getObjectByName('step3');
  let caption = '';
  tl = createTimeline({ tracks: [
    { type: 'camera', target: camera, curve: 'smooth', keys: [{ t: 0, position: [-4, 1.4, 6], lookAt: [-1, 1, 1.5], fov: 50 }, { t: 3, position: [1.5, 1.7, 5.5], lookAt: [0, 1.1, 1.5], fov: 40, ease: 'inOut' }, { t: 6, position: [3.5, 1.2, 3], lookAt: [1.2, 1.2, 1.5], fov: 28, ease: 'inOut' }] },
    { type: 'transform', target: actor, keys: [{ t: 0, position: [-1, 0.15, 1.5], rotation: [0, Math.PI / 2, 0] }, { t: 3, position: [-1 + RIG.walk * 1.5, 0.15, 1.5], rotation: [0, Math.PI / 2, 0] }, { t: 3.6, rotation: [0, 0.9, 0], ease: 'inOut' }] },
    { type: 'animation', animator: anim, clips: [{ t: 0, clip: 'idle', duration: 1.5 }, { t: 1.5, clip: 'walk', duration: 1.5, fade: 0.25 }, { t: 3, clip: 'idle', fade: 0.3, duration: 0.8 }, { t: 3.8, clip: 'wave', over: 'idle', fade: 0.25 }] },
    { type: 'transform', target: box, keys: [{ t: 4, scale: [1, 1, 1] }, { t: 5, scale: [1, 1.4, 1], ease: 'out' }] },
    { type: 'event', keys: [{ t: 0, name: 'caption', text: 'idle' }, { t: 1.5, name: 'caption', text: 'walk (a transform track moves it; the clip animates in place)' }, { t: 3.8, name: 'caption', text: 'wave' }] },
  ], duration: 6, loop: Q.get('t') == null });
  tl.on('caption', (e) => { caption = e.text; });
  let last = null, T = 0;
  const draw = () => { world.renderFrame(T, { spp, frameIndex: 1 }); hud.textContent = `timeline ${tl.time.toFixed(2)} / ${tl.duration} s   ${caption}`; };
  if (Q.get('t') != null) { tl.seek(+Q.get('t')); draw(); }   // one moment: the picture depends on t alone
  else { tl.play(0); requestAnimationFrame(function frame(now) { const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1); last = now; T += dt; tl.update(dt); draw(); requestAnimationFrame(frame); }); }
} else if (Q.get('ui') !== '0') {
  setInterval(() => {
    const w = hero ? hero.animator.weights().filter(([, v]) => v > 0.005).map(([n, v]) => `${n} ${v.toFixed(2)}`).join('  ') : '';
    hud.textContent = `player: ${hero ? `imported rig (${model.stats.triangles} tris, ${model.animations.length} clips)  ${hero.state}  ${w}` : 'built-in traveller'}\n`
      + `foot placement ${hero && hero.ground ? 'on' : 'off'}${npc ? `   walker by root motion: ${npc.travelled.toFixed(1)} m, ${npc.steps.footL + npc.steps.footR} foot events` : ''}\nWASD move · Shift run · Space jump · G view`;
  }, 250);
}

// ?decoders=1 (and the check): the Draco and Basis decoders, as this build carries them, start up
async function probeDecoders() {
  const get = async (u, as) => (await fetch(u))[as]();
  const out = {};
  const dracoWasm = await get(decoders.draco.wasm, 'arrayBuffer');
  const draco = await new Promise((resolve, reject) => { try { new Function(`${dracoJs}\nreturn DracoDecoderModule;`)()({ wasmBinary: dracoWasm, onModuleLoaded: resolve }); } catch (e) { reject(e); } });
  const decoder = new draco.Decoder();
  out.draco = { wasmBytes: dracoWasm.byteLength, decoder: typeof decoder.DecodeBufferToMesh === 'function', inline: decoders.draco.wasm.startsWith('data:') };
  draco.destroy(decoder);
  const basisWasm = await get(decoders.basis.wasm, 'arrayBuffer');
  const basis = await new Promise((resolve, reject) => { try { const M = { wasmBinary: basisWasm, onRuntimeInitialized: () => resolve(M) }; new Function(`${basisJs}\nreturn BASIS;`)()(M); } catch (e) { reject(e); } });
  basis.initializeBasis();
  out.basis = { wasmBytes: basisWasm.byteLength, ktx2: typeof basis.KTX2File === 'function', inline: decoders.basis.wasm.startsWith('data:') };
  return out;
}
let dracoJs = '', basisJs = '';
const probe = async () => { dracoJs ||= await (await fetch(decoders.draco.js)).text(); basisJs ||= await (await fetch(decoders.basis.js)).text(); return probeDecoders(); };
if (Q.get('decoders') === '1') probe().then((r) => { hud.textContent += `\ndecoders: ${JSON.stringify(r)}`; });

window.__mirage = { world, built, play, assets, model, crate, hero, npc, retargeted, tl, tlActor, THREE, probe, groundAt, rigBytes: rigBytes.length, kit: { createRigModel, writeGLB, createAnimator, createTimeline } };
window.__READY = true;
