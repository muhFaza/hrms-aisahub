import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server proxy target. Defaults to the host-local API so `pnpm dev` behaves
// exactly as before; docker-compose.yml overrides it to reach the API by its
// service name instead of localhost.
const apiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:5000';

const apiProxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
});
