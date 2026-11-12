// Mirage original code.
// ---------------------------------------------------------------------------
// A first-person view model (a gun and the hands that hold it) in its own near plane, in the world's depth range.
//
//   viewModelDepth(holder, { near: 0.01 })   // after the meshes exist; opt-in, nothing else changes
//
// The scene camera's near plane (0.1 m, say: depth resolution on the far facades) cuts a gun held 12 cm from the eye:
// the receiver, the sight and the cuffs cross the plane as the gun sways, kicks and bobs and are clipped on and off
// (a hole into the mesh that opens and closes from frame to frame). This draws every mesh under `root` with a near
// plane of `near` instead, without touching the camera or the rest of the scene:
//   - the vertex stage keeps the camera's projection for x, y and w (the field of view, the aspect, the sub-pixel
//     jitter of temporal AA are the camera's) and replaces only clip z with the one of a projection whose near plane is
//     `near`: what clips the triangle is that nearer plane;
//   - the fragment stage writes the depth the camera's own projection gives that pixel (gl_FragDepth, from the view
//     distance, which interpolates exactly), clamped to the camera's near: the depth buffer holds true depths, so the
//     post passes that read it (AO, the velocity buffer, temporal AA's nearest-depth tap, SSR, fog) see the gun where
//     it is, and the gun is hidden by a wall in front of it as before (no "always on top").
// Both are read from the projection matrix of whatever camera draws (n = P14 / (P10 - 1), f = P14 / (P10 + 1)): no
// uniform, no per-camera state; an orthographic camera (a shadow map) is left alone.
// The velocity pass (postfx.js) draws the same meshes with the same near plane (userData.mgViewModelNear).
// Cost: the view model's own pixels lose early depth rejection (gl_FragDepth); nothing else changes.
// Give the view model its own materials: a material shared with the world gets the patch too (harmless, the depth is
// the true depth, but the world's meshes in it lose early depth rejection as well).
// ---------------------------------------------------------------------------

const VS_DECL = 'varying vec4 mgVmD;\n';
const vsTail = (near) => /* glsl */ `
	#ifdef MG_VIEWMODEL
	{   // viewModelDepth: this program's own near plane (viewmodel.js)
		float mgP10 = projectionMatrix[ 2 ][ 2 ], mgP14 = projectionMatrix[ 3 ][ 2 ];
		bool mgPersp = projectionMatrix[ 2 ][ 3 ] < - 0.5;
		mgVmD = vec4( gl_Position.w, mgP10, mgP14, mgPersp ? 1.0 : 0.0 );
		if ( mgPersp ) {
			float mgN = mgP14 / ( mgP10 - 1.0 ), mgF = mgP14 / ( mgP10 + 1.0 ), mgN2 = min( mgN, ${near.toFixed(5)} );
			gl_Position.z = ( mgF + mgN2 ) / ( mgF - mgN2 ) * gl_Position.w - 2.0 * mgF * mgN2 / ( mgF - mgN2 );
		}
	}
	#endif
`;
const FS_HEAD = /* glsl */ `
	#ifdef MG_VIEWMODEL
	gl_FragDepth = mgVmD.w > 0.5 ? clamp( 0.5 - 0.5 * mgVmD.y + 0.5 * mgVmD.z / mgVmD.x, 0.0, 1.0 ) : gl_FragCoord.z;
	#endif
`;

/** The vertex / fragment edits on their own (for a ShaderMaterial of your own, or the checks). */
export function viewModelShaders(vertexShader, fragmentShader, near = 0.01) {
  let vs = vertexShader, fs = fragmentShader;
  const vEnd = vs.lastIndexOf('}'), vMain = vs.indexOf('void main()'), fMain = fs.indexOf('void main()');
  if (vEnd < 0 || vMain < 0 || fMain < 0) return null;
  vs = vs.slice(0, vEnd) + vsTail(near) + vs.slice(vEnd);
  vs = vs.slice(0, vMain) + VS_DECL + vs.slice(vMain);
  const fOpen = fs.indexOf('{', fMain);
  fs = fs.slice(0, fMain) + VS_DECL + fs.slice(fMain, fOpen + 1) + FS_HEAD + fs.slice(fOpen + 1);
  return { vertexShader: vs, fragmentShader: fs };
}

const done = new WeakMap();   // material -> near it was patched with

/**
 * Draw every mesh under `root` with its own near plane, in the camera's depth range (see the top of this file).
 * Call it before the meshes are first drawn (the lighting's injector wraps a material's hook when it first sees it;
 * a hook replaced after that is wrapped again), and again after adding meshes (materials already patched are skipped).
 * Opt-in: without it nothing changes.
 * The edits sit behind a define (MG_VIEWMODEL): `active(false)` compiles the materials without them (both programs
 * are cached after the first switch), so a host can pay for gl_FragDepth (the view model's own pixels lose early
 * depth rejection) only while the view model comes near the eye (aiming, a kick, the tuck at a wall).
 * @param {import('three').Object3D} root
 * @param {{ near?: number, active?: boolean }} [options]  near: the view model's near plane in metres (0.01)
 * @returns {{ count: number, materials: import('three').Material[], active: (on?: boolean) => boolean }}
 */
export function viewModelDepth(root, { near = 0.01, active = true } = {}) {
  const mats = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.mgViewModelNear = active ? near : 0;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m)) continue;
      if (m.isRawShaderMaterial) continue;   // a raw shader has no projectionMatrix declared by three: patch it yourself (viewModelShaders)
      done.set(m, near);
      const inner = m.onBeforeCompile, innerKey = m.customProgramCacheKey;
      m.onBeforeCompile = function (shader, renderer) {
        inner.call(this, shader, renderer);
        const s = viewModelShaders(shader.vertexShader, shader.fragmentShader, near);
        if (s) { shader.vertexShader = s.vertexShader; shader.fragmentShader = s.fragmentShader; }
      };
      // the inner key asked through a view of the material that still has the inner hook (three's default key is the
      // hook's source), so two view-model materials with different inner hooks do not share a program
      m.customProgramCacheKey = function () { return innerKey.call(Object.create(this, { onBeforeCompile: { value: inner } })) + '|mgVM' + near; };
      m.defines = { ...(m.defines || {}) };
      if (active) m.defines.MG_VIEWMODEL = ''; else delete m.defines.MG_VIEWMODEL;
      m.needsUpdate = true;
      mats.push(m);
    }
  });
  let on = !!active;
  return {
    count: mats.length, materials: mats,
    /** switch the own near plane on or off (no argument: ask); returns the state */
    active(v) {
      if (v === undefined || !!v === on) return on;
      on = !!v;
      for (const m of mats) { if (on) m.defines.MG_VIEWMODEL = ''; else delete m.defines.MG_VIEWMODEL; m.needsUpdate = true; }
      root.traverse((o) => { if (o.isMesh) o.userData.mgViewModelNear = on ? near : 0; });
      return on;
    },
  };
}
