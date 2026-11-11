// Mirage original code.
// The big-world switches for a scene that is already built, in one call: spatial chunks (chunk.js), automatic LOD
// (autolod.js) and occlusion culling (hiz.js). All opt-in; nothing here runs unless it is called.
//
//   import { applyBigWorld } from '@miragekit/core/bigworld';
//   const big = applyBigWorld(world, world.scene, { chunk: true, lod: true, occ: true });   // after the build, before world.prepare()
//   const big = applyBigWorld(world, world.scene, 'chunk,lod,occ');                         // the same, from a URL flag (?perf=chunk,lod,occ)
//   big.stats()   // { chunk: { meshes, chunks, split }, lod: { ... }, occ: { ... } }
//   await big.ready()   // the LOD chains are built (they build in workers over the first seconds otherwise)
//
// chunk / lod / occ may be objects: the options of chunkObject / createAutoLod / createOcclusion.
// What it leaves alone: instanced, skinned and multi-material meshes; a mesh with userData.chunk / lod / occlude
// === false. Moving objects must be excluded from occlusion (userData.occlude = false): bounds are taken once.
import { chunkObject } from './chunk.js';
import { createAutoLod } from './autolod.js';
import { createOcclusion } from './hiz.js';

export function applyBigWorld(world, root = world.scene, opts = {}) {
  if (typeof opts === 'string') opts = Object.fromEntries(opts.split(',').filter(Boolean).map((k) => [k.trim(), true]));
  const o = (v, d) => (v === true ? d : { ...d, ...v });
  const chunk = opts.chunk ? chunkObject(root, o(opts.chunk, {})) : null;
  const lod = opts.lod ? createAutoLod(world, o(opts.lod, { workers: 2 })) : null;
  const occ = opts.occ ? createOcclusion(world, o(opts.occ, {})) : null;
  lod?.add(root); occ?.add(root);
  return { chunk, lod, occ,
    stats: () => ({ chunk, lod: lod && { ...lod.stats }, occ: occ && { ...occ.stats } }),
    ready: () => (lod ? lod.ready() : Promise.resolve()),
    dispose() { lod?.dispose(); occ?.dispose(); } };
}
