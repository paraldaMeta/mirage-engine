import { defineConfig } from 'vite';
export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rolldownOptions: { input: { main: 'index.html', embed: 'embed.html' } } },
  server: { hmr: false },
});
