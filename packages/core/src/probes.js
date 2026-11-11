// Mirage original code.
// ---------------------------------------------------------------------------
// Local reflection probes with box parallax correction (opt-in: lighting: { probes: [ ... ] }).
//
//   const world = createWorldRenderer({ lighting: { probes: [
//     { min: [-4, 3.6, -29], max: [4, 7.4, -21] },                    // a room: captured from its centre
//     { min: [-9, 0, -9], max: [9, 6, 9], position: [0, 1.7, 0], fade: 1.5 },
//   ] } });
//   world.lighting.invalidate();    // the built world changed: probes are captured again, one every few frames
//
// Why: the world has ONE image-based light, captured at one point; a glossy floor inside a room then mirrors the
// courtyard. A probe is a second capture, taken inside its box and prefiltered the same way (three's PMREM, the
// same size as the world's, so roughness reads the same blur); a pixel inside the box reflects it instead. The
// reflected ray is cut against the box and the capture is looked up toward that hit point, not along the ray
// (parallax correction): reflections stay where the walls are as the eye moves. Within `fade` metres of the box's
// faces the probe blends out to the world's light; overlapping boxes blend by those weights.
// Captured after the sky / sun changed (the world's image-based light was recaptured) and after invalidate(), one
// probe every `PROBES_EVERY` frames; moving objects (userData.mgDynamic) and mgNoCapture objects are left out.
// Limits: at most 4 probes in a world (each is one more texture in every lit program); the box is axis-aligned;
// rough reflections use the same hit point (exact only for mirrors); a probe does not see other probes' pixels
// differently from the world's light on its first capture.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const PROBES_MAX = 4, PROBES_EVERY = 8;
export const PROBE_DEFAULTS = { fade: 1, intensity: 1 };

export function probesConfig(c) {
  if (!Array.isArray(c) || !c.length) return null;
  return c.slice(0, PROBES_MAX).filter((p) => p && p.min && p.max).map((p) => ({ ...PROBE_DEFAULTS, ...p, position: p.position || [0, 1, 2].map((i) => (p.min[i] + p.max[i]) / 2) }));
}
/** where a ray from p along d (inside the box) leaves the box min..max: the distance along d */
export function boxExit(p, d, min, max) {
  let t = Infinity;
  for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > 1e-6) t = Math.min(t, ((d[i] > 0 ? max[i] : min[i]) - p[i]) / d[i]);
  return t;
}
/** a probe's weight at p: 1 inside, falling to 0 over `fade` metres before the faces, 0 outside */
export function probeWeight(p, min, max, fade) {
  let w = Infinity;
  for (let i = 0; i < 3; i++) w = Math.min(w, Math.min(p[i] - min[i], max[i] - p[i]) / Math.max(fade, 1e-3));
  return Math.max(0, Math.min(1, w));
}

export function createProbes(w, list, { size = 256 } = {}) {
  const { renderer, scene } = w, n = list.length;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const U = {};
  const C = [], H = [], P = [];
  for (let i = 0; i < n; i++) {
    const p = list[i];
    C.push(new THREE.Vector4((p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2, 1 / Math.max(p.fade, 1e-3)));
    H.push(new THREE.Vector4((p.max[0] - p.min[0]) / 2, (p.max[1] - p.min[1]) / 2, (p.max[2] - p.min[2]) / 2, 0));   // w: intensity, 0 until captured
    P.push(new THREE.Vector3().fromArray(p.position));
    U['mgRp' + i] = { value: null };
  }
  U.mgRpC = { value: C }; U.mgRpH = { value: H }; U.mgRpP = { value: P };
  const targets = new Array(n).fill(null);
  const info = { probes: n, captures: 0, captureMs: 0, pending: 0 };
  let queue = [], frames = 0;

  function capture(i) {
    const t0 = performance.now();
    const rt = w.capture(() => pmrem.fromScene(scene, 0, 0.05, 1500, { size, position: P[i] }));
    if (targets[i]) targets[i].dispose();
    targets[i] = rt; U['mgRp' + i].value = rt.texture; H[i].w = list[i].intensity;
    info.captures++; info.captureMs = +(performance.now() - t0).toFixed(1);
  }
  const each = (f) => Array.from({ length: n }, (_, i) => f(i)).join('\n');
  const part = {
    id: 'probes', key: String(n), order: 25, uniforms: U,
    pars: /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && defined( RE_IndirectSpecular )
#define MG_RP
${each((i) => `uniform sampler2D mgRp${i};`)}
uniform vec4 mgRpC[ ${n} ];   // box centre, 1 / fade
uniform vec4 mgRpH[ ${n} ];   // box half size, intensity (0: not captured yet)
uniform vec3 mgRpP[ ${n} ];   // where it was captured
#endif
`,
    apply: (fs, t) => t.swap(fs, 'vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );', /* glsl */ `vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
		#ifdef MG_RP
		{
			vec3 mgP = mgLW( geometryPosition ), mgN = mgLWN( geometryNormal );
			vec3 mgR = reflect( - mgLWN( geometryViewDir ), mgN );
			mgR = normalize( mix( mgR, mgN, pow4( material.roughness ) ) );
			vec3 mgSafe = mix( mgR, vec3( 1e-5 ), lessThan( abs( mgR ), vec3( 1e-5 ) ) );
			vec3 mgAcc = vec3( 0.0 ); float mgW = 0.0;
${each((i) => `			{
				vec3 q = mgRpH[ ${i} ].xyz - abs( mgP - mgRpC[ ${i} ].xyz );
				float wt = clamp( min( q.x, min( q.y, q.z ) ) * mgRpC[ ${i} ].w, 0.0, 1.0 ) * step( 1e-4, mgRpH[ ${i} ].w );
				if ( wt > 0.0 ) {
					vec3 t3 = ( mgRpC[ ${i} ].xyz + sign( mgSafe ) * mgRpH[ ${i} ].xyz - mgP ) / mgSafe;
					vec3 hit = mgP + mgR * min( t3.x, min( t3.y, t3.z ) );
					mgAcc += wt * mgRpH[ ${i} ].w * textureCubeUV( mgRp${i}, hit - mgRpP[ ${i} ], material.roughness ).rgb; mgW += wt;
				}
			}`)}
			if ( mgW > 0.0 ) { mgRpK = min( mgW, 1.0 ); iblRadiance = mix( iblRadiance, mgAcc / mgW * envMapIntensity, mgRpK ); }
		}
		#endif`, 'probes'),
  };
  return {
    list, part, uniforms: U, info, targets,
    get busy() { return queue.length > 0; },
    frame() {
      if (!queue.length || frames++ % PROBES_EVERY) return;
      capture(queue.shift()); info.pending = queue.length;
    },
    /** capture every probe now (the first time), or queue them all */
    envCaptured() { if (!targets[0]) { for (let i = 0; i < n; i++) capture(i); } else this.invalidate(); },
    invalidate() { queue = Array.from({ length: n }, (_, i) => i); frames = 0; info.pending = n; },
    dispose() { for (const t of targets) if (t) t.dispose(); pmrem.dispose(); },
  };
}
