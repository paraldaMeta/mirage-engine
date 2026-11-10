// Mirage original code. A Vite plugin for pages that use @mirage/game: Rapier's wasm as its own file instead of
// base64 inside the JavaScript.
//
//   // vite.config.js
//   import { rapierWasm } from '@mirage/tools/src/vite-rapier.mjs';
//   export default defineConfig({ plugins: [rapierWasm()] });
//
// @dimforge/rapier3d-compat embeds its 1.5 MB wasm as a 2 MB base64 string and decodes it on init: the page
// downloads a third more (814 KB gzip against 569 KB for the wasm), the browser parses a 2 MB string, and the wasm
// can only be compiled after all of it has arrived. Here the build writes the wasm next to the bundle and Rapier's
// own init fetches it (WebAssembly.instantiateStreaming: it compiles while it downloads; a server that does not send
// application/wasm still works, Rapier falls back with a console warning). Rapier's API and behaviour are unchanged.
// Single-file pages (mirage-package) do not use the page's Vite config, so they keep the wasm inline.

const RAPIER = /[\\/]@dimforge[\\/]rapier3d-compat[\\/]rapier\.m?js$/;
// the compat build: init(){ ... yield <init>(<b64>.toByteArray("....").buffer) }
const EMBEDDED = /\b[\w$]+\.toByteArray\("([A-Za-z0-9+/=]{100000,})"\)\.buffer/;

export function rapierWasm() {
  return {
    name: 'mirage-rapier-wasm',
    apply: 'build',
    transform(code, id) {
      if (!RAPIER.test(id)) return null;
      const m = code.match(EMBEDDED);
      if (!m) { this.warn('rapier-wasm: no embedded wasm found in ' + id + '; it stays inline'); return null; }
      const ref = this.emitFile({ type: 'asset', name: 'rapier.wasm', source: Buffer.from(m[1], 'base64') });
      // the object form: the positional one logs a deprecation warning (it did with the inline wasm too)
      return { code: code.replace(m[0], `{ module_or_path: fetch(import.meta.ROLLUP_FILE_URL_${ref}) }`), map: null };
    },
  };
}
