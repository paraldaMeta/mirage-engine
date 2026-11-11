// Mirage original code (the idea of a cheap pool round every lamp beyond the real lights is from the author's Nizwa
// engine, oman-golden src/world/props.js, whose far lanterns draw a splash decal; nothing of that code is in here).
// ---------------------------------------------------------------------------
// Lamp pool: every lamp of a town lights its surroundings, not only the few real PointLights near the eye
// (opt-in: createWorldRenderer({ lampPool: true | { ... } })).
//
//   const world = createWorldRenderer({ lampPool: true });
//   world.lampPool.set(lanterns.map((p) => ({ pos: p, range: 6, power: 1.2, normal: wallNormal, back: 0.42 })));
//
// What a pool lamp is: a point light shaded inside the lit materials (three's own falloff, getDistanceAttenuation,
// through the material's own BRDF, RE_Direct: albedo, roughness, normal maps and specular all as for a PointLight)
// but held as data: one float texture (3 texels a lamp), so a lamp costs no program, no uniform and nothing in
// three's light loop. The view frustum is cut into lights.js's 16 x 9 x 24 cells; per cell the CPU lists the lamps
// whose sphere reaches it, and a pixel loops over its cell's list only. Hundreds of lamps cost what the lamps near
// each pixel cost (a lamp of range 6 m reaches few cells), plus a CPU re-binning when the camera moves (info.binMs).
//
// Why this and not a deferred light volume per lamp (a box drawn after the opaque pass that adds light from the depth
// buffer): Mirage keeps no G-buffer, so a volume knows neither albedo nor roughness nor the normal map; a dark door
// would glow like plaster, the light would not bend with relief, and it would have to be fitted between the opaque
// and transparent halves of the one scene render. In the materials it is the real light, so a lamp handed from the
// pool to a PointLight (or back) changes nothing but its shadow.
//
// Real lights and the pool together: a visible scene PointLight within 3 cm of a pool lamp is that lamp's real light,
// and the pool adds only what it lacks (1 - its intensity / the lamp's, per lamp, every render). A module that hands
// its few PointLights to the lamps nearest the eye with a smooth weight (Nizwa's props.js, the probe's lamps) thus
// gets a seamless hand-off: real + pool = the whole lamp at every weight, and nothing pops while walking.
// The pool's power follows the world's lamp level (G.uLampGain, as the examples' lanterns do): 0 by day, so by day
// the loop is skipped altogether.
//
// light2 (lamp shadows): pool lamps are offered to light2 as lamp-shadow candidates (addLampSource) at full power, and
// a PointLight on a pool lamp is folded into that lamp, so the shadow slots go to the most important lamps whether or
// not they have a real light, and the slot follows the lamp, not the light. A pool lamp that holds a slot is shadowed
// through the same atlas lookup as a PointLight; the volumetric pass scatters the pool lamps as it does the real ones.
//
// Leaks (there is no shadow for a lamp without a slot): a lamp lights every surface that faces it within its range,
// through walls. A lamp given a wall (normal + back: the wall face is `back` m behind the flame) lights nothing more
// than `soft` m behind that face, which removes the common case (the room behind the wall a lantern hangs on).
// What still leaks: through a second wall or a floor between the lamp and a surface facing it (a room across a lane
// narrower than the range, the floor above a lamp), and round corners (the lamp lights the side of a pier it cannot
// see); a lamp with no wall leaks in every direction. Ranges are short (6 m by default), which keeps that local.
// Cameras: perspective ones (the view, the environment and probe captures) are binned; an orthographic camera loops
// over every lamp within reach (correct, not culled).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CLUSTER, clusterSlice, sphereSpan } from './lights.js';
import { createInjector } from './inject.js';
import { addLampSource } from './light2.js';

export const LAMPPOOL_DEFAULTS = {
  max: 1024,        // lamps (the texture's record rows are sized for it)
  perCell: 32,      // most lamps shaded in one cell (info.clipped counts what a render dropped; the nearest are kept)
  far: 200,         // m from the eye beyond which a lamp is not shaded; it fades out over the last `fade` m
  fade: 40,
  lampGain: true,   // a lamp's power x the world's lamp gain (G.uLampGain): 0 by day; false: the power as given
  real: true,       // a PointLight on a pool lamp is its real light (the pool adds the rest); false: the pool ignores them
  soft: 0.15,       // m: how far behind a lamp's wall its light fades out
  thick: 0.4,       // m: the cut starts this far behind the wall face (door and window reveals, arch soffits keep the
                    // light a PointLight gives them, so the hand-off does not flip them); a wall at least thick + soft
                    // thick stays dark on its far side
  light2: true,     // with light2 on: pool lamps are lamp-shadow (and in-scatter) candidates
  captures: true,   // shade in cube captures too (the environment, lighting.js probes), as a PointLight is: the image-based
                    // light then sees every lamp near its probe whether or not a real light sits on it
};
export function lampPoolConfig(c) { return c ? { ...LAMPPOOL_DEFAULTS, ...(c === true ? {} : c) } : null; }

const TW = 256, REC = 3, CELLS = CLUSTER.x * CLUSTER.y * CLUSTER.z;
const MATCH2 = 0.03 * 0.03;   // a PointLight this close (m^2) to a pool lamp is that lamp's real light
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** a lamp as given -> the numbers the pool keeps: { x, y, z, range, power, r, g, b, decay, n: [nx, ny, nz, d] | null, near | null } */
export function poolLamp(o) {
  const p = o.pos || [o.x, o.y, o.z];
  const c = o.color || [1, 0.56, 0.25];
  const l = { x: +p[0], y: +p[1], z: +p[2], range: o.range ?? 6, power: o.power ?? 1, r: c[0], g: c[1], b: c[2], decay: o.decay ?? 2, n: null, near: o.near ?? null, thick: Number.isFinite(o.thick) ? Math.max(0, o.thick) : null };   // near: null = light2's own default (ls.near); thick: null = the pool's
  // a stable id for light2's lamp-shadow slot (by place, so removing another lamp does not move it)
  l.id = o.id != null ? String(o.id) : 'mgPool' + l.x.toFixed(2) + ',' + l.y.toFixed(2) + ',' + l.z.toFixed(2);
  if (o.normal) {
    const [nx, ny, nz] = o.normal, s = Math.hypot(nx, ny, nz) || 1;
    // the plane `back` m behind the flame along the normal: light where dot(n, P) + d > 0
    const n = [nx / s, ny / s, nz / s];
    l.n = [n[0], n[1], n[2], -(n[0] * l.x + n[1] * l.y + n[2] * l.z) + (o.back ?? 0)];
  }
  return l;
}

/** the share of a lamp of power `power` (colour rgb) a PointLight of intensity `i` (colour c) already gives, 0..1 */
export function realShare(i, c, power, rgb) {
  const want = power * lum(rgb[0], rgb[1], rgb[2]);
  return want > 0 ? Math.min(1, Math.max(0, (i * lum(c[0], c[1], c[2])) / want)) : 1;
}

/** per cell the lamps (indices into `pos`) whose sphere reaches it: { offsets: Uint32Array(CELLS), counts, index,
 *  clipped }. pos: [{ x, y, z, range }] in view space is computed from `view` (Matrix4: world -> view); proj: the
 *  projection's x / y scale; near / far of the split. Kept lamps per cell: at most perCell, the nearest to the eye. */
export function binLamps(list, view, px, py, near, far, perCell) {
  const counts = new Uint32Array(CELLS), spans = [], v = new THREE.Vector3();
  for (const q of list) {
    v.set(q.x, q.y, q.z).applyMatrix4(view);
    const z = -v.z, r = q.range * 1.02 + 0.02;
    if (z + r < near) { spans.push(null); continue; }
    const sx = sphereSpan(v.x, z, r, px), sy = sphereSpan(v.y, z, r, py);
    const s = [Math.floor((sx[0] * 0.5 + 0.5) * CLUSTER.x * 0.99999), Math.floor((sx[1] * 0.5 + 0.5) * CLUSTER.x * 0.99999), Math.floor((sy[0] * 0.5 + 0.5) * CLUSTER.y * 0.99999), Math.floor((sy[1] * 0.5 + 0.5) * CLUSTER.y * 0.99999), clusterSlice(z - r, near, far), clusterSlice(z + r, near, far), z];
    spans.push(s);
    for (let cz = s[4]; cz <= s[5]; cz++) for (let cy = s[2]; cy <= s[3]; cy++) for (let cx = s[0]; cx <= s[1]; cx++) counts[cx + CLUSTER.x * (cy + CLUSTER.y * cz)]++;
  }
  // nearest first, so a full cell keeps the lamps that matter
  const order = spans.map((s, i) => i).filter((i) => spans[i]).sort((a, b) => spans[a][6] - spans[b][6] || a - b);
  const offsets = new Uint32Array(CELLS), fill = new Uint32Array(CELLS);
  let off = 0, clipped = 0;
  for (let c = 0; c < CELLS; c++) { const n = Math.min(counts[c], perCell); offsets[c] = off; off += n; clipped += counts[c] - n; }
  const index = new Uint32Array(off);
  for (const i of order) {
    const s = spans[i];
    for (let cz = s[4]; cz <= s[5]; cz++) for (let cy = s[2]; cy <= s[3]; cy++) for (let cx = s[0]; cx <= s[1]; cx++) {
      const c = cx + CLUSTER.x * (cy + CLUSTER.y * cz);
      if (fill[c] < Math.min(counts[c], perCell)) index[offsets[c] + fill[c]++] = i;
    }
  }
  return { offsets, counts: fill, index, clipped };
}

const pars = (rows) => /* glsl */ `
#if defined( RE_Direct )
#define MG_LP
uniform highp sampler2D mgPT;
uniform vec4 mgPA;   // x: lamps in the list (mode 1), y: 0 off / 1 the list / 2 clustered, z: fade start, w: fade end (m from the eye)
uniform vec4 mgPB;   // xy: 1 / viewport px, z: near, w: slices / log( far / near )
uniform vec4 mgPC;   // x: gain, y: wall soft edge (m), zw: the viewport's origin (px; a PMREM face is drawn off the corner)
vec4 mgPF( int i ) { return texelFetch( mgPT, ivec2( i & ${TW - 1}, i >> 8 ), 0 ); }
#endif
`;
const loop = (cfg, rows) => /* glsl */ `
#if defined( MG_LP )
if ( mgPA.y > 0.5 ) {
	vec3 mgQ = mgLW( geometryPosition );
	int mgBase = 0, mgCount = int( mgPA.x );
	if ( mgPA.y > 1.5 ) {
		ivec3 c = ivec3( clamp( ( gl_FragCoord.xy - mgPC.zw ) * mgPB.xy, 0.0, 0.9999 ) * vec2( ${CLUSTER.x}.0, ${CLUSTER.y}.0 ), clamp( int( log( max( - geometryPosition.z, mgPB.z ) / mgPB.z ) * mgPB.w ), 0, ${CLUSTER.z - 1} ) );
		vec4 cell = mgPF( ${rows.cells * TW} + c.x + ${CLUSTER.x} * ( c.y + ${CLUSTER.y} * c.z ) );
		mgBase = int( cell.x ); mgCount = int( cell.y );
	}
	IncidentLight mgPL; mgPL.visible = true;
	for ( int k = 0; k < ${cfg.max}; k ++ ) {
		if ( k >= mgCount ) break;
		int j = mgBase + k;
		int li = int( mgPF( ${rows.index * TW} + ( j >> 2 ) )[ j & 3 ] );
		vec4 la = mgPF( li * ${REC} ), lb = mgPF( li * ${REC} + 1 ), lc = mgPF( li * ${REC} + 2 );
		vec3 L = la.xyz - mgQ; float dist = length( L );
		if ( dist >= la.w ) continue;
		float att = getDistanceAttenuation( dist, la.w, lb.w );
		// the wall the lamp hangs on: nothing behind it
		if ( lc.x != 0.0 || lc.y != 0.0 || lc.z != 0.0 ) att *= smoothstep( - mgPC.y, 0.0, dot( lc.xyz, mgQ ) + lc.w );
		att *= 1.0 - smoothstep( mgPA.z, mgPA.w, distance( la.xyz, cameraPosition ) );
		if ( att <= 0.0 ) continue;
		L /= dist;
		#ifdef MG_LS
		if ( mgLsInfo2.x > 0.5 && receiveShadow ) att *= mgLsVis( la.xyz, mgQ, mgLWN( geometryNormal ) );   // light2: a pool lamp holding a slot
		#endif
		mgPL.direction = normalize( ( viewMatrix * vec4( L, 0.0 ) ).xyz );
		mgPL.color = lb.rgb * ( att * mgPC.x );
		RE_Direct( mgPL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
}
#endif
`;

/** w: { renderer, scene, G (the world's uniforms), injector? (lighting.js's: shared, else the pool makes its own),
 *  light2? (the world's light2 settings) }; cfg: lampPoolConfig(...) */
export function createLampPool(w, cfg) {
  const { scene, G } = w;
  const recRows = Math.ceil((cfg.max * REC) / TW), cellRows = Math.ceil(CELLS / TW);
  // rows: lamp records | cells (offset, count) | the cells' index lists (4 a texel; grows), or the one list of mode 1
  const rows = { cells: recRows, index: recRows + cellRows };
  let TH = rows.index + Math.max(16, Math.ceil(cfg.max / (TW * 4))), IDX_CAP = (TH - rows.index) * TW * 4;
  let data = new Float32Array(TW * TH * 4);
  const makeTex = () => { const t = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
  let tex = makeTex();
  const U = {
    mgPT: { value: tex },
    mgPA: { value: new THREE.Vector4(0, 0, cfg.far - cfg.fade, cfg.far) },
    mgPB: { value: new THREE.Vector4(1, 1, 0.1, 1) },
    mgPC: { value: new THREE.Vector4(1, cfg.soft, 0, 0) },
  };
  const grow = (need) => {
    while (IDX_CAP < need) { TH *= 2; IDX_CAP = (TH - rows.index) * TW * 4; }
    const d = new Float32Array(TW * TH * 4); d.set(data); data = d;
    tex.dispose(); tex = makeTex(); U.mgPT.value = tex; info.rows = TH;
  };
  const part = { id: 'lamppool', key: cfg.max + '.' + cfg.perCell, order: 21, pars: pars(rows), uniforms: U,
    apply: (fs, t) => t.swap(fs, '#if defined( RE_IndirectDiffuse )', loop(cfg, rows) + '\n#if defined( RE_IndirectDiffuse )', 'lamppool') };
  const own = !w.injector;
  const inj = w.injector || createInjector();
  inj.add(part);

  const lamps = [];          // poolLamp records
  let weight = new Float32Array(cfg.max).fill(1), scratch = new Float32Array(cfg.max);   // the pool's share of each lamp (1 - its real light's)
  const info = { lamps: 0, active: 0, real: 0, indices: 0, clipped: 0, binMs: 0, mode: 0, rows: TH, renders: 0 };
  let dirtyRec = true, binKey = '', activeKey = '', renders = 0;
  const _v = new THREE.Vector3(), _vp = new THREE.Vector4();

  // ---- the records (only rewritten when a lamp or its weight changed)
  function writeRecords() {
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i], o = i * REC * 4, k = weight[i] * l.power;
      data.set([l.x, l.y, l.z, l.range, l.r * k, l.g * k, l.b * k, l.decay], o);
      if (l.n) data.set([l.n[0], l.n[1], l.n[2], l.n[3] + (l.thick ?? cfg.thick)], o + 8); else data.fill(0, o + 8, o + 12);
    }
    dirtyRec = false;
  }

  // ---- the scene's PointLights that sit on a pool lamp: rescanned every 30 renders and before every still frame
  // (world.js calls rescan()), never by the clock, so a still frame sees the lights the scene has now
  let plCache = null, plR = -1;
  let plMatch = new WeakMap();   // light -> { x, y, z, n, i }: the lamp it sits on (-1: none)
  function realLights() {
    if (!plCache || renders - plR >= 30) { const out = []; scene.traverse((o) => { if (o.isPointLight) out.push(o); }); plCache = out; plR = renders; }
    return plCache;
  }
  function nearestLamp(x, y, z) {
    let best = -1, bd = MATCH2;
    for (let i = 0; i < lamps.length; i++) { const l = lamps[i], d = (l.x - x) ** 2 + (l.y - y) ** 2 + (l.z - z) ** 2; if (d <= bd) { bd = d; best = i; } }
    return best;
  }
  /** the pool's share of every lamp from the real lights now; true when any changed */
  function shares(gain) {
    if (!cfg.real || !lamps.length) return false;
    const next = scratch.fill(1);
    let n = 0;
    for (const pl of realLights()) {
      // visible, and still in this scene (a group taken out of it, e.g. by a streamer, takes its lights along)
      let vis = pl.visible && pl.intensity > 0, top = pl;
      for (let p = pl.parent; vis && p; p = p.parent) { vis = p.visible; top = p; }
      if (!vis || top !== scene) continue;
      pl.getWorldPosition(_v);
      let m = plMatch.get(pl);
      if (!m || m.x !== _v.x || m.y !== _v.y || m.z !== _v.z || m.n !== lamps.length) { m = { x: _v.x, y: _v.y, z: _v.z, n: lamps.length, i: nearestLamp(_v.x, _v.y, _v.z) }; plMatch.set(pl, m); }
      if (m.i < 0) continue;
      const l = lamps[m.i];
      next[m.i] = Math.max(0, next[m.i] - realShare(pl.intensity, [pl.color.r, pl.color.g, pl.color.b], l.power * gain, [l.r, l.g, l.b]));
      n++;
    }
    info.real = n;
    let changed = false;
    for (let i = 0; i < lamps.length; i++) if (next[i] !== weight[i]) { changed = true; break; }
    if (changed) { scratch = weight; weight = next; }
    return changed;
  }

  // ---- per render: weights, the active lamps, the cells
  // a cube capture: three's PMREM (the environment, lighting.js probes) or a CubeCamera (gi.js)
  const isCapture = (rt) => !!rt && (rt.isWebGLCubeRenderTarget || (rt.texture && rt.texture.mapping === THREE.CubeUVReflectionMapping));
  function before(r, cam, rt) {
    renders++;
    if (own && renders % 30 === 1) inj.adopt(scene);
    const gain = cfg.lampGain ? G.uLampGain.value : 1;
    U.mgPC.value.x = gain;
    if (!lamps.length || !(gain > 1e-6) || (!cfg.captures && isCapture(rt))) { U.mgPA.value.y = 0; info.mode = 0; return; }
    if (shares(gain)) dirtyRec = true;
    let dirty = false;
    if (dirtyRec) { writeRecords(); dirty = true; }
    cam.updateMatrixWorld();
    _v.setFromMatrixPosition(cam.matrixWorld);
    // the lamps worth shading from this eye: some light left for the pool, within `far`
    const act = [];
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      if (weight[i] <= 0 || l.power <= 0) continue;
      if ((l.x - _v.x) ** 2 + (l.y - _v.y) ** 2 + (l.z - _v.z) ** 2 < cfg.far * cfg.far) act.push(i);
    }
    info.active = act.length;
    if (!act.length) { U.mgPA.value.y = 0; info.mode = 0; if (dirty) tex.needsUpdate = true; return; }
    const ak = act.join(',');
    // an XR ArrayCamera is a PerspectiveCamera too, but each eye draws its own viewport through the joint frustum:
    // the cells would not line up, so it takes the list path
    const clustered = cam.isPerspectiveCamera && !cam.isArrayCamera;
    if (clustered) {
      const e = cam.matrixWorld.elements, p = cam.projectionMatrix.elements;
      let k = p[0] + ',' + p[5] + ',' + cam.near + ',' + cam.far;
      for (let i = 0; i < 16; i++) k += ',' + e[i];
      if (k !== binKey || ak !== activeKey) {
        const t0 = performance.now();
        const near = Math.max(cam.near, 0.05), far = Math.min(cam.far, 400);
        const b = binLamps(act.map((i) => lamps[i]), cam.matrixWorldInverse, p[0], p[5], near, far, cfg.perCell);
        if (b.index.length > IDX_CAP) grow(b.index.length);
        const base = rows.cells * TW * 4, ib = rows.index * TW * 4;
        for (let c = 0; c < CELLS; c++) { data[base + c * 4] = b.offsets[c]; data[base + c * 4 + 1] = b.counts[c]; }
        for (let j = 0; j < b.index.length; j++) data[ib + j] = act[b.index[j]];
        U.mgPB.value.z = near; U.mgPB.value.w = CLUSTER.z / Math.log(far / near);
        info.indices = b.index.length; info.clipped = b.clipped; info.binMs = +(performance.now() - t0).toFixed(3);
        binKey = k; activeKey = ak; dirty = true;
      }
      r.getCurrentViewport(_vp); U.mgPB.value.x = 1 / _vp.z; U.mgPB.value.y = 1 / _vp.w; U.mgPC.value.z = _vp.x; U.mgPC.value.w = _vp.y;
    } else if (ak !== activeKey || binKey !== 'list') {
      const ib = rows.index * TW * 4;   // the one list, where the cells' lists go (a perspective camera re-bins after)
      for (let j = 0; j < act.length; j++) data[ib + j] = act[j];
      binKey = 'list'; activeKey = ak; dirty = true;
    }
    U.mgPA.value.x = act.length; U.mgPA.value.y = clustered ? 2 : 1; info.mode = U.mgPA.value.y;
    if (dirty) tex.needsUpdate = true;
  }
  const chained = scene.onBeforeRender;
  let disposed = false;
  const hook = function (r, s, cam, rt) {
    if (chained) chained.call(this, r, s, cam, rt);
    if (disposed) return;
    before(r, cam, rt);
    info.renders = renders;
  };
  scene.onBeforeRender = hook;

  // ---- light2: the pool lamps as lamp-shadow candidates (light2.js folds a PointLight on a pool lamp into it)
  const l2 = w.light2 && cfg.light2 ? w.light2 : null;
  const source = (cp) => {
    const gain = cfg.lampGain ? G.uLampGain.value : 1;
    if (!lamps.length || !(gain > 1e-6) || (G.uLamp && G.uLamp.value < l2.ls.dayLevel)) return null;
    const out = [], reach = l2.ls.reach;
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      if (l.power <= 0 || (l.x - cp.x) ** 2 + (l.y - cp.y) ** 2 + (l.z - cp.z) ** 2 > (l.range + reach) ** 2) continue;
      const p = l.power * gain;
      out.push({ id: l.id, x: l.x, y: l.y, z: l.z, range: l.range, power: p, near: l.near ?? l2.ls.near, col: [l.r * p, l.g * p, l.b * p], pool: true });
    }
    return out;
  };
  if (l2) addLampSource(scene, source);

  const changed = () => { dirtyRec = true; activeKey = ''; info.lamps = lamps.length; plMatch = new WeakMap(); };
  return {
    cfg, part, uniforms: U, info, rows,
    get texture() { return tex; },
    get count() { return lamps.length; },
    /** replace every lamp: [{ pos: [x, y, z], range = 6, power = 1, color = [1, 0.56, 0.25], decay = 2, normal?, back = 0, near? }] */
    set(list = []) {
      lamps.length = 0;
      for (const o of list.slice(0, cfg.max)) lamps.push(poolLamp(o));
      if (list.length > cfg.max) console.warn(`[lampPool] ${list.length} lamps, max ${cfg.max}: the rest are dropped`);
      weight.fill(1); changed();
      return lamps.length;
    },
    /** add one lamp; returns its index, -1 when the pool is full */
    add(o) { if (lamps.length >= cfg.max) return -1; lamps.push(poolLamp(o)); weight[lamps.length - 1] = 1; changed(); return lamps.length - 1; },
    /** change lamp i (the fields given; the rest stay) */
    update(i, o) {
      const l = lamps[i]; if (!l) return false;
      lamps[i] = poolLamp({ pos: [l.x, l.y, l.z], range: l.range, power: l.power, color: [l.r, l.g, l.b], decay: l.decay, near: l.near, thick: l.thick ?? undefined, ...(o.pos ? {} : { id: l.id }), ...(l.n ? { normal: l.n.slice(0, 3), back: l.n[3] + l.n[0] * l.x + l.n[1] * l.y + l.n[2] * l.z } : {}), ...o });
      changed(); return true;
    },
    clear() { lamps.length = 0; changed(); },
    /** the lamps as kept (read only) */
    get lamps() { return lamps; },
    /** wrap the lit materials added since the last call (the world does it in prepare; the pool every 30 renders) */
    adopt() { return own ? inj.adopt(scene) : 0; },
    /** look for the scene's PointLights again now (world.js: before every still frame) */
    rescan() { plCache = null; },
    dispose() {
      disposed = true;
      // unhook only if nothing wrapped the hook since (frame.js's onView, LOD): otherwise the wrapper stays and ours
      // passes straight through
      if (scene.onBeforeRender === hook) scene.onBeforeRender = chained;
      const src = scene.userData.mgLampSources, i = src ? src.indexOf(source) : -1;
      if (i >= 0) src.splice(i, 1);
      inj.remove('lamppool');
      tex.dispose();
    },
  };
}
