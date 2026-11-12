// Demo: the sound library of @miragekit/game (docs/sounds.md), as a page to listen to. Every card renders its sound
// when clicked (renderSound at the device's sample rate) and plays it once; a loop plays until clicked again. The
// numbers on a card pick a variant. Plain DOM and Web Audio: no three.js, no world.
// URL: ?cat=weapon | ui | step | ambience | machine | vehicle | nature   ?q=<search>
// Contract with tools: window.__sounds = { names, render(name, v) -> Float32Array, play(name, v) }, __READY.
import { SOUNDS, SOUND_CATEGORIES, soundNames, renderSound } from '@miragekit/game/sounds';

const Q = new URLSearchParams(location.search);
const LABEL = { weapon: 'Weapons', ui: 'Interface', step: 'Footsteps', ambience: 'Ambience (loops)', machine: 'Machines & sci-fi', vehicle: 'Vehicles', nature: 'Nature' };
let ctx = null, master = null, current = null;
const cache = new Map();
const main = document.querySelector('#main'), bar = document.querySelector('#bar'), q = document.querySelector('#q'), vol = document.querySelector('#vol');
document.querySelector('#count').textContent = `· ${soundNames().length} sounds, ${Object.values(SOUNDS).reduce((a, s) => a + s.n, 0)} variants`;

function audio() {
  if (!ctx) { ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = +vol.value; master.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function data(name, v) {
  const k = name + '/' + v, sr = ctx ? ctx.sampleRate : 48000;
  if (!cache.has(k)) { const t0 = performance.now(); cache.set(k, { pcm: renderSound(name, sr, v), ms: performance.now() - t0 }); }
  return cache.get(k);
}
function stop() { if (current) { try { current.src.stop(); } catch { /* ended */ } current.card.classList.remove('playing'); current = null; } }
function play(name, v, card) {
  const a = audio(), { pcm, ms } = data(name, v), b = a.createBuffer(1, pcm.length, a.sampleRate);
  b.copyToChannel(pcm, 0);
  const again = current && current.name === name && current.v === v && SOUNDS[name].loop;
  stop();
  if (again) return;   // a second click on a playing loop stops it
  const src = a.createBufferSource(); src.buffer = b; src.loop = !!SOUNDS[name].loop; src.connect(master); src.start();
  current = { src, name, v, card }; card.classList.add('playing');
  src.onended = () => { if (current?.src === src) stop(); };
  draw(card.querySelector('canvas'), pcm);
  card.querySelector('.t').textContent = `${(pcm.length / a.sampleRate).toFixed(2)} s · made in ${ms.toFixed(0)} ms`;
}
function draw(cv, pcm) {
  const w = (cv.width = cv.clientWidth * devicePixelRatio), h = (cv.height = cv.clientHeight * devicePixelRatio), g = cv.getContext('2d'), step = pcm.length / w;
  g.clearRect(0, 0, w, h); g.fillStyle = '#5ff7ff';
  for (let x = 0; x < w; x++) { let lo = 0, hi = 0; for (let i = Math.floor(x * step), e = Math.floor((x + 1) * step); i < e; i++) { if (pcm[i] < lo) lo = pcm[i]; if (pcm[i] > hi) hi = pcm[i]; } g.fillRect(x, h / 2 - hi * h / 2, 1, Math.max(1, (hi - lo) * h / 2)); }
}
function card(name) {
  const s = SOUNDS[name], el = document.createElement('div');
  el.className = 'card'; el.dataset.name = name; el.dataset.text = (name + ' ' + s.desc).toLowerCase();
  el.innerHTML = `<div class="n">${name}${s.loop ? ' <span class="tag">loop</span>' : ''}</div><div class="d"></div><canvas></canvas><div class="m"><span class="t">${s.n} variant${s.n > 1 ? 's' : ''}</span><span class="v"></span></div>`;
  el.querySelector('.d').textContent = s.desc;
  let v = 0;
  const vs = el.querySelector('.v');
  if (s.n > 1) for (let i = 0; i < s.n; i++) {
    const b = document.createElement('button'); b.textContent = i + 1; if (!i) b.classList.add('on');
    b.onclick = (e) => { e.stopPropagation(); v = i; vs.querySelectorAll('button').forEach((x, k) => x.classList.toggle('on', k === i)); play(name, v, el); };
    vs.appendChild(b);
  }
  el.onclick = () => play(name, v, el);
  return el;
}
const sections = {};
for (const c of SOUND_CATEGORIES) {
  const sec = document.createElement('section'), grid = document.createElement('div');
  sec.innerHTML = `<h2>${LABEL[c]} · ${soundNames(c).length}</h2>`; grid.className = 'grid';
  for (const n of soundNames(c)) grid.appendChild(card(n));
  sec.appendChild(grid); main.appendChild(sec); sections[c] = sec;
}
let only = Q.get('cat');
const chips = ['all', ...SOUND_CATEGORIES].map((c) => {
  const b = document.createElement('button'); b.className = 'chip'; b.textContent = c === 'all' ? 'all' : LABEL[c].replace(' (loops)', '');
  b.onclick = () => { only = c === 'all' ? null : c; filter(); };
  bar.insertBefore(b, q); return [c, b];
});
function filter() {
  const t = q.value.trim().toLowerCase();
  for (const [c, b] of chips) b.classList.toggle('on', (only ?? 'all') === c);
  for (const c of SOUND_CATEGORIES) {
    let any = 0;
    for (const el of sections[c].querySelectorAll('.card')) { const on = !t || el.dataset.text.includes(t); el.style.display = on ? '' : 'none'; any += on; }
    sections[c].style.display = (!only || only === c) && any ? '' : 'none';
  }
}
q.value = Q.get('q') || ''; q.oninput = filter; filter();
vol.oninput = () => { if (master) master.gain.value = +vol.value; };
addEventListener('keydown', (e) => { if (e.key === 'Escape') stop(); });
if (!window.AudioContext) document.querySelector('#note').textContent = 'This browser has no Web Audio.';
window.__sounds = { names: soundNames(), render: (n, v = 0) => renderSound(n, 48000, v), play: (n, v = 0) => play(n, v, main.querySelector(`[data-name="${n}"]`)) };
window.__READY = true;
