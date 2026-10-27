#!/usr/bin/env node
// Touch screens (B8): a phone-sized page with touch emulation, driven by real touch events (CDP), play's loop on
// 60 Hz timestamps. Plain @mirage/play: a finger on the left half walks (dragged a little) and runs (dragged far),
// one on the right half turns the view. A game (@mirage/game's overlay): tap to start, the overlay's stick walks
// and, pushed out past its rim, runs. Fails when a finger does not move or turn the player, when running is not
// faster than walking, or on console errors.
//   node packages/tools/src/touch-check.mjs <dist dir>... [--frames 40]
import path from 'node:path';
import { launch, serve, open } from './chrome.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const targets = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!targets.length) { console.error('usage: touch-check.mjs <dist dir>... [--frames n]'); process.exit(2); }
const N = +flag('frames', 40), W = 844, H = 390;

async function check(dir) {
  const srv = await serve(dir);
  const browser = await launch({ w: W, h: H });
  try {
    const { page, errors } = await open(browser, srv.url + '?hud=0', { viewport: { width: W, height: H, hasTouch: true } });
    await page.evaluate(() => { window.__raf = { q: [] }; window.requestAnimationFrame = (cb) => (window.__raf.q.push(cb), 1); });
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => {
      let t = performance.now();
      window.__tick = (n) => { for (let i = 0; i < n; i++) { const q = window.__raf.q.splice(0); t += 1000 / 60; for (const cb of q) cb(t); } };
    });
    // Chrome hands touch moves to the page with its next real frame: wait for it before driving the loop
    const settle = () => new Promise((r) => setTimeout(r, 60));
    const tick = (n) => page.evaluate((n) => window.__tick(n), n);
    const pos = () => page.evaluate(() => window.__mirage.play.state().pos);
    const yaw = () => page.evaluate(() => window.__mirage.play.yaw);
    const game = await page.evaluate(() => !!window.__mirage.g);
    let stick;
    if (game) {
      await page.touchscreen.tap(W / 2, H / 2);   // the start screen
      await tick(5);
      const b = await page.evaluate(() => { const r = document.querySelector('.mg-stick').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2]; });
      stick = { at: [b[0], b[1]], walk: b[2] * 0.7, run: b[2] * 1.6 };
    } else stick = { at: [W * 0.25, H * 0.6], walk: 40, run: 110 };
    await tick(5);
    const R = { game, started: game ? await page.evaluate(() => window.__mirage.g.ui.started) : null };
    if (!game) {
      // a view that opens in orbit: the touch bar's button walks (it shows after the first touch)
      await page.touchscreen.tap(W * 0.5, H * 0.95);
      await tick(2);
      R.modeFrom = await page.evaluate(() => window.__mirage.play.mode);
      const b = await page.$('.mirage-touchbar [data-t=mode]');
      if (R.modeFrom === 'orbit' && b) { await b.tap(); await tick(5); }
      R.mode = await page.evaluate(() => window.__mirage.play.mode);
    }
    const inputAt = () => page.evaluate(() => { const g = window.__mirage.g; return g ? { move: g.input.move(), run: g.input.down('run') } : null; });
    // walk, then run, one finger held down
    let p0 = await pos();
    const f = await page.touchscreen.touchStart(...stick.at);
    await f.move(stick.at[0], stick.at[1] - stick.walk); await settle();
    await tick(N);
    let p1 = await pos();
    await f.move(stick.at[0], stick.at[1] - stick.run); await settle();
    R.input = await inputAt();
    await tick(N);
    const p2 = await pos();
    await f.end(); await settle();
    await tick(5);
    const d = (a, b) => +Math.hypot(b[0] - a[0], b[2] - a[2]).toFixed(3);
    R.walk = d(p0, p1); R.run = d(p1, p2);
    // look: a finger on the right half
    const y0 = await yaw();
    const g = await page.touchscreen.touchStart(W * 0.75, H * 0.5);
    for (let i = 1; i <= 5; i++) { await g.move(W * 0.75 + i * 30, H * 0.5); await settle(); await tick(1); }
    await g.end(); await settle();
    await tick(5);
    R.turned = +((await yaw()) - y0).toFixed(3);
    p0 = await pos(); await tick(N); p1 = await pos();
    R.drift = d(p0, p1);   // nothing held: the player stands
    R.errors = errors;
    return R;
  } finally { await browser.close(); srv.close(); }
}

let failed = 0;
for (const dir of targets) {
  const name = path.basename(path.dirname(path.resolve(dir)));
  const R = await check(dir);
  console.log(name, JSON.stringify(R));
  const fail = [];
  if (R.game && !R.started) fail.push('a tap did not start the game');
  if (!R.game && R.mode !== 'walk') fail.push(`no way to walk on touch (mode ${R.mode}, opened in ${R.modeFrom})`);
  if (!(R.walk > 0.3)) fail.push(`a finger did not walk (${R.walk} m in ${N} frames)`);
  // run is 4.2 m/s, walk 1.5: a full stick without running is only 1 / 0.7 of the walk drag
  if (!(R.run > R.walk * 2.5)) fail.push(`dragging far does not run (${R.run} vs ${R.walk} m walking)`);
  if (!(Math.abs(R.turned) > 0.2)) fail.push(`a finger did not turn the view (${R.turned} rad)`);
  if (R.drift > 0.05) fail.push(`the player kept moving after the finger lifted (${R.drift} m)`);
  if (R.errors.length) fail.push(`console errors: ${R.errors.join(' | ')}`);
  if (fail.length) failed++;
  console.log(fail.length ? `  FAIL\n    ${fail.join('\n    ')}` : '  ok');
}
console.log(failed ? `touch: ${failed} failing` : 'touch: ok');
process.exit(failed ? 1 : 0);
