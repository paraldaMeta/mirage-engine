// Mirage original code. Node checks of viewmodel.js (no GPU): the shader edits, the projection arithmetic they rely
// on, and that it is opt-in (a material not given to viewModelDepth compiles as before).
// usage: node viewmodel.check.mjs
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { viewModelDepth, viewModelShaders } from './src/viewmodel.js';

// the edits: a varying in both stages, clip z replaced at the end of the vertex main, gl_FragDepth first in the fragment main
{
  const vs = 'uniform mat4 projectionMatrix;\nvoid main() {\n  gl_Position = projectionMatrix * vec4(1.0);\n}\n', fs = 'void main() {\n  gl_FragColor = vec4(1.0);\n}\n';
  const s = viewModelShaders(vs, fs, 0.01);
  assert.ok(s.vertexShader.indexOf('varying vec4 mgVmD;') < s.vertexShader.indexOf('void main()'), 'the varying is declared before main (vertex)');
  assert.ok(s.vertexShader.indexOf('gl_Position.z =') > s.vertexShader.indexOf('gl_Position = projectionMatrix'), 'clip z is replaced after the projection');
  assert.ok(s.vertexShader.includes('0.01000'), 'the near plane is in the source');
  assert.ok(s.fragmentShader.indexOf('gl_FragDepth') > s.fragmentShader.indexOf('void main() {') && s.fragmentShader.indexOf('gl_FragDepth') < s.fragmentShader.indexOf('gl_FragColor'), 'gl_FragDepth is written first in main');
  assert.equal(viewModelShaders('no main', fs), null, 'a shader without main is left alone');
}
// the arithmetic the shader does, in JS: near and far from the projection, clip z of the nearer plane, the depth the
// fragment writes equals the camera's own depth beyond its near plane and clamps to 0 in front of it
{
  const cam = new THREE.PerspectiveCamera(62, 1.6, 0.1, 1600), P = cam.projectionMatrix.elements, p10 = P[10], p14 = P[14];
  const n = p14 / (p10 - 1), f = p14 / (p10 + 1);
  assert.ok(Math.abs(n - 0.1) < 1e-6 && Math.abs(f - 1600) / 1600 < 1e-4, `near ${n} far ${f} from the matrix`);
  const n2 = 0.01, clipZ = (w) => ((f + n2) / (f - n2)) * w - (2 * f * n2) / (f - n2), depth = (w) => Math.min(1, Math.max(0, 0.5 - 0.5 * p10 + (0.5 * p14) / w));
  for (const w of [0.011, 0.05, 0.099]) assert.ok(clipZ(w) / w > -1, `${w} m: inside the view model's near plane (not clipped)`);
  assert.ok(clipZ(0.009) / 0.009 < -1, '9 mm: clipped');
  for (const w of [0.12, 0.5, 3, 100]) {
    const v = new THREE.Vector3(0, 0, -w).applyMatrix4(cam.projectionMatrix);   // ndc z of the camera's own projection
    assert.ok(Math.abs(depth(w) - (0.5 * v.z + 0.5)) < 1e-6, `${w} m: the written depth is the camera's`);
  }
  assert.equal(depth(0.05), 0, 'in front of the camera near plane: depth 0');
}
// opt-in, once per material, and the program key changes only for patched materials
{
  const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial(), keyB = b.customProgramCacheKey();
  const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(), a)); g.add(new THREE.Mesh(new THREE.BoxGeometry(), [a]));
  assert.equal(viewModelDepth(g), 1, 'one material patched (shared by two meshes)');
  assert.equal(viewModelDepth(g), 0, 'again: nothing to do');
  assert.ok(a.customProgramCacheKey().endsWith('|mgVM0.01') && b.customProgramCacheKey() === keyB, 'only the patched material has the key');
  assert.equal(g.children[0].userData.mgViewModelNear, 0.01, 'the velocity pass reads the near plane from the mesh');
  const sh = { vertexShader: THREE.ShaderChunk.meshphysical_vert, fragmentShader: THREE.ShaderChunk.meshphysical_frag, uniforms: {} };
  a.onBeforeCompile(sh, null);
  assert.ok(sh.vertexShader.includes('mgVmD') && sh.fragmentShader.includes('gl_FragDepth'), 'three\'s standard shaders take the edits');
}
console.log('viewmodel check: ok');
