#!/usr/bin/env node
// GPU load of a built example in headless Chrome: how many frames it draws when nothing happens, while the tab is
// hidden, and while walking (against the display's rate and the cap), with and without the power saver.
// usage: node gpu-load.mjs <dist dir | page.html> [<dist dir> ...] [--idle s]   exit 1 if any check fails
//   still     after the page's idle time (10 s) and the still refinement: 0 frames drawn in the next 10 s
//   hidden    another tab in front for 3 s: 0 frames, 0 animation callbacks (games: audio suspended)
//   walking   W held 3 s: frames drawn per second <= the display's rate and <= 60 (power saver: <= 30)
//   phone     390x844 with touch: the quality / fps corner covers none of a game's touch controls
import path from 'node:path';
import { launch, serve } from './chrome.mjs';

const args = process.argv.slice(2), i = args.indexOf('--idle');
const IDLE = i >= 0 ? +args[i + 1] : 10, targets = args.filter((a, k) => !a.startsWith('--') && !(i >= 0 && k === i + 1));
if (!targets.length) { console.error('usage: mirage-gpu-load <dist dir | page.html> [...]'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const b = await launch({ w: 960, h: 600, args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
for (const t of targets) {
  const srv = t.endsWith('.html') ? null : await serve(t);
  const url = (srv ? srv.url : 'file://' + path.resolve(t)) + '?w=960&h=600&grain=0&mode=walk';
  const page = await b.newPage();
  await page.evaluateOnNewDocument(() => {
    window.__raf = 0; const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => raf((ts) => { window.__raf++; f(ts); });
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
  const info = await page.evaluate(() => {
    const m = window.__mirage, w = m.world, rf = w.renderFrame;
    window.__draws = 0; w.renderFrame = (...a) => { window.__draws++; return rf(...a); };
    const start = document.querySelector('.mg-start button, .mg-start'); if (start) start.click();   // games
    return { quality: w.ctx.quality, hud: !!document.querySelector('.mirage-hud') };
  });
  const count = () => page.evaluate(() => {
    const m = window.__mirage, a = m.g && m.g.audio.ctx;
    return { draws: window.__draws, raf: window.__raf, vis: document.visibilityState, audio: a ? a.state : null, paused: !!(m.g && m.g.game.paused) };
  });
  const walk = async (ms) => {
    const a = await count(); await page.keyboard.down('KeyW'); await sleep(ms); await page.keyboard.up('KeyW');
    const z = await count(); return { fps: (z.draws - a.draws) / (ms / 1000), rate: (z.raf - a.raf) / (ms / 1000) };
  };
  const rows = [];
  const check = (name, ok, v) => { rows.push(`${ok ? 'pass' : 'FAIL'} ${name} (${v})`); if (!ok) failed++; };

  await sleep((IDLE + 3) * 1000);                       // the idle time, then the still refinement
  const s0 = await count(); await sleep(10000); const s1 = await count();
  check('still: 0 frames in 10 s', s1.draws - s0.draws === 0, `${s1.draws - s0.draws} drawn, ${s1.raf - s0.raf} callbacks`);

  const other = await b.newPage(); await other.goto('about:blank'); await other.bringToFront(); await sleep(300);
  const h0 = await count(); await sleep(3000); const h1 = await count();
  check('hidden: 0 frames', h1.draws === h0.draws && h1.raf === h0.raf && h1.vis === 'hidden' && (h1.audio === null || h1.audio !== 'running'),
    `${h1.draws - h0.draws} drawn, ${h1.raf - h0.raf} callbacks, ${h1.vis}, audio ${h1.audio}`);
  await other.close(); await page.bringToFront(); await sleep(500);
  const back = await count();
  check('back: audio runs again', back.audio === null || back.audio === 'running', `audio ${back.audio}`);
  if (back.paused) { await page.keyboard.press('Escape'); await sleep(300); }   // a game pauses when left

  const w = await walk(3000);
  check('walking: <= display rate and <= 60', w.fps <= Math.min(w.rate, 60) + 1.5, `${w.fps.toFixed(1)} fps, display ${w.rate.toFixed(1)}`);
  await page.evaluate(() => { const m = window.__mirage; (m.play || m.g.play).powerSaver = true; });
  const p = await walk(3000);
  check('power saver: <= 30', p.fps <= 31.5 && p.fps > 10, `${p.fps.toFixed(1)} fps`);
  await page.evaluate(() => { const m = window.__mirage; (m.play || m.g.play).powerSaver = false; localStorage.removeItem('mirage:power-saver'); });

  if (info.hud) {   // a phone: the corner must not cover a game's touch controls or its objective card
    const tp = await b.newPage();
    await tp.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true }, userAgent: PHONE });
    await tp.goto(url.replace('w=960&h=600', 'w=390&h=844') + '&start=1', { waitUntil: 'load' });
    await tp.waitForFunction('window.__READY === true', { timeout: 180000, polling: 100 });
    const o = await tp.evaluate(() => {
      const r = (e) => e.getBoundingClientRect(), hud = document.querySelector('.mirage-hud');
      const others = [...document.querySelectorAll('.mg-touch:not([hidden]) button, .mg-touch:not([hidden]) .mg-stick, .mg-hud > *')].filter((e) => r(e).width);
      const h = r(hud), hits = others.filter((e) => { const q = r(e); return q.left < h.right && h.left < q.right && q.top < h.bottom && h.top < q.bottom; });
      return { n: others.length, hits: hits.map((e) => e.className || e.textContent.trim() || e.tagName) };
    });
    if (o.n) check('phone: corner clear of the touch controls', !o.hits.length, o.hits.length ? `covers ${o.hits.join(', ')}` : `${o.n} controls`);
    await tp.close();
  }

  const dir = t.endsWith('.html') ? path.dirname(path.resolve(t)) : path.resolve(t);
  console.log(`${path.basename(path.basename(dir) === 'dist' ? path.dirname(dir) : dir)} (quality ${info.quality}, corner ${info.hud ? 'shown' : 'off'})\n  ` + rows.join('\n  '));
  await page.close(); if (srv) srv.close();
}
await b.close();
console.log(failed ? `gpu-load: ${failed} failing` : 'gpu-load: all pass');
process.exit(failed ? 1 : 0);
