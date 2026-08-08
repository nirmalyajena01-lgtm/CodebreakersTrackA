import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone demo variant: the backend is simulated entirely in the browser
// (see src/api.js), so no dev proxy is needed. `npm run build` output is a
// fully static site suitable for static hosting previews.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
