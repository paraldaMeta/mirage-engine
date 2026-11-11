// Mirage original code.
// ---------------------------------------------------------------------------
// Instance-scoped shader injection for the lighting features (lighting.js): nothing here touches THREE.ShaderChunk.
//
//   const inj = createInjector();
//   inj.add({ id: 'csm', pars: glsl, uniforms: { mgCsmA: { value } }, apply: (fs, tools) => fs2 });
//   inj.adopt(scene);            // wraps every lit material found (again later: new materials, cheap when none)
//   inj.remove('csm');           // adopted materials recompile without it
//
// How: a lit material (Standard / Physical / Lambert / Phong) gets its onBeforeCompile wrapped — the material's own
// hook (materials.js patch, a kit's) runs first, then each part edits the fragment source: three's
// lights_fragment_begin / lights_fragment_maps includes are expanded in place (from THREE.ShaderChunk as it is at
// compile time, so the page-global fog / light2 / soft-shadow patches are kept) and the part replaces text in them.
// customProgramCacheKey is wrapped with the set of parts, so two worlds with different parts on one page do not
// share programs and a world with no part compiles byte-identical shaders to a page without this file.
// Uniform objects are assigned by reference: one value per world, every program of that world reads it.
// World-space position and normal come from the view-space ones three already has (viewMatrix is orthonormal):
// no new varyings, so the vertex shader is never touched.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const isLit = (m) => !!m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) && !(m.userData && m.userData.mgNoLighting);

const COMMON = /* glsl */ `
float mgRpK = 0.0;   // how much of this pixel's reflection came from reflection probes (probes.js sets it, gi.js reads it)
vec3 mgLW( vec3 vp ) { return ( ( vec4( vp, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz; }
vec3 mgLWN( vec3 n ) { return normalize( ( vec4( n, 0.0 ) * viewMatrix ).xyz ); }
float mgIgn( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
vec2 mgOct( vec3 d ) {
	d /= abs( d.x ) + abs( d.y ) + abs( d.z );
	vec2 o = d.y <= 0.0 ? d.xz : ( 1.0 - abs( d.zx ) ) * vec2( d.x >= 0.0 ? 1.0 : - 1.0, d.z >= 0.0 ? 1.0 : - 1.0 );
	return o * 0.5 + 0.5;
}
`;
/** the matching decode of mgOct (bake shaders): uv in 0..1 -> unit direction; uv outside 0..1 wraps as the octahedron does */
export const OCT_DECODE = /* glsl */ `
vec3 mgOctDec( vec2 uv ) {
	if ( uv.x < 0.0 || uv.x > 1.0 ) uv = vec2( uv.x < 0.0 ? - uv.x : 2.0 - uv.x, 1.0 - uv.y );
	if ( uv.y < 0.0 || uv.y > 1.0 ) uv = vec2( 1.0 - uv.x, uv.y < 0.0 ? - uv.y : 2.0 - uv.y );
	vec2 o = uv * 2.0 - 1.0;
	vec3 d = vec3( o.x, - ( 1.0 - abs( o.x ) - abs( o.y ) ), o.y );
	if ( d.y > 0.0 ) d.xz = ( 1.0 - abs( d.zx ) ) * vec2( d.x >= 0.0 ? 1.0 : - 1.0, d.z >= 0.0 ? 1.0 : - 1.0 );
	return normalize( d );
}`;

export function createInjector() {
  const parts = [];                 // { id, key, order, pars, uniforms, apply }
  const wrapped = new WeakMap();    // material -> our onBeforeCompile
  const all = new Set();
  let key = '';
  const warned = new Set();

  const tools = {
    /** replace `find` (string) once; a missing anchor warns once and leaves the source alone */
    swap(fs, find, to, id) {
      const i = fs.indexOf(find);
      if (i < 0) { if (!warned.has(id)) { warned.add(id); console.warn('[lighting] shader anchor not found (' + id + '): that part is skipped for some material'); } return fs; }
      return fs.slice(0, i) + to + fs.slice(i + find.length);
    },
  };
  function compile(shader) {
    let fs = shader.fragmentShader;
    if (!fs.includes('#include <lights_fragment_begin>') && !fs.includes('IncidentLight directLight;')) return;   // not a lit program
    for (const c of ['lights_fragment_begin', 'lights_fragment_maps']) fs = fs.replace('#include <' + c + '>', () => THREE.ShaderChunk[c]);
    fs = tools.swap(fs, 'void main() {', COMMON + parts.map((p) => p.pars || '').join('\n') + '\nvoid main() {', 'main');
    for (const p of parts) { Object.assign(shader.uniforms, p.uniforms || {}); if (p.apply) fs = p.apply(fs, tools); }
    shader.fragmentShader = fs;
  }
  function wrap(m) {
    if (wrapped.get(m) === m.onBeforeCompile) return false;
    const inner = m.onBeforeCompile, innerKey = m.customProgramCacheKey;
    const fn = function (shader, renderer) { inner.call(this, shader, renderer); if (key) compile(shader); };
    m.onBeforeCompile = fn;
    // three's default key is the hook's own source: asked through a view of the material that still has the inner hook,
    // or every wrapped material would answer with this wrapper's source and two different hooks would share a program
    m.customProgramCacheKey = function () { const k = innerKey.call(Object.create(this, { onBeforeCompile: { value: inner } })); return key ? k + '|mgL:' + key : k; };
    wrapped.set(m, fn);
    if (!all.has(m)) { all.add(m); m.addEventListener('dispose', () => all.delete(m)); }
    if (key) m.needsUpdate = true;
    return true;
  }
  function rekey() {
    const k = parts.map((p) => p.id + (p.key ? ':' + p.key : '')).join(',');
    if (k === key) return;
    key = k;
    for (const m of all) m.needsUpdate = true;
  }
  return {
    get key() { return key; },
    get materials() { return all; },
    add(part) { const i = parts.findIndex((p) => p.id === part.id); if (i >= 0) parts[i] = part; else parts.push(part); parts.sort((a, b) => (a.order || 0) - (b.order || 0)); rekey(); },
    remove(id) { const i = parts.findIndex((p) => p.id === id); if (i >= 0) { parts.splice(i, 1); rekey(); } },
    has: (id) => parts.some((p) => p.id === id),
    /** wrap every lit material under `root` not yet wrapped (or whose hook was replaced since); returns how many */
    adopt(root) {
      let n = 0;
      root.traverse((o) => {
        const m = o.material;
        if (!m) return;
        if (Array.isArray(m)) { for (const q of m) if (isLit(q) && wrap(q)) n++; } else if (isLit(m) && wrap(m)) n++;
      });
      return n;
    },
    adoptMaterial: (m) => isLit(m) && wrap(m),
    /** for tests: the fragment source a lit program would get */
    preview(fragmentShader) { const s = { fragmentShader, uniforms: {} }; if (key) compile(s); return s; },
  };
}
