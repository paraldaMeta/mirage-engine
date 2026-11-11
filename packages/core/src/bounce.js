// Mirage original code: the irradiance volume of the author's Nizwa Golden Hour project (src/core/irradiance.js),
// ported into Mirage's lighting injector.
// ---------------------------------------------------------------------------
// One-bounce light from a height field (opt-in: lighting: { bounce: true | { min, max, spacing, ... } }).
//
//   createWorldRenderer({ lighting: { bounce: { min: [-24, 0.5, -34], max: [78, 31, 34] } } })
//   createWorldRenderer({ shadow: { center, radius }, lighting: { bounce: true } })   // the box: the shadow volume
//   world.lighting.bounce.info      // { probes, grid, map, prepareMs, bakeMs, bakes } after prepare()
//   world.lighting.invalidate()     // the built world changed: the height field is drawn again, then a re-bake
//
// What: warm light from sunlit walls and ground into the shade next to them, and the sky occlusion of lanes and
// courts, as a factor on every lit material's image-based DIFFUSE light. A world of walls, roofs and ground is close
// to 2.5D, so the probes are gathered from a height field of the real scene instead of a cube render per probe:
//   1. at prepare (and after invalidate): ONE orthographic draw of the built scene from above, its own materials under
//      a uniform white sky with every light off = albedo; its depth = height. Mipmapped.
//   2. per bake: the key light's shadow height S(x, z) (a point above (x, z) is lit when y > S), one march per texel.
//   3. per bake: every probe (a grid over the box: `spacing` in x and z, `layers` heights, denser near the ground)
//      marches 48 fixed directions through the height field: a ray that leaves sees the world's image-based light, a
//      ray that drops onto a top sees albedo / pi x (key x cos x lit + sky), a ray that runs into the side of a column
//      sees a wall (the albedo of its top, its normal against the ray, lit by S just outside it); `multi` stands in for
//      the further bounces. Stored as L1 spherical harmonics of radiance, premultiplied by the probe's validity
//      (probes inside solids or under roofs are 0). One more probe is gathered where the world's image-based light is
//      captured (envProbe): the reference.
//   4. materials: iblIrradiance *= E_local(n) / E_reference(n). The world's image-based light keeps its level (the
//      bake's own biases cancel in the ratio) and gains only the local variation: lanes lose sky, a shaded wall that
//      faces a sunlit one gains its warm bounce. Validity-weighted trilinear filtering keeps probes inside walls from
//      leaking; outside the grid the factor fades to 1 over `edge` probes.
// Time of day: a bake follows each recapture of the image-based light. A still (setTime without ease) bakes at once,
// so stills are exact and repeatable; a running clock gathers one band of one layer per frame and then eases the
// volume the materials read toward the new one (`ease` seconds), so nothing steps and nothing flickers.
// Cost: one draw of the scene at prepare (not one per probe), a few full-screen passes per bake, and four volume
// fetches per lit pixel (plus four for the reference, the same texels for every pixel).
// Limits: a height field has one height per (x, z): under an arch or a roof the probe is invalid (the image-based light
// stays as it is; use ambient volumes for rooms); a balcony is a column to the ground. Static geometry only (objects
// whose root has userData.mgDynamic, mgNoCapture or mgNoBounce are left out). Local lamps are not in it. Do not also
// turn on `gi` over the same area: both act on the same term.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const BOUNCE_DEFAULTS = {
  spacing: 2,        // m between probes in x and z
  layers: 8,         // probe heights over the box, denser near the ground: layer k at min.y + (max.y - min.y) (k / (layers - 1))^curve
  curve: 2,          // 2: quadratic (Nizwa's town: 0.5 m steps at the ground, wide ones at the roofs); 1: even steps
  texel: 0.5,        // m per height-field texel
  margin: 8,         // m of height field around the box (rays leaving the grid still find walls)
  hmax: 0,           // m: rays above this escape to the sky (0: the box top + 4 m)
  strength: 1,       // 0..1 (more extrapolates)
  multi: 0.55,       // further bounces: a surface of albedo a sends 1 / (1 - multi a) of its single bounce
  edge: 3,           // probes outside the grid over which the factor fades to 1
  lo: 0.3, hi: 4,    // clamp of local / reference light
  bands: 3,          // an eased re-bake gathers 1 / bands of a layer per frame
  ease: 0.45,        // s: time constant of the blend toward a re-bake
  maxProbes: 400000, // the spacing grows until the grid fits
  maxMap: 4096,      // the texel grows until the height field fits (px per side)
};
const DIRS = 48;

/** a full config, or null when off */
export function bounceConfig(c) {
  if (!c) return null;
  return { ...BOUNCE_DEFAULTS, ...(c === true ? {} : c) };
}
/** the grid for a box: probe counts (nx, nz, layers), spacing, the layer heights (bounceLayerY), the height field */
export function bounceGrid(cfg, { min, max }) {
  const nl = Math.max(2, Math.round(cfg.layers));
  let dx = cfg.spacing, nx, nz;
  for (;;) {
    nx = Math.max(2, Math.round((max[0] - min[0]) / dx) + 1); nz = Math.max(2, Math.round((max[2] - min[2]) / dx) + 1);
    if (nx * nz * nl <= cfg.maxProbes) break;
    dx *= 1.25;
  }
  const H = Math.max(1e-3, max[1] - min[1]), curve = Math.max(0.25, cfg.curve);
  const m = cfg.margin, map = { x0: min[0] - m, z0: min[2] - m, w: (nx - 1) * dx + 2 * m, d: (nz - 1) * dx + 2 * m };
  let texel = cfg.texel;
  while (map.w / texel > cfg.maxMap || map.d / texel > cfg.maxMap) texel *= 1.25;
  return { x0: min[0], z0: min[2], y0: min[1], top: max[1], dx, nx, nz, nl, H, curve, probes: nx * nz * nl, map, texel, mw: Math.ceil(map.w / texel), mh: Math.ceil(map.d / texel), hmax: cfg.hmax || max[1] + 4 };
}
/** height of probe layer k */
export const bounceLayerY = (g, k) => g.y0 + g.H * Math.pow(k / (g.nl - 1), g.curve);

// fixed spherical-Fibonacci directions (the same for every probe: no per-probe noise)
const fib = (n) => Array.from({ length: n }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), t = i * 2.399963229728653 + 0.3;
  return [r * Math.cos(t), y, r * Math.sin(t)];
});
const f6 = (v) => Number(v).toFixed(6);
// three's CubeUV defines for an environment atlas of this height (WebGLPrograms generateCubeUVSize)
function cubeUV(tex) {
  const h = tex && tex.image && tex.image.height ? tex.image.height : 1024, maxMip = Math.log2(h) - 2;
  return { ENVMAP_TYPE_CUBE_UV: '', CUBEUV_TEXEL_WIDTH: f6(1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))), CUBEUV_TEXEL_HEIGHT: f6(1 / h), CUBEUV_MAX_MIP: maxMip.toFixed(1) };
}

// the material side: a factor on the image-based diffuse light (Physical / Standard with the world's CubeUV light)
const PARS = /* glsl */ `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && defined( STANDARD )
#define MG_BOUNCE
uniform highp sampler3D mgBnV;
uniform vec4 mgBnA;   // grid x0, z0, 1 / spacing, y0
uniform vec4 mgBnB;   // nx, nz, layers, 1 / height (layer k at y0 + height ( k / ( layers - 1 ) )^curve)
uniform vec4 mgBnC;   // strength (0: not baked yet), edge (probes), clamp lo, hi
uniform float mgBnK;  // 1 / curve
// irradiance from L1 radiance SH (pi Y00, 2 pi / 3 Y1m); L1 softened a little against ringing
vec3 mgBnE( vec3 l0, vec3 lr, vec3 lg, vec3 lb, vec3 n ) {
	return max( 0.886227 * l0 + 0.9 * 1.023328 * vec3( dot( lr, n ), dot( lg, n ), dot( lb, n ) ), vec3( 0.0 ) );
}
vec3 mgBnFactor( vec3 p, vec3 n ) {
	if ( mgBnC.x <= 0.0 ) return vec3( 1.0 );
	vec2 dim = mgBnB.xy;
	vec2 g = ( p.xz - mgBnA.xy ) * mgBnA.z;
	vec2 o = max( max( - g, g - ( dim - 1.0 ) ), 0.0 );
	float edge = 1.0 - smoothstep( 0.0, mgBnC.y, max( o.x, o.y ) );
	if ( edge <= 0.0 ) return vec3( 1.0 );
	float nl = mgBnB.z;
	float k = clamp( ( nl - 1.0 ) * pow( clamp( ( p.y - mgBnA.w ) * mgBnB.w, 0.0, 1.0 ), mgBnK ), 0.0, nl - 1.0 );
	vec2 gc = clamp( g, vec2( 0.0 ), dim - 1.0 ) + 0.5;
	float W = 4.0 * dim.x, bx = dim.x / W;
	vec3 uvw = vec3( gc.x / W, gc.y / dim.y, ( k + 0.5 ) / ( nl + 1.0 ) );
	vec4 A = texture( mgBnV, uvw );
	if ( A.w < 0.02 ) return vec3( 1.0 );
	float iw = 1.0 / A.w;
	vec3 eLoc = mgBnE( A.xyz * iw, texture( mgBnV, uvw + vec3( bx, 0.0, 0.0 ) ).xyz * iw, texture( mgBnV, uvw + vec3( 2.0 * bx, 0.0, 0.0 ) ).xyz * iw, texture( mgBnV, uvw + vec3( 3.0 * bx, 0.0, 0.0 ) ).xyz * iw, n );
	// the reference probe (where the world's image-based light was captured): the last layer's first texel of each block
	int ix = int( dim.x ), iz = int( nl );
	vec3 eRef = mgBnE( texelFetch( mgBnV, ivec3( 0, 0, iz ), 0 ).xyz, texelFetch( mgBnV, ivec3( ix, 0, iz ), 0 ).xyz, texelFetch( mgBnV, ivec3( 2 * ix, 0, iz ), 0 ).xyz, texelFetch( mgBnV, ivec3( 3 * ix, 0, iz ), 0 ).xyz, n );
	float lr = max( dot( eRef, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-6 );
	vec3 f = clamp( ( eLoc + 0.002 * lr ) / ( eRef + 0.002 * lr ), vec3( mgBnC.z ), vec3( mgBnC.w ) );
	return mix( vec3( 1.0 ), f, mgBnC.x * edge * smoothstep( 0.02, 0.3, A.w ) );
}
#endif
`;

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
const HF = /* glsl */ `
uniform sampler2D tHF; uniform vec4 uMap; uniform float uTexel;
vec2 mapUV( vec2 xz ) { return vec2( ( xz.x - uMap.x ) / uMap.z, 1.0 - ( xz.y - uMap.y ) / uMap.w ); }
vec4 hfAt( vec2 xz, float lod ) { return textureLod( tHF, mapUV( xz ), lod ); }
`;

/** w: { renderer, scene, sun, G, keyDir, Q, envProbe, shadow, msaa, skyVisible } (the world's internals) */
export function createBounce(w, cfg) {
  const { renderer: r, scene, sun, G, keyDir } = w;
  const U = {
    mgBnV: { value: null }, mgBnA: { value: new THREE.Vector4() }, mgBnB: { value: new THREE.Vector4() },
    mgBnC: { value: new THREE.Vector4(0, cfg.edge, cfg.lo, cfg.hi) }, mgBnK: { value: 0.5 },
  };
  const info = { probes: 0, grid: null, map: null, box: null, prepareMs: 0, bakeMs: 0, bakes: 0 };
  const quad = new FullScreenQuad(null);
  const key = new THREE.Vector3(), L = new THREE.Vector3(0, 1, 0);
  let g = null, hf = null, sh = null, next = null, out = null, shMat = null, gMat = null, bMat = null, white = null;
  let layer = -1, band = 0, instant = false, fadeLeft = 0;

  const part = {
    id: 'bounce', key: '1', order: 35, pars: PARS, uniforms: U,
    apply: (fs, t) => t.swap(fs, '#include <lights_fragment_end>', /* glsl */ `#ifdef MG_BOUNCE
	iblIrradiance *= mgBnFactor( mgLW( geometryPosition ), mgLWN( geometryNormal ) );
	#endif
	#include <lights_fragment_end>`, 'bounce'),
  };

  // what the height field draws: meshes, visible, opaque, not moving / not captured / not wanted
  const skip = (o) => o.userData.mgDynamic || o.userData.mgNoCapture || o.userData.mgNoBounce || (cfg.keep && !o.isScene && !cfg.keep(o));
  const opaque = (m) => [].concat(m || []).some((q) => q && !(q.transparent && q.opacity < 0.5));
  function hideOthers() {
    const hidden = [];
    const walk = (o) => {
      if (!o.visible) return;
      if (!o.isScene && (skip(o) || ((o.isPoints || o.isLine || o.isSprite) || (o.isMesh && !opaque(o.material))))) { o.visible = false; hidden.push(o); return; }
      for (const c of o.children) walk(c);
    };
    walk(scene);
    return hidden;
  }
  // the box when the config gives none: the shadow volume in x / z, the kept meshes' heights in y
  function autoBox() {
    const s = w.shadow || { center: [0, 0, 0], radius: 30 }, c = s.center, R = s.radius;
    const min = [c[0] - R, Infinity, c[2] - R], max = [c[0] + R, -Infinity, c[2] + R], b = new THREE.Box3();
    scene.updateMatrixWorld();
    const walk = (o) => {
      if (!o.visible || (!o.isScene && skip(o))) return;
      if (o.isMesh && o.geometry && o.geometry.attributes.position) {
        if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); b.copy(o.boundingBox); } else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); b.copy(o.geometry.boundingBox); }
        b.applyMatrix4(o.matrixWorld);
        const inside = b.max.x > min[0] && b.min.x < max[0] && b.max.z > min[2] && b.min.z < max[2];
        if (inside && b.max.x - b.min.x < 4 * R && b.max.z - b.min.z < 4 * R) { min[1] = Math.min(min[1], b.min.y); max[1] = Math.max(max[1], b.max.y); }
      }
      for (const ch of o.children) walk(ch);
    };
    walk(scene);
    if (!Number.isFinite(min[1])) { min[1] = c[1] - 1; max[1] = c[1] + R; }
    min[1] += 0.5; max[1] = Math.max(min[1] + 2, Math.min(max[1], min[1] + 2 * R));
    return { min, max };
  }

  function allocate(ng) {
    for (const x of [hf, sh, next, out]) if (x) x.dispose();
    g = ng;
    const f = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    hf = new THREE.WebGLRenderTarget(g.mw, g.mh, { ...f, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    sh = new THREE.WebGLRenderTarget(g.mw, g.mh, f);
    next = new THREE.WebGL3DRenderTarget(g.nx, g.nz, g.nl + 1, { ...f, count: 4 });
    for (const t of next.textures) t.wrapR = THREE.ClampToEdgeWrapping;   // the extra attachments are plain textures (no wrapR)
    out = new THREE.WebGL3DRenderTarget(4 * g.nx, g.nz, g.nl + 1, f);
    out.texture.wrapS = out.texture.wrapT = out.texture.wrapR = THREE.ClampToEdgeWrapping;
    out.texture.name = 'mgBounce';
    U.mgBnV.value = out.texture;
    U.mgBnA.value.set(g.x0, g.z0, 1 / g.dx, g.y0);
    U.mgBnB.value.set(g.nx, g.nz, g.nl, 1 / g.H); U.mgBnK.value = 1 / g.curve;
    U.mgBnC.value.x = 0;
    build();
    Object.assign(info, { probes: g.probes, grid: [g.nx, g.nl, g.nz], spacing: +g.dx.toFixed(3), map: [g.mw, g.mh], texel: +g.texel.toFixed(3) });
  }

  // --- 1. the height field and albedo of the built scene
  function drawHeightField() {
    const t0 = performance.now();
    const box = cfg.min && cfg.max ? { min: cfg.min, max: cfg.max } : autoBox();
    info.box = { min: box.min.map((v) => +v.toFixed(2)), max: box.max.map((v) => +v.toFixed(2)) };
    const ng = bounceGrid(cfg, box);
    if (!g || JSON.stringify(ng) !== JSON.stringify(g)) allocate(ng);
    if (!white) {
      // a uniform white sky, prefiltered to the world's own size (the same CubeUV layout: no program changes)
      const ws = new THREE.Scene(); ws.background = new THREE.Color(1, 1, 1);
      const pm = new THREE.PMREMGenerator(r);
      white = pm.fromScene(ws, 0, 0.1, 10, { size: (w.Q && w.Q.envSize) || 256 });
      pm.dispose();
    }
    const hidden = hideOthers();
    const lights = [];
    scene.traverse((o) => { if (o.isLight && o.intensity) { lights.push([o, o.intensity]); o.intensity = 0; } });
    const save = {
      env: scene.environment, envI: scene.environmentIntensity, bg: scene.background, fog: scene.fog ? scene.fog.density : 0,
      amb: G.uAmbHi.value.map((v) => v.w), lamp: G.uLamp.value, gain: G.uLampGain.value,
      rt: r.getRenderTarget(), auto: r.autoClear, cc: r.getClearColor(new THREE.Color()), ca: r.getClearAlpha(),
      smA: r.shadowMap.autoUpdate, smN: r.shadowMap.needsUpdate, xr: r.xr.enabled,
    };
    if (w.skyVisible) w.skyVisible(false);
    scene.environment = white.texture; scene.environmentIntensity = 1; scene.background = null;
    if (scene.fog) scene.fog.density = 0;
    // ambient volumes at factor 1 (not uAmbN = 0: their count is part of the materials' program key)
    for (const v of G.uAmbHi.value) v.w = 1;
    G.uLamp.value = 0; G.uLampGain.value = 0;
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; r.xr.enabled = false;
    // orthographic, from above, north (-z) up the image; depth into a float texture
    const M = g.map, top = g.top + 80, far = top - (g.y0 - 40);
    const cam = new THREE.OrthographicCamera(-M.w / 2, M.w / 2, M.d / 2, -M.d / 2, 0, far);
    cam.position.set(M.x0 + M.w / 2, top, M.z0 + M.d / 2);
    cam.up.set(0, 0, -1); cam.lookAt(cam.position.x, 0, cam.position.z);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const depth = new THREE.DepthTexture(g.mw, g.mh, THREE.FloatType);
    // the formats of the world's scene target (half float, float depth, its MSAA): the GPU pipeline states its
    // materials were warmed with are reused (ANGLE on Metal builds one per program and target format at first draw)
    const rt = new THREE.WebGLRenderTarget(g.mw, g.mh, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture: depth, samples: w.msaa || 0 });
    try {
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.autoClear = true;
      r.clear(true, true, true);
      r.render(scene, cam);
    } finally {
      for (const o of hidden) o.visible = true;
      for (const [o, i] of lights) o.intensity = i;
      if (w.skyVisible) w.skyVisible(true);
      scene.environment = save.env; scene.environmentIntensity = save.envI; scene.background = save.bg;
      if (scene.fog) scene.fog.density = save.fog;
      G.uAmbHi.value.forEach((v, i) => { v.w = save.amb[i]; }); G.uLamp.value = save.lamp; G.uLampGain.value = save.gain;
      r.shadowMap.autoUpdate = save.smA; r.shadowMap.needsUpdate = save.smN; r.xr.enabled = save.xr;
    }
    // pack albedo + height (no geometry: just under the lowest probes), mipmapped
    const pack = new THREE.ShaderMaterial({
      uniforms: { tC: { value: rt.texture }, tD: { value: depth }, uTop: { value: top }, uFar: { value: far }, uNone: { value: g.y0 - 2 } },
      vertexShader: VS, depthTest: false, depthWrite: false,
      // a material seen straight from above may return NaN / Inf (a divide by N.V on a vertical face): one such texel
      // would spread through every mip level, so it is caught by its bits (fast-math compilers drop isnan)
      fragmentShader: /* glsl */ `varying vec2 vUv; uniform sampler2D tC; uniform sampler2D tD; uniform float uTop, uFar, uNone;
bool bad( float x ) { return ( floatBitsToUint( x ) & 0x7f800000u ) == 0x7f800000u; }
void main() {
	float d = texture2D( tD, vUv ).x;
	vec3 c = texture2D( tC, vUv ).rgb;
	if ( bad( c.r ) || bad( c.g ) || bad( c.b ) ) c = vec3( 0.35 );
	gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), d >= 0.99999 ? uNone : uTop - d * uFar );
}`,
    });
    quad.material = pack;
    r.setRenderTarget(hf); quad.render(r);
    pack.dispose(); rt.dispose(); depth.dispose();
    r.setRenderTarget(save.rt); r.autoClear = save.auto; r.setClearColor(save.cc, save.ca);
    info.prepareMs = Math.round(performance.now() - t0);
  }

  function build() {
    for (const m of [shMat, gMat, bMat]) if (m) m.dispose();
    const M = g.map;
    const mapU = () => ({ tHF: { value: hf.texture }, uMap: { value: new THREE.Vector4(M.x0, M.z0, M.w, M.d) }, uTexel: { value: g.texel } });
    // --- 2. shadow height of the key light
    shMat = new THREE.ShaderMaterial({
      uniforms: { uL: { value: L }, ...mapU() }, vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */ `varying vec2 vUv; uniform vec3 uL;
${HF}
void main() {
	vec2 xz = vec2( uMap.x + vUv.x * uMap.z, uMap.y + ( 1.0 - vUv.y ) * uMap.w );
	if ( uL.y < 0.003 ) { gl_FragColor = vec4( 1e4 ); return; }
	float lh = max( length( uL.xz ), 1e-3 );
	vec2 d = uL.xz / lh;
	float tanE = uL.y / lh, S = - 1e4, s = uTexel * 0.75;
	for ( int i = 0; i < 64; i ++ ) {
		float lod = clamp( log2( s * 0.02 / uTexel ), 0.0, 3.0 );
		S = max( S, hfAt( xz + d * s, lod ).a - s * tanE );
		s += max( uTexel * 0.75, s * 0.075 );
		if ( s * tanE > 60.0 ) break;
	}
	gl_FragColor = vec4( S, 0.0, 0.0, 1.0 );
}`,
    });
    // --- 3. the probe gather (four targets: L0 + validity, L1 of red, green, blue)
    const D = fib(DIRS);
    gMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, defines: { ...cubeUV(scene.environment), ND: DIRS },
      uniforms: {
        tS: { value: sh.texture }, envMap: { value: null }, uEnvI: { value: 1 }, uKey: { value: key }, uL: { value: L },
        uGrid: { value: new THREE.Vector4(g.x0, g.z0, g.dx, g.y0) }, uGrid2: { value: new THREE.Vector4(g.nx, g.nz, g.nl, g.H) }, uCurve: { value: g.curve },
        uLayer: { value: 0 }, uRef: { value: new THREE.Vector4(...(w.envProbe || [0, 3, 0]), 0) }, uHmax: { value: g.hmax }, uMulti: { value: cfg.multi },
        ...mapU(),
      },
      vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */ `precision highp float;
layout( location = 0 ) out highp vec4 oA;
layout( location = 1 ) out highp vec4 oR;
layout( location = 2 ) out highp vec4 oG;
layout( location = 3 ) out highp vec4 oB;
in vec2 vUv;
#define PI 3.141592653589793
#define saturate( a ) clamp( a, 0.0, 1.0 )
uniform sampler2D envMap; uniform float uEnvI;
${THREE.ShaderChunk.cube_uv_reflection_fragment}
${HF}
uniform sampler2D tS; uniform vec3 uKey, uL; uniform vec4 uGrid, uGrid2, uRef; uniform float uLayer, uHmax, uMulti, uCurve;
const vec3 DIRS[ ND ] = vec3[]( ${D.map((d) => `vec3( ${f6(d[0])}, ${f6(d[1])}, ${f6(d[2])} )`).join(', ')} );
float sAt( vec2 xz ) { return textureLod( tS, mapUV( xz ), 0.0 ).r; }
vec3 envL( vec3 d, float rough ) { return textureCubeUV( envMap, d, rough ).rgb * uEnvI; }
void main() {
	vec3 p; float valid;
	if ( uRef.w > 0.5 ) { p = uRef.xyz; valid = 1.0; }
	else {
		vec2 ij = floor( gl_FragCoord.xy );
		p = vec3( uGrid.x + ij.x * uGrid.z, uGrid.w + uGrid2.w * pow( uLayer / ( uGrid2.z - 1.0 ), uCurve ), uGrid.y + ij.y * uGrid.z );
		valid = smoothstep( 0.0, 0.45, p.y - hfAt( p.xz, 0.0 ).a );
	}
	vec3 eUp = PI * envL( vec3( 0.0, 1.0, 0.0 ), 1.0 );
	vec3 l0 = vec3( 0.0 ), lx = vec3( 0.0 ), ly = vec3( 0.0 ), lz = vec3( 0.0 );
	if ( valid > 0.0 ) {
		for ( int di = 0; di < ND; di ++ ) {
			vec3 w = DIRS[ di ], L = vec3( - 1.0 );
			float t = 0.3, dt = 0.3;
			for ( int s = 0; s < 26; s ++ ) {
				vec3 q = p + w * t;
				if ( q.y > uHmax ) break;
				float lod = clamp( log2( max( t * 0.08, uTexel ) / uTexel ), 0.0, 4.0 );
				vec4 h = hfAt( q.xz, lod );
				if ( q.y < h.a ) {
					vec3 alb = h.rgb;
					if ( q.y - w.y * dt >= h.a - 0.05 || w.y < - 0.9 ) {
						// dropped onto a top (ground, roof, wall crest)
						float lit = step( sAt( q.xz ) - 0.15, h.a );
						L = alb * ( 1.0 / PI ) * ( uKey * max( uL.y, 0.0 ) * lit + eUp );
					} else {
						// ran into the side of a column: a wall facing back along the ray
						vec3 nW = normalize( vec3( - w.x, 0.0, - w.z ) + 1e-5 );
						float lit = step( sAt( q.xz + nW.xz * 0.7 ), q.y );
						L = alb * ( 1.0 / PI ) * ( uKey * max( dot( nW, uL ), 0.0 ) * lit + PI * envL( nW, 1.0 ) * 0.85 );
					}
					// the further bounces between walls and ground (an enclosure of albedo a returns ~1 / (1 - a k))
					L /= 1.0 - uMulti * clamp( dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 0.8 );
					break;
				}
				dt = max( 0.3, t * 0.16 );
				t += dt;
			}
			if ( L.x < 0.0 ) L = envL( w, 0.55 );
			l0 += L; lx += L * w.x; ly += L * w.y; lz += L * w.z;
		}
	}
	// radiance SH: L00 = sum L Y00 dw, L1m = sum L Y1m( w ) dw ( dw = 4 pi / ND ), premultiplied by validity
	float k0 = 0.282095 * 4.0 * PI / float( ND ) * valid, k1 = 0.488603 * 4.0 * PI / float( ND ) * valid;
	oA = vec4( l0 * k0, valid );
	oR = vec4( lx.r, ly.r, lz.r, 1.0 ) * vec4( vec3( k1 ), 1.0 );
	oG = vec4( lx.g, ly.g, lz.g, 1.0 ) * vec4( vec3( k1 ), 1.0 );
	oB = vec4( lx.b, ly.b, lz.b, 1.0 ) * vec4( vec3( k1 ), 1.0 );
}`,
    });
    // --- 4. ease `out` (x-packed) toward `next` (four targets): constant-alpha blending, no feedback read
    bMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { t0: { value: next.textures[0] }, t1: { value: next.textures[1] }, t2: { value: next.textures[2] }, t3: { value: next.textures[3] }, uLayer: { value: 0 }, uNX: { value: g.nx } },
      vertexShader: VS,
      fragmentShader: /* glsl */ `precision highp float; precision highp sampler3D;
layout( location = 0 ) out highp vec4 o;
in vec2 vUv;
uniform highp sampler3D t0, t1, t2, t3; uniform float uLayer; uniform int uNX;
void main() {
	ivec2 c = ivec2( gl_FragCoord.xy );
	int b = c.x / uNX; ivec3 q = ivec3( c.x - b * uNX, c.y, int( uLayer ) );
	o = b == 0 ? texelFetch( t0, q, 0 ) : b == 1 ? texelFetch( t1, q, 0 ) : b == 2 ? texelFetch( t2, q, 0 ) : texelFetch( t3, q, 0 );
}`,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ConstantAlphaFactor, blendDst: THREE.OneMinusConstantAlphaFactor,
      blendSrcAlpha: THREE.ConstantAlphaFactor, blendDstAlpha: THREE.OneMinusConstantAlphaFactor,
    });
    bMat.blendAlpha = 1;
  }

  function pass(m, target) {
    const prev = r.getRenderTarget(), ac = r.autoClear;
    r.autoClear = false; quad.material = m;
    r.setRenderTarget(target); quad.render(r);
    r.setRenderTarget(prev); r.autoClear = ac;
  }
  // one layer of the gather, or one band of rows of it; the reference probe last
  function step(whole) {
    const nb = whole ? 1 : Math.max(1, cfg.bands | 0), u = gMat.uniforms, prev = r.getRenderTarget(), ac = r.autoClear;
    r.autoClear = false;
    next.viewport.set(0, 0, g.nx, g.nz);
    if (layer < g.nl) {
      u.uRef.value.w = 0; u.uLayer.value = layer;
      const y0 = Math.floor((g.nz * band) / nb), y1 = Math.floor((g.nz * (band + 1)) / nb);
      next.scissor.set(0, y0, g.nx, y1 - y0); next.scissorTest = nb > 1;
    } else {
      u.uRef.value.w = 1; u.uLayer.value = 0;
      next.scissor.set(0, 0, 1, 1); next.scissorTest = true;
    }
    quad.material = gMat;
    r.setRenderTarget(next, layer); quad.render(r);
    next.scissorTest = false;
    r.setRenderTarget(prev); r.autoClear = ac;
    if (layer < g.nl && ++band < nb) return;
    band = 0;
    layer = layer + 1 > g.nl ? -1 : layer + 1;
    if (layer < 0) {
      if (instant) { blend(1); fadeLeft = 0; } else fadeLeft = 1;
      U.mgBnC.value.x = cfg.strength;
    }
  }
  function blend(a) {
    const prev = r.getRenderTarget(), ac = r.autoClear;
    r.autoClear = false; bMat.blendAlpha = a; quad.material = bMat;
    out.viewport.set(0, 0, 4 * g.nx, g.nz); out.scissorTest = false;
    for (let k = 0; k <= g.nl; k++) { bMat.uniforms.uLayer.value = k; r.setRenderTarget(out, k); quad.render(r); }
    r.setRenderTarget(prev); r.autoClear = ac;
  }

  /** bake for the current key light and image-based light: instant = everything now (stills), else over frames */
  function bake(now = true) {
    if (!g) return info;
    const t0 = performance.now();
    key.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity);   // the key light's radiance (sun or moon)
    L.copy(keyDir).normalize();
    const env = scene.environment, u = gMat.uniforms;
    if (env) {
      const d = cubeUV(env);
      if (d.CUBEUV_TEXEL_HEIGHT !== gMat.defines.CUBEUV_TEXEL_HEIGHT) { Object.assign(gMat.defines, d); gMat.needsUpdate = true; }
    }
    u.envMap.value = env; u.uEnvI.value = scene.environmentIntensity;
    pass(shMat, sh);
    layer = 0; band = 0; instant = now;
    if (now) while (layer >= 0) step(true);
    info.bakeMs = Math.round(performance.now() - t0); info.bakes++;
    return info;
  }

  return {
    cfg, part, uniforms: U, info,
    get grid() { return g; },
    /** the GPU targets (debugging): height field, shadow height, the gather, the volume the materials read */
    get targets() { return { hf, sh, next, out }; },
    get busy() { return layer >= 0 || fadeLeft > 0; },
    bake,
    /** draw the height field again (the built world changed); a bake follows */
    prepare() { drawHeightField(); return info; },
    /** per frame: one band of the gather while a bake runs, then the ease toward it */
    frame(camera, dt) {
      if (!g) return;
      if (layer >= 0) { step(false); return; }
      if (fadeLeft > 0) {
        const a = 1 - Math.exp(-Math.max(dt || 0, 1 / 60) / Math.max(cfg.ease, 1e-3));
        fadeLeft *= 1 - a;
        if (fadeLeft <= 0.002) { fadeLeft = 0; blend(1); } else blend(a);
      }
    },
    envCaptured(now) { if (!g) { drawHeightField(); bake(true); } else bake(!!now); },
    invalidate() { if (g) { drawHeightField(); bake(false); } },
    set strength(v) { cfg.strength = v; if (U.mgBnC.value.x > 0) U.mgBnC.value.x = v; },
    get strength() { return cfg.strength; },
    dispose() { for (const x of [hf, sh, next, out, white]) if (x) x.dispose(); for (const m of [shMat, gMat, bMat]) if (m) m.dispose(); quad.dispose(); },
  };
}
