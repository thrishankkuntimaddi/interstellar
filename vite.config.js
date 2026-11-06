import { defineConfig } from 'vite';

// The /horizons proxy lets the browser query NASA/JPL Horizons (which sends no CORS headers)
// for live planetary state vectors. The site works offline too, falling back to JPL Kepler elements.
export default defineConfig({
  // relative base so the build works at https://<user>.github.io/interstellar/ as well as locally
  base: './',
  server: {
    proxy: {
      '/horizons': {
        target: 'https://ssd.jpl.nasa.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/horizons/, '/api/horizons.api'),
      },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
