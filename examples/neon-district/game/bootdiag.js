// The start, measured on the device (a phone's stall can only be seen there). Tiny dim text in the bottom-left corner
// while the shaders compile; ?boot=1, or a tap on it, keeps it up through the first 30 s of play, with a COPY button
// (the JSON of window.__ndBoot to the clipboard). What it shows, to tell four causes apart (a slow compile per program,
// no real parallel compile, main-thread JS, the network):
//   the GPU, KHR_parallel_shader_compile, DPR / canvas / quality / clarity, the browser, cores, memory, an iframe
//   the network: HTML responseEnd and size, the single file's unpack
//   each boot phase (performance marks): its length, the ms spent inside synchronous GL calls and the two worst calls
//     (bootProbe wraps them before the renderer exists: readPixels, getProgramParameter, ... shaderSource)
//   programs: at the title / ready / now, lit / other, GLSL sent (KB), programs checked synchronously before the title
//   readiness: when 25 / 50 / 75 / 100 % of the programs were ready, and whether any poll saw one not ready (async link)
//   calibration (?boot=1): a blocking compile + link of a tiny program, a real lit one and a surface bake
//   the five longest main-thread gaps (a MessageChannel heartbeat: Safari has no longtask) and the phase of each
//   every frame over 200 ms in the first 30 s after DEPLOY, with the programs and GL-sync ms it held
const MARKS = [['nd:eval', 'script'], ['nd:renderer', 'renderer'], ['nd:built', 'buildWorld'], ['nd:setup0', 'setup'], ['nd:setup1', 'setup end'],
  ['nd:title', 'title'], ['nd:prepare0', 'compile'], ['nd:prepare1', 'compile end'], ['nd:compiled', 'DEPLOY ready'], ['nd:ready', 'light baked'], ['nd:deploy', 'DEPLOY'], ['nd:frame1', 'first frame']];
const SYNC = ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'getUniformLocation', 'getActiveUniform', 'readPixels',
  'getError', 'finish', 'clientWaitSync', 'checkFramebufferStatus', 'texImage2D', 'texSubImage2D', 'generateMipmap', 'linkProgram', 'compileShader', 'shaderSource'];
const LINK_STATUS = 0x8b82, PHASES = new Set(MARKS.map((m) => m[0]));

/** Before the renderer exists: time the synchronous GL calls per boot phase, count the GLSL sent, keep one lit and one
 *  bake program's sources for the calibration, and a main-thread heartbeat. Returns the probe bootDiag reads. */
export function bootProbe() {
  const P = { phase: 'nd:boot', gl: {}, glsl: 0, shaders: 0, tex: { n: 0, mb: 0 }, syncLinks: 0, gaps: [], vis: [], src: {} };
  const mark = performance.mark.bind(performance);
  performance.mark = (name, o) => { if (PHASES.has(name)) P.phase = name; return mark(name, o); };
  let lastVs = '';
  for (const C of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
    if (!C) continue;
    const proto = C.prototype;
    for (const name of SYNC) {
      const f = proto[name];
      if (typeof f !== 'function') continue;
      proto[name] = function (...a) {
        const t = performance.now();
        try { return f.apply(this, a); } finally {
          const ph = (P.gl[P.phase] ||= {}), e = (ph[name] ||= [0, 0]);
          e[0]++; e[1] += performance.now() - t;
          if (name === 'shaderSource') {
            const s = a[1] || ''; P.glsl += s.length; P.shaders++;
            if (s.includes('gl_Position')) lastVs = s;
            else if (!P.src.lit && s.includes('#define STANDARD')) P.src.lit = [lastVs, s];
            else if (!P.src.bake && P.phase === 'nd:renderer' && s.length > 4000) P.src.bake = [lastVs, s];
          } else if (name === 'texImage2D' || name === 'texSubImage2D') {
            P.tex.n++; const k = name === 'texImage2D' ? 3 : 4, src = a[a.length - 1], w = typeof a[k] === 'number' && a.length >= 8 ? a[k] : src?.width, h = typeof a[k + 1] === 'number' && a.length >= 8 ? a[k + 1] : src?.height;
            if (w && h) P.tex.mb += (w * h * 4) / 1048576;
          } else if ((name === 'getProgramParameter' && a[1] === LINK_STATUS) || name === 'getProgramInfoLog') {
            if (!performance.getEntriesByName('nd:title').length) P.syncLinks++;
          }
        }
      };
    }
  }
  // the heartbeat: a message every 50 ms; a gap is the time beyond that the main thread could not answer
  const ch = new MessageChannel();
  let last = performance.now();
  ch.port1.onmessage = () => {
    const now = performance.now(), gap = now - last - 50;
    if (gap > 60) { P.gaps.push({ ms: Math.round(gap), at: Math.round(now), phase: P.phase }); P.gaps.sort((x, y) => y.ms - x.ms); P.gaps.length = Math.min(P.gaps.length, 5); }
    last = now;
    if (!P.stop) setTimeout(() => ch.port2.postMessage(0), 50);
  };
  ch.port2.postMessage(0);
  document.addEventListener('visibilitychange', () => P.vis.push(`${document.visibilityState}@${Math.round(performance.now())}`));
  return P;
}

export function bootDiag({ world, Q, quality, why, clarity, pixelRatio, title, probe: P = null }) {
  const r = world.renderer, gl = r.getContext(), progs = r.info.programs || [];
  const dbg = gl.getExtension('WEBGL_debug_renderer_info'), nav = performance.getEntriesByType('navigation')[0];
  const ua = navigator.userAgent, browser = (ua.match(/(CriOS|FxiOS|EdgA?|SamsungBrowser|Chrome|Firefox|Version)\/[\d.]+/) || [''])[0].replace('Version', 'Safari'), os = (ua.match(/iPhone OS [\d_]+|Android [\d.]+|Mac OS X [\d_]+|Windows NT [\d.]+/) || [''])[0];
  const D = window.__ndBoot = {
    gpu: String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    khr: !!gl.getExtension('KHR_parallel_shader_compile'),
    dpr: +devicePixelRatio.toFixed(2), pr: pixelRatio, quality, why, clarity, canvas: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    env: { browser, os, cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory ?? null, iframe: self !== top },
    net: { html: nav ? Math.round(nav.responseEnd) : null, kb: nav ? Math.round((nav.transferSize || nav.encodedBodySize || 0) / 1024) : null },
    marks: {}, phases: [], programs: { title: progs.length, ready: 0, deploy: 0, now: 0, lit: 0 }, readiness: {}, asyncLink: false, calib: null, long: [], frames: 0,
  };
  Object.defineProperty(D, 'renderer', { value: r });   // (for the measuring scripts; not in the JSON)
  let pinned = Q.get('boot') === '1', compiling = true, el = null, t0 = 0, last = 0, lastN = progs.length, lastSync = 0, timer = 0;
  const s = (v) => (v === undefined || v === null ? '-' : (v / 1000).toFixed(2) + 's');
  const syncMs = (ph) => Object.values(P?.gl[ph] || {}).reduce((a, e) => a + e[1], 0);
  const syncAll = () => Object.keys(P?.gl || {}).reduce((a, ph) => a + syncMs(ph), 0);
  const read = () => {
    for (const [k] of MARKS) { const m = performance.getEntriesByName(k).at(-1); if (m) D.marks[k] = Math.round(m.startTime); }
    for (const k of ['nd:unpack0', 'nd:unpack1']) { const m = performance.getEntriesByName(k)[0]; if (m) D.net[k.slice(3)] = Math.round(m.startTime); }
    D.programs.now = progs.length; D.programs.lit = progs.filter((p) => /STANDARD|PHYSICAL|physical/.test(p.cacheKey.slice(0, 40))).length;
    if (P) {
      // each phase: from its mark to the next one, the ms inside synchronous GL calls, the two worst calls
      const seen = MARKS.map(([k, n]) => [k, n, D.marks[k]]).filter((x) => x[2] !== undefined).sort((a, b) => a[2] - b[2]);
      D.phases = seen.map(([k, n, t], i) => {
        const top = Object.entries(P.gl[k] || {}).sort((a, b) => b[1][1] - a[1][1]).slice(0, 2).map(([c, e]) => `${c} ${Math.round(e[1])}ms/${e[0]}`);
        return { phase: n, ms: (seen[i + 1]?.[2] ?? Math.round(performance.now())) - t, sync: Math.round(syncMs(k)), top };
      });
      Object.assign(D, { glslKB: Math.round(P.glsl / 1024), shaders: P.shaders, syncLinksBeforeTitle: P.syncLinks, tex: { n: P.tex.n, mb: +P.tex.mb.toFixed(1) }, gaps: P.gaps, vis: P.vis });
    }
  };
  const text = () => {
    read();
    const m = D.marks, rows = [`${D.gpu}`,
      `parallel compile ${D.khr ? 'yes' : 'NO'} · dpr ${D.dpr} x${D.pr} · ${D.canvas} · ${D.quality} (${D.why || '-'}) · ${D.clarity} · ${D.env.browser} ${D.env.os} · ${D.env.cores} cores${D.env.mem ? ` · ${D.env.mem} GB` : ''}${D.env.iframe ? ' · iframe' : ''}`,
      `net: html ${s(D.net.html)} ${D.net.kb ?? '-'} KB${D.net.unpack0 !== undefined ? ` · unpack ${s(D.net.unpack0)}-${s(D.net.unpack1)}` : ''}${D.vis?.length ? ' · ' + D.vis.join(' ') : ''}`];
    if (D.phases.length) for (const p of D.phases) rows.push(`${p.phase.padEnd(12)} ${String(p.ms).padStart(5)}ms | GL-sync ${String(p.sync).padStart(4)}ms | ${p.top.join(' · ')}`);
    else rows.push(MARKS.filter(([k]) => m[k] !== undefined).map(([k, n]) => `${n} ${s(m[k])}`).join(' · '));
    rows.push(`marks: ${MARKS.filter(([k]) => m[k] !== undefined).map(([k, n]) => `${n} ${s(m[k])}`).join(' · ')}`);
    rows.push(`programs ${D.programs.title} at title, ${D.programs.ready || '…'} ready, ${D.programs.now} now (+${D.programs.now - (D.programs.deploy || D.programs.now)} since DEPLOY) · lit ${D.programs.lit} other ${D.programs.now - D.programs.lit}`
      + (P ? ` · GLSL ${D.glslKB} KB in ${D.shaders} shaders · ${D.syncLinksBeforeTitle} sync link checks before title · tex ${D.tex.n} ${D.tex.mb} MB` : ''));
    const rd = D.readiness;
    rows.push(`ready 25% ${s(rd[25])} · 50% ${s(rd[50])} · 75% ${s(rd[75])} · 100% ${s(rd[100])} · async link ${D.asyncLink ? 'yes' : 'no'}${D.calib ? ` · calib: tiny ${D.calib.tiny} ms · lit ${D.calib.lit} ms · bake ${D.calib.bake} ms` : ''}`);
    if (D.gaps?.length) rows.push('gaps: ' + D.gaps.map((g) => `${g.ms}ms@${s(g.at)} ${g.phase.slice(3)}`).join(' · '));
    if (D.long.length) rows.push('long frames: ' + D.long.map((f) => `${(f.t / 1000).toFixed(1)}s ${f.ms}ms${f.p ? ` +${f.p} prog` : ''}${f.sync ? ` sync ${f.sync}ms` : ''}${f.what ? ' ' + f.what : ''}`).join(' · '));
    else if (t0) rows.push('long frames: none');
    return rows.join('\n');
  };
  // unpinned: a small pill at the top right (over the scene, clear of the menu); a tap pins it: an opaque panel above
  // everything along the top, COPY first, the text scrollable
  let pre = null, copy = null;
  const style = () => {
    el.style.cssText = pinned
      ? 'position:fixed;left:0;right:0;top:0;z-index:2147483000;max-height:40vh;overflow:auto;-webkit-overflow-scrolling:touch;padding:max(8px,env(safe-area-inset-top)) 10px 10px;background:#02060af2;border-bottom:1px solid #19d8ff80;font:10px/1.35 ui-monospace,monospace;color:#dff;pointer-events:auto'
      : 'position:fixed;right:8px;top:max(56px,calc(env(safe-area-inset-top) + 48px));z-index:2147483000;padding:5px 9px;border-radius:12px;background:#02060ad0;border:1px solid #19d8ff60;font:10px/1.2 ui-monospace,monospace;color:#bfe;pointer-events:auto;cursor:pointer';
    copy.style.display = pinned ? 'block' : 'none';
  };
  const show = () => {
    if (!el) {
      el = document.createElement('div');
      el.id = 'nd-boot';
      pre = document.createElement('pre'); pre.style.cssText = 'margin:0;white-space:pre-wrap;user-select:text';
      copy = document.createElement('button');
      copy.textContent = 'COPY (boot numbers to the clipboard)';
      copy.style.cssText = 'display:none;font:600 15px system-ui,sans-serif;color:#02080d;background:#19d8ff;border:0;border-radius:6px;padding:12px 18px;margin:0 0 8px;min-width:60%;touch-action:manipulation';
      copy.addEventListener('pointerdown', (e) => e.stopPropagation());
      copy.addEventListener('click', (e) => {
        e.stopPropagation(); read(); const t = JSON.stringify(D);
        const fallback = () => { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { /* none */ } ta.remove(); if (ok) copy.textContent = 'COPIED'; else pre.textContent = t; };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(() => { copy.textContent = 'COPIED'; }, fallback); else fallback();
      });
      el.append(copy, pre);
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => { if (e.target === copy) return; e.stopPropagation(); pinned = !pinned; style(); pre.textContent = text(); });
      style();
      document.body.appendChild(el);
    }
    if (pinned) pre.textContent = text();
    else { read(); const m = D.marks, last = MARKS.filter(([k]) => m[k] !== undefined).at(-1); pre.textContent = `BOOT ${last ? `${last[1]} ${s(m[last[0]])}` : '…'} · ${D.programs.now} prog · tap`; }
  };
  const hideUnlessPinned = () => { if (!pinned && el) { el.remove(); el = null; } };
  timer = setInterval(() => { if (compiling || pinned) show(); else hideUnlessPinned(); }, 500);
  show();

  // a blocking compile + link, timed (a salt so no cache can answer): the per-program bill on this device
  function calibrate() {
    const one = (vs, fs) => {
      if (!vs || !fs) return null;
      const salt = `\n// calib ${Math.random()}\n`, t = performance.now(), p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const sh = gl.createShader(type); gl.shaderSource(sh, src + salt); gl.compileShader(sh); gl.attachShader(p, sh); }
      gl.linkProgram(p); gl.getProgramParameter(p, LINK_STATUS);
      const ms = Math.round(performance.now() - t);
      gl.deleteProgram(p);
      return ms;
    };
    const tiny = ['#version 300 es\nin vec3 p; void main(){ gl_Position = vec4(p, 1.0); }', '#version 300 es\nprecision highp float; out vec4 c; void main(){ c = vec4(1.0); }'];
    D.calib = { tiny: one(...tiny), lit: one(...(P?.src.lit || [])), bake: one(...(P?.src.bake || [])) };
  }

  // the first 30 s after DEPLOY (the title gone: the intro, then play): each frame's gap, the programs it built, what else ran
  let first = true;
  function frame(now) {
    if (!t0) {
      if (title.shown) { last = now; lastN = progs.length; lastSync = syncAll(); requestAnimationFrame(frame); return; }
      performance.mark('nd:deploy'); t0 = now; D.programs.deploy = progs.length;
    }
    if (now - t0 > 30000) { if (P) P.stop = true; if (!pinned) { clearInterval(timer); hideUnlessPinned(); } return; }
    const n = progs.length, dt = now - last, sy = syncAll();
    if (first && now > t0) { performance.mark('nd:frame1'); first = false; }
    D.frames++;
    if (dt > 200) D.long.push({ t: Math.round(now - t0), ms: Math.round(dt), p: n - lastN, sync: Math.round(sy - lastSync), what: world.lighting?.busy ? 'light bake' : '' });
    lastN = n; last = now; lastSync = sy;
    requestAnimationFrame(frame);
  }
  return {
    /** the compile poll (main.js, every 120 ms): ready programs of n */
    progress(ready, n) {
      if (ready < n) D.asyncLink = true;
      for (const q of [25, 50, 75, 100]) if (D.readiness[q] === undefined && ready >= (n * q) / 100) D.readiness[q] = Math.round(performance.now());
    },
    /** the compile is done (DEPLOY is ready) */
    ready() {
      compiling = false; D.programs.ready = progs.length; D.readiness[100] ??= Math.round(performance.now());
      if (Q.get('boot') === '1') calibrate();
      read(); if (!pinned) hideUnlessPinned(); else show(); requestAnimationFrame(frame);
    },
  };
}
