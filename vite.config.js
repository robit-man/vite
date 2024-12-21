import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.glb'], // Include .glb as assets
  publicDir: 'public', // Ensure Vite processes the /public folder
  build: {
    outDir: 'dist', // Specify the build output directory
    assetsDir: '', // Keep assets like .glb at the root of /dist
  },
});
