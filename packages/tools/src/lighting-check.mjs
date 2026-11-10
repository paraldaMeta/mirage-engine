#!/usr/bin/env node
// Mirage original code. The opt-in lighting features (docs/lighting.md) in the real Chrome, on an example's dist:
//   node packages/tools/src/lighting-check.mjs examples/walled-garden/dist [examples/hello-courtyard/dist]
// For each page, with ?csm=1&gi=1&lights=64&lshadows=4: no console errors or shader-anchor warnings, the three shader
// parts are in the compiled programs, the image is not black; clustered shading draws the same image as the plain
// loop over all lights; shadow tiles are cached (no redraw while nothing moves, one when a lamp moves) and removing
// a lamp's shadow changes the image; the irradiance probes are baked and oriented (a red emitter put on +X, +Y, +Z
// of a probe is read back from that side, not the opposite one).
import { launch, serve, open } from './chrome.mjs';

const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!targets.length) { console.error('usage: lighting-check.mjs <dist dir>...'); process.exit(2); }
let failed = 0;
const browser = await launch({ w: 960, h: 600 });
try {
  for (const dir of targets) {
    const srv = await serve(dir);
    try {
      const { page, errors, warnings } = await open(browser, srv.url + '?hud=0&ui=0&grain=0&w=960&h=600&time=20:30&csm=1&gi=1&lights=64&lshadows=4');
      const r = await page.evaluate(() => {
        const { play, world, built } = window.__mirage, THREE = world.ctx.THREE, L = world.lighting, gl = world.renderer.getContext(), cv = world.renderer.domElement;
        play.stop();
        const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
        const g2 = c2.getContext('2d', { willReadFrequently: true });
        const grab = () => { play.render({ moving: false, spp: 2, frameIndex: 1 }); g2.drawImage(cv, 0, 0); const d = g2.getImageData(0, 0, c2.width, c2.height).data, o = new Float32Array(d.length / 4); for (let i = 0; i < o.length; i++) o[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; return o; };
        const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
        const diff = (a, b) => { let s = 0, m = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); s += d; if (d > m) m = d; } return { mean: +(s / a.length).toFixed(4), max: +m.toFixed(1) }; };
        const out = { info: {} };
        // programs carrying each part
        const src = world.renderer.info.programs.map((p) => gl.getShaderSource(p.fragmentShader) || '');
        out.programs = { all: src.length, csm: src.filter((s) => s.includes('mgCsmShadow(')).length, gi: src.filter((s) => s.includes('mgGiSample(')).length, lights: src.filter((s) => s.includes('mgLShadow(')).length };
        // clustered == plain loop, from two views
        const vps = built.plan.viewpoints;
        out.cluster = [];
        for (const v of [vps[0], vps[Math.min(5, vps.length - 1)], vps[vps.length > 7 ? 7 : 1]]) {
          play.place(v.eye, v.look, 'fly'); play.step(1 / 60);
          L.lights.cfg.cluster = true; grab(); const a0 = grab(), a = grab(); const mode = L.lights.info.mode, clipped = L.lights.info.clipped, idx = L.lights.info.indices, binMs = L.lights.info.binMs;
          L.lights.cfg.cluster = false; const b = grab(); const mode2 = L.lights.info.mode;
          L.lights.cfg.cluster = true;
          out.cluster.push({ view: v.name, luma: +mean(a).toFixed(2), ...diff(a, b), again: diff(a0, a), modes: [mode, mode2], indices: idx, clipped, binMs });
        }
        // the shadow cache
        for (let i = 0; i < 6; i++) grab();
        const quiet = L.lights.info.redrawsLastFrame;
        const lamp = world.scene.children.find((o) => o.isPointLight && o.userData.mgClustered);
        const withShadow = grab();
        lamp.position.x += 0.4; grab(); const afterMove = L.lights.info.redrawsLastFrame;
        lamp.position.x -= 0.4; grab(); grab();
        const eye = lamp.position.clone().add({ x: 2.5, y: 0.6, z: 3 });
        play.place(eye.toArray(), lamp.position.toArray().map((v, i) => v - (i === 1 ? 1.2 : 0)), 'fly'); play.step(1 / 60);
        // a new static caster under the lamp: invalidate() redraws the cached tiles, its shadow lands on what is below
        const blk = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.8), new THREE.MeshStandardMaterial({ color: 0x888888 }));
        blk.castShadow = true; blk.position.copy(lamp.position); blk.position.y -= 0.5; world.scene.add(blk);
        L.invalidate(); grab();
        const s1 = grab();
        L.removeLight(lamp); L.addLight(lamp, { shadow: false }); const s0 = grab();
        L.removeLight(lamp); L.addLight(lamp, { shadow: true }); const s2 = grab();
        world.scene.remove(blk); L.invalidate(); grab();
        out.shadow = { quiet, afterMove, onOff: diff(s1, s0), backOn: diff(s1, s2), shadowed: L.lights.info.shadowed };
        void withShadow;
        // probes
        const gi = L.gi;
        out.gi = { ...gi.info };
        {
          const T = THREE, g = gi.grid, i = Math.floor(g.probes / 2), c = [i % g.cols % g.counts[0], Math.floor(i / g.cols), Math.floor((i % g.cols) / g.counts[0])];
          const p = c.map((k, a) => gi.cfg.min[a] + k * g.step[a]);
          out.gi.axes = {};
          for (const [name, d] of [['+x', [1, 0, 0]], ['+y', [0, 1, 0]], ['+z', [0, 0, 1]], ['-x', [-1, 0, 0]], ['-z', [0, 0, -1]]]) {
            const m = new T.Mesh(new T.BoxGeometry(d[0] ? 0.05 : 0.7, d[1] ? 0.05 : 0.7, d[2] ? 0.05 : 0.7), new T.MeshBasicMaterial({ color: new T.Color(40, 0, 0), side: T.DoubleSide }));
            m.position.set(p[0] + d[0] * 0.3, p[1] + d[1] * 0.3, p[2] + d[2] * 0.3); world.scene.add(m);
            gi.bake(1);
            const toward = gi.read(i, d)[0], away = gi.read(i, d.map((v) => -v))[0];
            out.gi.axes[name] = [+toward.toFixed(3), +away.toFixed(3)];
            world.scene.remove(m); m.geometry.dispose(); m.material.dispose();
          }
          gi.bake();
        }
        out.info = { lights: { ...L.lights.info }, csm: L.csm.info ? (typeof L.csm.info === 'function' ? L.csm.info() : L.csm.info) : null, materials: L.materials };
        return out;
      });
      const bad = [];
      const anchor = warnings.filter((w) => w.includes('[lighting]'));
      if (errors.length) bad.push('console errors: ' + errors.slice(0, 3).join(' | '));
      if (anchor.length) bad.push('anchor warnings: ' + anchor.join(' | '));
      for (const k of ['csm', 'gi', 'lights']) if (!r.programs[k]) bad.push('no program carries the ' + k + ' part');
      for (const c of r.cluster) {
        if (c.luma < 1) bad.push('black image at ' + c.view);
        if (c.modes[0] !== 2 || c.modes[1] !== 1) bad.push('cluster mode not switched at ' + c.view + ': ' + c.modes);
        if (c.clipped) bad.push('lights dropped from a cell at ' + c.view + ': ' + c.clipped);
        if (c.mean > 0.05 + 2 * c.again.mean || c.max > 12 + c.again.max) bad.push('clustered differs from the plain loop at ' + c.view + ': mean ' + c.mean + ' max ' + c.max);   // again: the same view drawn twice (animated water, foliage)
      }
      if (r.shadow.quiet !== 0) bad.push('shadow tiles redrawn while nothing moved: ' + r.shadow.quiet);
      if (r.shadow.afterMove !== 1) bad.push('a moved lamp redrew ' + r.shadow.afterMove + ' tiles, expected 1');
      if (!(r.shadow.onOff.mean > 0.02)) bad.push('a lamp\'s shadow changes nothing: ' + JSON.stringify(r.shadow.onOff));
      if (r.shadow.backOn.mean > 0.02 + 0.1 * r.shadow.onOff.mean) bad.push('shadow back on differs: ' + JSON.stringify(r.shadow.backOn));   // a re-added lamp may get another tile size
      if (!(r.gi.probes > 0) || r.gi.baked < r.gi.probes) bad.push('probes not baked: ' + JSON.stringify(r.gi));
      for (const [k, [t, a]] of Object.entries(r.gi.axes)) if (!(t > 2 * a && t > 0.5)) bad.push('probe orientation ' + k + ': toward ' + t + ' away ' + a);
      console.log(JSON.stringify({ dir, ok: !bad.length, ...r, bad }, null, 1));
      if (bad.length) failed++;
      await page.close();
    } finally { srv.close(); }
  }
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
