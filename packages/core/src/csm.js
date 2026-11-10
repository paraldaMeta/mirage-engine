// Mirage original code.
// ---------------------------------------------------------------------------
// Cascaded sun shadows (opt-in: createWorldRenderer({ lighting: { csm: true | { cascades, distance, ... } } })).
//
//   const csm = createCsm(sun, cfg, { tile, soft });     // lighting.js does this
//   csm.fit(dirToSun, camera | null, center, radius, k); // before each (sub-)frame draws (world.fitShadow calls it)
//
// What: the sun's one shadow map becomes a 2 x 2 atlas of `cascades` (2..4) orthographic maps. Each cascade is the
// bounding SPHERE of one slice of the view frustum (splits between the log and the linear scheme by `lambda`), so
// its size does not change when the camera turns, and its centre is snapped to whole texels of its own map: a
// moving or turning camera never makes the shadow edges swim. Without a perspective camera (environment and probe
// captures, the orthographic game view) the cascades are spheres around the world's shadow centre instead.
// How it draws: three's own shadow pass — the sun's LightShadow instance gets the viewport methods three calls for
// multi-viewport shadows (one viewport per cascade), so every caster's depth material, alpha test and wind sway are
// read exactly as before, and the atlas is the sun's own sampler2DShadow: no extra texture unit.
// How it is read: per fragment, the first cascade whose tile holds the (normal-offset) world position; inside a
// band at the tile's edge it blends into the next cascade, and the last one fades to unshadowed. The filter is a
// rotated Vogel disc of hardware 2 x 2 compares with a radius fixed in METRES (so cascades match at their borders);
// with the world's softShadows on it is the same contact-hardening search as softshadow.js, per cascade (blocker
// search by compare taps, penumbra = blocker distance x tan(sunAngle / 2), then the disc over that radius), the
// reference depth following the receiver's plane. Rotation per pixel = interleaved gradient noise + a golden-ratio
// step of the sub-frame index, so stills and TAA converge and a still depends on k only.
// Tiers: the tile is half the quality tier's shadow map (the atlas takes the memory the single map took).
// Cost: `cascades` depth passes of the scene per (sub-)frame instead of one; three clears the whole atlas each time,
// so far cascades cannot be refreshed less often (not done).
// Readers that are not adopted lit materials (post.js's volumetric march, a ShaderMaterial of the host) still get
// sun.shadow.matrix: here the LAST cascade's atlas matrix, valid inside that cascade only.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const CSM_DEFAULTS = {
  cascades: 4,        // 2..4
  distance: 160,      // m from the camera the cascades cover
  lambda: 0.8,        // split scheme: 1 = logarithmic, 0 = linear
  near: 1,            // m: where the first split starts (the camera's near is too small for a log split)
  tile: 0,            // px per cascade; 0 = half the quality tier's shadow map
  blend: 0.1,         // share of a tile over which a cascade blends into the next one
  reach: 150,         // m toward the sun that casters outside the cascade still count
  radius: 0.03,       // m: PCF disc radius (at least one texel of the cascade)
  bias: 0.02,         // m of depth bias
  normalOffset: 1.5,  // texels of the cascade the lookup is pushed along the surface normal
  taps: 8,            // PCF taps (compiled in)
};
const MAXC = 4;
const vogel = (name, n, turn) => `const vec2 ${name}[ ${n} ] = vec2[ ${n} ]( ${Array.from({ length: n }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / n), t = i * 2.399963229728653 + turn;
  return `vec2( ${(r * Math.cos(t)).toFixed(6)}, ${(r * Math.sin(t)).toFixed(6)} )`;
}).join(', ')} );`;

/** a full config from `true` or a partial object; null when off */
export function csmConfig(c) {
  if (!c) return null;
  const o = { ...CSM_DEFAULTS, ...(c === true ? {} : c) };
  o.cascades = Math.max(2, Math.min(MAXC, Math.round(o.cascades)));
  o.lambda = Math.min(1, Math.max(0, o.lambda));
  o.blend = Math.min(0.45, Math.max(0, o.blend));
  return o;
}

/** split distances (cascades + 1 values, near .. far): lambda between the log and the linear scheme */
export function csmSplits(n, near, far, lambda) {
  const s = [];
  for (let i = 0; i <= n; i++) { const t = i / n; s.push(lambda * near * Math.pow(far / near, t) + (1 - lambda) * (near + (far - near) * t)); }
  return s;
}
/** bounding sphere of the frustum slice n..f (tx, ty: tan of the half angles): { z: centre distance along the view, r } */
export function sliceSphere(n, f, tx, ty) {
  const t2 = tx * tx + ty * ty;
  const z = Math.min(f, 0.5 * (f + n) * (1 + t2));
  return { z, r: Math.sqrt((f - z) * (f - z) + f * f * t2) };
}
/** snap `c` (array 3) to whole texels on the light's plane: right/up/d unit vectors (arrays), texel in m */
export function snapToTexel(c, right, up, d, texel) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = Math.round(dot(c, right) / texel) * texel, b = Math.round(dot(c, up) / texel) * texel, z = dot(c, d);
  return [right[0] * a + up[0] * b + d[0] * z, right[1] * a + up[1] * b + d[1] * z, right[2] * a + up[2] * b + d[2] * z];
}

const glsl = (N, F, soft) => /* glsl */ `
#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && NUM_DIR_LIGHT_SHADOWS > 0
#define MG_CSM
uniform mat4 mgCsmM[ ${MAXC} ];
uniform vec4 mgCsmR[ ${MAXC} ];   // tile rect in atlas uv, inset by a guard: xy min, zw max
uniform vec4 mgCsmP[ ${MAXC} ];   // x: texel (m), y: atlas uv per m
uniform vec4 mgCsmA;              // x: on, y: blend band, z: rotation phase, w: depth per m
uniform vec4 mgCsmB;              // x: PCF radius (m), y: tan(sunAngle / 2) (0: hard), z: widest penumbra radius (m), w: nearest blocker (m)
uniform vec4 mgCsmC;              // x: bias (m), y: normal offset (texels), z: slope clamp, w: widest penumbra (texels)
${vogel('MG_CSM_PF', F, 1.2)}
${soft ? `#define MG_CSM_SOFT\n#define MG_CSM_B ${soft.B}\n#define MG_CSM_S ${soft.S}\n${vogel('MG_CSM_PB', soft.B, 0)}` : ''}
float mgCsmSample( sampler2DShadow map, int i, vec3 q, vec3 dx, vec3 dy ) {
	vec4 R = mgCsmR[ i ]; vec4 P = mgCsmP[ i ];
	float dz = mgCsmA.w, texel = P.x * P.y;
	// receiver plane: depth over atlas uv, slope clamped
	float det = dx.x * dy.y - dx.y * dy.x;
	vec2 g = abs( det ) > 1e-24 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
	float gMax = mgCsmC.z * dz / P.y, gLen = length( g );
	if ( gLen > gMax ) { g *= gMax / gLen; gLen = gMax; }
	float z = q.z - mgCsmC.x * dz - gLen * texel;
	float phi = 6.2831853 * fract( mgIgn( gl_FragCoord.xy ) + mgCsmA.z );
	float cs = cos( phi ), sn = sin( phi );
	mat2 rot = mat2( cs, sn, - sn, cs );
	float rM = max( mgCsmB.x, P.x );
	#ifdef MG_CSM_SOFT
	if ( mgCsmB.y > 0.0 ) {
		float d0 = mgCsmB.w, maxR = max( rM, min( mgCsmB.z, mgCsmC.w * P.x ) );
		mat2 rb = rot * ( maxR * P.y );
		float zb = z - d0 * dz;
		float occ = 1.0 - texture( map, vec3( q.xy, zb ) );
		for ( int k = 0; k < MG_CSM_B; k ++ ) {
			vec2 o = rb * MG_CSM_PB[ k ];
			occ += 1.0 - texture( map, vec3( clamp( q.xy + o, R.xy, R.zw ), zb + dot( g, o ) ) );
		}
		if ( occ <= 0.0 ) return 1.0;
		if ( occ >= float( MG_CSM_B + 1 ) - 1e-3 ) return 0.0;
		// how far the blockers are: per blocked tap a binary search in log distance, d0 .. the reach of the widest penumbra
		float lr = log2( max( maxR / mgCsmB.y / d0, 1.0 ) ), sumD = 0.0, sumW = 0.0;
		for ( int k = 0; k <= MG_CSM_B; k ++ ) {
			vec2 o = k == 0 ? vec2( 0.0 ) : rb * MG_CSM_PB[ k > 0 ? k - 1 : 0 ];
			vec3 p = vec3( clamp( q.xy + o, R.xy, R.zw ), z + dot( g, o ) );
			float b = 1.0 - texture( map, vec3( p.xy, p.z - d0 * dz ) );
			if ( b <= 0.0 ) continue;
			float lo = 0.0, hi = 1.0;
			for ( int s = 0; s < MG_CSM_S; s ++ ) {
				float m = 0.5 * ( lo + hi );
				float bm = 1.0 - texture( map, vec3( p.xy, p.z - d0 * exp2( m * lr ) * dz ) );
				if ( bm >= 0.5 * b ) lo = m; else hi = m;
			}
			sumD += b * d0 * exp2( 0.5 * ( lo + hi ) * lr );
			sumW += b;
		}
		rM = clamp( sumD / max( sumW, 1e-6 ) * mgCsmB.y, rM, maxR );
	}
	#endif
	mat2 rf = rot * ( rM * P.y );
	float s = 0.0;
	for ( int k = 0; k < ${F}; k ++ ) {
		vec2 o = rf * MG_CSM_PF[ k ];
		s += texture( map, vec3( clamp( q.xy + o, R.xy, R.zw ), z + dot( g, o ) ) );
	}
	return s / float( ${F} );
}
// world position and (geometric) world normal -> the sun's visibility
float mgCsmShadow( sampler2DShadow map, vec3 Pw, vec3 Nw ) {
	vec3 ddx = dFdx( Pw ), ddy = dFdy( Pw );
	for ( int i = 0; i < ${N}; i ++ ) {
		vec3 p = Pw + Nw * ( mgCsmC.y * mgCsmP[ i ].x );
		vec3 q = ( mgCsmM[ i ] * vec4( p, 1.0 ) ).xyz;
		vec4 R = mgCsmR[ i ];
		vec2 t = ( q.xy - R.xy ) / ( R.zw - R.xy );
		float edge = min( min( t.x, t.y ), min( 1.0 - t.x, 1.0 - t.y ) );
		if ( edge <= 0.0 || q.z >= 1.0 || q.z <= 0.0 ) continue;
		mat3 L = mat3( mgCsmM[ i ] );
		float s = mgCsmSample( map, i, q, L * ddx, L * ddy );
		float w = mgCsmA.y > 0.0 ? smoothstep( 0.0, mgCsmA.y, edge ) : 1.0;
		if ( w >= 1.0 ) return s;
		float far = 1.0;
		#if ${N} > 1
		if ( i < ${N - 1} ) {
			int j = i + 1;
			vec3 p2 = Pw + Nw * ( mgCsmC.y * mgCsmP[ j ].x );
			vec3 q2 = ( mgCsmM[ j ] * vec4( p2, 1.0 ) ).xyz;
			vec4 R2 = mgCsmR[ j ];
			if ( all( greaterThan( q2.xy, R2.xy ) ) && all( lessThan( q2.xy, R2.zw ) ) && q2.z < 1.0 && q2.z > 0.0 ) { mat3 L2 = mat3( mgCsmM[ j ] ); far = mgCsmSample( map, j, q2, L2 * ddx, L2 * ddy ); }
		}
		#endif
		return mix( far, s, w );
	}
	return 1.0;
}
#endif
`;

/** sun: the world's DirectionalLight (castShadow); opts.tile: px per cascade; opts.soft: the world's soft-shadow config or null */
export function createCsm(sun, cfg, opts = {}) {
  const N = cfg.cascades, sh = sun.shadow, soft = opts.soft || null;
  const tile = Math.max(256, cfg.tile || opts.tile || 1024);
  const cams = [], mats = [], frusta = [], rects = [], pars = [];
  for (let i = 0; i < MAXC; i++) { cams.push(new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 100)); mats.push(new THREE.Matrix4()); frusta.push(new THREE.Frustum()); rects.push(new THREE.Vector4()); pars.push(new THREE.Vector4()); }
  const U = {
    mgCsmM: { value: mats }, mgCsmR: { value: rects }, mgCsmP: { value: pars },
    mgCsmA: { value: new THREE.Vector4(0, cfg.blend, 0, 1) }, mgCsmB: { value: new THREE.Vector4() }, mgCsmC: { value: new THREE.Vector4() },
  };
  const views = [new THREE.Vector4(0, 0, 1, 1), new THREE.Vector4(1, 0, 1, 1), new THREE.Vector4(0, 1, 1, 1), new THREE.Vector4(1, 1, 1, 1)];
  const guard = 1.5 / (2 * tile);   // atlas uv kept clear at a tile's edge (a bilinear compare reads a texel beyond the tap)
  for (let i = 0; i < MAXC; i++) rects[i].set(views[i].x / 2 + guard, views[i].y / 2 + guard, views[i].x / 2 + 0.5 - guard, views[i].y / 2 + 0.5 - guard);
  const saved = { mapSize: sh.mapSize.clone(), views: sh._viewports, count: sh._viewportCount, extents: sh._frameExtents.clone() };
  let on = false;
  const info = { cascades: [] };   // per cascade { center, radius, texel } of the last fit (tests, docs)

  function enable() {
    if (on) return;
    on = true;
    sh.mapSize.set(tile, tile);
    sh._frameExtents.set(2, 2); sh._viewports = views.slice(0, N); sh._viewportCount = N;
    sh.getCamera = (i) => cams[i] || cams[0];
    sh.getFrustum = (i) => frusta[i] || frusta[0];
    sh.updateMatrices = function () {
      for (let i = 0; i < N; i++) this._updateMatrix(cams[i], mats[i], frusta[i], views[i]);
      this.matrix.copy(mats[N - 1]); this._frustum.copy(frusta[N - 1]);
    };
    if (sh.map) { sh.map.dispose(); if (sh.map.depthTexture) sh.map.depthTexture.dispose(); sh.map = null; }
    U.mgCsmA.value.x = 1;
  }
  function disable() {
    if (!on) return;
    on = false;
    delete sh.getCamera; delete sh.getFrustum; delete sh.updateMatrices;
    sh.mapSize.copy(saved.mapSize); sh._frameExtents.copy(saved.extents); sh._viewports = saved.views; sh._viewportCount = saved.count;
    if (sh.map) { sh.map.dispose(); if (sh.map.depthTexture) sh.map.depthTexture.dispose(); sh.map = null; }
    U.mgCsmA.value.x = 0;
  }

  const _d = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4();
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  /** d: unit vector toward the sun (jittered or not); camera: a perspective camera, or null for spheres around center/radius; k: sub-frame index */
  function fit(d, camera, center, radius, k = 0) {
    if (!on) return;
    _d.copy(d).normalize();
    _r.crossVectors(Math.abs(_d.y) > 0.99 ? X : Y, _d).normalize();   // right, up, toward the sun: a right-handed basis
    _u.crossVectors(_d, _r);
    const spheres = [];
    if (camera && camera.isPerspectiveCamera) {
      camera.updateMatrixWorld();
      const e = camera.projectionMatrix.elements, tx = 1 / e[0], ty = 1 / e[5];
      const far = Math.max(cfg.near * 2, Math.min(cfg.distance, camera.far)), sp = csmSplits(N, cfg.near, far, cfg.lambda);
      _p.setFromMatrixPosition(camera.matrixWorld);
      _f.set(0, 0, -1).transformDirection(camera.matrixWorld);
      for (let i = 0; i < N; i++) {
        const s = sliceSphere(i === 0 ? Math.min(camera.near, cfg.near) : sp[i], sp[i + 1], tx, ty);
        spheres.push({ c: [_p.x + _f.x * s.z, _p.y + _f.y * s.z, _p.z + _f.z * s.z], r: Math.ceil(s.r * 16) / 16 });
      }
    } else {
      for (let i = 0; i < N; i++) spheres.push({ c: center, r: radius * Math.pow(0.42, N - 1 - i) });
    }
    const rMax = spheres[N - 1].r, back = rMax + cfg.reach, R = back + rMax - 0.5;
    const ra = _r.toArray(), ua = _u.toArray(), da = _d.toArray();
    _m.makeBasis(_r, _u, _d);
    info.cascades.length = 0;
    for (let i = 0; i < N; i++) {
      const { c, r } = spheres[i], texel = (2 * r) / tile, cam = cams[i];
      const s = snapToTexel(c, ra, ua, da, texel);
      cam.position.set(s[0] + da[0] * back, s[1] + da[1] * back, s[2] + da[2] * back);
      cam.quaternion.setFromRotationMatrix(_m);
      cam.left = cam.bottom = -r; cam.right = cam.top = r; cam.near = 0.5; cam.far = back + rMax;
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      pars[i].set(texel, 0.5 / (2 * r), 0, 0);
      info.cascades.push({ center: s, radius: r, texel });
    }
    const A = U.mgCsmA.value, B = U.mgCsmB.value, C = U.mgCsmC.value;
    A.set(1, cfg.blend, ((k >>> 0) * 0.6180339887498949) % 1, 1 / R);
    const s = soft && soft.on ? soft : null;
    B.set(cfg.radius, s ? Math.tan((s.sunAngle * Math.PI) / 360) : 0, s ? s.maxPenumbra / 2 : 0, s ? s.minBlocker : 0);
    C.set(cfg.bias, cfg.normalOffset, s ? s.slopeMax : 10, s ? s.maxPenumbraTexels / 2 : 0);
    sh.needsUpdate = true;
  }

  const softTaps = soft ? { B: Math.min(soft.blockerSamples, 16), S: soft.blockerSteps } : null;
  const part = {
    id: 'csm', key: N + '.' + cfg.taps + (softTaps ? '.s' + softTaps.B + '.' + softTaps.S : ''), order: 10,
    pars: glsl(N, cfg.taps, softTaps), uniforms: U,
    // the sun is the first shadow-casting directional light: its lookup becomes the cascades', three's (or the
    // soft-shadow patch's) statement stays as the other branch
    apply: (fs, t) => t.swap(fs, 'directionalLightShadow = directionalLightShadows[ i ];', /* glsl */ `directionalLightShadow = directionalLightShadows[ i ];
		#if defined( MG_CSM ) && UNROLLED_LOOP_INDEX == 0
		if ( mgCsmA.x > 0.5 ) { if ( directLight.visible && receiveShadow ) directLight.color *= mix( 1.0, mgCsmShadow( directionalShadowMap[ 0 ], mgLW( geometryPosition ), mgLWN( nonPerturbedNormal ) ), directionalLightShadow.shadowIntensity ); } else
		#endif`, 'csm'),
  };
  return { cfg, part, uniforms: U, fit, enable, disable, info, tile, get on() { return on; }, cameras: cams };
}
