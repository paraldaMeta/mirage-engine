// Mirage original code.
// The simplifier in a worker: autolod.js posts { id, mesh, opts } (typed arrays are transferred) and gets back
// { id, levels } (createChain's levels, their arrays transferred) or { id, error }.
import { createChain } from './simplify.js';

self.onmessage = (e) => {
  const { id, mesh, opts } = e.data;
  try {
    const chain = createChain(mesh, opts);
    chain.step();
    const move = [];
    for (const l of chain.levels) { move.push(l.positions.buffer, l.index.buffer); for (const a of l.attributes) move.push(a.buffer); }
    self.postMessage({ id, levels: chain.levels, source: chain.source }, move);
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
