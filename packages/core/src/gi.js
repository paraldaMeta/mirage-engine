// Mirage original code.
// ---------------------------------------------------------------------------
// Diffuse global illumination from an irradiance probe volume (opt-in: lighting: { gi: { min, max, spacing } }).
//
//   createWorldRenderer({ lighting: { gi: { min: [-4, 3.6, -29], max: [4, 7.6, -21], spacing: 1.5 } } })
//   world.lighting.gi.info      // { probes, bakeMs, atlas: [w, h] } after prepare()
//   world.lighting.invalidate() // the built world changed: bake again (incrementally)
//
// What: a regular grid of probes over one box. Each probe holds the light arriving from every direction, already
// integrated over the hemisphere (irradiance, 8 x 8 texels in an octahedral layout) and how far the scene is in
// every direction (mean distance and mean squared distance, 16 x 16 texels). Both live in ONE half-float atlas.
// Baked on the GPU from the scene itself: per probe a small cube of the lit scene (the materials the frame uses,
// the sun's shadow, the sky) and a cube of distances, each folded into the probe's tiles by a full-screen pass.
// The capture sees the probes baked so far, so each pass over the volume adds a bounce; `bounces` passes at load.
// When the time of day moves (the world recaptures its image-based light) the probes are re-baked `perFrame` at a
// time, each from the scene lit by the volume as it is, so the light follows the clock without a stall.
// Read in the material shader: inside the box the image-based DIFFUSE light is replaced by the 8 surrounding
// probes, weighted trilinearly x by facing (a probe behind the surface counts little) x by visibility (Chebyshev's
// bound on "how likely is this probe to see this point" from the two distance moments: a probe on the other side
// of a wall drops out, so light does not leak through walls thicker than the bias). The image-based SPECULAR is
// scaled by probe light / sky light, so a dark room does not mirror the open sky. Over `fade` metres at the box
// faces it blends back to the world's image-based light.
// Do not also declare ambientVolumes for the same room: those dim the same term a second time.
// Limits: one box; static geometry only (objects whose root has userData.mgDynamic are left out of the bake and
// only receive); no sun disc in the capture (the sun arrives as its first bounce off surfaces).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OCT_DECODE } from './inject.js';

export const GI_DEFAULTS = {
  spacing: 1.5,     // m between probes (or counts: [nx, ny, nz])
  bounces: 2,       // passes over the volume at load (each one adds a bounce)
  cube: 32,         // px of a probe's capture cube face
  perFrame: 2,      // probes re-baked per frame after the time of day changed
  intensity: 1,     // scale of the probe light
  fade: 0.75,       // m at the box faces over which it blends to the image-based light
  bias: 0.25,       // share of the spacing the lookup is pushed off the surface (normal and view)
  specular: true,   // scale the image-based reflections inside the volume by probe light / sky light
  maxProbes: 4096,
};
const IRR = 8, VIS = 16, NS = 160;

/** a full config, or null when off / without a box */
export function giConfig(c) {
  if (!c || !c.min || !c.max) return null;
  return { ...GI_DEFAULTS, ...c };
}
/** the grid: counts, step (m), where the tiles sit in the atlas */
export function giGrid(cfg) {
  const size = [0, 1, 2].map((i) => cfg.max[i] - cfg.min[i]);
  let counts = cfg.counts ? cfg.counts.slice() : size.map((s) => Math.max(2, Math.ceil(s / cfg.spacing - 1e-6) + 1));
  while (counts[0] * counts[1] * counts[2] > cfg.maxProbes) counts = counts.map((n) => Math.max(2, n - 1));
  const step = size.map((s, i) => s / (counts[i] - 1));
  const cols = counts[0] * counts[2], rows = counts[1];
  return { counts, step, cols, rows, probes: cols * rows, irrH: rows * (IRR + 2), width: cols * (VIS + 2), height: rows * (IRR + 2) + rows * (VIS + 2) };
}
/** probe index -> grid cell [x, y, z] and back (x fastest, then z, then y: one atlas row per level) */
export const giCell = (g, i) => { const col = i % g.cols; return [col % g.counts[0], Math.floor(i / g.cols), Math.floor(col / g.counts[0])]; };
export const giTile = (g, c, vis) => { const t = (vis ? VIS : IRR) + 2; return [(c[0] + g.counts[0] * c[2]) * t, c[1] * t + (vis ? g.irrH : 0), t]; };

const fib = (n) => Array.from({ length: n }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), t = i * 2.399963229728653;
  return `vec3( ${(r * Math.cos(t)).toFixed(5)}, ${y.toFixed(5)}, ${(r * Math.sin(t)).toFixed(5)} )`;
}).join(', ');

const RUNTIME = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && defined( STANDARD )
#define MG_GI
uniform sampler2D mgGiT;
uniform vec3 mgGiMin; uniform vec3 mgGiStep; uniform vec3 mgGiN;
uniform vec4 mgGiA;   // x: intensity (0: off), y: fade (m), z: bias (m), w: specular scale on
uniform vec4 mgGiB;   // xy: 1 / atlas size, z: first row of the distance tiles (px)
vec2 mgGiUv( vec3 c, vec3 d, float inner, float y0 ) {
	return ( vec2( c.x + mgGiN.x * c.z, c.y ) * ( inner + 2.0 ) + 1.0 + mgOct( d ) * inner + vec2( 0.0, y0 ) ) * mgGiB.xy;
}
// irradiance at P for the normal N (world space); w: how much the volume counts here (0 outside)
vec3 mgGiSample( vec3 P, vec3 N, vec3 V, out float w ) {
	vec3 size = mgGiStep * ( mgGiN - 1.0 );
	vec3 e = min( P - mgGiMin, mgGiMin + size - P );
	w = mgGiA.x > 0.0 ? clamp( min( e.x, min( e.y, e.z ) ) / max( mgGiA.y, 1e-3 ) + 1.0, 0.0, 1.0 ) : 0.0;   // 1 at the face, 0 a fade outside
	if ( w <= 0.0 ) return vec3( 0.0 );
	vec3 Pb = P + ( N * 0.8 + V * 0.2 ) * mgGiA.z;
	vec3 g = clamp( ( Pb - mgGiMin ) / mgGiStep, vec3( 0.0 ), mgGiN - 1.0 );
	vec3 b = min( floor( g ), mgGiN - 2.0 ), f = g - b;
	vec3 sum = vec3( 0.0 ); float ws = 0.0;
	for ( int i = 0; i < 8; i ++ ) {
		vec3 o = vec3( float( i & 1 ), float( ( i >> 1 ) & 1 ), float( ( i >> 2 ) & 1 ) );
		vec3 c = b + o;
		vec3 pp = mgGiMin + c * mgGiStep;
		vec3 t3 = mix( 1.0 - f, f, o );
		float wt = t3.x * t3.y * t3.z;
		// facing: a probe behind the surface lights it little (wrapped, so a wall between two probes is not black)
		float wn = 0.5 * dot( normalize( pp - P ), N ) + 0.5;
		wt *= wn * wn + 0.2;
		// visibility: can the probe see the point? Chebyshev's bound from the mean and mean square of its distances
		vec3 d = Pb - pp; float r = length( d );
		vec2 m = texture2D( mgGiT, mgGiUv( c, d / max( r, 1e-4 ), ${VIS}.0, mgGiB.z ) ).xy;
		if ( r > m.x ) { float v = max( m.y - m.x * m.x, 1e-4 ), q = r - m.x; float ch = v / ( v + q * q ); wt *= ch * ch * ch + 0.01; }
		wt = max( wt, 1e-5 );
		sum += wt * texture2D( mgGiT, mgGiUv( c, N, ${IRR}.0, 0.0 ) ).rgb; ws += wt;
	}
	return mgGiA.x * sum / ws;
}
#endif
`;

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';

export function createGi(w, cfg) {
  const { renderer, scene } = w;
  const g = giGrid(cfg);
  const atlas = new THREE.WebGLRenderTarget(g.width, g.height, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  atlas.texture.name = 'mgGi'; atlas.texture.colorSpace = THREE.NoColorSpace;
  const cube = new THREE.WebGLCubeRenderTarget(cfg.cube, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const dcube = new THREE.WebGLCubeRenderTarget(16, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const maxDist = 2 * Math.hypot(...g.step);
  const cam = new THREE.CubeCamera(0.05, 400, cube), dcam = new THREE.CubeCamera(0.05, 400, dcube);
  // distances: every mesh drawn two-sided with its world distance to the probe (instances and skinning followed; wind sway not)
  const distMat = new THREE.ShaderMaterial({
    uniforms: { uP: { value: new THREE.Vector3() } }, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec3 vW;
#include <common>
#include <skinning_pars_vertex>
void main() {
	#include <skinbase_vertex>
	#include <begin_vertex>
	#include <skinning_vertex>
	vec4 p = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
	p = instanceMatrix * p;
	#endif
	p = modelMatrix * p; vW = p.xyz;
	gl_Position = projectionMatrix * viewMatrix * p;
}`,
    fragmentShader: 'uniform vec3 uP; varying vec3 vW; void main(){ gl_FragColor = vec4( distance( vW, uP ), 0.0, 0.0, 1.0 ); }',
  });
  const lod = Math.max(0, Math.log2(cfg.cube) - 3).toFixed(1);   // an 8 x 8 face per sample: the samples cover the sphere without holes
  const irrMat = new THREE.ShaderMaterial({
    uniforms: { tCube: { value: cube.texture } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */ `uniform samplerCube tCube; varying vec2 vUv;
${OCT_DECODE}
const vec3 S[ ${NS} ] = vec3[ ${NS} ]( ${fib(NS)} );
void main() {
	vec3 n = mgOctDec( ( vUv * ${IRR + 2}.0 - 1.0 ) / ${IRR}.0 );
	vec3 e = vec3( 0.0 );
	for ( int i = 0; i < ${NS}; i ++ ) { float c = dot( n, S[ i ] ); if ( c > 0.0 ) e += min( textureLod( tCube, S[ i ], ${lod} ).rgb, vec3( 64.0 ) ) * c; }
	gl_FragColor = vec4( e * ( 12.566371 / ${NS}.0 ), 1.0 );
}`,
  });
  const visMat = new THREE.ShaderMaterial({
    uniforms: { tCube: { value: dcube.texture }, uMax: { value: maxDist } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */ `uniform samplerCube tCube; uniform float uMax; varying vec2 vUv;
${OCT_DECODE}
const vec3 S[ ${NS} ] = vec3[ ${NS} ]( ${fib(NS)} );
void main() {
	vec3 n = mgOctDec( ( vUv * ${VIS + 2}.0 - 1.0 ) / ${VIS}.0 );
	vec3 m = vec3( 0.0 );
	for ( int i = 0; i < ${NS}; i ++ ) {
		float c = max( dot( n, S[ i ] ), 0.0 ); c *= c; c *= c; c *= c; c *= c;   // a narrow lobe: cos^16
		float d = min( textureLod( tCube, S[ i ], 0.0 ).r, uMax );
		m += vec3( d, d * d, 1.0 ) * c;
	}
	// the exact direction counts too, so a lobe that caught no sample is still defined
	float d0 = min( textureLod( tCube, n, 0.0 ).r, uMax );
	m += vec3( d0, d0 * d0, 1.0 ) * 0.5;
	gl_FragColor = vec4( m.xy / m.z, 0.0, 1.0 );
}`,
  });
  const quad = new FullScreenQuad(irrMat);
  const U = {
    mgGiT: { value: atlas.texture },
    mgGiMin: { value: new THREE.Vector3().fromArray(cfg.min) }, mgGiStep: { value: new THREE.Vector3().fromArray(g.step) }, mgGiN: { value: new THREE.Vector3().fromArray(g.counts) },
    mgGiA: { value: new THREE.Vector4(0, cfg.fade, cfg.bias * Math.min(...g.step), cfg.specular ? 1 : 0) },
    mgGiB: { value: new THREE.Vector4(1 / g.width, 1 / g.height, g.irrH, 0) },
  };
  const info = { probes: g.probes, counts: g.counts, atlas: [g.width, g.height], bakeMs: 0, baked: 0, pending: 0 };
  let haveDist = false, queue = [], cursor = 0;
  const _clear = new THREE.Color();

  function fold(material, c, vis) {
    const [x, y, t] = giTile(g, c, vis);
    quad.material = material;
    atlas.viewport.set(x, y, t, t); atlas.scissor.set(x, y, t, t); atlas.scissorTest = true;
    renderer.setRenderTarget(atlas);
    quad.render(renderer);
  }
  // one probe, inside a capture scope (world: sky without discs, stars and dynamic objects hidden, sun shadow frozen)
  function bakeProbe(i, distances) {
    const c = giCell(g, i);
    const p = [0, 1, 2].map((k) => cfg.min[k] + c[k] * g.step[k]);
    const savedRT = renderer.getRenderTarget(), auto = renderer.autoClear, xr = renderer.xr.enabled;
    renderer.xr.enabled = false; renderer.autoClear = true;
    if (distances) {
      const a = renderer.getClearAlpha(); renderer.getClearColor(_clear);
      renderer.setClearColor(new THREE.Color(1e4, 0, 0), 1);
      const om = scene.overrideMaterial, bg = scene.background;
      scene.overrideMaterial = distMat; scene.background = null; distMat.uniforms.uP.value.fromArray(p);
      w.skyVisible(false);
      dcam.position.fromArray(p); dcam.update(renderer, scene);
      w.skyVisible(true);
      scene.overrideMaterial = om; scene.background = bg; renderer.setClearColor(_clear, a);
      fold(visMat, c, true);
    }
    cam.position.fromArray(p); cam.update(renderer, scene);
    fold(irrMat, c, false);
    renderer.setRenderTarget(savedRT); renderer.autoClear = auto; renderer.xr.enabled = xr;
    info.baked++;
  }
  function run(list, distances) { if (list.length) w.capture(() => { for (const i of list) bakeProbe(i, distances); }); }

  /** bake the whole volume now: `bounces` passes (distances once) */
  function bake(bounces = cfg.bounces) {
    const t0 = performance.now(), all = Array.from({ length: g.probes }, (_, i) => i);
    U.mgGiA.value.x = cfg.intensity;
    if (!haveDist) {
      const saved = renderer.getRenderTarget(), a = renderer.getClearAlpha(); renderer.getClearColor(_clear);
      atlas.scissorTest = false; atlas.viewport.set(0, 0, g.width, g.height);
      renderer.setRenderTarget(atlas); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.setRenderTarget(saved); renderer.setClearColor(_clear, a);
    }
    for (let b = 0; b < Math.max(1, bounces); b++) { run(all, !haveDist); haveDist = true; }
    queue = []; info.pending = 0;
    info.bakeMs = Math.round(performance.now() - t0);
    return info;
  }
  /** queue `rounds` passes over the volume, done perFrame probes at a time by frame() */
  function rebake(rounds = cfg.bounces, distances = false) {
    if (!haveDist) return bake();
    if (distances) haveDist = false;
    queue = [];
    for (let r = 0; r < rounds; r++) for (let i = 0; i < g.probes; i++) queue.push((cursor + i) % g.probes);
    info.pending = queue.length;
  }
  const part = {
    id: 'gi', key: g.counts.join('x'), order: 30, pars: RUNTIME, uniforms: U,
    apply(fs, t) {
      fs = t.swap(fs, 'iblIrradiance += getIBLIrradiance( geometryNormal );', /* glsl */ `vec3 mgEnvE = getIBLIrradiance( geometryNormal );
			#ifdef MG_GI
			float mgGiW; vec3 mgGiE = mgGiSample( mgLW( geometryPosition ), mgLWN( geometryNormal ), mgLWN( geometryViewDir ), mgGiW );
			iblIrradiance += mix( mgEnvE, mgGiE, mgGiW );
			#else
			iblIrradiance += mgEnvE;
			#endif`, 'gi');
      return t.swap(fs, 'radiance += iblRadiance;', /* glsl */ `#if defined( MG_GI ) && defined( RE_IndirectDiffuse )
		if ( mgGiA.w > 0.5 ) iblRadiance *= mix( 1.0, clamp( dot( mgGiE, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( dot( mgEnvE, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 ), 0.0, 1.0 ), mgGiW );
		#endif
		radiance += iblRadiance;`, 'gi-spec');
    },
  };
  return {
    cfg, grid: g, part, uniforms: U, info, atlas, bake, rebake,
    get busy() { return queue.length > 0; },
    /** per frame: re-bake a few probes while a re-bake is queued */
    frame() {
      if (!queue.length) return;
      const list = queue.splice(0, cfg.perFrame);
      cursor = (list[list.length - 1] + 1) % g.probes;
      run(list, !haveDist);
      if (!queue.length) haveDist = true;
      info.pending = queue.length;
    },
    envCaptured() { if (!haveDist) bake(); else rebake(); },
    invalidate() { rebake(cfg.bounces, true); },
    /** read one probe's irradiance for a direction (tests, debugging): [r, g, b] */
    read(i, dir) {
      const c = giCell(g, i), [x, y] = giTile(g, c, false), d = new THREE.Vector3().fromArray(dir).normalize();
      const s = Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z); d.divideScalar(s);
      const o = d.y <= 0 ? [d.x, d.z] : [(1 - Math.abs(d.z)) * (d.x >= 0 ? 1 : -1), (1 - Math.abs(d.x)) * (d.z >= 0 ? 1 : -1)];
      const px = Math.min(IRR - 1, Math.floor((o[0] * 0.5 + 0.5) * IRR)), py = Math.min(IRR - 1, Math.floor((o[1] * 0.5 + 0.5) * IRR));
      const buf = new Uint16Array(4);
      renderer.readRenderTargetPixels(atlas, x + 1 + px, y + 1 + py, 1, 1, buf);
      return [0, 1, 2].map((k) => THREE.DataUtils.fromHalfFloat(buf[k]));
    },
    dispose() { atlas.dispose(); cube.dispose(); dcube.dispose(); distMat.dispose(); irrMat.dispose(); visMat.dispose(); quad.dispose(); },
  };
}
