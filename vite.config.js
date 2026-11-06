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
        // Offline / DNS failure: answer 503 quietly (the app falls back to Kepler elements)
        configure: (proxy) => {
          let warned = false;
          // Vite registers its own (very verbose) error logger after configure(); keep only ours.
          const on = proxy.on.bind(proxy);
          proxy.on = (ev, fn) => (ev === 'error' ? proxy : on(ev, fn));
          on('error', (err, req, res) => {
            if (!warned) { warned = true; console.warn(`[horizons] NASA/JPL unreachable (${err.code || err.message}); using offline Kepler elements.`); }
            if (res && !res.headersSent && res.writeHead) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('Horizons unreachable'); }
          });
        },
      },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
