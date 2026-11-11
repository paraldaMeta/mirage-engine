// Mirage original code. Node checks of postfx.js: the parts that need no GPU (the GPU paths: packages/tools/src/postfx-check.mjs).
// usage: node postfx.check.mjs
import assert from '../../scripts/soft-assert.mjs';
import { FX_DEFAULTS, halton, apertureRadius, parseCube, makeLut, lutTexture, postFromQuery } from './src/postfx.js';
import { DEFAULT_POST } from './src/post.js';

// everything is opt-in: the defaults are all off, and DEFAULT_POST carries them
for (const k of ['taa2', 'upscale', 'motionBlur', 'bokeh', 'bloomPyramid', 'chroma', 'rcas', 'godrays', 'flare']) assert.equal(FX_DEFAULTS[k], 0, `${k} is off by default`);
assert.equal(FX_DEFAULTS.lut, null);
for (const k of Object.keys(FX_DEFAULTS)) assert.equal(DEFAULT_POST[k], FX_DEFAULTS[k], `DEFAULT_POST.${k}`);

// Halton: the first elements, and an even cover (64 points of base 2 x 3 leave no 1/4 x 1/4 cell empty)
assert.deepEqual([1, 2, 3, 4].map((i) => halton(i, 2)), [0.5, 0.25, 0.75, 0.125]);
assert.ok(Math.abs(halton(2, 3) - 2 / 3) < 1e-12);
const cells = new Set(); for (let i = 1; i <= 64; i++) cells.add(Math.floor(halton(i, 2) * 4) + 4 * Math.floor(halton(i, 3) * 4));
assert.equal(cells.size, 16);

// a 50 mm lens at f/2 has a 25 mm aperture: radius 12.5 mm
assert.ok(Math.abs(apertureRadius(50, 2) - 0.0125) < 1e-12);

// .cube: comments, a title, the size, red fastest; errors that name the problem
const id2 = '# made by hand\nTITLE "identity"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
const c = parseCube(id2);
assert.equal(c.size, 2); assert.deepEqual([...c.data.slice(3, 6)], [1, 0, 0]); assert.deepEqual([...c.data.slice(12, 15)], [0, 0, 1]);
assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n'), /cube/i);
assert.throws(() => parseCube('LUT_1D_SIZE 4\n0 0 0\n'), /cube/i);

// makeLut: the identity is the identity at every node, red fastest
const m = makeLut((x) => x, 4);
assert.equal(m.data.length, 4 * 4 * 4 * 3);
assert.ok(Math.abs(m.data[3] - 1 / 3) < 1e-6 && m.data[4] === 0 && m.data[5] === 0, 'node 1 is one step of red');
assert.deepEqual([...m.data.slice(-3)], [1, 1, 1]);
const t = lutTexture(m);
assert.ok(t.isData3DTexture && t.image.width === 4 && t.image.depth === 4);

// URL flags: only what the query names, numbers only
const q = postFromQuery(new URLSearchParams('taa2=1&upscale=0.67&mb=0.5&bokeh=1&lens=0.03&focus=6&bloom2=1&chroma=0.6&lut=warm&dof=1'));
assert.deepEqual({ ...q, lut: !!q.lut.isData3DTexture }, { taa2: 1, upscale: 0.67, motionBlur: 0.5, bokeh: 1, dof: 0.03, focus: 6, bloomPyramid: 1, chroma: 0.6, lut: true });
assert.deepEqual(postFromQuery(new URLSearchParams('time=noon&taa2=yes&lut=nothing')), {}, 'an empty query changes nothing');
assert.deepEqual(postFromQuery(new URLSearchParams('godrays=0.8&flare=1')), { godrays: 0.8, flare: 1 }, 'the lens flags');
console.log('postfx check: ok');
