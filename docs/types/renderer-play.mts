// Compile only: this file is never executed. GPU/DOM creation below describes consumer API usage.
import * as THREE from 'three';
import { createWorldRenderer, Pipeline, DEFAULT_POST, createEnvLight, createTextures, createLod,
  createSky, createSkyUniforms, createStars, skyState, lightAt, skyAt, placeDate, placeClock, dirFromAltAz,
  ATMO, ATMOSPHERE_GLSL, transmit, transmitAtGround, scatter, skyLightAt, FOG, installFog,
  deviceProfile, pickQuality, QUALITY_LEVELS, QUALITY_KEY, NOISE_GLSL, TEX_GLSL,
  type WorldRenderer, type RenderFrameOptions } from '@mirage/core';
import { createWorldRenderer as createSubpath } from '@mirage/core/world';
import { Pipeline as SubPipeline } from '@mirage/core/post';
import { julianDay, gmst, refraction, sunEquatorial, moonEquatorial, equatorialToWorld } from '@mirage/core/sky-time';
import { brightStars } from '@mirage/core/stars';
import { definePlan, buildWorld, type WorldModule } from '@mirage/world';
import { createPlay, createCharacter, createWalker, makeGrid, bakeWalkGrid, mountWorld, BODY, MAXL } from '@mirage/play';
import { frameGate } from '@mirage/play/play';
import { buildCharacterModel } from '@mirage/play/character-model';

const sharedRenderer = new THREE.WebGLRenderer();
const world: WorldRenderer = createWorldRenderer({ renderer: sharedRenderer, width: 960, height: 540,
  quality: 'medium', place: { lat: 25, lon: 121, tzHours: 8 }, time: { day: '2026-11-06', time: '16:30' },
  post: { tonemap: 'aces', exposure: 0.5 }, fog: { groundDensity: 0.002 }, wind: { dir: [1, 0], strength: 0.5 },
  shadow: { center: [0, 0, 0], radius: 20 }, envProbe: [0, 3, 0] });
createSubpath({ canvas: document.createElement('canvas') });
const maybeLight: number | undefined = world.light?.exposure;
// @ts-expect-error lighting is null before first initialization
const prematureLight: number = world.light.exposure;
const stopUpdate: () => void = world.ctx.onUpdate(seconds => { world.G.uUser.value.x = seconds; });
stopUpdate();
// @ts-expect-error onUpdate returns its unsubscribe function, not a count
const callbackCount: number = world.ctx.onUpdate(() => {});
world.setTime('golden'); world.setTime(Date.now(), { ease: true }); world.tick(1 / 60);
await world.prepare(); world.captureEnv(false);
world.setAmbientVolumes([{ min: [-2, 0, -2], max: [2, 3, 2], factor: 0.3 }]);
const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
const target = new THREE.WebGLRenderTarget(960, 540);
const frame: RenderFrameOptions = { camera, getCamera: _seconds => world.camera, spp: 4, dt: 1 / 60,
  shutter: 0.5, frameIndex: 1, target, taa: 0.12, shadow: { center: [0, 0, 0], radius: 20 } };
world.renderFrame(1, frame); world.renderFrame(2, { target: null }); world.resize(1280, 720);
// @ts-expect-error only render targets or null can receive a rendered frame
world.renderFrame(1, { target: document.createElement('canvas') });
// @ts-expect-error shadow centers are three-dimensional
createWorldRenderer({ shadow: { center: [0, 0], radius: 10 } });
// @ts-expect-error known quality levels are checked
createWorldRenderer({ quality: 'ultra' });
// @ts-expect-error fixed sun needs elevation and azimuth
world.setTime({ elevation: 6 });
const pipeline: Pipeline = new SubPipeline(sharedRenderer, { width: 960, height: 540 });
pipeline.begin(); pipeline.add(world.scene, camera, 1, 0, DEFAULT_POST);
pipeline.taa(new THREE.Matrix4(), new THREE.Matrix4(), 0.12);
pipeline.end(DEFAULT_POST, 1, target); pipeline.blend(target, target, 0.5); pipeline.setSize(1280, 720); pipeline.dispose();
const env = createEnvLight(sharedRenderer);
// @ts-expect-error no capture exists before capture() is called
env.texture.dispose();
env.capture(world.scene, [0, 3, 0]); env.tick(0.1); env.texture?.dispose(); env.dispose();
const tex = createTextures(world, { manifest: { sets: {
  rock: { tile: 2, mean: [0.3, 0.3, 0.3], hMean: 0.5, rough: 0.9, files: { c: 'rock-c.png', n: 'rock-n.png' } },
} }, url: file => '/tex/' + file });
const material = tex.material('rock', { mapping: 'tri', tint: [0.4, 0.5, 0.3], roughness: 0.9 });
tex.hooks(['rock'], { albedo: 'diffuseColor.rgb *= 0.8;' }); tex.info('rock').tile.toFixed();
const textures: (THREE.Texture | undefined)[] = await tex.ready(); tex.dispose(); material.dispose();
const lod = createLod(); const group = await lod.register(world.scene, { filter: mesh => mesh.visible, weights: { uv: 20 } });
group?.sphere.clone(); lod.update(world.camera, { heightPx: 720 }); lod.reset();
// @ts-expect-error registration can find no eligible meshes
group.full;
const uniforms = createSkyUniforms(); createSky(uniforms); createStars(uniforms); brightStars();
lightAt(skyState('golden')); skyAt(new Date(), { lat: 25, lon: 121 });
placeClock(placeDate('2026-11-06', '16:30', 8), 8); dirFromAltAz(30, 250);
julianDay(new Date()); gmst(new Date()); refraction(1); sunEquatorial(new Date()); moonEquatorial(new Date()); equatorialToWorld(0, 25);
transmit(ATMO.Rg, 0.2); transmitAtGround(6); scatter([0, 1, 0], [1, 0, 0], 20); skyLightAt(6);
installFog(); FOG.params[0] = 0.001; deviceProfile(sharedRenderer); await pickQuality({ storage: null, nav: {} });
const strings: string[] = [ATMOSPHERE_GLSL, NOISE_GLSL, TEX_GLSL, QUALITY_KEY, ...QUALITY_LEVELS];

const plan = definePlan({ name: 'typed-runtime', bounds: [-8, -8, 8, 8],
  spawn: { eye: [0, 1.62, 6], look: [0, 1.62, 0] }, trail: { width: 2 } });
type Shared = { tint: number };
const module: WorldModule<typeof plan, Shared> = { name: 'ground', build(ctx) {
  const tint: number = ctx.shared.tint;
  const width: number = ctx.plan.trail.width;
  ctx.scene.add(new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, width), ctx.mat.std({ color: tint })));
} };
await buildWorld(world, { plan, modules: [module], shared: { tint: 0x778855 } });
const grid = makeGrid({ nx: 1, nz: 1, x0: 0, z0: 0, cell: 1, floors: new Float32Array(MAXL * 2), count: new Uint8Array([1]) });
grid.support(0, 0, 0)?.[0].toFixed(); grid.layers(0, 0); grid.idx(0, 0);
const walker = createWalker(grid, { pos: [0, 0, 0], body: { airStep: BODY.airStep } });
walker.place([0, 0, 0]).update(1 / 60, { x: 1, jump: true }); walker.fits(0, 0);
const baked = bakeWalkGrid(world, { bounds: plan.bounds }); baked.stats.ms.toFixed();
const play = createPlay(world, { plan, grid, walker, mode: 'game', refine: [4, 16], appearance: { palette: { scarf: '#dd8844' } },
  input: dt => ({ x: dt, z: 0, jumpPressed: true }), onStep: dt => dt > 0,
  onVisibility(shown) { if (shown) world.captureEnv(); } });
const custom = createPlay(world, { plan, grid, walker: {
  pos: [0, 0, 0], vy: 0, onGround: true, blocked: false, body: { eye: 1.7 },
  update(_dt, _input) {}, place(_position) {}, customController: 'host',
} });
custom.walker.customController.toUpperCase(); custom.stop();
play.stop(); play.step(1 / 60); play.render({ target }); play.render(); play.start();
play.walker.fits(0, 0); play.turn(0.1, 0, 1); play.place([0, 2, 6], [0, 1, 0], 'walk');
play.setMode('orbit'); play.viewpoint(0); play.lookAt([0, 0, 0]); play.syncWalkerView();
play.yaw += 0.1; play.pitch = 0.2; play.viewSize = 12; play.powerSaver = true; play.wake(); play.state().pos[0].toFixed();
// @ts-expect-error createPlay requires a plan with viewpoints (definePlan supplies them)
createPlay(world, { plan: { name: 'raw', bounds: [-1, -1, 1, 1] } });
// @ts-expect-error unknown mode
play.setMode('vehicle');
const avatar = createCharacter(world, { palette: { jacket: 0x447766 } });
avatar.update(0.1, { distance: 0.2, verticalSpeed: 1, onGround: false }); avatar.reset(); avatar.dispose();
const model = buildCharacterModel(world, { jacket: 1, trousers: 2, scarf: 3, leather: 4, skin: 5, hair: 6 });
model.limbs[0]?.knee.rotateX(0.2); model.mesh.geometry.dispose();
const mounted = await mountWorld({ renderer: sharedRenderer, plan, modules: [module],
  shared: async rendererWorld => ({ tint: rendererWorld.scene.visible ? 0x778855 : 0 }) });
mounted.plan.trail.width.toFixed(); mounted.walker().fits(0, 0); mounted.update(0.1);
mounted.render(camera, { moving: false, target, shadow: { center: [0, 0, 0], radius: 12 } });
mounted.setSize(800, 600); mounted.dispose(); frameGate(() => 60)(1000);
// These are separate fixtures of ownership. Real applications stop loops before disposing a world.
custom.dispose(); play.dispose(); world.dispose(); target.dispose(); sharedRenderer.dispose();
