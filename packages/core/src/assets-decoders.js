// Mirage original code.

// ---------------------------------------------------------------------------
// The Draco and Basis decoder files of three, as URLs a Vite build resolves (and a single-file build inlines):
//
//   import { createAssets } from '@miragekit/core/assets';
//   import { decoders } from '@miragekit/core/assets-decoders';
//   const assets = createAssets(world, { decoders });
//
// `?url` is Vite's asset import; with another bundler (or none) pass folder URLs instead:
//   createAssets(world, { decoders: { draco: '/draco/', basis: '/basis/' } })
// Nothing is fetched until a file asks for a decoder; the cost of importing this module is the bytes of the four
// files in the build output, which is why it is separate from assets.js.
// ---------------------------------------------------------------------------
import dracoJs from 'three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasm from 'three/addons/libs/draco/gltf/draco_decoder.wasm?url';
import basisJs from 'three/addons/libs/basis/basis_transcoder.js?url';
import basisWasm from 'three/addons/libs/basis/basis_transcoder.wasm?url';

export const decoders = { draco: { js: dracoJs, wasm: dracoWasm }, basis: { js: basisJs, wasm: basisWasm } };
