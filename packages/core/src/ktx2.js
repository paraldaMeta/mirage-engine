// Mirage original code.

// ---------------------------------------------------------------------------
// Opt-in KTX2 / Basis Universal textures for createTextures (manifest files ending in .ktx2):
//
//   import { createKTX2Loader } from '@miragekit/core/ktx2';   // a subpath, not in the index: see below
//   const ktx2 = await createKTX2Loader(world.renderer, { transcoderPath: '/basis/' });
//   const tex = createTextures(world, { manifest, url, ktx2 });
//
// three's KTX2Loader is imported here dynamically and this file is not re-exported by @miragekit/core's index (a bundler
// emits a dynamic import's chunk even when the function around it is unused), so a bundle that never imports it does
// not contain it
// (nor its worker source); the Basis transcoder (basis_transcoder.js + .wasm, from
// three/examples/jsm/libs/basis/) is fetched from `transcoderPath` by the loader's worker only when a file needs it.
// The project serves those two files (copy them to its public folder). Why: an ETC1S / UASTC set stays compressed
// on the GPU (4-8x less memory than RGBA8) and skips the image decode entirely.
// ---------------------------------------------------------------------------

/** a ready KTX2Loader (support detected for this renderer); `workers`: transcoder worker count */
export async function createKTX2Loader(renderer, { transcoderPath = './basis/', workers = 2 } = {}) {
  const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
  const loader = new KTX2Loader().setTranscoderPath(transcoderPath).setWorkerLimit(workers);
  loader.detectSupport(renderer);
  return loader;
}
