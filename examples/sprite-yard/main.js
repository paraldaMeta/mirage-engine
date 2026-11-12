// Sprite Yard: the 2.5D kit on a small Mirage world (docs/sprites-25d.md). Placeholder atlases drawn in code (no
// art files), sprite actors lit by the world's sun, sky and lamp, an iso camera, click to walk on the walk grid
// (with the reachable fallback), click a creature to strike it (the blow lands on the atlas's hit frame), and a
// cutaway through the walls and roofs between the camera and the hero.
//   ?time=night | dusk | noon    ?atlas=<url of an atlas.json> (the hero's art; a placeholder when it fails)
//   ?w=&h= (a fixed size)        ?quality=low | medium | high
// Contract with the tools: window.__mirage = { world, built, play } (play: the still adapter at the end) and
// window.__READY = true once playable.
import * as THREE from 'three';
import { createWorldRenderer, pickQuality } from '@miragekit/core';
import { buildWorld } from '@miragekit/world';
import { createCutaway } from '@miragekit/world/kits/cutaway';
import {
  bakeWalkGrid, createNavGrid, createNavAgent, createNavCrowd,
  createSpriteActor, makePlaceholderAtlas, makeAtlas, loadAtlas, createIsoCamera, pickWalkGrid, reachableGoal,
} from '@miragekit/play';
import plan from './plan.js';
import modules from './modules.js';

const Q = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
let W = Number(Q.get('w')) || innerWidth, H = Number(Q.get('h')) || innerHeight;
const quality = Q.get('quality') || (await pickQuality()).quality;
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const TIMES = { night: { elevation: -18, azimuth: 300 }, dusk: { elevation: 2, azimuth: 262 }, noon: { elevation: 62, azimuth: 180 } };
const time = TIMES[Q.get('time')] || plan.render.time;
const world = createWorldRenderer({ ...plan.render, time, canvas, width: W, height: H, quality, preserveDrawingBuffer: true });

const cut = createCutaway({ radius: 1.9 });
const built = await buildWorld(world, { plan, modules, shared: { cut } });
if (built.report.failed.length) throw new Error(built.report.failed.map((r) => r.name + ': ' + r.error).join('\n'));
const walk = built.plan.walk;
const grid = bakeWalkGrid(world, { bounds: built.plan.bounds, yMin: walk.yMin, yMax: walk.yMax });
const nav = createNavGrid(grid, { coarse: 4 });
const crowd = createNavCrowd(nav);

// ---- atlases: drawn in code, in the atlas format (?atlas= swaps in real art for the hero)
const atlasOf = (spec) => { const { json, canvas: c } = makePlaceholderAtlas(spec); return makeAtlas(json, c, { source: 'placeholder' }); };
const heroSpec = { id: 'hero', shape: 'humanoid', body: '#3f6fb5', trim: '#f0c27a', weapon: '#d8dde6' };
const heroAtlas = Q.get('atlas') ? await loadAtlas(Q.get('atlas'), { placeholder: heroSpec }) : atlasOf(heroSpec);
const atlases = new Map();
const critterAtlas = (c) => { const k = c.shape + c.body; if (!atlases.has(k)) atlases.set(k, atlasOf({ id: k, shape: c.shape, body: c.body })); return atlases.get(k); };

// ---- actors: a nav agent (where it is) + a sprite actor (what it looks like)
const R = 0.3, flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const groundUnder = (agent) => (x, z) => grid.groundAt(x, z, agent.pos[1] + 0.5);
function actor(atlas, pos, speed, opts = {}) {
  const agent = createNavAgent(nav, { radius: R, speed, pos: nav.nearest(pos, { radius: R, snap: 3 }) || pos });
  agent.walker.body.walk = agent.walker.body.run = speed;
  crowd.add(agent);
  return { agent, sprite: createSpriteActor(world, atlas, { ground: groundUnder(agent), ...opts }), home: pos };
}
const hero = { ...actor(heroAtlas, plan.hero, 3.2, { silhouette: true }), order: null, swing: null, cd: 0, asked: null };
const critters = plan.critters.map((c) => ({ ...actor(critterAtlas(c), c.at, 1.1), hp: 3, dead: 0, wait: 0 }));

// a seeded wander, so a still after reset() is the same every time
let seed = 1;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function reset() {
  seed = 1; clock = 0; hero.order = null; hero.swing = null; hero.cd = 0; mark.visible = false;
  for (const a of [hero, ...critters]) {
    a.agent.place(nav.nearest(a.home, { radius: R, snap: 3 }) || a.home); a.agent.stop();
    a.sprite.play('idle', { restart: true }).setFade(1).setFacing(0);
    if (a !== hero) { a.hp = 3; a.dead = 0; a.wait = 0; if (!crowd.agents.includes(a.agent)) crowd.add(a.agent); }
  }
}

// ---- the camera, the click marker
const iso = createIsoCamera({ yaw: 35, pitch: 52, distance: 22, min: 10, max: 34 });
iso.bind(canvas);
let fixed = null;   // a plan viewpoint placed by the tools; any input gives the camera back to the iso camera
const mark = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, depthWrite: false }));
mark.userData.collide = false; mark.visible = false;
world.scene.add(mark);
let markT = 0;
await world.prepare();   // after the actors and the marker: their programs compile here, not on the first frame

// ---- input: hover outlines, click to walk or strike
const pointer = { x: -1, y: -1, in: false }, rect = {}, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let hover = null;
function updateHover() {
  hover = null;
  if (!pointer.in) return;
  let best = Infinity;
  for (const c of critters) {
    if (c.dead) continue;
    const s = c.sprite.screenRect(world.camera, W, H, rect), pad = Math.max(0, (34 - (s.x1 - s.x0)) / 2);
    if (pointer.x >= s.x0 - pad && pointer.x <= s.x1 + pad && pointer.y >= s.y0 - pad && pointer.y <= s.y1 + pad && s.depth < best) { best = s.depth; hover = c; }
  }
}
const at = (e) => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.in = true; };
canvas.addEventListener('pointermove', at);
canvas.addEventListener('pointerleave', () => { pointer.in = false; });
canvas.addEventListener('pointerdown', (e) => {
  fixed = null;
  if (e.button !== 0) return;
  at(e); updateHover();
  if (hover) { hero.order = { attack: hover }; hero.asked = null; return; }
  ndc.set((pointer.x / W) * 2 - 1, -(pointer.y / H) * 2 + 1);
  ray.setFromCamera(ndc, world.camera);
  const eye = world.camera.position;
  const p = pickWalkGrid(grid, ray.ray, { nav, radius: R, skip: (x, y, z) => cut.hides(x, y, z, eye) });
  if (!p) return;
  stopSwing();
  const goal = reachableGoal(nav, p, { radius: R, from: hero.agent.pos, tryGoal: (q) => hero.agent.setGoal(q) });
  if (!goal) { hero.agent.stop(); return; }   // nothing reachable near it: the last ring point tried is no goal
  hero.order = { move: goal };
  mark.position.set(goal[0], goal[1] + 0.04, goal[2]); mark.visible = true; markT = 0;
});

// ---- the simulation
let clock = 0;
function stopSwing() { if (hero.swing && !hero.swing.hit) { hero.swing = null; hero.sprite.play('idle'); } }
function strike(c) {
  c.hp -= 1; c.sprite.flash(1);
  if (c.hp <= 0) {
    c.dead = clock; c.agent.stop(); crowd.remove(c.agent);
    c.sprite.play('die', { restart: true });
    return;
  }
  c.sprite.play('hurt', { restart: true, onEnd: () => c.sprite.play('idle') });
  // step back from the hero
  const dx = c.agent.pos[0] - hero.agent.pos[0], dz = c.agent.pos[2] - hero.agent.pos[2], l = Math.hypot(dx, dz) || 1;
  const q = nav.nearest([c.agent.pos[0] + (dx / l) * 2.5, c.agent.pos[1], c.agent.pos[2] + (dz / l) * 2.5], { radius: R, snap: 1 });
  if (q) c.agent.setGoal(q);
  c.wait = 1.5;
}
function updateHero(dt) {
  hero.cd = Math.max(0, hero.cd - dt);
  const o = hero.order, a = hero.agent;
  if (o && o.attack) {
    const c = o.attack, reach = 0.9 + R * 2;
    if (c.dead) { hero.order = null; a.stop(); }
    else if (flat(a.pos, c.agent.pos) > reach) {
      if (!hero.swing && (!hero.asked || flat(hero.asked, c.agent.pos) > 0.6 || a.arrived)) { hero.asked = c.agent.pos.slice(); reachableGoal(nav, hero.asked, { radius: R, from: a.pos, tryGoal: (q) => a.setGoal(q) }); }
    } else {
      if (a.moving) a.stop();
      hero.asked = null;
      hero.sprite.faceToward(c.agent.pos[0], c.agent.pos[2]);
      if (!hero.swing && hero.cd <= 0) {
        const sw = hero.swing = { hit: false };
        hero.cd = 0.9;
        hero.sprite.play('attack', {
          restart: true,
          onHit: () => { sw.hit = true; if (hero.swing === sw && !c.dead && flat(a.pos, c.agent.pos) <= reach + 0.5) strike(c); },
          onEnd: () => { if (hero.swing === sw) hero.swing = null; hero.sprite.play('idle'); },
        });
      }
    }
  } else if (o && o.move && a.arrived) hero.order = null;
}
function updateCritter(c, dt) {
  if (c.dead) {
    const t = clock - c.dead;
    if (t > 1.2) c.sprite.setFade(Math.max(0, 1 - (t - 1.2)));
    if (t > 4) {   // back home, whole again
      c.dead = 0; c.hp = 3; c.agent.place(nav.nearest(c.home, { radius: R, snap: 3 }) || c.home); crowd.add(c.agent);
      c.sprite.setFade(1).play('idle', { restart: true });
    }
    return;
  }
  c.wait -= dt;
  if (c.wait <= 0 && (c.agent.arrived || !c.agent.moving)) {
    const a = rand() * Math.PI * 2, r = 1 + rand() * 3.5;
    const q = nav.nearest([c.home[0] + Math.cos(a) * r, c.home[1], c.home[2] + Math.sin(a) * r], { radius: R, snap: 1 });
    if (q) c.agent.setGoal(q);
    c.wait = 2 + rand() * 3;
  }
}
const walkAnim = (x) => {
  const a = x.agent;
  if (a.moving && !a.arrived && Math.hypot(a.heading[0], a.heading[1]) > 0.1) x.sprite.setFacing(Math.atan2(a.heading[0], a.heading[1]));
  const n = x.sprite.name;
  if (n === 'idle' || n === 'walk') x.sprite.play(a.moving && !a.arrived ? 'walk' : 'idle');
};
function simulate(dt) {
  clock += dt;
  updateHero(dt);
  for (const c of critters) updateCritter(c, dt);
  crowd.update(dt);
  if (!hero.swing) walkAnim(hero);
  for (const c of critters) if (!c.dead) walkAnim(c);
  markT += dt; mark.material.opacity = Math.max(0, 1 - markT / 1.2); mark.visible = mark.visible && markT < 1.2;
}
// the camera, then the sprites (they pick their direction row from the camera's yaw), the hover outlines, the cut
const feet = new THREE.Vector3(), fwd = new THREE.Vector3();
function pose(dt) {
  feet.fromArray(hero.agent.pos);
  if (fixed) { world.camera.position.fromArray(fixed.eye); world.camera.lookAt(...fixed.look); world.camera.updateMatrixWorld(); }
  else iso.follow(feet).update(dt).apply(world.camera);
  world.camera.getWorldDirection(fwd);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  for (const x of [hero, ...critters]) { x.sprite.group.position.fromArray(x.agent.pos); x.sprite.update(dt, yaw); }
  updateHover();
  for (const c of critters) c.sprite.outline(c === hero.order?.attack ? 'enemy' : c === hover ? 'hover' : null);
  canvas.style.cursor = hover ? 'crosshair' : 'default';
  cut.set(feet.x, feet.y + 1, feet.z, 1.9);
}
const shadow = () => ({ center: [feet.x, feet.y, feet.z], radius: 20 });

// ---- the frame loop
let running = false, last = 0;
function frame(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  simulate(dt); pose(dt);
  world.tick(dt);
  world.renderFrame(clock, { taa: true, dt, shadow: shadow() });
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  if (Q.get('w')) return;
  W = innerWidth; H = innerHeight;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  world.resize(W, H); world.camera.aspect = W / H; world.camera.updateProjectionMatrix();
});

// ---- the still adapter: the subset of a createPlay object the repository's tools drive (mirage-snap, the
// determinism and world checks). place() and viewpoint() reset the simulation, so a still repeats exactly.
const play = {
  world, grid, nav, mode: 'game', stats: {},
  get yaw() { return iso.yaw; },
  stop() { running = false; },
  start() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } },
  step(dt) { simulate(dt); pose(dt); },
  place(eye, look) { reset(); fixed = { eye: [...eye], look: [...look] }; pose(0); },
  viewpoint(i) {
    const v = built.plan.viewpoints[i];
    play.place(v.eye, v.look);
    if (v.hero) { hero.agent.place(nav.nearest(v.hero, { radius: R, snap: 3 }) || v.hero); pose(0); }
  },
  render({ moving = true, spp = 6, frameIndex, transparent = false, converge, target } = {}) {
    const o = { shadow: shadow(), ...(frameIndex !== undefined ? { frameIndex } : {}) };
    if (transparent) return world.renderTransparent(clock, { ...o, spp });
    return world.renderFrame(clock, moving ? { ...o, taa: true, target } : { ...o, spp, target, ...(converge !== undefined ? { converge } : {}) });
  },
};
reset(); pose(0); play.start();
window.__mirage = { world, built, play, grid, nav, hero, critters, iso, cut };
window.__READY = true;
