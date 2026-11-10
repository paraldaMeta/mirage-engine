// Mirage original code.
// ---------------------------------------------------------------------------
// Many local lights: clustered (froxel) culling and a shadow atlas (opt-in: lighting: { lights: true | { ... } }).
//
//   const world = createWorldRenderer({ lighting: { lights: { max: 256 } } });
//   const lamp = new THREE.PointLight(0xffaa66, 40, 9);            // or a SpotLight (position, target, angle, penumbra)
//   lamp.position.set(2, 3, 1); world.scene.add(lamp);
//   world.lighting.addLight(lamp, { shadow: true });               // from now on drawn by this file, not by three
//   world.lighting.removeLight(lamp);
//
// Why: three shades every light in every pixel and compiles the count into each program; a hundred lamps cost a
// hundred light evaluations everywhere. Here the lights live in one float texture (5 texels a light), and the view
// frustum is cut into 16 x 9 x 24 cells (depth slices logarithmic); each frame the CPU writes, per cell, the list
// of lights whose sphere reaches it, and a pixel shades only its cell's list. Light count is data, not a define:
// adding a lamp compiles nothing. A registered light is moved to a layer no camera draws, so three's own loop no
// longer sees it; its colour, intensity (candela, three's units), distance, decay, cone and penumbra are read
// every frame and shaded with three's own falloff, through the material's own BRDF (RE_Direct).
// Cameras other than the frame's view camera (environment and probe captures, an orthographic game camera) take
// the plain loop over all lights: correct, not culled.
// Shadows: one depth atlas for all local lights. A light with { shadow: true } gets a square tile, 64..512 px by
// how large its range is on screen (range / distance to the eye, with hysteresis so tiles do not flicker between
// sizes); tiles come from a buddy allocator. The tile holds the distance to the nearest caster for every direction
// in an octahedral layout (point and spot alike), folded from a cube rendered around the light, and is read with
// 4 rotated hardware-filtered compares. A tile is CACHED: it is drawn again only when its light moved or changed,
// its tile changed size, invalidate() was called, or a moving object (a top-level object with userData.mgDynamic)
// moved within its range; at most `perFrame` lights are redrawn per frame, the most important first.
// Limits: casters are drawn with a distance material (instancing and skinning followed; alpha-tested cut-outs cast
// as their whole card, wind sway is not followed); a spot light pays the same six faces as a point light; static
// and moving casters share a tile (a light with something moving in range redraws all its casters).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OCT_DECODE } from './inject.js';

export const LIGHTS_DEFAULTS = {
  max: 256,          // lights (texture rows are sized for it)
  cluster: true,     // false: every pixel loops over every light (the comparison path)
  perCell: 64,       // most lights shaded in one cell (info.clipped counts what a frame dropped)
  atlas: 2048,       // px of the shadow atlas
  tileMax: 512, tileMin: 64,
  perFrame: 2,       // shadow tiles redrawn per frame
  bias: 1.5,         // texels of normal offset and depth bias
};
export const CLUSTER = { x: 16, y: 9, z: 24 };
const TW = 256, REC = 5, CELLS = CLUSTER.x * CLUSTER.y * CLUSTER.z;

export function lightsConfig(c) { return c ? { ...LIGHTS_DEFAULTS, ...(c === true ? {} : c) } : null; }

/** depth (m, > 0) -> slice of the logarithmic split near..far */
export const clusterSlice = (d, near, far) => Math.max(0, Math.min(CLUSTER.z - 1, Math.floor((Math.log(Math.max(d, near) / near) / Math.log(far / near)) * CLUSTER.z)));
/** the ndc interval [lo, hi] (clamped to -1..1) a sphere covers on one axis: c = centre coordinate on that axis, z = its
 *  depth (> 0 in front), r = radius, p = the projection's scale on the axis (1 / tan of the half angle) */
export function sphereSpan(c, z, r, p) {
  const l2 = c * c + z * z;
  if (l2 <= r * r) return [-1, 1];
  const th = Math.atan2(c, z), ph = Math.asin(Math.min(1, r / Math.sqrt(l2)));
  const a = th - ph, b = th + ph, H = Math.PI / 2 - 1e-3;
  return [a <= -H ? -1 : Math.max(-1, Math.min(1, Math.tan(a) * p)), b >= H ? 1 : Math.max(-1, Math.min(1, Math.tan(b) * p))];
}
/** buddy allocator of square power-of-two tiles in a size x size atlas: alloc(s) -> [x, y] or null, free(s, xy) */
export function tileAllocator(size) {
  const free = { [size]: [[0, 0]] };
  const alloc = (s) => {
    if (s > size) return null;
    const f = (free[s] ||= []);
    if (f.length) return f.pop();
    const b = alloc(s * 2);
    if (!b) return null;
    f.push([b[0] + s, b[1]], [b[0], b[1] + s], [b[0] + s, b[1] + s]);
    return b;
  };
  return { alloc, free: (s, xy) => (free[s] ||= []).push(xy) };
}

/** every mesh two-sided, writing its world distance to uP (probe distances in gi.js use the same idea) */
export function distanceMaterial() {
  return new THREE.ShaderMaterial({
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
}

const glsl = (cfg, rows) => /* glsl */ `
#if defined( RE_Direct )
#define MG_LL
uniform highp sampler2D mgLT;
uniform highp sampler2DShadow mgLS;
uniform vec4 mgLA;   // x: lights, y: 0 off / 1 loop over all / 2 clustered, z: 1 / atlas px, w: bias (texels)
uniform vec4 mgLB;   // xy: 1 / viewport px, z: near, w: slices / log( far / near )
vec4 mgLF( int i ) { return texelFetch( mgLT, ivec2( i & ${TW - 1}, i >> 8 ), 0 ); }
float mgLShadow( vec3 P, vec3 N, vec3 lp, vec4 d, vec4 e ) {
	// d: z far; e: tile x, y, size (px)
	vec3 v = P - lp; float r = length( v );
	float tex = r * 3.2 / e.z;                         // about one texel of the tile at this distance (m)
	v = P + N * ( tex * mgLA.w ) - lp;
	float ref = ( length( v ) - tex * mgLA.w ) / d.z;
	vec2 o = mgOct( normalize( v ) ) * e.z;
	float a = 6.2831853 * mgIgn( gl_FragCoord.xy ), s = 0.0;
	for ( int k = 0; k < 4; k ++ ) {
		float t = a + 1.5707963 * float( k );
		vec2 q = clamp( o + vec2( cos( t ), sin( t ) ) * ( 0.6 + 0.35 * float( k ) ), vec2( 1.0 ), vec2( e.z - 1.0 ) );
		s += texture( mgLS, vec3( ( e.xy + q ) * mgLA.z, ref ) );
	}
	return 0.25 * s;
}
#endif
`;
const LOOP = (cfg, rows) => /* glsl */ `
#if defined( MG_LL )
if ( mgLA.y > 0.5 ) {
	vec3 mgP = mgLW( geometryPosition ), mgNg = mgLWN( nonPerturbedNormal );
	int mgBase = - 1, mgCount = int( mgLA.x );
	if ( mgLA.y > 1.5 ) {
		ivec3 c = ivec3( clamp( gl_FragCoord.xy * mgLB.xy, 0.0, 0.9999 ) * vec2( ${CLUSTER.x}.0, ${CLUSTER.y}.0 ), clamp( int( log( max( - geometryPosition.z, mgLB.z ) / mgLB.z ) * mgLB.w ), 0, ${CLUSTER.z - 1} ) );
		vec4 cell = mgLF( ${rows.cells * TW} + c.x + ${CLUSTER.x} * ( c.y + ${CLUSTER.y} * c.z ) );
		mgBase = int( cell.x ); mgCount = int( cell.y );
	}
	IncidentLight mgDL; mgDL.visible = true;
	for ( int k = 0; k < ${cfg.max}; k ++ ) {
		if ( k >= mgCount ) break;
		int j = mgBase + k;
		int li = mgBase < 0 ? k : int( mgLF( ${rows.index * TW} + ( j >> 2 ) )[ j & 3 ] );
		vec4 la = mgLF( li * ${REC} ), lb = mgLF( li * ${REC} + 1 ), lc = mgLF( li * ${REC} + 2 ), ld = mgLF( li * ${REC} + 3 );
		vec3 L = la.xyz - mgP; float dist = length( L );
		if ( dist >= la.w ) continue;
		L /= dist;
		float att = getDistanceAttenuation( dist, la.w, lb.w );
		if ( lc.w > - 1.5 ) att *= smoothstep( lc.w, ld.x, dot( - L, lc.xyz ) );
		if ( att <= 0.0 ) continue;
		if ( ld.y > 0.5 && receiveShadow ) att *= mgLShadow( mgP, mgNg * sign( dot( mgNg, L ) + 1e-6 ), la.xyz, ld, mgLF( li * ${REC} + 4 ) );
		mgDL.direction = normalize( ( viewMatrix * vec4( L, 0.0 ) ).xyz );
		mgDL.color = lb.rgb * att;
		RE_Direct( mgDL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
}
#endif
`;

export function createLights(w, cfg) {
  const { renderer, scene } = w;
  const recRows = Math.ceil((cfg.max * REC) / TW), cellRows = Math.ceil(CELLS / TW);
  const rows = { cells: recRows, index: recRows + cellRows };
  const TH = 128, IDX_CAP = (TH - rows.index) * TW * 4;
  const data = new Float32Array(TW * TH * 4);
  const tex = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  // shadow atlas: a depth texture read with hardware compare; the colour attachment exists only to make it a target
  const depth = new THREE.DepthTexture(cfg.atlas, cfg.atlas, THREE.UnsignedShortType);
  depth.compareFunction = THREE.LessEqualCompare; depth.minFilter = depth.magFilter = THREE.LinearFilter;
  const atlas = new THREE.WebGLRenderTarget(cfg.atlas, cfg.atlas, { depthTexture: depth, depthBuffer: true, generateMipmaps: false });
  // made and cleared now: a compare sampler bound to a texture that was never a target stops every draw of the program
  { const saved = renderer.getRenderTarget(); renderer.setRenderTarget(atlas); renderer.clear(false, true, false); renderer.setRenderTarget(saved); }
  const U = {
    mgLT: { value: tex }, mgLS: { value: depth },
    mgLA: { value: new THREE.Vector4(0, 0, 1 / cfg.atlas, cfg.bias) }, mgLB: { value: new THREE.Vector4(1, 1, 0.1, 1) },
  };
  const lights = [];   // { light, shadow, tile: null | { s, xy }, dirty, want, last: Float32Array(REC * 4), range, imp }
  const tiles = tileAllocator(cfg.atlas);
  const cubes = new Map();   // face px -> { rt, cam }
  const dist = distanceMaterial();
  const foldMat = new THREE.ShaderMaterial({
    uniforms: { tCube: { value: null }, uFar: { value: 1 } }, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, colorWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: /* glsl */ `uniform samplerCube tCube; uniform float uFar; varying vec2 vUv;
${OCT_DECODE}
void main() { gl_FragDepth = clamp( textureLod( tCube, mgOctDec( vUv ), 0.0 ).r / uFar, 0.0, 1.0 ); gl_FragColor = vec4( 0.0 ); }`,
  });
  const quad = new FullScreenQuad(foldMat);
  const info = { lights: 0, shadowed: 0, redraws: 0, redrawsLastFrame: 0, binMs: 0, indices: 0, clipped: 0, mode: 0 };
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Color(), _vp = new THREE.Vector4();
  let viewCam = null, camKey = '', dirtyTex = true, allDirty = false;
  const dyn = new Map();   // dynamic root -> { e: Float32Array(16), c: Vector3, r }

  function add(light, o = {}) {
    if (lights.length >= cfg.max || lights.some((l) => l.light === light)) return false;
    light.userData.mgClustered = true; light.userData.mgLayers = light.layers.mask;
    light.layers.set(30);   // no camera draws layer 30: three's light loop skips it from now on
    lights.push({ light, shadow: !!o.shadow, tile: null, dirty: true, want: 0, last: new Float32Array(REC * 4), range: 0, imp: 0, pos: new THREE.Vector3() });
    dirtyTex = true; camKey = '';
    return true;
  }
  function remove(light) {
    const i = lights.findIndex((l) => l.light === light);
    if (i < 0) return false;
    const L = lights[i];
    if (L.tile) tiles.free(L.tile.s, L.tile.xy);
    light.layers.mask = light.userData.mgLayers ?? 1; delete light.userData.mgClustered;
    lights.splice(i, 1); camKey = ''; dirtyTex = true;
    return true;
  }

  // light records -> the texture's first rows; true when any changed
  function writeRecords() {
    let changed = false;
    const rec = new Float32Array(REC * 4);
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i], l = L.light;
      l.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(l.matrixWorld);
      let vis = l.visible && l.intensity > 0;
      for (let p = l.parent; vis && p; p = p.parent) vis = p.visible;
      const range = l.distance > 0 ? l.distance : Math.min(60, Math.sqrt(Math.max(l.intensity, 0) * 100));   // no cut-off: to 1 % of 1 m
      _c.copy(l.color).multiplyScalar(vis ? l.intensity : 0);
      rec.fill(0);
      rec.set([_v.x, _v.y, _v.z, range, _c.r, _c.g, _c.b, l.decay ?? 2]);
      if (l.isSpotLight) {
        l.target.updateWorldMatrix(true, false);
        _d.setFromMatrixPosition(l.target.matrixWorld).sub(_v).normalize();
        rec.set([_d.x, _d.y, _d.z, Math.cos(l.angle), Math.cos(l.angle * (1 - l.penumbra))], 8);
      } else rec[11] = -2;
      rec[13] = L.shadow && L.tile ? 1 : 0; rec[14] = range;
      if (L.tile) rec.set([L.tile.xy[0], L.tile.xy[1], L.tile.s, 0], 16);
      let same = true, moved = false;
      for (let k = 0; k < rec.length; k++) if (rec[k] !== L.last[k]) { same = false; if (k < 4 || (k >= 8 && k < 13)) moved = true; }
      if (!same || L.row !== i) { L.last.set(rec); data.set(rec, i * REC * 4); L.row = i; changed = true; if (moved) L.dirty = true; }   // row: a removal shifts the lights after it
      L.range = range; L.pos.copy(_v);
    }
    return changed;
  }

  // per cell the lights whose sphere reaches it (conservative: the sphere's screen rectangle over its depth slices)
  const counts = new Uint16Array(CELLS), spans = [];
  function bin(cam) {
    const t0 = performance.now();
    const e = cam.projectionMatrix.elements, px = e[0], py = e[5], near = Math.max(cam.near, 0.05), far = Math.min(cam.far, 400);
    counts.fill(0); spans.length = 0;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      _t.copy(L.pos).applyMatrix4(cam.matrixWorldInverse);
      const z = -_t.z, r = L.range * 1.02 + 0.02;
      if (L.last[4] + L.last[5] + L.last[6] <= 0 || z + r < near) { spans.push(null); continue; }   // past `far` it lands in the last slice, as its pixels do
      const sx = sphereSpan(_t.x, z, r, px), sy = sphereSpan(_t.y, z, r, py);
      const s = [Math.floor((sx[0] * 0.5 + 0.5) * CLUSTER.x * 0.99999), Math.floor((sx[1] * 0.5 + 0.5) * CLUSTER.x * 0.99999), Math.floor((sy[0] * 0.5 + 0.5) * CLUSTER.y * 0.99999), Math.floor((sy[1] * 0.5 + 0.5) * CLUSTER.y * 0.99999), clusterSlice(z - r, near, far), clusterSlice(z + r, near, far)];
      spans.push(s);
      for (let cz = s[4]; cz <= s[5]; cz++) for (let cy = s[2]; cy <= s[3]; cy++) for (let cx = s[0]; cx <= s[1]; cx++) counts[cx + CLUSTER.x * (cy + CLUSTER.y * cz)]++;
    }
    let off = 0, clipped = 0;
    const base = rows.cells * TW * 4, ib = rows.index * TW * 4;
    for (let c = 0; c < CELLS; c++) {
      const n = Math.min(counts[c], cfg.perCell, IDX_CAP - off);
      data[base + c * 4] = off; data[base + c * 4 + 1] = 0; data[base + c * 4 + 2] = n;   // z: capacity while filling
      off += n; clipped += counts[c] - n;
    }
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      if (!s) continue;
      for (let cz = s[4]; cz <= s[5]; cz++) for (let cy = s[2]; cy <= s[3]; cy++) for (let cx = s[0]; cx <= s[1]; cx++) {
        const o = base + (cx + CLUSTER.x * (cy + CLUSTER.y * cz)) * 4;
        if (data[o + 1] < data[o + 2]) { data[ib + data[o] + data[o + 1]] = i; data[o + 1]++; }
      }
    }
    U.mgLB.value.z = near; U.mgLB.value.w = CLUSTER.z / Math.log(far / near);
    info.indices = off; info.clipped = clipped; info.binMs = +(performance.now() - t0).toFixed(3);
  }

  function cubeFor(face) {
    let c = cubes.get(face);
    if (!c) {
      const rt = new THREE.WebGLCubeRenderTarget(face, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      c = { rt, cam: new THREE.CubeCamera(0.03, 100, rt) };
      cubes.set(face, c);
    }
    return c;
  }
  function drawShadows(list) {
    const saved = renderer.getRenderTarget(), auto = renderer.autoClear, xr = renderer.xr.enabled, a = renderer.getClearAlpha(), cc = renderer.getClearColor(new THREE.Color());
    const om = scene.overrideMaterial, bg = scene.background, sm = renderer.shadowMap.enabled;
    // only shadow casters are drawn: everything else is hidden for the batch (visibility, so children are kept: a
    // non-casting parent with casting children is rare; such children do not cast here)
    const hidden = [];
    scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && !o.castShadow && o.visible) { o.visible = false; hidden.push(o); } });
    renderer.xr.enabled = false; renderer.autoClear = true; renderer.shadowMap.enabled = false;
    scene.overrideMaterial = dist; scene.background = null;
    renderer.setClearColor(new THREE.Color(1e4, 0, 0), 1);
    for (const L of list) {
      const { rt, cam } = cubeFor(Math.max(32, L.tile.s >> 1));
      dist.uniforms.uP.value.copy(L.pos);
      for (const c of cam.children) { c.far = L.range; c.updateProjectionMatrix(); }
      cam.position.copy(L.pos); cam.update(renderer, scene);
      foldMat.uniforms.tCube.value = rt.texture; foldMat.uniforms.uFar.value = L.range;
      atlas.viewport.set(L.tile.xy[0], L.tile.xy[1], L.tile.s, L.tile.s); atlas.scissor.copy(atlas.viewport); atlas.scissorTest = true;
      renderer.setRenderTarget(atlas);
      renderer.autoClear = false; quad.render(renderer); renderer.autoClear = true;
      L.dirty = false; info.redraws++;
    }
    for (const o of hidden) o.visible = true;
    scene.overrideMaterial = om; scene.background = bg; renderer.shadowMap.enabled = sm;
    renderer.setClearColor(cc, a); renderer.setRenderTarget(saved); renderer.autoClear = auto; renderer.xr.enabled = xr;
  }
  // moving objects: a top-level object with userData.mgDynamic whose matrix changed dirties the lights it is near
  function trackDynamic() {
    for (const o of scene.children) {
      if (!o.userData.mgDynamic || !o.visible) continue;
      let d = dyn.get(o);
      if (!d) {
        const s = new THREE.Box3().setFromObject(o).getBoundingSphere(new THREE.Sphere());
        d = { e: new Float32Array(16), c: new THREE.Vector3(), r: (s.radius || 1) + s.center.distanceTo(o.getWorldPosition(_v)) };
        dyn.set(o, d);
      }
      const e = o.matrixWorld.elements;
      let moved = !!o.userData.mgAnimated;
      for (let k = 0; k < 16 && !moved; k++) if (e[k] !== d.e[k]) moved = true;
      if (!moved) continue;
      _v.setFromMatrixPosition(o.matrixWorld);
      for (const L of lights) if (L.shadow && (L.pos.distanceTo(_v) < L.range + d.r || L.pos.distanceTo(d.c) < L.range + d.r)) L.dirty = true;
      d.e.set(e); d.c.copy(_v);
    }
    for (const o of dyn.keys()) if (o.parent !== scene) dyn.delete(o);
  }
  function shadowFrame(cam) {
    info.redrawsLastFrame = 0;
    const eye = _t.setFromMatrixPosition(cam.matrixWorld);
    let n = 0;
    for (const L of lights) {
      if (!L.shadow) { if (L.tile) { tiles.free(L.tile.s, L.tile.xy); L.tile = null; dirtyTex = true; } continue;}
      n++;
      L.imp = L.range / Math.max(L.pos.distanceTo(eye), L.range * 0.5);
      // the tile a light of this importance wants; it changes only when the importance left the current size's band
      const ideal = cfg.tileMax * Math.min(1, L.imp);
      if (!L.want || ideal > L.want * 1.5 || ideal < L.want * 0.4) L.want = Math.max(cfg.tileMin, Math.min(cfg.tileMax, 2 ** Math.round(Math.log2(Math.max(ideal, 1)))));
      if (!L.tile || L.tile.s !== L.want) {
        let s = L.want, xy = null;
        while (s >= cfg.tileMin && !(xy = tiles.alloc(s))) s >>= 1;
        if (xy) { if (L.tile) tiles.free(L.tile.s, L.tile.xy); L.tile = { s, xy }; L.dirty = true; dirtyTex = true; }
      }
    }
    info.shadowed = n;
    if (!n) return;
    trackDynamic();
    const todo = lights.filter((L) => L.tile && (L.dirty || allDirty) && L.last[4] + L.last[5] + L.last[6] > 0).sort((p, q) => q.imp - p.imp);
    allDirty = false;
    for (const L of todo) L.dirty = true;
    const now = todo.slice(0, first ? todo.length : cfg.perFrame);
    if (now.length) { drawShadows(now); info.redrawsLastFrame = now.length; first = false; }
  }
  let first = true;

  // which path a render takes is decided when it starts: the frame's view camera reads the clusters, any other
  // camera (captures) loops over all lights
  const chained = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, cam, rt) {
    if (chained) chained.call(this, r, s, cam, rt);
    const clustered = cfg.cluster && cam === viewCam && cam.isPerspectiveCamera;
    U.mgLA.value.x = lights.length; U.mgLA.value.y = lights.length ? (clustered ? 2 : 1) : 0;
    if (clustered) { r.getCurrentViewport(_vp); U.mgLB.value.x = 1 / _vp.z; U.mgLB.value.y = 1 / _vp.w; }
    info.mode = U.mgLA.value.y;
  };

  const part = { id: 'lights', key: cfg.max + '.' + cfg.perCell, order: 20, pars: glsl(cfg, rows), uniforms: U,
    apply: (fs, t) => t.swap(fs, '#if defined( RE_IndirectDiffuse )', LOOP(cfg, rows) + '\n#if defined( RE_IndirectDiffuse )', 'lights') };
  return {
    cfg, part, uniforms: U, info, add, remove, atlas, texture: tex,
    get count() { return lights.length; },
    frame(cam) {
      viewCam = cam; info.lights = lights.length;
      if (!lights.length) return;
      cam.updateMatrixWorld();
      if (writeRecords()) { dirtyTex = true; camKey = ''; }
      shadowFrame(cam);
      if (dirtyTex) writeRecords();   // a tile was (re)assigned above
      if (cfg.cluster && cam.isPerspectiveCamera) {
        const e = cam.matrixWorld.elements, p = cam.projectionMatrix.elements;
        let k = p[0] + ',' + p[5] + ',' + cam.near + ',' + cam.far;
        for (let i = 0; i < 16; i++) k += ',' + e[i];
        if (k !== camKey) { camKey = k; bin(cam); dirtyTex = true; }
      }
      if (dirtyTex) { tex.needsUpdate = true; dirtyTex = false; }
    },
    invalidate() { allDirty = true; },
    dispose() {
      scene.onBeforeRender = chained;
      for (const L of lights.slice()) remove(L.light);
      tex.dispose(); atlas.dispose(); depth.dispose(); dist.dispose(); foldMat.dispose(); quad.dispose();
      for (const c of cubes.values()) c.rt.dispose();
    },
  };
}
