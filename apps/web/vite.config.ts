import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/, so the deploy workflow sets
  // VITE_BASE_PATH=/baby-tracker/. Locally it stays at the root.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in development, so the httpOnly refresh cookie of decision D6
    // behaves exactly as it will in production.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
