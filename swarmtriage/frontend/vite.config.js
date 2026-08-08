import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser always talks to same-origin /api; this dev-server proxy forwards
// those calls to the backend. VITE_BACKEND_URL is a SERVER-side env var read
// by the Vite process itself (never shipped to the browser):
//   - local dev:  defaults to http://localhost:8000
//   - docker-compose: set to http://backend:8000 (resolves inside the network)
const backendUrl = process.env.VITE_BACKEND_URL || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
    },
  },
});
