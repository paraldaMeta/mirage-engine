// The start, measured on the device (a phone's stall can only be seen there): the GPU, whether the driver compiles
// shaders in parallel, the canvas, the boot's phases (performance marks) and every frame over 200 ms in the first 30 s
// after DEPLOY with what ran in it (new programs, a light bake). Tiny dim text in the bottom-left corner while the
// shaders compile; ?boot=1, or a tap on it, keeps it up through the first 30 s of play (screenshot it).
// window.__ndBoot holds the same numbers (the measuring scripts read it).
const MARKS = [['nd:eval', 'script'], ['nd:renderer', 'renderer'], ['nd:built', 'buildWorld'], ['nd:setup0', 'setup'], ['nd:setup1', 'setup end'],
  ['nd:title', 'title'], ['nd:prepare0', 'compile'], ['nd:prepare1', 'compile end'], ['nd:compiled', 'DEPLOY ready'], ['nd:ready', 'light baked'], ['nd:deploy', 'DEPLOY'], ['nd:frame1', 'first frame']];

export function bootDiag({ world, Q, quality, pixelRatio, title }) {
  const r = world.renderer, gl = r.getContext(), progs = r.info.programs || [];
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const D = window.__ndBoot = {
    gpu: String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    khr: !!gl.getExtension('KHR_parallel_shader_compile'),
    dpr: devicePixelRatio, pr: pixelRatio, quality, canvas: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    marks: {}, programs: { title: progs.length, ready: 0, deploy: 0, now: 0 }, long: [], frames: 0,
  };
  Object.defineProperty(D, 'renderer', { value: r });   // (for the measuring scripts; not in the JSON)
  let pinned = Q.get('boot') === '1', compiling = true, el = null, t0 = 0, last = 0, lastN = progs.length, timer = 0;
  const ms = (v) => (v === undefined ? '-' : (v / 1000).toFixed(2) + 's');
  const read = () => { for (const [k] of MARKS) { const m = performance.getEntriesByName(k).at(-1); if (m) D.marks[k] = Math.round(m.startTime); } D.programs.now = progs.length; };
  const text = () => {
    read();
    const m = D.marks, rows = [`${D.gpu}`, `parallel compile ${D.khr ? 'yes' : 'NO'} · dpr ${D.dpr} x${D.pr} · ${D.canvas} · ${D.quality}`,
      MARKS.filter(([k]) => m[k] !== undefined).map(([k, n]) => `${n} ${ms(m[k])}`).join(' · '),
      `programs ${D.programs.title} at title, ${D.programs.ready || '…'} ready, ${D.programs.now} now (+${D.programs.now - (D.programs.deploy || D.programs.now)} since DEPLOY)`];
    for (const f of performance.getEntriesByType('mark').filter((e) => e.name.startsWith('mg:compile'))) rows[2] += ` · ${f.name.slice(3)} ${ms(f.startTime)} (${f.detail})`;
    if (D.long.length) rows.push('long frames: ' + D.long.map((f) => `${(f.t / 1000).toFixed(1)}s ${f.ms}ms${f.p ? ` +${f.p} prog` : ''}${f.what ? ' ' + f.what : ''}`).join(' · '));
    else if (t0) rows.push('long frames: none');
    return rows.join('\n');
  };
  const show = () => {
    if (!el) {
      el = document.createElement('pre');
      el.id = 'nd-boot';
      el.style.cssText = 'position:fixed;left:6px;bottom:4px;z-index:40;margin:0;max-width:min(96vw,720px);white-space:pre-wrap;font:9px/1.3 ui-monospace,monospace;color:#cfe;opacity:.5;pointer-events:auto;user-select:text;text-shadow:0 0 2px #000';
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); pinned = !pinned; el.style.opacity = pinned ? 0.8 : 0.5; });
      document.body.appendChild(el);
    }
    el.textContent = text();
  };
  const hideUnlessPinned = () => { if (!pinned && el) { el.remove(); el = null; } };
  timer = setInterval(() => { if (compiling || pinned) show(); else hideUnlessPinned(); }, 500);
  show();

  // the first 30 s after DEPLOY (the title gone: the intro, then play): each frame's gap, the programs it built, what else ran
  let first = true;
  function frame(now) {
    if (!t0) {
      if (title.shown) { last = now; lastN = progs.length; requestAnimationFrame(frame); return; }
      performance.mark('nd:deploy'); t0 = now; D.programs.deploy = progs.length;
    }
    if (now - t0 > 30000) { if (!pinned) { clearInterval(timer); hideUnlessPinned(); } return; }
    const n = progs.length, dt = now - last;
    if (first && now > t0) { performance.mark('nd:frame1'); first = false; }
    D.frames++;
    if (dt > 200) D.long.push({ t: Math.round(now - t0), ms: Math.round(dt), p: n - lastN, what: world.lighting?.busy ? 'light bake' : '' });
    lastN = n; last = now;
    requestAnimationFrame(frame);
  }
  return {
    /** the compile is done (DEPLOY is ready) */
    ready() { compiling = false; D.programs.ready = progs.length; read(); if (!pinned) hideUnlessPinned(); else show(); requestAnimationFrame(frame); },
  };
}
