// Mirage original code.
import * as THREE from 'three';
import { CHUNK_EPOCH } from './env.js';
import { onChunksRestored } from './fog.js';

// ---------------------------------------------------------------------------
// Soft sun shadows: contact-hardening penumbrae from the sun's own shadow map (PCSS). Opt-in:
//
//   createWorldRenderer({ ..., softShadows: true })          // or an object overriding SOFTSHADOW_DEFAULTS below
//
// Without it nothing here runs and no shader chunk is touched: a world compiles exactly what it did before.
//
// Still frames (spp > 1) have always had soft sun shadows: the sun moves over its disc between the sub-frames. A
// walking view (taa: true, one sub-frame per frame) had hard ones. With softShadows the sun stays put and every
// lit pixel estimates its own penumbra instead, so both kinds of frame get the same contact-hardening shadow:
// sharp where an object meets the ground, wider the further the caster is from the receiver.
//
// Per pixel, on the sun's orthographic shadow map (depth is linear in metres along the light there):
//   1. blocker search: the pixel itself plus taps on a Vogel disc as wide as the widest penumbra; each asks the
//      hardware comparison sampler whether something lies at least `minBlocker` m nearer the sun, then each blocked
//      tap binary-searches (in log distance) how far nearer. The map stays a sampler2DShadow: no second view of it,
//      no extra texture unit (Mirage's materials are short of units), and wind-swayed or alpha-tested casters are
//      read exactly as three's PCF reads them.
//   2. penumbra = mean blocker distance x 2 tan(sunAngle / 2), clamped (metres and texels).
//   3. PCF over that radius: Vogel taps, hardware 2x2 compare each.
// Every tap's reference depth follows the receiver's plane (depth gradient from screen derivatives, slope clamped),
// so grazing surfaces do not acne when the taps spread. Both tap sets are rotated per pixel by interleaved gradient
// noise plus a golden-ratio step of the sub-frame index (k in a still frame, the TAA index while moving): the
// sub-frame average and the TAA history converge to a smooth penumbra, and a still frame depends on k only. No
// blocker in reach: lit after the search alone; every search tap wholly blocked: umbra, no PCF. Near the map's edge
// the shadow fades out instead of stopping at a line. Tap counts are compiled in (constant tap tables rotated by one
// 2x2 matrix): once per page, by the first install.
//
// Only the first shadow-casting directional light (the world's sun) of Standard / Physical / Lambert / Phong
// materials under THREE.FogExp2 (every Mirage world) takes this path; spot, point (and light2's lamp) shadows,
// other directional lights and other materials keep three's. The chunks are page-global once installed: the
// uniforms below are too, and a world without softShadows writes "off" before it draws (one uniform test).
// ---------------------------------------------------------------------------

export const SOFTSHADOW_DEFAULTS = {
  on: true,                // live switch (world.softShadows.on): false = three's PCF and the sub-frame sun-disc jitter
  sunAngle: 0.53,          // the sun's full angular diameter (degrees). The real sun is ~0.53; larger reads softer
  maxPenumbra: 0.3,        // widest penumbra (m, full width); also the blocker search's reach
  maxPenumbraTexels: 48,   // ... and in shadow-map texels (bounds the noise of a wide, coarse search)
  minBlocker: 0.02,        // m: a caster nearer the receiver than this is the receiver itself (bias)
  // tap counts, compiled in once per page (the first world's): search taps around the pixel, binary-search steps per
  // blocked tap for its distance (5 resolve it to ~1.4x), PCF taps over the penumbra
  blockerSamples: 8,       // <= 32
  blockerSteps: 5,         // <= 8
  filterSamples: 12,       // <= 64
  slopeMax: 10,            // receiver-plane slope clamp (tan of the angle to the light's view plane)
  edgeFade: 0.02,          // share of the map over which shadows fade out at its edge
};
const MAX_B = 32, MAX_S = 8, MAX_F = 64;

/** a full soft-shadow config from `true` or a partial object; null when off */
export function softShadowConfig(c) {
  if (!c) return null;
  const o = { ...SOFTSHADOW_DEFAULTS, ...(c === true ? {} : c) };
  const num = (k, lo, hi) => { const v = +o[k]; o[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : SOFTSHADOW_DEFAULTS[k]; };
  num('sunAngle', 0.01, 20); num('maxPenumbra', 0.001, 50); num('maxPenumbraTexels', 1, 256); num('minBlocker', 1e-4, 10);
  num('slopeMax', 0, 100); num('edgeFade', 0, 0.5);
  for (const [k, lo, hi] of [['blockerSamples', 1, MAX_B], ['blockerSteps', 0, MAX_S], ['filterSamples', 1, MAX_F]]) { num(k, lo, hi); o[k] = Math.round(o[k]); }
  o.on = o.on !== false;
  return o;
}

// shared uniforms (typed arrays: three's cloneUniforms keeps them by reference, so every program sees one copy)
export const SS_SHARED = {
  a: new Float32Array(4),   // x: on, y: rotation phase of the sub-frame, z: penumbra radius (uv) per m of blocker distance, w: widest radius (uv)
  b: new Float32Array(4),   // x: shadow depth per m, y: nearest blocker (m), z: farthest blocker searched (m), w: edge fade (uv)
  c: new Float32Array(4),   // x: slope clamp (depth per uv)
};

const MATS = ['standard', 'physical', 'lambert', 'phong'];
const SS_GUARD = '#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && NUM_DIR_LIGHT_SHADOWS > 0 && defined( USE_FOG ) && defined( FOG_EXP2 ) && ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) ) && !defined( MG_NO_SS )';
// a Vogel disc of n taps (radius 1, turned by `turn` rad) as a GLSL constant
const vogel = (name, n, turn) => `const vec2 ${name}[ ${n} ] = vec2[ ${n} ]( ${Array.from({ length: n }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / n), t = i * 2.399963229728653 + turn;
  return `vec2( ${(r * Math.cos(t)).toFixed(6)}, ${(r * Math.sin(t)).toFixed(6)} )`;
}).join(', ')} );`;

const ssGlsl = (B, S, F) => /* glsl */ `
${SS_GUARD}
#define MG_SS
#define MG_SS_B ${B}
#define MG_SS_S ${S}
#define MG_SS_F ${F}
uniform vec4 mgSsA;
uniform vec4 mgSsB;
uniform vec4 mgSsC;
${vogel('MG_SS_PB', B, 0)}
${vogel('MG_SS_PF', F, 1.2)}
// contact-hardening sun shadow (softshadow.js); same arguments as three's getShadow, orthographic shadow camera
float mgSoftShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
	shadowCoord.xyz /= shadowCoord.w;
	shadowCoord.z += shadowBias;
	// receiver plane (depth over map uv) from the screen derivatives, before any branch; slope clamped
	vec3 dx = dFdx( shadowCoord.xyz ), dy = dFdy( shadowCoord.xyz );
	float det = dx.x * dy.y - dx.y * dy.x;
	vec2 g = abs( det ) > 1e-20 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
	float gLen = length( g );
	if ( gLen > mgSsC.x ) { g *= mgSsC.x / gLen; gLen = mgSsC.x; }
	bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0 && shadowCoord.z <= 1.0;
	if ( ! inFrustum ) return 1.0;
	float texel = 1.0 / shadowMapSize.x;
	// a bilinear compare reads texels up to ~a texel off the tap: that much of the plane's slope as slack
	float zr0 = shadowCoord.z - gLen * texel;
	float phi = PI2 * fract( interleavedGradientNoise( gl_FragCoord.xy ) + mgSsA.y );
	float cs = cos( phi ), sn = sin( phi );
	mat2 rot = mat2( cs, sn, - sn, cs );
	float d0 = mgSsB.y, dz = mgSsB.x;
	// 1. blocker search: is there a caster at least d0 nearer the sun? The pixel itself (a caster thinner than the
	// taps' spacing still darkens its own umbra), then a Vogel disc as wide as the widest penumbra
	mat2 rotB = rot * mgSsA.w;
	float zb = zr0 - d0 * dz;
	float occ = 1.0 - texture( shadowMap, vec3( shadowCoord.xy, zb ) );
	for ( int i = 0; i < MG_SS_B; i ++ ) {
		vec2 o = rotB * MG_SS_PB[ i ];
		occ += 1.0 - texture( shadowMap, vec3( shadowCoord.xy + o, zb + dot( g, o ) ) );
	}
	if ( occ <= 0.0 ) return 1.0;
	float shadow = 0.0;
	if ( occ < float( MG_SS_B + 1 ) - 1e-3 ) {
		// ... and how far: per blocked tap the median of its (bilinear) blockers, binary-searched in log distance
		float lr = log2( max( mgSsB.z / d0, 1.0 ) ), sumD = 0.0, sumW = 0.0;
		for ( int i = 0; i <= MG_SS_B; i ++ ) {
			vec2 o = i == 0 ? vec2( 0.0 ) : rotB * MG_SS_PB[ i > 0 ? i - 1 : 0 ];
			vec3 p = vec3( shadowCoord.xy + o, zr0 + dot( g, o ) );
			float b = 1.0 - texture( shadowMap, vec3( p.xy, p.z - d0 * dz ) );
			if ( b <= 0.0 ) continue;
			float lo = 0.0, hi = 1.0;
			for ( int s = 0; s < MG_SS_S; s ++ ) {
				float m = 0.5 * ( lo + hi );
				float bm = 1.0 - texture( shadowMap, vec3( p.xy, p.z - d0 * exp2( m * lr ) * dz ) );
				if ( bm >= 0.5 * b ) lo = m; else hi = m;
			}
			sumD += b * d0 * exp2( 0.5 * ( lo + hi ) * lr );
			sumW += b;
		}
		// 2. penumbra radius from the mean blocker distance; 3. PCF over it
		float pr = clamp( sumD / max( sumW, 1e-6 ) * mgSsA.z, shadowRadius * texel, max( mgSsA.w, shadowRadius * texel ) );
		mat2 rotF = rot * pr;
		for ( int i = 0; i < MG_SS_F; i ++ ) {
			vec2 o = rotF * MG_SS_PF[ i ];
			shadow += texture( shadowMap, vec3( shadowCoord.xy + o, zr0 + dot( g, o ) ) );
		}
		shadow /= float( MG_SS_F );
	}
	float edge = min( min( shadowCoord.x, shadowCoord.y ), min( 1.0 - shadowCoord.x, 1.0 - shadowCoord.y ) );
	float fade = mgSsB.w > 0.0 ? smoothstep( 0.0, mgSsB.w, edge ) : 1.0;
	return mix( 1.0, mix( 1.0, shadow, fade ), shadowIntensity );
}
#endif
`;

let installed = null;   // the tap counts compiled in, once installed
onChunksRestored(() => { installed = null; });   // the last world on the page was disposed (fog.js)
/** Patch three's shadow chunks once per page (createWorldRenderer calls it when softShadows is on). The tap counts
 *  (blockerSamples, blockerSteps, filterSamples of `cfg`, else the defaults) are compiled in by the first install on
 *  the page; a later cfg asking for others is set to them (warning). False, with a warning and nothing patched, when
 *  three's chunks are not the ones this was written against (three's PCF stays). */
export function installSoftShadows(cfg = null) {
  const want = softShadowConfig(cfg || true);
  if (installed) {
    if (cfg && ['blockerSamples', 'blockerSteps', 'filterSamples'].some((k) => want[k] !== installed[k])) {
      console.warn('[softshadow] tap counts are compiled once per page: this world uses', installed);
      if (typeof cfg === 'object') Object.assign(cfg, installed);
    }
    return true;
  }
  const C = THREE.ShaderChunk;
  const args = 'directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ]';
  const call = `directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( ${args} ) : 1.0;`;
  const pars = C.shadowmap_pars_fragment;
  if (!C.lights_fragment_begin || C.lights_fragment_begin.split(call).length !== 2 || !pars
    || !pars.includes('float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord )')
    || !pars.includes('float interleavedGradientNoise( vec2 position )')
    || !pars.includes('uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];')) {
    console.warn('[softshadow] three\'s shadow chunks changed: soft sun shadows not installed (three\'s PCF stays)');
    return false;
  }
  installed = { blockerSamples: want.blockerSamples, blockerSteps: want.blockerSteps, filterSamples: want.filterSamples };
  CHUNK_EPOCH.n++;
  for (const k of MATS) {
    const u = THREE.ShaderLib[k] && THREE.ShaderLib[k].uniforms;
    if (!u || u.mgSsA) continue;
    u.mgSsA = { value: SS_SHARED.a };
    u.mgSsB = { value: SS_SHARED.b };
    u.mgSsC = { value: SS_SHARED.c };
  }
  C.shadowmap_pars_fragment = pars + ssGlsl(installed.blockerSamples, installed.blockerSteps, installed.filterSamples);
  // the sun is the first shadow-casting directional light (three sorts shadow casters first)
  const soft = `directLight.color *= ( directLight.visible && receiveShadow ) ? ( ( UNROLLED_LOOP_INDEX == 0 && mgSsA.x > 0.5 ) ? mgSoftShadow( ${args} ) : getShadow( ${args} ) ) : 1.0;`;
  C.lights_fragment_begin = C.lights_fragment_begin.replace(call, `#ifdef MG_SS\n\t\t${soft}\n\t\t#else\n\t\t${call}\n\t\t#endif`);
  return true;
}

/** the tap counts compiled in on this page; null before the first install */
export const softShadowsInstalled = () => (installed ? { ...installed } : null);

/** Switch the page-global soft path off after a world has drawn: other scenes on the page (a host's own Standard
 *  materials under FogExp2 compile the patch too) must not inherit this world's shadow-camera numbers. */
export function softShadowsIdle() { if (installed) SS_SHARED.a[0] = 0; }

/** Publish the soft-shadow uniforms for the sun's fitted orthographic shadow camera, before a (sub-)frame draws.
 *  cfg: the world's config (null or cfg.on false: off); index: the sub-frame index (k in a still frame, the TAA index
 *  while moving) — the only thing the per-pixel pattern varies with. Does nothing on a page without the patch. */
export function softShadowUniforms(cfg, shadowCamera, mapSize, index = 0) {
  if (!installed) return;
  const A = SS_SHARED.a, B = SS_SHARED.b, Cc = SS_SHARED.c;
  if (!cfg || !cfg.on || !shadowCamera) { A[0] = 0; return; }
  const W = Math.max(1e-6, shadowCamera.right - shadowCamera.left), R = Math.max(1e-6, shadowCamera.far - shadowCamera.near);
  const size = Math.max(1, mapSize ? mapSize.x : 2048);
  const spread = Math.tan((cfg.sunAngle * Math.PI) / 360) / W;          // penumbra radius (uv) per m of blocker distance
  const maxR = Math.min(cfg.maxPenumbra / (2 * W), cfg.maxPenumbraTexels / (2 * size));
  A[0] = 1; A[1] = ((index >>> 0) * 0.6180339887498949) % 1; A[2] = spread; A[3] = maxR;
  B[0] = 1 / R; B[1] = cfg.minBlocker; B[2] = Math.max(cfg.minBlocker * 1.001, maxR / spread); B[3] = cfg.edgeFade;
  Cc[0] = (cfg.slopeMax * W) / R;
}
