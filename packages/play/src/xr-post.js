// Mirage original code. The engine's post chain in a headset: each eye drawn through a core Pipeline of its own
// (HDR scene with MSAA, ambient occlusion, bloom or the bloom pyramid, exposure / auto exposure, tone map, grade,
// LUT), then both eyes copied into the XR layer with their depth, so what xr.js draws afterwards (controllers,
// teleport arc, labels, UI panels, the comfort vignette) is occluded by the world and is not graded twice.
// ---------------------------------------------------------------------------
// createXR(play, { post: true })            // or { post: { msaa: 4, ao: true, bloom: true, depth: true, scale: 1 } }
// low level (what createXR does every frame while presenting in VR):
//   const xp = createXRPost(world, { msaa: 4 });
//   xp.render(T, { xr: renderer.xr, rig, head: cam, overlay: root, shadow, dt });
//   xp.setLevel({ scale: 0.85, ao: false });   // the frame-time governor (xr-quality.js) degrades through this
//   xp.stats  -> { width, height, scale, resizes, eyes }
// ---------------------------------------------------------------------------
// What runs per eye and what does not (and why):
//   yes  scene (RGBA16F, MSAA), SSAO (half resolution), bloom / bloom pyramid, auto exposure (metered on the left
//        eye, applied to both: two meters would give the eyes different exposures), tone map, white balance,
//        saturation / contrast / lift, sharpen, LUT.
//   no   TAA and taa2 (sub-pixel jitter swims under the compositor's reprojection and the two eyes' histories
//        disagree), motion blur and depth of field (the eye is the camera), chromatic aberration (the headset's
//        lens correction is already applied by the compositor), film grain (uncorrelated between the eyes it reads
//        as a surface at no depth), the lens vignette (each eye's is off-centre; xr.js has its comfort vignette).
//        light2's screen-space reflections and volumetrics: this pipeline is not the world's, they are not wired.
// The shadow map is drawn once (first eye). AR sessions keep the direct path: the pipeline's frame is opaque.
// ponytail: no multiview (three 0.186 has no OVR_multiview2 path: the scene is drawn once per eye), and the dynamic
// scale reallocates the pipeline's targets when it steps (a few discrete steps, with hysteresis in xr-quality.js).
import * as THREE from 'three';
import { Pipeline } from '@mirage/core';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** The passes a headset does not get, whatever world.post says (see the header). */
export const XR_POST_OFF = { taa2: 0, upscale: 0, motionBlur: 0, bokeh: 0, chroma: 0, grain: 0, vignette: 0, dof: 0 };

/** The post settings of one eye: `P` (the frame's) with the unsafe passes off and the level's switches applied. */
export function xrEyePost(P, level = {}) {
  const e = { ...P, ...XR_POST_OFF };
  if (level.ao === false) e.ao = 0;
  if (level.bloom === false) e.bloom = 0;
  if (level.lut === false) e.lut = null;
  return e;
}

/** The pipeline size of an eye `w x h` at `scale` (even numbers, at least 64): pure, for the checks. */
export function xrEyeSize(w, h, scale = 1) {
  const s = Math.min(1, Math.max(0.25, +scale || 1));
  return [Math.max(64, Math.round((w * s) / 2) * 2), Math.max(64, Math.round((h * s) / 2) * 2)];
}

export function createXRPost(world, opts = {}) {
  const { renderer, scene } = world;
  const o = { msaa: 4, ao: true, bloom: true, lut: true, depth: true, scale: 1, aoSamples: 8, ...opts };
  const level = { scale: o.scale, ao: o.ao, bloom: o.bloom, lut: o.lut };
  let pp = null, out = null, pw = 0, ph = 0, frameIndex = 0;
  const eye = new THREE.PerspectiveCamera(); eye.matrixAutoUpdate = false;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false;
  // the eye's depth next to its graded colour (the pipeline's depth texture is the next eye's a moment later)
  const depthMat = new THREE.ShaderMaterial({ vertexShader: VS, uniforms: { tDepth: { value: null } },
    fragmentShader: 'varying vec2 vUv; uniform sampler2D tDepth; void main(){ gl_FragColor = vec4(0.0); gl_FragDepth = texture2D(tDepth, vUv).x; }',
    depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, colorWrite: false, toneMapped: false });
  // both eyes into the XR layer: display-referred colour as the grade wrote it, and the scene's depth
  const presentMat = new THREE.ShaderMaterial({ vertexShader: VS, uniforms: { tColor: { value: null }, tDepth: { value: null }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uDepth: { value: 1 } },
    fragmentShader: `varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform vec4 uRect; uniform float uDepth;
      void main(){ vec2 uv = uRect.xy + vUv * uRect.zw; gl_FragColor = vec4(texture2D(tColor, uv).rgb, 1.0); gl_FragDepth = uDepth > 0.5 ? texture2D(tDepth, uv).x : 1.0; }`,
    depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, toneMapped: false });
  const stats = { width: 0, height: 0, scale: 1, resizes: 0, eyes: 0 };
  const _vp = new THREE.Vector4(), _sc = new THREE.Vector4(), _cc = new THREE.Color();
  const draw = (mat, target) => {
    const ac = renderer.autoClear; renderer.autoClear = false;
    quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, quadCam);
    renderer.autoClear = ac;
  };

  function fit(w, h, n) {
    const [tw, th] = xrEyeSize(w, h, level.scale);
    if (pp && tw === pw && th === ph && out.width === tw * n) return;
    if (!pp) pp = new Pipeline(renderer, { width: tw, height: th, msaa: o.msaa, aoSamples: o.aoSamples });
    else pp.setSize(tw, th);
    if (out) { out.depthTexture.dispose(); out.dispose(); }
    out = new THREE.WebGLRenderTarget(tw * n, th, { type: THREE.UnsignedByteType, depthTexture: new THREE.DepthTexture(tw * n, th, THREE.FloatType) });
    out.texture.minFilter = out.texture.magFilter = THREE.LinearFilter; out.texture.generateMipmaps = false;
    out.depthTexture.minFilter = out.depthTexture.magFilter = THREE.NearestFilter;
    out.scissorTest = true;
    pw = tw; ph = th; stats.width = tw; stats.height = th; stats.scale = level.scale; stats.resizes++;
  }

  /** One stereo frame. f: { xr (renderer.xr), rig (the reference space in the world), head (the camera three poses:
   *  shadow cascades fit to it), overlay (drawn after, in the layer, with the XR camera), light (a light in the
   *  overlay, visible only while it is drawn), shadow, fog, dt }.
   *  Returns false when there is nothing to draw into yet (no layer target or no views). */
  function render(T, f) {
    const xrm = f.xr, target = renderer.getRenderTarget(), views = xrm.getCamera().cameras;
    if (!target || !views.length) return false;
    const n = views.length, v0 = views[0].viewport;
    fit(v0.z, v0.w, n);
    const ov = f.overlay, ovVis = ov ? ov.visible : false, auto = renderer.shadowMap.autoUpdate;
    const xe = xrm.enabled, ca = renderer.getClearAlpha();
    renderer.getClearColor(_cc);
    stats.eyes = n;
    world.renderViews(T, { camera: f.head, shadow: f.shadow, fog: f.fog, dt: f.dt, draw: (P) => {
      const Pe = xrEyePost(P, level);
      xrm.enabled = false; if (ov) ov.visible = false;
      try {
        for (let i = 0; i < n; i++) {
          const c = views[i];
          eye.matrix.multiplyMatrices(f.rig.matrixWorld, c.matrix);
          eye.matrix.decompose(eye.position, eye.quaternion, eye.scale);
          eye.matrixWorld.copy(eye.matrix); eye.matrixWorldInverse.copy(eye.matrix).invert();
          eye.projectionMatrix.copy(c.projectionMatrix); eye.projectionMatrixInverse.copy(c.projectionMatrix).invert();
          eye.layers.mask = f.head.layers.mask;
          if (i > 0) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; }   // one shadow map per frame
          pp.begin();
          pp.add(scene, eye, 1, 0, Pe, 0, false);
          out.viewport.set(i * pw, 0, pw, ph); out.scissor.copy(out.viewport);
          pp.end(Pe, frameIndex, out, { dt: f.dt, still: !(f.dt > 0), meter: i === 0 });
          if (o.depth) { depthMat.uniforms.tDepth.value = pp.sceneRT.depthTexture; draw(depthMat, out); }
        }
        // into the layer: one bind, both eyes (leaving a multisampled layer target between the eyes would make
        // three resolve it, and throw its samples away, twice)
        _vp.copy(target.viewport); _sc.copy(target.scissor);
        const st = target.scissorTest;
        renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, true);
        presentMat.uniforms.tColor.value = out.texture; presentMat.uniforms.tDepth.value = out.depthTexture; presentMat.uniforms.uDepth.value = o.depth ? 1 : 0;
        target.scissorTest = true;
        for (let i = 0; i < n; i++) {
          target.viewport.copy(views[i].viewport); target.scissor.copy(views[i].viewport);
          presentMat.uniforms.uRect.value.set(i / n, 0, 1 / n, 1);
          draw(presentMat, target);
        }
        target.viewport.copy(_vp); target.scissor.copy(_sc); target.scissorTest = st;
        renderer.setRenderTarget(target);
      } finally {
        renderer.shadowMap.autoUpdate = auto; renderer.setClearColor(_cc, ca);
        xrm.enabled = xe; if (ov) ov.visible = ovVis;
      }
      // the overlay with the XR camera (both eyes in one render), over the world's depth
      if (ov && ovVis) { const ac = renderer.autoClear; renderer.autoClear = false; if (f.light) f.light.visible = true; try { renderer.render(ov, f.head); } finally { renderer.autoClear = ac; if (f.light) f.light.visible = false; } }
    } });
    frameIndex++;
    return true;
  }

  return {
    render, stats, level, off: XR_POST_OFF,
    get pipeline() { return pp; }, get target() { return out; },
    /** { scale, ao, bloom, lut }: what the governor may take away; the size changes at the next frame. */
    setLevel(l) { Object.assign(level, l); },
    dispose() { if (pp) pp.dispose(); if (out) { out.depthTexture.dispose(); out.dispose(); } quad.geometry.dispose(); depthMat.dispose(); presentMat.dispose(); pp = out = null; },
  };
}
