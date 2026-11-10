import { defineConfig } from 'vite';
import { rapierWasm } from '../../packages/tools/src/vite-rapier.mjs';
export default defineConfig({ plugins: [rapierWasm()], build: { target: 'es2022', chunkSizeWarningLimit: 2500 }, server: { hmr: false } });
