// Mirage original code.
// ---------------------------------------------------------------------------
// A planar reflection for flat wet ground (opt-in, experimental: docs/lighting.md).
//
//   const world = createWorldRenderer({ lighting: { planar: { y: 0 } } });   // the ground plane's height (m)
//   world.lighting.planar.info        // { on, size, calls, ms, renders, kept, skipped }
//   world.lighting.planar.cfg.y = 0.1  // live: the plane, fade, roughMax and every are read each sub-frame
//
// Why: screen-space reflections (screen.js) can only mirror what is on screen; a puddle in front of the camera
// should also show the lamp above the frame and the sky behind the eye. One plane per world is drawn once more from
// the camera mirrored in it, with the world's own materials, lights and fog, into a target of `scale` x the frame.
//
// How. Before each sub-frame's scene pass (post.js calls before(), then after() once the scene is drawn):
//   1. the mirror camera: the view camera's world matrix reflected in the plane y (and its x axis turned back, so the
//      camera is a proper rotation and three keeps its face culling); the projection is the view's (jitter, lens
//      shift and all) with Lengyel's oblique near plane at y + clip, so nothing under the plane is drawn;
//   2. the scene is drawn with it into a mipmapped half-float target: it is the sub-frame's first render, so it draws
//      the shadow maps (the sun is fitted to the view before), and the scene pass that follows reuses them instead
//      of drawing them again (a still then does not depend on the frame before it); objects marked userData.mgNoCapture (rain streaks, particles) are hidden, the part is off
//      (no recursion: the material does not read the target it is being drawn into), the other screen passes too;
//   3. the lit materials (inject.js part, after screen-space reflections) read it where they shade the environment
//      reflection: for pixels within `fade` m of the plane, facing up, and no rougher than `roughMax`, the world
//      point is projected into the mirror camera, moved by how far the surface normal (normal maps, wet ripples)
//      bends the reflected ray, and looked up in the mip level of the roughness, with a few taps stretched toward the
//      viewer (wet streets smear reflections downward). It replaces the probe / sky reflection by that weight and sits
//      on top of a screen-space hit: for the plane it is exact and of this frame, SSR is last frame's and half size.
// Moving frames redraw the mirror every `every` frames (the lookup keeps the matrix it was drawn with, so a kept
// mirror stays registered while the camera moves); still sub-frames always redraw it (jitter, lens and time change
// per sub-frame, and the still then converges like everything else).
// Limits: one plane, horizontal; surfaces off the plane (by more than `fade`) and walls keep their probe / SSR
// reflection; the scene is drawn again (a second view: CPU and GPU); a pixel above the plane by h is looked up as if
// on it (an error of about h); fog of the mirror pass counts from the mirrored eye, so the eye-to-puddle stretch is
// fogged twice; per-view hooks (frame.js onView: LOD, instance culling, occlusion) run for the view camera only, so
// the mirror sees what they left (an instanced object culled from the view is missing from the mirror too); the
// clustered lights take their plain loop in the mirror pass; not in XR; perspective cameras only.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const PLANAR_DEFAULTS = {
  y: 0,            // m: the plane's height
  scale: 0.5,      // the mirror target's size, x the frame
  roughMax: 0.35,  // surfaces rougher than this keep their probe / sky reflection (fades in below it)
  fade: 0.25,      // m above / below the plane over which the mirror fades out
  clip: 0.02,      // m: the mirror pass's near plane sits this far above the plane (the ground does not mirror itself)
  layers: null,    // three.js layers the mirror pass draws (array of numbers); null = the view camera's
  every: 1,        // moving frames: redraw the mirror every Nth frame (stills: every sub-frame)
};
const DISTORT = 2.5;   // m: how far along the bent ray the lookup point is taken (the normal's distortion)

export function planarConfig(c) {
  if (!c) return null;
  const o = { ...PLANAR_DEFAULTS, ...(c === true ? {} : c) };
  const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  o.y = num(o.y, 0, -1e6, 1e6); o.scale = num(o.scale, 0.5, 0.1, 1); o.roughMax = num(o.roughMax, 0.35, 0.01, 1);
  o.fade = num(o.fade, 0.25, 0.001, 100); o.clip = num(o.clip, 0.02, -10, 10); o.every = Math.round(num(o.every, 1, 1, 60));
  o.layers = Array.isArray(o.layers) && o.layers.length ? o.layers.map((l) => Math.round(+l)).filter((l) => l >= 0 && l < 32) : null;
  return o;
}

const _M = new THREE.Matrix4(), _S = new THREE.Matrix4().makeScale(-1, 1, 1), _pl = new THREE.Plane(), _n = new THREE.Vector3(0, 1, 0), _q = new THREE.Vector4(), _c = new THREE.Vector4(), _p3 = new THREE.Vector3(), _v4 = new THREE.Vector4();
/** the reflection in the plane y = h (a world matrix: det -1) */
export function mirrorMatrix(h, out = new THREE.Matrix4()) { return out.set(1, 0, 0, 0, 0, -1, 0, 2 * h, 0, 0, 1, 0, 0, 0, 0, 1); }
/** Lengyel's oblique near plane: `proj` (a perspective projection) is changed in place so its near plane is the
 *  view-space plane `plane` (x, y, z: normal, w: constant; points with n.p + w >= 0 are kept). */
export function obliqueClip(proj, plane) {
  const e = proj.elements;
  _q.set((Math.sign(plane.x) + e[8]) / e[0], (Math.sign(plane.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  _c.copy(plane).multiplyScalar(2 / plane.dot(_q));
  e[2] = _c.x; e[6] = _c.y; e[10] = _c.z + 1; e[14] = _c.w;
  return proj;
}
/** `out` (a PerspectiveCamera) becomes `cam` mirrored in the plane y = h, its near plane at y = h + clip */
export function mirrorCamera(cam, h, clip, out) {
  cam.updateMatrixWorld();
  // M (reflection) x C (camera) x S (x axis back): a proper rotation, the image left-right turned (the lookup projects
  // world points, so that does not matter) and three's front faces stay front faces
  _M.multiplyMatrices(mirrorMatrix(h, _M), cam.matrixWorld).multiply(_S);
  _M.decompose(out.position, out.quaternion, out.scale);
  out.updateMatrixWorld(true);
  out.near = cam.near; out.far = cam.far;
  out.projectionMatrix.copy(cam.projectionMatrix);
  _pl.setFromNormalAndCoplanarPoint(_n, _p3.set(0, h + clip, 0)).applyMatrix4(out.matrixWorldInverse);
  obliqueClip(out.projectionMatrix, _v4.set(_pl.normal.x, _pl.normal.y, _pl.normal.z, _pl.constant));
  out.projectionMatrixInverse.copy(out.projectionMatrix).invert();
  return out;
}

const PARS = /* glsl */ `
uniform sampler2D mgPlT;
uniform mat4 mgPlM;        // the mirror camera's view-projection (world -> clip)
uniform vec4 mgPl;         // x: 1 while the target holds a mirror for this view, y: plane height (m), z: fade (m), w: roughMax
uniform vec4 mgPlR;        // x: target height (px), y: its largest mip level, z: m along the bent ray the lookup takes
`;
const LOOKUP = /* glsl */ `if ( mgPl.x > 0.5 ) {
		vec3 mgPP = mgLW( geometryPosition ), mgPN = mgLWN( geometryNormal );
		float mgPr = material.roughness;
		float mgPw = smoothstep( 0.72, 0.9, mgPN.y ) * ( 1.0 - smoothstep( 0.5 * mgPl.z, mgPl.z, abs( mgPP.y - mgPl.y ) ) ) * ( 1.0 - smoothstep( 0.7 * mgPl.w, mgPl.w, mgPr ) );
		if ( mgPw > 0.0 ) {
			vec3 mgV = mgLWN( geometryViewDir );
			// what the bent normal adds to the flat mirror ray, taken mgPlR.z metres out: no bend = the point itself
			vec3 mgB = reflect( - mgV, mgPN ) - reflect( - mgV, vec3( 0.0, 1.0, 0.0 ) );
			vec4 mgC = mgPlM * vec4( mgPP + mgB * mgPlR.z, 1.0 );
			vec2 mgU = mgC.xy / mgC.w * 0.5 + 0.5;
			vec2 mgE = smoothstep( vec2( 0.0 ), vec2( 0.03 ), mgU ) * ( 1.0 - smoothstep( vec2( 0.97 ), vec2( 1.0 ), mgU ) );
			mgPw *= mgE.x * mgE.y * step( 0.0, mgC.w );
			// blur with roughness (alpha = r^2 of the target's height, x 0.6): a mip level for the width, four taps
			// stretched 3x toward the viewer for the height (a wet street smears what it mirrors downward)
			float mgA = mgPr * mgPr, mgF = mgA * mgPlR.x * 0.6;
			float mgL = clamp( log2( max( mgF, 1.0 ) ), 0.0, mgPlR.y );
			float mgDy = mgF * 3.0 / mgPlR.x;
			vec3 mgS = vec3( 0.0 );
			for ( int i = 0; i < 4; i ++ ) mgS += textureLod( mgPlT, clamp( mgU + vec2( 0.0, ( float( i ) - 1.5 ) / 3.0 * mgDy ), 0.0, 1.0 ), mgL ).rgb;
			iblRadiance = mix( iblRadiance, max( mgS * 0.25, 0.0 ), mgPw );
		}
	}
	`;

function part(U) {
  return {
    id: 'planar', order: 45, pars: PARS, uniforms: U,
    // after the reflection probes (25) and screen-space reflections (40): the plane's own mirror wins where it applies
    apply(fs, t) {
      const i = fs.lastIndexOf('radiance += iblRadiance;');
      if (i < 0) return t.swap(fs, '\u0000', '', 'planar');
      return fs.slice(0, i) + LOOKUP + fs.slice(i);
    },
  };
}

/** w: { renderer, scene }; the pipeline calls before() / after() around each sub-frame's scene pass */
export function createPlanar(w, cfg) {
  const { renderer, scene } = w;
  const U = {
    mgPlT: { value: null }, mgPlM: { value: new THREE.Matrix4() },
    mgPl: { value: new THREE.Vector4(0, cfg.y, cfg.fade, cfg.roughMax) }, mgPlR: { value: new THREE.Vector4(1, 0, DISTORT, 0) },
  };
  const cam = new THREE.PerspectiveCamera();
  const info = { on: false, size: [0, 0], calls: 0, ms: 0, renders: 0, kept: 0, skipped: 0 };
  const _cc = new THREE.Color();
  let rt = null, frames = 0, valid = false, smBack = null;

  function target(tw, th) {
    if (rt && rt.width === tw && rt.height === th) return rt;
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    valid = false;
    return rt;
  }
  const mask = () => (cfg.layers ? cfg.layers.reduce((m, l) => m | (1 << l), 0) : null);

  function before(pipe, sc, camera, k, still) {
    U.mgPl.value.x = 0; info.on = false;
    if (sc !== scene || renderer.xr.isPresenting || !camera.isPerspectiveCamera) return;
    U.mgPl.value.set(0, cfg.y, cfg.fade, cfg.roughMax);
    camera.updateMatrixWorld();
    if (camera.matrixWorld.elements[13] <= cfg.y + cfg.clip) { info.skipped++; return; }   // an eye under the plane sees no mirror of it
    const tw = Math.max(8, Math.round(pipe.w * cfg.scale)), th = Math.max(8, Math.round(pipe.h * cfg.scale));
    const T = target(tw, th);
    // a moving frame between redraws keeps the last mirror (and the matrix it was drawn with)
    if (!still && valid && cfg.every > 1 && frames < cfg.every) { frames++; U.mgPl.value.x = 1; info.on = true; info.kept++; return; }
    frames = 1;
    const t0 = performance.now();
    mirrorCamera(camera, cfg.y, cfg.clip, cam);
    const m = mask(); cam.layers.mask = m === null ? camera.layers.mask : m;
    const saved = { rt: renderer.getRenderTarget(), auto: renderer.autoClear, xr: renderer.xr.enabled, a: renderer.getClearAlpha() };
    renderer.getClearColor(_cc);
    const hidden = [];
    scene.traverseVisible((o) => { if (o.userData.mgNoCapture) hidden.push(o); });
    for (const o of hidden) o.visible = false;
    U.mgPlT.value = null;   // no feedback: the target is not bound while it is drawn into
    renderer.xr.enabled = false; renderer.autoClear = false;
    try {
      renderer.setRenderTarget(T); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
      const c0 = renderer.info.render.calls;
      renderer.render(scene, cam);
      info.calls = renderer.info.render.calls - c0;
    } finally {
      for (const o of hidden) o.visible = true;
      renderer.setRenderTarget(saved.rt); renderer.setClearColor(_cc, saved.a); renderer.autoClear = saved.auto; renderer.xr.enabled = saved.xr;
    }
    // the mirror pass drew this sub-frame's shadow maps (the sun's fit is the view's, set before the sub-frame): the
    // scene pass reuses them instead of drawing them again, and after() hands the switch back
    if (smBack === null) smBack = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
    U.mgPlT.value = T.texture;
    U.mgPlM.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    U.mgPlR.value.set(th, Math.floor(Math.log2(Math.max(tw, th))), DISTORT, 0);
    U.mgPl.value.x = 1;
    valid = true; info.on = true; info.renders++; info.size = [tw, th];
    info.ms = +(performance.now() - t0).toFixed(2);
  }
  /** the scene pass is drawn: other renders (captures, probes, bakes) must not read the mirror */
  function after() { U.mgPl.value.x = 0; if (smBack !== null) { renderer.shadowMap.autoUpdate = smBack; smBack = null; } }
  return {
    cfg, part: part(U), uniforms: U, info, camera: cam, before, after,
    get texture() { return rt ? rt.texture : null; },
    invalidate() { valid = false; },
    dispose() { if (rt) rt.dispose(); rt = null; valid = false; },
  };
}
