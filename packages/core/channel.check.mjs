// Mirage original code.
// The channel water without a GPU (`node packages/core/channel.check.mjs`, also run by `npm test` in core): the
// geometry it builds, its uniforms and hooks. What the GPU draws is looked at in Chrome (examples/neon-district,
// scripts/weather.mjs).
import assert from '../../scripts/soft-assert.mjs';
import * as THREE from 'three';
import { channelWater, createPlumes, createMaterials, createEnv } from './src/index.js';

const G = createEnv({}).G, world = { mat: createMaterials(G) };
const ch = channelWater(world, { from: [1.5, 8.1], to: [17.5, 8.1], y: 0, width: 0.5, depth: 0.35, water: 0.12 });
const p = ch.water.geometry.attributes.position;
assert.ok(Math.abs(p.getY(0) - (-0.23)) < 1e-6, 'the surface at rim - depth + water');
const box = new THREE.Box3().setFromBufferAttribute(p);
assert.ok(Math.abs(box.min.x - 1.5) < 1e-6 && Math.abs(box.max.x - 17.5) < 1e-6 && Math.abs(box.min.z - 7.85) < 1e-6 && Math.abs(box.max.z - 8.35) < 1e-6, 'the surface spans the strip');
// faces: the surface up, the walls facing in, the bed up (three's winding)
const nrm = (g, t) => { const i = g.index.array, P = g.attributes.position, v = (k) => new THREE.Vector3().fromBufferAttribute(P, i[t * 3 + k]); const a = v(0); return v(1).sub(a).cross(v(2).sub(a)).normalize(); };
assert.ok(nrm(ch.water.geometry, 0).y > 0.99, 'the surface faces up');
assert.ok(nrm(ch.body, 0).z > 0.99 && nrm(ch.body, 2).z < -0.99 && nrm(ch.body, 4).y > 0.99, 'the walls face in, the bed up');
assert.deepEqual(ch.uniforms.uChDim.value.toArray().map((v) => +v.toFixed(4)), [0.25, 0.12, 0.23, 16], 'half width, water, wall above it, length');
// the shader: the cross-section traced, the light recovered from three's, no mirror pass, rain rings from wet.js
const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} };
ch.material.onBeforeCompile(sh);
const fs = sh.fragmentShader;
assert.ok(fs.includes('refract(-V, N, 0.7502)') && fs.includes('reflect(-V, N)') && fs.includes('chCaustic('), 'refraction, reflection of the wall, caustics');
assert.ok(fs.indexOf('reflectedLight.directDiffuse * 3.14159') > fs.indexOf('#include <lights_fragment_end>'), 'the light read after three lit it');
assert.ok(fs.includes('mgWetRipples(mgWorldPos.xz)') && 'MG_WET' in ch.material.defines, 'rain rings (wet.js)');
assert.ok(!/gl_FragCoord|uFrame/.test(fs.slice(fs.indexOf('uniform vec4 uChA'))), 'world space and uTime only');
assert.throws(() => channelWater(world, { from: [0, 0], to: [0, 0] }), RangeError);
assert.throws(() => channelWater(world, { from: [0, 0], to: [1, 0], depth: 0.1, water: 0.2 }), RangeError);
// --- plumes (plumes.js): one instanced draw, the nearest within reach, far to near, the budget kept
{
  const P = createPlumes({ G }, { budget: 2, slices: 8, far: 30 }), cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 1.7, 0);
  const ids = [[1, 0, 0], [5, 0, 0], [12, 0, 0], [50, 0, 0]].map((pos) => P.add({ pos, height: 2 }));
  P.update(cam);
  const g = P.mesh.geometry;
  assert.equal(g.instanceCount, 2, 'the budget: the two nearest');
  assert.ok(g.attributes.iSrc.getX(0) === 5 && g.attributes.iSrc.getX(1) === 1, 'drawn far to near');
  P.set(ids[1], { strength: 0 }); P.update(cam);
  assert.ok(g.instanceCount === 2 && g.attributes.iSrc.getX(0) === 12, 'a faded-out plume is not drawn');
  P.remove(ids[0]); P.remove(ids[2]); P.update(cam);
  assert.equal(g.instanceCount, 0, 'beyond far: none');
  assert.ok(P.mesh.material.fragmentShader.includes('plHG(') && !/gl_FragCoord|uFrame/.test(P.mesh.material.fragmentShader), 'single scattering, world space and uTime only');
}
console.log('channel and plumes check: ok');
