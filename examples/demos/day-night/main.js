// Demo: a day-to-night time-lapse of examples/snow-hut (its plan and modules, unchanged) under a running clock:
// the sun crosses, the lamps come on at dusk, the moon rises; the camera circles the hut. Code only, one file.
// URL: ?from=06:30  ?to=22:30  ?rate=40 (clock minutes per second)  ?date=2026-01-15  ?w=&h=
import { createWorldRenderer, placeDate, placeClock, skyAt } from '@mirage/core';
import { buildWorld } from '@mirage/world';
import plan from '../../snow-hut/plan.js';
import modules from '../../snow-hut/modules/index.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || innerWidth, H = +Q.get('h') || innerHeight, rate = +Q.get('rate') || 40;
const canvas = document.querySelector('canvas'), hud = document.querySelector('#hud');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const { shadowRadius, time, ...render } = plan.render, tz = render.place.tzHours, day = Q.get('date') || '2026-01-15';
const t0 = placeDate(day, Q.get('from') || '06:30', tz).getTime(), t1 = placeDate(day, Q.get('to') || '22:30', tz).getTime();
let date = new Date(t0);
const world = createWorldRenderer({ canvas, width: W, height: H, preserveDrawingBuffer: true, ...render, time: new Date(t0), post: { ...render.post, grain: 0.01 } });
const built = await buildWorld(world, { plan, modules, shared: {} });
const { camera } = world;
camera.aspect = W / H; camera.fov = 50; camera.near = 0.1; camera.far = 3000; camera.updateProjectionMatrix();
await world.prepare();

let last = null, T = 0;
function frame(now) {
  const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1); last = now; T += dt;   // the first frame is ?from=
  date = new Date(date.getTime() + dt * rate * 60000);
  if (date.getTime() > t1) date = new Date(t0);                      // loop the day
  // exposure adaptation and the light cross-fade run on clock time: in wall seconds they trail a 40 min/s clock
  world.setTime(new Date(date), { ease: true }); world.tick(dt * rate * 60);
  if (built.modules.ground) built.modules.ground.snow.value = T;
  const a = 0.35 + T * 0.03, r = 9.5;                               // a slow circle round the hut, inside the pines
  camera.position.set(Math.sin(a) * r, 2.6 + 0.6 * Math.sin(T * 0.07), -3 + Math.cos(a) * r);
  camera.lookAt(0, 1.9, -3); camera.updateMatrixWorld();
  world.renderFrame(T, { taa: true });
  const c = placeClock(date, tz), sun = skyAt(date, render.place).sun;
  hud.innerHTML = `<b>${c.time}</b>\nsun ${sun.elevation.toFixed(1)}°  ·  ${rate} min/s\nMirage · a code-only world, one file`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__mirage = { world, built };
window.__READY = true;
