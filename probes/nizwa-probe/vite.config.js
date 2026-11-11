// nizwa-probe reads the Nizwa Golden Hour project IN PLACE (nothing of it is copied into this repository):
//   NIZWA_DIR   its folder (default: ~/Documents/阿拉伯魔法原料/oman-golden)
// `@nizwa/...` is its src/ folder. One file of it is rewritten on the way in: src/core/materials.js keeps its
// material library (PROC, materials(), glow, the lamp level) but its patch() hands over to compat/patch.js, which
// feeds the same hooks to Mirage's patch(). Every other Nizwa file loads unchanged.
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const HERE = import.meta.dirname;
const NIZWA = path.resolve(process.env.NIZWA_DIR || path.join(os.homedir(), 'Documents/阿拉伯魔法原料/oman-golden'));
if (!fs.existsSync(path.join(NIZWA, 'src/world/fort.js'))) throw new Error(`nizwa-probe: no Nizwa project at ${NIZWA} (set NIZWA_DIR)`);
const MATERIALS = path.join(NIZWA, 'src/core/materials.js');
const OWN = 'export function patch(mat, o = {}) {';

const bridge = () => ({
  name: 'nizwa-bridge',
  enforce: 'pre',
  transform(code, id) {
    if (path.normalize(id.split('?')[0]) !== MATERIALS) return null;
    if (!code.includes(OWN)) throw new Error('nizwa-probe: src/core/materials.js has no patch(mat, o) to bridge');
    return { code: `import { patch as __bridgePatch } from ${JSON.stringify(path.join(HERE, 'compat/patch.js'))};\n`
      + code.replace(OWN, 'export function patch(mat, o = {}) { return __bridgePatch(mat, o); }\nfunction __nizwaOwnPatch(mat, o = {}) {'), map: null };
  },
});

export default defineConfig({
  plugins: [bridge()],
  resolve: { alias: { '@nizwa': path.join(NIZWA, 'src') }, dedupe: ['three'] },   // one three for both code bases
  optimizeDeps: { include: ['three', 'three/addons/loaders/KTX2Loader.js'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { hmr: false, fs: { allow: [searchForWorkspaceRoot(HERE), NIZWA] } },
});
