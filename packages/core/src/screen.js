// Mirage original code.
// ---------------------------------------------------------------------------
// Screen-space lighting: reflections, short-range indirect light and contact shadows (opt-in, docs/lighting.md).
//
//   const world = createWorldRenderer({ lighting: { screen: true }, post: { ssr2: 1, ssgi: 1, contact: 1 } });
//   world.post.ssr2 = 0;                     // each one is a live switch (0 = that pass is not drawn)
//   world.renderFrame(T, { spp: 32 });       // a still: the reference mode (full size, no history, no blur)
//
// How. `lighting.screen` adds one shader part to the world's lit materials (inject.js) and one sampler. Before
// each sub-frame's scene pass the opaque lit meshes are drawn once more into a small G-buffer: the SAME programs
// leave main() early (one uniform test) with the view normal, the roughness and a "this is a surface" mark, so
// normal maps, roughness maps and what wet.js does to them are all in it. Three passes then march that depth buffer
// in view space (growing steps with a thickness test, the first one jittered, then a bisection):
//   reflections   one GGX-distributed ray per pixel; a hit takes last frame's lit colour (reprojected), a miss or a
//                 hit near the screen edge counts for nothing;
//   indirect      cosine-distributed rays `ssgiRange` metres long; a hit gives its colour (bounce light) and
//                 covers the ambient light from that direction (occlusion with colour), a miss leaves it;
//   contact       a short ray toward the key light: what the shadow map is too coarse for.
// Each is accumulated over frames (reprojected through the camera matrices, dropped where the depth disagrees),
// blurred across surfaces that share depth and normal (wider with roughness), and written to one atlas. The scene
// pass then reads the atlas IN THE MATERIAL: reflections replace the environment reflection by their confidence
// BEFORE three applies the surface's own specular response, so tint, Fresnel and roughness are the material's, and
// the fallback order is screen -> reflection probes (probes.js) -> the sky's image-based light with no extra code;
// indirect light scales the ambient / probe irradiance by what was covered and adds the bounce; the key light is
// multiplied by the contact shadow. Everything lands in the HDR scene target, so the accumulation, the 16-bit PNG
// and the EXR output carry it.
// Stills (several sub-frames, no temporal AA) are the reference mode: full-size buffers, more steps, no history
// and no blur; every sub-frame draws new rays and the sub-frames average. A still therefore converges with spp.
// Limits: only what is on screen can be hit (and only opaque lit meshes are in the G-buffer: glass, water shaders,
// particles neither reflect nor are marched, though they are in the colour a hit reads); the colour is last frame's
// (a moving reflection lags one frame; the first sub-frame after a cut has none and falls back); thickness is a
// guess (`ssrThick`); half-size buffers are stretched without an edge-aware filter; history follows the camera, not
// each object's motion (a moving object's reflection is rejected by depth, not reprojected); one more geometry pass.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OCT_DECODE } from './inject.js';

export const SCREEN_DEFAULTS = {
  scale: 0.5,        // buffer size of moving frames (x the render size)
  refScale: 1,       // ... of stills
  layer: 29,         // the three.js layer that marks what goes into the G-buffer
};
/** the post options that drive it (spread into the world's post defaults by postfx.js) */
export const SCREEN_POST = {
  ssr2: 0,           // 0..1: screen-space reflections (lighting.screen), how much of a confident hit is used
  ssrRough: 0.55,    // surfaces rougher than this keep their probe / sky reflection (fades in below it)
  ssrDist: 40,       // m a reflection ray is marched
  ssrThick: 0.3,     // m: how thick whatever a ray passes behind is taken to be
  ssgi: 0,           // 0..1: screen-space indirect light
  ssgiRange: 3,      // m
  ssgiRays: 1,       // rays per pixel and frame (stills: per sub-frame)
  contact: 0,        // 0..1: contact shadows of the key light
  contactLen: 0.4,   // m
};
export function screenConfig(c) { return c ? { ...SCREEN_DEFAULTS, ...(c === true ? {} : c) } : null; }

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
const HEAD = /* glsl */ `precision highp float;
varying vec2 vUv;
uniform sampler2D tG, tGD;
uniform mat4 uProj, uInvProj;
uniform vec4 uAct;       // the G-buffer's used corner: uv scale, largest uv
uniform float uFrame;
uniform int uMode;       // 0 reflections, 1 indirect, 2 contact
${OCT_DECODE}
vec2 gUV( vec2 uv ) { return min( uv * uAct.xy, uAct.zw ); }
float viewZ( float d ) { float n = d * 2.0 - 1.0; return ( uInvProj[ 2 ][ 2 ] * n + uInvProj[ 3 ][ 2 ] ) / ( uInvProj[ 2 ][ 3 ] * n + uInvProj[ 3 ][ 3 ] ); }
vec3 viewPos( vec2 uv, float d ) { vec4 p = uInvProj * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); return p.xyz / p.w; }
float ign( vec2 p, float f ) { p += 5.588238 * f; return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
`;
const TRACE = HEAD + /* glsl */ `
uniform sampler2D tC, tPD, tH;
uniform mat4 uCamW, uPrevVP, uPrevInvVP;
uniform vec4 uActC;      // last frame's colour: uv scale, largest uv
uniform vec4 uActP;      // last frame's G-buffer depth: the same
uniform vec4 uHT, uHC;   // this pass's tile in the history atlas: origin + scale; smallest and largest uv inside it
uniform vec4 uA;         // length (m), thickness (m), roughness limit, brightest colour kept
uniform vec3 uSun;       // toward the key light, view space
uniform int uSteps, uRefine, uRays;
uniform float uAlpha, uHasPrev, uHasHist, uNear;

bool inside( vec2 uv ) { return uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0; }
float edge( vec2 uv ) { vec2 e = smoothstep( vec2( 0.0 ), vec2( 0.08 ), uv ) * ( 1.0 - smoothstep( vec2( 0.92 ), vec2( 1.0 ), uv ) ); return e.x * e.y; }
// xy: the uv hit, z: 1 on a hit, w: distance (m)
vec4 march( vec3 P, vec3 D, float len, float thick, float jit ) {
	if ( D.z > 0.0 ) len = min( len, ( - uNear - P.z ) / D.z * 0.97 );   // stop in front of the eye
	const float G = 1.14;
	float dt = len * ( G - 1.0 ) / ( pow( G, float( uSteps ) ) - 1.0 ), t = 0.0, t0 = 0.0;
	for ( int i = 0; i < 96; i ++ ) {
		if ( i >= uSteps ) break;
		t0 = t; t += dt * ( i == 0 ? 0.35 + jit : 1.0 );
		vec3 p = P + D * t;
		vec4 c = uProj * vec4( p, 1.0 );
		vec2 uv = c.xy / c.w * 0.5 + 0.5;
		if ( ! inside( uv ) ) return vec4( 0.0 );
		float dz = viewZ( texture2D( tGD, gUV( uv ) ).x ) - p.z;   // > 0: the ray is behind what the eye sees there
		if ( dz > 0.0 && dz < thick + 0.6 * abs( D.z ) * ( t - t0 ) ) {
			float a = t0, b = t;
			for ( int j = 0; j < 8; j ++ ) {
				if ( j >= uRefine ) break;
				float m = 0.5 * ( a + b );
				p = P + D * m; c = uProj * vec4( p, 1.0 ); uv = c.xy / c.w * 0.5 + 0.5;
				if ( viewZ( texture2D( tGD, gUV( uv ) ).x ) - p.z > 0.0 ) b = m; else a = m;
			}
			p = P + D * b; c = uProj * vec4( p, 1.0 ); uv = c.xy / c.w * 0.5 + 0.5;
			dz = viewZ( texture2D( tGD, gUV( uv ) ).x ) - p.z;
			if ( dz < thick && inside( uv ) ) return vec4( uv, 1.0, b );
		}
		dt *= G;
	}
	return vec4( 0.0 );
}
// last frame's lit colour where the point seen at uv now was then (a: 1 when it was on screen)
vec4 colourAt( vec2 uv ) {
	vec3 W = ( uCamW * vec4( viewPos( uv, texture2D( tGD, gUV( uv ) ).x ), 1.0 ) ).xyz;
	vec4 pc = uPrevVP * vec4( W, 1.0 );
	vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
	if ( pc.w <= 0.0 || ! inside( puv ) ) return vec4( 0.0 );
	vec3 c = max( texture2D( tC, min( puv * uActC.xy, uActC.zw ) ).rgb, 0.0 );
	float l = max( c.r, max( c.g, c.b ) );
	return vec4( c * min( 1.0, uA.w / max( l, 1e-4 ) ), edge( puv ) );
}
void basis( vec3 N, out vec3 T, out vec3 B ) { T = normalize( cross( abs( N.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 ), N ) ); B = cross( N, T ); }
void main() {
	vec4 g = texture2D( tG, gUV( vUv ) );
	vec4 cur = uMode == 2 ? vec4( 1.0 ) : vec4( 0.0 );
	if ( g.a < 1.5 ) { gl_FragColor = cur; return; }   // sky, or nothing lit and opaque
	float d = texture2D( tGD, gUV( vUv ) ).x;
	vec3 P = viewPos( vUv, d ), N = mgOctDec( g.rg ), V = normalize( - P );
	vec3 P0 = P + N * ( 0.012 + 0.004 * - P.z );
	vec3 T, B; basis( N, T, B );
	float rough = g.b, hitT = 0.0, alpha = uAlpha;
	if ( uMode == 0 ) {
		float fade = 1.0 - smoothstep( uA.z * 0.75, uA.z, rough );
		if ( fade > 0.0 && uHasPrev > 0.5 ) {
			float a = rough * rough, tw = 0.0;
			for ( int r = 0; r < 8; r ++ ) {
				if ( r >= uRays ) break;
				float f = uFrame + 7.0 * float( r );
				vec2 u = vec2( ign( gl_FragCoord.xy, f ), ign( gl_FragCoord.yx + 31.7, f ) );
				u.y *= 0.8;   // the far tail of the lobe is all noise for one ray: left to the blur
				float c2 = ( 1.0 - u.y ) / ( 1.0 + ( a * a - 1.0 ) * u.y ), s = sqrt( max( 1.0 - c2, 0.0 ) ), ph = 6.2831853 * u.x;
				vec3 H = T * ( cos( ph ) * s ) + B * ( sin( ph ) * s ) + N * sqrt( c2 );
				vec3 R = reflect( - V, H );
				if ( dot( R, N ) < 0.02 ) R = reflect( - V, N );
				vec4 h = march( P0, R, uA.x, uA.y, ign( gl_FragCoord.xy + 13.0, f ) );
				if ( h.z > 0.5 ) {
					vec4 c = colourAt( h.xy );
					vec4 gh = texture2D( tG, gUV( h.xy ) );
					float k = c.a * edge( h.xy ) * ( 1.0 - smoothstep( 0.8, 1.0, h.w / uA.x ) ) * step( dot( mgOctDec( gh.rg ), R ), 0.15 );
					cur += vec4( c.rgb * k, k ); hitT += h.w * k; tw += k;
				}
			}
			cur *= fade / float( uRays );
			hitT = tw > 0.0 ? hitT / tw : 0.0;
		}
		alpha = mix( min( 1.0, uAlpha * 2.5 ), uAlpha, smoothstep( 0.03, 0.3, rough ) );
	} else if ( uMode == 1 ) {
		if ( uHasPrev > 0.5 ) {
			for ( int r = 0; r < 8; r ++ ) {
				if ( r >= uRays ) break;
				float f = uFrame + 7.0 * float( r );
				float u1 = ign( gl_FragCoord.xy + 3.3, f ), u2 = ign( gl_FragCoord.yx + 47.1, f ), ph = 6.2831853 * u1, s = sqrt( u2 );
				vec3 D = T * ( cos( ph ) * s ) + B * ( sin( ph ) * s ) + N * sqrt( 1.0 - u2 );
				vec4 h = march( P0, D, uA.x, uA.y, ign( gl_FragCoord.xy + 13.0, f ) );
				if ( h.z > 0.5 ) {
					float k = 1.0 - smoothstep( 0.7, 1.0, h.w / uA.x );
					vec4 c = colourAt( h.xy );
					// the back of what was hit is not what the eye saw: it covers, and gives nothing
					float front = step( dot( mgOctDec( texture2D( tG, gUV( h.xy ) ).rg ), D ), 0.0 );
					cur += vec4( c.rgb * ( c.a * front * k ), k );
				}
			}
			cur /= float( uRays );
		}
	} else {
		float nl = dot( N, uSun );
		if ( nl > 0.0 ) {
			vec4 h = march( P0, uSun, uA.x, uA.y, ign( gl_FragCoord.xy, uFrame ) );
			if ( h.z > 0.5 ) cur = vec4( mix( 1.0, smoothstep( 0.6, 1.0, h.w / uA.x ), edge( h.xy ) ) );
		}
	}
	if ( alpha < 1.0 && uHasHist > 0.5 ) {
		vec3 W = ( uCamW * vec4( P, 1.0 ) ).xyz;
		vec4 ps = uPrevVP * vec4( W, 1.0 );
		vec2 suv = ps.xy / ps.w * 0.5 + 0.5, huv = suv;
		if ( uMode == 0 && hitT > 0.0 && rough < 0.3 ) {
			// a mirror image moves like a point behind the surface, as far behind as the hit is in front
			vec4 pv = uPrevVP * uCamW * vec4( P * ( 1.0 + hitT / max( length( P ), 1e-3 ) ), 1.0 );
			huv = mix( pv.xy / pv.w * 0.5 + 0.5, suv, smoothstep( 0.1, 0.3, rough ) );
		}
		if ( ps.w > 0.0 && inside( suv ) && inside( huv ) ) {
			vec4 q = uPrevInvVP * vec4( suv * 2.0 - 1.0, texture2D( tPD, min( suv * uActP.xy, uActP.zw ) ).x * 2.0 - 1.0, 1.0 );
			if ( distance( q.xyz / q.w, W ) < 0.03 - 0.03 * P.z ) cur = mix( texture2D( tH, uHT.xy + clamp( huv, uHC.xy, uHC.zw ) * uHT.zw ), cur, alpha );
		}
	}
	gl_FragColor = cur;
}`;
const BLUR = HEAD + /* glsl */ `
uniform sampler2D tH;
uniform vec4 uHT, uHC;
uniform vec2 uPx;        // one G-buffer pixel in uv
uniform float uRadius;   // px (reflections: x roughness)
void main() {
	vec4 c = texture2D( tH, uHT.xy + clamp( vUv, uHC.xy, uHC.zw ) * uHT.zw );
	vec4 g = texture2D( tG, gUV( vUv ) );
	if ( g.a < 1.5 ) { gl_FragColor = c; return; }
	float z = viewZ( texture2D( tGD, gUV( vUv ) ).x ), r = uRadius * ( uMode == 0 ? 0.25 + 4.0 * g.b : 1.0 ), wsum = 1.0;
	vec3 N = mgOctDec( g.rg );
	float a0 = 6.2831853 * ign( gl_FragCoord.xy, uFrame );
	for ( int i = 0; i < 8; i ++ ) {
		float t = a0 + 2.39996323 * float( i ), rr = r * sqrt( ( float( i ) + 0.5 ) / 8.0 );
		vec2 uv = vUv + vec2( cos( t ), sin( t ) ) * rr * uPx;
		vec4 gi = texture2D( tG, gUV( uv ) );
		float zi = viewZ( texture2D( tGD, gUV( uv ) ).x );
		float w = step( 1.5, gi.a ) * pow( max( dot( N, mgOctDec( gi.rg ) ), 0.0 ), 16.0 ) * max( 0.0, 1.0 - abs( zi - z ) / ( 0.04 * abs( z ) + 0.02 ) );
		if ( uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0 ) w = 0.0;
		c += w * texture2D( tH, uHT.xy + clamp( uv, uHC.xy, uHC.zw ) * uHT.zw ); wsum += w;
	}
	gl_FragColor = c / wsum;
}`;

const PARS = /* glsl */ `
uniform sampler2D mgScrT;
uniform vec4 mgScr;        // x: 1 while the G-buffer is drawn; y, z, w: reflections, indirect, contact (0 = off)
uniform vec4 mgScrR;       // xy: buffer px per render px, zw: 1 / atlas px
uniform vec4 mgScrB;       // xy: largest px inside a tile
uniform vec2 mgScrO[ 3 ];  // each pass's tile origin (px)
vec4 mgScrTap( int i ) { return texture2D( mgScrT, ( mgScrO[ i ] + clamp( gl_FragCoord.xy * mgScrR.xy, vec2( 0.5 ), mgScrB.xy ) ) * mgScrR.zw ); }
`;
const GBUF = /* glsl */ `if ( mgScr.x > 0.5 ) {
	#ifdef STANDARD
	float mgGr = material.roughness;
	#else
	float mgGr = 1.0;
	#endif
	gl_FragColor = vec4( mgOct( normalize( normal ) ), mgGr, 2.0 );
	return;
}
float mgScrCt = mgScr.w > 0.0 ? mix( 1.0, mgScrTap( 2 ).r, mgScr.w ) : 1.0;
`;
const A_GEO = 'vec3 geometryPosition = - vViewPosition;', A_DIR = 'getDirectionalLightInfo( directionalLight, directLight );', A_END = '#include <lights_fragment_end>';

function part(U) {
  return {
    id: 'screen', order: 40, pars: PARS, uniforms: U,
    apply(fs, t) {
      fs = t.swap(fs, A_GEO, GBUF + A_GEO, 'screen');
      fs = t.swap(fs, A_DIR, A_DIR + '\n\t\tif ( UNROLLED_LOOP_INDEX == 0 ) directLight.color *= mgScrCt;', 'screen contact');
      // reflections: after the reflection probes had their say, before three weights the radiance by the surface
      // (after gi.js scaled the sky's share: a hit carries its own light)
      const i = fs.lastIndexOf('radiance += iblRadiance;');
      if (i < 0) fs = t.swap(fs, '\u0000', '', 'screen reflections');
      else fs = fs.slice(0, i) + /* glsl */ `if ( mgScr.y > 0.0 ) { vec4 mgS = mgScrTap( 0 ); iblRadiance = iblRadiance * ( 1.0 - mgS.a * mgScr.y ) + mgS.rgb * mgScr.y; }
	` + fs.slice(i);
      return t.swap(fs, A_END, /* glsl */ `#if defined( RE_IndirectDiffuse )
	if ( mgScr.z > 0.0 ) {
		vec4 mgS = mgScrTap( 1 );
		float mgK = 1.0 - mgS.a * mgScr.z;
		irradiance = irradiance * mgK + PI * mgS.rgb * mgScr.z; iblIrradiance *= mgK;
	}
#endif
` + A_END, 'screen indirect');
    },
  };
}

/** w: { renderer, scene, sun }; the pipeline calls before() / after() around each sub-frame's scene pass */
export function createScreen(w, cfg) {
  const { renderer, scene, sun } = w, LAYER = cfg.layer;
  const U = {
    mgScrT: { value: null }, mgScr: { value: new THREE.Vector4(0, 0, 0, 0) },   // all off until before() says otherwise (a bare Vector4 has w = 1: contact shadows on, reading no atlas, which blacked the sun out of the first probe and sky captures)
    mgScrR: { value: new THREE.Vector4(1, 1, 1, 1) },
    mgScrB: { value: new THREE.Vector4(1, 1, 0, 0) }, mgScrO: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  };
  const M4 = () => ({ value: new THREE.Matrix4() }), V4 = () => ({ value: new THREE.Vector4() });
  const shared = { tG: { value: null }, tGD: { value: null }, uProj: M4(), uInvProj: M4(), uAct: V4(), uFrame: { value: 0 }, uMode: { value: 0 }, tH: { value: null }, uHT: V4(), uHC: V4() };
  const trace = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: TRACE, depthTest: false, depthWrite: false,
    uniforms: { ...shared, tC: { value: null }, tPD: { value: null }, uCamW: M4(), uPrevVP: M4(), uPrevInvVP: M4(), uActC: V4(), uActP: V4(), uA: V4(), uSun: { value: new THREE.Vector3() },
      uSteps: { value: 20 }, uRefine: { value: 5 }, uRays: { value: 1 }, uAlpha: { value: 1 }, uHasPrev: { value: 0 }, uHasHist: { value: 0 }, uNear: { value: 0.1 } },
  });
  const blur = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: BLUR, depthTest: false, depthWrite: false, uniforms: { ...shared, uPx: { value: new THREE.Vector2() }, uRadius: { value: 1 } } });
  const quad = new FullScreenQuad(trace);
  const sets = { live: null, ref: null };
  const prev = { vp: new THREE.Matrix4(), inv: new THREE.Matrix4(), colour: false, act: new THREE.Vector4(), actC: new THREE.Vector4(), live: false, layout: '' };
  const info = { on: false, mode: '', size: [0, 0], passes: 0, gbufCalls: 0, marked: 0, warned: false };
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _c = new THREE.Color();
  let frame = 0, pending = null;

  const rt = (w2, h2, depth) => {
    const t = new THREE.WebGLRenderTarget(w2, h2, { type: THREE.HalfFloatType, depthBuffer: !!depth, generateMipmaps: false, minFilter: depth ? THREE.NearestFilter : THREE.LinearFilter, magFilter: depth ? THREE.NearestFilter : THREE.LinearFilter,
      ...(depth ? { depthTexture: new THREE.DepthTexture(w2, h2, THREE.FloatType) } : {}) });
    return t;
  };
  const drop = (S) => { if (S) for (const t of [...S.gb, ...S.hist, S.out]) if (t) { if (t.depthTexture) t.depthTexture.dispose(); t.dispose(); } };
  // a set of targets: G-buffers (two when history needs last frame's depth), the atlas (history x2 + blurred, or one)
  function setFor(name, tw, th, cols, rows) {
    let S = sets[name];
    const key = tw + 'x' + th + ':' + cols + 'x' + rows;
    if (S && S.key === key) return S;
    drop(S);
    const live = name === 'live', aw = tw * cols, ah = th * rows;
    S = sets[name] = { key, tw, th, cols, rows, gb: live ? [rt(tw, th, true), rt(tw, th, true)] : [rt(tw, th, true)], hist: live ? [rt(aw, ah), rt(aw, ah)] : [], out: rt(aw, ah), flip: 0, fresh: true };
    return S;
  }
  const view = (t, x, y, w2, h2) => { t.viewport.set(x, y, w2, h2); t.scissor.set(x, y, w2, h2); t.scissorTest = true; };

  /** mark what the G-buffer pass draws: opaque lit meshes (and every light, so the pass sees the same light setup
   *  and three keeps the same programs); `lit` = the injector's materials */
  function mark(root, lit) {
    let n = 0;
    const ok = (m) => lit.has(m) && !m.transparent && m.depthWrite && !(m.transmission > 0) && m.visible;
    root.traverse((o) => {
      if (o.isLight) { if (o.layers.mask & 1) o.layers.enable(LAYER); return; }
      const m = o.material;
      if (!m || !(o.isMesh || o.isBatchedMesh)) return;
      if ((o.layers.mask & 1) && (Array.isArray(m) ? m.every(ok) : ok(m))) { o.layers.enable(LAYER); n++; } else o.layers.disable(LAYER);
    });
    info.marked = n;
  }

  function before(pipe, sc, camera, k, still, P) {
    const want = [P.ssr2 > 0, P.ssgi > 0, P.contact > 0], n = want.filter(Boolean).length;
    U.mgScr.value.set(0, 0, 0, 0); pending = null; info.on = false; info.passes = 0;
    if (!n || renderer.xr.isPresenting || sc !== scene) { prev.colour = false; prev.live = false; return; }
    if (still && k === 0 && (want[0] || want[1])) {
      // a still's first sub-frame has no "last frame" it may trust (the view may have been cut): draw the scene once
      // without these passes, so the still does not depend on what was on screen before it
      const rt0 = renderer.getRenderTarget(); renderer.getClearColor(_c); const a0 = renderer.getClearAlpha();
      renderer.setRenderTarget(pipe.sceneRT); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
      renderer.render(scene, camera);
      renderer.setRenderTarget(rt0); renderer.setClearColor(_c, a0);
      after(pipe, camera);
    }
    const scale = still ? cfg.refScale : cfg.scale;
    const tw = Math.max(8, Math.ceil(pipe.w * scale)), th = Math.max(8, Math.ceil(pipe.h * scale));
    const aw = Math.max(8, Math.min(tw, Math.ceil(pipe.rw * scale))), ah = Math.max(8, Math.min(th, Math.ceil(pipe.rh * scale)));
    const cols = n > 1 ? 2 : 1, rows = n > 2 ? 2 : 1;
    const S = setFor(still ? 'ref' : 'live', tw, th, cols, rows);
    const layout = S.key + want.join();
    S.flip ^= 1;
    const gb = S.gb[S.gb.length > 1 ? S.flip : 0], gbPrev = S.gb[S.gb.length > 1 ? S.flip ^ 1 : 0];
    // ---- the G-buffer: the marked meshes, their own programs leaving early
    const saved = { rt: renderer.getRenderTarget(), auto: renderer.autoClear, xr: renderer.xr.enabled, bg: scene.background, mask: camera.layers.mask, a: renderer.getClearAlpha(), smA: renderer.shadowMap.autoUpdate, smN: renderer.shadowMap.needsUpdate };
    renderer.getClearColor(_c);
    view(gb, 0, 0, aw, ah);
    U.mgScr.value.x = 1; camera.layers.mask = 1 << LAYER; scene.background = null; renderer.xr.enabled = false; renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;   // the sun's map is drawn by the scene pass that follows
    renderer.setRenderTarget(gb); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false);
    const calls0 = renderer.info.render.calls;
    renderer.render(scene, camera);
    info.gbufCalls = renderer.info.render.calls - calls0;
    U.mgScr.value.x = 0; camera.layers.mask = saved.mask; scene.background = saved.bg;
    renderer.shadowMap.autoUpdate = saved.smA; renderer.shadowMap.needsUpdate = saved.smN;
    // ---- the passes
    const live = !still, histOK = live && prev.live && prev.layout === layout && !S.fresh;
    const act = new THREE.Vector4(aw / S.tw, ah / S.th, (aw - 0.5) / S.tw, (ah - 0.5) / S.th);
    const target = live ? S.hist[S.flip] : S.out, hprev = live ? S.hist[S.flip ^ 1] : null;
    const AW = S.tw * S.cols, AH = S.th * S.rows;
    for (const m of [trace, blur]) {
      const u = m.uniforms;
      u.tG.value = gb.texture; u.tGD.value = gb.depthTexture; u.uProj.value.copy(camera.projectionMatrix); u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uAct.value.copy(act); u.uFrame.value = still ? k : frame % 64;
    }
    const u = trace.uniforms;
    u.tC.value = pipe.sceneRT.texture; u.tPD.value = gbPrev.depthTexture; u.tH.value = hprev ? hprev.texture : null;
    u.uCamW.value.copy(camera.matrixWorld); u.uPrevVP.value.copy(prev.vp); u.uPrevInvVP.value.copy(prev.inv);
    u.uActC.value.copy(prev.actC); u.uActP.value.copy(prev.act);
    u.uHasPrev.value = prev.colour ? 1 : 0; u.uHasHist.value = histOK ? 1 : 0;
    u.uNear.value = camera.near || 0.05;
    u.uSun.value.copy(sun.position).sub(sun.target.position).normalize().transformDirection(camera.matrixWorldInverse);
    const lum = 16 / Math.max(P.exposure || 1, 1e-3);   // nothing brighter than a few stops over white is bounced
    const tiles = [];
    let slot = 0;
    info.passes = 0;
    for (let i = 0; i < 3; i++) {
      if (!want[i]) continue;
      const x = (slot % cols) * S.tw, y = Math.floor(slot / cols) * S.th; slot++;
      tiles.push([i, x, y]); U.mgScrO.value[i].set(x, y);
      u.uMode.value = i;
      // last frame's tile: the same place, its own used corner (dynamic resolution moves it)
      u.uHT.value.set(x / AW, y / AH, (prev.act.x * S.tw) / AW, (prev.act.y * S.th) / AH);
      u.uHC.value.set(0.5 / Math.max(prev.act.x * S.tw, 1), 0.5 / Math.max(prev.act.y * S.th, 1), 1 - 0.5 / Math.max(prev.act.x * S.tw, 1), 1 - 0.5 / Math.max(prev.act.y * S.th, 1));
      if (i === 0) { u.uA.value.set(P.ssrDist, P.ssrThick, P.ssrRough, lum); u.uSteps.value = still ? 56 : 22; u.uRefine.value = still ? 7 : 5; u.uRays.value = 1; u.uAlpha.value = live ? 0.1 : 1; }
      else if (i === 1) { u.uA.value.set(P.ssgiRange, Math.max(0.15, P.ssrThick), 1, lum); u.uSteps.value = still ? 20 : 9; u.uRefine.value = 2; u.uRays.value = Math.max(still ? 4 : 1, Math.min(8, Math.round(P.ssgiRays)));   /* a still has no history to average over: 4 rays a sub-frame */ u.uAlpha.value = live ? 0.06 : 1; }
      else { u.uA.value.set(P.contactLen, 0.12, 1, lum); u.uSteps.value = still ? 20 : 10; u.uRefine.value = 2; u.uRays.value = 1; u.uAlpha.value = live ? 0.25 : 1; }
      view(target, x, y, aw, ah);
      quad.material = trace; renderer.setRenderTarget(target); quad.render(renderer); info.passes++;
    }
    if (live) {
      const b = blur.uniforms;
      b.tH.value = target.texture; b.uPx.value.set(1 / aw, 1 / ah);
      for (const [i, x, y] of tiles) {
        b.uMode.value = i; b.uRadius.value = i === 0 ? 3 : i === 1 ? 6 : 1.5;
        b.uHT.value.set(x / AW, y / AH, aw / AW, ah / AH); b.uHC.value.set(0.5 / aw, 0.5 / ah, 1 - 0.5 / aw, 1 - 0.5 / ah);
        view(S.out, x, y, aw, ah);
        quad.material = blur; renderer.setRenderTarget(S.out); quad.render(renderer); info.passes++;
      }
    }
    renderer.setRenderTarget(saved.rt); renderer.setClearColor(_c, saved.a); renderer.autoClear = saved.auto; renderer.xr.enabled = saved.xr;
    // ---- what the scene pass reads
    U.mgScrT.value = S.out.texture;
    U.mgScr.value.set(0, want[0] ? Math.min(1, P.ssr2) : 0, want[1] ? Math.min(1, P.ssgi) : 0, want[2] ? Math.min(1, P.contact) : 0);
    U.mgScrR.value.set(aw / pipe.rw, ah / pipe.rh, 1 / AW, 1 / AH); U.mgScrB.value.set(aw - 0.5, ah - 0.5, 0, 0);
    S.fresh = false; frame++;
    info.on = true; info.mode = still ? 'ref' : 'live'; info.size = [aw, ah];
    pending = { vp: _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).clone(), act, actC: new THREE.Vector4(pipe.rw / pipe.w, pipe.rh / pipe.h, (pipe.rw - 0.5) / pipe.w, (pipe.rh - 0.5) / pipe.h), live, layout };
  }
  /** the scene pass is drawn: other renders (captures, probes) must not read the atlas; this frame becomes "last" */
  function after(pipe, camera) {
    U.mgScr.value.set(0, 0, 0, 0);
    if (pending) { prev.vp.copy(pending.vp); prev.inv.copy(pending.vp).invert(); prev.act.copy(pending.act); prev.actC.copy(pending.actC); prev.live = pending.live; prev.layout = pending.layout; prev.colour = true; pending = null; return; }
    // the passes are off: keep what a later first frame needs to read this frame's colour
    if (camera && pipe) { prev.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); prev.inv.copy(prev.vp).invert(); prev.actC.set(pipe.rw / pipe.w, pipe.rh / pipe.h, (pipe.rw - 0.5) / pipe.w, (pipe.rh - 0.5) / pipe.h); prev.colour = true; }
  }
  void _v;
  return {
    cfg, part: part(U), uniforms: U, info, mark, before, after, sets,
    get wanted() { return true; },
    dispose() { drop(sets.live); drop(sets.ref); sets.live = sets.ref = null; trace.dispose(); blur.dispose(); quad.dispose(); },
  };
}
